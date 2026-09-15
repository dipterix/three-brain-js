import {
  DataTexture, Data3DTexture, RGBAFormat, RedFormat, UnsignedByteType,
  FloatType, NearestFilter, WebGPUCoordinateSystem
} from 'three';
import {
  Fn, If, float, vec4, abs, exp, min, workingToColorSpace, colorSpaceToWorking,
  expression, depth, positionGeometry, modelViewMatrix, cameraProjectionMatrix,
  modelWorldMatrixInverse, cameraWorldMatrix, cameraProjectionMatrixInverse
} from 'three/tsl';

/**
 * Pieces shared by the node (TSL) materials.
 */

// Every texture node needs a texture from the start. Data textures here are
// nearest-filtered, which three reads with `textureLoad`, so the stand-ins are
// nearest-filtered too: the real texture then binds the same way.
function nearestTexture( texture ) {
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// 1 x 1 RGBA stand-in for 2D data textures
function createPlaceholderTexture() {
  return nearestTexture(
    new DataTexture( new Uint8Array( 4 ), 1, 1, RGBAFormat, UnsignedByteType ) );
}

// 1 x 1 x 1 single-channel stand-in for volumes
function createPlaceholderVolume( type = FloatType ) {
  const data = type === FloatType ? new Float32Array( 1 ) : new Uint8Array( 1 );
  const volume = new Data3DTexture( data, 1, 1, 1 );
  volume.format = RedFormat;
  volume.type = type;
  return nearestTexture( volume );
}

// Shared stand-ins; never dispose these
const PLACEHOLDER_TEXTURE = createPlaceholderTexture();
const PLACEHOLDER_VOLUME = createPlaceholderVolume();

/**
 * What about a texture decides how a shader binds it: float textures and
 * filtered textures need different bindings. Materials put this in their
 * `customProgramCacheKey()` so swapping such a texture rebuilds the shader.
 */
function textureBindingKey( texture ) {
  if( !texture ) { return 'none'; }
  return `${ texture.type }:${ texture.minFilter }:${ texture.magFilter }`;
}

/**
 * Brightness and contrast correction of slice intensities, in place.
 * `intensity` must be a variable (`.toVar()`); call inside a `Fn`.
 */
function adjustIntensity( intensity, brightness, contrast ) {
  If( abs( contrast ).greaterThan( 0.03 ), () => {
    intensity.assign( exp( contrast.mul( intensity ).mul( 10.0 ) ).sub( 1.0 )
      .div( exp( contrast.mul( 10.0 ) ).sub( 1.0 ) ) );
  } );
  intensity.mulAssign( float( 1.15 ).div( float( 1.15 ).sub( min( brightness, 1.0 ) ) ) );
}

// three resolves this color space per renderer when the shader is built
const OUTPUT_COLOR_SPACE = 'OutputColorSpace';

/**
 * The GLSL shaders computed some colors on display values: raw shaders skip
 * color management, and patched ones ran after three's color-space conversion.
 * r185 renders in linear and converts in a final pass, so compute those colors
 * on `toDisplayColor( … )` and hand the result back through
 * `fromDisplayColor( … )`. Both take and return a `vec4`.
 */
const toDisplayColor = ( color ) => workingToColorSpace( color, OUTPUT_COLOR_SPACE );
const fromDisplayColor = ( color ) => colorSpaceToWorking( color, OUTPUT_COLOR_SPACE );

/**
 * The model-space point where the camera ray through this vertex
 * (`positionGeometry`) starts on the near plane. With the viewer's orthographic
 * cameras, `positionGeometry - nearPlaneOrigin()` points along the view. Vertex
 * stage only; wrap it in `varying()` for the fragment stage.
 */
const nearPlaneOrigin = /*@__PURE__*/ Fn( ( builder ) => {
  const clipPosition = cameraProjectionMatrix.mul( modelViewMatrix ).mul( vec4( positionGeometry, 1.0 ) );
  // the vertex moved onto the near plane, which is z = 0 in WebGPU clip space
  // and z = -w in WebGL's
  const nearZ = builder.renderer.coordinateSystem === WebGPUCoordinateSystem ?
    float( 0.0 ) : clipPosition.w.negate();
  const origin = modelWorldMatrixInverse.mul( cameraWorldMatrix ).mul( cameraProjectionMatrixInverse )
    .mul( vec4( clipPosition.xy, nearZ, clipPosition.w ) );
  return origin.xyz.div( origin.w );
} );

/**
 * The fragment's rasterized depth, as GLSL's `gl_FragCoord.z`. TSL's `depth`
 * recomputes it from the view position instead, and three's builders only
 * expose the fragment coordinate as `….xy`, so this swaps the swizzle. It falls
 * back to `depth` if that ever changes. Fragment stage only.
 */
const fragmentDepth = /*@__PURE__*/ Fn( ( builder ) => {
  const fragCoord = builder.getFragCoord();
  return fragCoord.endsWith( '.xy' ) ?
    expression( `${ fragCoord.slice( 0, -3 ) }.z`, 'float' ) : depth;
} );

export {
  PLACEHOLDER_TEXTURE, PLACEHOLDER_VOLUME, createPlaceholderVolume,
  textureBindingKey, adjustIntensity, toDisplayColor, fromDisplayColor,
  nearPlaneOrigin, fragmentDepth
};
