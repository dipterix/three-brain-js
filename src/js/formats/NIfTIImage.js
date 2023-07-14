import nifti from 'nifti-reader-js';
import {
  Vector3, Vector4, Matrix4, ByteType, ShortType, IntType,
  FloatType, UnsignedByteType, UnsignedShortType,
} from 'three';

class NiftiImage {
  constructor ( data ) {
    // parse nifti
    if (nifti.isCompressed(data)) {
        data = nifti.decompress(data);
    }

    this.header = nifti.readHeader(data);
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

    this.isNiftiImage = true;

    // IJK to RAS
    // determine which matrix to use
    // c(1, 4, 2, 5, 3, 0)
    const preferred_code = [1, 4, 2, 5, 3, 0];
    let sformRank = preferred_code.indexOf( this.header.sform_code );
    if( sformRank < 0 ) { sformRank = 6; }
    let qformRank = preferred_code.indexOf( this.header.qform_code );
    if( qformRank < 0 ) { qformRank = 6; }

    if( sformRank > qformRank ) {
      /** A special case, use method 2
        mat <- diag(c(nii@pixdim[seq(2,4)], 1))
        mat[3, ] <- mat[3, ] * nii@pixdim[[1]]
        mat[1, 4] <- nii@qoffset_x
        mat[2, 4] <- nii@qoffset_y
        mat[3, 4] <- nii@qoffset_z
        code <- qform_code
      this.affine = new Matrix4().set(
        this.header.pixDims[1], 0, 0, ?,
        0, this.header.pixDims[2], 0, ?,
        0, 0, this.header.pixDims[0] * this.header.pixDims[3], ?,
        0, 0, 0, 1
      )
      */
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

  }

  normalize () {
    if( this.normalized ) { return; }
    if( this.dataIsInt8 || this.dataIsUInt8 ) { return; }

    // inplace since no enough memory
    let maxV = -Infinity, minV = Infinity, tmpV = 0;
    for( let ii = 0; ii < this.image.length; ii++ ) {
      tmpV = this.image[ ii ];
      if( tmpV > maxV ) {
        maxV = tmpV;
      }
      if( tmpV < minV ) {
        minV = tmpV;
      }
    }
    let intercept = 0, slope = 1;
    if( maxV < 0 || minV >= 1 ) {
      intercept = -minV;
      slope = 1.0 / (maxV - minV);
    } else if ( maxV > 1 ) {
      // only positive part
      slope = 1.0 / maxV;
    }

    if( intercept != 0 || slope != 1 ) {
      const newImage = new Float32Array( this.image.length );

      for( let ii = 0; ii < this.image.length; ii++ ) {
        newImage[ ii ] = ( this.image[ ii ] + intercept ) * slope;
      }

      this.image = newImage;
      this.imageDataType = FloatType;
      this.dataIsFloat32 = true;
    }

    this.normalized = true;
  }

  dispose () {
    this.header = NaN;
    this.image = NaN;
    this.affine = NaN;
    this.shape = NaN
    this.ijkIndexOrder = NaN;
    this.model2RAS = NaN
  }

}

export { NiftiImage }
