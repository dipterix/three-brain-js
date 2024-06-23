import {
  Scene, WebGLRenderer, CanvasTexture, PerspectiveCamera, Color,
  BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh } from 'three';

class DynamicBackgound extends CanvasTexture {

  constructor( args = {} ) {
    super( args );
    this.isDynamicBackgound = true;
  }

  update () {
    if( this.image ) {
      this.needsUpdate = true;
    }
  }

}

const twoPI = Math.PI * 2;
const divisions = 1024;
const edgeSize = 4;

class DemoBackground extends DynamicBackgound {
  // "#FFA500" "#1874CD" "#006400" "#FF4500" "#A52A2A" "#7D26CD"
  constructor({ width, height, palettes = [ 0xFFA500, 0xf5eee6 ] } = {}) {
    super();
    this.image = document.createElement("canvas");
    width = width ?? divisions;
    height = height ?? divisions;
    this.image.width = width;
    this.image.height = height;

    this.freqs = [4, 8, 15, 30, 80, 150, 200];

    // initialize
    this.camera = new PerspectiveCamera( 30, 1, 0.1, 100 );
    this.camera.position.z = 10;

    this.scene = new Scene();
    this.scene.background = new Color().set( palettes[0] );

    this.renderer = new WebGLRenderer({ alpha: false, canvas: this.image });

    //
    const vertices = [];
    const indices = [];

    vertices.push( 0, -edgeSize, 0 );
    vertices.push( edgeSize * 2, -edgeSize, 0 );

    for ( let i = 0; i <= divisions; i ++ ) {

      const t = i / divisions;

      const x = Math.sin( t * Math.PI * 2 ) * 0.1;
      const y = ( t - 0.5 ) * 2 * edgeSize;

      vertices.push( x, y, 0,  edgeSize * 2, y, 0 );
      indices.push(
        0 + i * 2,
        1 + i * 2,
        2 + i * 2,
        2 + i * 2,
        1 + i * 2,
        3 + i * 2
      );

    }

    vertices.push( 0, edgeSize, 0 );
    vertices.push( edgeSize * 2, edgeSize, 0 );
    indices.push(
      0 + divisions * 2 + 2,
      1 + divisions * 2 + 2,
      2 + divisions * 2 + 2,
      2 + divisions * 2 + 2,
      1 + divisions * 2 + 2,
      3 + divisions * 2 + 2
    );


    this.geometry = new BufferGeometry();
    this.geometry.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
    this.geometry.setIndex( indices );

    //

    this.material = new MeshBasicMaterial( { color: palettes[ 1 ], } );
    this.object = new Mesh( this.geometry, this.material );
    this.object.position.set( -0.1 * edgeSize, 0, 0 );
    this.object.rotateZ(0.2);
    this.scene.add( this.object );

    //

  }

  update() {
    const position = this.geometry.attributes.position.array;
    const time = window.performance.now() / 1000;
    const freqs = this.freqs;
    const positionOffset = 6;

    // log(amp) = - oofSlope * log(freq) -> amp = freq ^ (-oofSlope)
    const oofSlope = 1.4 + 0.5 * Math.sin( time * twoPI / 5 );

    // Not phase but whatever
    const phase = Math.sin( time / 20 );
    const mag = freqs.map((f) => { return 0.4 * Math.pow( f , -oofSlope ); });

    let v = 0;
    for ( let i = 0 ; i < divisions; i ++ ) {

      const p = i / divisions;
      const envelope = Math.sin( p * twoPI );

      v = 0;

      for( let j = 0; j < freqs.length; j++ ) {

        v += Math.sin( ( freqs[ j ] ) * ( time / 20 + p ) * twoPI + time ) * mag[ j ];

      }

      // envelope
      v *= 0.2 * ( 2 + Math.sin( p * Math.PI * 3 ) );

      position[ i * 6 + positionOffset ] = Math.sin( - p * Math.PI ) * (0.3) + v;

    }
    this.geometry.attributes.position.needsUpdate = true;

    this.renderer.render( this.scene, this.camera );
    this.needsUpdate = true;
  }

}


export { DynamicBackgound, DemoBackground };
