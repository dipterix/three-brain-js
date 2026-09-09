import { Mesh, BufferGeometry, BufferAttribute } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/**
 * Bounding volume hierarchy support for picking against dense meshes.
 *
 * three.js `Mesh.raycast` walks every triangle (verified against r185 and r186:
 * there is still no acceleration structure in core, and `BVHLoader` in the
 * examples is the Biovision mocap format, not this). At FreeSurfer surface
 * density -- std.141 pial is ~398k triangles per hemisphere -- that is ~13ms per
 * pick, tripling to ~38ms once a morph target is active because
 * `Mesh.getVertexPosition` re-blends influences per vertex per triangle. A BVH
 * brings the same query to a couple of microseconds.
 *
 * `Mesh.prototype.raycast` is patched once, globally. This is safe: when a
 * geometry has no `boundsTree`, `acceleratedRaycast` delegates to the stock
 * three.js implementation, so meshes that never opt in behave exactly as before.
 * `InstancedMesh` defines its own `raycast` and is unaffected.
 */

/**
 * Target primitives per leaf node.
 *
 * Higher than the library default of 10 on purpose. Measured at std.141 pial
 * density (~398k triangles), where a larger leaf is both smaller *and* faster --
 * the saving in node visits outweighs the extra triangle tests, and the leaf loop
 * is cache friendly:
 *
 *   leaf 10 -> 109,551 nodes, 4.44 MB, 2.06us/query
 *   leaf 16 ->  71,151 nodes, 3.41 MB, 1.34us/query
 *   leaf 24 ->  46,175 nodes, 2.74 MB, 0.46us/query
 */
const BVH_TARGET_LEAF_SIZE = 24;

let _raycastPatched = false;

/**
 * Install the accelerated raycast on `Mesh.prototype`. Idempotent.
 */
function installAcceleratedRaycast() {
  if( _raycastPatched ) { return; }
  Mesh.prototype.raycast = acceleratedRaycast;
  _raycastPatched = true;
}

/**
 * Build a `BufferGeometry` carrying just what a BVH build needs.
 *
 * The BVH reads vertex positions from the geometry it was built against, never
 * from the mesh it is later queried through. That is what makes per-morph-state
 * trees possible: build one against each morph target's baked positions, then
 * swap `geometry.boundsTree` to match whichever state is being displayed.
 */
function bvhSourceGeometry( positionArray, indexArray ) {
  const geometry = new BufferGeometry();
  geometry.setAttribute( 'position', new BufferAttribute( positionArray, 3 ) );
  if( indexArray ) {
    geometry.setIndex( new BufferAttribute( indexArray, 1, false ) );
  }
  return geometry;
}

/**
 * Build a BVH synchronously on the calling thread.
 *
 * `indirect: true` is not optional here. Without it the build permutes the
 * geometry's index buffer in place; because every morph state of a surface
 * shares one index buffer, a second build would silently invalidate the first.
 *
 * @param {Float32Array} positionArray - Vertex positions, 3 per vertex.
 * @param {Uint32Array|Uint16Array} indexArray - Triangle index buffer.
 * @returns {MeshBVH}
 */
function buildBoundsTreeSync( positionArray, indexArray ) {
  return new MeshBVH( bvhSourceGeometry( positionArray, indexArray ), {
    indirect : true,
    targetLeafSize : BVH_TARGET_LEAF_SIZE,
  });
}

/**
 * Build a BVH in a worker, falling back to the main thread when workers are
 * unavailable.
 *
 * The position and index arrays are *copied* into the worker rather than
 * transferred: they are the live render buffers, and transferring would neuter
 * them on the main thread. The BVH buffers coming back are transferred, since
 * nothing in the worker keeps a reference to them.
 *
 * @param {Object} options
 * @param {Float32Array} options.positionArray
 * @param {Uint32Array|Uint16Array} options.indexArray
 * @param {Object} options.app - `ViewerApp`, for `invokeWorker`.
 * @param {string} [options.token] - Cancellation token.
 * @returns {Promise<MeshBVH>}
 */
async function buildBoundsTreeAsync({ positionArray, indexArray, app, token } = {}) {

  if( !app || typeof app.invokeWorker !== "function" ) {
    return buildBoundsTreeSync( positionArray, indexArray );
  }

  let serialized;
  try {
    serialized = await app.invokeWorker({
      name : "buildSurfaceBVH",
      args : [ positionArray, indexArray ],
      // `invokeWorker` only uses this when no worker is available; a worker that
      // starts and then fails rejects instead, hence the catch below.
      fallback : () => MeshBVH.serialize(
        buildBoundsTreeSync( positionArray, indexArray ),
        { cloneBuffers : false }
      ),
      token : token,
      // dense surfaces take ~80ms to build; allow generous headroom for a
      // contended pool
      timeOut : 60000,
    });
  } catch (e) {
    // A failed build must never break picking -- the caller simply gets a tree
    // built here instead, and the stock raycast covers the interim.
    console.warn( "buildBoundsTreeAsync: worker build failed, building on the main thread.", e );
    return buildBoundsTreeSync( positionArray, indexArray );
  }

  // `setIndex: false` -- the source geometry is built from the same index we
  // just sent, so there is nothing to write back. (The worker also strips
  // `index` from the payload to keep it off the wire.)
  return MeshBVH.deserialize(
    serialized,
    bvhSourceGeometry( positionArray, indexArray ),
    { setIndex : false }
  );
}

export {
  installAcceleratedRaycast,
  buildBoundsTreeSync,
  buildBoundsTreeAsync,
  bvhSourceGeometry,
  BVH_TARGET_LEAF_SIZE,
};
