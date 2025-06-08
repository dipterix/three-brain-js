// import * as fflate from 'fflate';
import { decompressSync } from 'fflate';
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
    const raw = decompressSync(new Uint8Array(buffer))
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

// read trackvis trk format streamlines
// http://trackvis.org/docs/?subsect=fileformat
function readTRK(buffer) {
  // little endian
  let reader = new DataView(buffer)
  let magic = reader.getUint32(0, true) // 'TRAC'
  if (magic !== 1128354388) {
    // e.g. TRK.gz
    let raw
    if (magic === 4247762216) {
      // e.g. TRK.zstd
      // raw = fzstd.decompress(new Uint8Array(buffer));
      // raw = new Uint8Array(raw);
      throw new Error('zstd TRK decompression is not supported')
    } else {
      raw = decompressSync(new Uint8Array(buffer))
    }
    buffer = raw.buffer
    reader = new DataView(buffer)
    magic = reader.getUint32(0, true) // 'TRAC'
  }
  const vers = reader.getUint32(992, true) // 2
  const hdr_sz = reader.getUint32(996, true) // 1000
  if (vers > 2 || hdr_sz !== 1000 || magic !== 1128354388) {
    throw new Error('Not a valid TRK file')
  }
  const n_scalars = reader.getInt16(36, true)
  const dpv = []
  let str;
  // data_per_vertex
  for (let i = 0; i < n_scalars; i++) {
    const arr = new Uint8Array(buffer.slice(38 + i * 20, 58 + i * 20));
    let str = new TextDecoder().decode(arr).split('\0').shift();
    if( typeof str === "string" ) {
      str = str.trim();
    } else {
      str = `id_${i}`;
    }
    dpv.push({
      id: str, // TODO can we guarantee this?
      vals: []
    });
  }
  const voxel_sizeX = reader.getFloat32(12, true);
  const voxel_sizeY = reader.getFloat32(16, true);
  const voxel_sizeZ = reader.getFloat32(20, true);
  const zoomMat = mat4.fromValues(
    1 / voxel_sizeX, 0, 0, -0.5,
    0, 1 / voxel_sizeY, 0, -0.5,
    0, 0, 1 / voxel_sizeZ, -0.5,
    0, 0, 0, 1
  );
  const n_properties = reader.getInt16(238, true);
  const dps = [];
  // data_per_streamline
  for (let i = 0; i < n_properties; i++) {
    const arr = new Uint8Array(buffer.slice(240 + i * 20, 260 + i * 20));
    let str = new TextDecoder().decode(arr).split('\0').shift();
    if( typeof str === "string" ) {
      str = str.trim();
    } else {
      str = `id_${i}`;
    }
    dps.push({
      id: str, // TODO can we guarantee this?
      vals: []
    });
  }
  const mat = mat4.create();
  for (let i = 0; i < 16; i++) {
    mat[i] = reader.getFloat32(440 + i * 4, true);
  }
  if (mat[15] === 0.0) {
    // vox_to_ras[3][3] is 0, it means the matrix is not recorded
    console.warn('TRK vox_to_ras not set... using identity matrix');
    mat4.identity(mat);
  }
  const vox2mmMat = mat4.create();
  mat4.mul(vox2mmMat, zoomMat, mat);
  let i32 = null;
  let f32 = null;
  i32 = new Int32Array(buffer.slice(hdr_sz));
  f32 = new Float32Array(i32.buffer);
  const ntracks = i32.length;
  if (ntracks < 1) {
    throw new Error('Empty TRK file.');
  }
  // read and transform vertex positions
  let i = 0
  let npt = 0
  // pre-allocate and over-provision offset array
  let offsetPt0 = new Uint32Array(i32.length / 4)
  // pre-allocate and over-provision streamline length array
  let lps32 = new Float32Array(i32.length / 4)
  let noffset = 0
  // pre-allocate and over-provision vertex positions array
  let pts = new Float32Array(i32.length)
  let npt3 = 0
  // temporary variables to store transformed vertex positions
  let vtx, vty, vtz, vtx2, vty2, vtz2, slen;
  while (i < ntracks) {
    const n_pts = i32[i]
    i = i + 1 // read 1 32-bit integer for number of points in this streamline
    slen = 0;
    for (let j = 0; j < n_pts; j++) {
      const ptx = f32[i + 0]
      const pty = f32[i + 1]
      const ptz = f32[i + 2]
      i += 3 // read 3 32-bit floats for XYZ position
      vtx = ptx * vox2mmMat[0] + pty * vox2mmMat[1] + ptz * vox2mmMat[2] + vox2mmMat[3]
      vty = ptx * vox2mmMat[4] + pty * vox2mmMat[5] + ptz * vox2mmMat[6] + vox2mmMat[7]
      vtz = ptx * vox2mmMat[8] + pty * vox2mmMat[9] + ptz * vox2mmMat[10] + vox2mmMat[11]

      pts[npt3++] = vtx;
      pts[npt3++] = vty;
      pts[npt3++] = vtz;
      if (n_scalars > 0) {
        for (let s = 0; s < n_scalars; s++) {
          dpv[s].vals.push(f32[i])
          i++
        }
      }
      if (j > 0) {
        slen += Math.sqrt(
          (vtx - vtx2) * (vtx - vtx2) +
          (vty - vty2) * (vty - vty2) +
          (vtz - vtz2) * (vtz - vtz2)
        )
      }
      vtx2 = vtx;
      vty2 = vty;
      vtz2 = vtz;
      npt++
    } // for j: each point in streamline
    if (n_properties > 0) {
      for (let j = 0; j < n_properties; j++, i++) {
        dps[j].vals.push(f32[i]);
      }
    }
    lps32[noffset] = slen;
    offsetPt0[noffset++] = npt;
  } // for each streamline: while i < n_count
  // output uses static float32 not dynamic number[]
  const dps32 = []
  // data_per_streamline
  for (let i = 0; i < dps.length; i++) {
    dps32.push({
      id: dps[i].id,
      vals: Float32Array.from(dps[i].vals)
    })
  }
  const dpv32 = []
  for (let i = 0; i < dpv.length; i++) {
    dpv32.push({
      id: dpv[i].id,
      vals: Float32Array.from(dpv[i].vals)
    })
  }
  // add 'first index' as if one more line was added (fence post problem)
  offsetPt0[noffset++] = npt;
  // resize offset/vertex arrays that were initially over-provisioned
  pts = pts.slice(0, npt3);
  offsetPt0 = offsetPt0.slice(0, noffset);
  lps32 = lps32.slice(0, noffset - 1);
  return {
    pts,
    offsetPt0,
    lps: lps32,
    dps: dps32,
    dpv: dpv32
  }
} // readTRK()

export { readTT, readTRK };
