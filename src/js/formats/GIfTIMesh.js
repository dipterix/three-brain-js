import gifti from 'gifti-reader-js';

class GiftiMesh {

  // data must be XML data (text)
  constructor( data ) {
    // ffff.text().then(v => {window.vvvv = v;})
    this.isInvalid = true;
    if( !data ) { return; }

    const gii = gifti.parse( data );
    window.gii = gii;

    this.nVertices = gii.getNumPoints();
    this.nFaces = gii.getNumTriangles();

    // positions Float32Array
    const pointArray = gii.getPointsDataArray();
    this.position = pointArray.getData();

    // get transforms
    let transform;
    if(Array.isArray(pointArray.transforms)) {
      for(let ii = 0 ; ii < pointArray.transforms.length; ii++) {
        const tform = pointArray.transforms[ii];
        try {
          // Only read in NIFTI_XFORM_SCANNER_ANAT transform
          if( tform.transformedSpace !== "NIFTI_XFORM_SCANNER_ANAT" ) {
            continue;
          }
          const tmat = tform.matrixData
            .split("\n")
            .map(v => { return v.trim().split(/[ ]+/g).map(parseFloat); })
            .filter(v => {return v.length === 4});

          if( tmat.length !== 3 && tmat.length !== 4 ) {
            throw "Not a valid transform";
          }
          transform = tmat;
        } catch (e) {}
      }
    }

    if( transform ) {
      // needs to apply transforms to anat!!!
      const posArray = this.position;
      const t11 = transform[0][0],
            t12 = transform[0][1],
            t13 = transform[0][2],
            t14 = transform[0][3],

            t21 = transform[1][0],
            t22 = transform[1][1],
            t23 = transform[1][2],
            t24 = transform[1][3],

            t31 = transform[2][0],
            t32 = transform[2][1],
            t33 = transform[2][2],
            t34 = transform[2][3];

      for(let ii = 0; ii < posArray.length / 3; ii++) {
        const x = posArray[ii * 3],
              y = posArray[ii * 3 + 1],
              z = posArray[ii * 3 + 2];

        posArray[ii * 3] = t11 * x + t12 * y + t13 * z + t14;
        posArray[ii * 3 + 1] = t21 * x + t22 * y + t23 * z + t24;
        posArray[ii * 3 + 2] = t31 * x + t32 * y + t33 * z + t34;
      }
    }

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
