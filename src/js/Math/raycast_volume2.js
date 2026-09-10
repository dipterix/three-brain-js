import { Vector3, Matrix4, Matrix3 } from 'three';

/**
 * Find the first non-transparent voxel a ray crosses, by marching in voxel
 * index space.
 *
 * The companion `raycast_volume.js` walks every (i,j) column of the volume --
 * O(mx*my), ~65k iterations for a 256^3 cube -- and picks the above-threshold
 * voxel nearest the ray. That is the right shape for electrode localization,
 * where the user clicks *near* a CT blob. It is the wrong shape for picking,
 * where the question is simply "what does this ray hit first".
 *
 * Marching in IJK is what makes this cheap and exact: indices are integers, so
 * stepping one unit along the dominant axis and rounding lands on voxel centres
 * without ever skipping one. Cost is bounded by `max(shape) * sqrt(3)`.
 */

const _origin = new Vector3();
const _direction = new Vector3();
const _point = new Vector3();
const _world2vox = new Matrix4();
const _rotation = new Matrix3();

/**
 * @param {Object} options
 * @param {Vector3} options.origin - ray origin, world space
 * @param {Vector3} options.direction - ray direction, world space
 * @param {Matrix4} options.vox2world - voxel index -> world; the caller owns
 *   this because how it is built differs by volume source (see `DataCube2`)
 * @param {Vector3} options.shape - volume dimensions in voxels
 * @param {ArrayLike<number>} options.voxelColor - interleaved colors, alpha last
 * @param {number} [options.nColorChannels=4] - 1 for RedFormat, else 4
 * @returns {{ index: Vector3, point: Vector3 }|undefined} the voxel index and
 *   its world position, or undefined when the ray misses or crosses only
 *   transparent voxels. `point` is a fresh Vector3; `index` is reused.
 */
function raycastVoxelVolume({
  origin, direction, vox2world, shape, voxelColor, nColorChannels = 4
} = {}) {

  if( !origin || !direction || !vox2world || !shape || !voxelColor ) { return; }

  const mx = shape.x, my = shape.y, mz = shape.z;
  if( !( mx > 0 && my > 0 && mz > 0 ) ) { return; }

  // world -> voxel index
  _world2vox.copy( vox2world ).invert();
  _origin.copy( origin ).applyMatrix4( _world2vox );

  // directions carry no translation, so use the rotation/scale part only
  _rotation.setFromMatrix4( _world2vox );
  _direction.copy( direction ).applyMatrix3( _rotation );
  if( _direction.lengthSq() <= 0 ) { return; }
  _direction.normalize();

  // Slab test against the voxel grid. Bounds are [-0.5, n - 0.5] because index
  // `i` is the centre of a voxel one unit wide.
  let tEnter = -Infinity, tExit = Infinity;
  const lo = [ -0.5, -0.5, -0.5 ];
  const hi = [ mx - 0.5, my - 0.5, mz - 0.5 ];
  const o = [ _origin.x, _origin.y, _origin.z ];
  const d = [ _direction.x, _direction.y, _direction.z ];

  for( let axis = 0; axis < 3; axis++ ) {
    if( Math.abs( d[ axis ] ) < 1e-10 ) {
      // parallel to this slab: either always inside it or never
      if( o[ axis ] < lo[ axis ] || o[ axis ] > hi[ axis ] ) { return; }
      continue;
    }
    const inv = 1 / d[ axis ];
    let t0 = ( lo[ axis ] - o[ axis ] ) * inv;
    let t1 = ( hi[ axis ] - o[ axis ] ) * inv;
    if( t0 > t1 ) { const tmp = t0; t0 = t1; t1 = tmp; }
    if( t0 > tEnter ) { tEnter = t0; }
    if( t1 < tExit ) { tExit = t1; }
    if( tEnter > tExit ) { return; }
  }

  // never look behind the ray origin
  if( tExit < 0 ) { return; }
  if( tEnter < 0 ) { tEnter = 0; }

  // Amanatides-Woo: step to the next voxel boundary each iteration rather than
  // by a fixed distance.
  //
  // A fixed step of one voxel along the dominant axis is not enough. For a
  // near-diagonal ray it jumps straight from (0,0,0) to (1,1,1) while the ray
  // really passes through (1,0,1) -- so the first lit voxel can be missed. Voxel
  // `i` owns [i-0.5, i+0.5], so advancing to the nearest of the three boundaries
  // visits exactly the voxels the ray crosses, in order, and never skips one.
  const idx = [
    Math.round( _origin.x + _direction.x * tEnter ),
    Math.round( _origin.y + _direction.y * tEnter ),
    Math.round( _origin.z + _direction.z * tEnter ),
  ];
  const bound = [ mx, my, mz ];
  const stepDir = [ 0, 0, 0 ];
  const tMax = [ Infinity, Infinity, Infinity ];
  const tDelta = [ Infinity, Infinity, Infinity ];

  for( let axis = 0; axis < 3; axis++ ) {
    if( Math.abs( d[ axis ] ) < 1e-10 ) { continue; }
    stepDir[ axis ] = d[ axis ] > 0 ? 1 : -1;
    // coordinate of the boundary we are heading towards
    const nextBoundary = idx[ axis ] + 0.5 * stepDir[ axis ];
    tMax[ axis ] = ( nextBoundary - o[ axis ] ) / d[ axis ];
    tDelta[ axis ] = Math.abs( 1 / d[ axis ] );
  }

  const alphaOffset = nColorChannels - 1;

  // the entry voxel can sit just outside when the ray grazes a face
  for( let guard = 0; guard < 4 * ( mx + my + mz ); guard++ ) {

    const i = idx[0], j = idx[1], k = idx[2];

    if( i >= 0 && i < mx && j >= 0 && j < my && k >= 0 && k < mz ) {
      const voxelIndex = i + mx * ( j + my * k );
      if( voxelColor[ voxelIndex * nColorChannels + alphaOffset ] > 0 ) {
        _point.set( i, j, k );
        return {
          index : _point,
          point : new Vector3( i, j, k ).applyMatrix4( vox2world ),
        };
      }
    }

    // advance along whichever axis reaches its boundary first
    let axis = 0;
    if( tMax[1] < tMax[ axis ] ) { axis = 1; }
    if( tMax[2] < tMax[ axis ] ) { axis = 2; }
    if( !isFinite( tMax[ axis ] ) ) { return; }
    if( tMax[ axis ] > tExit ) { return; }

    idx[ axis ] += stepDir[ axis ];
    tMax[ axis ] += tDelta[ axis ];

    // left the grid along this axis and can never come back
    if( idx[ axis ] < 0 && stepDir[ axis ] < 0 ) { return; }
    if( idx[ axis ] >= bound[ axis ] && stepDir[ axis ] > 0 ) { return; }
  }

  return;
}

export { raycastVoxelVolume };
