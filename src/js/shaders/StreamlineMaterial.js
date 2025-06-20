import {
	ShaderLib,
	ShaderMaterial,
	UniformsLib,
	UniformsUtils,
	Vector2,
} from 'three';

UniformsLib.line = {

	linewidth: { value: 1 },
	shadowStrengh: { value: 0 },
	distanceThreshold: { value: -1 },
	resolution: { value: new Vector2( 1, 1 ) },

};

const StreamlineVertexShader = /* glsl */`
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

uniform float linewidth;
uniform vec2 resolution;
uniform float distanceThreshold;

attribute vec3 instanceStart;
attribute vec3 instanceEnd;

attribute vec3 instanceColorStart;
attribute vec3 instanceColorEnd;

attribute float streamlineDistance;

varying vec4 worldPos;
varying vec3 worldStart;
varying vec3 worldEnd;
varying vec3 worldUp;
// varying float lineLengthSq;

#ifdef USE_DISTANCE_THRESHOLD

  varying float vDistanceToCenter;

#endif

void main() {

	#ifdef USE_COLOR

		vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

	#endif

	float aspect = resolution.x / resolution.y;

	// For orthographic camera, ray direction is fixed and equals camera's -Z axis in world space.
  // You can get this by taking the view matrix's third row (inverse of camera rotation)
  // vec3 rayDir = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) * -1.0;
  // To operate in camera space, this is easier
  vec3 rayDir = vec3(0.0, 0.0, -1.0);
  rayDir = normalize( rayDir );

	// camera space
	vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
	vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

	worldStart = start.xyz;
	worldEnd = end.xyz;

	vec3 worldDirOrig = worldEnd - worldStart;

	// lineLengthSq = dot(worldDirOrig, worldDirOrig);

	vec3 worldDir = normalize( worldDirOrig );
	worldUp = cross( worldDir, rayDir );

	worldPos = position.y < 0.5 ? start: end;

	// height offset
	float hw = linewidth * 0.5;

	#ifdef USE_DISTANCE_THRESHOLD

	  vDistanceToCenter = streamlineDistance;

    if( distanceThreshold > 0.0 && distanceThreshold <= vDistanceToCenter ) {
      hw = 0.01;
    }

	#endif

	worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

	worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

	// add width to the box
	// worldPos.xyz += worldFwd * hw;

	// project the worldpos
	gl_Position = projectionMatrix * worldPos;

	vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>

}
`;

const StreamlineFragmentShader = /* glsl */`
uniform vec3 diffuse;
uniform float opacity;
uniform float linewidth;
uniform float shadowStrengh;
uniform float distanceThreshold;

varying vec4 worldPos;
varying vec3 worldStart;
varying vec3 worldEnd;
varying vec3 worldUp;
// varying float lineLengthSq;

#ifdef USE_DISTANCE_THRESHOLD

  varying float vDistanceToCenter;

#endif

// out vec4 color;

#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

void main() {

  // if( lineLengthSq < 1e-8 ) { discard; }

	#include <clipping_planes_fragment>

	float alpha = opacity;
	float shade = 1.0;

	// Find the closest points on the view ray and the line segment
	vec3 lineDir = worldEnd - worldStart;
	vec3 lineDirUnit = normalize(lineDir);

	vec3 p1 = worldStart + lineDirUnit * dot( worldPos.xyz - worldStart, lineDirUnit );
	vec3 delta = worldPos.xyz - p1;
	delta.z = 0.0;

	float len = length( delta );
	float norm = len / linewidth;

	// Only apply shading to the sides (not endcaps/joints)
	// Check if we're on the main body of the line (not endcaps)
	float interpMax = 1.2;
	if( shadowStrengh < 0.2 ) {
	  interpMax = 1.2 - shadowStrengh;
	}
	shade = 1.0 - smoothstep(0.0, interpMax, norm);

	#ifdef USE_DISTANCE_THRESHOLD

    if( distanceThreshold > 0.0 && distanceThreshold <= vDistanceToCenter ) {
      shade = 0.5;
    }

  #endif

	vec4 diffuseColor = vec4( diffuse * shade, alpha );

	#include <logdepthbuf_fragment>
	#include <color_fragment>

	gl_FragColor = vec4( diffuseColor.rgb, alpha );
	// color = vec4( diffuseColor.rgb, alpha );

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>

}
`

ShaderLib[ 'streamline' ] = {

	uniforms: UniformsUtils.merge( [
		UniformsLib.common,
		UniformsLib.fog,
		UniformsLib.line
	] ),

	vertexShader: StreamlineVertexShader,
	fragmentShader: StreamlineFragmentShader

};


class StreamlineMaterial extends ShaderMaterial {

	constructor( parameters ) {

		super( {
			type: 'StreamLineMaterial',
			uniforms: UniformsUtils.clone( ShaderLib[ 'streamline' ].uniforms ),

			vertexShader: ShaderLib[ 'streamline' ].vertexShader,
			fragmentShader: ShaderLib[ 'streamline' ].fragmentShader,

			clipping: true // required for clipping support

		} );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isStreamLineMaterial = true;

		this.setValues( parameters );

	}

	get color() {

		return this.uniforms.diffuse.value;

	}

	set color( value ) {

		this.uniforms.diffuse.value = value;

	}

	get linewidth() {

		return this.uniforms.linewidth.value;

	}

	set linewidth( value ) {

		if ( ! this.uniforms.linewidth ) return;
		this.uniforms.linewidth.value = value;

	}

	get shadowStrengh() {
	  return this.uniforms.shadowStrengh.value;
	}

	set shadowStrengh( value ) {
	  if ( ! this.uniforms.shadowStrengh ) return;
		this.uniforms.shadowStrengh.value = value;
	}

	get distanceThreshold() {
	  if( this.defines.USE_DISTANCE_THRESHOLD === undefined ) {
	    return Infinity;
	  }
	  return this.uniforms.distanceThreshold.value;
	}

	set distanceThreshold( value ) {

	  if ( ! this.uniforms.distanceThreshold ) return;
	  if( value <= 0 || !isFinite( value ) ) {
	    this.uniforms.distanceThreshold.value = 0;
	    if( this.defines.USE_DISTANCE_THRESHOLD !== undefined ) {
	      delete this.defines.USE_DISTANCE_THRESHOLD;
	      this.needsUpdate = true;
	    }
	  } else {
	    if( this.defines.USE_DISTANCE_THRESHOLD === undefined ) {
	      this.defines.USE_DISTANCE_THRESHOLD = '';
	      this.needsUpdate = true;
	    }
	    this.uniforms.distanceThreshold.value = value;
	  }
	}

  get stride() {

    if( this.defines.USE_STRIDE === '' ) {
      return this.uniforms.strideLineId.value;
    } else {
      return 1;
    }

  }

  set stride( value ) {

    if( value <= 1 ) {
      value = 1;
    }


    if ( value === 1 ) {
      if( this.defines.USE_STRIDE !== undefined ) {
        delete this.defines.USE_STRIDE;
        this.needsUpdate = true;
      }
    } else {
      if( this.defines.USE_STRIDE !== '' ) {
        this.defines.USE_STRIDE = '';
        this.needsUpdate = true;
      }
      this.uniforms.strideLineId.value = value;
    }
  }

	get opacity() {

		return this.uniforms.opacity.value;

	}

	set opacity( value ) {

		if ( ! this.uniforms ) return;
		this.uniforms.opacity.value = value;

	}

	get resolution() {

		return this.uniforms.resolution.value;

	}

	set resolution( value ) {

		this.uniforms.resolution.value.copy( value );

	}

	get alphaToCoverage() {

		return 'USE_ALPHA_TO_COVERAGE' in this.defines;

	}

	set alphaToCoverage( value ) {

		if ( ! this.defines ) return;

		if ( ( value === true ) !== this.alphaToCoverage ) {

			this.needsUpdate = true;

		}

		if ( value === true ) {

			this.defines.USE_ALPHA_TO_COVERAGE = '';

		} else {

			delete this.defines.USE_ALPHA_TO_COVERAGE;

		}

	}

}

export { StreamlineMaterial };
