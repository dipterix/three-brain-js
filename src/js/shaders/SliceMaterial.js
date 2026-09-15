import { Vector3, Matrix4, DoubleSide, UnsignedByteType } from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Discard, select, uniform, texture, texture3D, varying,
  positionGeometry, normalGeometry, modelWorldMatrix,
  vec2, vec3, vec4, float, abs, min, max, mix, clamp, round, length, all, equal
} from 'three/tsl';
import { CONSTANTS } from '../core/constants.js';
import {
  PLACEHOLDER_TEXTURE, PLACEHOLDER_VOLUME, createPlaceholderVolume,
  textureBindingKey, adjustIntensity, fromDisplayColor
} from './nodeHelpers.js';

/**
 * Node (TSL) material for volume slices (`datacube.js`), replacing the GLSL
 * `SliceShader`. It draws the underlay volume with brightness and contrast
 * correction, and optionally:
 *   - an overlay volume (`setOverlay`, a `DataCube2`): its colors, as outlines
 *     when `overlayAlpha <= 0`, or a continuous volume through its color ramp
 *   - a mask: voxels darker than `zeroThreshold` and outside the mask are cut
 */

// Nearest-voxel lookups at four times the volume resolution
const roundToSubVoxel = ( position, shape ) =>
  round( position.mul( shape.mul( 4.0 ) ) ).div( shape.mul( 4.0 ) );

// `1 / ( shape - 1 )`, turning voxel indices into texture coordinates
const voxelScale = ( shape ) => vec3( 1.0 ).div( max( shape.sub( 1.0 ), vec3( 1.0 ) ) );

const safeNormalize = ( v ) =>
  select( length( v ).greaterThan( 1e-8 ), v.div( length( v ) ), vec3( 0.0 ) );

const isColored = ( rgb, alpha ) =>
  alpha.greaterThan( 0.0 ).and( max( rgb.x, rgb.y, rgb.z ).greaterThan( 0.0 ) );

// Per-vertex positions in each volume's texture coordinates, plus two in-plane
// steps of one overlay voxel (for the outlines)
function createSliceVaryings( u ) {
  const worldPosition = modelWorldMatrix.mul( vec4( positionGeometry, 1.0 ) );
  const overlayScale = voxelScale( u.overlayShape );

  // the slice plane's two in-plane axes, from its normal
  const alongZ = abs( normalGeometry.z ).greaterThanEqual( 0.5 );
  const alongY = abs( normalGeometry.y ).greaterThanEqual( 0.5 );
  const axisX = select( alongZ.or( alongY ), vec3( 1.0, 0.0, 0.0 ), vec3( 0.0, 1.0, 0.0 ) );
  const axisY = select( alongZ, vec3( 0.0, 1.0, 0.0 ), vec3( 0.0, 0.0, 1.0 ) );
  const overlayStep = ( axis ) =>
    safeNormalize( u.overlay2IJK.mul( modelWorldMatrix ).mul( vec4( axis, 0.0 ) ).xyz )
      .mul( min( overlayScale.x, overlayScale.y, overlayScale.z ) );

  return {
    underlay  : varying( u.world2IJK.mul( worldPosition ).xyz.div( max( u.mapShape.sub( 1.0 ), vec3( 1.0 ) ) ) ),
    mask      : varying( u.mask2IJK.mul( worldPosition ).xyz.mul( voxelScale( u.maskShape ) ) ),
    overlay   : varying( u.overlay2IJK.mul( worldPosition ).xyz.mul( overlayScale ) ),
    overlayStepX : varying( overlayStep( axisX ) ),
    overlayStepY : varying( overlayStep( axisY ) ),
  };
}

// `overlayColorCount`: undefined for a colored (atlas) overlay, or the number
// of colors in a continuous overlay's color ramp
function createSliceFragmentNode( u, positions, { hasOverlay, overlayColorCount, useMask } ) {
  return Fn( () => {

    // clamp to border: nothing outside the underlay volume
    const p = positions.underlay;
    If( max( p.x, p.y, p.z ).greaterThan( 1.0 ).or( min( p.x, p.y, p.z ).lessThan( 0.0 ) ), () => {
      Discard();
    } );

    const underlayIntensity = u.map.sample( roundToSubVoxel( p, u.mapShape ) ).level( 0 ).r.toVar();
    const overlayIntensity = float( 0.0 ).toVar();
    const intensity = float( underlayIntensity ).toVar();
    adjustIntensity( intensity, u.brightness, u.contrast );
    const color = vec3( intensity ).toVar();

    if( hasOverlay ) {
      const q = positions.overlay;
      If( u.useOverlay.greaterThan( 0.5 )
        .and( min( q.x, q.y, q.z ).greaterThanEqual( 0.0 ) )
        .and( max( q.x, q.y, q.z ).lessThanEqual( 1.0 ) ), () => {

        const binPosition = roundToSubVoxel( q, u.overlayShape ).toVar();
        const sample = u.overlayMap.sample( binPosition ).level( 0 ).toVar();
        const overlayRGB = vec3( sample.rgb ).toVar();
        const overlayAlpha = float( sample.a ).toVar();

        if( overlayColorCount !== undefined ) {

          // the red channel is the value; look its color up in the ramp
          const nColors = float( Math.max( Number( overlayColorCount ), 1 ) );
          If( overlayRGB.x.greaterThan( 0.0 ), () => {
            overlayIntensity.assign( overlayRGB.x );
            If( u.overlayValueUB.sub( u.overlayValueLB ).greaterThan( 0.00001 ), () => {
              overlayIntensity.assign( overlayIntensity.sub( u.overlayValueLB )
                .div( u.overlayValueUB.sub( u.overlayValueLB ) ) );
            } );
            overlayIntensity.assign( clamp( overlayIntensity, 0.0, 1.0 ) );
            overlayIntensity.assign( overlayIntensity.mul( nColors.sub( 1.0 ) ).add( 0.5 ).div( nColors ) );
            overlayRGB.assign( u.colorRampPalette.sample( vec2( overlayIntensity, 0.5 ) ).level( 0 ).rgb );
          } );

        } else {

          If( isColored( overlayRGB, overlayAlpha ), () => {
            overlayIntensity.assign( 1.0 );
          } );

          // outlines: hide voxels whose in-plane neighbors all have the same color
          If( u.overlayAlpha.lessThanEqual( 0.0 ), () => {
            const sameAsNeighbor = ( step ) => all( equal(
              u.overlayMap.sample( roundToSubVoxel( binPosition.add( step.mul( 0.25 ) ), u.overlayShape ) ).level( 0 ),
              sample ) );
            If( sameAsNeighbor( positions.overlayStepX ).and( sameAsNeighbor( positions.overlayStepX.negate() ) )
              .and( sameAsNeighbor( positions.overlayStepY ) ).and( sameAsNeighbor( positions.overlayStepY.negate() ) ), () => {
              overlayAlpha.assign( 0.0 );
            } );
          } );

        }

        If( isColored( overlayRGB, overlayAlpha ), () => {
          If( u.overlayAlpha.lessThan( 0.0 ), () => {
            color.assign( overlayRGB );
          } ).Else( () => {
            color.assign( mix( color, overlayRGB, u.overlayAlpha.mul( overlayAlpha ) ) );
          } );
        } );

      } );
    }

    if( useMask ) {
      const maskValue = u.maskMap.sample( clamp( positions.mask, 0.0, 1.0 ) ).level( 0 ).r;
      If( u.threshold.greaterThan( 0.0 )
        .and( underlayIntensity.lessThan( u.threshold ) )
        .and( overlayIntensity.lessThan( u.threshold ) )
        .and( maskValue.equal( 0.0 ) ), () => {
        Discard();
      } );
    }

    // the GLSL shader wrote these values to the screen as they are
    return fromDisplayColor( vec4( color, 1.0 ) );

  } )();
}

class SliceMaterial extends NodeMaterial {

  constructor( parameters = {} ) {
    super();
    this.isSliceMaterial = true;
    this.side = parameters.side ?? DoubleSide;
    this.transparent = parameters.transparent ?? false;
    this.depthWrite = parameters.depthWrite ?? true;
    this.fog = false;
    this.lights = false;

    const given = parameters.uniforms ?? {};
    const maskTexture = given.maskMap?.value ?? null;
    this._useMask = maskTexture !== null;
    this._hasOverlay = false;
    this._overlayColorCount = undefined;

    // named like the GLSL uniforms; every entry has a `.value`
    this.uniforms = {
      map               : texture3D( PLACEHOLDER_VOLUME ),
      mapShape          : uniform( new Vector3( 256, 256, 256 ) ),
      world2IJK         : uniform( new Matrix4() ),

      // `datacube.js` disposes the mask with the slice, so its stand-in is not shared
      maskMap           : texture3D( maskTexture ?? createPlaceholderVolume( UnsignedByteType ) ),
      maskShape         : uniform( given.maskShape?.value ?? new Vector3( 256, 256, 256 ) ),
      mask2IJK          : uniform( given.mask2IJK?.value ?? new Matrix4() ),

      // values below this threshold should be discarded
      threshold         : uniform( 0.0 ),

      overlayMap        : texture3D( PLACEHOLDER_VOLUME ),
      overlayShape      : uniform( new Vector3( 256, 256, 256 ) ),
      overlay2IJK       : uniform( new Matrix4() ),
      overlayAlpha      : uniform( 0.5 ),
      // switched per render pass (main or side views), so a uniform, not a rebuild
      useOverlay        : uniform( 0 ),

      colorRampPalette  : texture( PLACEHOLDER_TEXTURE ),
      overlayValueLB    : uniform( 0.0 ),
      overlayValueUB    : uniform( 1.0 ),

      // correction
      brightness        : uniform( 1.0 ),
      contrast          : uniform( 0.0 ),
    };

    this._positions = createSliceVaryings( this.uniforms );
    this._updateFragmentNode();
  }

  _updateFragmentNode() {
    this.fragmentNode = createSliceFragmentNode( this.uniforms, this._positions, {
      hasOverlay        : this._hasOverlay,
      overlayColorCount : this._overlayColorCount,
      useMask           : this._useMask,
    } );
    this.needsUpdate = true;
  }

  // `needsUpdate` only rebuilds the shader when this key changes; see
  // `SurfaceMaterial.customProgramCacheKey()`
  customProgramCacheKey() {
    const u = this.uniforms;
    const textureKeys = [ u.map, u.maskMap, u.overlayMap, u.colorRampPalette ]
      .map( node => textureBindingKey( node.value ) ).join( ',' );
    return `${ super.customProgramCacheKey() },slice:${ this._hasOverlay },` +
      `${ this._overlayColorCount },${ this._useMask },${ textureKeys }`;
  }

  // shows the overlay (see `setOverlay`) in the next render pass
  set useOverlay( v ) {
    this.uniforms.useOverlay.value = v ? 1 : 0;
  }

  get useOverlay() {
    return this.uniforms.useOverlay.value > 0.5;
  }

  // overlayAlpha
  set overlayAlpha( v ) {
    if( typeof v !== 'number' ) { return; }
    this.uniforms.overlayAlpha.value = v;
  }

  get overlayAlpha() {
    return this.uniforms.overlayAlpha.value;
  }

  // overlayValueLB
  set overlayValueLB( v ) {
    if( typeof v !== 'number' ) { return; }
    this.uniforms.overlayValueLB.value = v;
  }

  get overlayValueLB() {
    return this.uniforms.overlayValueLB.value;
  }

  // overlayValueUB
  set overlayValueUB( v ) {
    if( typeof v !== 'number' ) { return; }
    this.uniforms.overlayValueUB.value = v;
  }

  get overlayValueUB() {
    return this.uniforms.overlayValueUB.value;
  }

  // underlayContrast
  set underlayContrast( v ) {
    if( typeof v !== "number" ) { return; }
    this.uniforms.contrast.value = v;
  }

  get underlayContrast() {
    return this.uniforms.contrast.value;
  }

  // underlayBrightness
  set underlayBrightness( v ) {
    if( typeof v !== "number" ) { return; }
    this.uniforms.brightness.value = v;
  }

  get underlayBrightness() {
    return this.uniforms.brightness.value;
  }

  // another texture may bind differently; set `needsUpdate` after changing
  // this texture's filters too
  set underlayMap( v ) {
    this.uniforms.map.value = v;
    this.needsUpdate = true;
  }

  get underlayMap() {
    return this.uniforms.map.value;
  }

  get underlayShape() {
    return this.uniforms.mapShape.value;
  }

  get world2UnderlayVoxel() {
    return this.uniforms.world2IJK.value;
  }

  set zeroThreshold ( v ) {
    if( typeof v !== "number" ) { return; }
    this.uniforms.threshold.value = v;
  }

  get zeroThreshold() {
    return this.uniforms.threshold.value;
  }

  // event handlers
  _setOverlayColorChangeHandler = ( event ) => {
    if( !this._overlay ) { return; }
    if( this._overlay.name !== event.instanceName ) { return; }
    this.setOverlay( this._overlay );
  };

  _setOverlayState( hasOverlay, overlayColorCount ) {
    if( this._hasOverlay === hasOverlay && this._overlayColorCount === overlayColorCount ) { return; }
    this._hasOverlay = hasOverlay;
    this._overlayColorCount = overlayColorCount;
    this._updateFragmentNode();
  }

  // Methods

  // set/remove overlay
  removeOverlay = () => {
    this.uniforms.overlayMap.value = PLACEHOLDER_VOLUME;
    this.uniforms.colorRampPalette.value = PLACEHOLDER_TEXTURE;
    this._setOverlayState( false, undefined );

    if( this._overlay ) {
      try {
        this._overlay.removeEventListener(
          CONSTANTS.EVENTS.onDataCube2ColorUpdated,
          this._setOverlayColorChangeHandler
        );
        this._overlay.removeEventListener(
          CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
          this.removeOverlay
        );
      } catch (e) {
        console.warn(e);
      }
      this._overlay = undefined;
      this.needsUpdate = true;
    }
  }

  /**
   * Paints `inst` on the slices. The overlay's textures and ranges are copied
   * here; the volume fires `onDataCube2ColorUpdated` when they change, which
   * copies them again.
   */
  setOverlay( inst ) {

    if( !inst || !( inst.isDataCube2 || inst.isDataCube ) ) {
      this.removeOverlay();
      return;
    }

    if( this._overlay !== inst ) {
      this.removeOverlay();
      this._overlay = inst;
    }

    const u = this.uniforms;
    let overlayColorCount = undefined;

    if( inst.isDataCube2 ) {

      // the volume's own material (`RayMarchingMaterial`) holds its colors
      const volumeMaterial = inst.object.material;
      const volumeUniforms = volumeMaterial.uniforms;

      if ( inst.isDataContinuous ) {
        overlayColorCount = volumeMaterial.colorCount;
        u.colorRampPalette.value = volumeUniforms.colorRampPalette.value;
        this.overlayValueLB = volumeUniforms.singleChannelColorRangeLB.value;
        this.overlayValueUB = volumeUniforms.singleChannelColorRangeUB.value;
      }

      u.overlayMap.value = volumeUniforms.cmap.value;
      u.overlayShape.value.copy( inst.modelShape );

      // inst._transform is model to world
      u.overlay2IJK.value.copy( inst._transform ).invert()
        .premultiply( inst.model2vox );

    } else if( inst.isDataCube ) {

      // another slice volume
      u.overlayMap.value = inst.sliceMaterial.underlayMap;
      u.overlayShape.value.copy( inst.sliceMaterial.underlayShape );
      u.overlay2IJK.value.copy( inst.sliceMaterial.world2UnderlayVoxel );

    }

    this._setOverlayState( true, overlayColorCount );
    // the textures may bind differently; rebuilds only if the key changed
    this.needsUpdate = true;

    if(
      !inst.hasEventListener(
        CONSTANTS.EVENTS.onDataCube2ColorUpdated,
        this._setOverlayColorChangeHandler
      )
    ) {
      inst.addEventListener(
        CONSTANTS.EVENTS.onDataCube2ColorUpdated,
        this._setOverlayColorChangeHandler
      );
    }

    if(
      !inst.hasEventListener(
        CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
        this.removeOverlay
      )
    ) {
      inst.addEventListener(
        CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
        this.removeOverlay
      );
    }

  }

}

export { SliceMaterial };
