import nifti from 'nifti-reader-js';
import ZStream from 'pako/lib/zlib/zstream.js';
import { inflateInit2, inflate as zlibInflate, inflateEnd } from 'pako/lib/zlib/inflate.js';
import {
  Vector3, Vector4, Matrix4, ByteType, ShortType, IntType,
  FloatType, UnsignedByteType, UnsignedShortType, UnsignedIntType,
} from 'three';
import { CONSTANTS } from '../core/constants.js';

// zlib status codes and flush mode (pako/lib/zlib/constants.js)
const Z_OK = 0, Z_STREAM_END = 1, Z_BUF_ERROR = -5, Z_NO_FLUSH = 0;

// Bytes inflated per read when a gzip file is read decimated (whole rows, at
// least one). Kept small on purpose: with 1 MiB reads, a cold page in Chromium
// inflated a highly compressible file about twice as slowly (1024^3 uint8
// atlas: 9.4 s against 4.5 s with 16 KiB), while Node showed no difference.
const READ_BUFFER_BYTES = 1 << 14;

// Holds a NIfTI-2 header (540 bytes) and its extension size and code
const HEADER_PEEK_BYTES = 1024;

/**
 * Oversized volumes
 * -----------------
 * A volume with more voxels than `CONSTANTS.MAX_VOLUME_VOXELS`, or an axis
 * longer than `CONSTANTS.MAX_VOLUME_AXIS`, is never read whole: the typed
 * arrays the viewer keeps per voxel, and the 3D texture, could not hold it.
 *
 * Step 1 reads it decimated: the longest axis is halved until the volume fits,
 * and only the voxels on that lattice are read (nearest voxel, no averaging).
 * Step 2 looks at the non-zero samples: when their bounding box holds at most
 * `CONSTANTS.MAX_VOLUME_CORE_VOXELS` samples, the core is read again at a
 * finer stride. The box comes from samples, so the core is read with one
 * step-1 stride of margin on each side.
 *
 * The affine is composed so every sample keeps its position: downstream code
 * sees an ordinary, smaller volume. `samplingInfo` records what was done.
 */

// Samples of `len` voxels at stride `s`, and where the first one sits: in the
// middle of its block when the last block is long enough to hold that offset
function samplePhase( len, s ) {
  const count = Math.ceil( len / s );
  const lastBlock = len - ( count - 1 ) * s;
  return { count, phase: Math.min( Math.floor( ( s - 1 ) / 2 ), lastBlock - 1 ) };
}

/**
 * Step 1: halve the longest axis (the first one on ties) while the volume has
 * more than `maxVoxels` voxels or an axis longer than `maxAxis`.
 * @param {number[]} dims - voxels along i, j, k
 * @returns {{ stride: number[], offset: number[], shape: number[] }} - sample
 *   `a` along an axis reads voxel `offset + a * stride`
 */
function planDecimation( dims, { maxVoxels, maxAxis } ) {
  const stride = [ 1, 1, 1 ];
  const shape = [ dims[0], dims[1], dims[2] ];
  for(;;) {
    const longest = Math.max( shape[0], shape[1], shape[2] );
    if( longest <= 1 ) { break; }
    if( shape[0] * shape[1] * shape[2] <= maxVoxels && longest <= maxAxis ) { break; }
    let axis = 0;
    if( shape[1] > shape[axis] ) { axis = 1; }
    if( shape[2] > shape[axis] ) { axis = 2; }
    stride[ axis ] *= 2;
    shape[ axis ] = Math.ceil( dims[ axis ] / stride[ axis ] );
  }
  const offset = [ 0, 1, 2 ].map( a => samplePhase( dims[a], stride[a] ).phase );
  return { stride, offset, shape };
}

/**
 * Step 2: plan the re-read of the non-zero core.
 *
 * `box` holds the first and last non-zero samples of step 1, in sample
 * indices. The box itself, `[first, last]` in voxels, decides whether there is
 * a step 2 (at most `maxCoreVoxels` samples) and how far it goes: the axis with
 * the largest `n / ceil(n / stride)` ratio has its stride halved while the box
 * stays within `maxCoreVoxels`. What is read is the box plus one step-1 stride
 * on each side, since voxels between the last non-zero sample and the next
 * (zero) one may be non-zero; that padded read must stay within `maxAxis` per
 * axis, or the halving goes to the next axis, and within `maxVoxels`.
 *
 * @returns {null|Object} `null` to keep the step-1 image; `step: 'crop'` to cut
 *   the step-1 samples to the box when no halving fits; `step: 'core'` to read
 *   the padded core again at `stride`.
 */
function planCore( dims, decimation, box, { maxCoreVoxels, maxVoxels, maxAxis } ) {
  if( !box ) { return null; }
  const s1 = decimation.stride, p1 = decimation.offset;
  const first = [ 0, 1, 2 ].map( a => p1[a] + box.min[a] * s1[a] );
  const last = [ 0, 1, 2 ].map( a => p1[a] + box.max[a] * s1[a] );
  const boxLength = [ 0, 1, 2 ].map( a => last[a] - first[a] + 1 );
  const padFrom = [ 0, 1, 2 ].map( a => Math.max( 0, first[a] - s1[a] ) );
  const padTo = [ 0, 1, 2 ].map( a => Math.min( dims[a] - 1, last[a] + s1[a] ) );
  const padLength = [ 0, 1, 2 ].map( a => padTo[a] - padFrom[a] + 1 );
  const coreLimit = Math.min( maxCoreVoxels, maxVoxels );
  const count = ( lengths, stride ) =>
    Math.ceil( lengths[0] / stride[0] ) * Math.ceil( lengths[1] / stride[1] ) * Math.ceil( lengths[2] / stride[2] );

  if( count( boxLength, s1 ) > coreLimit ) { return null; }

  const stride = s1.slice();
  const ratio = ( a ) => dims[a] / Math.ceil( dims[a] / stride[a] );
  let halved = 0;
  for(;;) {
    const axis = [ 0, 1, 2 ]
      .filter( a => stride[a] > 1 )
      .sort( ( a, b ) => ratio( b ) - ratio( a ) || a - b )
      .find( a => Math.ceil( padLength[a] / ( stride[a] / 2 ) ) <= maxAxis );
    if( axis === undefined ) { break; }
    stride[ axis ] /= 2;
    if( count( boxLength, stride ) > coreLimit || count( padLength, stride ) > maxVoxels ) {
      stride[ axis ] *= 2;
      break;
    }
    halved++;
  }

  if( halved === 0 ) {
    // no finer stride fits: keep the step-1 samples inside the box, plus one
    const from = [ 0, 1, 2 ].map( a => Math.max( 0, box.min[a] - 1 ) );
    const to = [ 0, 1, 2 ].map( a => Math.min( decimation.shape[a] - 1, box.max[a] + 1 ) );
    const shape = [ 0, 1, 2 ].map( a => to[a] - from[a] + 1 );
    if( shape.every( ( n, a ) => n === decimation.shape[a] ) ) { return null; }
    return {
      step : 'crop',
      stride : s1.slice(),
      offset : [ 0, 1, 2 ].map( a => p1[a] + from[a] * s1[a] ),
      shape : shape,
    };
  }

  // The core lattice runs through the step-1 samples (each stride divides the
  // step-1 one), so it still samples every voxel step 1 showed. Centring it on
  // the padded range instead would miss them all where the margin is clamped
  // at an edge.
  const shape = [], offset = [];
  for( let a = 0; a < 3; a++ ) {
    const start = padFrom[a] + ( first[a] - padFrom[a] ) % stride[a];
    offset.push( start );
    shape.push( Math.floor( ( padTo[a] - start ) / stride[a] ) + 1 );
  }
  return { step : 'core', stride : stride, offset : offset, shape : shape };
}

/**
 * Inflates a gzip buffer on demand, a requested number of bytes at a time.
 *
 * This drives pako's zlib port directly rather than `pako.Inflate`, which
 * `nifti.decompress` uses: that class restarts on a new gzip member without the
 * member's history window, so a multi-member file (bgzip) fails with "invalid
 * distance too far back", and it takes zero padding after the stream for
 * another member. Here a member starts only at the gzip magic bytes `1f 8b`;
 * anything else after the end of a stream is ignored, as gzip(1) does.
 */
function createGzipSource( bytes ) {
  const strm = new ZStream();
  const start = () => {
    // 15-bit window, +32: detect the gzip or zlib header
    if( inflateInit2( strm, 15 + 32 ) !== Z_OK ) {
      throw new Error( "NiftiImage: cannot inflate the gzip data." );
    }
  };
  start();
  strm.input = bytes;
  strm.next_in = 0;
  strm.avail_in = bytes.length;
  let ended = false;

  return {
    // Fills `out[0, n)` and returns how many bytes it wrote, which is fewer
    // only when the data ends
    read( out, n ) {
      strm.output = out;
      strm.next_out = 0;
      strm.avail_out = n;
      while( strm.avail_out > 0 && !ended ) {
        const inBefore = strm.next_in, outBefore = strm.next_out;
        const status = zlibInflate( strm, Z_NO_FLUSH );
        if( status === Z_STREAM_END ) {
          if( strm.avail_in >= 2 && bytes[ strm.next_in ] === 0x1f && bytes[ strm.next_in + 1 ] === 0x8b ) {
            inflateEnd( strm );
            start();
          } else {
            ended = true;
          }
        } else if( status === Z_BUF_ERROR ) {
          // no input left before the end of the stream
          ended = true;
        } else if( status !== Z_OK ) {
          throw new Error( `NiftiImage: the gzip data is corrupt (${ strm.msg || status }).` );
        } else if( strm.next_in === inBefore && strm.next_out === outBefore ) {
          ended = true;
        }
      }
      return n - strm.avail_out;
    },
    end() {
      inflateEnd( strm );
    },
  };
}

/**
 * Parses the header; for gzip data, from its first kilobyte only, so a file
 * too large to inflate whole can still be planned.
 *
 * nifti-reader-js 0.5.4 builds the NIfTI-2 64-bit integers from signed bytes,
 * always little-endian: 384 reads as 128, 182 as -74, and every big-endian
 * file as garbage. The dimensions and `vox_offset` are read again here.
 */
function readNiftiHeader( data, compressed ) {
  let headerBytes = data;
  if( compressed ) {
    const source = createGzipSource( new Uint8Array( data ) );
    const prefix = new Uint8Array( HEADER_PEEK_BYTES );
    const length = source.read( prefix, HEADER_PEEK_BYTES );
    source.end();
    headerBytes = prefix.buffer.slice( 0, length );
  }
  const header = nifti.readHeader( headerBytes );
  if( !header ) {
    throw new Error( "NiftiImage: the data is not a NIfTI-1 or NIfTI-2 image." );
  }
  if( header instanceof nifti.NIFTI2 ) {
    const view = new DataView( headerBytes );
    for( let i = 0; i < 8; i++ ) {
      header.dims[ i ] = Number( view.getBigInt64( 16 + 8 * i, header.littleEndian ) );
    }
    header.vox_offset = Number( view.getBigInt64( 168, header.littleEndian ) );
  }
  return header;
}

// Copies `count` voxels, `step` bytes apart from byte `byte` of `view`, into
// `out` from `index`; one function per datatype keeps the loop monomorphic
function rowDecoder( datatype, littleEndian ) {
  const le = littleEndian;
  switch( datatype ) {
    case nifti.NIFTI1.TYPE_UINT8:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getUint8( byte ); }
      };
    case nifti.NIFTI1.TYPE_INT8:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getInt8( byte ); }
      };
    case nifti.NIFTI1.TYPE_INT16:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getInt16( byte, le ); }
      };
    case nifti.NIFTI1.TYPE_UINT16:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getUint16( byte, le ); }
      };
    case nifti.NIFTI1.TYPE_INT32:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getInt32( byte, le ); }
      };
    case nifti.NIFTI1.TYPE_UINT32:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getUint32( byte, le ); }
      };
    case nifti.NIFTI1.TYPE_FLOAT32:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getFloat32( byte, le ); }
      };
    case nifti.NIFTI1.TYPE_FLOAT64:
      return ( view, byte, step, count, out, index ) => {
        for( let a = 0; a < count; a++, byte += step ) { out[ index + a ] = view.getFloat64( byte, le ); }
      };
  }
}

// Datatypes the decimated reader decodes, in the typed arrays the class keeps
const SAMPLED_TYPES = {
  [ nifti.NIFTI1.TYPE_UINT8 ]   : { bytes : 1, ArrayType : Uint8Array },
  [ nifti.NIFTI1.TYPE_INT8 ]    : { bytes : 1, ArrayType : Int8Array },
  [ nifti.NIFTI1.TYPE_INT16 ]   : { bytes : 2, ArrayType : Int16Array },
  [ nifti.NIFTI1.TYPE_UINT16 ]  : { bytes : 2, ArrayType : Uint16Array },
  [ nifti.NIFTI1.TYPE_INT32 ]   : { bytes : 4, ArrayType : Int32Array },
  [ nifti.NIFTI1.TYPE_UINT32 ]  : { bytes : 4, ArrayType : Uint32Array },
  [ nifti.NIFTI1.TYPE_FLOAT32 ] : { bytes : 4, ArrayType : Float32Array },
  [ nifti.NIFTI1.TYPE_FLOAT64 ] : { bytes : 8, ArrayType : Float64Array },
};

const truncatedError = () => new Error(
  "NiftiImage: the image data ended before the voxels the viewer reads; the file may be truncated." );

/**
 * Reads the voxels on the lattice of `plan` (`offset + stride * index` along
 * each axis) for every frame, in the order the class keeps them.
 *
 * Rows of voxels along i are the unit: uncompressed data is read only at the
 * rows on the lattice, gzip data is inflated a buffer of whole rows at a time
 * and decoded only at those rows. Data after the last row on the lattice is
 * never read. With `findBox`, also returns the first and last non-zero samples
 * along each axis, over all frames, in sample indices (`null` if all zero).
 */
function readLattice( bytes, compressed, layout, plan, { bufferBytes, findBox = false } ) {
  const { dims, frames, voxOffset, rowBytes, bytesPerVoxel, decode, ArrayType } = layout;
  const [ nx, ny, nz ] = dims;
  const [ outX, outY, outZ ] = plan.shape;
  const image = new ArrayType( outX * outY * outZ * frames );
  const xByte = plan.offset[0] * bytesPerVoxel;
  const xStep = plan.stride[0] * bytesPerVoxel;
  const boxMin = [ Infinity, Infinity, Infinity ], boxMax = [ -1, -1, -1 ];

  const takeRow = ( view, rowByte, b, c, t ) => {
    const index = ( ( t * outZ + c ) * outY + b ) * outX;
    decode( view, rowByte + xByte, xStep, outX, image, index );
    if( !findBox ) { return; }
    let a0 = 0;
    while( a0 < outX && image[ index + a0 ] === 0 ) { a0++; }
    if( a0 === outX ) { return; }
    let a1 = outX - 1;
    while( image[ index + a1 ] === 0 ) { a1--; }
    if( a0 < boxMin[0] ) { boxMin[0] = a0; }
    if( a1 > boxMax[0] ) { boxMax[0] = a1; }
    if( b < boxMin[1] ) { boxMin[1] = b; }
    if( b > boxMax[1] ) { boxMax[1] = b; }
    if( c < boxMin[2] ) { boxMin[2] = c; }
    if( c > boxMax[2] ) { boxMax[2] = c; }
  };

  const rowIndex = ( b, c, t ) =>
    ( plan.offset[1] + b * plan.stride[1] ) + ny * ( ( plan.offset[2] + c * plan.stride[2] ) + nz * t );
  const lastRow = rowIndex( outY - 1, outZ - 1, frames - 1 );

  if( !compressed ) {
    if( voxOffset + ( lastRow + 1 ) * rowBytes > bytes.byteLength ) { throw truncatedError(); }
    const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
    for( let t = 0; t < frames; t++ ) {
      for( let c = 0; c < outZ; c++ ) {
        for( let b = 0; b < outY; b++ ) {
          takeRow( view, voxOffset + rowIndex( b, c, t ) * rowBytes, b, c, t );
        }
      }
    }
  } else {
    // the output row (b) of every source row (y), and slice (c) of every z
    const outRowOfY = new Int32Array( ny ).fill( -1 );
    const outSliceOfZ = new Int32Array( nz ).fill( -1 );
    for( let b = 0; b < outY; b++ ) { outRowOfY[ plan.offset[1] + b * plan.stride[1] ] = b; }
    for( let c = 0; c < outZ; c++ ) { outSliceOfZ[ plan.offset[2] + c * plan.stride[2] ] = c; }

    const source = createGzipSource( bytes );
    try {
      // skip the header and extensions
      const scratch = new Uint8Array( Math.max( 1, Math.min( bufferBytes, voxOffset ) ) );
      for( let skip = voxOffset; skip > 0; ) {
        const n = Math.min( skip, scratch.length );
        if( source.read( scratch, n ) < n ) { throw truncatedError(); }
        skip -= n;
      }
      const rowsPerRead = Math.max( 1, Math.floor( bufferBytes / rowBytes ) );
      const buffer = new Uint8Array( rowsPerRead * rowBytes );
      const view = new DataView( buffer.buffer );
      for( let row = 0; row <= lastRow; ) {
        const rows = Math.min( rowsPerRead, lastRow - row + 1 );
        if( source.read( buffer, rows * rowBytes ) < rows * rowBytes ) { throw truncatedError(); }
        for( let i = 0; i < rows; i++, row++ ) {
          const y = row % ny, zt = ( row - y ) / ny, z = zt % nz;
          const b = outRowOfY[ y ], c = outSliceOfZ[ z ];
          if( b >= 0 && c >= 0 ) { takeRow( view, i * rowBytes, b, c, ( zt - z ) / nz ); }
        }
      }
    } finally {
      source.end();
    }
  }

  const box = boxMax[0] < 0 ? null : { min : boxMin, max : boxMax };
  return { image, box };
}

// The samples of `crop` (a `planCore` crop), cut from the step-1 `image`
function cropLattice( image, decimation, crop, frames ) {
  const [ inX, inY, inZ ] = decimation.shape;
  const [ outX, outY, outZ ] = crop.shape;
  const from = [ 0, 1, 2 ].map( a => ( crop.offset[a] - decimation.offset[a] ) / decimation.stride[a] );
  const out = new image.constructor( outX * outY * outZ * frames );
  let o = 0;
  for( let t = 0; t < frames; t++ ) {
    for( let c = 0; c < outZ; c++ ) {
      for( let b = 0; b < outY; b++, o += outX ) {
        const i = ( ( t * inZ + from[2] + c ) * inY + from[1] + b ) * inX + from[0];
        out.set( image.subarray( i, i + outX ), o );
      }
    }
  }
  return out;
}

/**
 * Reads a volume over the limits (see "Oversized volumes" above): step 1, then
 * step 2 when it applies. `data` is the file's ArrayBuffer.
 */
function readOversized( data, compressed, header, limits ) {
  const { maxVoxels, maxCoreVoxels, maxAxis, bufferBytes } = limits;
  const dims = [ header.dims[1], header.dims[2], header.dims[3] ];
  const datatype = header.datatypeCode;
  const type = SAMPLED_TYPES[ datatype ];
  const shapeText = dims.join( "×" );
  if( !type ) {
    throw new Error( `NiftiImage: cannot read the ${ shapeText } volume: datatype ${ datatype } is not supported for volumes this large.` );
  }
  if( header.numBitsPerVoxel !== type.bytes * 8 ) {
    throw new Error( `NiftiImage: cannot read the ${ shapeText } volume: datatype ${ datatype } should have bitpix ${ type.bytes * 8 }, not ${ header.numBitsPerVoxel }.` );
  }

  // frames follow dims[0], unlike `nifti.readImage`, which uses any non-zero dims[4], dims[5]
  const frames = ( header.dims[0] >= 4 ? Math.max( 1, header.dims[4] ) : 1 ) *
                 ( header.dims[0] >= 5 ? Math.max( 1, header.dims[5] ) : 1 );
  const layout = {
    dims : dims,
    frames : frames,
    voxOffset : Math.floor( header.vox_offset ),
    rowBytes : dims[0] * type.bytes,
    bytesPerVoxel : type.bytes,
    decode : rowDecoder( datatype, header.littleEndian ),
    ArrayType : type.ArrayType,
  };
  const bytes = new Uint8Array( data );

  const decimation = planDecimation( dims, { maxVoxels, maxAxis } );
  const step1 = readLattice( bytes, compressed, layout, decimation, { bufferBytes, findBox : true } );
  const core = planCore( dims, decimation, step1.box, { maxCoreVoxels, maxVoxels, maxAxis } );

  let plan = decimation, image = step1.image, step = 'decimate';
  if( core && core.step === 'crop' ) {
    plan = core;
    step = 'crop';
    image = cropLattice( step1.image, decimation, core, frames );
  } else if( core ) {
    plan = core;
    step = 'core';
    // release the step-1 image before the second read
    step1.image = null;
    image = null;
    image = readLattice( bytes, compressed, layout, core, { bufferBytes } ).image;
  }

  // first and last non-zero samples, in voxels
  const box = step1.box ? {
    min : [ 0, 1, 2 ].map( a => decimation.offset[a] + step1.box.min[a] * decimation.stride[a] ),
    max : [ 0, 1, 2 ].map( a => decimation.offset[a] + step1.box.max[a] * decimation.stride[a] ),
  } : null;

  const what = step === 'core' ? "its non-zero core" : ( step === 'crop' ? "it, cropped to its non-zero core" : "it" );
  console.warn( `NiftiImage: the ${ shapeText } volume is over the viewer's limits (${ maxVoxels } voxels, ${ maxAxis } per axis): read ${ what } every (${ plan.stride.join( ", " ) }) voxels, from (${ plan.offset.join( ", " ) }), as ${ plan.shape.join( "×" ) }.` );

  return {
    image : image,
    shape : plan.shape.slice(),
    info : {
      originalShape : dims,
      stride : plan.stride.slice(),
      offset : plan.offset.slice(),
      step : step,
      box : box,
    },
  };
}

class NiftiImage {
  /**
   * @param {ArrayBuffer} data - a .nii or .nii.gz file
   * @param {Object} [options] - `maxVoxels`, `maxCoreVoxels` and `maxAxis`
   *   override the `CONSTANTS.MAX_VOLUME_*` limits; `bufferBytes`, the inflate
   *   buffer of the decimated reader
   */
  constructor ( data, options = {} ) {
    this.isInvalid = true;
    // set when the volume was over the limits; see "Oversized volumes" above
    this.samplingInfo = null;
    if(!data) { return; }

    const limits = {
      maxVoxels     : options.maxVoxels ?? CONSTANTS.MAX_VOLUME_VOXELS,
      maxCoreVoxels : options.maxCoreVoxels ?? CONSTANTS.MAX_VOLUME_CORE_VOXELS,
      maxAxis       : options.maxAxis ?? CONSTANTS.MAX_VOLUME_AXIS,
      bufferBytes   : options.bufferBytes ?? READ_BUFFER_BYTES,
    };

    // parse nifti
    const compressed = nifti.isCompressed(data);
    this.header = readNiftiHeader(data, compressed);
    const dims = this.header.dims;

    this.slope = this.header.scl_slope || 1;
    this.intercept = this.header.scl_inter || 0;
    this.calMin = this.header.cal_min || 0;
    this.calMax = this.header.cal_max || 0;

    let niftiImage, sampled = null;
    if( dims[1] * dims[2] * dims[3] <= limits.maxVoxels &&
        Math.max( dims[1], dims[2], dims[3] ) <= limits.maxAxis ) {
      if (compressed) {
        data = nifti.decompress(data);
      }
      niftiImage = nifti.readImage(this.header, data);
    } else {
      sampled = readOversized( data, compressed, this.header, limits );
      niftiImage = sampled.image.buffer;
    }

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

    // find the min & max of the data
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
    this.dataMin = minV * this.slope + this.intercept;
    this.dataMax = maxV * this.slope + this.intercept;

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

    if( sampled ) {
      // voxel (a, b, c) of this image is voxel offset + stride * (a, b, c) of the file
      const [ sx, sy, sz ] = sampled.info.stride;
      const [ ox, oy, oz ] = sampled.info.offset;
      this.affine.multiply( new Matrix4().set(
        sx, 0, 0, ox,
        0, sy, 0, oy,
        0, 0, sz, oz,
        0, 0, 0, 1
      ) );
      this.shape = new Vector3( ...sampled.shape );
    } else {
      this.shape = new Vector3(
        this.header.dims[1],
        this.header.dims[2],
        this.header.dims[3]
      );
    }

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
    this.samplingInfo = sampled ? sampled.info : null;
    this.isInvalid = false;

  }

  getNormalizedImage () {

    const slope = this.slope || 1;
    const intercept = this.intercept;
    const dataMin = this.dataMin;
    const dataMax = this.dataMax;
    const dataSpread = dataMax == dataMin ? 1 : (dataMax - dataMin);
    const dataInterc = ( intercept - dataMin ) / dataSpread;
    const dataSlope = slope / dataSpread;

    const n = this.image.length;
    const newImage = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      newImage[i] = dataSlope * this.image[i] + dataInterc;
    }

    // Float32Array.from will create arrays that are fragmented
    // Chrome will kill the tab, resulting in crash
    //
    // const newImage = Float32Array.from( this.image, (x) => {
    //   // return ( slope * x + intercept - dataMin ) / dataSpread;
    //   return dataSlope * x + dataInterc;
    // });

    return newImage;
  }

  trimToBoundingBox () {

    const nTimeSlices = Math.floor( this.image.length / this.shape.x / this.shape.y / this.shape.z );

    let minX = this.shape.x, maxX = 0,
        minY = this.shape.y, maxY = 0,
        minZ = this.shape.z, maxZ = 0;

    let ii = 0;
    const image = this.image;
    for(let t = 0; t < nTimeSlices ; t++) {
      for( let z = 0; z < this.shape.z; z++ ) {
        for( let y = 0; y < this.shape.y; y++ ) {
          for( let x = 0; x < this.shape.x; x++, ii++ ) {

            if( image[ ii ] !== 0 ) {

              if( minX >= x ) {
                minX = x;
              }
              if( maxX <= x ) {
                maxX = x;
              }

              if( minY >= y ) {
                minY = y;
              }
              if( maxY <= y ) {
                maxY = y;
              }

              if( minZ >= z ) {
                minZ = z;
              }
              if( maxZ <= z ) {
                maxZ = z;
              }

            }

          }
        }
      }
    }

    if( minX > maxX ) { minX = maxX; }
    if( minY > maxY ) { minY = maxY; }
    if( minZ > maxZ ) { minZ = maxZ; }

    // re-generate image
    const newShape = new Vector3().set( maxX - minX + 1 , maxY - minY + 1 , maxZ - minZ + 1 );
    const newLength = newShape.x * newShape.y * newShape.z * nTimeSlices;
    if( image.length === newLength ) { return(this) }

    let newImage = null;
    if( this.dataIsInt8 ) {
      newImage = new Int8Array(newLength);
    } else if ( this.dataIsInt16 ) {
      newImage = new Int16Array(newLength);
    } else if ( this.dataIsInt32 ) {
      newImage = new Int32Array(newLength);
    } else if ( this.dataIsFloat32 ) {
      newImage = new Float32Array(newLength);
    } else if ( this.dataIsFloat64 ) {
      newImage = new Float64Array(newLength);
    } else if ( this.dataIsUInt8 ) {
      newImage = new Uint8Array(newLength);
    } else if ( this.dataIsUInt16 ) {
      newImage = new Uint16Array(newLength);
    } else if ( this.dataIsUInt32 ) {
      newImage = new Uint32Array(newLength);
    } else {
      console.warn("NiftiImage: Cannot load NIFTI image data: the data type code is unsupported.")
    }

    let newii = 0;
    const oldShapeX = this.shape.x,
          oldShapeY = this.shape.y,
          oldShapeZ = this.shape.z;
    const oldNVoxelsAll = oldShapeX * oldShapeY * oldShapeZ,
          oldNVoxelsXY = oldShapeX * oldShapeY;
    for(let t = 0, newii = 0, indent = 0; t < nTimeSlices ; t++) {
      for( let z = minZ; z <= maxZ; z++ ) {

        indent = oldNVoxelsAll * t + oldNVoxelsXY * z;

        for( let y = minY; y <= maxY; y++ ) {

          ii = indent + oldShapeX * y + minX;
          for( let x = minX; x <= maxX; x++, ii++, newii++ ) {

            newImage[ newii ] = image[ ii ];

          }
        }
      }
    }

    this.image = newImage;
    this.shape.copy( newShape );

    // calculate new affine
    this.affine.multiply(
      new Matrix4().set(
        1, 0, 0, minX,
        0, 1, 0, minY,
        0, 0, 1, minZ,
        0, 0, 0, 1
      )
    );

    // ijkIndexOrder is safe

    this.model2vox.set(
      1, 0, 0, (this.shape.x - 1) / 2,
      0, 1, 0, (this.shape.y - 1) / 2 ,
      0, 0, 1, (this.shape.z - 1) / 2,
      0, 0, 0, 1
    );

    // IJK to scanner RAS (of the image)
    this.model2RAS.copy( this.affine ).multiply( this.model2vox );

    return(this);

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
    this.samplingInfo = el.samplingInfo ?? null;

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

    this.dataMin = el.dataMin;
    this.dataMax = el.dataMax;

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

export { NiftiImage, planDecimation, planCore }
