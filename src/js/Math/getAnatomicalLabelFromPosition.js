import { Vector3 } from 'three';

/**
 * preferredIndexRange can be
 * [a, b] (index >= a & index <=b)
 * [[a,b], [c,d]] (index >= a & index <=b or index >= c & index <=d)
 */

function isPreferredLabel( index, preferredIndexRange ) {

  if( !Array.isArray(preferredIndexRange) || preferredIndexRange.length === 0 ) {
    return true;
  }
  if( preferredIndexRange.length >= 2 && typeof preferredIndexRange[0] == "number" ) {
    preferredIndexRange = [ preferredIndexRange ];
  }
  for(let i = 0; i < preferredIndexRange.length; i++ ) {
    const range = preferredIndexRange[ i ];
    if( Array.isArray(range) && range.length > 0 ) {
      if( range.length === 1 && index === range[ 0 ] ) { return true; }
      if( range.length > 1) {
        if( index >= range[ 0 ] && index <= range[ 1 ] ) {
          return true;
        }
      }
    }
  }
  return false;

}

function getAnatomicalLabelFromPosition(
  position, atlasInstance, { preferredIndexRange, maxStepSize = 2.0 } = {}
) {
  if( typeof atlasInstance !== "object" || !atlasInstance.isThreeBrainObject ||
      !atlasInstance.isDataCube2 ) {
    return {
      index : 0,
      label : "Unknown"
    };
  }
  // always available
  const fslut = canvas.global_data("__global_data__.FSColorLUT");
  // model to world and inverse
  const matrix_ = atlasInstance.object.matrixWorld.clone(),
        matrix_inv = matrix_.clone().invert();

  const modelShape = new Vector3().copy( atlasInstance.modelShape );

  const mx = modelShape.x,
        my = modelShape.y,
        mz = modelShape.z;
  // data cube (integers)
  const atlasVoxelData = atlasInstance.voxelData;

  const pos = new Vector3().set(1, 0, 0),
        pos0 = new Vector3().set(0, 0, 0).applyMatrix4(matrix_);

  const delta = new Vector3().set(
    1 / pos.set(1, 0, 0).applyMatrix4(matrix_).sub(pos0).length(),
    1 / pos.set(0, 1, 0).applyMatrix4(matrix_).sub(pos0).length(),
    1 / pos.set(0, 0, 1).applyMatrix4(matrix_).sub(pos0).length()
  );

  // world -> model (voxel coordinate)
  pos.copy( position ).applyMatrix4(matrix_inv);

  // round model coord -> IJK coord
  const ijk0 = new Vector3().set(
    Math.round( ( pos.x + modelShape.x / 2 ) - 1.0 ),
    Math.round( ( pos.y + modelShape.y / 2 ) - 1.0 ),
    Math.round( ( pos.z + modelShape.z / 2 ) - 1.0 )
  );
  const ijk1 = new Vector3().set(
    Math.max( Math.min( ijk0.x, mx - delta.x * maxStepSize - 1 ), delta.x * maxStepSize ),
    Math.max( Math.min( ijk0.y, my - delta.y * maxStepSize - 1 ), delta.y * maxStepSize ),
    Math.max( Math.min( ijk0.z, mz - delta.z * maxStepSize - 1 ), delta.z * maxStepSize )
  );

  const ijk_idx = ijk1.clone();

  // from IJK to array index multiplier factor
  const multiplyFactor = new Vector3().set( 1, mx, mx * my );
  let count = {};
  let label_id = atlasVoxelData[ ijk0.dot(multiplyFactor) ] || 0;

  if( label_id === 0 || !isPreferredLabel( label_id, preferredIndexRange ) ) {
    for(
      ijk_idx.x = Math.round( ijk1.x - delta.x * maxStepSize );
      ijk_idx.x <= Math.round( ijk1.x + delta.x * maxStepSize );
      ijk_idx.x += 1
    ) {
      for(
        ijk_idx.y = Math.round( ijk1.y - delta.y * maxStepSize );
        ijk_idx.y <= Math.round( ijk1.y + delta.y * maxStepSize );
        ijk_idx.y += 1
      ) {
        for(
          ijk_idx.z = Math.round( ijk1.z - delta.z * maxStepSize );
          ijk_idx.z <= Math.round( ijk1.z + delta.z * maxStepSize );
          ijk_idx.z += 1
        ) {
          label_id = atlasVoxelData[ ijk_idx.dot(multiplyFactor) ];
          if( label_id > 0 ){
            count[ label_id ] = ( count[ label_id ] || 0 ) + 1;
          }
        }
      }
    }


    const keys = Object.keys(count);
    let preferredKeys = keys.filter(k => {
      return isPreferredLabel( parseInt(k), preferredIndexRange );
    });
    if( preferredKeys.length === 0 ) {
      preferredKeys = keys;
    }
    if( preferredKeys.length > 0 ){
      label_id = preferredKeys.reduce((a, b) => count[a] > count[b] ? a : b);
      label_id = parseInt( label_id );
    }
  }


  // find label
  if( label_id == 0 ){
    return {
      index : 0,
      label : "Unknown"
    };
  }

  try {
    const lbl = fslut.map[ label_id ].Label;
    if( lbl ){
      return {
        index : label_id,
        label : lbl
      };
    } else {
      return {
        index : 0,
        label : "Unknown"
      };
    }
  } catch (e) {
    return {
      index : 0,
      label : "Unknown"
    };
  }

}


export { getAnatomicalLabelFromPosition };
