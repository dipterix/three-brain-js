import { remove_comments } from '../utils.js';

function addColorCoat( material, uniforms ) {
  material.onBeforeCompile = ( shader , renderer ) => {
    material.userData.shader = shader;

    shader.uniforms.fixedClearCoat = uniforms.fixedClearCoat ?? { value : false };
    shader.uniforms.clearcoat2 = uniforms.clearcoat ?? { value : 0 };
    shader.uniforms.useDataTexture = uniforms.useDataTexture ?? { value : false };
    shader.uniforms.dataTexture = uniforms.dataTexture ?? { value : null };


    shader.vertexShader = remove_comments(`
varying float reflectProd;
varying vec2 vUv;
`) + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      remove_comments(
`#include <fog_vertex>

vUv = uv;

mat4 pmv = projectionMatrix * modelViewMatrix;

// Orthopgraphic camera, camera position in theory is at infinite,

// Ideally the following calculation should generate correct results
// vOrigin will be interpolated in fragmentShader, hence project and unproject
vec4 vOriginProjected = pmv * vec4( position, 1.0 );
vOriginProjected.z = -vOriginProjected.w;
vec3 vOrigin = (inverse(pmv) * vOriginProjected).xyz;

vec3 cameraRay = normalize( position.xyz - vOrigin.xyz );

reflectProd = abs( dot( normalize( normal ), cameraRay ) );
`)
    );


    shader.fragmentShader = remove_comments(`
uniform float clearcoat2;
uniform bool useDataTexture;
uniform bool fixedClearCoat;
uniform mediump sampler2D dataTexture;
varying float reflectProd;
varying vec2 vUv;
`) + shader.fragmentShader;

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <color_fragment>",
    remove_comments(
`
if( useDataTexture ) {
  vec4 dColor = texture( dataTexture, vUv ).rgba;
  diffuseColor.rgb = dColor.rgb;
  diffuseColor.a *= dColor.a;
} else {
  #include <color_fragment>
}

gl_FragDepth = gl_FragCoord.z;
if( any( greaterThan( vUv , vec2(1.0001) ) ) || any( lessThan( vUv , vec2(-0.0001) ) ) ) {
  diffuseColor.rgb = vec3( 0.0 );
  diffuseColor.a = 0.15;
}
if ( !fixedClearCoat && clearcoat2 > 0.0 && reflectProd < clearcoat2 ) {
  diffuseColor.rgb = vec3( 0.0 );
  gl_FragDepth = gl_DepthRange.near;
}
`));
  };

  return material;
}

export { addColorCoat };
