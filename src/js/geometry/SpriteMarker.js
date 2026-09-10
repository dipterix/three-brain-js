/* A small sprite that marks a point in the scene at a fixed on-screen size */

import { CONSTANTS } from '../core/constants.js';
import { Sprite, SpriteMaterial, CanvasTexture } from 'three';

/**
 * Draw an open ring into a canvas texture.
 *
 * A ring rather than a filled disc so whatever is being marked stays visible
 * through the middle, and a dark outer rim so it reads against both bright
 * surfaces and dark backgrounds.
 */
function createRingTexture( color, resolution ) {
  const canvas = document.createElement( "canvas" );
  canvas.width = resolution;
  canvas.height = resolution;

  const ctx = canvas.getContext( "2d" );
  const center = resolution / 2;
  const radius = resolution * 0.38;

  ctx.lineWidth = resolution * 0.10;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc( center, center, radius, 0, Math.PI * 2 );
  ctx.stroke();

  ctx.lineWidth = resolution * 0.02;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.arc( center, center, radius + resolution * 0.06, 0, Math.PI * 2 );
  ctx.stroke();

  const texture = new CanvasTexture( canvas );
  texture.needsUpdate = true;
  return texture;
}

/**
 * A marker sprite whose apparent size does not change as the camera zooms.
 *
 * Follows the same contract as `Compass`: build in the constructor, hand the
 * canvas an `Object3D` to add to the scene, then `update()` once per frame.
 *
 * The main camera is orthographic, so holding the on-screen size steady is just
 * a matter of scaling by `1 / zoom` -- the same trick `Compass.update` and
 * `RulerHelper.setTextScale` already use.
 */
class SpriteMarker {

  /**
   * @param {Camera} camera - the camera whose zoom the size tracks
   * @param {Object} [options]
   * @param {number} [options.size] - on-screen radius at `zoom === 1`
   * @param {string} [options.color] - ring color, any CSS color
   * @param {number} [options.layer] - camera layer to render on
   * @param {number} [options.resolution] - texture size in pixels
   */
  constructor( camera, {
    size = CONSTANTS.GEOMETRY[ "focus-marker-size" ],
    color = "#ffcc00",
    layer = CONSTANTS.LAYER_SYS_ALL_CAMERAS_7,
    resolution = 128
  } = {} ) {

    this._camera = camera;
    this.size = size;

    this._texture = createRingTexture( color, resolution );
    this._material = new SpriteMaterial({
      map : this._texture,
      transparent : true,
      // the point being marked is usually *on* a surface, so let the ring draw
      // over it rather than z-fighting with it
      depthTest : false,
      depthWrite : false,
      sizeAttenuation : true,
    });

    this.object = new Sprite( this._material );
    this.object.renderOrder = CONSTANTS.MAX_RENDER_ORDER;
    this.object.visible = false;
    this.object.layers.set( layer );

    this.update();
  }

  set visible ( visible ) {
    this.object.visible = visible === true;
    if( this.object.visible ) { this.update(); }
  }

  get visible () {
    return this.object.visible;
  }

  setPosition( position ) {
    if( !position ) { return; }
    this.object.position.copy( position );
  }

  update() {
    if( !this.object.visible ) { return; }
    const zoom = this._camera ? ( this._camera.zoom || 1 ) : 1;
    const scale = this.size / zoom;
    this.object.scale.set( scale, scale, scale );
  }

  dispose() {
    try {
      this.object.removeFromParent();
    } catch (e) {}
    try {
      this._material.dispose();
      this._texture.dispose();
    } catch (e) {}
  }

}

export { SpriteMarker };
