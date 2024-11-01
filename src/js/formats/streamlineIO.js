import * as fflate from 'fflate';
import { mat3, mat4, vec3, vec4 } from "gl-matrix"; //for trk

function readMatV4(buffer) {
  let len = buffer.byteLength
  if (len < 40)
    throw new Error("File too small to be MAT v4: bytes = " + buffer.byteLength)
  let reader = new DataView(buffer)
  let magic = reader.getUint16(0, true)
  let _buffer = buffer
  if (magic === 35615 || magic === 8075) {
    // gzip signature 0x1F8B in little and big endian
    const raw = fflate.decompressSync(new Uint8Array(buffer))
    reader = new DataView(raw.buffer)
    magic = reader.getUint16(0, true)
    _buffer = raw.buffer
    len = _buffer.byteLength
  }
  const textDecoder = new TextDecoder('utf-8')
  let bytes = new Uint8Array(_buffer)
  let pos = 0
  let mat = []
  function getTensDigit(v) {
    return (Math.floor(v/10) % 10)
  }
  function readArray(tagDataType, tagBytesStart, tagBytesEnd) {
    const byteArray = new Uint8Array(bytes.subarray(tagBytesStart, tagBytesEnd))
    if (tagDataType === 1)
      return new Float32Array(byteArray.buffer)
    if (tagDataType === 2)
      return new Int32Array(byteArray.buffer)
    if (tagDataType === 3)
      return new Int16Array(byteArray.buffer)
    if (tagDataType === 4)
      return new Uint16Array(byteArray.buffer)
    if (tagDataType === 5)
      return new Uint8Array(byteArray.buffer)
    return new Float64Array(byteArray.buffer)
  }
  function readTag() {
    let mtype = reader.getUint32(pos, true)
    let mrows = reader.getUint32(pos+4, true)
    let ncols = reader.getUint32(pos+8, true)
    let imagf = reader.getUint32(pos+12, true)
    let namlen = reader.getUint32(pos+16, true)
    pos+= 20; //skip header
    if (imagf !== 0)
      throw new Error("Matlab V4 reader does not support imaginary numbers")
    let tagArrayItems = mrows * ncols
    if (tagArrayItems < 1)
      throw new Error("mrows * ncols must be greater than one")
    const byteArray = new Uint8Array(bytes.subarray(pos, pos+namlen))
    let tagName = textDecoder.decode(byteArray).trim().replaceAll('\x00','')
    let tagDataType = getTensDigit(mtype)
    //0 double-precision (64-bit) floating-point numbers
    //1 single-precision (32-bit) floating-point numbers
    //2 32-bit signed integers
    //3 16-bit signed integers
    //4 16-bit unsigned integers
    //5 8-bit unsigned integers
    let tagBytesPerItem = 8
    if ((tagDataType >= 1) && (tagDataType <= 2))
      tagBytesPerItem = 4
    else if ((tagDataType >= 3) && (tagDataType <= 4))
      tagBytesPerItem = 2
    else if (tagDataType === 5)
      tagBytesPerItem = 1
    else if (tagDataType !== 0)
      throw new Error("impossible Matlab v4 datatype")
    pos+= namlen; //skip name
    if (mtype > 50)
      throw new Error("Does not appear to be little-endian V4 Matlab file")
    let posEnd = pos + (tagArrayItems * tagBytesPerItem)
    mat[tagName] = readArray(tagDataType, pos, posEnd)
    pos = posEnd
  }
  while ((pos + 20) < len)
    readTag()
  return mat
} // readMatV4()

// https://dsi-studio.labsolver.org/doc/cli_data.html
// https://brain.labsolver.org/hcp_trk_atlas.html
function readTT(buffer) {
  let offsetPt0 = []
  let pts = []
  const mat = readMatV4(buffer);
  if (!('trans_to_mni' in mat))
    throw new Error("TT format file must have 'trans_to_mni'")
  if (!('voxel_size' in mat))
    throw new Error("TT format file must have 'voxel_size'")
  if (!('track' in mat))
    throw new Error("TT format file must have 'track'")
  let trans_to_mni = mat4.create()
  let m = mat.trans_to_mni
  trans_to_mni = mat4.fromValues(m[0],m[1],m[2],m[3],  m[4],m[5],m[6],m[7],  m[8],m[9],m[10],m[11],  m[12],m[13],m[14],m[15])
  mat4.transpose(trans_to_mni, trans_to_mni)
  let zoomMat = mat4.create()
  zoomMat = mat4.fromValues(1 / mat.voxel_size[0],0,0,-0.5,
        0, 1 / mat.voxel_size[1], 0, -0.5,
        0, 0, 1 / mat.voxel_size[2], -0.5,
        0, 0, 0, 1)
  mat4.transpose(zoomMat, zoomMat)
  function parse_tt(track) {
    let dv = new DataView(track.buffer)
    let pos = []
    let nvert3 = 0
    let i = 0
    while(i < track.length) {
      pos.push(i)
      let newpts = dv.getUint32(i, true)
      i = i + newpts+13
      nvert3 += newpts
    }
    offsetPt0 = new Uint32Array(pos.length+1)
    pts = new Float32Array(nvert3)
    let npt = 0
    for (let i = 0; i < pos.length; i++) {
      offsetPt0[i] = npt / 3
      let p = pos[i]
      let sz = dv.getUint32(p, true)/3
      let x = dv.getInt32(p+4, true)
      let y = dv.getInt32(p+8, true)
      let z = dv.getInt32(p+12, true)
      p += 16
      pts[npt++] = x
      pts[npt++] = y
      pts[npt++] = z
      for (let j = 2; j <= sz; j++) {
          x = x + dv.getInt8(p++)
          y = y + dv.getInt8(p++)
          z = z + dv.getInt8(p++)
          pts[npt++] = x
          pts[npt++] = y
          pts[npt++] = z
      }
    } //for each streamline
    for (let i = 0; i < npt; i++)
      pts[i] = pts[i]/32.0
    let vox2mmMat = mat4.create()
    mat4.mul(vox2mmMat, zoomMat, trans_to_mni)
    let v = 0
    for (let i = 0; i < npt / 3; i++) {
      const pos = vec4.fromValues(pts[v], pts[v+1], pts[v+2], 1)
      vec4.transformMat4(pos, pos, vox2mmMat)
      pts[v++] = pos[0]
      pts[v++] = pos[1]
      pts[v++] = pos[2]
    }
    offsetPt0[pos.length] = npt / 3; //solve fence post problem, offset for final streamline
  } // parse_tt()
  parse_tt(mat.track)
  return {
    points : pts,
    cutoff : offsetPt0,
    shape  : mat.voxel_size,
    color  : mat.color[0],
  }
} // readTT()


export { readTT };
