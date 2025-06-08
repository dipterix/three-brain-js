import { CONSTANTS } from '../core/constants.js';
import {
  BufferAttribute, BufferGeometry, Object3D, CylinderGeometry,
  MeshBasicMaterial, LineBasicMaterial, LineDashedMaterial, SpriteMaterial,
  Mesh, Line, Vector3 } from 'three';
import { Sprite2, TextTexture } from '../ext/text_sprite.js';

const _axis = /*@__PURE__*/ new Vector3();
const _dir = /*@__PURE__*/ new Vector3();
const _dir2 = /*@__PURE__*/ new Vector3();
const DEFAULT_TEXT = "----------"
const TEXT_LENGTH = DEFAULT_TEXT.length;
const MAX_N_KNOTS = 500;


const MIN_TEXT_SCALE = 0.04, // 1 / 25
      MAX_TEXT_SCALE = CONSTANTS.MAIN_CAMERA_MAX_ZOOM;

let _coneGeometryTarget, _coneGeometrySource;

function ensureConeGeometries() {
  if ( _coneGeometryTarget === undefined ) {

    _coneGeometryTarget = new CylinderGeometry( 0, 0.5, 1, 5, 1 );
    _coneGeometryTarget.translate( 0, - 0.5, 0 );

    _coneGeometrySource = new CylinderGeometry( 0.5, 0, 1, 5, 1 );
    _coneGeometrySource.translate( 0, 0.5, 0 );

  }
}

function setDirection( dir, cone ) {

  // dir is assumed to be normalized

  if ( dir.y > 0.99999 ) {

    cone.quaternion.set( 0, 0, 0, 1 );

  } else if ( dir.y < - 0.99999 ) {

    cone.quaternion.set( 1, 0, 0, 0 );

  } else {

    _axis.set( dir.z, 0, - dir.x ).normalize();

    const radians = Math.acos( dir.y );

    cone.quaternion.setFromAxisAngle( _axis, radians );

  }

}

function padText( text, align = "center" ) {
  if( text === undefined ) {
    text = "";
  }
  let txt = `${text}`.trim();
  if( TEXT_LENGTH > txt.length ) {
    if( align === "center" ) {
      const prePad = Math.ceil( (TEXT_LENGTH - txt.length) * 0.5 );
      const postPad = TEXT_LENGTH - txt.length - prePad;
      txt = `${ ' '.repeat(prePad) }${ txt }${ ' '.repeat(postPad) }`;
    } else {
      // left
      const postPad = TEXT_LENGTH - txt.length;
      txt = `${ txt }${ ' '.repeat(postPad) }`;
    }
  }

  return txt;
}

class RulerHelper extends Object3D {

  // dir is assumed to be normalized

  constructor( color = 0xff0000, headLength = 1, headWidth = 0.5 ) {

    super();
    ensureConeGeometries();

    this.type = 'RulerHelper';

    // used to calculate _lineGeometry, stores Vector3 of world positions
    this.knots = [];
    this._lineGeometryPositionAttribute = new BufferAttribute( new Float32Array( 3 * MAX_N_KNOTS ), 3 );
    this._lineGeometry = new BufferGeometry();
    this._lineGeometry.setAttribute( 'position', this._lineGeometryPositionAttribute );

    this.position.set( 0, 0, 0 );

    // Relative head length and width for cone
    this.headLength = headLength;
    this.headWidth = headWidth;

    // solid line with depth and dashed line without depth (nearest depth)
    this.solidLine = new Line( this._lineGeometry, new LineBasicMaterial( { color: color, toneMapped: false } ) );
    this.solidLine.matrixAutoUpdate = false;
    this.dashedLine = new Line( this._lineGeometry, new LineDashedMaterial( {
      color: color,
      toneMapped: false,
      dashSize: 0.5,
      gapSize: 1.0,
      transparent: true,
      depthTest : false,
      depthWrite : false,
    } ) );
    this.dashedLine.renderOrder = CONSTANTS.RENDER_ORDER.RulerHelper;

    // this.dashedLine.computeLineDistances();
    this.dashedLine.matrixAutoUpdate = false;
    this.add( this.solidLine );
    this.add( this.dashedLine );

    this.coneMaterial = new MeshBasicMaterial( {
      color: color, toneMapped: false,
      transparent: true,
      depthTest : false,
      depthWrite : false,
    } );
    this.coneSource = new Mesh( _coneGeometrySource, this.coneMaterial );
    this.coneSource.matrixAutoUpdate = false;

    this.coneTarget = new Mesh( _coneGeometryTarget, this.coneMaterial );
    this.coneTarget.matrixAutoUpdate = false;

    this.add( this.coneSource );
    this.add( this.coneTarget );

    // Text to display length
    this._textMap = new TextTexture( DEFAULT_TEXT, {
      weight : 900,
      size   : 32
    });
    this._textMapParams = {
      align : "center",
      color : this.coneMaterial.color.getStyle(),
    };
    this._textContent = DEFAULT_TEXT;
    this.text = new Sprite2( new SpriteMaterial({
      map: this._textMap,
      transparent: true,
      depthTest : false,
      depthWrite : false,
      color: 0xffffff
    }));
    this.text.renderOrder = CONSTANTS.RENDER_ORDER.RulerHelper;
    this.text.updateScale( 5 );
    this.add( this.text );

    this.subTexts = [];

  }

  _setSubTextSize( size ) {

    const n = Math.max( this.subTexts.length, size );
    let subText;

    for( let ii = 0 ; ii < n ; ii++ ) {

      if( ii < size ) {

        if( this.subTexts[ ii ] === undefined ) {

          const textMap = new TextTexture( DEFAULT_TEXT, {
            weight : 300,
            size   : 32
          });
          subText = new Sprite2( new SpriteMaterial({
            map: textMap,
            transparent: true,
            depthTest : false,
            depthWrite : false,
            color: 0xffffff
          }));
          subText.renderOrder = CONSTANTS.RENDER_ORDER.RulerHelper;
          subText.updateScale( 2.5 );
          this.add( subText );
          this.subTexts[ ii ] = subText;

        } else {

          subText = this.subTexts[ ii ];

        }

        subText.visible = true;

      } else {

        subText = this.subTexts[ ii ];
        subText.visible = false;

      }

    }

  }

  _setSubText( text, index = -1, { align = "center" } = {} ){


    if( index < 0 || index >= this.subTexts.size ) {
      index = this.subTexts.size;
    }

    let subText = this.subTexts[ index ];

    if( subText === undefined ) {

      const textMap = new TextTexture( DEFAULT_TEXT, {
        weight : 300,
        size   : 32
      });
      subText = new Sprite2( new SpriteMaterial({
        map: textMap,
        transparent: true,
        depthTest : false,
        depthWrite : false,
        color: 0xffffff
      }));
      subText.renderOrder = CONSTANTS.RENDER_ORDER.RulerHelper;
      subText.updateScale( 2.5 );
      this.add( subText );
      this.subTexts[ index ] = subText;

    }

    // subText.visible = true;

    subText.material.map.draw_text( padText(text, align), {
      align : align,
      color : this.coneMaterial.color.getStyle(),
    });

    return subText;

  }


  updateGeometry() {

    const nKnots = this.knots.length;

    if( nKnots < 2 ) {

      // unable to form any direction
      this.visible = false;
      this.coneSource.visible = false;
      this.coneTarget.visible = false;
      this._setSubTextSize( 0 );

    } else {

      let headLength = this.headLength,
          headWidth = this.headWidth,
          dirOrigin = this.knots[ 0 ],
          dirTarget = this.knots[ 1 ],
          dirLen = 0;

      // update coneSource
      this.coneSource.position.set( 0, 0, 0 );

      // get direction and length from dirOrigin to dirTarget
      _dir.copy( dirTarget ).sub( dirOrigin );
      dirLen = _dir.length();
      _dir.normalize();

      // set coneSource direction
      setDirection( _dir, this.coneSource );

      // make cone smaller if line is too short
      if( headLength > 0.3 * dirLen ) {
        headLength = 0.3 * dirLen;
        headWidth = this.headWidth * headLength / this.headLength;
      }

      this.coneSource.scale.set( headWidth, headLength, headWidth );
      this.coneSource.position.copy( dirOrigin );
      this.coneSource.updateMatrix();

      // update coneTarget
      headLength = this.headLength;
      headWidth = this.headWidth;
      dirOrigin = this.knots[ nKnots - 2 ];
      dirTarget = this.knots[ nKnots - 1 ];
      this.coneTarget.position.set( 0, 0, 0 );

      // get direction and length from dirOrigin to dirTarget
      _dir.copy( dirTarget ).sub( dirOrigin );
      dirLen = _dir.length();
      _dir.normalize();

      // set coneTarget direction
      setDirection( _dir, this.coneTarget );

      // make cone smaller if line is too short
      if( headLength > 0.3 * dirLen ) {
        headLength = 0.3 * dirLen;
        headWidth = this.headWidth * headLength / this.headLength;
      }

      this.coneTarget.scale.set( headWidth, headLength, headWidth );
      this.coneTarget.position.copy( dirTarget );
      this.coneTarget.updateMatrix();

      // make sure cones are visible
      this.coneSource.visible = true;
      this.coneTarget.visible = true;

      // update line geometry and text
      const lineGeometryPositions = this._lineGeometryPositionAttribute.array;

      let lineLength = 0;
      for( let ii = 0 ; ii < nKnots ; ii++ ) {

        dirTarget = this.knots[ ii ];

        if( ii < nKnots - 1 ) {
          dirOrigin = this.knots[ ii + 1 ];
          _dir.copy( dirTarget ).sub( dirOrigin );

          const segLength = _dir.length();
          lineLength += segLength;

          this._setSubText(`${segLength.toFixed(1)}mm`, ii * 2)
            .position.copy( dirTarget ).sub( _dir.multiplyScalar( 0.5 ) );
        }

        if( ii < nKnots - 2 ) {

          // calculate angles
          const angle = 180 / Math.PI * _dir2.copy( this.knots[ ii + 2 ] ).sub( dirOrigin ).angleTo( _dir );

          this._setSubText(`${angle.toFixed(0)}°`, ii * 2 + 1, { align : "left" })
            .position.copy( dirOrigin );

        }

        lineGeometryPositions[ ii * 3 ] = dirTarget.x;
        lineGeometryPositions[ ii * 3 + 1 ] = dirTarget.y;
        lineGeometryPositions[ ii * 3 + 2 ] = dirTarget.z;

      }

      this.text.position.copy( this.knots[ nKnots - 1 ] );

      this.setText(`${lineLength.toFixed(1)}mm`);

      if( nKnots >= 3 ) {
        this._setSubTextSize( 2 * nKnots - 3 );
      } else {
        this._setSubTextSize( 0 );
      }


      this._lineGeometryPositionAttribute.needsUpdate = true;
      this._lineGeometry.setDrawRange( 0, nKnots );
      this._lineGeometry.computeBoundingSphere();
      this.dashedLine.computeLineDistances();

      this.visible = true;

    }
  }

  addKnot( v, index = -1, update = true ) {

    if( !v.isVector3 ) {

      throw "`addKnot`: v must be a THREE.Vector3";

    } else {

      if( index < 0 ) {

        this.knots.push( v );

      } else {

        if( index <= this.knots.length ) {

          this.knots[ index ] = v;

        } else {

          throw "`addKnot`: index is out of bound";

        }

      }

    }


    if( update ) {

      this.updateGeometry();

    }

  }

  removeKnot( index = -1, update = true ) {
    if( index < 0 ) {

      index += this.knots.length;

    }

    if( index < 0 | index >= this.knots.length ) {

      // invalid index
      return;

    }

    this.knots.splice( index, 1 );

    if( update ) {

      this.updateGeometry();

    }

  }

  clearKnots() {

    this.knots.length = 0;
    this.updateGeometry();

  }

  setText( text ) {
    if( text === undefined ) {
      text = this._textContent;
    } else {
      text = padText(text);
      this._textContent = text;
    }

    this._textMap.draw_text( padText(text), this._textMapParams );
  }

  setTextScale( scale ) {
    if( typeof scale !== "number" ) { return; }
    if( scale < MIN_TEXT_SCALE ) {
      scale = MIN_TEXT_SCALE;
    } else if (scale > MAX_TEXT_SCALE) {
      scale = MAX_TEXT_SCALE;
    }
    const mainTextScale = scale * 5,
          subTextScale = scale * 2.5;
    this.text.updateScale( mainTextScale );
    this.subTexts.forEach(subText => {
      subText.updateScale( subTextScale );
    })
  }

  setColor( color ) {

    this.solidLine.material.color.set( color );
    this.dashedLine.material.color.set( color );
    this.coneMaterial.color.set( color );
    this._textMapParams.color = color.getStyle();
    this.setText();

  }

  copy( source ) {

    super.copy( source, false );

    this.solidLine.copy( source.solidLine );
    this.dashedLine.copy( source.dashedLine );

    this.coneSource.copy( source.coneSource );
    this.coneTarget.copy( source.coneTarget );

    return this;

  }

  dispose() {

    this.solidLine.geometry.dispose();
    this.solidLine.material.dispose();

    this.dashedLine.geometry.dispose();
    this.dashedLine.material.dispose();

    this.coneSource.geometry.dispose();
    this.coneTarget.geometry.dispose();
    this.coneMaterial.dispose();

  }

}


export { RulerHelper };
