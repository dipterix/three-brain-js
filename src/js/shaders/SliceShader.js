import { Vector3, Matrix4, DataTexture, RawShaderMaterial, GLSL3, DoubleSide, UniformsUtils } from 'three';
import { CONSTANTS } from '../core/constants.js';
import { remove_comments } from '../utils.js';

const SliceShader = {
  uniforms : {

    // volume data
    map : { value : null },
    // volume dimension
    mapShape : { value : new Vector3().set( 256, 256, 256 ) },

    // transform matrix from world to volume IJK
    world2IJK : { value : new Matrix4().set(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },

    // Mask
    maskMap: { value : null },
    maskShape: { value : new Vector3().set( 256, 256, 256 ) },
    mask2IJK: { value : new Matrix4().set(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },


    // values below this threshold should be discarded
    threshold : { value : 0.0 },

    // overlay
    overlayMap : { value : null },
    overlayShape : { value : new Vector3().set( 256, 256, 256 ) },
    overlay2IJK: { value : new Matrix4().set(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },
    overlayAlpha: { value : 0.5 },

    colorRampPalette: { value: new DataTexture( new Uint8Array( 4 ) , 1, 1 ) },
    overlayValueLB: { value : 0.0 },
    overlayValueUB: { value : 1.0 },

    // correction
    brightness : { value : 1.0 },
    contrast : { value : 0.0 },

    allowDiscard: { value : 1 },

  },

  vertexShader: remove_comments(`precision highp float;
in vec3 position;

uniform vec3 mapShape;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 world2IJK;

out vec3 underlaySampPos;

#if defined( USE_MASK )

  uniform vec3 maskShape;
  uniform mat4 mask2IJK;
  out vec3 maskSampPos;

#endif

#if defined( USE_OVERLAY ) && defined( HAS_OVERLAY )

  in vec3 normal;

  uniform vec3 overlayShape;
  uniform mat4 overlay2IJK;

  out vec3 overlaySampPos;
  out vec3 overlaySamplerOffsetXInIJK;
  out vec3 overlaySamplerOffsetYInIJK;

#endif


float min3 (vec3 v) {
  return min (min (v.x, v.y), v.z);
}

vec3 safeNormalize(vec3 v){
  float L=length(v);
  return L>1e-8 ? v/L : vec3(0.0);
}

void main() {
  // obtain the world position for vertex
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );

  vec3 denomMap = max(mapShape - 1.0, vec3(1.0));
  underlaySampPos = ((world2IJK * worldPosition).xyz) / denomMap;

  #if defined( USE_MASK )

    vec3 denomMaskInv = 1.0 / max(maskShape - 1.0, vec3(1.0));
    maskSampPos = ((mask2IJK * worldPosition).xyz) * denomMaskInv;

  #endif

  #if defined( USE_OVERLAY ) && defined( HAS_OVERLAY )

    vec3 denomOverlayInv = 1.0 / max(overlayShape - 1.0, vec3(1.0));
    overlaySampPos = ((overlay2IJK * worldPosition).xyz) * denomOverlayInv;

    if( abs( normal.z ) >= 0.5 ) {
      overlaySamplerOffsetXInIJK = vec3(1.0, 0.0, 0.0);
      overlaySamplerOffsetYInIJK = vec3(0.0, 1.0, 0.0);
    } else if( abs( normal.y ) >= 0.5 ) {
      overlaySamplerOffsetXInIJK = vec3(1.0, 0.0, 0.0);
      overlaySamplerOffsetYInIJK = vec3(0.0, 0.0, 1.0);
    } else {
      overlaySamplerOffsetXInIJK = vec3(0.0, 1.0, 0.0);
      overlaySamplerOffsetYInIJK = vec3(0.0, 0.0, 1.0);
    }

    overlaySamplerOffsetXInIJK = (
      overlay2IJK * modelMatrix * vec4( overlaySamplerOffsetXInIJK, 0.0 )
    ).xyz;
    overlaySamplerOffsetYInIJK = (
      overlay2IJK * modelMatrix * vec4( overlaySamplerOffsetYInIJK, 0.0 )
    ).xyz;

    float maxOverlayMarginInv = min3(denomOverlayInv);

    overlaySamplerOffsetXInIJK = safeNormalize(overlaySamplerOffsetXInIJK) * maxOverlayMarginInv;
    overlaySamplerOffsetYInIJK = safeNormalize(overlaySamplerOffsetYInIJK) * maxOverlayMarginInv;

  #endif

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}`),
  fragmentShader: remove_comments(`precision highp float;
precision mediump sampler2D;
precision mediump sampler3D;

in vec3 underlaySampPos;

uniform float threshold;
uniform float brightness;
uniform float contrast;
uniform sampler3D map;
uniform float allowDiscard;
uniform vec3 mapShape;

#if defined( USE_MASK )

  in vec3 maskSampPos;
  uniform sampler3D maskMap;

#endif

#if defined( USE_OVERLAY ) && defined( HAS_OVERLAY )

  in vec3 overlaySampPos;
  in vec3 overlaySamplerOffsetXInIJK;
  in vec3 overlaySamplerOffsetYInIJK;

  uniform sampler3D overlayMap;
  uniform float overlayAlpha;
  uniform vec3 overlayShape;

#endif

#if defined( OVERLAY_N_SINGLE_CHANNEL_COLORS )

  uniform sampler2D colorRampPalette;
  uniform float overlayValueLB;
  uniform float overlayValueUB;

#endif

vec3 roundToSubPixel(vec3 p, vec3 resolution, float pixelRatio) {

  vec3 superResolution = resolution * pixelRatio;

  return round(p * superResolution) / (superResolution);

}


out vec4 color;
void main() {
// calculate IJK, then sampler position

  if( any(greaterThan( underlaySampPos, vec3(1.0) )) || any( lessThan(underlaySampPos, vec3(0.0)) ) ) {
    discard;
  } else {

    // super-resolution by 2 and nearest sampler
    float underlayIntensity = texture(map, roundToSubPixel(underlaySampPos, mapShape, 4.0) ).r;
    float overlayIntensity = 0.0;
    color.r = underlayIntensity;

    color.a = 1.0;

    if( abs( contrast ) > 0.03 ) {
      color.r = ( exp( contrast * color.r * 10.0 ) - 1.0 ) / ( exp( contrast * 10.0 ) - 1.0 );
    }
    color.r *= 1.15 / (1.15 - min( brightness , 1.0 ) );

    color.rgb =  color.rrr;

    #if defined( USE_OVERLAY ) && defined( HAS_OVERLAY )

      // vec3 overlaySampPos = ((overlay2IJK * worldPosition).xyz) / (overlayShape - 1.0);

      // Clamp to border not edge
      if(
        all( greaterThanEqual( overlaySampPos, vec3(0.0) ) ) &&
        all( lessThanEqual( overlaySampPos, vec3(1.0) ) )
      ) {

        // Binned super-sampled position
        vec3 overlaySampPosInBin = roundToSubPixel(overlaySampPos, overlayShape, 4.0);
        vec4 overlayColor = texture(overlayMap, overlaySampPosInBin).rgba;

        #if defined( OVERLAY_N_SINGLE_CHANNEL_COLORS )

          if( overlayColor.r > 0.0 ) {

            // using red channel as the color intensity
            float nColors = float( OVERLAY_N_SINGLE_CHANNEL_COLORS );
            if ( nColors < 1.0 ) {
              nColors = 1.0;
            }

            overlayIntensity = overlayColor.r;

            if( overlayValueUB - overlayValueLB > 0.00001 ) {
              overlayIntensity = (overlayIntensity - overlayValueLB) / (overlayValueUB - overlayValueLB);
            }

            overlayIntensity = clamp( overlayIntensity , 0.0 , 1.0 );

            overlayIntensity = ( overlayIntensity * ( nColors - 1.0 ) + 0.5 ) / nColors;

            overlayColor.rgb = texture( colorRampPalette , vec2( overlayIntensity , 0.5 ) ).rgb;

          }

        #else

          if( overlayColor.a > 0.0 && any(greaterThan( overlayColor.rgb, vec3(0.0) )) ) {

            overlayIntensity = 1.0;

          }

          if( overlayAlpha <= 0.0 ) {

            vec4 overlayPXColor = texture(overlayMap, roundToSubPixel(
              overlaySampPosInBin + 0.25 * overlaySamplerOffsetXInIJK,
              overlayShape, 4.0
            ));
            vec4 overlayNXColor = texture(overlayMap, roundToSubPixel(
              overlaySampPosInBin - 0.25 * overlaySamplerOffsetXInIJK,
              overlayShape, 4.0
            ));
            vec4 overlayPYColor = texture(overlayMap, roundToSubPixel(
              overlaySampPosInBin + 0.25 * overlaySamplerOffsetYInIJK,
              overlayShape, 4.0
            ));
            vec4 overlayNYColor = texture(overlayMap, roundToSubPixel(
              overlaySampPosInBin - 0.25 * overlaySamplerOffsetYInIJK,
              overlayShape, 4.0
            ));

            bool samePX = all(equal(overlayPXColor, overlayColor));
            bool sameNX = all(equal(overlayNXColor, overlayColor));
            bool samePY = all(equal(overlayPYColor, overlayColor));
            bool sameNY = all(equal(overlayNYColor, overlayColor));

            if (samePX && sameNX && samePY && sameNY) {

              overlayColor.a = 0.0;

            }
          }

        #endif

        if( overlayColor.a > 0.0 && any(greaterThan( overlayColor.rgb, vec3(0.0) )) ) {
          if( overlayAlpha < 0.0 ) {
            color.rgb = overlayColor.rgb;
          } else {
            color.rgb = mix( color.rgb, overlayColor.rgb, overlayAlpha * overlayColor.a );
          }
        }
      }



    #endif

    // check if mask is used
    #if defined( USE_MASK )

      vec3 mpos = clamp(maskSampPos, 0.0, 1.0);

      if(
        threshold > 0.0 &&
        underlayIntensity < threshold &&
        overlayIntensity < threshold &&
        texture( maskMap, mpos ).r == 0.0
      ) {

        discard;

      }

    #endif

  }
}`)
}


class SliceMaterial extends RawShaderMaterial {

  constructor( parameters ) {

    const param2 = {
      'glslVersion' : GLSL3,
      'vertexShader' : SliceShader.vertexShader,
      'fragmentShader' : SliceShader.fragmentShader,
      'side' : parameters.side ?? DoubleSide,
      'transparent' : parameters.transparent ?? false,
      'depthWrite' : parameters.depthWrite ?? true,

    }
    const uniforms = UniformsUtils.clone( SliceShader.uniforms );
    param2.uniforms = uniforms;

    if( parameters.uniforms ) {
      for(let k in parameters.uniforms) {
        uniforms[ k ] = { value : parameters.uniforms[k].value };
      }
    }

    super( param2 );

    if( uniforms.maskMap.value ) {
      this.defines.USE_MASK = "";
      this.needsUpdate = true;
    }

  }

  // overlayAlpha
  set overlayAlpha( v ) {
    if( typeof v !== 'number' ) { return; }
    this.uniforms.overlayAlpha.value = v;
  }

  get overlayAlpha() {
    return this.uniforms.overlayAlpha.value;
  }

  // overlayValueLB
  set overlayValueLB( v ) {
    if( typeof v !== 'number' ) { return; }
    this.uniforms.overlayValueLB.value = v;
  }

  get overlayValueLB() {
    return this.uniforms.overlayValueLB.value;
  }

  // overlayValueUB
  set overlayValueUB( v ) {
    if( typeof v !== 'number' ) { return; }
    this.uniforms.overlayValueUB.value = v;
  }

  get overlayValueUB() {
    return this.uniforms.overlayValueUB.value;
  }

  // underlayContrast
  set underlayContrast( v ) {
    if( typeof v !== "number" ) { return; }
    this.uniforms.contrast.value = v;
  }

  get underlayContrast() {
    return this.uniforms.contrast.value;
  }

  // underlayBrightness
  set underlayBrightness( v ) {
    if( typeof v !== "number" ) { return; }
    this.uniforms.brightness.value = v;
  }

  get underlayBrightness() {
    return this.uniforms.brightness.value;
  }

  set underlayMap( v ) {
    this.uniforms.map.value = v;
  }

  get underlayMap() {
    return this.uniforms.map.value;
  }

  get underlayShape() {
    return this.uniforms.mapShape.value;
  }

  get world2UnderlayVoxel() {
    return this.uniforms.world2IJK.value;
  }

  set zeroThreshold ( v ) {
    if( typeof v !== "number" ) { return; }
    this.uniforms.threshold.value = v;
  }

  get zeroThreshold() {
    return this.uniforms.threshold.value;
  }

  // event handlers
  _setOverlayColorChangeHandler = ( event ) => {
    if( !this._overlay ) { return; }
    if( this._overlay.name !== event.instanceName ) { return; }
    this.setOverlay( this._overlay );
  };

  // Methods

  // set/remove overlay
  removeOverlay = () => {
    this.uniforms.overlayMap = { value : null };
    this.uniforms.colorRampPalette = { value : SliceShader.uniforms.colorRampPalette.value };

    if( this.defines.HAS_OVERLAY !== undefined ) {
      delete this.defines.HAS_OVERLAY;
      this.needsUpdate = true;
    }
    if( this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS !== undefined ) {
      delete this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS;
      this.needsUpdate = true;
    }

    if( this._overlay ) {
      try {
        this._overlay.removeEventListener(
          CONSTANTS.EVENTS.onDataCube2ColorUpdated,
          this._setOverlayColorChangeHandler
        );
        this._overlay.removeEventListener(
          CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
          this.removeOverlay
        );
      } catch (e) {
        console.warn(e);
      }
      this.needsUpdate = true;
    }
  }

  setOverlay( inst ) {

    // const inst = getThreeBrainInstance( x );
    if( !inst || !( inst.isDataCube2 || inst.isDataCube ) ) {
      this.removeOverlay();
      return;
    }

    if( this._overlay !== inst ) {
      this.removeOverlay();
      this._overlay = inst;
    }

    if( typeof this.defines.HAS_OVERLAY !== "string" ) {
      this.defines.HAS_OVERLAY = "";
      this.needsUpdate = true;
    }


    if( inst.isDataCube2 ) {

      const thatUniforms = inst.object.material.uniforms;

      if ( inst.isDataContinuous ) {

        const nColors = inst.object.material.defines.N_SINGLE_CHANNEL_COLORS;

        if ( this.uniforms.colorRampPalette !== thatUniforms.colorRampPalette ) {
          this.uniforms.colorRampPalette = thatUniforms.colorRampPalette;
          this.needsUpdate = true;
        }

        this.overlayValueLB = thatUniforms.singleChannelColorRangeLB.value;
        this.overlayValueUB = thatUniforms.singleChannelColorRangeUB.value;

        if( nColors !== this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS ) {
          this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS = nColors;
          this.needsUpdate = true;
        }

      } else if( this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS !== undefined ) {
        delete this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS;
        this.needsUpdate = true;
      }

      if( this.uniforms.overlayMap !== thatUniforms.cmap ) {
        this.uniforms.overlayMap = thatUniforms.cmap;
        this.needsUpdate = true;
      }
      this.uniforms.overlayShape.value.copy( inst.modelShape );

      // inst._transform is model to world
      this.uniforms.overlay2IJK.value.copy( inst._transform ).invert()
        .premultiply( inst.model2vox );

    } else if( inst.isDataCube ) {

      if( this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS !== undefined ) {
        delete this.defines.OVERLAY_N_SINGLE_CHANNEL_COLORS;
        this.needsUpdate = true;
      }

      if( this.uniforms.overlayMap != inst.uniforms.map ) {
        this.uniforms.overlayMap = inst.uniforms.map;
        this.needsUpdate = true;
      }

      this.uniforms.overlayShape.value.copy( inst.uniforms.mapShape );
      this.uniforms.overlay2IJK.value.copy( inst.uniforms.world2IJK.value );

    }

    if(
      !inst.hasEventListener(
        CONSTANTS.EVENTS.onDataCube2ColorUpdated,
        this._setOverlayColorChangeHandler
      )
    ) {
      inst.addEventListener(
        CONSTANTS.EVENTS.onDataCube2ColorUpdated,
        this._setOverlayColorChangeHandler
      );
    }

    if(
      !inst.hasEventListener(
        CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
        this.removeOverlay
      )
    ) {
      inst.addEventListener(
        CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
        this.removeOverlay
      );
    }

  }

}

export { SliceShader, SliceMaterial };
