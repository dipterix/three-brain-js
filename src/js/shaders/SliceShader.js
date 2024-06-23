import { Vector3, Matrix4 } from 'three';
import { remove_comments } from '../utils.js';

const SliceShader = {
  uniforms : {

    // volume data
    map : { value : null },
    mapMask: { value : null },

    // volume dimension
    mapShape : { value : new Vector3().set( 256, 256, 256 ) },

    // transform matrix from world to volume IJK
    world2IJK : { value : new Matrix4().set(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },

    // values below this threshold should be discarded
    threshold : { value : 0.0 },

    // overlay
    overlayMap : { value : null },
    overlayShape : { value : new Vector3().set( 256, 256, 256 ) },
    overlay2IJK: { value : new Matrix4().set(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },
    overlayAlpha: { value : 0.5 },

    overlayColorsWhenSingleChannel: { value : [] },
    overlayValueLB: { value : 0.0 },
    overlayValueUB: { value : 1.0 },

    // correction
    brightness : { value : 1.0 },
    contrast : { value : 0.0 },

    allowDiscard: { value : 1 },

  },

  vertexShader: remove_comments(`precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec4 worldPosition;

void main() {
  // obtain the world position for vertex
  worldPosition = modelMatrix * vec4( position, 1.0 );

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}`),
  fragmentShader: remove_comments(`precision highp float;
precision mediump sampler3D;
in vec4 worldPosition;
uniform float threshold;
uniform float brightness;
uniform float contrast;
uniform sampler3D map;
uniform sampler3D mapMask;
uniform vec3 mapShape;
uniform mat4 world2IJK;
uniform float allowDiscard;

#if defined( USE_OVERLAY ) && defined( HAS_OVERLAY )

  uniform sampler3D overlayMap;
  uniform vec3 overlayShape;
  uniform mat4 overlay2IJK;
  uniform float overlayAlpha;

#endif

#if defined( OVERLAY_N_SINGLE_CHANNEL_COLORS )

  uniform vec3 overlayColorsWhenSingleChannel[ OVERLAY_N_SINGLE_CHANNEL_COLORS ];
  uniform float overlayValueLB;
  uniform float overlayValueUB;

#endif

out vec4 color;
void main() {
// calculate IJK, then sampler position

  vec3 samplerPosition = ((world2IJK * worldPosition).xyz) / (mapShape - 1.0);
  if( any(greaterThan( samplerPosition, vec3(1.0) )) || any( lessThan(samplerPosition, vec3(0.0)) ) ) {
    gl_FragDepth = gl_DepthRange.far;
    color.rgba = vec4(0.0);

    if( allowDiscard > 0.5 ) {
      discard;
    }
  } else {
    color.r = texture(map, samplerPosition).r;
    if( color.r <= threshold && texture( mapMask, samplerPosition ).r < 0.5 ) {
      color.rgba = vec4(0.0);
      gl_FragDepth = gl_DepthRange.far;
      if( allowDiscard > 0.5 ) {
        discard;
      }
    } else {
      gl_FragDepth = gl_FragCoord.z;
      color.a = 1.0;

      if( abs( contrast ) > 0.03 ) {
        color.r = ( exp( contrast * color.r * 10.0 ) - 1.0 ) / ( exp( contrast * 10.0 ) - 1.0 );
      }
      color.r *= 1.15 / (1.15 - min( brightness , 1.0 ) );

      color.rgb =  color.rrr;

      #if defined( USE_OVERLAY ) && defined( HAS_OVERLAY )

        vec3 overlaySampPos = ((overlay2IJK * worldPosition).xyz) / (overlayShape - 1.0);

        // Clamp to border not edge
        if( all( greaterThan( overlaySampPos, vec3(-0.00001) ) ) && all( lessThan( overlaySampPos, vec3(1.00001) ) ) ) {

          vec4 overlayColor = texture(overlayMap, overlaySampPos).rgba;

          #if defined( OVERLAY_N_SINGLE_CHANNEL_COLORS )

            // using red channel as the color intensity
            int nColors = int( OVERLAY_N_SINGLE_CHANNEL_COLORS );

            if( overlayColor.r > 0.0 && nColors > 0 ) {

              float nColorMinusOne = float( OVERLAY_N_SINGLE_CHANNEL_COLORS ) - 1.0;
              float intensity = overlayColor.r - overlayValueLB;

              if( overlayValueUB - overlayValueLB > 0.00001 ) {
                intensity = intensity / (overlayValueUB - overlayValueLB);
              }

              intensity = clamp( intensity , 0.0 , 1.0 ) * nColorMinusOne;

              float colorIndex = floor( intensity );
              int colorIndex_d = int( colorIndex );

              if( colorIndex >= nColorMinusOne ) {

                overlayColor.rgb = overlayColorsWhenSingleChannel[ nColors - 1 ];

              } else if ( colorIndex < 0.0 ) {

                overlayColor.rgb = overlayColorsWhenSingleChannel[ 0 ];

              } else {

                intensity -= colorIndex;

                overlayColor.rgb = overlayColorsWhenSingleChannel[ colorIndex_d ] * (1.0 - intensity) + overlayColorsWhenSingleChannel[ colorIndex_d + 1 ] * intensity;

              }

            }

          #endif

          if( overlayColor.a > 0.0 ) {
            if( any(greaterThan( overlayColor.rgb, vec3(0.0) )) ) {
              if( overlayAlpha < 0.0 ) {
                color.rgb = overlayColor.rgb;
              } else {
                color.rgb = mix( color.rgb, overlayColor.rgb, overlayAlpha * overlayColor.a );
              }
            }
          }

        }



      #endif

    }
  }
}`)
}

export { SliceShader };
