import { remove_comments } from '../utils.js';

const compile_free_material = ( material, options ) => {

  material.userData.options = options;

  material.onBeforeCompile = ( shader , renderer ) => {

    shader.uniforms.mapping_type = options.mapping_type;
    shader.uniforms.volume_map = options.volume_map;
    shader.uniforms.scale_inv = options.scale_inv;
    shader.uniforms.volumeMatrixInverse = options.volumeMatrixInverse;
    shader.uniforms.shift = options.shift;
    shader.uniforms.sampler_bias = options.sampler_bias;
    shader.uniforms.sampler_step = options.sampler_step;

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
attribute vec3 track_color;

varying vec3 vPosition;
varying vec3 vTrackColor;
varying float reflectProd;
`) + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      remove_comments(
`#include <fog_vertex>

// uniform vec3 cameraPosition; - camera position in world space
vec3 cameraRay = normalize( position.xyz - cameraPosition.xyz );

vPosition = position;
vTrackColor = track_color;

reflectProd = abs( dot( normalize( normal ), cameraRay ) );
`)
    );


    shader.fragmentShader = remove_comments(`
precision mediump sampler2D;
precision mediump sampler3D;
uniform int mapping_type;
uniform float elec_size;
uniform float elec_active_size;
uniform sampler3D volume_map;
uniform sampler2D elec_cols;
uniform sampler2D elec_locs;
uniform mat4 volumeMatrixInverse;
uniform vec3 scale_inv;
uniform vec3 shift;
uniform float sampler_bias;
uniform float sampler_step;
uniform float blend_factor;
uniform float elec_radius;
uniform float elec_decay;
uniform float mask_threshold;
varying mediump vec3 vTrackColor;
varying mediump vec3 vPosition;
varying mediump float reflectProd;

`) + shader.fragmentShader;

shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      remove_comments(
`
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

vec3 sample2( vec3 p ) {
  // p = (position + shift) * scale_inv
  vec3 eloc;
  vec3 ecol;
  vec2 p2 = vec2( 0.0, 0.5 );
  vec3 re = vec3( 0.0 );
  float count = 0.0;
  float len = 0.0;
  float start = 0.5 / elec_size;
  float end = elec_active_size / elec_size;
  float step = 1.0 / elec_size;

  for( p2.x = start; p2.x < end; p2.x += step ){
    eloc = texture( elec_locs, p2 ).rgb;
    len = max( length( ( eloc * 255.0 - 128.0 ) - p ) , 3.0 );
    if( len < elec_radius ){
      ecol = texture( elec_cols, p2 ).rgb;
      re += 1.0 + ( ecol - 1.0 ) * exp( - len * elec_decay / elec_radius );
      count += 1.0;
    }
  }
  if( count == 0.0 ){
    return ( vColor.rgb );
  }
  return (re / count);
}

`) + "\nvoid main() {\n");



    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      remove_comments(
`

vec4 vColor2 = vec4( vColor.rgb , 1.0 );

if( mask_threshold > 0.0 && mask_threshold < reflectProd ) {
  vColor2.a = 0.0;
}

if( mapping_type == 1 ){

    // is vTrackColor is missing, or all zeros, it's invalid

    if( vTrackColor.rgb != vec3(0.0) ){
      vColor2.rgb = vTrackColor.rgb;
    }

} else if( mapping_type == 2 ){

  vColor2.rgb = sample1( vPosition + vec3(0.5,-0.5,0.5) ).rgb;

} else if( mapping_type == 3 ){

  if( elec_active_size > 0.0 ){

    vColor2.rgb = sample2( vPosition + shift ).rgb;

  }
}

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
