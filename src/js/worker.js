/**
 * @Author: Zhengjia Wang
 * Adapter of model (threejs_scene) and viewer (htmlwidgets)
 */


// Formats
import { workerLoaders } from './core/DataLoaders.js';
import { computeGradientsFromRGBA } from './Math/computeVolumeGradients.js';

/**
 * Wraps a function to be callable from the worker pool.
 * The wrapped function can return either:
 *   - A plain result (will be sent without transferables)
 *   - An object { result, transferables } where transferables is an array of ArrayBuffers
 *     to transfer (zero-copy) back to the main thread
 * 
 * @param {Function} fn - Function to wrap. Receives args as spread parameters.
 * @returns {Function} Worker-callable wrapped function
 */
function workerWrapper(fn) {
  const wrapped = async function(args, postMessage, token) {
    const fnResult = await fn(...args);

    // Check if function returned { result, transferables } format
    let result, transferables;
    if ( fnResult && typeof fnResult === 'object' && 'result' in fnResult ) {
      result = fnResult.result;
      transferables = fnResult.transferables;
    } else {
      result = fnResult;
      transferables = undefined;
    }

    const message = {
      token: token,
      status: 'done',
      object: result
    };

    if ( Array.isArray(transferables) && transferables.length > 0 ) {
      postMessage( message, transferables );
    } else {
      postMessage( message );
    }

    return result;
  };
  wrapped._workerCallable = true;
  return wrapped;
}

// Register gradient computation as worker-callable
workerLoaders.computeVolumeGradients = workerWrapper(
  ( voxelColor, width, height, depth, nChannels ) => {
    const gradients = computeGradientsFromRGBA( voxelColor, width, height, depth, nChannels );
    // Transfer the gradient buffer back to main thread (zero-copy)
    return { result: gradients, transferables: [ gradients.buffer ] };
  }
);

async function workerListener (event) {
  const methodNames = event.data.methodNames;
  const args = event.data.args;
  const token = event.data.token;

  if ( !Array.isArray(methodNames) ) {
    throw new TypeError(`Invalid method names: ${methodNames}. Must be an array`);
  }
  let method = {
    workerLoaders : workerLoaders,
  };
  methodNames.forEach((name) => {
    method = method[ name ];
    if( method === undefined ) {
      throw new TypeError(`Cannot find object: threeBrain.${methodNames.join(".")}`);
    }
  })
  if( typeof method !== "function" ) {
    throw new TypeError(`Object threeBrain.${methodNames.join(".")} is not a function. Abort.`);
  }
  if( !method._workerCallable ) {
    throw new TypeError(`Method threeBrain.${methodNames.join(".")} is not a worker-callable function.`);
  }

  postMessage({
    token: token,
    status: "started"
  });

  const re = await method(args, postMessage, token);

  // Note: 'scheduled' status is a fallback; workerWrapper already sends 'done' with transferables
  if ( re !== undefined ) {
    postMessage({
      token: token,
      status: "scheduled",
      object: re
    });
  }
}

onmessage = (event) => {
  workerListener(event);
};

export { workerListener };
