import { DataTexture, RGBAFormat, LinearFilter } from 'three';

/**
 * Render a MatCap texture to a canvas for visual inspection
 * @param {DataTexture} texture - The MatCap texture to render
 * @param {Object} options - Rendering options
 * @param {HTMLCanvasElement} [options.canvas] - Optional canvas to render to (creates new one if not provided)
 * @param {number} [options.size=256] - Canvas size in pixels (always square)
 * @returns {HTMLCanvasElement} The canvas with the rendered texture
 */
export function renderMatCapToCanvas(texture, options = {}) {
  const { canvas, size = 256 } = options;
  
  // Create or use provided canvas
  const targetCanvas = canvas || document.createElement('canvas');
  targetCanvas.width = size;
  targetCanvas.height = size;
  
  const ctx = targetCanvas.getContext('2d');
  
  // Get texture dimensions and data
  const texWidth = texture.image.width;
  const texHeight = texture.image.height;
  const texData = texture.image.data;
  
  // Create ImageData for the target canvas
  const imageData = ctx.createImageData(size, size);
  const outData = imageData.data;
  
  // Resample texture to target size using nearest neighbor
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map target coordinates to source texture coordinates
      const srcX = Math.floor((x / size) * texWidth);
      const srcY = Math.floor((y / size) * texHeight);
      
      // Source pixel index
      const srcIdx = (srcY * texWidth + srcX) * 4;
      // Destination pixel index
      const dstIdx = (y * size + x) * 4;
      
      // Copy RGBA values
      outData[dstIdx] = texData[srcIdx];
      outData[dstIdx + 1] = texData[srcIdx + 1];
      outData[dstIdx + 2] = texData[srcIdx + 2];
      outData[dstIdx + 3] = texData[srcIdx + 3];
    }
  }
  
  // Draw to canvas
  ctx.putImageData(imageData, 0, 0);
  
  return targetCanvas;
}

/**
 * Create a procedural MatCap texture
 * @param {number} size - Texture resolution (default 256)
 * @param {Object} options - MatCap generation options
 * @param {Array} options.lightColor - RGB color for light [r, g, b] (0-1 range)
 * @param {Array} options.darkColor - RGB color for shadow [r, g, b] (0-1 range)
 * @param {Array} options.lightDir - Light direction [x, y, z] in view space
 * @param {number} options.ambient - Ambient light amount (0-1)
 * @param {number} options.diffuse - Diffuse light amount (0-1)
 * @param {number} options.specular - Specular highlight amount (0-1)
 * @param {number} options.shininess - Specular shininess (1-100)
 * @returns {DataTexture} The generated matcap texture
 */
export function createMatCapTexture(size = 256, options = {}) {
  const {
    lightColor = [1.0, 1.0, 1.0],
    darkColor = [0.2, 0.2, 0.25],
    lightDir = [0.3, 0.3, 1.0],
    ambient = 0.3,
    diffuse = 0.6,
    specular = 0.4,
    shininess = 20.0
  } = options;

  const data = new Uint8Array(size * size * 4);
  
  // Normalize light direction
  const len = Math.sqrt(lightDir[0] ** 2 + lightDir[1] ** 2 + lightDir[2] ** 2);
  const L = [lightDir[0] / len, lightDir[1] / len, lightDir[2] / len];
  
  // View direction: viewer looking at sphere from positive Z direction
  // (standard MatCap convention: V points from surface toward viewer)
  const V = [0, 0, 1];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map pixel to [-1, 1] range
      const u = (x / (size - 1)) * 2.0 - 1.0;
      const v = (y / (size - 1)) * 2.0 - 1.0;
      
      // Calculate distance from center
      const r2 = u * u + v * v;
      
      let color = [0, 0, 0];
      
      if (r2 <= 1.0) {
        // This pixel is inside the sphere
        // Reconstruct 3D normal from 2D position (sphere surface)
        // Normal points towards viewer (positive Z), with Y matching texture V coordinate
        const z = Math.sqrt(1.0 - r2);
        const N = [u, v, z];
        
        // Normalize (should already be normalized, but just to be safe)
        const nLen = Math.sqrt(N[0] ** 2 + N[1] ** 2 + N[2] ** 2);
        N[0] /= nLen;
        N[1] /= nLen;
        N[2] /= nLen;
        
        // Ambient component
        const ambientColor = [
          darkColor[0] * ambient,
          darkColor[1] * ambient,
          darkColor[2] * ambient
        ];
        
        // Diffuse component (Lambertian)
        const NdotL = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
        const diffuseColor = [
          lightColor[0] * diffuse * NdotL,
          lightColor[1] * diffuse * NdotL,
          lightColor[2] * diffuse * NdotL
        ];
        
        // Specular component (Blinn-Phong)
        // Half vector
        const Hx = (L[0] + V[0]) / 2.0;
        const Hy = (L[1] + V[1]) / 2.0;
        const Hz = (L[2] + V[2]) / 2.0;
        const hLen = Math.sqrt(Hx ** 2 + Hy ** 2 + Hz ** 2);
        const H = [Hx / hLen, Hy / hLen, Hz / hLen];
        
        const NdotH = Math.max(0, N[0] * H[0] + N[1] * H[1] + N[2] * H[2]);
        const spec = Math.pow(NdotH, shininess) * specular;
        const specularColor = [
          lightColor[0] * spec,
          lightColor[1] * spec,
          lightColor[2] * spec
        ];
        
        // Combine all components
        color = [
          Math.min(1.0, ambientColor[0] + diffuseColor[0] + specularColor[0]),
          Math.min(1.0, ambientColor[1] + diffuseColor[1] + specularColor[1]),
          Math.min(1.0, ambientColor[2] + diffuseColor[2] + specularColor[2])
        ];
      } else {
        // Outside sphere - use dark color
        color = darkColor;
      }
      
      // Write to data array (RGBA)
      const idx = (y * size + x) * 4;
      data[idx] = Math.floor(color[0] * 255);
      data[idx + 1] = Math.floor(color[1] * 255);
      data[idx + 2] = Math.floor(color[2] * 255);
      data[idx + 3] = 255; // Alpha
    }
  }
  
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  
  return texture;
}

/**
 * Create a simple grayscale MatCap (faster, simpler)
 */
export function createSimpleMatCap(size = 256) {
  const data = new Uint8Array(size * size * 4);
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / (size - 1)) * 2.0 - 1.0;
      const v = (y / (size - 1)) * 2.0 - 1.0;
      const r2 = u * u + v * v;
      
      let brightness = 0.5;
      
      if (r2 <= 1.0) {
        const z = Math.sqrt(1.0 - r2);
        // Simple lighting: brighter toward center and top
        // v is positive at top, so add v contribution for top-lighting effect
        brightness = 0.3 + 0.5 * z + 0.2 * v;
        brightness = Math.max(0.2, Math.min(1.0, brightness));
      } else {
        brightness = 0.2;
      }
      
      const idx = (y * size + x) * 4;
      const val = Math.floor(brightness * 255);
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255; // Alpha
    }
  }
  
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  
  return texture;
}

/**
 * Preset matcap styles
 */
export const MatCapPresets = {
  // Shiny metallic look
  metal: () => createMatCapTexture(256, {
    lightColor: [1.0, 1.0, 1.0],
    darkColor: [0.1, 0.1, 0.15],
    lightDir: [0.5, 0.5, 1.0],
    ambient: 0.2,
    diffuse: 0.5,
    specular: 0.8,
    shininess: 50
  }),
  
  // Soft clay/matte look
  clay: () => createMatCapTexture(256, {
    lightColor: [1.0, 0.95, 0.9],
    darkColor: [0.3, 0.25, 0.2],
    lightDir: [0.0, 0.0, 1.0],
    ambient: 0.4,
    diffuse: 0.7,
    specular: 0.1,
    shininess: 5
  }),
  
  // Glossy plastic
  plastic: () => createMatCapTexture(256, {
    lightColor: [1.0, 1.0, 1.0],
    darkColor: [0.2, 0.2, 0.25],
    lightDir: [0.4, 0.4, 1.0],
    ambient: 0.3,
    diffuse: 0.6,
    specular: 0.5,
    shininess: 30
  }),
  
  // Simple grayscale
  simple: () => createSimpleMatCap(256)
};
