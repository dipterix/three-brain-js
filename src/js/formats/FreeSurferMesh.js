import { BufferAttribute } from 'three';
import { min2, sub2 } from '../utils.js';

class FreeSurferMesh {
  position;
  index;

  constructor( data ) {
    this.isInvalid = true;
    if( !data ) { return; }
    const raw = data;

    let reader = new DataView( data );
    const sig0 = reader.getUint32(0, false);
    const sig1 = reader.getUint32(4, false);
    if (sig0 !== 4294966883 || sig1 !== 1919246708) {
      // console.warn( "FreeSurferMesh: Cannot parse FreeSurfer surface data." );
    }

    let offset = 0;
    // marks 10 bytes for `nVertices` and `nFaces`
    while( reader.getUint8(offset) !== 10 ) { offset++; }
    this.nVertices = reader.getUint32(offset + 2, false);
    this.nFaces = reader.getUint32(offset + 6, false);
    offset += 10;

    // next is to read vertices in float32
    this.position = new Float32Array( this.nVertices * 3 );

    for( let ii = 0 ; ii < this.nVertices * 3 ; ii++, offset += 4) {
      this.position[ ii ] = reader.getFloat32( offset, false ); // bigEndian
    }
    // face indices
    this.index = new Uint32Array( this.nFaces * 3 );
    for( let ii = 0; ii < this.nFaces * 3 ; ii++, offset += 4) {
      this.index[ ii ] = reader.getUint32(offset, false);
    }
    const indexMin = min2(this.index, 0);
    if(indexMin !== 0) {
      sub2(this.index, indexMin);
    }

    this.isFreeSurferMesh = true;
    this.isSurfaceMesh = true;
    this.isInvalid = false;

    this.tkrToScan = null;

    // try to read footer information
    try {


      if( offset < reader.byteLength ) {
        // The following 3 uint32 should be 2 0 20 or just 20
        let fsig0 = reader.getUint32(offset, false),
            fsig1 = 0, fsig2 = 2;
        offset += 4;
        if( fsig0 !== 20 ) {
          fsig2 = fsig0;
          fsig1 = reader.getUint32(offset, false);
          fsig0 = reader.getUint32(offset + 4, false);
          offset += 8;
        }
        if( fsig0 == 20 && fsig1 == 0 && fsig2 == 2 ) {
          const footReader = new DataView( buf, offset );
          const footer = new TextDecoder().decode(footReader).split("\n");
          /** Example of the footer
  valid = 1  # volume info valid
  filename = ../mri/filled-pretess127.mgz
  volume = 256 256 256
  voxelsize = 1.000000000000000e+00 1.000000000000000e+00 1.000000000000000e+00
  xras   = -1.000000000000000e+00 0.000000000000000e+00 0.000000000000000e+00
  yras   = 0.000000000000000e+00 0.000000000000000e+00 -1.000000000000000e+00
  zras   = 0.000000000000000e+00 1.000000000000000e+00 0.000000000000000e+00
  cras   = -1.000000000000000e+00 -1.700000000000000e+01 1.900000000000000e+01
  \u0000\u0000\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0001ymris_re...
           */
           /*
          const xras = (footer[4].match(/^[ ]{0,}xras[ ]{0,}=[ ]{0,}(.*)$/i))[1]
            .split(/[ \t]+/i).map(parseFloat);
          const yras = (footer[5].match(/^[ ]{0,}yras[ ]{0,}=[ ]{0,}(.*)$/i))[1]
            .split(/[ \t]+/i).map(parseFloat);
          const zras = (footer[6].match(/^[ ]{0,}zras[ ]{0,}=[ ]{0,}(.*)$/i))[1]
            .split(/[ \t]+/i).map(parseFloat);
            */
          const cras = (footer[7].match(/^[ ]{0,}cras[ ]{0,}=[ ]{0,}(.*)$/i))[1]
            .split(/[ \t]+/i).map(parseFloat);
          // using threejs mat4 convention (column-major)
          this.tkrToScan = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            cras[0], cras[1], cras[2], 1
          ];

        }
      }

    } catch (e) {}

  }

  dispose() {
    this.isInvalid = true;
    this.position = null;
    this.index = null;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    this.nVertices = el.nVertices;
    this.nFaces = el.nFaces;
    this.position = el.position;
    this.index = el.index;
    this.tkrToScan = el.tkrToScan;
    this.isSurfaceMesh = true;
    this.isFreeSurferMesh = true;
    return this;
  }

}


export { FreeSurferMesh }

