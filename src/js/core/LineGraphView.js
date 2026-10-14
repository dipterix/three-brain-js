/**
 * A small line plot for a controller row: one series against its own time axis,
 * with a cursor at the current time.
 *
 * It knows nothing about Tweakpane or the viewer -- it owns an element, takes
 * numbers, and draws. `EnhancedGUIController` wraps it as the "linegraph"
 * controller type.
 *
 * Colors come from the panel's CSS variables, so it follows the light and dark
 * themes without being told which one is active.
 */

const PADDING = { top: 4, right: 2, bottom: 10, left: 2 };

class LineGraphView {

  constructor({ height = 56 } = {}) {
    this.element = document.createElement("div");
    this.element.classList.add("threejs-control-linegraph");
    this.element.style.width = "100%";
    this.element.style.height = `${ height }px`;
    this.element.style.position = "relative";

    this.$canvas = document.createElement("canvas");
    this.$canvas.style.width = "100%";
    this.$canvas.style.height = "100%";
    this.$canvas.style.display = "block";
    this.element.appendChild( this.$canvas );

    // times and values are parallel and sorted by time
    this._times = [];
    this._values = [];

    this._min = undefined;        // explicit y-range, set by `setRange`
    this._max = undefined;
    this._dataMin = 0;            // y-range implied by the data
    this._dataMax = 0;

    this._cursor = undefined;
    this._empty = true;
    this._hidden = false;

    // the row has no width until it is in the document, and the panel can be
    // resized, so redraw whenever the box changes
    if( typeof ResizeObserver === "function" ) {
      this._observer = new ResizeObserver(() => { this.render(); });
      this._observer.observe( this.element );
    }
  }

  get hasData() {
    return !this._empty;
  }

  /** The y-range actually drawn: an explicit range if one was set, else the data's. */
  get range() {
    return {
      min : this._min ?? this._dataMin,
      max : this._max ?? this._dataMax,
    };
  }

  /**
   * Replaces the series. `values` and `times` are parallel; entries whose value
   * or time is not finite are dropped. Several values at one time are averaged,
   * so a contact carrying more than one reading per sample plots as its mean.
   */
  setData( values, times ) {
    const byTime = new Map();

    const push = ( time, value ) => {
      // `Number(null)` is 0, so a gap in the track would plot as a real zero
      if( value === null || value === undefined || value === "" ) { return; }
      value = Number( value );
      if( !Number.isFinite( time ) || !Number.isFinite( value ) ) { return; }
      const bucket = byTime.get( time );
      if( bucket ) {
        bucket.sum += value;
        bucket.count += 1;
      } else {
        byTime.set( time, { sum: value, count: 1 } );
      }
    };

    ( values ?? [] ).forEach(( value, i ) => {
      const time = Array.isArray( times ) ? times[ i ] : i;
      if( Array.isArray( value ) ) {
        // a multi-contact reading: plot its mean, as the viewer colors by one value
        value.forEach( v => push( time, v ) );
      } else {
        push( time, value );
      }
    });

    const sorted = [ ...byTime.entries() ].sort(( a, b ) => a[0] - b[0] );

    this._times = sorted.map( e => e[0] );
    this._values = sorted.map( e => e[1].sum / e[1].count );
    this._empty = this._values.length === 0;

    if( this._empty ) {
      this._dataMin = 0;
      this._dataMax = 0;
    } else {
      this._dataMin = Math.min( ...this._values );
      this._dataMax = Math.max( ...this._values );
    }

    this.render();
    return this;
  }

  /** Overrides the y-range; pass undefined for either end to fall back to the data. */
  setRange( min, max ) {
    this._min = min;
    this._max = max;
    this.render();
    return this;
  }

  setCursor( time ) {
    this._cursor = Number.isFinite( time ) ? time : undefined;
    this.render();
    return this;
  }

  _style( name, fallback ) {
    const value = getComputedStyle( this.element ).getPropertyValue( name );
    return value ? value.trim() : fallback;
  }

  render() {
    if ( this._hidden ) { return this; }
    const canvas = this.$canvas;
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    if( width <= 0 || height <= 0 ) { return this; }

    const ratio = window.devicePixelRatio || 1;
    if( canvas.width !== Math.round( width * ratio ) || canvas.height !== Math.round( height * ratio ) ) {
      canvas.width = Math.round( width * ratio );
      canvas.height = Math.round( height * ratio );
    }

    const ctx = canvas.getContext("2d");
    if( !ctx ) { return this; }
    ctx.setTransform( ratio, 0, 0, ratio, 0, 0 );
    ctx.clearRect( 0, 0, width, height );

    const foreground = this._style( "--tp-label-foreground-color", "#3d3d3d" );
    const groove = this._style( "--tp-groove-foreground-color", "#eaeaea" );
    const background = this._style( "--tp-monitor-background-color", "#eaeaea" );

    ctx.fillStyle = background;
    ctx.fillRect( 0, 0, width, height );

    if( this._empty ) { return this; }

    const plotLeft = PADDING.left;
    const plotRight = width - PADDING.right;
    const plotTop = PADDING.top;
    const plotBottom = height - PADDING.bottom;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    if( plotWidth <= 0 || plotHeight <= 0 ) { return this; }

    const { min, max } = this.range;
    const span = max - min;
    const firstTime = this._times[ 0 ];
    const lastTime = this._times[ this._times.length - 1 ];
    const timeSpan = lastTime - firstTime;

    const xAt = ( time ) => timeSpan > 0
      ? plotLeft + ( ( time - firstTime ) / timeSpan ) * plotWidth
      : plotLeft + plotWidth / 2;
    const yAt = ( value ) => span > 0
      ? plotBottom - ( ( value - min ) / span ) * plotHeight
      : plotTop + plotHeight / 2;

    // zero line, when zero is inside the range
    if( min < 0 && max > 0 ) {
      const y = yAt( 0 );
      ctx.strokeStyle = groove;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo( plotLeft, y );
      ctx.lineTo( plotRight, y );
      ctx.stroke();
    }

    // the series, clamped into the plot so an out-of-range sample cannot
    // scribble over the rest of the panel
    ctx.strokeStyle = foreground;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    this._values.forEach(( value, i ) => {
      const x = xAt( this._times[ i ] );
      const y = Math.min( plotBottom, Math.max( plotTop, yAt( value ) ) );
      if( i === 0 ) { ctx.moveTo( x, y ); } else { ctx.lineTo( x, y ); }
    });
    ctx.stroke();

    // current time
    if( this._cursor !== undefined && timeSpan > 0 &&
        this._cursor >= firstTime && this._cursor <= lastTime ) {
      const x = xAt( this._cursor );
      ctx.strokeStyle = foreground;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo( x, plotTop );
      ctx.lineTo( x, plotBottom );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // range labels, small enough to stay out of the way
    ctx.fillStyle = foreground;
    ctx.globalAlpha = 0.6;
    ctx.font = "9px " + this._style( "--tp-base-font-family", "monospace" );
    ctx.textBaseline = "top";
    ctx.fillText( `${ this._format( max ) }`, plotLeft, 0 );
    ctx.textBaseline = "bottom";
    ctx.fillText( `${ this._format( min ) }`, plotLeft, plotBottom );
    ctx.textBaseline = "bottom";
    ctx.fillText( `${ this._format( firstTime ) }`, plotLeft, height );
    const lastLabel = `${ this._format( lastTime ) }`;
    ctx.fillText( lastLabel, plotRight - ctx.measureText( lastLabel ).width, height );
    ctx.globalAlpha = 1;

    return this;
  }

  _format( value ) {
    if( !Number.isFinite( value ) ) { return ""; }
    const magnitude = Math.abs( value );
    if( magnitude !== 0 && ( magnitude < 0.01 || magnitude >= 10000 ) ) {
      return value.toExponential( 1 );
    }
    return String( Math.round( value * 100 ) / 100 );
  }

  dispose() {
    if( this._observer ) {
      this._observer.disconnect();
      this._observer = undefined;
    }
    this._times.length = 0;
    this._values.length = 0;
  }

}

export { LineGraphView };
