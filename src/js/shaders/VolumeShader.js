import {
  Vector2, Vector3, Color, UniformsLib, UniformsUtils, RawShaderMaterial,
  BackSide, GLSL3, DataTexture
} from 'three';
import { remove_comments } from '../utils.js';
import { Lut } from '../core/CustomLut.js'
import { createMatCapTexture, MatCapPresets } from '../utils/createMatCapTexture.js';

const matcapClay = MatCapPresets.clay();

class RayMarchingMaterial extends RawShaderMaterial {

  constructor({
    cmap,
    cmapShape,
    gradientMap = null,
    colorChannels = 4,
    colorMap = "viridis",
    nColors = 32,
    ...parameters
  } = {}) {

    if( typeof parameters.uniforms !== "object" ) {
      parameters.uniforms = {}
    }

    parameters.uniforms.cmap = { value: cmap };
    parameters.uniforms.gradientMap = { value: gradientMap };
    parameters.uniforms.alpha = { value: -1.0 };
    // colorChannels converted to define for compile-time optimization
    // parameters.uniforms.colorChannels = { value: colorChannels };
    // steps: { value: 300 },
    parameters.uniforms.scale_inv = { value: new Vector3().set(
      1 / cmapShape.x, 1 / cmapShape.y, 1 / cmapShape.z
    ) };
    parameters.uniforms.bounding = { value : 0.5 };
    parameters.uniforms.stepSize = { value : 1.0 };
    // dithering converted to define for compile-time optimization
    parameters.uniforms.maxRenderDistance = { value : 1000.0 };
    parameters.uniforms.fastPassMultiplier = { value : 1.5 };
    parameters.uniforms.gradientOpacityPower = { value : 0.6 };
    parameters.uniforms.matCapTexture = { value : matcapClay };
    parameters.uniforms.matCapIntensity = { value : 0.5 };
    // only works when number of color channels is 1 for converting numeric to color
    // create nColors
    const keyColors = new Uint8Array( 4 * nColors );
    parameters.uniforms.colorRampPalette = { value: new DataTexture( keyColors, nColors, 1 ) };
    parameters.uniforms.colorRampPalette.value.needsUpdate = true;

    parameters.uniforms.singleChannelColorRangeLB = { value: 0.0 };
    parameters.uniforms.singleChannelColorRangeUB = { value: 1.0 };


    let useSingleChannel = false;

    let colorLUT = new Lut( colorMap , nColors );
    colorLUT.minV = 0;
    colorLUT.maxV = nColors - 1;

    if( colorChannels == 1 ) {
      useSingleChannel = true;
      for( let ii = 0; ii < nColors; ii++ ) {
        const keyColor = colorLUT.getColor( ii );
        keyColors[ ii * 4 ] = keyColor.r * 255;
        keyColors[ ii * 4 + 1 ] = keyColor.g * 255;
        keyColors[ ii * 4 + 2 ] = keyColor.b * 255;
        keyColors[ ii * 4 + 3 ] = keyColor.a * 255;
      }
      if( typeof parameters.defines !== "object" ) {
        parameters.defines = {
          SINGLE_CHANNEL : 1,
          N_SINGLE_CHANNEL_COLORS : nColors
        };
      } else {
        parameters.defines.SINGLE_CHANNEL = 1;
        parameters.defines.N_SINGLE_CHANNEL_COLORS = nColors;
      }
    } else {
      if( typeof parameters.defines !== "object" ) {
        parameters.defines = {
          N_SINGLE_CHANNEL_COLORS : 1
        };
      } else {
        parameters.defines.N_SINGLE_CHANNEL_COLORS = 1;
      }
    }
    
    // Add gradient map flag
    if( gradientMap !== null ) {
      parameters.defines.USE_GRADIENT_MAP = 1;
    }

    // Add dithering flag (default enabled)
    parameters.defines.USE_DITHERING = 1;

    // The volume shader uses the backface as its "reference point"
    parameters.side = BackSide;
    parameters.transparent = true;

    parameters.vertexShader = remove_comments(`
precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform vec3 scale_inv;
// uniform float steps;
uniform float bounding;
// uniform vec2 camera_center;

out mat4 pmv;
out mat4 mv;
out vec3 vOrigin;
// out vec3 vDirection;
out vec3 vPosition;
// out vec3 vSamplerBias;


void main() {
  mv = modelViewMatrix;
  pmv = projectionMatrix * modelViewMatrix;

  vPosition = position;

  gl_Position = pmv * vec4( position, 1.0 );

  // For perspective camera, vorigin is camera
  // vec4 vorig = inverse( modelMatrix ) * vec4( cameraPosition, 1.0 );
  // vOrigin = - vorig.xyz * scale_inv;
  // vDirection = position * scale_inv - vOrigin;

  // Orthopgraphic camera, camera position in theory is at infinite,

  // Ideally the following calculation should generate correct results
  // vOrigin will be interpolated in fragmentShader, hence project and unproject
  vec4 vOriginProjected = gl_Position;
  vOriginProjected.z = -vOriginProjected.w;
  vOrigin = (inverse(pmv) * vOriginProjected).xyz;
  // vOrigin = gl_Position.xyw;
  // vDirection = normalize(position - vOrigin);

}
`);
    parameters.fragmentShader = remove_comments(`
precision highp float;
precision mediump sampler3D;
in vec3 vOrigin;
in vec3 vPosition;
// in vec3 vDirection;
// in vec3 vSamplerBias;
in mat4 pmv;
in mat4 mv;
out vec4 color;
uniform sampler3D cmap;
#ifdef USE_GRADIENT_MAP
uniform sampler3D gradientMap;
#endif
uniform sampler2D matCapTexture;
uniform float matCapIntensity;
uniform sampler2D colorRampPalette;
uniform float singleChannelColorRangeLB;
uniform float singleChannelColorRangeUB;
uniform float alpha;
uniform float stepSize;
uniform float maxRenderDistance;
uniform vec3 scale_inv;
uniform float fastPassMultiplier;
uniform float gradientOpacityPower;
// uniform vec3 lightDirection;
uniform float bounding;
vec4 fcolor;
vec3 fOrigin;

vec2 hitBox( vec3 orig, vec3 dir ) {
  vec3 box_min = vec3( - bounding ) / scale_inv;
  vec3 box_max = vec3( bounding ) / scale_inv;
  vec3 inv_dir = 1.0 / dir;
  vec3 tmin_tmp = ( box_min - orig ) * inv_dir;
  vec3 tmax_tmp = ( box_max - orig ) * inv_dir;
  vec3 tmin = min( tmin_tmp, tmax_tmp );
  vec3 tmax = max( tmin_tmp, tmax_tmp );
  float t0 = max( tmin.x, max( tmin.y, tmin.z ) );
  float t1 = min( tmax.x, min( tmax.y, tmax.z ) );
  return vec2( t0, t1 );
}
float getDepth( vec3 p ){
  vec4 frag2 = pmv * vec4( p, 1.0 );

  return(
    (frag2.z / frag2.w * (gl_DepthRange.far - gl_DepthRange.near) +
      gl_DepthRange.near + gl_DepthRange.far) * 0.5
  );
}
vec3 getWorldPosition( vec3 p ) {
  return (mv * vec4( p, 1.0 )).xyz;
}
vec4 sample2( vec3 p ) {
  vec4 re = texture( cmap, p * scale_inv + 0.5 );
#ifdef SINGLE_CHANNEL
  // Single-channel mode: use red channel as intensity, map to color palette
  // using red channel as the color intensity
  re.a = re.r;

  // otherwise transparent, skip
  if( re.a > 0.0 ) {

    // intensity, by default equals to re.r
    float intensity = re.r;

    if( singleChannelColorRangeUB - singleChannelColorRangeLB > 0.0001 ) {
      intensity = (intensity - singleChannelColorRangeLB) / (singleChannelColorRangeUB - singleChannelColorRangeLB);
    }

    intensity = clamp(intensity, 0.0, 1.0);

    float nColors = float(N_SINGLE_CHANNEL_COLORS);
    if ( nColors <= 1.0 ) {
      nColors = 1.0;
    }

    // place key colors to the center of the pixels
    intensity = ( intensity * (nColors - 1.0) + 0.5 ) / nColors;
    re.rgb = texture( colorRampPalette, vec2( intensity , 0.5 ) ).rgb;

  }
#endif
  // Multi-channel mode (discrete atlases): use RGBA values directly from texture
  return re;
}

// Get surface normal from gradient (works for both continuous and discrete volumes)
// Originally only used when channel number is >= 3 (discrete atlases)
// For discrete atlases: uses color discontinuities to detect parcel boundaries
vec3 getNormal( vec3 p ) {
  vec3 pos0 = p * scale_inv + 0.5;
  
#ifdef USE_GRADIENT_MAP
  // Use pre-computed gradient texture (fast path)
  vec4 grad = texture( gradientMap, pos0 );
  
  // Check if gradient is available (alpha > 0)
  if( grad.a == 0.0 ) {
    return vec3(0.0, 0.0, 0.0);
  }
  
  // Unpack gradient from [0, 1] to [-1, 1] range
  // GPU auto-normalizes byte textures to [0,1], so we stored as: (gradient + 1) * 0.5
  vec3 normal = grad.rgb * 2.0 - 1.0;
  
  // Normalize and return 
  float len = length(normal);

  // 127 or 128 Uint8 to float is around 0.5 +- 0.002
  // hence there could be 0.002 * 2 * sqrt(3) = 0.0068 differences
  // this means len <= 0.0068... should be considered vec3(0.0)
  // Using 0.0078125 as it's 1/128: a "clean" floating number
  if( len < 0.0078125 ) {
    return vec3(0.0, 0.0, 0.0);
  }
  return normalize( normal );
  
#else
  // Fallback to central differences (original method)
  vec4 ne;
  vec3 zero3 = vec3(0.0, 0.0, 0.0);
  vec3 normal = zero3;
  vec3 pos = pos0;
  vec4 re = texture( cmap, pos0 );

  if( re.a == 0.0 || re.rgb == zero3 ) {
    return normal;
  }

  float stp = max(max(abs(scale_inv.x), abs(scale_inv.y)), abs(scale_inv.z)) * 1.74;
  vec2 dt = vec2(stp, stp);

  // normal along xy
  pos.xy = pos0.xy + dt;
  ne = texture( cmap, pos );

  if( ne.a != 0.0 && (ne.rgb != re.rgb || ne.rgb != zero3) ) {
    normal.xy += dt;
  }

  pos.xy = pos0.xy - dt;
  ne = texture( cmap, pos );

  if( ne.a != 0.0 && (ne.rgb != re.rgb || ne.rgb != zero3) ) {
    normal.xy -= dt;
  }

  // normal along xz
  pos.y = pos0.y;
  pos.xz = pos0.xz + dt;
  ne = texture( cmap, pos );

  if( ne.a != 0.0 && (ne.rgb != re.rgb || ne.rgb != zero3) ) {
    normal.xz += dt;
  }

  pos.xz = pos0.xz - dt;
  ne = texture( cmap, pos );

  if( ne.a != 0.0 && (ne.rgb != re.rgb || ne.rgb != zero3) ) {
    normal.xz -= dt;
  }

  // normal along yz
  pos.x = pos0.x;
  pos.yz = pos0.yz + dt;
  ne = texture( cmap, pos );

  if( ne.a != 0.0 && (ne.rgb != re.rgb || ne.rgb != zero3) ) {
    normal.yz += dt;
  }

  pos.yz = pos0.yz - dt;
  ne = texture( cmap, pos );

  if( ne.a != 0.0 && (ne.rgb != re.rgb || ne.rgb != zero3) ) {
    normal.yz -= dt;
  }

  return normalize( normal );
#endif
}

void main(){

  // vec4 vOriginProjected = pmv * vec4( vPosition, 1.0 );
  // vOriginProjected.z = -vOriginProjected.w;
  // fOrigin = (inverse(pmv) * vOriginProjected).xyz;
  fOrigin = vOrigin;

  // vec3 rayDir = normalize( vDirection );
  vec3 rayDir = normalize( vPosition - vOrigin );

  vec2 bounds = hitBox( fOrigin, rayDir );
  if ( bounds.x > bounds.y ) {
    gl_FragDepth = gl_DepthRange.far;
    color.a = 0.0;
    return;
  }
  bounds.x = max( bounds.x, 0.0 );

  // bounds.x is the length of ray
  vec3 p = fOrigin + bounds.x * rayDir;
  vec3 inc = 1.0 / abs( rayDir );
  float delta = min( inc.x, min( inc.y, inc.z ) ) * max( abs( stepSize ), 0.1 );

  // Calculate sliceSize for opacity correction
  float len = bounds.y - bounds.x;
  vec3 voxelDims = 1.0 / scale_inv;
  float lenVox = length((voxelDims * fOrigin) - (voxelDims * (fOrigin + len * rayDir)));
  float sliceSize = len / max(lenVox, 1.0);

  // Dithering ray
  vec3 pStart = p;  // Save the starting position (potentially dithered)

#ifdef USE_DITHERING
  // https://www.marcusbannerman.co.uk/articles/VolumeRendering.html
  p += rayDir * delta * fract(sin(gl_FragCoord.x * 12.9898 + gl_FragCoord.y * 78.233 + 1.0) * 43758.5453);
  pStart = p;  // Update starting position with dithering
#endif

  // Adaptive fast pass multiplier based on ray angle relative to voxel grid
  // Axis-aligned rays risk missing thin features perpendicular to the ray direction
  vec3 absDir = abs(rayDir);
  float maxDir = max(absDir.x, max(absDir.y, absDir.z));
  float minDir = min(absDir.x, min(absDir.y, absDir.z));
  // Anisotropy: how "stretched" the sampling appears along the ray
  // High anisotropy = axis-aligned = conservative stepping needed
  // Use smaller minDir threshold (0.01) to catch near-axis-aligned rays earlier
  float anisotropy = maxDir / max(minDir, 0.01);
  anisotropy = clamp(anisotropy, 1.0, 20.0);
  // Scale down multiplier for axis-aligned rays; fastPassMultiplier is upper bound, 1.0 is lower bound
  // Use pow(anisotropy, 0.6) for smoother, more aggressive falloff than sqrt
  float adaptiveMultiplier = clamp(fastPassMultiplier / pow(anisotropy, 0.6), 1.0, fastPassMultiplier);

  // Fast pass: skip empty space with larger steps
  float deltaFast = delta * adaptiveMultiplier;
  vec3 pFast = p;
  float tFast = 0.0;  // Distance from pStart, not from bounds.x
  
  while( bounds.x + tFast < bounds.y ) {
    vec4 testColor = sample2( pFast );
    if( testColor.a > 0.01 ) {
      // Rewind further to ensure we don't skip thin surfaces (2x for safety margin)
      tFast -= 2.0 * deltaFast;
      
      // Snap to delta grid to avoid phase misalignment and flickering
      float alignedSteps = floor(tFast / delta);
      tFast = max(alignedSteps * delta, 0.0);  // Don't go before start
      p = pStart + tFast * rayDir;
      break;
    }
    pFast += rayDir * deltaFast;
    tFast += deltaFast;
  }
  
  // Update p to fast pass position if we didn't find anything
  if( bounds.x + tFast >= bounds.y ) {
    p = pFast;
  }

  int nn = 0;
  int valid_voxel = 0;
  float mix_factor = 1.0;
  vec4 last_color = vec4( 0.0, 0.0, 0.0, 0.0 );
  vec3 zero_rgb = vec3( 0.0, 0.0, 0.0 );
  vec3 nmal = vec3( 0.0, 0.0, 0.0 );
  vec3 worldPosition = vec3( 0.0, 0.0, 0.0 );

  // Main rendering loop - start from where fast pass left us
  for ( float t = bounds.x + tFast; t < bounds.y; t += delta ) {
    fcolor = sample2( p );

    // Hit voxel?
    if( fcolor.a <= 0.0 || fcolor.rgb == zero_rgb ) {

      // no need to handle color/depth/normals, proceed to next voxel
      p += rayDir * delta;
      continue;

    }
    
#ifdef SINGLE_CHANNEL
  // Single channel: continuous volume (such as T1, T2)

  #ifdef USE_GRADIENT_MAP
    // if( gradientOpacityPower > 0.0 ) {
    //   vec4 grad = texture( gradientMap, p * scale_inv + 0.5 );
    //   float gradMagnitude = grad.a;  // Magnitude stored in alpha channel
    //   float opacityMultiplier = pow(gradMagnitude, gradientOpacityPower);
    //   fcolor.a *= opacityMultiplier;
    // }

    vec4 grad = texture( gradientMap, p * scale_inv + 0.5 );
    float gradMagnitude = clamp( grad.a * 4.0, 0.0, 1.0 );  // Magnitude stored in alpha channel
    
    if( alpha > 0.0 ) {

      float opacityMultiplier = 0.0;

      if ( gradMagnitude > 0.016 ) {

        opacityMultiplier = pow(gradMagnitude, 1.0 / (alpha * 2.25 + 0.25));

      }
    
      // float opacityMultiplier = pow(gradMagnitude, 1.0 / (alpha * 2.25 + 0.25));
      fcolor.a *= opacityMultiplier;
      // fcolor = grad;

    } else {
      
      fcolor.a = 1.0;

    }
  #endif

#else
  // multi-channel: discrete volume (such as atlas parcels)

  #ifdef USE_GRADIENT_MAP

    vec4 grad = texture( gradientMap, p * scale_inv + 0.5 );

    if( grad.a <= 0.0125 ) {
      // hidden voxel or inner points of a parcel
      if( valid_voxel == 0 ) {
        p += rayDir * delta;
        continue;
      }
      fcolor.a = 0.0;
    } else {
      if( alpha > 0.0 ){
        fcolor.a *= alpha;
      } else {
        fcolor.a = 1.0;
      }
    }

  #else

    if( fcolor.rgb != last_color.rgb ){
      // remember the previous color
      last_color = fcolor;
    }

  #endif

#endif
// END of: ifdef SINGLE_CHANNEL

    // model normal at position p
    nmal = getNormal( p );

    if(nmal != vec3(0.0, 0.0, 0.0)) {

      // Force normal to face camera in object space (two-sided lighting)
      // rayDir points from camera towards surface, so surface facing camera
      // has normal pointing opposite to rayDir (dot product < 0)
      // If dot(nmal, rayDir) > 0, normal points away from camera, flip it
      float lightNormDot = dot(nmal, rayDir);
      if(lightNormDot > 0.0) {
        nmal = -nmal;
      } else {
        lightNormDot = -lightNormDot;
      }

      // Transform corrected normal to view space
      vec3 viewNormal = normalize( mat3(mv) * nmal );

      // MatCap lighting (screen-space)
      if( matCapIntensity > 0.0 ) {
        
        // Sample matcap texture using view-space normal XY components
        // The texture is generated with proper orientation, no Y-flip needed
        vec2 matCapUV = viewNormal.xy * 0.5 + 0.5;
        vec3 matCapColor = texture(matCapTexture, matCapUV).rgb;

        // Mix between original color and matcap-lit color
        fcolor.rgb = mix(fcolor.rgb, fcolor.rgb * matCapColor, matCapIntensity);
      }
        
#if defined(USE_DITHERING)

      // ///////////////////////////
      // Simplified Blinn Phong lighting calculation
      // ///////////////////////////
      // vec3 ReflectedRay = reflect(-lightDirection, normal2);
      // vec3 eyeDirection = normalize(-rayDir);
      float diffuse = clamp(lightNormDot, 0.0, 1.0);

      // Light attenuation
      fcolor.rgb = fcolor.rgb * 0.8 + vec3( 0.1 ) * (1.0 + diffuse * fcolor.rgb);
#else

      fcolor.rgb *= 0.7 + pow(max( lightNormDot , 0.25), 0.3) * 0.2;
      fcolor.rgb += 0.1;

#endif

      

    }
    
    nn++;

    if( nn == 1 ){
      // We are right on the surface: voxel is not black and nn is 1

      // calculate the depth
      gl_FragDepth = getDepth( p );
      worldPosition = getWorldPosition( p );
      color = fcolor;

      valid_voxel = 1;

    } else {
      
      if( maxRenderDistance < 999.0 &&
          maxRenderDistance < distance(worldPosition, getWorldPosition( p )) ) {
        break;
      }
      
      // Blend
      // color.rgb = mix(color.rgb, fcolor.rgb, fcolor.a);
      color.rgb = vec3( color.a ) * color.rgb + vec3( 1.0 - color.a ) * fcolor.rgb;
      color.a = color.a + ( 1.0 - color.a ) * fcolor.a;
    }

    // Early termination based on accumulated opacity
    if( nn >= 30 || color.a > 0.95 ){
      break;
    }

    // march ray by a unit step
    p += rayDir * delta;

  }
  // END of raymarching


  // handle missing fragments
  if ( nn == 0 || color.a == 0.0 ) {
    gl_FragDepth = gl_DepthRange.far;
    color.a = 0.0;
  }

}
`);

    super( parameters );

    this.glslVersion = GLSL3;
    this.useSingleChannel = useSingleChannel;
    this.singleChannelLUT = colorLUT;
    
    // Store colorChannels as private property (now using define instead of uniform)
    this._colorChannels = colorChannels;

    // Store dithering as private property (now using define instead of uniform)
    this._useDithering = true;

  }

  /**
   * Get the number of color channels (1 for continuous, 4 for discrete)
   * @returns {number} The number of color channels
   */
  get colorChannels() {
    return this._colorChannels;
  }

  /**
   * Set the number of color channels and update shader defines
   * WARNING: This triggers a full shader recompilation which is expensive.
   * Avoid calling this at runtime if possible.
   * @param {number} value - The number of color channels (1 or 4)
   */
  set colorChannels(value) {
    if (this._colorChannels === value) {
      return; // No change needed
    }
    
    this._colorChannels = value;
    
    // Update defines to trigger shader recompilation
    if (value === 1) {
      this.defines.SINGLE_CHANNEL = 1;
      this.useSingleChannel = true;
    } else {
      delete this.defines.SINGLE_CHANNEL;
      this.useSingleChannel = false;
    }
    
    // Mark material for recompilation
    this.needsUpdate = true;
  }

  /**
   * Get whether dithering is enabled
   * @returns {boolean} Whether dithering is enabled
   */
  get useDithering() {
    return this._useDithering;
  }

  /**
   * Set whether dithering is enabled
   * WARNING: This triggers a full shader recompilation which is expensive.
   * Avoid calling this at runtime if possible.
   * @param {boolean} value - Whether to enable dithering
   */
  set useDithering(value) {
    const boolValue = !!value;
    if (this._useDithering === boolValue) {
      return; // No change needed
    }
    
    this._useDithering = boolValue;
    
    // Update defines to trigger shader recompilation
    if (boolValue) {
      this.defines.USE_DITHERING = 1;
    } else {
      delete this.defines.USE_DITHERING;
    }
    
    // Mark material for recompilation
    this.needsUpdate = true;
  }


  changePalette( name ) {

    if( !this.useSingleChannel ) { return; }

    const lut = this.singleChannelLUT;
    const nColors = this.defines.N_SINGLE_CHANNEL_COLORS;

    lut.setColorMap( name , nColors );
    lut.minV = 0;
    lut.maxV = nColors - 1;

    const paletteTexture = this.uniforms.colorRampPalette.value;

    if( paletteTexture.image.width !== nColors ) {
      paletteTexture.image.width = nColors;
      paletteTexture.image.data = new Uint8Array( nColors * 4 );
    }
    paletteTexture.needsUpdate = true;
    const keyColors = paletteTexture.image.data;


    for( let i = 0; i < nColors; i++ ) {
      const keyColor = lut.getColor( i );
      keyColors[ i * 4 ] = keyColor.r * 255;
      keyColors[ i * 4 + 1 ] = keyColor.g * 255;
      keyColors[ i * 4 + 2 ] = keyColor.b * 255;
      keyColors[ i * 4 + 3 ] = keyColor.a * 255;
    }

    this.uniformsNeedUpdate = true;
  }



}

export { RayMarchingMaterial };
