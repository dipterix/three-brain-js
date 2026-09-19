/**
 * A lil-gui-shaped controller backed by a single Tweakpane blade.
 *
 * The viewer's presets were written against lil-gui's chainable controller API
 * (`.min().max().step().onChange().setValue().hide()`), and the R package drives
 * controllers by name, so that API is the contract this class implements.
 *
 * Two things make the Tweakpane backing invisible to callers:
 *
 *   - The value lives on the bound object, never on the blade. `getValue` reads
 *     the object, `setValue` writes it and then refreshes the blade.
 *   - The handlers live on this facade, never on the blade. So the blade can be
 *     thrown away and rebuilt at any time without losing anything.
 *
 * That second point is what `_rebuild` is for. Tweakpane fixes a binding's
 * params (min/max/step/options) at creation, but the presets change them on live
 * controllers when data loads -- the animation time range, the surface color
 * range, the voxel thresholds. `_rebuild` disposes the blade and adds a fresh one
 * back at the same index.
 */

const COLOR_FALLBACK = "#ffffff";

// Tweakpane's `input-color-string` plugin claims any string that parses as a
// color, and it is registered ahead of `input-string`. A plain string controller
// that happens to hold "#c2c2c2" would silently become a color picker, so every
// string-valued binding asks for the text view explicitly. The one param the
// color plugin checks for is `view === 'text'`.
const TEXT_VIEW = "text";

/**
 * Tweakpane's color input needs a leading '#', but three's `Color.getHexString()`
 * returns bare hex and the R driver feeds that straight in. lil-gui accepted
 * either, so accept either here.
 */
function normalizeColor( value ) {
  if( typeof value !== "string" ) { return value; }
  const trimmed = value.trim();
  if( /^[0-9a-fA-F]{3}$/.test( trimmed ) || /^[0-9a-fA-F]{6}$/.test( trimmed ) ) {
    return `#${ trimmed }`;
  }
  return trimmed;
}

class EnhancedGUIController {

  /**
   * @param folder   the owning EnhancedGUI
   * @param name     controller name; also the key on `object` and the row label
   * @param object   the bound object
   * @param type     "number" | "string" | "boolean" | "option" | "color" | "function"
   * @param options  `args` (choices for "option") and anything else addController passed
   */
  constructor({ folder, name, object, type, choices } = {}) {
    this._folder = folder;
    this._name = name;
    this._type = type;

    this.object = object;
    this.property = name;

    // lil-gui type flags; read by StageTransition and ViewerControlCenter
    this._isColor    = type === "color";
    this._isSelector = type === "option";
    this._isNumber   = type === "number";
    this._isString   = type === "string";
    this._isBool     = type === "boolean";
    this._isFunction = type === "function";

    // params Tweakpane needs at creation time, mutated by min/max/step/options
    this._label    = name;
    this._min      = undefined;
    this._max      = undefined;
    this._decimals = undefined;
    // lil-gui always has an effective step, explicit or derived from the range;
    // see `_updateImplicitStep`
    this._step         = type === "number" ? 0.1 : undefined;
    this._stepExplicit = false;
    this._names    = undefined;
    this._values   = undefined;
    this._hidden   = false;
    this._disabled = false;

    // tooltip attributes, re-applied after every rebuild
    this._tooltipText = undefined;
    this._tooltipKey  = undefined;

    this._changeHandlers = [];
    this._finishHandlers = [];

    // guards the blade's own change event while we are refreshing it ourselves
    this._refreshing = false;

    if( choices !== undefined ) { this._setChoices( choices ); }

    this._blade = this._createBlade();
    this._decorate();
  }

  // ---- blade construction ------------------------------------------------

  _setChoices( choices ) {
    // lil-gui accepts either an array of values or a { label: value } object
    if( Array.isArray( choices ) ) {
      this._names  = choices.map( v => String( v ) );
      this._values = [ ...choices ];
    } else if( choices && typeof choices === "object" ) {
      this._names  = Object.keys( choices );
      this._values = this._names.map( k => choices[ k ] );
    }
  }

  _bindingParams( index ) {
    const params = { label: this._label, index: index };

    if( this._hidden )   { params.hidden = true; }
    if( this._disabled ) { params.disabled = true; }

    if( this._type === "option" ) {
      params.options = this._names.map(( text, i ) => ({ text: text, value: this._values[ i ] }));
      // a choice list whose values are strings needs the same color-detection
      // guard as a plain string controller
      if( this._values.some( v => typeof v === "string" ) ) { params.view = TEXT_VIEW; }
      return params;
    }

    if( this._type === "color" ) {
      params.view = "color";
      return params;
    }

    if( this._type === "string" ) {
      params.view = TEXT_VIEW;
      return params;
    }

    if( this._type === "number" ) {
      if( this._min  !== undefined ) { params.min  = this._min; }
      if( this._max  !== undefined ) { params.max  = this._max; }
      if( this._step !== undefined ) {
        // Tweakpane's `step` is a binding constraint: it rewrites the value on
        // every read, snapped to a grid anchored at zero rather than at `min`.
        // With the step a volume's data implies ((max-min)/255, say) that shows
        // a model value of 1.234 as 1.22, and even a value sitting exactly on
        // `min` as something else. lil-gui snapped user input only, so the step
        // is passed here as the pointer and keyboard increment instead.
        params.pointerScale = this._step;
        params.keyScale = this._step;
        // An integer step is the exception: its grid is exact, and a controller
        // that steps by whole numbers -- a component index -- means the snapping.
        if( Number.isInteger( this._step ) && this._step >= 1 ) {
          params.step = this._step;
        }
      }
      if( this._decimals !== undefined ) {
        const decimals = this._decimals;
        params.format = ( v ) => Number( v ).toFixed( decimals );
      }
      return params;
    }

    return params;
  }

  _createBlade( index ) {
    const pane = this._folder._pane;

    if( this._type === "function" ) {
      const params = { title: this._label };
      if( index !== undefined ) { params.index = index; }
      if( this._hidden )   { params.hidden = true; }
      if( this._disabled ) { params.disabled = true; }

      const button = pane.addButton( params );
      button.on( "click", () => {
        const fn = this.object[ this.property ];
        if( typeof fn === "function" ) { fn.call( this.object ); }
        // lil-gui's function controller fires onFinishChange after the call
        this._runChange( fn );
        this._runFinish( fn );
      });
      return button;
    }

    const binding = pane.addBinding( this.object, this.property, this._bindingParams( index ) );
    binding.on( "change", ( ev ) => {
      // `setValue` and `updateDisplay` drive the handlers themselves
      if( this._refreshing ) { return; }
      this._runChange( ev.value );
      if( ev.last ) { this._runFinish( ev.value ); }
    });
    return binding;
  }

  /**
   * Re-create the blade in place. Needed because Tweakpane fixes binding params
   * at creation; see the class comment.
   *
   * Content injected by a caller through `domElement.replaceChildren()` (the QR
   * code and drag-drop panels) is not restored, because no controller both
   * replaces its content and changes its params.
   */
  _rebuild() {
    const pane = this._folder._pane;
    const at = pane.children.indexOf( this._blade );
    this._blade.dispose();
    this._blade = this._createBlade( at >= 0 ? at : undefined );
    this._decorate();
    return this;
  }

  _decorate() {
    if( this._tooltipText !== undefined || this._tooltipKey !== undefined ) {
      this._applyTooltip();
    }
  }

  // ---- handlers ----------------------------------------------------------

  _runChange( value ) {
    this._changeHandlers.forEach( cb => { cb.call( this, value ); });
  }
  _runFinish( value ) {
    this._finishHandlers.forEach( cb => { cb.call( this, value ); });
  }

  onChange( callback ) {
    if( typeof callback === "function" ) { this._changeHandlers.push( callback ); }
    return this;
  }
  onFinishChange( callback ) {
    if( typeof callback === "function" ) { this._finishHandlers.push( callback ); }
    return this;
  }

  // ---- value -------------------------------------------------------------

  getValue() {
    return this.object[ this.property ];
  }

  /** Writes the value, updates the widget, then fires onChange and onFinishChange -- lil-gui's semantics. */
  setValue( value ) {
    if( this._isColor ) { value = normalizeColor( value ); }
    this.object[ this.property ] = value;
    this.updateDisplay();
    this._runChange( value );
    this._runFinish( value );
    return this;
  }

  /**
   * Re-reads the bound object into the widget without firing any handler.
   *
   * Tweakpane applies a binding's step and range constraints whenever it reads
   * the value, so a plain `refresh()` would write a snapped and clamped number
   * back onto the object -- turning a data-derived threshold of -3.7 into
   * -3.65. lil-gui constrained user input only and left programmatic values
   * alone, so the value is restored here. Constraints still apply when someone
   * drags or types, because that path writes through the widget, not here.
   */
  updateDisplay() {
    if( typeof this._blade.refresh === "function" ) {
      const intended = this.object[ this.property ];
      this._refreshing = true;
      try {
        this._blade.refresh();
      } catch (e) {
        console.warn(`Cannot refresh controller [${ this._name }]: ${ e }`);
      } finally {
        this._refreshing = false;
        if( this.object[ this.property ] !== intended ) {
          this.object[ this.property ] = intended;
        }
      }
    }
    return this;
  }

  /**
   * The value as `EnhancedGUI.save()` records it. Colors are written as
   * lower-case `#rrggbb`, the form lil-gui wrote, so state files saved before
   * and after the move compare byte for byte.
   */
  save() {
    const value = this.getValue();
    if( this._isColor && typeof value === "string" ) {
      return normalizeColor( value ).toLowerCase();
    }
    return value;
  }

  /**
   * Restores a value recorded by `save()`. Like lil-gui, this fires the change
   * handlers, which is how loading a state actually moves the scene.
   */
  load( value ) {
    return this.setValue( value );
  }

  /** Invokes a function controller, as clicking its button would. */
  fire() {
    const fn = this.object[ this.property ];
    if( typeof fn === "function" ) { fn.call( this.object ); }
    this._runChange( fn );
    this._runFinish( fn );
    return this;
  }

  // ---- params (each rebuilds the blade) ----------------------------------

  /**
   * lil-gui derives a step from the range whenever one was not given
   * explicitly, which sets both the slider's granularity and how many decimals
   * the field shows. Reproduced here so sliders feel the same.
   */
  _updateImplicitStep() {
    if( this._stepExplicit ) { return; }
    this._step = ( this._min !== undefined && this._max !== undefined )
      ? ( this._max - this._min ) / 1000
      : 0.1;
  }

  min( value ) {
    if( this._min === value ) { return this; }
    this._min = value;
    this._updateImplicitStep();
    return this._rebuild();
  }
  max( value ) {
    if( this._max === value ) { return this; }
    this._max = value;
    this._updateImplicitStep();
    return this._rebuild();
  }
  step( value ) {
    if( this._step === value && this._stepExplicit ) { return this; }
    this._step = value;
    this._stepExplicit = true;
    return this._rebuild();
  }
  decimals( value ) {
    if( this._decimals === value ) { return this; }
    this._decimals = value;
    return this._rebuild();
  }
  options( choices ) {
    this._setChoices( choices );
    this._type = "option";
    this._isSelector = true;
    return this._rebuild();
  }
  name( label ) {
    this._label = label;
    if( "label" in this._blade ) {
      this._blade.label = label;
    } else {
      this._rebuild();
    }
    return this;
  }

  // ---- visibility and state ---------------------------------------------

  show( visible = true ) {
    this._hidden = !visible;
    this._blade.hidden = this._hidden;
    return this;
  }
  hide() {
    return this.show( false );
  }
  enable( enabled = true ) {
    this._disabled = !enabled;
    this._blade.disabled = this._disabled;
    return this;
  }
  disable() {
    return this.enable( false );
  }

  get domElement() {
    return this._blade.element;
  }

  blur() {
    const active = document.activeElement;
    if( active && this._blade.element.contains( active ) ) { active.blur(); }
    return this;
  }

  destroy() {
    this._folder._forgetController( this );
    try { this._blade.dispose(); } catch (e) {}
  }

  // ---- tooltip -----------------------------------------------------------

  _applyTooltip() {
    const $el = this._blade.element;
    let text = this._tooltipText;
    if( typeof text !== "string" ) { text = this._name; }
    if( typeof this._tooltipKey === "string" ) {
      $el.setAttribute( 'viewer-tooltip', this._tooltipKey );
      text = `${ text } [keyboard shortcut: ${ this._tooltipKey }]`;
    }
    $el.setAttribute( 'data-toggle', "tooltip" );
    $el.setAttribute( 'title', text );
    return text;
  }

  tooltip( text, key ) {
    if( typeof text !== "string" ) {
      text = this._blade.element.getAttribute('title') || this._name;
    }
    this._tooltipText = text;
    if( typeof key === "string" ) { this._tooltipKey = key; }
    return this._applyTooltip();
  }

}

/**
 * Puts a second controller's widget on the first controller's row, so a toggle
 * and its action button share one line.
 *
 * Tweakpane lays a row out as `.tp-lblv` > `.tp-lblv_l` (label) + `.tp-lblv_v`
 * (widget); this is the only place that depends on those class names. Returns
 * false and leaves both rows alone if the layout is not what we expect, in
 * which case they simply render as two rows.
 *
 * Only safe for controllers that never rebuild -- `_rebuild` does not restore
 * the merge.
 */
function mergeControllerRows( primary, secondary ) {
  const primaryCell = primary.domElement.querySelector('.tp-lblv_v');
  const secondaryCell = secondary.domElement.querySelector('.tp-lblv_v');
  if( !primaryCell || !secondaryCell ) { return false; }

  // the pair needs more of the row than a single widget does; the width comes
  // from the `threejs-control-merged-row` rule in dipterix.css
  primary.domElement.classList.add('threejs-control-merged-row');

  primaryCell.style.display = 'flex';
  primaryCell.style.alignItems = 'center';
  primaryCell.style.gap = '4px';
  primaryCell.style.minWidth = '0';

  secondaryCell.style.width = 'auto';
  secondaryCell.style.flex = '1';
  secondaryCell.style.minWidth = '0';

  primaryCell.appendChild( secondaryCell );
  secondary.domElement.remove();
  return true;
}

export { EnhancedGUIController, COLOR_FALLBACK, mergeControllerRows, normalizeColor };
