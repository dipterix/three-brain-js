import { AbstractThreeBrainObject } from './abstract.js';
import { Sprite2, TextTexture } from '../ext/text_sprite.js';
import { SpriteMaterial } from 'three';
import { CONSTANTS } from '../core/constants.js';

/**
 * TextDecor — a canvas-space text sprite.
 *
 * Expected fields in `g` (the geometry params object):
 *   text        {string}   - label to render
 *   font_size   {number}   - world-space height of the sprite (default: 5)
 *   color       {string}   - CSS colour string (default: '#ffffff')
 *   font_weight {number}   - CSS font-weight (default: 400)
 *   decor_id    {string}   - stable ID used as key in canvas.textDecorators
 *                            (defaults to g.name if absent)
 *   position    {number[]} - [x, y, z] in tkrRAS / world space (default: [0,0,0])
 *   layer       {number|number[]} - camera layer(s) (default: [1])
 *   clickable   {boolean}  - whether raycasting picks this sprite (default: false)
 */
class TextDecor extends AbstractThreeBrainObject {

  constructor(g, canvas) {
    super(g, canvas);
    this.type = 'TextDecor';
    this.isSprite = true;
    this.clickable = g.clickable === true;

    const text = typeof g.text === 'string' ? g.text : '';
    const fontSize = typeof g.font_size === 'number' && g.font_size > 0 ? g.font_size : 5;
    const color = typeof g.color === 'string' ? g.color : '#ffffff';
    const fontWeight = typeof g.font_weight === 'number' ? g.font_weight : 400;

    // Build the texture at a fixed internal resolution; visual size is
    // controlled later by updateScale(fontSize).
    this._textMap = new TextTexture(text || ' ', {
      size: 64,
      color: color,
      font: 'Arial',
      weight: fontWeight
    });

    this.object = new Sprite2(new SpriteMaterial({
      map: this._textMap,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }));

    // Set world-space height (font_size is in world-space units, i.e. mm).
    // Sprite2's constructor already sets _textMap.object = this.object, so
    // updateScale works immediately.
    this._textMap.updateScale(fontSize);

    // Position is in world space (tkrRAS).
    const pos = Array.isArray(g.position) ? g.position : [0, 0, 0];
    this.object.position.set(
      typeof pos[0] === 'number' ? pos[0] : 0,
      typeof pos[1] === 'number' ? pos[1] : 0,
      typeof pos[2] === 'number' ? pos[2] : 0
    );

    // Stable decoration ID – used as key in canvas.textDecorators.
    this.decorId = typeof g.decor_id === 'string' && g.decor_id.length > 0
      ? g.decor_id
      : this.name;

    this.finish_init();

    // Register in the canvas-level textDecorators map.
    canvas.textDecorators.set(this.decorId, this);

    // Clean up when this instance is disposed.
    this.addEventListener(
      CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
      () => {
        canvas.textDecorators.delete(this.decorId);
      }
    );
  }

  /**
   * Replace the displayed text.
   * @param {string} text
   */
  updateFocusMode({ mode, objectType } = {}) {
    // text labels are never pick targets (this replaces `rayCasterEligible`)
    return;
  }

  setText(text) {
    this._textMap.draw_text(typeof text === 'string' ? text : '');
  }

  /**
   * Change the text colour.
   * @param {string} color - CSS colour string
   */
  setColor(color) {
    this._textMap.draw_text(this._textMap.text, { color: color });
  }

  /**
   * Resize the sprite in world-space units.
   * @param {number} size - world-space height
   */
  setFontSize(size) {
    if (typeof size === 'number' && size > 0) {
      this._textMap.updateScale(size);
    }
  }

  /**
   * Move the sprite to a new world-space position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.object.position.set(
      typeof x === 'number' ? x : 0,
      typeof y === 'number' ? y : 0,
      typeof z === 'number' ? z : 0
    );
  }

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){

    super.pre_render({ target : target });

    // Check flag
    const visible = this._canvas.get_state( 'textDecorVisibility', true ) ? true : false;
    this.object.visible = visible;

  }

  dispose() {
    super.dispose();
    if ( this.object ) {
      this.object.removeFromParent();
      if ( this.object.material ) {
        this.object.material.dispose();
      }
    }
    if ( this._textMap ) {
      this._textMap.dispose();
    }
  }

  /**
   * Serialise the current state for round-tripping back to R/Shiny.
   * @returns {object}
   */
  toSummary() {
    const pos = this.object.position;
    return {
      id: this.decorId,
      name: this.name,
      text: this._textMap.text,
      position: [pos.x, pos.y, pos.z],
      color: this._textMap._color,
      font_size: this.object.scale.y,
      layer: Array.isArray(this._params.layer)
        ? this._params.layer
        : [this._params.layer ?? 1]
    };
  }
}

/**
 * Factory function – matches the GeometryFactory convention.
 * @param {object} g      - geometry params (from R / JSON)
 * @param {object} canvas - ViewerCanvas instance
 * @returns {TextDecor}
 */
function gen_textdecor(g, canvas) {
  return new TextDecor(g, canvas);
}

export { TextDecor, gen_textdecor };
