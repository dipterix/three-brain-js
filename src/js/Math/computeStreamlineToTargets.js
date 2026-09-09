import { Vector3, Matrix4 } from 'three';

/**
 * Nearest-point search over a static point cloud, used to colour streamlines by
 * their distance to a target (the crosshair, a focused electrode, or every
 * above-threshold voxel of the active volume).
 *
 * The tree is a flat, implicit kd-tree: points live in one `Float32Array` and
 * the structure is an index permutation in a `Uint32Array`, with the node for a
 * range `[lo, hi)` sitting at its midpoint. Nothing is allocated per node, both
 * arrays are transferable, and a build is O(n log n) via quickselect rather than
 * a full sort at every level.
 *
 * The previous object-based tree allocated a `Vector3` and a six-field node
 * object per point. On a large ROI that was measurably expensive: 2.3s to build
 * and 51.6MB resident at 400k points, against 6.1MB here -- and it ran
 * synchronously on the main thread.
 */

/**
 * Reorder `order[lo, hi)` so that `order[k]` holds the element that belongs at
 * position `k` when sorted along `axis`, with everything before it smaller and
 * everything after it larger. Quickselect with a Hoare partition; the pivot is
 * read from position `k` so it always lies inside the live range, which is what
 * guarantees progress.
 */
function selectNth( points, order, lo, hi, k, axis ) {
  let left = lo, right = hi - 1;
  while( left < right ) {
    const pivot = points[ order[ k ] * 3 + axis ];
    let i = left, j = right;
    do {
      while( points[ order[ i ] * 3 + axis ] < pivot ) { i++; }
      while( points[ order[ j ] * 3 + axis ] > pivot ) { j--; }
      if( i <= j ) {
        const tmp = order[ i ]; order[ i ] = order[ j ]; order[ j ] = tmp;
        i++; j--;
      }
    } while ( i <= j );
    if( j < k ) { left = i; }
    if( k < i ) { right = j; }
  }
}

function buildRange( points, order, lo, hi, depth ) {
  if( hi - lo <= 1 ) { return; }
  const mid = ( lo + hi ) >> 1;
  selectNth( points, order, lo, hi, mid, depth % 3 );
  buildRange( points, order, lo, mid, depth + 1 );
  buildRange( points, order, mid + 1, hi, depth + 1 );
}

/**
 * Build a flat kd-tree over a packed point array.
 *
 * @param {Float32Array} points - xyz triples, length `3 * nPoints`.
 * @param {Uint32Array} [order] - Pre-permuted index array, as returned by a
 *   worker build. When omitted the permutation is computed here.
 * @returns {Object|null} The tree, or `null` when there are no points.
 */
function buildFlatKDTree( points, order ) {
  if( !points || points.length < 3 ) { return null; }
  const nPoints = Math.floor( points.length / 3 );

  if( !order ) {
    order = new Uint32Array( nPoints );
    for( let i = 0; i < nPoints; i++ ) { order[ i ] = i; }
    buildRange( points, order, 0, nPoints, 0 );
  }

  return {
    isKDTree     : true,
    isFlatKDTree : true,
    nPoints      : nPoints,
    points       : points,
    order        : order,
  };
}

/**
 * A tree standing for a single, possibly moving, point.
 *
 * Crosshair and focused-electrode highlighting track live `Vector3`s that the
 * viewer mutates in place, so the point is held by reference and read at query
 * time rather than copied into a packed array.
 *
 * @param {Vector3} point
 */
function makeSinglePointTree( point ) {
  return {
    isKDTree      : true,
    isSinglePoint : true,
    nPoints       : 1,
    point         : point,
  };
}

/**
 * Pack an array of `Vector3` (or anything with x/y/z) into a `Float32Array`.
 */
function packPoints( vec3Arrays ) {
  const nPoints = vec3Arrays.length;
  const points = new Float32Array( nPoints * 3 );
  for( let i = 0; i < nPoints; i++ ) {
    const v = vec3Arrays[ i ];
    points[ i * 3     ] = v.x;
    points[ i * 3 + 1 ] = v.y;
    points[ i * 3 + 2 ] = v.z;
  }
  return points;
}

/**
 * Build a kd-tree from either an array of `Vector3` or a packed `Float32Array`.
 *
 * @param {Array<Vector3>|Float32Array} targets
 * @returns {Object|null}
 */
function buildKDTree( targets ) {
  if( !targets || targets.length === 0 ) { return null; }
  if( ArrayBuffer.isView( targets ) ) {
    return buildFlatKDTree( targets );
  }
  return buildFlatKDTree( packPoints( targets ) );
}

function nearestInRange( points, order, x, y, z, lo, hi, depth, best ) {
  if( hi <= lo ) { return; }

  const mid = ( lo + hi ) >> 1;
  const pi = order[ mid ] * 3;
  const dx = x - points[ pi ], dy = y - points[ pi + 1 ], dz = z - points[ pi + 2 ];
  const distSq = dx * dx + dy * dy + dz * dz;
  if( distSq < best.distSq ) {
    best.distSq = distSq;
    best.index = order[ mid ];
  }

  if( hi - lo === 1 ) { return; }

  const axis = depth % 3;
  // signed offset from the splitting plane to the query point
  const diff = axis === 0 ? dx : ( axis === 1 ? dy : dz );

  if( diff < 0 ) {
    nearestInRange( points, order, x, y, z, lo, mid, depth + 1, best );
    if( diff * diff < best.distSq ) {
      nearestInRange( points, order, x, y, z, mid + 1, hi, depth + 1, best );
    }
  } else {
    nearestInRange( points, order, x, y, z, mid + 1, hi, depth + 1, best );
    if( diff * diff < best.distSq ) {
      nearestInRange( points, order, x, y, z, lo, mid, depth + 1, best );
    }
  }
}

/**
 * Nearest point in `tree` to `vec3`, accumulated into `best`.
 *
 * `best.distSq` is both the output and the search radius, so passing a `best`
 * carried over from an earlier query prunes the traversal -- which is how
 * `computeStreamlineToTargets` walks a whole streamline cheaply.
 *
 * @param {Object} tree
 * @param {Vector3} vec3
 * @param {{distSq: number, index: number}} best
 */
function nearest( tree, vec3, best ) {
  if( !tree ) { return best; }

  if( tree.isSinglePoint ) {
    const distSq = vec3.distanceToSquared( tree.point );
    if( distSq < best.distSq ) {
      best.distSq = distSq;
      best.index = 0;
    }
    return best;
  }

  nearestInRange(
    tree.points, tree.order,
    vec3.x, vec3.y, vec3.z,
    0, tree.nPoints, 0, best
  );
  return best;
}


function computeStreamlineToTargets(
  targetArray,              // array of Vector3, Float32Array, or a kdtree
  distanceToTargets,        // Float32Array, output: distance per segment
  instanceWeight,           // Float32Array, one per segment
  pointOffset,              // Int32Array, length nTracts+1
  pointPositions,           // Float32Array, length ~ 3*(total segments+1)
  tractRange,               // Uint32Array, nTracts * 3
  maxInstanceCount = Infinity, // Maximum number of instances
  matrixWorld = new Matrix4()
) {
  const nTracts = tractRange.length / 3;

  let kdtree = targetArray;
  if( !targetArray || typeof targetArray !== 'object' || !targetArray.isKDTree ) {
    kdtree = buildKDTree( targetArray );
  }

  const pt = new Vector3();
  const ptPrevious = new Vector3();

  let instanceCount = 0;


  for (let iTract = 0; iTract < nTracts; iTract++) {
    const idx = tractRange[iTract * 3];
    const len = tractRange[iTract * 3 + 1];
    const iPos = tractRange[iTract * 3 + 2];

    if (len <= 0 || instanceWeight[iPos] < 0) {
      // skip invisible or invalid streamlines
      continue;
    }

    const best = { index: -1, distSq: Infinity }

    let previousDist = 0;
    ptPrevious.fromArray( pointPositions, iPos * 3 );

    for (let i = 0; i < len; i++) {

      pt.fromArray( pointPositions, (iPos + i) * 3 );

      previousDist -= pt.distanceTo( ptPrevious );
      ptPrevious.copy( pt );

      if( previousDist > 0 ) {
        // there is no way this point is anywhere close to target
        continue;
      }

      nearest(kdtree, pt.applyMatrix4( matrixWorld ), best);

      previousDist = Math.sqrt( best.distSq );

    }

    const dist = isFinite( best.distSq ) ? Math.sqrt( best.distSq ) : 1e8;
    for (let i = 0; i < len; i++) {
      distanceToTargets[iPos + i] = dist;
    }

    instanceCount += len;
    if( instanceCount >= maxInstanceCount ) {
      break;
    }
  }

  return distanceToTargets;
}

export {
  computeStreamlineToTargets,
  buildKDTree,
  buildFlatKDTree,
  makeSinglePointTree,
  packPoints,
  nearest,
};
