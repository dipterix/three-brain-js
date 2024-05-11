import { STLLoader } from '../jsm/loaders/STLLoader.js';

function extractAttribute(geometry, attr) {
  let bufferAttr;
  if( attr === "index" ) {
    bufferAttr = geometry.index;
  } else {
    bufferAttr = geometry.getAttribute( attr );
  }
  if(!bufferAttr || typeof bufferAttr !== "object" || !bufferAttr.isBufferAttribute ) {
    return;
  }
  return bufferAttr;
}

class STLMesh {

  // data must be arraybuffer
  constructor( data ) {
    this.isInvalid = true;
    if( !data ) { return; }

    // threejs has existing STLLoader, but I want it to work under workers
    // hence only typed arrays can be kept
    const geometry = new STLLoader().parse(data);
    // ffff.text().then(v => {window.vvvv = v;})

    const geomAttr = extractAttribute( geometry, 'position' );
    if( !geomAttr ) { return; }
    this.nVertices = geomAttr.count;
    this.position = geomAttr.array;

    const indexAttr = extractAttribute( geometry, 'index' );
    if( indexAttr ) {
      this.nFaces = indexAttr.count;
      this.index = indexAttr.array;
    } else {
      // In such case, normal must exists
      this.nFaces = 0;
      this.index = null;
    }


    // maybe normals and color
    const normalAttr = extractAttribute( geometry, 'normal' );
    if( normalAttr ) {
      this.normal = normalAttr.array;
      this.hasNormals = true;
    } else {
      this.normal = null;
      this.hasNormals = false;
    }

    const colorAttr = extractAttribute( geometry, 'color' );
    if( colorAttr ) {
      this.color = colorAttr.array;
      this.hasColors = true;
    } else {
      this.color = null;
      this.hasColors = false;
    }
    this.isSTLMesh = true;
    this.isSurfaceMesh = true;

    this.isInvalid = false;

  }

  dispose() {
    this.isInvalid = true;
    this.position = NaN;
    this.index = NaN;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    this.nVertices = el.nVertices;
    this.nFaces = el.nFaces;
    this.position = el.position;
    this.index = el.index;
    this.isSurfaceMesh = true;
    this.isSTLMesh = true;

    this.hasNormals = el.hasNormals;
    if( el.hasNormals ) {
      this.normal = el.normal;
    } else {
      this.normal = null;
    }

    this.hasColors = el.hasColors;
    if( el.hasColors ) {
      this.color = el.color;
    } else {
      this.color = null;
    }

    return this;
  }


}

export { STLMesh }
