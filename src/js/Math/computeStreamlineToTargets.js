import { Vector3, Matrix4 } from 'three';

const _vector = new Vector3();
const _axisNames = ['x', 'y', 'z']

function buildKDTree( vec3Arrays, depth = 0 ) {
  if (vec3Arrays.length === 0) return null;

  const axis = _axisNames[ depth % 3 ];

  vec3Arrays.sort((a, b) => a[axis] - b[axis]);
  const median = Math.floor(vec3Arrays.length / 2);

  return {
    isKDTree: true,
    nPoints: vec3Arrays.length,
    point: vec3Arrays[median],
    left: buildKDTree(vec3Arrays.slice(0, median), depth + 1),
    right: buildKDTree(vec3Arrays.slice(median + 1), depth + 1),
    axis: axis
  };
}

function nearest(tree, vec3, depth = 0, best = { point: null, distSq: Infinity }) {
  if (tree === null) return best;

  const d = vec3.distanceToSquared( tree.point );
  if ( d < best.distSq ) {
    best.point = tree.point;
    best.distSq = d;
  }

  const axis = tree.axis;
  const diff = vec3[axis] - tree.point[axis];
  const [nearBranch, farBranch] = diff < 0 ? [tree.left, tree.right] : [tree.right, tree.left];

  best = nearest(nearBranch, vec3, depth + 1, best);

  // Check if we need to explore the other side
  if (diff ** 2 < best.distSq) {
    best = nearest(farBranch, vec3, depth + 1, best);
  }

  return best;
}

function buildKDTreeFromArray( targetArray ) {
  if( targetArray.length === 0 ) { return null; }
  const nTargets = targetArray.length / 3;
  const vec3Arrays = [];
  for( let i = 0 ; i < nTargets; i++ ) {
    const point = new Vector3().fromArray( targetArray , 3 * i );
    vec3Arrays.push( point );
  }
  return buildKDTree(vec3Arrays)
}


function computeStreamlineToTargets(
  targetArray,              // array of Vector3 or a kdtree
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
  let nTargets = kdtree ? kdtree.nPoints : 0;

  const target = new Vector3();
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

    const best = { point: null, distSq: Infinity }

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

      /*for (let j = 0; j < nTargets; j++) {
        target.fromArray( targetArray, j * 3 );
        const d2 = pt.distanceToSquared(target);
        if (d2 < best.distSq) {
          best.distSq = d2;
        }
      }*/
      nearest(kdtree, pt.applyMatrix4( matrixWorld ), 0, best);

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

export { computeStreamlineToTargets, buildKDTree };
//*/
