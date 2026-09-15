import { Matrix4, Vector3 } from 'three';
import { MeshPhysicalNodeMaterial, MeshLambertNodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Discard, select, uniform, texture, texture3D, attribute,
  vertexColor, varying, positionLocal, positionGeometry, normalLocal,
  cameraPosition, cameraProjectionMatrix, cameraViewMatrix, modelWorldMatrix,
  vec2, vec3, vec4, float, int, abs, dot, normalize, length, min, max, mix,
  step, exp
} from 'three/tsl';
import { CONSTANTS } from '../core/constants.js';
import {
  PLACEHOLDER_TEXTURE, PLACEHOLDER_VOLUME, textureBindingKey, adjustIntensity,
  toDisplayColor, fromDisplayColor
} from './nodeHelpers.js';

/**
 * Node (TSL) materials for surfaces (`free.js`). They replace the GLSL
 * `compile_free_material()` patch and keep its method names, so `free.js`
 * drives them the same way.
 *
 * On top of the lit material, a surface can be colored (`setMappingType`):
 *   - `VERTEX_COLOR`: the per-vertex `overlayColor` attribute
 *   - `VOXEL_COLOR`: the color of the atlas voxel under each vertex
 *   - `ELECTRODE_COLOR`: electrode colors, fading with distance
 * The result is blended half-and-half, unlit, with the lit color. The
 * `mask_threshold` option turns surfaces facing the camera see-through, and
 * `setClippingPlaneFromDataCube` cuts the surface at a slice and paints the
 * slice image on the cut.
 */

/**
 * The uniforms shared by a surface's materials. Uniform and texture nodes have
 * a `.value`, like the `{ value }` objects of the GLSL version, so `free.js`
 * updates them the same way.
 */
function createSurfaceMaterialOptions({ volumeTexture, volumeScaleInverse, clippingThrough }) {
  return {
    'volume_map'                    : texture3D( volumeTexture ),
    'volumeMatrixInverse'           : uniform( new Matrix4() ),
    'scale_inv'                     : uniform( volumeScaleInverse ),
    'shift'                         : uniform( new Vector3() ),
    'elec_cols'                     : texture( PLACEHOLDER_TEXTURE ),
    'elec_locs'                     : texture( PLACEHOLDER_TEXTURE ),
    'elec_size'                     : uniform( 0 ),
    'elec_active_size'              : uniform( 0 ),
    'elec_radius'                   : uniform( 10.0 ),
    'elec_decay'                    : uniform( 0.15 ),
    'blend_factor'                  : uniform( 0.4 ),

    // for mesh clipping (rename?)
    'mask_threshold'                : uniform( 0.0 ),

    'clippingNormal'                : uniform( new Vector3() ),
    'clippingThrough'               : uniform( clippingThrough ),
    'clippingMap'                   : texture3D( PLACEHOLDER_VOLUME ),
    'clippingMapMatrixWorldInverse' : uniform( new Matrix4() ),
    'brightness'                    : uniform( 0.0 ),
    'contrast'                      : uniform( 0.0 ),
  };
}

// A voxel counts as colored when it is not transparent and not near black
const VOXEL_HIT_THRESHOLD = 0.007843137;

// Where to look for a colored voxel, in order: the voxel itself, then its
// half-voxel neighbors, so vertices on a label boundary still get a color
const VOXEL_OFFSETS = [
  [ 0, 0, 0 ],
  [ -0.5, 0, 0 ], [ 0.5, 0, 0 ], [ 0, -0.5, 0 ], [ 0, 0.5, 0 ], [ 0, 0, -0.5 ], [ 0, 0, 0.5 ],
  [ -0.5, -0.5, 0 ], [ 0.5, 0.5, 0 ], [ 0.5, -0.5, 0 ], [ -0.5, 0.5, 0 ],
  [ 0.5, 0, -0.5 ], [ 0.5, 0, 0.5 ], [ -0.5, 0, -0.5 ], [ -0.5, 0, 0.5 ],
  [ 0, 0.5, -0.5 ], [ 0, 0.5, 0.5 ], [ 0, -0.5, -0.5 ], [ 0, -0.5, 0.5 ],
];

// Color of the first colored voxel around `position`, or `fallback`
const voxelColor = ( options, position, fallback ) => Fn( () => {
  const ijk = options.volumeMatrixInverse.mul( vec4( position, 1.0 ) ).xyz.add( 0.5 ).toVar();
  const color = vec3( fallback ).toVar();
  // later assignments win, so try the offsets last to first
  for( let k = VOXEL_OFFSETS.length - 1; k >= 0; k-- ) {
    const voxel = options.volume_map
      .sample( ijk.add( vec3( ...VOXEL_OFFSETS[ k ] ) ).mul( options.scale_inv ) )
      .level( 0 ).toVar();
    If( voxel.a.greaterThan( 0.0 ).and(
      max( voxel.r, voxel.g, voxel.b ).greaterThan( VOXEL_HIT_THRESHOLD ) ), () => {
      color.assign( voxel.rgb );
    } );
  }
  return color;
} )();

// Average color of the electrodes within `elec_radius` of `position`, each
// fading to white with distance; `fallback` when there are none.
// `elec_locs` / `elec_cols` hold one texel per electrode; locations are stored
// as `( xyz + 128 ) / 255`.
const electrodeColor = ( options, position, fallback ) => Fn( () => {
  const sum = vec3( 0.0 ).toVar();
  const count = float( 0.0 ).toVar();
  const decay = select( options.elec_radius.greaterThan( 0.0 ),
    options.elec_decay.div( options.elec_radius ), float( 0.0 ) ).toVar();
  const texelWidth = float( 1.0 ).div( max( options.elec_size, 1.0 ) ).toVar();

  Loop( { start: int( 0 ), end: int( options.elec_active_size ), type: 'int', condition: '<' }, ( { i } ) => {
    const uv = vec2( float( i ).add( 0.5 ).mul( texelWidth ), 0.5 ).toVar();
    const location = options.elec_locs.sample( uv ).level( 0 ).rgb.mul( 255.0 ).sub( 128.0 );
    const distance = max( length( location.sub( position ) ), 3.0 ).toVar();
    If( distance.lessThan( options.elec_radius ), () => {
      const electrodeColor = options.elec_cols.sample( uv ).level( 0 ).rgb;
      sum.addAssign( electrodeColor.sub( 1.0 ).mul( exp( distance.negate().mul( decay ) ) ).add( 1.0 ) );
      count.addAssign( 1.0 );
    } );
  } );

  return select( count.greaterThan( 0.0 ), sum.div( max( count, 1.0 ) ), fallback );
} )();

// The color mapped onto the surface, before blending with the lit color
function mappedColor( mappingType, overlayMaskEnabled, options, underlay ) {
  let color;
  switch( mappingType ) {
    case CONSTANTS.VERTEX_COLOR:
      color = attribute( 'overlayColor', 'vec3' );
      break;
    case CONSTANTS.VOXEL_COLOR:
      color = voxelColor( options, positionGeometry.add( vec3( 0.5, -0.5, 0.5 ) ), underlay );
      break;
    case CONSTANTS.ELECTRODE_COLOR:
      color = electrodeColor( options, positionGeometry.add( options.shift ), underlay );
      break;
    default:
      color = underlay;
  }
  // vertices failing the overlay threshold keep the underlay color
  if( overlayMaskEnabled ) {
    color = mix( underlay, color, step( 0.5, attribute( 'overlayMask', 'float' ) ) );
  }
  return color;
}

// Whether a point lies between the camera and the clipping plane
const onCameraSide = ( planeToCameraDistance, vertexToCameraDistance ) =>
  planeToCameraDistance.greaterThan( 0.0 ).and( vertexToCameraDistance.lessThan( planeToCameraDistance ) )
    .or( planeToCameraDistance.lessThan( 0.0 ).and( vertexToCameraDistance.greaterThan( planeToCameraDistance ) ) );

// Vertices between the camera and the clipping plane are moved onto the plane;
// the fragment stage paints the slice image there
function createClippingNodes( options ) {
  const worldPosition = modelWorldMatrix.mul( vec4( positionGeometry, 1.0 ) ).xyz;
  const planeToCameraDistance = dot( options.clippingThrough.sub( cameraPosition ), options.clippingNormal );
  const vertexToCameraDistance = dot( worldPosition.sub( cameraPosition ), options.clippingNormal );
  const planePosition = dot( options.clippingThrough.sub( worldPosition ), options.clippingNormal )
    .mul( options.clippingNormal ).add( worldPosition );
  const clippedPosition = select( onCameraSide( planeToCameraDistance, vertexToCameraDistance ),
    planePosition, worldPosition );
  return {
    planeToCameraDistance   : planeToCameraDistance,
    vertexToCameraDistance  : varying( vertexToCameraDistance ),
    planePosition           : varying( planePosition ),
    vertexNode              : cameraProjectionMatrix.mul( cameraViewMatrix ).mul( vec4( clippedPosition, 1.0 ) ),
  };
}

function makeSurfaceMaterial( BaseMaterial ) {

  class SurfaceMaterial extends BaseMaterial {

    constructor( parameters, options ) {
      super( parameters );
      this.isSurfaceMaterial = true;
      this.surfaceOptions = options;
      this._mappingType = CONSTANTS.DEFAULT_COLOR;
      this._overlayMaskEnabled = false;
      this._clippingSliceEnabled = false;

      // `clone()` constructs without options, then `copy()` fills them in
      if( options ) {
        this._clippingNodes = createClippingNodes( options );
        // how directly the surface faces the camera, for `mask_threshold`
        this._facingCamera = varying( abs( dot(
          normalize( normalLocal ), normalize( positionLocal.sub( cameraPosition ) ) ) ) );
      }
    }

    getMappingType() {
      return this._mappingType;
    }

    setMappingType( type ) {
      if( this._mappingType === type ) { return false; }
      this._mappingType = type;
      this.needsUpdate = true;
      return true;
    }

    /**
     * Toggles the per-vertex overlay threshold mask (`overlayMask` attribute).
     * The attribute is only read when enabled, so a geometry without it can
     * never be masked by a default attribute value.
     */
    setOverlayMaskEnabled( enabled ) {
      enabled = enabled ? true : false;
      if( this._overlayMaskEnabled === enabled ) { return false; }
      this._overlayMaskEnabled = enabled;
      this.needsUpdate = true;
      return true;
    }

    // Called every frame, so it only rebuilds the shader when something changes
    setClippingPlaneFromDataCube( datacube, normal ) {
      if( !datacube ) {
        this._setClippingSliceEnabled( false );
        return;
      }
      if( !datacube.isDataCube ) {
        throw new TypeError("Must provide a DataCube (slice) instance.");
      }
      const underlayMap = datacube.sliceMaterial.underlayMap;
      if( !underlayMap ) {
        this._setClippingSliceEnabled( false );
        return;
      }
      if( !normal.isVector3 ) {
        throw new TypeError("Plane normal must be a Vector3.");
      }
      const options = this.surfaceOptions;

      const cubeShape = datacube.sliceMaterial.underlayShape.clone().subScalar(1);
      options.clippingMapMatrixWorldInverse.value.identity()
        .scale( cubeShape ).invert()    // IJK -> model
        .multiply( datacube.sliceMaterial.world2UnderlayVoxel );       // world -> IJK -> model

      // another volume, or the slice switching its filter, may bind differently
      const bindingKey = textureBindingKey( underlayMap );
      if( options.clippingMap.value !== underlayMap || this._clippingMapBindingKey !== bindingKey ) {
        options.clippingMap.value = underlayMap;
        this._clippingMapBindingKey = bindingKey;
        this.needsUpdate = true;
      }

      const clippingNormal = options.clippingNormal.value.copy( normal ).normalize(); // plane normal
      if( clippingNormal.lengthSq() < 0.5 ) {
        clippingNormal.set(1, 0, 0);
      }

      this._setClippingSliceEnabled( true );
    }

    _setClippingSliceEnabled( enabled ) {
      if( this._clippingSliceEnabled === enabled ) { return; }
      this._clippingSliceEnabled = enabled;
      this.vertexNode = enabled ? this._clippingNodes.vertexNode : null;
      this.needsUpdate = true;
    }

    // `needsUpdate` only rebuilds the shader when this key changes, and three
    // builds it from the `*Node` properties plus un-prefixed material fields
    // (numbers reduced to zero / non-zero). Add everything that changes the
    // shader: the mapping, the mask, and how the clipping texture binds.
    customProgramCacheKey() {
      const options = this.surfaceOptions;
      const clippingMapKey = options ? textureBindingKey( options.clippingMap.value ) : '';
      return `${ super.customProgramCacheKey() },surface:${ this._mappingType },` +
        `${ this._overlayMaskEnabled },${ this._clippingSliceEnabled },${ clippingMapKey }`;
    }

    setupOutput( builder, outputNode ) {
      if( this.surfaceOptions ) {
        outputNode = this._setupSurfaceOutput( builder, outputNode );
      }
      return super.setupOutput( builder, outputNode );
    }

    _setupSurfaceOutput( builder, outputNode ) {
      const options = this.surfaceOptions;
      const useColor = this.vertexColors === true && builder.geometry.hasAttribute( 'color' );
      const clipping = this._clippingSliceEnabled;
      if( !useColor && !clipping ) { return outputNode; }

      const clippingNodes = this._clippingNodes;
      const facingCamera = this._facingCamera;
      const mappingType = this._mappingType;
      const overlayMaskEnabled = this._overlayMaskEnabled;

      // the GLSL version blended after three's color-space conversion
      return Fn( () => {
        const color = toDisplayColor( outputNode ).rgb.toVar();
        const alpha = float( outputNode.a ).toVar();

        const blendMappedColor = () => {
          const underlay = vertexColor().rgb;
          const mapped = mappedColor( mappingType, overlayMaskEnabled, options, underlay );
          color.assign( color.mul( 0.5 ).add( mix( underlay, mapped, options.blend_factor ).mul( 0.5 ) ) );
        };
        const discardFacingCamera = () => {
          const threshold = options.mask_threshold;
          If( threshold.greaterThan( 0.0 ).and( threshold.lessThan( 0.99 ) )
            .and( threshold.lessThan( facingCamera ) ), () => {
            Discard();
          } );
        };

        if( clipping ) {

          const { planeToCameraDistance, vertexToCameraDistance, planePosition } = clippingNodes;

          If( onCameraSide( planeToCameraDistance, vertexToCameraDistance ), () => {

            // paint the slice; clippingMap coordinates are 0 to 1 inside the volume
            const uvw = options.clippingMapMatrixWorldInverse.mul( vec4( planePosition, 1.0 ) ).xyz.toVar();
            If( max( uvw.x, uvw.y, uvw.z ).greaterThan( 1.0 )
              .or( min( uvw.x, uvw.y, uvw.z ).lessThan( 0.0 ) ), () => {
              Discard();
            } );
            const intensity = options.clippingMap.sample( uvw ).level( 0 ).r.toVar();
            adjustIntensity( intensity, options.brightness, options.contrast );
            color.assign( vec3( intensity ) );
            alpha.assign( 1.0 );

          } ).Else( () => {

            discardFacingCamera();
            If( vertexToCameraDistance.mul( planeToCameraDistance ).lessThanEqual( 0.0 ), () => {
              Discard();
            } );
            if( useColor ) { blendMappedColor(); }

          } );

        } else {
          blendMappedColor();
          discardFacingCamera();
        }

        return fromDisplayColor( vec4( color, alpha ) );
      } )();
    }

    copy( source ) {
      super.copy( source );
      this.surfaceOptions = source.surfaceOptions;
      this._mappingType = source._mappingType;
      this._overlayMaskEnabled = source._overlayMaskEnabled;
      this._clippingSliceEnabled = source._clippingSliceEnabled;
      this._clippingNodes = source._clippingNodes;
      this._facingCamera = source._facingCamera;
      return this;
    }
  }

  return SurfaceMaterial;
}

const SurfacePhysicalMaterial = makeSurfaceMaterial( MeshPhysicalNodeMaterial );
const SurfaceLambertMaterial = makeSurfaceMaterial( MeshLambertNodeMaterial );

export { SurfacePhysicalMaterial, SurfaceLambertMaterial, createSurfaceMaterialOptions };
