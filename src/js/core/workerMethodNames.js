/**
 * Names of worker-callable methods that are registered in `worker.js` only.
 *
 * File loaders register themselves into `workerLoaders` from `DataLoaders.js`,
 * which both bundles import, so `asyncLoaderAvailable` can see them on either
 * thread. Compute methods are different: their implementations live in
 * `worker.js`, which is the worker bundle's entry point and is *not* part of the
 * main bundle. The main thread therefore never sees the registration, and
 * `asyncLoaderAvailable` used to reject them -- silently sending every call down
 * the synchronous fallback path instead of to a worker.
 *
 * Listing the names here (and nothing else) lets the main thread know the worker
 * can handle them, while the implementations -- and their dependencies -- stay
 * out of the main bundle.
 *
 * A name added here MUST be registered in `worker.js`, or calls will be
 * dispatched to a worker that cannot answer them.
 */
const workerMethodNames = [
  "computeVolumeGradients",
  "buildSurfaceBVH",
  "buildPointKDTree",
];

export { workerMethodNames };
