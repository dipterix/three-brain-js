import { CONSTANTS } from '../core/constants.js';
import { remove_comments } from '../utils.js';

const compile_free_material = ( material, options ) => {

  material.userData.options = options;

  if( !material.defines || typeof material.defines !== "object" ) {
    material.defines = {};
  }

  material.getMappingType = () => {
    const materialDefines = material.defines;
    if( materialDefines.USE_CUSTOM_MAPPING_0 !== undefined ) {
      return CONSTANTS.VERTEX_COLOR;
    }
    if( materialDefines.USE_CUSTOM_MAPPING_1 !== undefined ) {
      return CONSTANTS.VOXEL_COLOR;
    }
    if( materialDefines.USE_CUSTOM_MAPPING_2 !== undefined ) {
      return CONSTANTS.ELECTRODE_COLOR;
    }
    return CONSTANTS.DEFAULT_COLOR;
  };

  material.setMappingType = ( type ) => {
    const currentType = material.getMappingType();
    if( currentType === type ) { return false; }
    const materialDefines = material.defines;
    delete materialDefines.USE_CUSTOM_MAPPING_0;
    delete materialDefines.USE_CUSTOM_MAPPING_1;
    delete materialDefines.USE_CUSTOM_MAPPING_2;

    /*
    CONSTANTS.DEFAULT_COLOR = 0;
    CONSTANTS.VERTEX_COLOR = 1;
    CONSTANTS.VOXEL_COLOR = 2;
    CONSTANTS.ELECTRODE_COLOR = 3;
    */
    if( type === CONSTANTS.VERTEX_COLOR ) {
      materialDefines.USE_CUSTOM_MAPPING_0 = "";
    } else if ( type === CONSTANTS.VOXEL_COLOR ) {
      materialDefines.USE_CUSTOM_MAPPING_1 = "";
    } else if ( type === CONSTANTS.ELECTRODE_COLOR ) {
      materialDefines.USE_CUSTOM_MAPPING_2 = "";
    }
    material.needsUpdate = true;
    return true;
  };


  material.setClippingPlaneFromDataCube = ( datacube, normal ) => {
    if( !datacube ) {
      delete material.defines.USE_CLIPPING_SLICE;
      material.needsUpdate = true;
      return;
    }
    if( !datacube.isDataCube ) {
      throw new TypeError("Must provide a DataCube (slice) instance.");
      return;
    }
    if( !datacube._uniforms.map.value ) {
      delete material.defines.USE_CLIPPING_SLICE;
      material.needsUpdate = true;
      return;
    }
    if( !normal.isVector3 ) {
      throw new TypeError("Plane normal must be a Vector3.");
      return;
    }

    const datacubeMatrixWorldInverse = options.clippingMapMatrixWorldInverse.value;
    const cubeShape = datacube._uniforms.mapShape.value.clone().subScalar(1);

    datacubeMatrixWorldInverse.identity()
      .scale( cubeShape ).invert()    // IJK -> model
      .multiply( datacube._uniforms.world2IJK.value );       // world -> IJK -> model

    options.clippingMap.value = datacube._uniforms.map.value; // texture

    const clippingNormal = options.clippingNormal.value.copy( normal ).normalize(); // plane normal
    if( clippingNormal.lengthSq() < 0.5 ) {
      clippingNormal.set(1, 0, 0);
    }

    material.defines.USE_CLIPPING_SLICE = "";
    material.needsUpdate = true;
  };

  material.onBeforeCompile = ( shader , renderer ) => {

    // shader.uniforms.mapping_type = options.mapping_type;
    shader.uniforms.volume_map = options.volume_map;
    shader.uniforms.scale_inv = options.scale_inv;
    shader.uniforms.volumeMatrixInverse = options.volumeMatrixInverse;
    shader.uniforms.shift = options.shift;
    // shader.uniforms.sampler_bias = options.sampler_bias;
    // shader.uniforms.sampler_step = options.sampler_step;

    shader.uniforms.elec_cols = options.elec_cols;
    shader.uniforms.elec_locs = options.elec_locs;
    shader.uniforms.elec_size = options.elec_size;
    shader.uniforms.elec_active_size = options.elec_active_size;
    shader.uniforms.elec_radius = options.elec_radius;
    shader.uniforms.elec_decay = options.elec_decay;

    shader.uniforms.blend_factor = options.blend_factor;
    shader.uniforms.mask_threshold = options.mask_threshold;

    // not using existing threejs implementation
    shader.uniforms.clippingNormal = options.clippingNormal; // plane normal
    shader.uniforms.clippingThrough = options.clippingThrough; // plane position
    shader.uniforms.clippingMap = options.clippingMap;  // texture
    shader.uniforms.clippingMapMatrixWorldInverse = options.clippingMapMatrixWorldInverse; // model (texture 0, 1) to world matrix
    shader.uniforms.brightness = options.brightness;  // brightness correction
    shader.uniforms.contrast = options.contrast;  // contrast correction


    material.userData.shader = shader;

    shader.vertexShader = remove_comments(`

#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  varying vec3 vUnderlayColor;

  #if defined( USE_CUSTOM_MAPPING_0 )

    attribute vec3 overlayColor;
    varying vec3 vOverlayColor;

  #elif defined( USE_CUSTOM_MAPPING_1 )

    varying vec3 vPosition;

  #elif defined( USE_CUSTOM_MAPPING_2 )

    varying vec3 vPosition;

  #endif

#endif

#if defined( USE_CLIPPING_SLICE )

  uniform vec3 clippingThrough;
  uniform vec3 clippingNormal;

  varying float planeToCameraDistance;
  varying float vertToCameraProjDist;
  varying vec3 planePosition;

#endif

#if defined( USE_CLIPPING_SLICE ) || defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  varying float reflectProd;

#endif
`) + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      remove_comments(
`#include <fog_vertex>

// uniform vec3 cameraPosition; - camera position in world space
// vec3 cameraRay = normalize( position.xyz - cameraPosition.xyz );
vec3 cameraRay = normalize( transformed.xyz - cameraPosition.xyz );

#if defined( USE_CLIPPING_SLICE ) || defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  // reflectProd = abs( dot( normalize( normal ), cameraRay ) );
  reflectProd = abs( dot( normalize( objectNormal ), cameraRay ) );

#endif

#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  vUnderlayColor = color;

  #if defined( USE_CUSTOM_MAPPING_0 )

    vOverlayColor = overlayColor;

  #elif defined( USE_CUSTOM_MAPPING_1 )

    vPosition = position;

  #elif defined( USE_CUSTOM_MAPPING_2 )

    vPosition = position;

  #endif

#endif

#if defined( USE_CLIPPING_SLICE )

  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  mat4 projectionViewMatrix = projectionMatrix * viewMatrix;

  // distance from camera to plane
  planeToCameraDistance = dot( clippingThrough - cameraPosition.xyz , clippingNormal );
  vertToCameraProjDist = dot( worldPosition.xyz - cameraPosition.xyz , clippingNormal );

  planePosition = dot( clippingThrough - worldPosition.xyz, clippingNormal ) * clippingNormal + worldPosition.xyz;

  if(
    ( planeToCameraDistance > 0.0 && vertToCameraProjDist < planeToCameraDistance ) ||
    ( planeToCameraDistance < 0.0 && vertToCameraProjDist > planeToCameraDistance )
  ) {
    gl_Position = projectionViewMatrix * vec4(planePosition, 1.0);
  } else {
    gl_Position = projectionViewMatrix * modelMatrix * vec4( position, 1.0 );
  }

#endif
`)
    );

    shader.fragmentShader = remove_comments(`
precision mediump sampler2D;
precision mediump sampler3D;

uniform float mask_threshold;

#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  varying vec3 vUnderlayColor;
  uniform float blend_factor;

  #if defined( USE_CUSTOM_MAPPING_0 )

    varying vec3 vOverlayColor;

  #elif defined( USE_CUSTOM_MAPPING_1 )

    uniform mat4 volumeMatrixInverse;
    uniform vec3 scale_inv;
    uniform sampler3D volume_map;

    varying vec3 vPosition;

  #elif defined( USE_CUSTOM_MAPPING_2 )

    uniform float elec_size;
    uniform float elec_active_size;
    uniform sampler2D elec_cols;
    uniform sampler2D elec_locs;
    uniform vec3 shift;
    uniform float elec_radius;
    uniform float elec_decay;

    varying vec3 vPosition;

  #endif

#endif

#if defined( USE_CLIPPING_SLICE )

  uniform mat4 clippingMapMatrixWorldInverse;
  uniform sampler3D clippingMap;
  uniform float brightness;
  uniform float contrast;

  varying float planeToCameraDistance;
  varying float vertToCameraProjDist;
  varying vec3 planePosition;

#endif

#if defined( USE_CLIPPING_SLICE ) || defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  varying float reflectProd;

#endif

`) + shader.fragmentShader;

shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      remove_comments(
`

#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  #if defined( USE_CUSTOM_MAPPING_1 )

  vec3 sample1(vec3 p) {
    vec4 re = vec4( 0.0 );
    vec3 threshold = vec3( 0.007843137, 0.007843137, 0.007843137 );

    vec3 ijk = (volumeMatrixInverse * vec4(p, 1.0)).xyz + vec3(0.5);

    re = texture( volume_map, ijk.xyz * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( -0.5, 0.0, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.5, 0.0, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, -0.5, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, 0.5, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, 0.0, -0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, 0.0, 0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( -0.5, -0.5, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.5, 0.5, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.5, -0.5, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( -0.5, 0.5, 0.0 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.5, 0.0, -0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.5, 0.0, 0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( -0.5, 0.0, -0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( -0.5, 0.0, 0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, 0.5, -0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, 0.5, 0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, -0.5, -0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    re = texture( volume_map, (ijk.xyz + vec3( 0.0, -0.5, 0.5 )) * scale_inv );
    if( re.a > 0.0 && ( re.r > threshold.r || re.g > threshold.g || re.b > threshold.b ) ){
      return re.rgb;
    }

    return( vColor.rgb );
  }

  #elif defined( USE_CUSTOM_MAPPING_2 )

  vec3 sample2( vec3 p ) {
    // p = (position + shift) * scale_inv
    vec3 eloc;
    vec3 ecol;
    vec2 p2 = vec2( 0.0, 0.5 );
    vec3 re = vec3( 0.0 );
    float count = 0.0;
    float len = 0.0;
    float start = 0.5;
    float end = elec_active_size;
    float step = 1.0;
    float decay = 0.0;

    if( elec_size > 0.0 ) {
      start /= elec_size;
      end /= elec_size;
      step /= elec_size;
    }
    if( elec_radius > 0.0 ) {
      decay = elec_decay / elec_radius;
    }

    for( p2.x = start; p2.x < end; p2.x += step ){
      eloc = texture( elec_locs, p2 ).rgb;
      len = max( length( ( eloc * 255.0 - 128.0 ) - p ) , 3.0 );
      if( len < elec_radius ){
        ecol = texture( elec_cols, p2 ).rgb;
        re += 1.0 + ( ecol - 1.0 ) * exp( - len * decay );
        count += 1.0;
      }
    }
    if( count == 0.0 ){
      return ( vColor.rgb );
    }
    return (re / count);
  }

  #endif

#endif

`) + "\nvoid main() {\n");



    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      remove_comments(
`


#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

	vec4 vColor2 = vec4( vUnderlayColor.rgb , 1.0 );

  #if defined( USE_CUSTOM_MAPPING_0 )

    vColor2.rgb = vOverlayColor.rgb;

  #elif defined( USE_CUSTOM_MAPPING_1 )

    vColor2.rgb = sample1( vPosition + vec3(0.5,-0.5,0.5) ).rgb;

  #elif defined( USE_CUSTOM_MAPPING_2 )

    if( elec_active_size > 0.0 ){
      vColor2.rgb = sample2( vPosition + shift ).rgb;
    }

  #endif


#endif

#include <color_fragment>
`)
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      remove_comments(
`
#include <dithering_fragment>

#if defined( USE_CLIPPING_SLICE )

  if(
    (
      ( planeToCameraDistance > 0.0 && vertToCameraProjDist < planeToCameraDistance ) ||
      ( planeToCameraDistance < 0.0 && vertToCameraProjDist > planeToCameraDistance )
    )
  ) {


    // raycast from camera to plane through worldPosition
    vec3 planePositionTexture = (clippingMapMatrixWorldInverse * vec4( planePosition , 1.0 )).xyz;

    if(
      any(greaterThan( planePositionTexture, vec3(1.0) )) ||
      any(lessThan( planePositionTexture, vec3(0.0) ))
    ) {
      discard;
    } else {
      float intensity = texture(clippingMap, planePositionTexture).r;

      if( abs( contrast ) > 0.03 ) {
        intensity = ( exp( contrast * intensity * 10.0 ) - 1.0 ) / ( exp( contrast * 10.0 ) - 1.0 );
      }
      intensity *= 1.15 / (1.15 - min( brightness , 1.0 ) );

      gl_FragColor.rgb = vec3( intensity );

      gl_FragColor.a = 1.0;

    }

  } else {
    if( mask_threshold > 0.0 && mask_threshold < reflectProd ) {
      discard;
    }
    if( vertToCameraProjDist * planeToCameraDistance <= 0.0 ) {
      discard;
    }

    #if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

      gl_FragColor.rgb = gl_FragColor.rgb * 0.5 + mix( vUnderlayColor.rgb, vColor2.rgb, blend_factor ) * 0.5;

    #endif
  }

#elif defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )

  gl_FragDepth = gl_FragCoord.z;

  gl_FragColor.rgb = gl_FragColor.rgb * 0.5 + mix( vUnderlayColor.rgb, vColor2.rgb, blend_factor ) * 0.5;

  if( mask_threshold > 0.0 && mask_threshold < reflectProd ) {
    discard;
  }


#endif

`
      )
    );
  };


  return( material );
};

export { compile_free_material };
