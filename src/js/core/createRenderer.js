import { WebGPURenderer, NodeMaterial } from 'three/webgpu';
import { vec4 } from 'three/tsl';

/**
 * Stands in for materials that are not ported to TSL yet (`ShaderMaterial`,
 * `RawShaderMaterial` and their subclasses). three.js cannot convert those, and
 * would otherwise draw them with an opaque default material; this one puts
 * every vertex outside the clip volume instead, so the object is simply hidden.
 * (Discarding every fragment instead lets the WebGL2 compiler strip the color
 * output, which makes each draw an `INVALID_OPERATION`.)
 *
 * Migration scaffolding: remove once every custom material is a node material.
 */
class UnportedMaterial extends NodeMaterial {
  constructor() {
    super();
    this.vertexNode = vec4( 2, 2, 2, 1 );
  }
}

const reportedUnportedTypes = new Set();

function installUnportedMaterialFallback( renderer ) {
  const library = renderer.library;
  const fromMaterial = library.fromMaterial.bind( library );
  library.fromMaterial = ( material ) => {
    const nodeMaterial = fromMaterial( material );
    if( nodeMaterial !== null ) { return nodeMaterial; }
    if( !reportedUnportedTypes.has( material.type ) ) {
      reportedUnportedTypes.add( material.type );
      console.warn( `[threeBrain] "${ material.type }" is not ported to WebGPU yet; objects using it are hidden.` );
    }
    return new UnportedMaterial();
  };
}

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
  installUnportedMaterialFallback( renderer );
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
