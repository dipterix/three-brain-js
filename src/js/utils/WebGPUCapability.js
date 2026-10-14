/**
 * WebGPU availability, with the API of three's `capabilities/WebGPU.js`
 * (`isAvailable()`, `getErrorMessage()`). three's module asks for an adapter
 * with a top-level `await`, which would make this whole bundle an async module
 * and its UMD export (`threeBrain`) a Promise. Here the adapter check starts
 * when the module loads, without blocking it. `isAvailable()` reports its
 * result once it has settled, and until then only whether the browser has the
 * API (it doesn't in insecure contexts). `checkAvailability()` waits for it.
 *
 * The viewer doesn't use this: `WebGPURenderer` picks its backend itself, and
 * `ViewerCanvas.isWebGPU` records the one it got.
 */

const hasWebGPUAPI = typeof navigator !== 'undefined' && navigator.gpu !== undefined;
let adapterAvailable = null;
const adapterCheck = hasWebGPUAPI ?
  navigator.gpu.requestAdapter().then( ( adapter ) => adapter !== null, () => false ) :
  Promise.resolve( false );
adapterCheck.then( ( available ) => { adapterAvailable = available; } );

class WebGPU {

  static isAvailable() {
    return adapterAvailable ?? hasWebGPUAPI;
  }

  // resolves to whether the browser can provide a WebGPU adapter
  static checkAvailability() {
    return adapterCheck;
  }

  static getErrorMessage() {
    const message = 'Your browser does not support <a href="https://gpuweb.github.io/gpuweb/" style="color:blue">WebGPU</a> yet';
    const element = document.createElement( 'div' );
    element.id = 'webgpumessage';
    element.style.fontFamily = 'monospace';
    element.style.fontSize = '13px';
    element.style.fontWeight = 'normal';
    element.style.textAlign = 'center';
    element.style.background = '#fff';
    element.style.color = '#000';
    element.style.padding = '1.5em';
    element.style.maxWidth = '400px';
    element.style.margin = '5em auto 0';
    element.innerHTML = message;
    return element;
  }

}

export { WebGPU };
