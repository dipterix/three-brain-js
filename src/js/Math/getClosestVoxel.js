import { Vector3, Matrix4 } from 'three';

/**
 * The selected voxel (continuous: value within the volume's selected range;
 * discrete: a selected label) whose *center* is closest to `srcPos_`, within
 * `radius_` mm, skipping voxels within `excludeRadius_` of `excludePos_`.
 *
 * Voxel centers sit at integer indices (`model2vox`, as the volume's
 * ray-march, its slice overlay and the CPU readouts use); the returned
 * `minDistanceXYZ` is that center in world (tkrRAS) coordinates.
 */
function getClosestVoxel( inst, srcPos_, radius_, excludePos_, excludeRadius_ ) {

  if( !inst || !inst.isDataCube2 ){ return; }

  const origin = new Vector3(),
        pos = new Vector3(),
        maxDelta = new Vector3(),
        tmp1 = new Vector3();

  const isContinuous = inst.isDataContinuous || false;
  const selectedDataValues = inst._selectedDataValues;
  let hasExclusion = false;

  // voxel index -> world, and back
  const vox2world = new Matrix4().copy( inst.model2vox ).invert()
    .premultiply( inst.object.matrixWorld );
  const world2vox = vox2world.clone().invert();

  // source position in voxel indices
  origin.copy( srcPos_ ).applyMatrix4( world2vox );
  if( excludePos_ !== undefined && excludePos_.isVector3 ) {
    if( excludeRadius_ && excludeRadius_ > 0 ) {
      hasExclusion = true;
    }
  }

  // how many voxels one mm spans along each index axis, at most
  pos.set(0, 0, 0).applyMatrix4(world2vox);
  tmp1.set(1, 0, 0).applyMatrix4(world2vox).sub(pos);
  maxDelta.x = Math.max( Math.abs( tmp1.x ), maxDelta.x );
  maxDelta.y = Math.max( Math.abs( tmp1.y ), maxDelta.y );
  maxDelta.z = Math.max( Math.abs( tmp1.z ), maxDelta.z );

  tmp1.set(0, 1, 0).applyMatrix4(world2vox).sub(pos);
  maxDelta.x = Math.max( Math.abs( tmp1.x ), maxDelta.x );
  maxDelta.y = Math.max( Math.abs( tmp1.y ), maxDelta.y );
  maxDelta.z = Math.max( Math.abs( tmp1.z ), maxDelta.z );

  tmp1.set(0, 0, 1).applyMatrix4(world2vox).sub(pos);
  maxDelta.x = Math.max( Math.abs( tmp1.x ), maxDelta.x );
  maxDelta.y = Math.max( Math.abs( tmp1.y ), maxDelta.y );
  maxDelta.z = Math.max( Math.abs( tmp1.z ), maxDelta.z );

  maxDelta.multiplyScalar( radius_ );

  // voxel centers that can be within the radius, inside the volume (an index
  // outside it would wrap into a neighboring row of the flat array)
  const shape = inst.modelShape;
  const searchLB = new Vector3().set(
    Math.max( 0, Math.ceil( origin.x - maxDelta.x ) ),
    Math.max( 0, Math.ceil( origin.y - maxDelta.y ) ),
    Math.max( 0, Math.ceil( origin.z - maxDelta.z ) )
  );
  const searchUB = new Vector3().set(
    Math.min( shape.x - 1, Math.floor( origin.x + maxDelta.x ) ),
    Math.min( shape.y - 1, Math.floor( origin.y + maxDelta.y ) ),
    Math.min( shape.z - 1, Math.floor( origin.z + maxDelta.z ) )
  );

  tmp1.set(1, shape.x, shape.x * shape.y);

  let i, j, k, voxelData, distance;
  let minDistance = Infinity, minDistanceIJK = new Vector3();

  for( i = searchLB.x; i <= searchUB.x; i++ ) {
    for( j = searchLB.y; j <= searchUB.y; j++ ) {
      for( k = searchLB.z; k <= searchUB.z; k++ ) {

        pos.set(i, j, k);

        voxelData = inst.voxelData[ pos.dot( tmp1 ) ];

        if( isContinuous ) {
          if( !( voxelData >= selectedDataValues[0] && voxelData <= selectedDataValues[1] ) ) {
            continue;
          }
        } else {
          if( !selectedDataValues[ voxelData ] ) {
            continue;
          }
        }

        // the voxel center in tkrRAS
        pos.applyMatrix4( vox2world );
        if( hasExclusion && pos.distanceTo( excludePos_ ) <= excludeRadius_ ) {
          continue;
        }

        distance = pos.distanceTo( srcPos_ );
        if( distance > radius_ ) {
          continue;
        }

        if( distance < minDistance ) {
          minDistanceIJK.set(i, j, k);
          minDistance = distance;
        }

      }
    }
  }


  return {
    minDistance: minDistance,
    minDistanceIJK: minDistanceIJK,
    minDistanceXYZ: minDistanceIJK.clone().applyMatrix4( vox2world )
  };
}

export { getClosestVoxel };
