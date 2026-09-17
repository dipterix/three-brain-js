import { WebGPURenderer, CanvasTarget } from 'three/webgpu';

/**
 * Creates a renderer for one of the viewer canvases. `WebGPURenderer` switches
 * to its WebGL2 backend by itself when WebGPU is unavailable; `forceWebGL` uses
 * that backend regardless. Call `await renderer.init()` before rendering.
 */
function createRenderer({ canvas, forceWebGL = false } = {}) {
  const renderer = new WebGPURenderer({
    canvas      : canvas,
    // The WebGL viewer asked for `antialias: false`, but it handed three a
    // context from `getContext( 'webgl2' )`, whose default is antialiased, so
    // it always rendered with MSAA
    antialias   : true,
    alpha       : true,
    forceWebGL  : forceWebGL,
  });
  return renderer;
}

/**
 * One canvas the viewer draws into, and the renderer that draws it.
 *
 * The viewer has four: the main view and the three side views. On WebGPU they
 * share one renderer, and therefore one GPU device, so every geometry, texture
 * and compiled pipeline is uploaded once instead of four times; each canvas is
 * then a `CanvasTarget` the renderer is pointed at before it draws
 * (`SharedRendererInterface`). The WebGL2 backend can only ever present to the
 * canvas its context was created for, so there each canvas keeps a renderer of
 * its own (`OwnRendererInterface`).
 *
 * Callers use this class instead of the renderer so the two arrangements look
 * the same. In particular `rendererInterface.canvas` is the element being drawn into;
 * `renderer.domElement` is not, because it follows whichever target is active.
 */
class RendererInterface {

  constructor( canvas ) {
    this.canvas = canvas;
    this.isRendererInterface = true;
    // `this.renderer` and `this.target` are set by the subclasses
    this._clearColor = null;
    this._clearAlpha = 0;
  }

  /**
   * The color this canvas is cleared to. A renderer has one clear color, not
   * one per canvas, so each interface keeps its own and installs it whenever it
   * claims the renderer. It is not only the empty area: partly covered pixels
   * at the edge of a mesh blend towards it.
   */
  setClearColor( color, alpha = 0 ) {
    this._clearColor = color;
    this._clearAlpha = alpha;
    if( this.isActive ) {
      this.renderer.setClearColor( color, alpha );
    }
  }

  // resolves once this render interface can draw
  init() {
    return Promise.resolve();
  }

  get isActive() {
    return this.renderer.getCanvasTarget() === this.target;
  }

  /**
   * Points the renderer at this canvas. A renderer draws into whichever canvas
   * target it is pointed at, so every interface must claim its own before it
   * draws — the main view included, or the side views would leave the renderer
   * aimed at one of theirs. With a renderer to itself there is only ever one
   * target, so this does nothing.
   */
  activate() {
    if( !this.isActive ) {
      this.renderer.setCanvasTarget( this.target );
    }
    if( this._clearColor !== null ) {
      this.renderer.setClearColor( this._clearColor, this._clearAlpha );
    }
  }

  /**
   * three only listens for `resize` on the target it is pointed at, and the
   * backend caches a context, a render pass descriptor and depth and MSAA
   * textures per target, so resizing any other target has to drop that cache by
   * hand. WebGPU rejects zero-sized textures, which is what a collapsed side
   * panel would ask for, so sizes are kept at a pixel or more. `updateStyle`
   * writes the canvas's CSS size as well, which a canvas that is sized by its
   * container (the side views, at 100%) must not do.
   */
  setSize( width, height, updateStyle = true ) {
    this.target.setSize( Math.max( 1, width ), Math.max( 1, height ), updateStyle );
    this._invalidateIfInactive();
  }

  setPixelRatio( pixelRatio ) {
    this.target.setPixelRatio( pixelRatio );
    this._invalidateIfInactive();
  }

  getPixelRatio() {
    return this.target.getPixelRatio();
  }

  _invalidateIfInactive() {
    if( !this.isActive && this.renderer.backend ) {
      this.renderer.backend.delete( this.target );
    }
  }

  clear() {
    this.activate();
    this.renderer.clear();
  }

  render( scene, camera ) {
    this.activate();
    this.renderer.render( scene, camera );
  }

  dispose() {}

}

/**
 * A canvas with a renderer to itself: the WebGL2 arrangement, and what every
 * canvas used before the renderers were shared.
 */
class OwnRendererInterface extends RendererInterface {

  constructor({ canvas, forceWebGL = false } = {}) {
    super( canvas );
    this.renderer = createRenderer({ canvas: canvas, forceWebGL: forceWebGL });
    // the renderer's own canvas target, which it draws into by default
    this.target = this.renderer.getCanvasTarget();
    this.ownsRenderer = true;
  }

  init() {
    return this.renderer.init();
  }

  dispose() {
    this.renderer.dispose();
  }

}

/**
 * A canvas that borrows the main renderer, through a `CanvasTarget`. WebGPU
 * only: `WebGLBackend` binds its context to one canvas at init and ignores
 * canvas targets entirely.
 */
class SharedRendererInterface extends RendererInterface {

  constructor({ renderer, canvas } = {}) {
    super( canvas );
    this.renderer = renderer;
    this.target = new CanvasTarget( canvas );
    this.ownsRenderer = false;
  }

  // The renderer belongs to the main view, so only the target is released here.
  // `CanvasTarget.dispose()` drops the post-processing buffer three keeps per
  // target; the canvas context and the depth and MSAA textures live in the
  // backend's cache, under the target as key.
  dispose() {
    if( this.renderer.backend ) {
      this.renderer.backend.delete( this.target );
    }
    this.target.dispose();
  }

}

/**
 * The main view's render interface, which owns the renderer the side views may borrow.
 */
function createMainRendererInterface({ canvas, forceWebGL = false } = {}) {
  return new OwnRendererInterface({ canvas: canvas, forceWebGL: forceWebGL });
}

/**
 * A side view's render interface: a `CanvasTarget` on the main renderer when it can be
 * shared, otherwise a renderer of its own. The main renderer must be
 * initialized before this is called, because only then is the backend known.
 */
function createSideRendererInterface({ canvas, mainRendererInterface, forceWebGL = false, shareRenderer = true } = {}) {
  const renderer = mainRendererInterface.renderer;
  if( shareRenderer && renderer.backend && renderer.backend.isWebGPUBackend === true ) {
    return new SharedRendererInterface({ renderer: renderer, canvas: canvas });
  }
  return new OwnRendererInterface({ canvas: canvas, forceWebGL: forceWebGL });
}

/**
 * Largest 2D texture edge the renderer's device supports. The renderer must be
 * initialized.
 */
function getMaxTextureSize( renderer ) {
  const backend = renderer.backend;
  if( backend.isWebGPUBackend ) {
    return backend.device.limits.maxTextureDimension2D;
  }
  return backend.gl.getParameter( backend.gl.MAX_TEXTURE_SIZE );
}

export { createRenderer, getMaxTextureSize, createMainRendererInterface, createSideRendererInterface,
         RendererInterface, OwnRendererInterface, SharedRendererInterface };
