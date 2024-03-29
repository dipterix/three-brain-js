import { EventDispatcher } from 'three';
const workerLoaders = {};
let useWorkerLoaders = true;

function asyncLoaderAvailable( name, workerScript ) {
  if( typeof workerScript !== "string") { return false; }
  if( !useWorkerLoaders ) { return false; }
  if( typeof name !== "string") { return false; }
  if(!window) { return false; }
  if(!window.Worker) { return false; }
  if(!workerLoaders[ name ]) { return false; }
  return ["workerLoaders", name];
}


class WorkerPool {
  constructor( workerScript, logger, softSize = 0, maxSize = 8 ) {
    this.workerScript = workerScript;
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
    this._pool.set(uuid, item);

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

    const worker = new window.Worker( this.workerScript );
    const errorHandler = (e) => {
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

    item.startWorker = ({ methodNames, args } = {}) => {
      if(!item.idle) { throw new Error("Worker is not idle"); }
      setIdle( false );
      worker.postMessage({
        methodNames: methodNames,
        args: args,
        token: uuid
      });
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
      item.timeOut = 15000;
    };
    item.elapsed = () => {
      return ( new Date().getTime() - timeStarted );
    };
    // setIdle( true ); cannot call this, might terminate
    item.idle = true;
    return uuid;
  }

  _spawn() {
    if( !useWorkerLoaders ) { return; }
    const currentSize = this._pool.size;
    if( currentSize >= this.maxSize ) { return; }
    if( currentSize < this.softSize ) {
      this.logger(`Spawning 1 parallel workers... Current workers: ${ currentSize }+1`);
      this._spawnWorker();
      return;
    }

    // check if any idle or elapsed 1s
    let anyIdle = false;
    let maxElapsed = 0;
    this._pool.forEach(( item, uuid ) => {
      if( item.idle ) {
        anyIdle = true;
      }
      const e = item.elapsed();
      if( maxElapsed < e ) {
        maxElapsed = e;
      }
    });

    if( anyIdle ) { return; }

    this.logger(`Spawning 1 parallel workers... Current workers: ${ currentSize }+1`);
    this._spawnWorker();
  }

  _startWorker( uuid, methodNames, args, { onResult, onError, onProgress, timeOut } = {} ) {
    this.logger(`Starting worker ${uuid} -> threeBrain.${ methodNames.join(".") }`);
    const item = this._pool.get( uuid );
    item.onError = onError;
    item.onResult = onResult;
    item.onProgress = onProgress;
    if( typeof timeOut === "number" ) {
      item.timeOut = timeOut;
    }
    item.startWorker({ methodNames : methodNames, args : args });
  }

  startWorker({ methodNames, args, onProgress, timeOut = 15000 } = {}) {

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
          this._spawn();
          const uuids = [...this._pool.keys()];
          for(let i = 0; i < uuids.length; i++) {
            const uuid = uuids[ i ];
            const item = this._pool.get( uuid );
            if( item.idle ) {
              this._startWorker( uuid, methodNames, args, {
                onResult: resolve, onError: reject,
                onProgress : onProgress, timeOut: timeOut
              });
              return;
            }
          }
          throw new Error("No available worker.");
        } catch (e) {
          this.logger(`Awaiting... (${e.message})`);
          running = false;
          this._dispatcher.addEventListener("WorkerPool.idle", handler);
          this._dispatcher.addEventListener("WorkerPool.timeout", handler);
        }
      };

      handler();


    });
  }

  stopWorkers() {
    this._pool.forEach(item => {
      item.terminate();
    });
  }
}
const workerURL = [];
const workerPool = {};

async function startWorker( url, { methodNames, args, onProgress, logger, timeOut = 15000 } = {} ) {
  if( !useWorkerLoaders ) {
    throw new Error("Async workers disabled.");
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
    onProgress : onProgress, timeOut : timeOut });
}
async function stopWorker( url ) {
  let pool;
  let idx = workerURL.indexOf(url);
  if(idx > -1) {
    pool = workerPool[ idx ];
    pool.stopWorkers();
  }
}

export {
  workerLoaders, asyncLoaderAvailable,
  startWorker, stopWorker, workerPool
};

