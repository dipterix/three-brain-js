import { Vector3, Sprite, Texture, SpriteMaterial, LinearFilter } from 'three';


class TextSprite extends Sprite {
  constructor(content = '', {
    textHeight = 10, color = 'rgba(0, 0, 0, 1)', fontFace = 'Arial',
    shadowBlur = 4, shadowColor = '#FFFFFF'
  } = {}) {
    super(new SpriteMaterial({ map: new Texture(), transparent:true, opacity: 0.5 }));
    this._text = content;
    this._textHeight = textHeight;
    this._color = color;
    this._shadowBlur = shadowBlur;
    this._shadowColor = shadowColor;

    this._fontFace = fontFace;
    this._fontSize = 90; // defines text resolution
    this._fontWeight = 'normal';

    this._canvas = document.createElement('canvas');
    this._texture = this.material.map;
    this._texture.minFilter = LinearFilter;

    this._genCanvas();
  }

  get text() { return this._text; }
  set text(content) { this._text = content; this._genCanvas(); }
  get textHeight() { return this._textHeight; }
  set textHeight(textHeight) { this._textHeight = textHeight; this._genCanvas(); }
  get color() { return this._color; }
  set color(color) { this._color = color; this._genCanvas(); }
  get fontFace() { return this._fontFace; }
  set fontFace(fontFace) { this._fontFace = fontFace; this._genCanvas(); }
  get fontSize() { return this._fontSize; }
  set fontSize(fontSize) { this._fontSize = fontSize; this._genCanvas(); }
  get fontWeight() { return this._fontWeight; }
  set fontWeight(fontWeight) { this._fontWeight = fontWeight; this._genCanvas(); }


  _genCanvas() {

    let initialized = true;
    if( typeof this._aspectRatio !== "number" ) {
      initialized = false;
    }

    const canvas = this._canvas;
    const ctx = canvas.getContext('2d');

    let font = `${this._fontWeight} ${this._fontSize}px ${this._fontFace}`;

    ctx.font = font;
    const textWidth = ctx.measureText(this._text).width;

    let actualFontSize = this._fontSize;
    let actualScale = this._textHeight;
    let offsetX = 0;

    if( !initialized ) {
      canvas.width = textWidth;
      canvas.height = this._fontSize;
      this._aspectRatio = canvas.width / canvas.height;
    } else {
      if( textWidth > canvas.width ) {
        actualFontSize = this._fontSize * canvas.width / textWidth;
        if( actualFontSize > 1 ) {
          // actualFontSize = Math.floor( actualFontSize );
        }
        actualScale = this._textHeight * this._fontSize / actualFontSize;

        font = `${this._fontWeight} ${ actualFontSize }px ${this._fontFace}`;
      } else {
        offsetX = Math.floor( ( canvas.width - textWidth ) / 2 );
        if( offsetX < 0 ) { offsetX = 0; }
      }
    }

    ctx.font = font;
    ctx.fillStyle = this._color;
    ctx.textBaseline = 'bottom';
    ctx.clearRect(0,0, canvas.width, canvas.height)
    ctx.shadowBlur = this._shadowBlur;
    ctx.shadowColor = this._shadowColor;
    ctx.fillText(this._text, offsetX, canvas.height);

    // Inject canvas into sprite
    this._texture.image = canvas;
    this._texture.needsUpdate = true;

    this.scale.set(actualScale * this._aspectRatio, actualScale);
  }

  clone() {
    return new this.constructor(this.text, this.textHeight, this.color, this._fontFace).copy(this);
  }

  copy(source) {
    Sprite.prototype.copy.call(this, source);

    this.color = source.color;
    this.fontFace = source.fontFace;
    this.fontSize = source.fontSize;
    this.fontWeight = source.fontWeight;

    return this;
  }

}

class Sprite2 extends Sprite {
  constructor( material ) {
    super( material );

    if( material.map.isTextTexture ){
      material.map.object = this;
      // re-draw texture
      material.map.draw_text( material.map.text );
    }

  }


  updateScale( v ) {
    this.material.map.updateScale( v );
	}
}

class TextTexture extends Texture {

  constructor( text, {
    mapping, wrapS, wrapT, magFilter, minFilter, format,
    type, anisotropy, font = "Courier", size = 32, weight = 400
  } = {} ) {

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    text = text ?? " ";
    canvas.width = Math.ceil( context.measureText(text).width );
    canvas.height = size;
    super( canvas, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy );

    // this._text = text || " ";
    this._size = Math.ceil( size );
    this._canvas = canvas;

    // const textLength = (text || " ").length;
    // this._canvas.height = this._size;
    // this._canvas.width = Math.ceil( textLength * this._size * 0.6 );
    this._context = context;
    this._asp = 1;
    // this._context.font = `${this._size}px ${font}`;
    // this._context.fillText( this._text, 0, this._size * 26 / 32);
    this._font = font;
    this._font_weight = weight;
		// this.needsUpdate = true;
		this.isTextTexture = true;
		this.object = null;

		this.draw_text( text );

	}

	updateScale( v ) {
	  if( this.object && typeof this.object === "object" &&
        this.object.isSprite === true )
    {
      if( v ){
        this.object.scale.z = v;
      }
      const base_scale = this.object.scale.z;
      this.object.scale.x = this._asp * this.object.scale.z;
      this.object.scale.y = 1 * this.object.scale.z;
    }
	}

  // align (0: center, 1: left, 2: right, 3: based on "-" or center)
	draw_text( text, more_args = {} ){

    this.text = text || "";

    // color = "#000000", shadow_color = "#FFFFF", shadow_blur = 4
    this._align = more_args.align || "smart";
    this._color = more_args.color || this._color || "#000000";
    this._shadow_color = more_args.shadow_color || this._shadow_color || "#FFFFFF";
    this._shadow_blur = more_args.shadow_blur ||
                              typeof this._shadow_blur === "undefined" ? 4 : this._shadow_blur;

    if( this.object && typeof this.object === "object" &&
        this.object.isSprite === true )
    {
  	  switch ( this._align ) {
  	    case 'left':
  	      this.object.center.x = 0.5 / this.text.length;
  	      break;
  	    case 'center':
  	      this.object.center.x = 0.5;
  	      break;
  	    case 'right':
  	      this.object.center.x = 1.0 - 0.5 / this.text.length;
  	      break;
  	    case 'smart':
  	      // find the first '-'
  	      const dash = this.text.indexOf("-");
  	      if( dash >= 0 ){
  	        this.object.center.x = dash * 0.5 / this.text.length;
  	      } else {
  	        this.object.center.x = 0.5;
  	      }
  	      break;
  	    default:
  	      // do nothing
  	  }
    }
	  this._text = this.text;

	  const maxWidth = Math.ceil( this._context.measureText(this._text).width );
	  this._asp = maxWidth / this._size;

    this._canvas.width = maxWidth
    this._canvas.height = this._size;
    // this._context.clearRect( 0 , 0 , this._canvas.width , this._canvas.height );
    this._context.fillStyle = 'rgba( 0, 0, 0, 0 )';
    this._context.fillRect( 0 , 0 , this._canvas.width , this._canvas.height );
    this._context.font = `${this._font_weight} ${this._size}px ${this._font}`;
    this._context.fillStyle = this._color;
    this._context.shadowBlur = this._shadow_blur || 0;
    this._context.shadowColor = this._shadow_color;
    this._context.fillText(this._text, 0, this._size * 26 / 32, maxWidth);
    this.needsUpdate = true;

    this.updateScale();

	}

}




export { TextSprite, Sprite2, TextTexture };
