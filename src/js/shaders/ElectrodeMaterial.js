import { MeshBasicMaterial } from 'three';
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
    shader.uniforms.outlineThreshold = this.uniforms.outlineThreshold;
    shader.uniforms.dataTexture = this.uniforms.dataTexture;

    // vertexShader par vars
    shader.vertexShader = remove_comments(`

varying float reflectProd;

#if defined( USE_DATATEXTURE )

  varying vec2 vUv;

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

vec3 cameraRay = normalize( position.xyz - vOrigin.xyz );

reflectProd = abs( dot( normalize( normal ), cameraRay ) );

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
    diffuseColor.a = 0.15;
  }

#else

  #include <color_fragment>

#endif

diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.0 ), ( 1.0 - reflectProd ) * darken );

#if defined( USE_OUTLINE )

  #if defined ( ALWAYS_DEPTH )

    gl_FragDepth = gl_DepthRange.near;

  #elif defined ( OUTLINE_ALWAYS_DEPTH )

    gl_FragDepth = gl_FragCoord.z;

  #endif

  if( outlineThreshold > 0.001 && reflectProd < outlineThreshold ) {
    diffuseColor.rgb = vec3( 0.0 );

    #if defined ( ALWAYS_DEPTH ) || defined ( OUTLINE_ALWAYS_DEPTH )

      gl_FragDepth = gl_DepthRange.near;

    #endif
  }

#endif
      `)
    );

  }

}


export { ElectrodeMaterial };
