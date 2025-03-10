import nifti from 'nifti-reader-js';
import { decompressSync } from 'fflate';
import { Vector3, Vector4, Matrix4, ShortType, IntType, FloatType, UnsignedByteType } from 'three';

class MGHImage {
  constructor ( data ) {
    this.isMGHImage = true;
    this.isInvalid = true;

    if( !data ) { return; }

    // data is binary file buffer
    let raw = data;
    let reader = new DataView( data );

    // check if data is gz-compressed (MGZ)
    if( reader.getUint8(0) === 31 && reader.getUint8(1) === 139 ) {
      const decompressed = decompressSync( new Uint8Array(data) );
      raw = decompressed.buffer;
      reader = new DataView( raw );
    }
    let version = reader.getInt32(0, false);
    let width = reader.getInt32(4, false);
    let height = reader.getInt32(8, false);
    let depth = reader.getInt32(12, false);
    let nframes = reader.getInt32(16, false);
    let mtype = reader.getInt32(20, false);
    let spacingX = reader.getFloat32(30, false);
    let spacingY = reader.getFloat32(34, false);
    let spacingZ = reader.getFloat32(38, false);
    let xr = reader.getFloat32(42, false);
    let xa = reader.getFloat32(46, false);
    let xs = reader.getFloat32(50, false);
    let yr = reader.getFloat32(54, false);
    let ya = reader.getFloat32(58, false);
    let ys = reader.getFloat32(62, false);
    let zr = reader.getFloat32(66, false);
    let za = reader.getFloat32(70, false);
    let zs = reader.getFloat32(74, false);
    let cr = reader.getFloat32(78, false);
    let ca = reader.getFloat32(82, false);
    let cs = reader.getFloat32(86, false);
    this._MGHHeader = {
      version : version,
      width : width, height : height, depth : depth, nframes : nframes,
      mtype : mtype,
      spacingX : spacingX, spacingY : spacingY, spacingZ : spacingZ,
      xr : xr, xa : xa, xs : xs,
      yr : yr, ya : ya, ys : ys,
      zr : zr, za : za, zs : zs,
      cr : cr, ca : ca, cs : cs
    };

    this.header = new nifti.NIFTI1();
    const isLittleEndian = false;
    this.header.littleEndian = isLittleEndian; // always big endian
    this.header.dims = [3, 1, 1, 1, 0, 0, 0, 0];
    this.header.pixDims = [1, 1, 1, 1, 1, 0, 0, 0];

    if (version !== 1 || mtype < 0 || mtype > 4) {
      console.warn("MGHImage: this is an invalid MGH/MGZ file");
      this.isInvalid = true;
      return;
    }
    if (mtype === 0) {
      this.header.numBitsPerVoxel = 8;
      this.header.datatypeCode = nifti.NIFTI1.TYPE_UINT8;
    } else if (mtype === 4) {
      this.header.numBitsPerVoxel = 16;
      this.header.datatypeCode = nifti.NIFTI1.TYPE_INT16;
    } else if (mtype === 1) {
      this.header.numBitsPerVoxel = 32;
      this.header.datatypeCode = nifti.NIFTI1.TYPE_INT32;
    } else if (mtype === 3) {
      this.header.numBitsPerVoxel = 32;
      this.header.datatypeCode = nifti.NIFTI1.TYPE_FLOAT32;
    }

    this.header.dims[1] = width;
    this.header.dims[2] = height;
    this.header.dims[3] = depth;
    this.header.dims[4] = nframes;
    if (nframes > 1) { this.header.dims[0] = 4; }
    this.header.pixDims[1] = spacingX;
    this.header.pixDims[2] = spacingY;
    this.header.pixDims[3] = spacingZ;
    this.header.vox_offset = 284;
    this.header.sform_code = 1;

    this.slope = this.header.scl_slope = 1;
    this.intercept = this.header.scl_inter = 0;

    // Get Torig: IJK to tkrRAS: this Torig only contains rotation part. need to calculate translation
    const Torig = new Matrix4().set(
      xr * spacingX, yr * spacingY, zr * spacingZ, 0,
      xa * spacingX, ya * spacingY, za * spacingZ, 0,
      xs * spacingX, ys * spacingY, zs * spacingZ, 0,
      0, 0, 0, 1
    );
    // center of IJK
    const Pcrs = new Vector3().set( width, height, depth ).divideScalar( 2.0 );

    // rotation * Pcrs -> PxyzOffset
    // Torig * Pcrs -> 0,0,0
    // hence (rotation - Torig) * Pcrs = PxyzOffset
    const PxyzOffset = new Vector3().copy( Pcrs )
      .applyMatrix4( Torig );

    /**
     * (rotation - Torig) * Pcrs = PxyzOffset
     * [0 0 0 -Torig.x]    Pcrs.x    PxyzOffset.x
     * [0 0 0 -Torig.y]  * Pcrs.y =  PxyzOffset.y
     * [0 0 0 -Torig.z]    Pcrs.z    PxyzOffset.z
     * [0 0 0        0]    1         0
     * => Torig.xyz = -PxyzOffset.xyz
     */
    Torig.setPosition( -PxyzOffset.x, -PxyzOffset.y, -PxyzOffset.z );

    this.ijk2tkrRAS = Torig;

    // Norig is `affine`, which is Torig + cRAS
    const Norig = Torig.clone();
    Norig.setPosition( -PxyzOffset.x + cr, -PxyzOffset.y + ca, -PxyzOffset.z + cs );

    this.affine = Norig;

    const nElements = this.header.dims[1] * this.header.dims[2] * this.header.dims[3] * this.header.dims[4];
    const nBytes = nElements * (this.header.numBitsPerVoxel / 8);

    const imageDataBuf = raw.slice(this.header.vox_offset, this.header.vox_offset + nBytes);

    const dataReader = new DataView( imageDataBuf );
    if (this.header.datatypeCode === nifti.NIFTI1.TYPE_INT16) {
      this.image = new Int16Array( nElements );
      for( let ii = 0 ; ii < nElements ; ii++ ) {
        this.image[ ii ] = dataReader.getInt16(ii * 2, isLittleEndian);
      }
      this.imageDataType = ShortType;
      this.dataIsInt16 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_INT32) {
      this.image = new Int32Array( nElements );
      for( let ii = 0 ; ii < nElements ; ii++ ) {
        this.image[ ii ] = dataReader.getInt32(ii * 4, isLittleEndian);
      }
      this.imageDataType = IntType;
      this.dataIsInt32 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_FLOAT32) {
      this.image = new Float32Array( nElements );
      for( let ii = 0 ; ii < nElements ; ii++ ) {
        this.image[ ii ] = dataReader.getFloat32(ii * 4, isLittleEndian);
      }
      this.imageDataType = FloatType;
      this.dataIsFloat32 = true;
    } else if (this.header.datatypeCode === nifti.NIFTI1.TYPE_UINT8) {
      this.image = new Uint8Array( imageDataBuf );
      this.imageDataType = UnsignedByteType;
      this.dataIsUInt8 = true;
    }

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
    this.calMin = this.header.cal_min = minV * this.slope + this.intercept;
    this.calMax = this.header.cal_max = maxV * this.slope + this.intercept;


    this.shape = new Vector3(
      this.header.dims[1],
      this.header.dims[2],
      this.header.dims[3]
    );

    // threeBrain uses the volume center as origin, hence the transform
    // is shifted. Also needs to take care of the CRS order (positive vs negative)
    const crsOrder = new Vector4( 1, 1, 1, 0 ).applyMatrix4( this.affine );
    const shift = new Matrix4().set(
      1, 0, 0, (this.shape.x) / 2 - 0.5,
      0, 1, 0, (this.shape.y) / 2 - 0.5,
      0, 0, 1, (this.shape.z) / 2 - 0.5,
      0, 0, 0, 1
    );
    this.model2vox = shift;

    this.ijkIndexOrder = new Vector3().copy( crsOrder );

    // IJK to scanner RAS (of the image)
    this.model2RAS = this.affine.clone().multiply( shift );

    this.model2tkrRAS = this.ijk2tkrRAS.clone().multiply( shift );

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

  dispose() {
    this.isInvalid = false;
    this._MGHHeader = undefined;
    this.header = undefined;
    this.ijk2tkrRAS = undefined;
    this.affine = undefined;
    this.image = undefined;

    this.shape = undefined;
    this.ijkIndexOrder = undefined;
    this.model2RAS = undefined;
    this.model2tkrRAS = undefined;
    this.model2vox = undefined;
  }

  copy( el ) {
    this.isMGHImage = el.isMGHImage;
    this.isInvalid = el.isInvalid;
    if(this.isInvalid) { return this; }
    this._MGHHeader = el._MGHHeader;
    this.header = el.header;
    this.slope = el.slope || 1;
    this.intercept = el.intercept;
    this.calMin = el.calMin;
    this.calMax = el.calMax;

    this.ijk2tkrRAS = new Matrix4().copy( el.ijk2tkrRAS );
    this.affine = new Matrix4().copy( el.affine );
    this.shape = new Vector3().copy( el.shape );
    this.ijkIndexOrder = new Vector3().copy( el.ijkIndexOrder );
    this.model2RAS = new Matrix4().copy( el.model2RAS );
    this.model2tkrRAS = new Matrix4().copy( el.model2tkrRAS );
    this.model2vox = new Matrix4().copy( el.model2vox );

    this.image = el.image;
    this.imageDataType = el.imageDataType;

    if( el.dataIsInt16 ) {
      this.dataIsInt16 = true;
    } else if( el.dataIsInt32 ) {
      this.dataIsInt32 = true;
    } else if( el.dataIsFloat32 ) {
      this.dataIsFloat32 = true;
    } else if( el.dataIsUInt8 ) {
      this.dataIsUInt8 = true;
    }
    return this;
  }

}


export { MGHImage };

