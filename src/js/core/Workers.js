import { EventDispatcher } from 'three';
import { workerMethodNames } from './workerMethodNames.js';
import { decodeEmbeddedBlob } from './EmbeddedData.js';
const workerLoaders = {};

// Debug switch: `?noWorkers` (or `=1`, `=true`) computes everything on the main
// thread, which is what happens anyway wherever a worker cannot start
let useWorkerLoaders = true;
try {
  const noWorkers = new URLSearchParams( window.location.search ).get( "noWorkers" );
  if( noWorkers === "" || noWorkers === "1" || noWorkers === "true" ) {
    useWorkerLoaders = false;
  }
} catch (e) {}   // no `window` in the worker bundle, which imports this too

// A worker script that has already failed to load. Keyed by the script as the
// settings gave it, so one bad script does not disable workers for a viewer
// elsewhere on the page that uses another.
const brokenWorkerScripts = new Map();

// `#`-prefixed scripts are embedded in the page (see `EmbeddedData.js`); each
// becomes one object URL for the life of the page, since a new worker is
// spawned per call. A `null` is remembered too, so the DOM is queried once.
const workerScriptObjectURLs = new Map();

/**
 * The URL to hand `new Worker()`: a path as given, or an object URL holding the
 * worker embedded in the page. `null` when the page claims an embedded worker
 * it does not carry — an old saved page opened with a newer bundle.
 */
function resolveWorkerScript( workerScript ) {
  if( typeof workerScript !== "string" || workerScript === "" ) { return null; }
  if( !workerScript.startsWith("#") ) { return workerScript; }
  if( workerScriptObjectURLs.has( workerScript ) ) {
    return workerScriptObjectURLs.get( workerScript );
  }
  let objectURL = null;
  try {
    const blob = decodeEmbeddedBlob( workerScript, {
      mimeType : "text/javascript",
      // the bundle is code, never text to re-encode
      binary : true,
    });
    if( blob ) {
      objectURL = URL.createObjectURL( blob );
    }
  } catch (e) {
    objectURL = null;
  }
  workerScriptObjectURLs.set( workerScript, objectURL );
  return objectURL;
}

/**
 * Remembers that a worker script cannot be loaded, and says so once. Callers
 * fall back to the main thread, so this is a note, not an error.
 */
function markWorkerScriptBroken( workerScript, error ) {
  if( brokenWorkerScripts.has( workerScript ) ) { return; }
  brokenWorkerScripts.set( workerScript, error );
  const detail = ( error && ( error.message || error.type ) ) || String( error );
  console.warn(
    `[threeBrain] Web worker unavailable (${ detail }); computing on the main ` +
    `thread instead. Worker script: ${ workerScript }`
  );
  try { stopWorker( workerScript ); } catch (e) {}
}

function asyncLoaderAvailable( name, workerScript ) {
  if( typeof workerScript !== "string") { return false; }
  if( !useWorkerLoaders ) { return false; }
  if( typeof name !== "string") { return false; }
  if( typeof window === "undefined" || !window ) { return false; }
  if(!window.Worker) { return false; }
  if( brokenWorkerScripts.has( workerScript ) ) { return false; }
  // an embedded worker the page turns out not to carry
  if( resolveWorkerScript( workerScript ) === null ) { return false; }
  // `workerLoaders` only carries the loaders registered by `DataLoaders.js`,
  // which both bundles import. Compute methods are registered in `worker.js`,
  // which the main bundle never loads, so fall back to the shared name manifest.
  if(!workerLoaders[ name ] && !workerMethodNames.includes( name )) { return false; }
  return ["workerLoaders", name];
}


class WorkerPool {
  constructor( workerScript, logger, softSize = 0, maxSize = 8 ) {
    // the original string identifies the pool (`stopWorker` looks it up by it);
    // `scriptURL` is what a worker is actually built from
    this.workerScript = workerScript;
    this.scriptURL = resolveWorkerScript( workerScript );
    // set by the first message from a worker: proof the script loaded and runs,
    // which separates "cannot load" from "this task threw"
    this._everResponded = false;
    this.softSize = Math.ceil( softSize );
    if( this.softSize <= 0 ) { this.softSize = 0; }
    this.maxSize = Math.ceil( maxSize );
    if( this.maxSize <= this.softSize ) { this.maxSize = this.softSize; }
    this._pool = new Map();
    this._dispatcher = new EventDispatcher();
    if( logger ) {
      this.logger = logger;
    } else {
      this.logger = console.debug;
    }

    this._lastSpawnTime = 0;
    this._spawnThrottleMs = 100;
  }

  _spawnWorker() {
    let uuid = '';
    const item = {
      idle: false,
      timeOut : 15000,
      onError : undefined,
      onProgress: undefined,
      onResult : undefined,
      startWorker : undefined,
      terminate : undefined,
      elapsed   : undefined,
      token     : undefined
    };
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    while( uuid === "" || this._pool.has(uuid) ) {
      let counter = 0;
      while (counter < 8) {
        uuid += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
        if( counter == 4 ) {
          uuid += "-";
        }
      }
    }

    let timeStarted = 0;

    const setIdle = (idle) => {
      if( idle ) {
        if( item.idle ) { return; }
        const poolSize = this._pool.size;
        if( poolSize > this.softSize ) {
          this.logger(`Pruning 1 worker (UUID: ${ uuid }, still running: ${ poolSize - 1 })`);
          item.terminate( true );
        } else {
          this.logger(`Worker ${ uuid } -> idle`);
          item.idle = true;
          item.token = undefined;
          item.timeOut = 15000;
        }
        this._dispatcher.dispatchEvent({
          type : "WorkerPool.idle",
          uuid: uuid,
        });
      } else {
        if( !item.idle ) { return; }
        this.logger(`Worker ${ uuid } -> busy`);
        timeStarted = new Date().getTime();
        item.idle = false;
      }
    }

    let worker;
    try {
      worker = new window.Worker( this.scriptURL );
    } catch (e) {
      // Blocked outright: a `file://` page starting a worker from a path, a
      // CSP, a browser refusing blob workers. Never retried.
      markWorkerScriptBroken( this.workerScript, e );
      throw e;
    }
    const errorHandler = (e) => {
      // A worker that never answered could not load; one that did has a bug in
      // the task, which is worth reporting every time.
      if( !this._everResponded ) {
        markWorkerScriptBroken( this.workerScript, e );
      }
      if( item.idle ) { return; }
      const f = item.onError;
      item.onError = undefined;
      item.onResult = undefined;

      setIdle(true);
      if( typeof f === "function" ) { f(e); }
    };
    const resultHandler = (data) => {
      if( item.idle ) { return; }
      const f = item.onResult;
      item.onError = undefined;
      item.onResult = undefined;

      if( typeof f === "function" ) {
        try {
          f(data);
        } catch (e) {
          console.error( e );
        }
      }
      setIdle(true);
    };
    const progressHandler = (progress) => {
      if( item.idle ) { return; }
      const f = item.onProgress;
      if( typeof f === "function" ) {
        try {
          f(progress);
        } catch (e) {}
      }
    }

    worker.onerror = errorHandler;
    worker.onmessageerror = errorHandler;
    worker.onmessage = (e) => {
      this._everResponded = true;
      if( item.idle ) { return; }
      if( e.data && typeof e.data === "object" && typeof e.data.status === "string") {
        switch ( e.data.status ) {
          case 'scheduled':
            if( e.data.object !== undefined ) {
              resultHandler( e.data.object );
              return;
            }
            break;
          case 'progress':
            if( e.data.object !== undefined ) {
              progressHandler( e.data.object );
              return;
            }
            break;
          case 'done':
            resultHandler( e.data.object );
            return;
            break;
          case 'error':
            errorHandler( e.data.object );
            break;
        };
      } else {
        errorHandler( new TypeError("Worker does not return with proper message event.") );
      }
    };

    item.startWorker = ({ methodNames, args, transferables } = {}) => {
      if(!item.idle) { throw new Error("Worker is not idle"); }
      setIdle( false );
      const message = {
        methodNames: methodNames,
        args: args,
        token: uuid
      };
      if ( Array.isArray(transferables) && transferables.length > 0 ) {
        worker.postMessage( message, transferables );
      } else {
        worker.postMessage( message );
      }
      let timeOut = item.timeOut;
      /*
      if( isFinite( timeOut ) ) {
        if( timeOut < 0 ) { timeOut = 0; }
        setTimeout(() => {
          if(!item.idle) {
            try {
              errorHandler(new Error("Worker timeout."));
            } catch (e) {}
            this._dispatcher.dispatchEvent({
              type : "WorkerPool.timeout",
              uuid: uuid,
            });
          }
        }, timeOut);
      }
      */
    };
    item.terminate = ( force = false ) => {
      if( !force && !item.idle ) {
        try {
          errorHandler(new Error("Worker has been terminated."));
        } catch (e) {}
      }
      item.idle = false;
      item.onError = undefined;
      item.onResult = undefined;
      worker.terminate();
      this._pool.delete( uuid );

      // in case callbacks are called
      item.idle = true;
      item.token = undefined;
      item.timeOut = 15000;
    };
    item.elapsed = () => {
      return ( new Date().getTime() - timeStarted );
    };
    // setIdle( true ); cannot call this, might terminate
    item.idle = true;
    item.token = undefined;
    // Registered last: an entry whose worker failed to build would have no
    // `elapsed`/`terminate`, and `_spawn()` would trip over it forever after.
    this._pool.set(uuid, item);
    return uuid;
  }

  _spawn() {
    if( !useWorkerLoaders ) { return; }

    const now = Date.now();
    if (now - this._lastSpawnTime < this._spawnThrottleMs) {
      const waitTime = this._spawnThrottleMs - (now - this._lastSpawnTime);
      this.logger(`Spawn throttled. Waiting ${ waitTime }ms...`);
      return waitTime;
    }

    const currentSize = this._pool.size;
    if( currentSize >= this.maxSize ) { return; }
    if( currentSize < this.softSize ) {
      this.logger(`Spawning 1 parallel workers... Current workers: ${ currentSize }+1`);
      this._spawnWorker();
      this._lastSpawnTime = now;
      return;
    }

    // check if any idle or elapsed 1s
    let anyIdle = false;
    let maxElapsed = 0;
    this._pool.forEach(( item, uuid ) => {
      if( item.idle ) {
        anyIdle = true;
      }
      const e = typeof item.elapsed === "function" ? item.elapsed() : 0;
      if( maxElapsed < e ) {
        maxElapsed = e;
      }
    });

    if( anyIdle ) { return; }

    this.logger(`Spawning 1 parallel workers... Current workers: ${ currentSize }+1`);
    this._spawnWorker();
    this._lastSpawnTime = now;
  }

  _startWorker( uuid, methodNames, args, { onResult, onError, onProgress, timeOut, token, transferables } = {} ) {
    this.logger(`Starting worker ${uuid} -> threeBrain.${ methodNames.join(".") }`);
    const item = this._pool.get( uuid );
    item.onError = onError;
    item.onResult = onResult;
    item.onProgress = onProgress;
    if( typeof timeOut === "number" ) {
      item.timeOut = timeOut;
    }
    item.token = token;
    item.startWorker({ methodNames : methodNames, args : args, transferables : transferables });
  }

  startWorker({ methodNames, args, onProgress, token, timeOut = 15000, transferables } = {}) {

    if( !this._tokenStartTimeList ) {
      this._tokenStartTimeList = {};
    }

    const now = Date.now();
    if( token ) {
      this._tokenStartTimeList[token] = now;
    }

    return new Promise((resolve, reject) => {

      let running = false;
      const handler = () => {
        if( running ) { return; }
        running = true;
        try {
          if( this._dispatcher.hasEventListener("WorkerPool.idle", handler) ) {
            this._dispatcher.removeEventListener("WorkerPool.idle", handler);
          }
          if( this._dispatcher.hasEventListener("WorkerPool.timeout", handler) ) {
            this._dispatcher.removeEventListener("WorkerPool.timeout", handler);
          }

          if( !useWorkerLoaders ) {
            reject("Async workers are turned off.");
            return;
          }
          const throttledWaitTime = this._spawn();
          const uuids = [...this._pool.keys()];
          for(let i = 0; i < uuids.length; i++) {
            const uuid = uuids[ i ];
            const item = this._pool.get( uuid );
            if( item.idle ) {
              if( token ) {
                const thenTime = this._tokenStartTimeList[token];
                if( thenTime > now ) {
                  // obsolete
                  const e = new Error(`A newer worker with token [${ token }] already started`);
                  e._muffle = true;
                  reject( e );
                  return;
                }
              }
              this._startWorker( uuid, methodNames, args, {
                onResult: resolve, onError: reject,
                onProgress : onProgress, timeOut: timeOut,
                token : token, transferables : transferables
              });
              return;
            }
          }
          if( typeof throttledWaitTime === 'number' ) {
            running = false;
            setTimeout(handler, throttledWaitTime + 1);
            return;
          }
          const e = new Error("No available worker.");
          e._muffle = true;
          throw e;
        } catch (e) {
          // `_muffle` marks the one error that means "all workers are busy,
          // wait for one" — anything else (above all a worker that cannot be
          // built) has to reject, or this promise never settles and the
          // caller's fallback never runs.
          if( !e || e._muffle !== true ) {
            running = true;
            reject( e );
            return;
          }
          this.logger(`Awaiting... (${e.message})`);
          running = false;
          this._dispatcher.addEventListener("WorkerPool.idle", handler);
          this._dispatcher.addEventListener("WorkerPool.timeout", handler);
        }
      };

      handler();


    });
  }

  stopWorkers(token) {
    if( token ) {
      this._pool.forEach(item => {
        if( item.token === token ) {
          item.terminate();
        }
      });
    } else {
      this._pool.forEach(item => {
        item.terminate();
      });
    }
  }
}
const workerURL = [];
const workerPool = {};

async function startWorker( url, { methodNames, args, onProgress, logger, token, timeOut = 15000, transferables } = {} ) {
  if( !useWorkerLoaders ) {
    throw new Error("Async workers disabled.");
  }
  if( brokenWorkerScripts.has( url ) ) {
    throw brokenWorkerScripts.get( url );
  }
  let pool;
  let idx = workerURL.indexOf(url);
  if(idx == -1) {
    pool = new WorkerPool( url, logger );
    const idx = workerURL.length;
    workerURL.push(url);
    workerPool[ idx ] = pool;
  } else {
    pool = workerPool[ idx ];
    if( logger ) {
      pool.logger = logger;
    }
  }
  return await pool.startWorker({
    methodNames : methodNames, args : args,
    onProgress : onProgress, timeOut : timeOut, token : token,
    transferables : transferables });
}

function stopWorker( url, token ) {
  let pool;
  let idx = workerURL.indexOf(url);
  if(idx > -1) {
    pool = workerPool[ idx ];
    pool.stopWorkers(token);
  }
}

export {
  workerLoaders, asyncLoaderAvailable,
  startWorker, stopWorker, workerPool
};

