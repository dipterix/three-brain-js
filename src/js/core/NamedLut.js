import {
  Color
} from 'three';
import {
  ColorMapKeywords, addToColorMapKeywords
} from '../jsm/math/Lut2.js';

class NamedLut {

  constructor({
    colormap, continuous = true, name = ""
  } = {}) {

    // tmp objects
    this._tmpColor = new Color();

    // look-up key colors
    this.lut = [];

    // max and min of data values, only used for continuous data; soft ranges
    // shouldn't exceed this hard range
    this._minV = -Infinity;
    this._maxV = Infinity;

    // boundaries of the lut, for continuous too
    // for cont. data,
    // color-index = (v - this._softMinV) / (this._softMaxV - this._softMinV) * (this.n - 1)
    this._defaultMinV = -1;
    this._defaultMaxV = 1;
    this._softMinV = -1;
    this._softMaxV = 1;
    this._legendTicks = [];

    // for discrete color table only key -> [0, 1]
    // color-index = this._map.indexOf( v )
    this._map = [];
    this._displayMap = {};

    // electrode value name
    this.name = name;
    this.isContinuous = continuous ? true : false;

    // time ranges where the color-map is valid. colors will be black when
    // sampled outside of the time range
    this.hasTimeRange = false;
    this.minTime = -Infinity;
    this.maxTime = Infinity;

    this.setControlColors( colormap );
  }

  setTimeRange( from, to ) {
    if ( typeof from !== "number" ) {
      this.hasTimeRange = false;
      return this;
    }
    this.hasTimeRange = true;
    if ( typeof to !== "number" ) {
      if( from < 0 ) {
        this.minTime = from;
        this.maxTime = 0;
      } else {
        this.minTime = 0;
        this.maxTime = from;
      }
      return this;
    }
    this.minTime = from;
    this.maxTime = to;
  }

  testTime( time ) {
    if( typeof time !== "number" ) { return false; }
    if( !this.hasTimeRange ) { return true; }
    if( this.minTime > time ) { return false; }
    if( this.maxTime < time ) { return false; }
    return true;
  }

  set( value ) {

    if ( value.isNamedLut === true ) {

      this.copy( value );

    }

    return this;

  }

  // for continuous data
  setDataMin ( min ) {
    if( !this.isContinuous ) {
      throw 'setDataMin is only for continuous color-map';
    }
    this._minV = min;
    this._defaultMinV = min;
    return this
  }
  setDataMax ( max ) {
    if( !this.isContinuous ) {
      throw 'setDataMax is only for continuous color-map';
    }
    this._maxV = max;
    this._defaultMaxV = max;
    return this
  }
  setMin( min ) {
    if( !this.isContinuous ) {
      throw 'setMin is only for continuous color-map';
    }
    if( min < this._minV ) {
      this._softMinV = this._minV;
    } else {
      this._softMinV = min;
    }
    return this;
  }
  resetMin() {
    this._softMinV = this._defaultMinV;
  }
  setMax( max ) {
    if( !this.isContinuous ) {
      throw 'setMax is only for continuous color-map';
    }
    if( max > this._maxV ) {
      this._softMaxV = this._maxV;
    } else {
      this._softMaxV = max;
    }
    return this;
  }
  resetMax() {
    this._softMaxV = this._defaultMaxV;
  }

  // for discrete data
  setKeys ( keys ) {
    if( this.isContinuous ) {
      throw 'setMap(keys) is only for discrete color-map';
    }
    if( !Array.isArray(keys) ) {
      throw 'setMap(keys): `keys` must be an array.';
    }
    this._map.length = 0;
    for( let i = 0; i < keys.length; i++ ) {
      this._map.push( keys[ i ] );
    }
  }

  setControlColors( colormap ) {

    let controlColors = undefined;
    if( colormap && Array.isArray( colormap ) && colormap.length > 0 ) {
      controlColors = colormap;
    } else if ( typeof colormap === "string" ) {
      controlColors = ColorMapKeywords[ colormap ] || ColorMapKeywords.rainbow;
    }

    if( !controlColors ) {
      if( this.lut.length > 0 ) {
        controlColors = [...this.lut];
      } else {
        controlColors = ColorMapKeywords.rainbow;
      }
    }

    if( !Array.isArray(controlColors) || controlColors.length < 1 ) {
      controlColors = ColorMapKeywords.rainbow;
    }
    const sampleElement = controlColors[0];

    this.lut.length = 0;
    for( let i = 0; i < controlColors.length; i++ ) {
      let elem = controlColors[ i ];

      if( !elem ) { continue; }

      if( Array.isArray( elem ) ) {
        if( elem.length == 0 ) { continue; }
        if( elem.length == 1 ) { elem = elem[0]; } else { elem = elem[1]; }
      }

      if( typeof elem === "string" ) {
        elem = elem.replace("0x", "#");
        if( !elem.startsWith("#") ) {
          elem = "#" + elem;
        }
        this.lut.push( new Color().setStyle( elem ) );
      } else if ( typeof elem === "number" ) {
        this.lut.push( new Color().setHex( elem ) );
      } else if ( typeof elem === "object" && elem.isColor ) {
        this.lut.push( elem );
      } else {
        throw 'Unable to parse control colors'
      }
    }
    if( this.lut === 1 ) {
      this.lut.push( this.lut[0] );
    }
    return this;
  }

  copy( lut ) {
    this.lut = [...lut.lut];
    this._minV = lut._minV;
    this._maxV = lut._maxV;
    this._softMinV = lut._softMinV;
    this._softMaxV = lut._softMaxV;
    this._map = [...lut.map];
    this.name = name + "-cloned";
    this.isContinuous = lut.isContinuous;
    this.hasTimeRange = lut.hasTimeRange;
    this.minTime = lut.minTime;
    this.maxTime = lut.maxTime;
    return this;
  }

  getColor( v, c ) {
    if( !c.isColor ) {
      throw 'c must be a THREE.Color instance';
    }
    if( v === undefined || v === null ) {
      c.setHex( 0xffffff );
      return c;
    }
    if( !this.lut.length ) {
      c.setHex( 0xffffff );
      return c;
    }
    if( this.isContinuous ) {
      if( this.lut.length == 1 ) {
        c.copy( this.lut[0] );
        return c;
      }

      // color-index = (v - this._softMinV) / (this._softMaxV - this._softMinV) * (this.n - 1)
      const idx = (v - this._softMinV) / (this._softMaxV - this._softMinV) * (this.lut.length - 1);
      if( idx <= 0 ) {
        c.copy( this.lut[0] );
        return c;
      }

      if( idx >= this.lut.length - 1 ) {
        c.copy( this.lut[ this.lut.length - 1 ] );
        return c;
      }
      const idx0 = Math.floor( idx );
      this._tmpColor.copy( this.lut[ idx0 ] ).multiplyScalar( idx0 + 1 - idx );
      c.copy( this.lut[ idx0 + 1 ] ).multiplyScalar( idx - idx0 ).add( this._tmpColor );
      return c;

    }

    // discrete
    const idx = this._map.indexOf( v );
    if( idx < 0 || idx >= this.lut.length ) {
      c.setHex( 0xffffff );
      return c;
    }

    c.copy( this.lut[ idx ] );
    return c;

  }

  addColorMap( name, arrayOfColors ) {

    ColorMapKeywords[ name ] = arrayOfColors;

    return this;

  }

  renderLegend(
    contextWrapper,
    canvasWidth, canvasHeight,
    {
      legendWidth = 50,         // 50 px width, or 25 pixels if pixelRatio is 2
      offsetTopRatio = 0.3,     // 30% margin top
      offsetRight = 0,          // 0 margin right
      lineHeight = 30,          // 15 * pixelRatio
      fontSize = 20,            // 10 * pixelRatio
      fontType = 'Courier New, monospace',
      highlightValue = NaN,
      foreground = "#000000",
      background = "#FFFFFF"
    } = {}
  ) {

    if( !this.lut.length ) { return; }
    if( this.isContinuous && this.lut.length < 2 ) { return; }
    if( !this.isContinuous && !this._map.length ) { return; }

    // 50% of the canvas height
    let legendHeightRatio = 0.45;

    // leave enough space to display legend strings; default is 9+7 = 16 chars
    let maxLegendTextLabel = 9;
    if( !this.isContinuous ) {
      this._map.forEach( (v) => {
        if( maxLegendTextLabel < v.length ) {
          maxLegendTextLabel = v.length;
        }
      });
      // this._lineHeight_legend * 2 = 60 px, this is the default block size
      legendHeightRatio = (this._map.length - 1) * lineHeight * 2 / canvasHeight;
      if( legendHeightRatio > 0.6 ) {
        legendHeightRatio = 0.6;
      }
    }
    const legendStartRight = Math.ceil( fontSize * 0.42 * ( maxLegendTextLabel + 8 ) + legendWidth + offsetRight );

    // this.name.length * fontSize * 0.42 is estimate of font width
    // legendStartRight - legendWidth / 2 is translate-left amount
    const titleOffsetRight = Math.ceil(
      this.name.length * fontSize * 0.42 - legendWidth / 2 + legendStartRight
    );

    const offsetBottomRatio = 1.0 - offsetTopRatio - legendHeightRatio;

    // legend tick text positions
    // text left boundary start legendWidth away from legend left boundary
    const textBoundaryOffsetRight = Math.round( legendStartRight - legendWidth );
    // actual text starting position, leave 1 character padding left
    const textStartLeft = Math.round( canvasWidth - textBoundaryOffsetRight + fontSize );
    // pixels of tick character height in half
    const textCharHeightHalf = Math.round( fontSize * 0.21 );

    // start and end in X axis
    const tickStartX = canvasWidth - textBoundaryOffsetRight;
    const tickEndX = tickStartX + textCharHeightHalf;

    if( this.isContinuous ) {
      // Create a linear gradient map, grd is plotted from top-down
      const grd = contextWrapper.context.createLinearGradient( 0 , 0 , 0 , canvasHeight );

      // Determine legend coordinates and steps
      let colorStepRatio = legendHeightRatio / ( this.lut.length - 1 );

      // Starts from legend_start of total height (h)
      grd.addColorStop( 0, background );
      grd.addColorStop( offsetTopRatio - 4 / canvasHeight, background );
      this.lut.forEach( ( c , ii ) => {
        grd.addColorStop(
          offsetTopRatio + colorStepRatio * ( this.lut.length - 1 - ii ),
          '#' + c.getHexString()
        );
      });
      grd.addColorStop(
        legendHeightRatio + offsetTopRatio + 4 / canvasHeight,
        background );

      // Fill with gradient
      contextWrapper.fill_gradient(
        grd, canvasWidth - legendStartRight ,
        offsetTopRatio * canvasHeight ,
        legendWidth , legendHeightRatio * canvasHeight );

      // calculate max, min, and zero tick positions (height axis)
      const zeroY = (
        offsetTopRatio + this._softMaxV * legendHeightRatio / (this._softMaxV - this._softMinV)
      ) * canvasHeight;
      const minValueY = ( legendHeightRatio + offsetTopRatio ) * canvasHeight;
      const maxValueY = offsetTopRatio * canvasHeight;
      legendHeightRatio

      contextWrapper.set_font( fontSize, fontType );
      contextWrapper.set_font_color( foreground );

      // Title. It should be 2 lines above legend grid, the Y position is the
      // baseline of the title, hence need to + textCharHeightHalf
      contextWrapper.fill_text(
        this.name,
        canvasWidth - titleOffsetRight,
        maxValueY - lineHeight * 2 + textCharHeightHalf
      );

      // Also display actual range if possible
      let dataRangeText;
      if( isFinite(this._minV) && isFinite(this._maxV) ){
        dataRangeText =
          `[${this._minV.toPrecision(4)} ~ ${this._maxV.toPrecision(4)}]`
            .replace(/\.[0]+\ ~/, ' ~')
            .replace(/\.[0]+\]$/, ']')
            .replace(/\.[0]+e/, 'e');
      } else {
        dataRangeText =
          `[${this._defaultMinV.toPrecision(4)} ~ ${this._defaultMaxV.toPrecision(4)}]`
            .replace(/\.[0]+\ ~/, ' ~')
            .replace(/\.[0]+\]$/, ']')
            .replace(/\.[0]+e/, 'e');
      }

      // contextWrapper.context.textAlign = "left";
      contextWrapper.fill_text(
        dataRangeText,
        canvasWidth - titleOffsetRight - dataRangeText.length / 4 * fontSize,
        minValueY + lineHeight * 2
      );

      // Do we need to draw zero, minV, maxV tick?
      let drawZeroTick = (
        this._softMinV < 0 && this._softMaxV > 0 &&
        minValueY - zeroY >= lineHeight * 0.7 &&
        zeroY - maxValueY >= lineHeight * 0.7
      );
      let drawMinTick = true, drawMaxTick = true;

      // Draw highlighed value in bold font
      let highlightValueY;
      if( typeof( highlightValue ) === 'number' &&
          !isNaN( highlightValue ) ){
        // There is a colored object rendered, display it
        highlightValueY = (
          offsetTopRatio +
          (this._softMaxV - highlightValue) * legendHeightRatio / (this._softMaxV - this._softMinV)
        ) * canvasHeight;

        // if value is out of the legend, let it stay at top/bottom of the legend
        // (0,0) is the top-left screen
        if( highlightValueY - minValueY > lineHeight * 0.8 ) {
          highlightValueY = minValueY + lineHeight * 0.8;
        }
        if( maxValueY - highlightValueY > lineHeight * 0.8 ) {
          highlightValueY = maxValueY - lineHeight * 0.8;
        }

        if( Math.abs( highlightValueY - zeroY ) < lineHeight * 0.7 ) {
          drawZeroTick = false;
        }
        if( Math.abs( highlightValueY - maxValueY ) < lineHeight * 0.7 ) {
          drawMaxTick = false;
        }
        if( Math.abs( highlightValueY - minValueY ) < lineHeight * 0.7 ) {
          drawMinTick = false;
        }

        // bold font
        contextWrapper.set_font( fontSize , fontType, true );
        contextWrapper.fill_text(
          highlightValue.toPrecision(4),
          textStartLeft,
          highlightValueY + textCharHeightHalf
        );
      }

      contextWrapper.set_font( fontSize , fontType, false );
      if( drawZeroTick ) {
        contextWrapper.fill_text(
          "0",
          textStartLeft,
          zeroY + textCharHeightHalf
        );
      }
      if( drawMinTick ) {
        contextWrapper.fill_text(
          this._softMinV.toPrecision(4),
          textStartLeft,
          minValueY + textCharHeightHalf
        );
      }
      if( drawMaxTick ) {
        contextWrapper.fill_text(
          this._softMaxV.toPrecision(4),
          textStartLeft,
          maxValueY + textCharHeightHalf
        );
      }

      // also draw tick lines
      // this.domContext.beginPath();
      contextWrapper.start_draw_line();
      if( typeof highlightValueY === "number" ) {
        contextWrapper.draw_line([
          [ tickStartX , highlightValueY ],
          [ tickEndX , highlightValueY - 2 ],
          [ tickEndX , highlightValueY + 2 ],
          [ tickStartX , highlightValueY ]
        ]);
      }
      if( drawZeroTick ) {
        // this.domContext.moveTo( x , y );
        // this.domContext.lineTo( x+w , y );
        contextWrapper.draw_line([
          [ tickStartX , zeroY ],
          [ tickEndX , zeroY ]
        ]);
      }
      if( drawMinTick ) {
        contextWrapper.draw_line([
          [ tickStartX , minValueY ],
          [ tickEndX , minValueY ]
        ]);
      }
      if( drawMaxTick ) {
        contextWrapper.draw_line([
          [ tickStartX , maxValueY ],
          [ tickEndX , maxValueY ]
        ]);
      }
      // this.domContext.stroke();
      contextWrapper.stroke_line();
    } else {

      // discrete legend

      // total number of discrete values
      const nLevels = this._map.length;
      const itemStep = nLevels == 1 ? 52 : Math.floor(
        legendHeightRatio / ( nLevels - 1 ) * canvasHeight
      );
      const squareHeight = itemStep >= 52 ? 50 : Math.max(itemStep - 2, 4);

      let fontSize2 = fontSize;
      if( squareHeight <= fontSize ) {
        fontSize2 = Math.max(squareHeight - 2, 6);
      }



      contextWrapper.set_font( fontSize2, fontType );
      contextWrapper.set_font_color( foreground );

      // Draw title. It should be 1 lines above legend grid
      contextWrapper.fill_text(
        this.name,
        canvasWidth - titleOffsetRight,
        canvasHeight * offsetTopRatio - 50 );


      // Draw squares, ticks, and text
      const offsetTop = offsetTopRatio * canvasHeight;
      const squareX = canvasWidth - legendStartRight;
      const textStartLeft2 = Math.ceil( canvasWidth - textBoundaryOffsetRight + fontSize2 / 2 );
      this._map.forEach( (text, ii) => {
        const squareCenterY = offsetTop + itemStep * ii;

        // Draw square
        contextWrapper.fill_rect(
          '#' + this.getColor(text, this._tmpColor).getHexString(),
          squareX , squareCenterY - squareHeight / 2,
          legendWidth , squareHeight
        );

        // Draw tick
        contextWrapper.set_font_color( foreground );

        if( highlightValue === text ) {
          contextWrapper.set_font( fontSize2, fontType, true );

          contextWrapper.fill_text(
            text,
            textStartLeft2,
            squareCenterY + textCharHeightHalf,
            // Max width
            canvasWidth - textStartLeft2 - 5
          );

          contextWrapper.set_font( fontSize2, fontType, false );
        } else {

          contextWrapper.fill_text(
            text,
            textStartLeft2,
            squareCenterY + textCharHeightHalf,
            // Max width
            canvasWidth - textStartLeft2 - 5
          );


        }

      })

    }


  }

}

NamedLut.prototype.isNamedLut = true;

export { NamedLut };
