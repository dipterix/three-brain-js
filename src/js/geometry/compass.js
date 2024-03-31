/* mesh objects that always stays at the corner of canvas */

import { CONSTANTS } from '../core/constants.js';
import { Object3D, Vector3, ArrowHelper, Color, Mesh, MeshBasicMaterial, DoubleSide, Quaternion } from 'three';
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
    this._tmpQuaternion = new Quaternion();

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

    this._camera = camera;
    this._control = control;
    this._left = new Vector3();
    this._down = new Vector3();

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

    }
  }

}



export { Compass, BasicCompass };
