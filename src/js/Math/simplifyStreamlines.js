/**
 * Error-bounded simplification of streamlines for drawing.
 *
 * Tractography is often resampled far finer than it can be seen: a bundle with
 * a point every 0.08 mm puts several segments under each pixel, and every
 * segment is an instanced quad the GPU transforms in every view. Dropping the
 * points a straight segment passes within `tolerance` of (Douglas-Peucker)
 * leaves the drawn line within `tolerance` of the original while cutting such
 * bundles by an order of magnitude.
 *
 * Only what is drawn is simplified. Streamline lengths and distances to targets
 * are measured on the full-resolution points.
 */

/**
 * Simplify every streamline in a packed point array.
 *
 * @param {Float32Array} points - xyz triples of all streamlines, back to back.
 * @param {Uint32Array|number[]} pointOffset - `nTracts + 1` offsets starting at
 *   0: streamline `i` is points `[ pointOffset[i], pointOffset[i + 1] )`.
 * @param {number} tolerance - largest distance, in the units of `points`, a
 *   dropped point may lie from the simplified line. Zero, a negative value or a
 *   non-finite value disables simplification.
 * @returns {{ points: Float32Array, pointOffset: Uint32Array }} the simplified
 *   arrays, in the same layout. When simplification is disabled, the inputs
 *   themselves are returned.
 */
function simplifyStreamlines( points, pointOffset, tolerance ) {
  if( !( tolerance > 0 ) || !isFinite( tolerance ) ) {
    return { points : points, pointOffset : pointOffset };
  }

  const nTracts = pointOffset.length - 1;

  let maxLength = 0;
  for( let i = 0; i < nTracts; i++ ) {
    const len = pointOffset[ i + 1 ] - pointOffset[ i ];
    if( len > maxLength ) { maxLength = len; }
  }

  // At most one pending range per point, two entries each
  const keep = new Uint8Array( maxLength );
  const stack = new Int32Array( maxLength * 2 + 2 );
  const tolerance2 = tolerance * tolerance;

  const outPoints = new Float32Array( points.length );
  const outOffset = new Uint32Array( nTracts + 1 );
  let nOut = 0;

  for( let iTract = 0; iTract < nTracts; iTract++ ) {
    outOffset[ iTract ] = nOut;
    const start = pointOffset[ iTract ],
          len = pointOffset[ iTract + 1 ] - start;

    if( len < 3 ) {
      outPoints.set( points.subarray( start * 3, ( start + len ) * 3 ), nOut * 3 );
      nOut += len;
      continue;
    }

    keep.fill( 0, 0, len );
    keep[ 0 ] = 1;
    keep[ len - 1 ] = 1;

    let top = 0;
    stack[ top++ ] = 0;
    stack[ top++ ] = len - 1;

    while( top > 0 ) {
      const last = stack[ --top ],
            first = stack[ --top ];
      if( last - first < 2 ) { continue; }

      const a3 = ( start + first ) * 3,
            b3 = ( start + last ) * 3;
      const ax = points[ a3 ], ay = points[ a3 + 1 ], az = points[ a3 + 2 ];
      const dx = points[ b3 ] - ax,
            dy = points[ b3 + 1 ] - ay,
            dz = points[ b3 + 2 ] - az;
      const dd = dx * dx + dy * dy + dz * dz;

      // farthest point from the segment (not the infinite line) first..last
      let farthest2 = -1, farthest = -1;
      for( let k = first + 1; k < last; k++ ) {
        const p3 = ( start + k ) * 3;
        let px = points[ p3 ] - ax,
            py = points[ p3 + 1 ] - ay,
            pz = points[ p3 + 2 ] - az;
        if( dd > 0 ) {
          let t = ( px * dx + py * dy + pz * dz ) / dd;
          if( t < 0 ) { t = 0; } else if( t > 1 ) { t = 1; }
          px -= t * dx;
          py -= t * dy;
          pz -= t * dz;
        }
        const d2 = px * px + py * py + pz * pz;
        if( d2 > farthest2 ) {
          farthest2 = d2;
          farthest = k;
        }
      }

      if( farthest2 > tolerance2 ) {
        keep[ farthest ] = 1;
        stack[ top++ ] = first;
        stack[ top++ ] = farthest;
        stack[ top++ ] = farthest;
        stack[ top++ ] = last;
      }
    }

    for( let k = 0; k < len; k++ ) {
      if( keep[ k ] === 0 ) { continue; }
      const p3 = ( start + k ) * 3,
            o3 = nOut * 3;
      outPoints[ o3 ] = points[ p3 ];
      outPoints[ o3 + 1 ] = points[ p3 + 1 ];
      outPoints[ o3 + 2 ] = points[ p3 + 2 ];
      nOut++;
    }
  }
  outOffset[ nTracts ] = nOut;

  return {
    points      : outPoints.slice( 0, nOut * 3 ),
    pointOffset : outOffset,
  };
}

export { simplifyStreamlines };
