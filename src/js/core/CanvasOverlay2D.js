import {
  Mesh, CanvasTexture, UVMapping, ClampToEdgeWrapping, NearestFilter,
  RGBAFormat, BackSide, BoxGeometry, RawShaderMaterial, GLSL3
} from 'three';
import { remove_comments } from '../utils.js';

class CanvasOverlay2D {
  constructor( canvas2d, camera ) {
    this.image = canvas2d;
    this.camera = camera;
    const radius = this.camera.near + 1;

    this.texture = new CanvasTexture( this.image );

    this.geometry = new BoxGeometry( 100, 100, radius * 2 );
    this.material = new RawShaderMaterial( {
      glslVersion: GLSL3,
      side: BackSide,
      transparent : true,
      depthWrite: false,
    	uniforms: {
    		map: { value : this.texture }
    	},
    	vertexShader: remove_comments(`
precision mediump float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec4 glPosition;

void main() {
  glPosition = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = glPosition;
  gl_Position.z = gl_Position.w;
}
      `),
      fragmentShader: remove_comments(`
precision mediump float;
precision mediump sampler2D;
uniform sampler2D map;
in vec4 glPosition;
out vec3 color;

// Converts a color from linear light gamma to sRGB gamma
vec4 fromLinear(vec4 linearRGB)
{
    bvec3 cutoff = lessThan(linearRGB.rgb, vec3(0.0031308));
    vec3 higher = vec3(1.055)*pow(linearRGB.rgb, vec3(1.0/2.4)) - vec3(0.055);
    vec3 lower = linearRGB.rgb * vec3(12.92);

    return vec4(mix(higher, lower, cutoff), linearRGB.a);
}

// Converts a color from sRGB gamma to linear light gamma
vec4 toLinear(vec4 sRGB)
{
    bvec3 cutoff = lessThan(sRGB.rgb, vec3(0.04045));
    vec3 higher = pow((sRGB.rgb + vec3(0.055))/vec3(1.055), vec3(2.4));
    vec3 lower = sRGB.rgb/vec3(12.92);

    return vec4(mix(higher, lower, cutoff), sRGB.a);
}

void main() {

  vec2 ndcPosition = vec2( glPosition.x , - glPosition.y ) / glPosition.w * 0.5 + 0.5;

  color.rgb = fromLinear( texture( map , ndcPosition ) ).rgb;
  gl_FragDepth = gl_DepthRange.far;

}

    	`),

    } );

    this.object = new Mesh( this.geometry, this.material );

    this.camera.add( this.object );
  }

  update() {
    this.texture.needsUpdate = true;
  }
}

export { CanvasOverlay2D };
