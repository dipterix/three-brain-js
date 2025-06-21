/**
 * @Author: Zhengjia Wang
 * Adapter of model (threejs_scene) and viewer (htmlwidgets)
 */


// Formats
import { workerLoaders } from './core/DataLoaders.js';
import { computeStreamlineToTargets } from './Math/computeStreamlineToTargets.js'

function workerWrapper(fn) {
  const wrapped = async function(args, postMessage, token) {
    const result = await fn(...args);

    postMessage({
      token: token,
      status: 'done',
      object: result
    });

    return result;
  };
  wrapped._workerCallable = true;
  return wrapped;
}

async function workerListener (event) {
  const methodNames = event.data.methodNames;
  const args = event.data.args;
  const token = event.data.token;

  if ( !Array.isArray(methodNames) ) {
    throw new TypeError(`Invalid method names: ${methodNames}. Must be an array`);
  }
  let method = {
    workerLoaders : workerLoaders,
    computeStreamlineToTargets: workerWrapper( computeStreamlineToTargets ),
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

  postMessage({
    token: token,
    status: "scheduled",
    object: re
  });
}

onmessage = (event) => {
  workerListener(event);
};

export { workerListener };
