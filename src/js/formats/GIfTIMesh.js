import gifti from 'gifti-reader-js';

class GiftiMesh {

  // data must be XML data (text)
  constructor( data ) {
    // ffff.text().then(v => {window.vvvv = v;})
    this.isInvalid = true;
    if( !data ) { return; }

    const gii = gifti.parse( data );

    this.nVertices = gii.getNumPoints();
    this.nFaces = gii.getNumTriangles();

    // positions Float32Array
    const pointArray = gii.getPointsDataArray();
    this.position = pointArray.getData();

    // Int32Array
    const indexArray = gii.getTrianglesDataArray().getData();
    const index = new Uint32Array( this.nFaces * 3 );
    for( let i = 0; i < this.nFaces * 3; i ++ ) {
      index[ i ] = indexArray[ i ];
    }
    this.index = index;
    this.isGiftiMesh = true;
    this.isSurfaceMesh = true;

    this.isInvalid = false;

    // TODO: handle tranforms, normals, and color
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
    this.isGiftiMesh = true;
    return this;
  }


}

export { GiftiMesh }
