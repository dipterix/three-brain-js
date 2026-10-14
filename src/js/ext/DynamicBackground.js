import { CanvasTexture, Color } from 'three';

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

// The band used to be rendered in 3D with a 30° field of view from 10 units
// away, shifted left and turned by 0.2 rad. The canvas shows this many units
// either side of the center.
const halfViewSize = Math.tan( Math.PI / 12 ) * 10;
const bandShiftX = -0.1 * edgeSize;
const bandAngle = 0.2;

/**
 * Animated demo-mode background: a band with a wavy left edge over a plain
 * color, drawn into a 2D canvas that serves as the scene background.
 * `backgroundColor` and `foregroundColor` (the band) can be changed at any
 * time; the next `update()` draws them.
 */
class DemoBackground extends DynamicBackgound {
  // "#FFA500" "#1874CD" "#006400" "#FF4500" "#A52A2A" "#7D26CD"
  constructor({ width, height, palettes = [ 0xFFA500, 0xf5eee6 ] } = {}) {
    super();
    this.image = document.createElement("canvas");
    width = width ?? divisions;
    height = height ?? divisions;
    this.image.width = width;
    this.image.height = height;
    this._context = this.image.getContext( "2d" );

    this.freqs = [4, 8, 15, 30, 80, 150, 200];

    this.backgroundColor = new Color().set( palettes[0] );
    this.foregroundColor = new Color().set( palettes[1] );

    // x of the band's wavy edge at each of `divisions + 1` heights, from
    // y = -edgeSize to y = edgeSize; the band extends to x = 2 * edgeSize
    this._edgeX = new Float32Array( divisions + 1 );
    for ( let i = 0; i <= divisions; i ++ ) {
      this._edgeX[ i ] = Math.sin( i / divisions * twoPI ) * 0.1;
    }
  }

  // moves the canvas path to band point ( x, y )
  _pathTo( x, y, first = false ) {
    const cos = Math.cos( bandAngle ), sin = Math.sin( bandAngle );
    const px = ( ( x * cos - y * sin + bandShiftX ) / halfViewSize + 1 ) / 2 * this.image.width;
    const py = ( 1 - ( x * sin + y * cos ) / halfViewSize ) / 2 * this.image.height;
    if( first ) {
      this._context.moveTo( px, py );
    } else {
      this._context.lineTo( px, py );
    }
  }

  update() {
    const edgeX = this._edgeX;
    const time = window.performance.now() / 1000;
    const freqs = this.freqs;

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

      edgeX[ i ] = Math.sin( - p * Math.PI ) * (0.3) + v;

    }

    const context = this._context;
    context.fillStyle = this.backgroundColor.getStyle();
    context.fillRect( 0, 0, this.image.width, this.image.height );

    context.fillStyle = this.foregroundColor.getStyle();
    context.beginPath();
    this._pathTo( 0, -edgeSize, true );
    for ( let i = 0; i <= divisions; i ++ ) {
      this._pathTo( edgeX[ i ], ( i / divisions - 0.5 ) * 2 * edgeSize );
    }
    this._pathTo( 0, edgeSize );
    this._pathTo( edgeSize * 2, edgeSize );
    this._pathTo( edgeSize * 2, -edgeSize );
    context.closePath();
    context.fill();

    this.needsUpdate = true;
  }

}


export { DynamicBackgound, DemoBackground };
