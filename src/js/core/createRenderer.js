import { WebGPURenderer } from 'three/webgpu';

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

export { createRenderer, getMaxTextureSize };
