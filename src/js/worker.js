/**
 * @Author: Zhengjia Wang
 * Adapter of model (threejs_scene) and viewer (htmlwidgets)
 */


// Formats
import { workerLoaders } from './core/DataLoaders.js';
import { computeGradientsFromRGBA } from './Math/computeVolumeGradients.js';
import { MeshBVH } from 'three-mesh-bvh';
import { buildBoundsTreeSync } from './Math/meshBVH.js';
import { buildFlatKDTree } from './Math/computeStreamlineToTargets.js';

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

// Register surface BVH construction as worker-callable.
//
// Building a bounds tree for a dense FreeSurfer surface takes ~80ms
// single-threaded, which is a visible hitch if it lands on the main thread. The
// serialized form is a handful of ArrayBuffers, so the result transfers back
// zero-copy.
workerLoaders.buildSurfaceBVH = workerWrapper(
  ( positionArray, indexArray ) => {
    const bvh = buildBoundsTreeSync( positionArray, indexArray );

    // `cloneBuffers: false` hands back the live buffers rather than copies --
    // nothing in the worker outlives this call, so there is nothing to protect.
    const serialized = MeshBVH.serialize( bvh, { cloneBuffers : false } );

    // The main thread already holds the index; echoing it back would put
    // several megabytes on the wire for nothing. `deserialize` is called with
    // `setIndex: false` there, so this field is never read.
    serialized.index = null;

    const transferables = [ ...serialized.roots ];
    if( serialized.indirectBuffer ) {
      transferables.push( serialized.indirectBuffer.buffer );
    }

    return { result : serialized, transferables : transferables };
  }
);

// Register the streamline distance tree as worker-callable.
//
// The build is O(n log n) over every above-threshold voxel of the active
// volume -- seconds of frozen UI at 400k points when it ran inline. Both arrays
// transfer back zero-copy.
workerLoaders.buildPointKDTree = workerWrapper(
  ( points ) => {
    const tree = buildFlatKDTree( points );
    if( !tree ) {
      return { result : { points : null, order : null } };
    }
    return {
      result : { points : tree.points, order : tree.order },
      transferables : [ tree.points.buffer, tree.order.buffer ],
    };
  }
);

async function workerListener (event) {
  const methodNames = event.data.methodNames;
  const args = event.data.args;
  const token = event.data.token;

  try {
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

    // Every worker-callable posts its own terminal message ('done' / 'error'),
    // so the return value is not re-posted here. Re-posting it used to throw
    // whenever the method had transferred its buffers back: they are detached
    // by then, and cloning a detached buffer fails.
    await method(args, postMessage, token);
  } catch (e) {
    // Without this the main thread never hears back and its promise stays
    // pending forever. Send a plain object: not every browser can clone `Error`.
    postMessage({
      token: token,
      status: "error",
      object: {
        name: e?.name,
        message: e?.message ?? String(e)
      }
    });
  }
}

onmessage = (event) => {
  workerListener(event);
};

export { workerListener };
