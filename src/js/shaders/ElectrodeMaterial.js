import { MeshBasicMaterial, Vector3 } from 'three';
import { remove_comments } from '../utils.js';


class ElectrodeMaterial extends MeshBasicMaterial {

  constructor( parameters ) {
    super( parameters );

    /**
     * Defines:
     * USE_OUTLINE
     * USE_DATATEXTURE
     */
    this.uniforms = {
      outlineThreshold  : { value : 0 },
      dataTexture       : { value : null },
      darken            : { value : 0 },

      // model direction for calculating outlines
      tangent           : { value : new Vector3() },

      // max length along the trajectory to show,
      // `tangent` must be set
      // -Inf ~ -0: show all
      // 0 ~ l: show max of l
      maxLength         : { value : -1 },
    }

    this.defines = {};


  }

  useOutline( outlineThreshold ) {
    if( outlineThreshold > 0.01 ) {
      this.uniforms.outlineThreshold.value = outlineThreshold;
      if( this.defines.USE_OUTLINE === undefined ) {
        this.defines.USE_OUTLINE = "";
        this.needsUpdate = true;
      }
    } else {
      if( this.defines.USE_OUTLINE !== undefined ) {
        delete this.defines.USE_OUTLINE;
        this.needsUpdate = true;
      }
    }
  }

  setTranslucent( level ) {
    // level = 0 or false: nothing is translucent, depth=always
    // level = 1 or true: contact is translucent, outline depth = always
    // level = 2: depth = always for all
    if( level === 0 || level === false ) {
      if( this.defines.ALWAYS_DEPTH === undefined ) {
        this.defines.ALWAYS_DEPTH = "";
        this.needsUpdate = true;
      }
      return;
    }

    if( this.defines.ALWAYS_DEPTH === "" ) {
      delete this.defines.ALWAYS_DEPTH;
      this.needsUpdate = true;
    }

    if( level === 1 || level === true ) {
      // outline is always at the front
      if( this.defines.OUTLINE_ALWAYS_DEPTH === undefined ) {
        this.defines.OUTLINE_ALWAYS_DEPTH = "";
        this.needsUpdate = true;
      }
      return;
    }

    if( this.defines.OUTLINE_ALWAYS_DEPTH === "" ) {
      delete this.defines.OUTLINE_ALWAYS_DEPTH;
      this.needsUpdate = true;
    }

  }

  setMaxRenderLength( len ) {
    if( typeof len !== "number" ) { return; }

    if( !isFinite(len) || len <= 0 ) {
      len = -1;
    }

    if( this.uniforms.maxLength.value != len ) {
      this.uniforms.maxLength.value = len;
    }
  }

  setModelDirection( dir ) {
    this.uniforms.tangent.value.copy( dir ).normalize();
  }

  useDataTexture( texture, enabled = true ) {
    const previousTexture = this.uniforms.dataTexture.value;
    if( texture ) {
      this.uniforms.dataTexture.value = texture;
    } else {
      this.uniforms.dataTexture.value = null;
      enabled = false;
    }

    if( previousTexture !== texture ) {
      if( texture ) {
        this.uniforms.dataTexture.value = texture;
      } else {
        this.uniforms.dataTexture.value = null;
        enabled = false;
      }
      if( previousTexture ) {
        previousTexture.dispose();
      }
    } else if( !texture ) {
      enabled = false;
    }

    if( enabled ) {
      if( this.defines.USE_DATATEXTURE === undefined ) {
        this.defines.USE_DATATEXTURE = "";
        this.needsUpdate = true;
      }
    } else {
      if( this.defines.USE_DATATEXTURE !== undefined ) {
        delete this.defines.USE_DATATEXTURE;
        this.needsUpdate = true;
      }
    }
  }

  onBeforeCompile ( shader, renderer ) {
    this._shader = shader;
    for( let uniformKey in this.uniforms ) {
      shader.uniforms[ uniformKey ] = this.uniforms[ uniformKey ];
    }

    // vertexShader par vars
    shader.vertexShader = remove_comments(`

uniform vec3 tangent;
varying float reflectProd;

#if defined( USE_DATATEXTURE )

  varying vec2 vUv;
  varying float positionAlongTrjectory;

#endif
    `) + shader.vertexShader;

    // vertexShader body
    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      remove_comments(
`#include <fog_vertex>

#if defined( USE_DATATEXTURE )

  vUv = uv;

#endif


mat4 pmv = projectionMatrix * modelViewMatrix;

// Orthopgraphic camera, camera position in theory is at infinite,

// Ideally the following calculation should generate correct results
// vOrigin will be interpolated in fragmentShader, hence project and unproject
vec4 vOriginProjected = pmv * vec4( position, 1.0 );
vOriginProjected.z = -vOriginProjected.w;
vec3 vOrigin = (inverse(pmv) * vOriginProjected).xyz;

// cameraRay is in model
vec3 cameraRay = position.xyz - vOrigin.xyz;

if( length(tangent) > 0.5 ) {
  cameraRay = cameraRay - tangent * dot( cameraRay, tangent );

#if defined( USE_DATATEXTURE )

  positionAlongTrjectory = dot( position, tangent );

} else {
  positionAlongTrjectory = 0.0;

#endif
}


reflectProd = abs( dot( normalize( normal ), normalize( cameraRay ) ) );

`)
    );

    // fragmentShader par vars
    shader.fragmentShader = remove_comments(`
#if defined( USE_OUTLINE )

  uniform float outlineThreshold;

#endif

uniform float darken;
varying float reflectProd;


#if defined( USE_DATATEXTURE )

  uniform mediump sampler2D dataTexture;
  uniform float maxLength;
  varying float positionAlongTrjectory;
  varying vec2 vUv;

#endif

    `) + shader.fragmentShader;

    // fragmentShader body
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      remove_comments(
`
#if defined( USE_DATATEXTURE )

  vec4 dColor = texture( dataTexture, vUv ).rgba;
  diffuseColor.rgb *= dColor.rgb;
  diffuseColor.a *= dColor.a;

  if( any( greaterThan( vUv , vec2(1.0001) ) ) || any( lessThan( vUv , vec2(-0.0001) ) ) ) {
    diffuseColor.rgb = vec3( 0.0 );

    if( maxLength > 0.0 && abs( positionAlongTrjectory ) > maxLength ) {
      diffuseColor.a = 0.0;
    } else {
      diffuseColor.a = 0.15;
    }
  }

#else

  #include <color_fragment>

#endif

diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.0 ), ( 1.0 - reflectProd ) * darken );

float fDepth = gl_FragCoord.z;

#if defined( USE_OUTLINE )

  #if defined ( ALWAYS_DEPTH )

    fDepth = gl_DepthRange.near;

  #elif defined ( OUTLINE_ALWAYS_DEPTH )

    fDepth = gl_FragCoord.z;

  #endif

  if( outlineThreshold > 0.001 && reflectProd < outlineThreshold ) {
    diffuseColor.rgb = vec3( 0.0 );

    #if defined ( ALWAYS_DEPTH ) || defined ( OUTLINE_ALWAYS_DEPTH )

      fDepth = gl_DepthRange.near;

    #endif
  }

#else

  #if defined ( ALWAYS_DEPTH )

    fDepth = gl_DepthRange.near;

  #else

    fDepth = gl_FragCoord.z;

  #endif


#endif

if( diffuseColor.a <= 0.0001 ) {

  // Hide the fragment if alpha is 0 (reaching maxLength)
  gl_FragDepth = gl_DepthRange.far;

} else {

  // It's important to set this because gl_FragDepth does not automatically
  // reset to gl_FragCoord.z
  gl_FragDepth = fDepth;
}

      `)
    );

  }

}


export { ElectrodeMaterial };
