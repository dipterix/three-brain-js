import {
  Vector3, DataTexture, Data3DTexture, BackSide, RGBAFormat, UnsignedByteType,
  LinearFilter, WebGPUCoordinateSystem
} from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Break, Continue, Discard, select, uniform, texture, texture3D, varying,
  positionGeometry, modelViewMatrix, cameraProjectionMatrix, screenCoordinate, depth,
  vec2, vec3, vec4, float, int, abs, min, max, mix, clamp, pow, floor, fract, sin,
  dot, normalize, length, distance, all, any, equal, notEqual
} from 'three/tsl';
import { Lut } from '../core/CustomLut.js'
import { MatCapPresets } from '../utils/createMatCapTexture.js';
import { textureBindingKey, fromDisplayColor, nearPlaneOrigin } from './nodeHelpers.js';

/**
 * Ray-marched voxel volumes (`DataCube2`, `geometry/datacube2.js`), as a node
 * (TSL) material for the volume's box.
 *
 * Each fragment of the box's back faces casts a ray from the near plane into
 * the volume. A fast pass with larger steps skips empty space, then the main
 * pass composites up to 30 colored voxels front to back, lit by a matcap and
 * the angle to the ray, and writes the depth of the first one.
 *
 * With one color channel (`colorChannels`), the volume is continuous: the red
 * channel is a value, colored through `colorRampPalette`. With four, it holds
 * the voxel colors (atlases). Normals come from `gradientMap` once
 * `DataCube2` has computed it, and from neighboring voxels until then.
 */

const matcapClay = MatCapPresets.clay();

// Stands in for the gradient volume until `DataCube2` computes it; it binds
// like the real one (8-bit RGBA, linear-filtered)
const PLACEHOLDER_GRADIENT = /*@__PURE__*/ ( () => {
  const volume = new Data3DTexture( new Uint8Array( 4 ), 1, 1, 1 );
  volume.format = RGBAFormat;
  volume.type = UnsignedByteType;
  volume.minFilter = LinearFilter;
  volume.magFilter = LinearFilter;
  volume.unpackAlignment = 1;
  volume.needsUpdate = true;
  return volume;
} )();

// Most voxels a ray composites
const MAX_VOXELS_PER_RAY = 30;

// Bounds the fast pass, which the GLSL shader ran as an open `while`; a ray
// through a 1024-voxel box at the smallest step size takes about 18,000 steps
const MAX_FAST_PASS_STEPS = 65536;

// Per-vertex ray ends, in model coordinates
function createRayVaryings() {
  return {
    origin    : varying( nearPlaneOrigin() ),
    position  : varying( positionGeometry ),
  };
}

function createRayMarchingFragmentNode( u, rays, { singleChannel, useGradientMap, useDithering } ) {
  return Fn( ( builder ) => {

    const isWebGPU = builder.renderer.coordinateSystem === WebGPUCoordinateSystem;
    const zero3 = vec3( 0.0 );
    const toTextureCoordinates = ( p ) => p.mul( u.scale_inv ).add( 0.5 );

    // window depth of a model position
    const getDepth = ( p ) => {
      const clip = cameraProjectionMatrix.mul( modelViewMatrix ).mul( vec4( p, 1.0 ) );
      const ndcZ = clip.z.div( clip.w );
      return isWebGPU ? ndcZ : ndcZ.mul( 0.5 ).add( 0.5 );
    };
    const getViewPosition = ( p ) => modelViewMatrix.mul( vec4( p, 1.0 ) ).xyz;

    // The voxel opacity at `p`; a continuous volume's value is its opacity
    const sampleOpacity = ( p ) => {
      const voxel = u.cmap.sample( toTextureCoordinates( p ) ).level( 0 );
      return singleChannel ? voxel.r : voxel.a;
    };

    // The voxel color at `p`; returns variables so callers can change them
    const sampleVoxel = ( p ) => {
      const voxel = u.cmap.sample( toTextureCoordinates( p ) ).level( 0 );
      const rgb = vec3( voxel.rgb ).toVar();
      const alpha = float( singleChannel ? voxel.r : voxel.a ).toVar();

      if( singleChannel ) {
        // the red channel is the value; look its color up in the ramp
        If( alpha.greaterThan( 0.0 ), () => {
          const intensity = float( voxel.r ).toVar();
          const lb = u.singleChannelColorRangeLB, ub = u.singleChannelColorRangeUB;
          If( ub.sub( lb ).greaterThan( 0.0001 ), () => {
            intensity.assign( intensity.sub( lb ).div( ub.sub( lb ) ) );
          } );
          const nColors = max( u.colorCount, 1.0 );
          // key colors sit at the texel centers
          const rampPosition = clamp( intensity, 0.0, 1.0 ).mul( nColors.sub( 1.0 ) ).add( 0.5 ).div( nColors );
          rgb.assign( u.colorRampPalette.sample( vec2( rampPosition, 0.5 ) ).level( 0 ).rgb );
        } );
      }
      return { rgb, alpha };
    };

    // Model-space surface normal at `p`, or zero
    const getNormal = ( p ) => {
      const position = toTextureCoordinates( p );
      const normal = vec3( 0.0 ).toVar();

      if( useGradientMap ) {

        // stored as ( gradient + 1 ) / 2; alpha 0 means no gradient
        const gradient = u.gradientMap.sample( position ).level( 0 );
        const unpacked = gradient.rgb.mul( 2.0 ).sub( 1.0 );
        // 8-bit rounding leaves up to about 0.0068 on flat regions; 1 / 128 is
        // the cut-off
        If( gradient.a.notEqual( 0.0 ).and( length( unpacked ).greaterThanEqual( 0.0078125 ) ), () => {
          normal.assign( normalize( unpacked ) );
        } );

      } else {

        // central differences: step towards colored neighbors along the three
        // in-plane diagonals
        const center = u.cmap.sample( position ).level( 0 );
        If( center.a.notEqual( 0.0 ).and( any( notEqual( center.rgb, zero3 ) ) ), () => {
          const s = max( abs( u.scale_inv.x ), abs( u.scale_inv.y ), abs( u.scale_inv.z ) ).mul( 1.74 );
          const steps = [
            vec3( s, s, 0.0 ), vec3( s, s, 0.0 ).negate(),
            vec3( s, 0.0, s ), vec3( s, 0.0, s ).negate(),
            vec3( 0.0, s, s ), vec3( 0.0, s, s ).negate(),
          ];
          for( const step of steps ) {
            const neighbor = u.cmap.sample( position.add( step ) ).level( 0 );
            If( neighbor.a.notEqual( 0.0 ).and(
                any( notEqual( neighbor.rgb, center.rgb ) ).or( any( notEqual( neighbor.rgb, zero3 ) ) ) ), () => {
              normal.addAssign( step );
            } );
          }
          // opposite steps cancel inside a region; the GLSL shader normalized
          // the zero vector there
          If( length( normal ).greaterThan( 0.0 ), () => {
            normal.assign( normalize( normal ) );
          } );
        } );

      }
      return normal;
    };

    // ---- The ray and where it crosses the box ----
    const origin = rays.origin;
    const rayDir = normalize( rays.position.sub( origin ) ).toVar();

    const boxMax = vec3( u.bounding ).div( u.scale_inv );
    const inverseDir = vec3( 1.0 ).div( rayDir );
    const tA = boxMax.negate().sub( origin ).mul( inverseDir );
    const tB = boxMax.sub( origin ).mul( inverseDir );
    const tNear = min( tA, tB ), tFar = max( tA, tB );
    const boundsX = max( tNear.x, tNear.y, tNear.z, 0.0 ).toVar();
    const boundsY = min( tFar.x, tFar.y, tFar.z ).toVar();
    If( max( tNear.x, tNear.y, tNear.z ).greaterThan( boundsY ), () => {
      Discard();
    } );

    const p = origin.add( rayDir.mul( boundsX ) ).toVar();
    const inc = vec3( 1.0 ).div( abs( rayDir ) );
    const delta = min( inc.x, inc.y, inc.z ).mul( max( abs( u.stepSize ), 0.1 ) ).toVar();

    if( useDithering ) {
      // https://www.marcusbannerman.co.uk/articles/VolumeRendering.html
      const noise = fract( sin( screenCoordinate.x.mul( 12.9898 ).add( screenCoordinate.y.mul( 78.233 ) ).add( 1.0 ) )
        .mul( 43758.5453 ) );
      p.addAssign( rayDir.mul( delta ).mul( noise ) );
    }
    const pStart = p.toVar();

    // ---- Fast pass: skip empty space with larger steps ----
    // Rays along a voxel axis could step over thin features, so they step
    // closer to `delta`; `fastPassMultiplier` is the upper bound
    const absDir = abs( rayDir );
    const anisotropy = clamp( max( absDir.x, absDir.y, absDir.z ).div( max( min( absDir.x, absDir.y, absDir.z ), 0.01 ) ), 1.0, 20.0 );
    const adaptiveMultiplier = clamp( u.fastPassMultiplier.div( pow( anisotropy, 0.6 ) ), 1.0, u.fastPassMultiplier );
    const deltaFast = delta.mul( adaptiveMultiplier ).toVar();

    const pFast = p.toVar();
    // distance from `pStart`
    const tFast = float( 0.0 ).toVar();
    const foundVoxel = int( 0 ).toVar();

    Loop( int( MAX_FAST_PASS_STEPS ), () => {
      If( boundsX.add( tFast ).greaterThanEqual( boundsY ), () => {
        Break();
      } );
      If( sampleOpacity( pFast ).greaterThan( 0.01 ), () => {
        // rewind two steps so thin surfaces aren't skipped, then snap to the
        // `delta` grid so the surface doesn't flicker
        tFast.assign( max( floor( tFast.sub( deltaFast.mul( 2.0 ) ).div( delta ) ).mul( delta ), 0.0 ) );
        p.assign( pStart.add( rayDir.mul( tFast ) ) );
        foundVoxel.assign( 1 );
        Break();
      } );
      pFast.addAssign( rayDir.mul( deltaFast ) );
      tFast.addAssign( deltaFast );
    } );

    If( foundVoxel.equal( 0 ), () => {
      p.assign( pFast );
    } );

    // ---- Main pass: composite front to back ----
    const hitCount = int( 0 ).toVar();
    const color = vec4( 0.0 ).toVar();
    const firstViewPosition = vec3( 0.0 ).toVar();
    const firstDepth = float( 1.0 ).toVar();

    Loop( { start: boundsX.add( tFast ), end: boundsY, type: 'float', condition: '<', update: delta }, () => {

      const voxel = sampleVoxel( p );
      const voxelRGB = voxel.rgb, voxelAlpha = voxel.alpha;

      If( voxelAlpha.lessThanEqual( 0.0 ).or( all( equal( voxelRGB, zero3 ) ) ), () => {
        p.addAssign( rayDir.mul( delta ) );
        Continue();
      } );

      if( useGradientMap ) {
        const gradient = u.gradientMap.sample( toTextureCoordinates( p ) ).level( 0 );

        if( singleChannel ) {

          // continuous volumes: the gradient magnitude (alpha) sets the
          // opacity, sharper for lower `alpha`
          If( u.alpha.greaterThan( 0.0 ), () => {
            const magnitude = clamp( gradient.a.mul( 4.0 ), 0.0, 1.0 );
            voxelAlpha.mulAssign( select( magnitude.greaterThan( 0.016 ),
              pow( magnitude, float( 1.0 ).div( u.alpha.mul( 2.25 ).add( 0.25 ) ) ), float( 0.0 ) ) );
          } ).Else( () => {
            voxelAlpha.assign( 1.0 );
          } );

        } else {

          // atlases: no gradient inside a parcel; skip those voxels until the
          // ray has hit one
          If( gradient.a.lessThanEqual( 0.0125 ), () => {
            If( hitCount.equal( 0 ), () => {
              p.addAssign( rayDir.mul( delta ) );
              Continue();
            } );
            voxelAlpha.assign( 0.0 );
          } ).Else( () => {
            If( u.alpha.greaterThan( 0.0 ), () => {
              voxelAlpha.mulAssign( u.alpha );
            } ).Else( () => {
              voxelAlpha.assign( 1.0 );
            } );
          } );

        }
      }

      const normal = getNormal( p );
      If( any( notEqual( normal, zero3 ) ), () => {

        // light both sides: face the normal towards the camera
        const lightNormDot = dot( normal, rayDir ).toVar();
        If( lightNormDot.greaterThan( 0.0 ), () => {
          normal.assign( normal.negate() );
        } ).Else( () => {
          lightNormDot.assign( lightNormDot.negate() );
        } );

        If( u.matCapIntensity.greaterThan( 0.0 ), () => {
          const viewNormal = normalize( modelViewMatrix.mul( vec4( normal, 0.0 ) ).xyz );
          const matCapColor = u.matCapTexture.sample( viewNormal.xy.mul( 0.5 ).add( 0.5 ) ).level( 0 ).rgb;
          voxelRGB.assign( mix( voxelRGB, voxelRGB.mul( matCapColor ), u.matCapIntensity ) );
        } );

        if( useDithering ) {
          const diffuse = clamp( lightNormDot, 0.0, 1.0 );
          voxelRGB.assign( voxelRGB.mul( 0.8 ).add( vec3( 0.1 ).mul( diffuse.mul( voxelRGB ).add( 1.0 ) ) ) );
        } else {
          voxelRGB.assign( voxelRGB.mul( pow( max( lightNormDot, 0.25 ), 0.3 ).mul( 0.2 ).add( 0.7 ) ).add( 0.1 ) );
        }

      } );

      hitCount.addAssign( 1 );

      If( hitCount.equal( 1 ), () => {

        // on the surface
        firstDepth.assign( getDepth( p ) );
        firstViewPosition.assign( getViewPosition( p ) );
        color.assign( vec4( voxelRGB, voxelAlpha ) );

      } ).Else( () => {

        If( u.maxRenderDistance.lessThan( 999.0 )
          .and( u.maxRenderDistance.lessThan( distance( firstViewPosition, getViewPosition( p ) ) ) ), () => {
          Break();
        } );
        color.assign( vec4(
          color.rgb.mul( color.a ).add( voxelRGB.mul( color.a.oneMinus() ) ),
          color.a.add( color.a.oneMinus().mul( voxelAlpha ) ) ) );

      } );

      If( hitCount.greaterThanEqual( MAX_VOXELS_PER_RAY ).or( color.a.greaterThan( 0.95 ) ), () => {
        Break();
      } );

      p.addAssign( rayDir.mul( delta ) );

    } );

    If( hitCount.equal( 0 ).or( color.a.equal( 0.0 ) ), () => {
      Discard();
    } );
    depth.assign( firstDepth ).toStack();

    // the GLSL shader wrote these values to the screen as they are
    return fromDisplayColor( color );
    // return color;

  } )();
}

class RayMarchingMaterial extends NodeMaterial {

  constructor({
    cmap,
    cmapShape,
    gradientMap = null,
    colorChannels = 4,
    colorMap = "viridis",
    nColors = 32,
  } = {}) {

    super();
    this.isRayMarchingMaterial = true;

    // the rays end on the box's back faces
    this.side = BackSide;
    this.transparent = true;
    this.fog = false;
    this.lights = false;

    this._colorChannels = colorChannels;
    this._useDithering = true;
    this._useGradientMap = gradientMap !== null;

    // only continuous (single-channel) volumes are colored through the ramp.
    // display (sRGB) bytes: the palette is read back as a byte texture that
    // this shader, `SliceMaterial` and the ISO surface all treat as display
    // values. A linear palette here is decoded a second time by
    // `fromDisplayColor` and comes out too dark.
    const colorLUT = new Lut( colorMap , nColors, false );
    colorLUT.minV = 0;
    colorLUT.maxV = nColors - 1;
    this.singleChannelLUT = colorLUT;

    const palette = new DataTexture( new Uint8Array( 4 * nColors ), nColors, 1 );
    if( colorChannels == 1 ) {
      this._fillPalette( palette );
    }
    palette.needsUpdate = true;

    // named like the GLSL uniforms; every entry has a `.value`
    this.uniforms = {
      cmap                      : texture3D( cmap ),
      gradientMap               : texture3D( gradientMap ?? PLACEHOLDER_GRADIENT ),
      // opacity; negative draws every colored voxel opaque
      alpha                     : uniform( -1.0 ),
      scale_inv                 : uniform( new Vector3( 1 / cmapShape.x, 1 / cmapShape.y, 1 / cmapShape.z ) ),
      // half the box size, as a fraction of the volume, that holds colored voxels
      bounding                  : uniform( 0.5 ),
      stepSize                  : uniform( 1.0 ),
      maxRenderDistance         : uniform( 1000.0 ),
      fastPassMultiplier        : uniform( 1.5 ),
      matCapTexture             : texture( matcapClay ),
      matCapIntensity           : uniform( 0.5 ),
      colorRampPalette          : texture( palette ),
      // the GLSL `N_SINGLE_CHANNEL_COLORS`: 1 unless the volume is continuous
      colorCount                : uniform( colorChannels == 1 ? nColors : 1 ),
      singleChannelColorRangeLB : uniform( 0.0 ),
      singleChannelColorRangeUB : uniform( 1.0 ),
    };

    this._rays = createRayVaryings();
    this._updateFragmentNode();

  }

  _updateFragmentNode() {
    this.fragmentNode = createRayMarchingFragmentNode( this.uniforms, this._rays, {
      singleChannel   : this.useSingleChannel,
      useGradientMap  : this._useGradientMap,
      useDithering    : this._useDithering,
    } );
    this.needsUpdate = true;
  }

  // `needsUpdate` only rebuilds the shader when this key changes; see
  // `SurfaceMaterial.customProgramCacheKey()`
  customProgramCacheKey() {
    const u = this.uniforms;
    const textures = [ u.cmap, u.colorRampPalette, u.matCapTexture ];
    if( this._useGradientMap ) { textures.push( u.gradientMap ); }
    const textureKeys = textures.map( node => textureBindingKey( node.value ) ).join( ',' );
    return `${ super.customProgramCacheKey() },raymarching:${ this.useSingleChannel },` +
      `${ this._useGradientMap },${ this._useDithering },${ textureKeys }`;
  }

  /**
   * The number of color channels: 1 for continuous volumes, 4 for discrete
   * ones (atlases). Changing it rebuilds the shader.
   * @param {number} value - The number of color channels (1 or 4)
   */
  get colorChannels() {
    return this._colorChannels;
  }

  set colorChannels( value ) {
    if( this._colorChannels === value ) { return; }
    this._colorChannels = value;
    this._updateFragmentNode();
  }

  get useSingleChannel() {
    return this._colorChannels == 1;
  }

  /**
   * Whether the ray start is jittered per pixel against banding. It also
   * switches between two lighting formulas. Changing it rebuilds the shader.
   * @param {boolean} value - Whether to enable dithering
   */
  get useDithering() {
    return this._useDithering;
  }

  set useDithering( value ) {
    const boolValue = !!value;
    if( this._useDithering === boolValue ) { return; }
    this._useDithering = boolValue;
    this._updateFragmentNode();
  }

  /**
   * Pre-computed normals (`Data3DTexture`, 8-bit RGBA, linear-filtered), or
   * `null` to compute them from neighboring voxels. Switching between the two
   * rebuilds the shader.
   */
  get gradientMap() {
    return this._useGradientMap ? this.uniforms.gradientMap.value : null;
  }

  set gradientMap( texture ) {
    this.uniforms.gradientMap.value = texture ?? PLACEHOLDER_GRADIENT;
    if( this._useGradientMap === ( texture !== null ) ) { return; }
    this._useGradientMap = texture !== null;
    this._updateFragmentNode();
  }

  // The number of key colors in `colorRampPalette`; `changePalette()` resizes
  // the palette to match
  get colorCount() {
    return this.uniforms.colorCount.value;
  }

  set colorCount( value ) {
    this.uniforms.colorCount.value = value;
  }

  _fillPalette( palette ) {
    const lut = this.singleChannelLUT;
    const nColors = palette.image.width;
    const keyColors = palette.image.data;
    for( let i = 0; i < nColors; i++ ) {
      const keyColor = lut.getColor( i );
      keyColors[ i * 4 ] = keyColor.r * 255;
      keyColors[ i * 4 + 1 ] = keyColor.g * 255;
      keyColors[ i * 4 + 2 ] = keyColor.b * 255;
      // `Color` carries no alpha, so this channel is opaque; the samplers read
      // `.rgb` only
      keyColors[ i * 4 + 3 ] = 255;
    }
    palette.needsUpdate = true;
  }

  changePalette( name ) {

    if( !this.useSingleChannel ) { return; }

    const lut = this.singleChannelLUT;
    const nColors = this.colorCount;

    lut.setColorMap( name , nColors );
    lut.minV = 0;
    lut.maxV = nColors - 1;

    let paletteTexture = this.uniforms.colorRampPalette.value;

    // three uploads a data texture into its existing GPU texture, so another
    // size needs a new texture. `DataCube2` then fires
    // `onDataCube2ColorUpdated`, and the slices copy the new one.
    if( paletteTexture.image.width !== nColors ) {
      paletteTexture.dispose();
      paletteTexture = new DataTexture( new Uint8Array( nColors * 4 ), nColors, 1 );
      this.uniforms.colorRampPalette.value = paletteTexture;
    }

    this._fillPalette( paletteTexture );
  }

}

export { RayMarchingMaterial };
