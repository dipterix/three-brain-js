import { Vector3 } from 'three';

function dnorm(x, m = 0, s = 1) {
  return Math.exp( -0.5 * Math.pow((x - m) / 2, 2) ) / Math.sqrt( 2 * Math.PI );
}

function huntedErode3d(x, dim) {

  const xlen = dim.x;
  const ylen = dim.y;
  const zlen = dim.z;

  const x_ = new Uint8Array(x);
  if( xlen <= 1 || ylen <= 1 || zlen <= 1 ) {
    return x_;
  }

  let i, j, k;
  const ijk2Index = (i, j, k) => {
    return i + xlen * (j + ylen * k);
  }

  let idx0, idx1;
  let v1,v2,v3,v4,v5,v6;

  let nonZeroCount = x_.reduce((partialSum, a) => partialSum + a, 0);

  for( i = 0; i < xlen; i++ ) {
    for( j = 0; j < ylen; j++ ) {
      for( k = 0; k < zlen; k++ ) {

        idx0 = ijk2Index(i, j, k);
        if( i < 1 || j < 1 || k < 1 ||
            i >= xlen - 1 || j >= ylen - 1 || k >= zlen - 1 ) {
          if( x_[idx0] !== 0 ) {
            nonZeroCount--;
          }
          x_[idx0] = 0;
          if( nonZeroCount <= 0 ) {
            return x_;
          }
          continue;
        }

        if( x[idx0] == 0 ) {
          continue;
        }

        // If the voxel is surrounded by 0, then erode
        v1 = x[ ijk2Index(i - 1, j, k) ];
        v2 = x[ ijk2Index(i + 1, j, k) ];
        v3 = x[ ijk2Index(i, j - 1, k) ];
        v4 = x[ ijk2Index(i, j + 1, k) ];
        v5 = x[ ijk2Index(i, j, k - 1) ];
        v6 = x[ ijk2Index(i, j, k + 1) ];
        if( (v1 === 0 && v2 === 0) +
            (v3 === 0 && v4 === 0) +
            (v5 === 0 && v6 === 0) >= 2
        ) {
          x_[idx0] = 0;
          nonZeroCount--;
          if( nonZeroCount <= 1 ) {
            return x_;
          }
          continue;
        }

        // if surrounded by 0 along partial margin, then skip
        // otherwise if one side is 0 but the other side is  none zero
        // assign with 0
        if(
          ((v1 === 0) ^ (v2 === 0)) ||
          ((v3 === 0) ^ (v4 === 0)) ||
          ((v5 === 0) ^ (v6 === 0))
        ) {
          x_[idx0] = 0;
          nonZeroCount--;
          if( nonZeroCount <= 1 ) {
            return x_;
          }
          continue;
        }

      }
    }
  }

  return x_;
}


function getVoxelBlobCenter({
  x, dim, initial, sliceDensity, maxSearch = 1, threshold } = {}) {

  window.origX = x;

  if( !dim.isVector3 ) {
    throw "localMaxima: dim must be a THREE.Vector3"
  }

  if( !initial.isVector3 ) {
    throw "localMaxima: initial must be a THREE.Vector3"
  }

  if( !sliceDensity.isVector3 ) {
    throw "localMaxima: sliceDensity must be a THREE.Vector3"
  }

  const xlen = dim.x;
  const ylen = dim.y;
  const zlen = dim.z;
  const ijk2Index = ( ijk ) => {
    return ijk.x + xlen * (ijk.y + ylen * ijk.z);
  }
  const maxLen = Math.max( xlen, ylen, zlen );

  let ijk = initial.clone();

  let thred = x[ ijk2Index( ijk ) ];
  if( typeof threshold === "number" && thred > threshold ) {
    thred = threshold;
  }
  // generate mask
  let x_ = new Uint8Array(x.length);
  let ii;
  for( ii = 0; ii < x.length; ii++) {
    if(x[ii] >= thred) {
      x_[ii] = 1;
    } else {
      x_[ii] = 0;
    }
  }

  const searchLB = new Vector3().set(
    Math.max( 0, Math.floor( ijk.x - sliceDensity.x * maxSearch ) ),
    Math.max( 0, Math.floor( ijk.y - sliceDensity.y * maxSearch ) ),
    Math.max( 0, Math.floor( ijk.z - sliceDensity.z * maxSearch ) )
  )
  const searchUB = new Vector3().set(
    Math.min( xlen-1, Math.ceil( ijk.x + sliceDensity.x * maxSearch ) ),
    Math.min( ylen-1, Math.ceil( ijk.y + sliceDensity.y * maxSearch ) ),
    Math.min( zlen-1, Math.ceil( ijk.z + sliceDensity.z * maxSearch ) )
  )

  const pixDim = new Vector3().set(
    1.0 / sliceDensity.x,
    1.0 / sliceDensity.y,
    1.0 / sliceDensity.z
  );

  const ijk1 = new Vector3(),
        ijk2 = new Vector3(),
        ijk3 = new Vector3().copy( ijk );

  let dist, minDist = Infinity, count = 1, iter = 0;
  while( count > 0 && iter <= maxLen ) {

    iter++;

    // dilate
    x_ = huntedErode3d(x_, dim);

    minDist = Infinity;
    count = 0;

    // check voxels around ijk
    if( x_[ ijk2Index( ijk ) ] !== 0 ) {
      count = 1;
      continue;
    }

    for( ijk1.x = searchLB.x; ijk1.x <= searchUB.x; ijk1.x++ ) {
      for( ijk1.y = searchLB.y; ijk1.y <= searchUB.y; ijk1.y++ ) {
        for( ijk1.z = searchLB.z; ijk1.z <= searchUB.z; ijk1.z++ ) {

          dist = ijk2.copy( ijk1 ).sub( ijk ).multiply( pixDim ).lengthSq();
          if( dist < minDist && x_[ ijk2Index( ijk1 ) ] > 0 ) {
            count++;
            ijk3.copy( ijk1 );
          }
        }
      }
    }
    ijk.copy( ijk3 );
  }

  // the blob center is near ijk at sub-voxel level
  const mdx = Math.floor( sliceDensity.x * maxSearch ),
        mdy = Math.floor( sliceDensity.y * maxSearch ),
        mdz = Math.floor( sliceDensity.z * maxSearch );

  let mv, totalWeights = 0;
  ijk3.set(0, 0, 0);

  for( ijk1.x = ijk.x - mdx; ijk1.x <= ijk.x + mdx; ijk1.x++ ) {
    for( ijk1.y = ijk.y - mdy; ijk1.y <= ijk.y + mdy; ijk1.y++ ) {
      for( ijk1.z = ijk.z - mdz; ijk1.z <= ijk.z + mdz; ijk1.z++ ) {

        ijk2.copy( ijk1 ).sub( ijk );

        mv = x[ ijk2Index( ijk1 ) ] - thred;
        if( mv < -50/0 ) {
          mv = -50.0;
        }
        mv *= dnorm(ijk2.length(), 0.0, 0.3);

        ijk3.add( ijk2.multiplyScalar( mv ) );
        totalWeights += mv > 0 ? mv : -mv;

      }
    }
  }



  if( totalWeights > 0 ) {
    ijk.add( ijk3.multiplyScalar( 1 / totalWeights ) );
  }


  return ijk;

}


export { getVoxelBlobCenter };
