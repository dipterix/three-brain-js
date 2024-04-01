import nifti from 'nifti-reader-js';
import {
  Vector3, Vector4, Matrix4, ByteType, ShortType, IntType,
  FloatType, UnsignedByteType, UnsignedShortType,
} from 'three';

class NiftiImage {
  constructor ( data ) {
    this.isInvalid = true;
    if(!data) { return; }
    // parse nifti
    if (nifti.isCompressed(data)) {
        data = nifti.decompress(data);
    }

    this.header = nifti.readHeader(data);

    this.slope = this.header.scl_slope || 1;
    this.intercept = this.header.scl_inter || 0;
    this.calMin = this.header.cal_min || 0;
    this.calMax = this.header.cal_max || 0;

    const niftiImage = nifti.readImage(this.header, data);
    if (this.header.datatypeCode === nifti.NIFTI1.TYPE_INT8) {
      this.image = new Int8Array(niftiImage);
      this.imageDataType = ByteType;
      this.dataIsInt8 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_INT16) {
      this.image = new Int16Array(niftiImage);
      this.imageDataType = ShortType;
      this.dataIsInt16 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_INT32) {
      this.image = new Int32Array(niftiImage);
      this.imageDataType = IntType;
      this.dataIsInt32 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_FLOAT32) {
      this.image = new Float32Array(niftiImage);
      this.imageDataType = FloatType;
      this.dataIsFloat32 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_FLOAT64) {
      // we do not support this, need to make transform later
      this.image = new Float64Array(niftiImage);
      this.dataIsFloat64 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_UINT8) {
      this.image = new Uint8Array(niftiImage);
      this.imageDataType = UnsignedByteType;
      this.dataIsUInt8 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_UINT16) {
      this.image = new Uint16Array(niftiImage);
      this.imageDataType = UnsignedShortType;
      this.dataIsUInt16 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_UINT32) {
      this.image = new Uint32Array(niftiImage);
      this.imageDataType = UnsignedIntType;
      this.dataIsUInt32 = true;
    } else {
      console.warn("NiftiImage: Cannot load NIFTI image data: the data type code is unsupported.")
    }

    if( this.calMax === 0 ) {
      let maxV = 1, minV = 0;
      if( this.image.length > 0 ) {
        maxV = this.image[0];
        minV = this.image[0];

        this.image.forEach( ( v ) => {
          if( v > maxV ) {
            maxV = v;
          } else if ( v < minV ) {
            minV = v;
          }
        });
      }
      this.calMin = minV * this.slope + this.intercept;
      this.calMax = maxV * this.slope + this.intercept;
    }

    this.isNiftiImage = true;

    // IJK to RAS
    // determine which matrix to use

    /* WHY 3 METHODS?
     --------------
     Method 1 is provided only for backwards compatibility.  The intention
     is that Method 2 (qform_code > 0) represents the nominal voxel locations
     as reported by the scanner, or as rotated to some fiducial orientation and
     location.  Method 3, if present (sform_code > 0), is to be used to give
     the location of the voxels in some standard space.  The sform_code
     indicates which standard space is present.  Both methods 2 and 3 can be
     present, and be useful in different contexts (method 2 for displaying the
     data on its original grid; method 3 for displaying it on a standard grid).
    */

    if ( this.header.sform_code <= 0 ) {
      this.header.affine = this.header.getQformMat();
    }

    this.affine = new Matrix4().set(
      this.header.affine[0][0],
      this.header.affine[0][1],
      this.header.affine[0][2],
      this.header.affine[0][3],
      this.header.affine[1][0],
      this.header.affine[1][1],
      this.header.affine[1][2],
      this.header.affine[1][3],
      this.header.affine[2][0],
      this.header.affine[2][1],
      this.header.affine[2][2],
      this.header.affine[2][3],
      this.header.affine[3][0],
      this.header.affine[3][1],
      this.header.affine[3][2],
      this.header.affine[3][3]
    );

    this.shape = new Vector3(
      this.header.dims[1],
      this.header.dims[2],
      this.header.dims[3]
    );

    // threeBrain uses the volume center as origin, hence the transform
    // is shifted
    const crsOrder = new Vector4( 1, 1, 1, 0 ).applyMatrix4( this.affine );
    const shift = new Matrix4().set(
      1, 0, 0, (this.shape.x - 1) / 2,
      0, 1, 0, (this.shape.y - 1) / 2 ,
      0, 0, 1, (this.shape.z - 1) / 2,
      0, 0, 0, 1
    );
    this.model2vox = shift;

    this.ijkIndexOrder = new Vector3().copy( crsOrder );

    // IJK to scanner RAS (of the image)
    this.model2RAS = this.affine.clone().multiply( shift );

    // IJK to tkrRAS
    this.model2tkrRAS = this.affine.clone().setPosition(0, 0, 0);
    const tOrigTranslate = this.shape.clone()
      .multiplyScalar( -0.5 )
      .applyMatrix4( this.model2tkrRAS );
    this.model2tkrRAS.setPosition(
      tOrigTranslate.x,
      tOrigTranslate.y,
      tOrigTranslate.z,
    );
    this.model2tkrRAS.multiply( shift );
    this.isInvalid = false;

  }

  getNormalizedImage () {

    const slope = this.slope || 1;
    const intercept = this.intercept;
    const calMin = this.calMin;
    const calMax = this.calMax;
    const calSpread = calMax == calMin ? 1 : (calMax - calMin);
    const calInterc = ( intercept - calMin ) / calSpread;
    const calSlope = slope / calSpread;

    const newImage = Float32Array.from( this.image, (x) => {
      // return ( slope * x + intercept - calMin ) / calSpread;
      return calSlope * x + calInterc;
    });

    return newImage;
  }

  dispose () {
    this.header = undefined;
    this.image = undefined;
    this.affine = undefined;
    this.shape = undefined;
    this.ijkIndexOrder = undefined;
    this.model2RAS = undefined;
    this.model2vox = undefined;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    if(this.isInvalid) { return this; }

    this.header = el.header;
    this.image = el.image;
    this.imageDataType = el.imageDataType;

    if( el.dataIsInt8 ) {
      this.dataIsInt8 = true;
    } else if( el.dataIsInt16 ) {
      this.dataIsInt16 = true;
    } else if( el.dataIsInt32 ) {
      this.dataIsInt32 = true;
    } else if( el.dataIsFloat32 ) {
      this.dataIsFloat32 = true;
    } else if( el.dataIsFloat64 ) {
      this.dataIsFloat64 = true;
    } else if( el.dataIsUInt8 ) {
      this.dataIsUInt8 = true;
    } else if( el.dataIsUInt16 ) {
      this.dataIsUInt16 = true;
    } else if( el.dataIsUInt32 ) {
      this.dataIsUInt32 = true;
    }

    this.slope = el.slope || 1;
    this.intercept = el.intercept;
    this.calMin = el.calMin;
    this.calMax = el.calMax;

    this.isNiftiImage = true;

    this.affine = new Matrix4().copy( el.affine );
    this.shape = new Vector3().copy( el.shape );
    this.ijkIndexOrder = new Vector3().copy( el.ijkIndexOrder );

    this.model2RAS = new Matrix4().copy( el.model2RAS );

    this.model2tkrRAS = new Matrix4().copy( el.model2tkrRAS );

    this.model2vox = new Matrix4().copy( el.model2vox );

    return this;
  }

}

export { NiftiImage }
