/* mesh objects that always stays at the corner of canvas */

import { CONSTANTS } from '../core/constants.js';
import {
  Object3D, Vector3, ArrowHelper, Color, Mesh, Line, MeshBasicMaterial,
  LineBasicMaterial, DoubleSide, Quaternion, BufferGeometry } from 'three';
import { TextSprite } from '../ext/text_sprite.js';


class BasicCompass {
  constructor({
    text = 'RAS',
    arrowLength = 6,
    arrowWidth = 5.9,
    textDistance = 9,
    textSize = 6,
    layer = CONSTANTS.LAYER_SYS_MAIN_CAMERA_8
  } = {}){
    this._text = text;
    this.forceVisible = undefined;

    this.container = new Object3D();
    this.position = this.container.position.set(0, 0, 0);

    const color = new Color();
    const direction = new Vector3();
    const origin = new Vector3( 0 , 0 , 0 );
    const rotation = ['rotateZ', null, 'rotateX'];

    for( let ii in text ){
      // const geom = new CylinderGeometry( 0.5, 0.5, 3, 8 );
      const _c = [0,0,0];
      _c[ ii ] = 1;
      color.fromArray( _c );
      direction.fromArray( _c );
      _c[ ii ] = 255;

      // const line = new Mesh( geom, new MeshBasicMaterial({ color: color, side: DoubleSide }) );
      // if( rotation[ii] ) { line[ rotation[ii] ]( Math.PI / 2 ); }

      if( arrowLength > 0 ) {
        if( arrowWidth >= arrowLength ) {
          arrowWidth = 0.99 * arrowLength;
        }
        const axis = new ArrowHelper( direction, origin, arrowLength, color.getHex(), arrowWidth );
        axis.layers.set( layer );
        axis.children[0].layers.set( layer );
        axis.children[1].layers.set( layer );
        this.container.add( axis );
      }


      if( text[ ii ] !== " ") {
        const sprite = new TextSprite(text[ ii ], {
          textHeight: textSize,
          color: `rgba(${_c[0]}, ${_c[1]}, ${_c[2]}, 1)`
        });
        sprite.position.copy( direction ).multiplyScalar( textDistance );
        sprite.layers.set( layer );

        this.container.add( sprite );
      }
    }
  }

  dispose() {
    try {
      this.container.removeFromParent();
    } catch (e) {}
    this.container.children.forEach(el => {
      try {
        el.dispose();
      } catch (e) {}
    })
  }

  update() {
    if( this.forceVisible === false ) {
      this.container.visible = false;
      return;
    }
    if( this.forceVisible === true ) {
      this.container.visible = true;
    }
  }

  set visible ( visible ) {
    if( visible && this.forceVisible !== false ) {
      this.container.visible = true;
    } else {
      this.container.visible = false;
    }
  }

  get visible () {
    return this.container.visible;
  }

}

class Compass extends BasicCompass {
  constructor( camera, control, parameters = {} ){
    super( parameters );
    const layer = parameters.layer ?? CONSTANTS.LAYER_SYS_MAIN_CAMERA_8;

    this._camera = camera;
    this._control = control;
    this._left = new Vector3();
    this._down = new Vector3();

    // Also add ruler
    this.rulerContainer = new Object3D();


    const start = new Vector3(15, -1.8, 0);
    const end = new Vector3(35, -1.8, 0);
    const rulerGeometry = new BufferGeometry().setFromPoints([start, end]);
    const rulerMaterial = new LineBasicMaterial({ color: 0xff0000 });
    const line = new Line(rulerGeometry, rulerMaterial);
    line.layers.set( layer );
    this.ruler = line;
    this.rulerContainer.add(line);

    const rulerMeasure = new TextSprite(" 20.00 mm", {
      textHeight: 3,
      color: `#FFFFFF`
    });
    rulerMeasure.position.set(25, 0, 0);
    rulerMeasure.layers.set( layer );
    this.rulerContainer.add( rulerMeasure );
    this.rulerMeasure = rulerMeasure;
    this.setRulerColor("#000000");
  }

  setRulerColor( color ) {
    this.rulerMeasure.material.color.set( color );
    this.ruler.material.color.set( color );
  }

  dispose() {
    super.dispose();
    try {
      this.rulerContainer.removeFromParent();
    } catch (e) {}
    this.rulerContainer.children.forEach(el => {
      try {
        el.dispose();
      } catch (e) {}
    })
  }

  update(){
    super.update();
    if( this.container.visible ) {

      const aspRatio = (this._camera.top - this._camera.bottom) / (this._camera.right - this._camera.left);
      const zoom = 1 / this._camera.zoom;

      this._down.copy( this._camera.position ).sub( this._control.target ).normalize();

      this.container.position.copy( this._camera.position )
        .sub( this._down.multiplyScalar( 40 ) );

      // calculate shift-left
      this._left.copy( this._camera.up ).cross( this._down ).normalize()
        // .multiplyScalar( ( this._camera.left + this._camera.right ) / 2 );
        .multiplyScalar( ( this._camera.left + 10 * zoom + ( -150 * ( zoom - 1 ) ) ) );

      this._down.copy( this._camera.up ).normalize()
        .multiplyScalar( ( this._camera.bottom + 10 * zoom + ( -150 * ( zoom - 1 ) ) * aspRatio ) );

      this.container.position.add( this._left ).add( this._down );
      this.container.scale.set( zoom, zoom, zoom );


      // this._left.normalize()
        // .multiplyScalar( ( this._camera.left + 20 * zoom + ( -150 * ( zoom - 1 ) ) ) );

      this.rulerContainer.rotation.copy( this._camera.rotation );
      this.rulerContainer.position.copy( this.container.position );
      this.rulerContainer.scale.copy( this.container.scale );
      this.rulerMeasure.text = `${ (zoom * 20).toFixed(2) } mm`.padStart(9, ' ');

    }
  }

}



export { Compass, BasicCompass };
