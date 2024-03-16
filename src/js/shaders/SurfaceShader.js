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

    material.userData.shader = shader;

    shader.vertexShader = remove_comments(`
#ifdef USE_CUSTOM_MAPPING_0
attribute vec3 track_color;
varying vec3 vTrackColor;
#endif

#ifdef USE_CUSTOM_MAPPING_1
varying vec3 vPosition;
#endif

#ifdef USE_CUSTOM_MAPPING_2
varying vec3 vPosition;
#endif

varying float reflectProd;
`) + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      remove_comments(
`#include <fog_vertex>

// uniform vec3 cameraPosition; - camera position in world space
vec3 cameraRay = normalize( position.xyz - cameraPosition.xyz );
reflectProd = abs( dot( normalize( normal ), cameraRay ) );

#ifdef USE_CUSTOM_MAPPING_0
vTrackColor = track_color;
#endif

#ifdef USE_CUSTOM_MAPPING_1
vPosition = position;
#endif

#ifdef USE_CUSTOM_MAPPING_2
vPosition = position;
#endif
`)
    );

    shader.fragmentShader = remove_comments(`
precision mediump sampler2D;
precision mediump sampler3D;
uniform mat4 volumeMatrixInverse;
uniform float blend_factor;
uniform float mask_threshold;

#ifdef USE_CUSTOM_MAPPING_1
uniform vec3 scale_inv;
uniform sampler3D volume_map;
#endif

#ifdef USE_CUSTOM_MAPPING_2
uniform float elec_size;
uniform float elec_active_size;
uniform sampler2D elec_cols;
uniform sampler2D elec_locs;
uniform vec3 shift;
uniform float elec_radius;
uniform float elec_decay;
#endif


// uniform float sampler_bias;
// uniform float sampler_step;

varying mediump float reflectProd;

#ifdef USE_CUSTOM_MAPPING_0
varying mediump vec3 vTrackColor;
#endif

#ifdef USE_CUSTOM_MAPPING_1
varying mediump vec3 vPosition;
#endif

#ifdef USE_CUSTOM_MAPPING_2
varying mediump vec3 vPosition;
#endif
`) + shader.fragmentShader;

shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      remove_comments(
`
#ifdef USE_CUSTOM_MAPPING_1
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
#endif

#ifdef USE_CUSTOM_MAPPING_2
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

`) + "\nvoid main() {\n");



    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      remove_comments(
`

vec4 vColor2 = vec4( vColor.rgb , 1.0 );

if( mask_threshold > 0.0 && mask_threshold < reflectProd ) {
  vColor2.a = 0.0;
}


#ifdef USE_CUSTOM_MAPPING_0

  vColor2.rgb = vTrackColor.rgb;

#endif

#ifdef USE_CUSTOM_MAPPING_1

  vColor2.rgb = sample1( vPosition + vec3(0.5,-0.5,0.5) ).rgb;

#endif

#ifdef USE_CUSTOM_MAPPING_2

  if( elec_active_size > 0.0 ){
    vColor2.rgb = sample2( vPosition + shift ).rgb;
  }

#endif

#include <color_fragment>
`)
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      remove_comments(
`
#include <dithering_fragment>
// vColor2.rgb = vColor.rgb / 2.0 + mix( vColor.rgb, vColor2.rgb, blend_factor ) / 2.0;
gl_FragColor.rgb = gl_FragColor.rgb / 2.0 + mix( gl_FragColor.rgb, vColor2.rgb, blend_factor ) / 2.0;
if( vColor2.a == 0.0 ) {
  gl_FragColor.a = 0.0;
  gl_FragDepth = gl_DepthRange.far;
} else {
  gl_FragDepth = gl_FragCoord.z;
}
`
      )
    );
  };


  return( material );
};

export { compile_free_material };
