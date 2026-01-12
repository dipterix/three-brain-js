import { Vector2, Vector3 } from 'three';

const unitCube = {
  points: [
    new Vector3().set(0, 0, 0),
    new Vector3().set(1, 0, 0),
    new Vector3().set(0, 1, 0),
    new Vector3().set(1, 1, 0),
    new Vector3().set(0, 0, 1),
    new Vector3().set(1, 0, 1),
    new Vector3().set(0, 1, 1),
    new Vector3().set(1, 1, 1)
  ],
  edges: [
    new Vector2().set(0, 1),
    new Vector2().set(0, 2),
    new Vector2().set(0, 4),
    new Vector2().set(1, 3),
    new Vector2().set(1, 5),
    new Vector2().set(2, 3),
    new Vector2().set(2, 6),
    new Vector2().set(3, 7),
    new Vector2().set(4, 5),
    new Vector2().set(4, 6),
    new Vector2().set(5, 7),
    new Vector2().set(6, 7)
  ],
};


function isoSurface({ density, shape, lowerBound = 0.5, upperBound = Infinity,
                      vox2world = null, offset = 0 } = {}) {
  // density is an array
  // shape is Vector3
  const width  = shape.x;
  const height = shape.y;
  const depth  = shape.z;

  if( density.length < width * height * depth + offset ) {
    throw new Error("Array `density` and `shape` have inconsistent indicated lengths.");
  }

  // `featurePoints` stores the points (THREE.Vector3) on the surface of the isosurface.
  const featurePoints = [];
  const featurePointIndex = {};

  const widthXHeight = width * height;

  function xyz2Index(x, y, z) {
    return x + y * width + z * widthXHeight;
  }
  function getXYZ(x, y, z) {
    return density[ xyz2Index(x, y, z) + offset ];
  }

  function getFeaturePointIndex(x, y, z) {
    const idx = xyz2Index(x, y, z);
    if ( idx in featurePointIndex ) {
      return featurePointIndex[ idx ];
    }
    const values = [];
    unitCube.points.forEach(function(v) {
      values.push( getXYZ(x + v.x, y + v.y, z + v.z) )
    });
    let sum = 0;
    let level;
    const p = new Vector3(),
          r = new Vector3(),
          interp = new Vector3();
    unitCube.edges.forEach(function(e) {
      const v0 = values[ e.x ],
            v1 = values[ e.y ];

      if( v0 === undefined || v1 === undefined ) return;

      //// if the surface doesn't pass through this edge, skip it
      // if (values[e[0]] < level && values[e[1]] < level) return;
      // if (values[e[0]] >= level && values[e[1]] >= level) return;
      if (
        ( v0 < lowerBound && v1 >= lowerBound && v1 < upperBound ) ||
        ( v1 < lowerBound && v0 >= lowerBound && v0 < upperBound )
      ) {
        // v0 - v1 pass the lowerBound surface
        level = lowerBound;
      } else if (
        ( v0 >= upperBound && v1 > lowerBound && v1 < upperBound ) ||
        ( v1 >= upperBound && v0 > lowerBound && v0 < upperBound )
      ) {
        // v0 - v1 pass the upperBound surface
        level = upperBound;
      } else {
        return ;
      }

      // Calculate the rate of change of the density along this edge.
      const dv = v1 - v0;

      // Figure out how far along this edge the surface lies (linear approximation).
      const dr = (level - v0) / dv;

      // Figure out the direction of this edge.
      const cp0 = unitCube.points[ e.x ],
            cp1 = unitCube.points[ e.y ];
      r.copy( cp1 ).sub( cp0 );

      // Figure out the point that the surface intersects this edge.
      interp.copy( r ).multiplyScalar( dr ).add( cp0 );

      // Add this intersection to the sum of intersections.
      // p = [p[0] + interp[0] + x, p[1] + interp[1] + y, p[2] + interp[2] + z];
      p.add( interp );
      // Increment the edge intersection count for later averaging.
      sum++;
    });
    if( sum > 0.0 ) {
      p.divideScalar( sum );
    }
    p.x += x;
    p.y += y;
    p.z += z;
    if( vox2world ) {
      p.applyMatrix4( vox2world );
    }
    featurePoints.push( p.x, p.y, p.z );
    const faceIdx = featurePoints.length / 3 - 1;
    featurePointIndex[ idx ] = faceIdx;
    return faceIdx;
  }

  const total = (width - 1) * (height - 1) * (depth - 1);
  const cells = [];

  for (let x = 0; x < width - 1; x++) {
    for (let y = 0; y < height - 1; y++) {
      for (let z = 0; z < depth - 1; z++) {
        const v0 = getXYZ( x + 0, y + 0, z + 0 ),
              vx = getXYZ( x + 1, y + 0, z + 0 ),
              vy = getXYZ( x + 0, y + 1, z + 0 ),
              vz = getXYZ( x + 0, y + 0, z + 1 );

        // const p0 = density.get(x + 0, y + 0, z + 0) >= level ? 1 : 0;
        // const px = density.get(x + 1, y + 0, z + 0) >= level ? 1 : 0;
        // const py = density.get(x + 0, y + 1, z + 0) >= level ? 1 : 0;
        // const pz = density.get(x + 0, y + 0, z + 1) >= level ? 1 : 0;
        const p0 = ( v0 >= lowerBound && v0 < upperBound ) ? 1 : 0,
              px = ( vx >= lowerBound && vx < upperBound ) ? 1 : 0,
              py = ( vy >= lowerBound && vy < upperBound ) ? 1 : 0,
              pz = ( vz >= lowerBound && vz < upperBound ) ? 1 : 0;

        // If the cube is entirely above or below the isosurface, then there is no contribution.
        if (p0 + px + py + pz === 0 || p0 + px + py + pz === 4) {
          continue;
        }

        // If v0 -> vx is a transition edge
        if (p0 + px === 1 && y > 0 && z > 0) {
          const a = getFeaturePointIndex(x + 0, y - 1, z - 1);
          const b = getFeaturePointIndex(x + 0, y - 1, z + 0);
          const c = getFeaturePointIndex(x + 0, y + 0, z + 0);
          const d = getFeaturePointIndex(x + 0, y + 0, z - 1);
          if (px > p0) {
            cells.push(a,b,c);
            cells.push(a,c,d);
          } else {
            cells.push(a,c,b);
            cells.push(a,d,c);
          }
        }
        if (p0 + py === 1 && x > 0 && z > 0) {
          const a = getFeaturePointIndex(x - 1, y + 0, z - 1);
          const b = getFeaturePointIndex(x + 0, y + 0, z - 1);
          const c = getFeaturePointIndex(x + 0, y + 0, z + 0);
          const d = getFeaturePointIndex(x - 1, y + 0, z + 0);
          if (py > p0) {
            cells.push(a,b,c);
            cells.push(a,c,d);
          } else {
            cells.push(a,c,b);
            cells.push(a,d,c);
          }
        }
        if (p0 + pz === 1 && x > 0 && y > 0) {
          const a = getFeaturePointIndex(x - 1, y - 1, z + 0);
          const b = getFeaturePointIndex(x + 0, y - 1, z + 0);
          const c = getFeaturePointIndex(x + 0, y + 0, z + 0);
          const d = getFeaturePointIndex(x - 1, y + 0, z + 0);
          if (pz < p0) {
            cells.push(a,b,c);
            cells.push(a,c,d);
          } else {
            cells.push(a,c,b);
            cells.push(a,d,c);
          }
        }
      }
    }
  }

  return {
    nVerts : featurePoints.length / 3,
    position: featurePoints,
    index: cells,
  };

}

function isoSurfaceFromColors({ colorVolume, shape, colorSize = 4, vox2world = null, offset = 0, volumeGradient = null } = {}) {
  // density is an array
  // shape is Vector3
  const width  = shape.x;
  const height = shape.y;
  const depth  = shape.z;

  if( colorVolume.length < colorSize * ( width * height * depth + offset ) ) {
    throw new Error("Array `colorVolume` and `shape` have inconsistent indicated lengths.");
  }

  // Create mask
  const maskLength = width * height * depth;
  const mask = new Uint8Array( maskLength );

  if( colorSize < 4 ) {
    let idx, j, mv;
    for (let i = 0; i < maskLength; i++ ) {
      idx = i * colorSize + offset;
      mv = 0;
      for(j = 0; j < colorSize; j++) {
        if( colorVolume[ idx + j ] > 0 ) {
          mv = 1;
          break;
        }
      }
      mask[i] = mv;
    }
  } else {
    for (let i = 0; i < maskLength; i++ ) {
      mask[i] = colorVolume[ i * colorSize + offset + 3 ] > 0.5;
    }
  }

  const color = {r: 0, g: 0, b: 0, a: 0};
  function useColorAt(x, y, z) {
    const idx = ( x + y * width + z * width * height ) * colorSize;
    switch( colorSize ) {
      case 1:
        color.r = colorVolume[ idx ];
        if( color.r === 0 ) { return null; }
        break;
      case 2:
        color.r = colorVolume[ idx ];
        color.g = colorVolume[ idx + 1 ];
        if( color.r + color.g === 0 ) { return null; }
        break;
      case 3:
        color.r = colorVolume[ idx ];
        color.g = colorVolume[ idx + 1 ];
        color.b = colorVolume[ idx + 2 ];
        if( color.r + color.g + color.b === 0 ) { return null; }
        break;
      case 4:
        color.r = colorVolume[ idx ];
        color.g = colorVolume[ idx + 1 ];
        color.b = colorVolume[ idx + 2 ];
        color.a = colorVolume[ idx + 3 ];
        if( color.a <= 0.5 ) { return null; }
        break;
    }
    return color;
  }

  // Helper function to sample gradient (normal) at a voxel position
  // volumeGradient is expected to be RGBA format where RGB encodes normalized gradient
  // (values 0-255 mapped from -1 to 1)
  // ISO surface vertices lie between voxels, so we need to sample from nearby voxels
  // and find the one with a valid (non-zero) gradient
  const normal = new Vector3();
  function sampleGradientAt(x, y, z) {
    if( !volumeGradient ) { return null; }
    
    // Try floor first (the voxel that contains the surface vertex),
    // then try the 8 corners of the unit cube around this position
    const offsets = [
      [0, 0, 0],   // floor
      [1, 0, 0], [0, 1, 0], [0, 0, 1],   // adjacent on positive side
      [1, 1, 0], [1, 0, 1], [0, 1, 1],   // diagonal edges
      [1, 1, 1],   // opposite corner
    ];
    
    const baseX = Math.floor(x);
    const baseY = Math.floor(y);
    const baseZ = Math.floor(z);
    
    for( const [ox, oy, oz] of offsets ) {
      const vx = Math.max(0, Math.min(width - 1, baseX + ox));
      const vy = Math.max(0, Math.min(height - 1, baseY + oy));
      const vz = Math.max(0, Math.min(depth - 1, baseZ + oz));
      
      const idx = ( vx + vy * width + vz * width * height ) * 4;
      
      // Check if this voxel has a valid gradient (stored in alpha channel as magnitude)
      const magnitude = volumeGradient[ idx + 3 ];
      if( magnitude < 3 ) { continue; } // Skip voxels with zero/tiny gradient
      
      // Decode from 0-255 to -1 to 1
      normal.x = (volumeGradient[ idx ] / 127.5) - 1.0;
      normal.y = (volumeGradient[ idx + 1 ] / 127.5) - 1.0;
      normal.z = (volumeGradient[ idx + 2 ] / 127.5) - 1.0;
      
      // Check if gradient is valid (non-zero length)
      const len = normal.length();
      if( len < 0.007 ) { continue; }
      
      normal.divideScalar( len ); // Normalize
      return normal;
    }
    
    return null;
  }

  const ret = isoSurface({ density: mask, shape: shape, lowerBound: 0.5 });
  const position = ret.position;
  const nVerts = position.length / 3;
  const pos = new Vector3()
  const colors = [];
  const normals = volumeGradient ? [] : null;

  ret.color = colors;
  ret.normal = normals;
  
  for( let i = 0; i < nVerts; i++ ) {
    pos.fromArray( position, i * 3 );
    let x = Math.round( pos.x ),
        y = Math.round( pos.y ),
        z = Math.round( pos.z );
    for( let pointOffset of unitCube.points ) {
      if( useColorAt( x + pointOffset.x, y + pointOffset.y, z + pointOffset.z ) ) { break; }
      if( useColorAt( x - pointOffset.x, y - pointOffset.y, z - pointOffset.z ) ) { break; }
    }
    colors.push( color.r, color.g, color.b );
    
    // Sample normal from volume gradient if available
    if( volumeGradient ) {
      const sampledNormal = sampleGradientAt( pos.x, pos.y, pos.z );
      if( sampledNormal ) {
        // Transform normal by vox2world if provided (only rotation, no translation)
        if( vox2world ) {
          sampledNormal.transformDirection( vox2world );
        }
        normals.push( sampledNormal.x, sampledNormal.y, sampledNormal.z );
      } else {
        // Default normal (will be computed later by geometry.computeVertexNormals if needed)
        normals.push( 0, 0, 0 );
      }
    }
    
    if( vox2world ) {
      pos.applyMatrix4( vox2world );
      position[ i * 3 ] = pos.x;
      position[ i * 3 + 1 ] = pos.y;
      position[ i * 3 + 2 ] = pos.z;
    }
  }


  return ret;

}

export { isoSurface, isoSurfaceFromColors };
