import { Vector3, Matrix4 } from 'three';

function getClosestVoxel( inst, srcPos_, radius_, excludePos_, excludeRadius_ ) {

  if( !inst || !inst.isDataCube2 ){ return; }

  const origin = new Vector3(),
        excludePos = new Vector3(),
        pos = new Vector3(),
        maxDelta = new Vector3(),
        tmp1 = new Vector3();
  const matrix_ = new Matrix4(),
        matrix_inv = new Matrix4();

  const colorChannels = inst.nColorChannels;
  const isContinuous = inst.isDataContinuous || false;
  const selectedDataValues = inst._selectedDataValues;
  let hasExclusion = false;

  matrix_.setPosition(
    -inst.modelShape.x / 2,
    -inst.modelShape.y / 2,
    -inst.modelShape.z / 2
  ).premultiply( inst.object.matrixWorld );
  matrix_inv.copy(matrix_).invert();

  // src position in model IJK
  origin.copy( srcPos_ ).applyMatrix4( matrix_inv );
  if( excludePos_ !== undefined && excludePos_.isVector3 ) {
    if( excludeRadius_ && excludeRadius_ > 0 ) {
      hasExclusion = true;
    }
  }

  pos.set(0, 0, 0).applyMatrix4(matrix_inv);
  tmp1.set(1, 0, 0).applyMatrix4(matrix_inv).sub(pos);
  maxDelta.x = Math.max( Math.abs( tmp1.x ), maxDelta.x );
  maxDelta.y = Math.max( Math.abs( tmp1.y ), maxDelta.y );
  maxDelta.z = Math.max( Math.abs( tmp1.z ), maxDelta.z );

  tmp1.set(0, 1, 0).applyMatrix4(matrix_inv).sub(pos);
  maxDelta.x = Math.max( Math.abs( tmp1.x ), maxDelta.x );
  maxDelta.y = Math.max( Math.abs( tmp1.y ), maxDelta.y );
  maxDelta.z = Math.max( Math.abs( tmp1.z ), maxDelta.z );

  tmp1.set(0, 0, 1).applyMatrix4(matrix_inv).sub(pos);
  maxDelta.x = Math.max( Math.abs( tmp1.x ), maxDelta.x );
  maxDelta.y = Math.max( Math.abs( tmp1.y ), maxDelta.y );
  maxDelta.z = Math.max( Math.abs( tmp1.z ), maxDelta.z );

  maxDelta.multiplyScalar( radius_ );

  const searchLB = new Vector3().set(
    Math.floor( origin.x - maxDelta.x ),
    Math.floor( origin.y - maxDelta.y ),
    Math.floor( origin.z - maxDelta.z )
  );
  const searchUB = new Vector3().set(
    Math.floor( origin.x + maxDelta.x ),
    Math.floor( origin.y + maxDelta.y ),
    Math.floor( origin.z + maxDelta.z )
  );

  tmp1.set(1, inst.modelShape.x, inst.modelShape.x * inst.modelShape.y);

  let i, j, k, voxelData, distance;
  let minDistance = Infinity, minDistanceIJK = new Vector3();

  for( i = searchLB.x; i <= searchUB.x; i++ ) {
    for( j = searchLB.y; j <= searchUB.y; j++ ) {
      for( k = searchLB.z; k <= searchUB.z; k++ ) {

        // selectedDataValues
        pos.set(i, j, k);

        voxelData = inst.voxelData[ pos.dot( tmp1 ) ];

        if( isContinuous ) {
          if( voxelData < selectedDataValues[0] || voxelData > selectedDataValues[1] ) {

            continue;
          }
        } else {
          if( !selectedDataValues[ voxelData ] ) {
            continue;
          }
        }

        // pos is voxel in tkrRAS
        pos.applyMatrix4( matrix_ );
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
    minDistanceXYZ: minDistanceIJK.clone().applyMatrix4( matrix_ )
  };
}

export { getClosestVoxel };
