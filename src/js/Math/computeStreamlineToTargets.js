import { Vector3 } from 'three';

function buildTargetGrid(targetArray, gridSize = 5) {
  const grid = new Map();
  const nTargets = targetArray.length / 3;

  for (let i = 0; i < nTargets; i++) {
    const x = targetArray[i * 3];
    const y = targetArray[i * 3 + 1];
    const z = targetArray[i * 3 + 2];

    const gx = Math.floor(x / gridSize);
    const gy = Math.floor(y / gridSize);
    const gz = Math.floor(z / gridSize);
    const key = `${gx},${gy},${gz}`;

    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([x, y, z]);
  }

  return { grid, gridSize };
}

function findClosestInGrid(pt, gridData) {
  const { grid, gridSize } = gridData;
  const gx = Math.floor(pt.x / gridSize);
  const gy = Math.floor(pt.y / gridSize);
  const gz = Math.floor(pt.z / gridSize);

  let minDistSq = Infinity;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${gx + dx},${gy + dy},${gz + dz}`;
        const bucket = grid.get(key);
        if (!bucket) continue;

        for (let i = 0; i < bucket.length; i++) {
          const [x, y, z] = bucket[i];
          const dx = pt.x - x, dy = pt.y - y, dz = pt.z - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < minDistSq) minDistSq = d2;
        }
      }
    }
  }

  return minDistSq;
}

function computeStreamlineToTargets2(
  targetArray,
  distanceToTargets,
  instanceWeight,
  pointOffset,
  pointPositions,
  tractRange,
  maxInstanceCount = Infinity,
  gridSize = 5
) {
  const nTracts = tractRange.length / 3;
  const gridData = buildTargetGrid(targetArray, gridSize);

  const pt = new Vector3();
  const ptPrevious = new Vector3();

  let instanceCount = 0;

  for (let iTract = 0; iTract < nTracts; iTract++) {
    const idx = tractRange[iTract * 3];
    const len = tractRange[iTract * 3 + 1];
    const iPos = tractRange[iTract * 3 + 2];

    if (len <= 0 || instanceWeight[iPos] < 0) continue;

    let minDistSq = Infinity;
    let previousDist = 0;
    ptPrevious.fromArray(pointPositions, iPos * 3);

    for (let i = 0; i < len; i++) {
      pt.fromArray(pointPositions, (iPos + i) * 3);

      previousDist -= pt.distanceTo(ptPrevious);
      ptPrevious.copy(pt);

      if (previousDist > 0) continue;

      const d2 = findClosestInGrid(pt, gridData);
      if (d2 < minDistSq) minDistSq = d2;

      previousDist = Math.sqrt(minDistSq);
    }

    const dist = isFinite(minDistSq) ? Math.sqrt(minDistSq) : 1e8;
    for (let i = 0; i < len; i++) {
      distanceToTargets[iPos + i] = dist;
    }

    instanceCount += len;
    if (instanceCount >= maxInstanceCount) break;
  }

  return distanceToTargets;
}

// export { computeStreamlineToTargets };

//*

function computeStreamlineToTargets(
  targetArray,              // Float32Array
  distanceToTargets,        // Float32Array, output: distance per segment
  instanceWeight,           // Float32Array, one per segment
  pointOffset,              // Int32Array, length nTracts+1
  pointPositions,           // Float32Array, length ~ 3*(total segments+1)
  tractRange,               // Uint32Array, nTracts * 3
  maxInstanceCount = Infinity // Maximum number of instances
) {
  const nTracts = tractRange.length / 3;
  const nTargets = targetArray.length / 3;

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

    let minDistSq = Infinity;
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

      for (let j = 0; j < nTargets; j++) {
        target.fromArray( targetArray, j * 3 );
        const d2 = pt.distanceToSquared(target);
        if (d2 < minDistSq) {
          minDistSq = d2;
        }
      }

      previousDist = Math.sqrt(minDistSq);

    }

    const dist = isFinite(minDistSq) ? Math.sqrt(minDistSq) : 1e8;
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

export { computeStreamlineToTargets };
//*/
