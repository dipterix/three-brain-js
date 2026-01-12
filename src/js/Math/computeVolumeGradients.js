/**
 * Compute 3D volume gradients using Sobel filtering
 * Used for pre-computing normals for volume rendering to improve performance
 */

/**
 * Core implementation of 3D Sobel gradient computation
 * This function can be reused in Web Workers for offloading heavy computations
 * 
 * @param {Uint8Array} voxelColor - RGBA or single-channel volume data (flat array)
 * @param {number} width - Volume width (x dimension)
 * @param {number} height - Volume height (y dimension)  
 * @param {number} depth - Volume depth (z dimension)
 * @param {number} nChannels - Number of channels (1 for grayscale, 4 for RGBA)
 * @returns {Uint8Array} Gradient volume (RGBA format: R=dx, G=dy, B=dz, A=alpha)
 */
function computeGradientsFromRGBA(voxelColor, width, height, depth, nChannels = 4) {
  
  const numVoxels = width * height * depth;
  const gradients = new Uint8Array(numVoxels * 4);
  
  // Helper to get voxel index
  const getIndex = (x, y, z) => {
    return (z * height * width + y * width + x);
  };
  
  // Helper to get intensity from voxel (for single channel)
  const getIntensity = (x, y, z) => {
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
      return 0.0;
    }
    const idx = getIndex(x, y, z);
    // Single channel: use value directly
    return voxelColor[idx] / 255.0;
  };
  
  // Helper to get RGB color from voxel (for multi-channel atlas data)
  const getRGB = (x, y, z) => {
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const idx = getIndex(x, y, z);
    const baseIdx = idx * 4;
    return {
      r: voxelColor[baseIdx],
      g: voxelColor[baseIdx + 1],
      b: voxelColor[baseIdx + 2],
      a: voxelColor[baseIdx + 3]
    };
  };
  
  // Helper to check if two RGB colors are different (for edge detection)
  const colorsAreDifferent = (c1, c2) => {
    return c1.r !== c2.r || c1.g !== c2.g || c1.b !== c2.b;
  };
  
  // Get alpha channel
  const getAlpha = (x, y, z) => {
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
      return 0;
    }
    const idx = getIndex(x, y, z);
    if (nChannels === 1) {
      return voxelColor[idx];
    } else {
      return voxelColor[idx * 4 + 3];
    }
  };
  
  // Gradient computation strategy depends on data type:
  // - Single channel (nChannels=1): continuous intensity data, use central differences on intensity
  // - Multi-channel (nChannels>=3): discrete atlas patches, detect edges by color changes
  
  if (nChannels === 1) {
    // ===== Single-channel continuous data (e.g., MRI) =====
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          
          const idx = getIndex(x, y, z);
          const outIdx = idx * 4;
          
          // Get alpha at this voxel
          const alpha = getAlpha(x, y, z);
          gradients[outIdx + 3] = alpha;
          
          // Skip gradient computation for transparent voxels
          if (alpha === 0) {
            gradients[outIdx] = 127;     // dx = 0 (encoded as 127)
            gradients[outIdx + 1] = 127; // dy = 0
            gradients[outIdx + 2] = 127; // dz = 0
            continue;
          }
          
          // Compute gradients using central differences on intensity
          const dx = (getIntensity(x + 1, y, z) - getIntensity(x - 1, y, z)) / 2.0;
          const dy = (getIntensity(x, y + 1, z) - getIntensity(x, y - 1, z)) / 2.0;
          const dz = (getIntensity(x, y, z + 1) - getIntensity(x, y, z - 1)) / 2.0;
          
          // Compute gradient magnitude
          const magnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          // Pack into [0, 255] range where 127 = 0
          gradients[outIdx]     = Math.round(Math.max(0, Math.min(255, (dx + 1.0) * 127.5)));
          gradients[outIdx + 1] = Math.round(Math.max(0, Math.min(255, (dy + 1.0) * 127.5)));
          gradients[outIdx + 2] = Math.round(Math.max(0, Math.min(255, (dz + 1.0) * 127.5)));
          // Store gradient magnitude in alpha (normalized to [0, 1] range)
          gradients[outIdx + 3] = Math.round(Math.max(0, Math.min(255, magnitude * 255)));
        }
      }
    }
    
  } else {
    // ===== Multi-channel discrete atlas data (e.g., brain parcellation) =====
    // Each region has uniform color; normals only exist at boundaries between regions
    // Use 3D Sobel filter for smoothed gradient estimation
    
    // Convert RGB to unique scalar ID for efficient color comparison
    const colorToId = (rgb) => {
      if (rgb.a === 0 || (rgb.r === 0 && rgb.g === 0 && rgb.b === 0)) {
        return 0;
      }
      return (rgb.r << 16) | (rgb.g << 8) | rgb.b;
    };
    
    // 3D Sobel operator: separable kernels
    // Differentiation kernel: [-1, 0, 1]
    // Smoothing kernel: [1, 2, 1] (sum = 4)
    // Combined weight at each position in 3x3x3 neighborhood
    // Kernel indexed as kernel[zIdx][yIdx][xIdx] where idx = offset + 1
    
    // For X-gradient: differentiate in X, smooth in Y and Z
    // At each (y, z), we want [-1, 0, 1] across x
    // Smoothing weights: y has [1,2,1], z has [1,2,1]
    const sobelX = [
      // z = -1 plane (z-weight = 1)
      [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],   // y = -1, 0, 1 (y-weights: 1, 2, 1)
      // z = 0 plane (z-weight = 2)
      [[-2, 0, 2], [-4, 0, 4], [-2, 0, 2]],   // y = -1, 0, 1
      // z = 1 plane (z-weight = 1)
      [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]    // y = -1, 0, 1
    ];
    
    // For Y-gradient: differentiate in Y, smooth in X and Z
    // At each (x, z), we want [-1, 0, 1] across y
    // Smoothing weights: x has [1,2,1], z has [1,2,1]
    const sobelY = [
      // z = -1 plane (z-weight = 1)
      [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],   // y = -1, 0, 1; x-weights in each row: 1, 2, 1
      // z = 0 plane (z-weight = 2)
      [[-2, -4, -2], [0, 0, 0], [2, 4, 2]],   // y = -1, 0, 1
      // z = 1 plane (z-weight = 1)
      [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]    // y = -1, 0, 1
    ];
    
    // For Z-gradient: differentiate in Z, smooth in X and Y
    // At each (x, y), we want [-1, 0, 1] across z
    // Smoothing weights: x has [1,2,1], y has [1,2,1]
    const sobelZ = [
      // z = -1 plane (z-diff-weight = -1)
      [[-1, -2, -1], [-2, -4, -2], [-1, -2, -1]],
      // z = 0 plane (z-diff-weight = 0)
      [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      // z = 1 plane (z-diff-weight = 1)
      [[1, 2, 1], [2, 4, 2], [1, 2, 1]]
    ];
    
    // Normalization factor for Sobel kernels
    const sobelNorm = 1.0 / 16.0;  // Sum of absolute weights in one direction
    
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          
          const idx = getIndex(x, y, z);
          const outIdx = idx * 4;
          
          const current = getRGB(x, y, z);
          gradients[outIdx + 3] = current.a;
          
          // Skip gradient computation for transparent voxels or black voxels
          if (current.a === 0 || (current.r === 0 && current.g === 0 && current.b === 0)) {
            gradients[outIdx] = 127;     // dx = 0
            gradients[outIdx + 1] = 127; // dy = 0
            gradients[outIdx + 2] = 127; // dz = 0
            continue;
          }
          
          const currentId = colorToId(current);
          
          // Apply 3D Sobel filter
          let gx = 0, gy = 0, gz = 0;
          
          // Sample 3x3x3 neighborhood
          for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const neighbor = getRGB(x + dx, y + dy, z + dz);
                const neighborId = colorToId(neighbor);
                
                // Detect edge: 1 if colors are different, 0 if same
                const edge = (neighborId !== currentId) ? 1.0 : 0.0;
                
                // Apply Sobel weights
                const zIdx = dz + 1;  // Map [-1, 0, 1] to [0, 1, 2]
                const yIdx = dy + 1;
                const xIdx = dx + 1;
                
                gx += edge * sobelX[zIdx][yIdx][xIdx];
                gy += edge * sobelY[zIdx][yIdx][xIdx];
                gz += edge * sobelZ[zIdx][yIdx][xIdx];
              }
            }
          }
          
          // Normalize gradients
          gx *= sobelNorm;
          gy *= sobelNorm;
          gz *= sobelNorm;
          
          // Compute gradient magnitude
          const magnitude = Math.sqrt(gx * gx + gy * gy + gz * gz);
          
          // Normalize direction if magnitude is non-zero
          if (magnitude > 0.0001) {
            gx /= magnitude;
            gy /= magnitude;
            gz /= magnitude;
          }
          
          // Pack into [0, 255] range where 127 = 0
          gradients[outIdx]     = Math.round(Math.max(0, Math.min(255, (gx + 1.0) * 127.5)));
          gradients[outIdx + 1] = Math.round(Math.max(0, Math.min(255, (gy + 1.0) * 127.5)));
          gradients[outIdx + 2] = Math.round(Math.max(0, Math.min(255, (gz + 1.0) * 127.5)));
          // Store gradient magnitude in alpha (normalized to [0, 255])
          gradients[outIdx + 3] = Math.round(Math.max(0, Math.min(255, magnitude * 255)));
        }
      }
    }
  }
  
  return gradients;
}

export { computeGradientsFromRGBA };


