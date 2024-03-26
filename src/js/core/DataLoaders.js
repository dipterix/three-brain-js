import { Loader, FileLoader, LoadingManager, EventDispatcher } from 'three';
import { NiftiImage } from '../formats/NIfTIImage.js';
import { MGHImage } from '../formats/MGHImage.js';
import { FreeSurferMesh } from '../formats/FreeSurferMesh.js';
import { FreeSurferNodeValues } from '../formats/FreeSurferNodeValues.js';
import { Cache } from './StorageCache.js';

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
  constructor( workerScript, logger, size = 8 ) {
    this.workerScript = workerScript;
    this.size = Math.ceil( size );
    if( this.size <= 0 ) { this.size = 1; }
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

    const setIdle = (idle) => {
      if(idle) {
        this.logger(`Worker ${ uuid } -> idle`);
        item.idle = true;
        item.timeOut = 15000;
        this._dispatcher.dispatchEvent({
          type : "WorkerPool.idle",
          uuid: uuid
        });
      } else {
        this.logger(`Worker ${ uuid } -> busy`);
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

      setIdle(true);
      if( typeof f === "function" ) { f(data); }
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
      if( isFinite( timeOut ) ) {
        if( timeOut < 0 ) { timeOut = 0; }
        setTimeout(() => {
          if(!item.idle) {
            errorHandler(new Error("Worker timeout."));
          }
        }, timeOut);
      }
    };
    item.terminate = () => {
      if( !item.idle ) {
        try {
          errorHandler(new Error("Worker has been terminated."));
        } catch (e) {}
      }
      item.idle = false;
      item.onError = undefined;
      item.onResult = undefined;
      worker.terminate();
      this._pool.delete( uuid )
    }
    setIdle( true );
    return uuid;
  }

  _spawn() {
    const newSize = this.size - this._pool.size;
    if( newSize < 1 ) { return; }
    this.logger(`Spawning ${ newSize } parallel workers...`);
    for( let i = 0 ; i < newSize ; i++ ) {
      this._spawnWorker();
    }
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

      try {
        this._spawn();
      } catch (e) {
        reject(e);
        return;
      }

      const tryStartWorker = () => {
        if( !useWorkerLoaders ) {
          reject("Async workers are turned off.");
          return;
        }
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
      }

      try {
        tryStartWorker();
        return;
      } catch (e) {
        this.logger(`Awaiting... (${e.message})`);
      }

      const handler = () => {
        try {
          tryStartWorker();
          this._dispatcher.removeEventListener("WorkerPool.idle", handler);
          return;
        } catch (e) {
          this.logger(`Awaiting... (${e.message})`);
        }
      };

      this._dispatcher.addEventListener("WorkerPool.idle", handler);
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


function resolveURL( url ) {
  if( url.startsWith("#") ) {

    const dataElements = document.querySelectorAll(`script[data-for='${ url }']`);
    const dataMIMEType = dataElements[0].getAttribute("data-type");
    let isPlainText = false;
    if( dataMIMEType && dataMIMEType.length > 0 ) {
      const dataMIMETypeLower = dataMIMEType.toLowerCase();
      const urlLower = url.toLowerCase();
      if(
        dataMIMETypeLower.endsWith("json") ||
        dataMIMETypeLower.endsWith("csv") ||
        dataMIMETypeLower.endsWith("txt") ||
        dataMIMETypeLower.endsWith("text") ||
        dataMIMETypeLower.endsWith("plain") ||
        dataMIMETypeLower.endsWith("tsv") ||
        urlLower.endsWith("json") ||
        urlLower.endsWith("csv") ||
        urlLower.endsWith("tsv") ||
        urlLower.endsWith("txt")
      ) {
        isPlainText = true;
      }
    }

    const dataArrays = [];
    dataElements.forEach(el => {
        const currentPartition = parseInt( el.getAttribute("data-partition") );
        const parsedBase64 = atob( el.innerHTML.trim() );
        if( isPlainText ) {
          // https://stackoverflow.com/questions/16245767/creating-a-blob-from-a-base64-string-in-javascript
          dataArrays[ currentPartition ] = parsedBase64;
        } else {
          const partitionSize = parseInt( el.getAttribute("data-parition-size") );
          const byteArray = new Uint8Array( partitionSize );
          for (let index = 0; index < partitionSize; index++ ) {
            byteArray[index] = parsedBase64.charCodeAt(index);
          }
          dataArrays[ currentPartition ] = byteArray;
        }
    })
    const blob = new Blob(dataArrays, { type: dataMIMEType });
    return {
      originalUrl : url,
      response : blob,
      isObjectURL : true,
    };
  } else {
    let absoluteURL = url;
    try {
      const urlSolved = new URL(url, document.baseURI);
      absoluteURL = `${urlSolved.pathname}${ urlSolved.search }`;
      if(!startsWith(absoluteURL, "/")) {
        absoluteURL = `/${absoluteURL}`;
      }
    } catch (e) {}
    return {
      originalUrl : url,
      resolvedUrl : absoluteURL,
      isObjectURL : false,
    };
  }
}

class BasicLoader extends Loader {
  constructor( manager, { workerScript, logger, timeOut = 15000 } = {} ) {
    super( manager );
    this.workerScript = workerScript;
    // this.mimeType = mimeType;
    // this.responseType = "json";
    this.loaderName = null
    this.timeOut = timeOut;
    this.debug = false;
    if( logger ) {
      this.logger = logger;
    } else {
      this.logger = console.debug;
    }
  }

  stopWorkers() {
    stopWorker( this.workerScript )
      .catch(e => {});
  }

  unpack( response ) {
    switch ( this.responseType ) {
      case 'arraybuffer':
        return response.arrayBuffer();
      case 'blob':
				return response.blob();
			case 'document':
  			return response.text()
					.then( text => {
						const parser = new DOMParser();
						return parser.parseFromString( text, mimeType );
					} );
			case 'json':
				return response.text().then(v => { return JSON.parse(v); });
			default:
			  return response.text();
		}
  }

  _loadURLResponse( response, url, onLoad, onProgress, onError ) {
    this.unpack( response )
      .then( data => {
        try {
          onLoad( this.parse( data ) );
        } catch ( e ) {
          throw e;
        }
			})
			.catch( err => {
			  if( onError ) {
			    onError( err );
			    this.manager.itemError( url );
			  } else {
			    this.manager.itemError( url );
			    throw err;
			  }
			} )
			.finally( () => {
				this.manager.itemEnd( url );
			});
		this.manager.itemStart( url );
  }

  load( url, onLoad, onProgress, onError ) {

    let resolved;
    try {
      resolved = resolveURL( url );
    } catch (e) {
      if ( onError ) {
        onError( e );
      } else {
        console.error( e );
      }
      this.manager.itemError( url );
      return;
    }

    if( resolved.isObjectURL ) {
      this._loadURLResponse( resolved.response, url, onLoad, onProgress, onError );
  		return;
    }

    const scope = this;
    const loader = new FileLoader( this.manager );
    loader.setPath( this.path );
    loader.setRequestHeader( this.requestHeader );
    loader.setWithCredentials( this.withCredentials );
    loader.setResponseType( this.responseType );
    loader.setMimeType( this.mimeType );

    loader.load( resolved.resolvedUrl, function ( data ) {

      try {
        onLoad( scope.parse( data ) );
      } catch ( e ) {
        if ( onError ) {
          onError( e );
        } else {
          console.error( e );
        }
        scope.manager.itemError( url );
      }

    }, onProgress, onError);
  }

  loadAsync( url, onProgress ) {
    const scope = this;

    return new Promise( function ( resolve, reject ) {
      let resolved;
      try {
        resolved = resolveURL( url );
      } catch (e) {
        reject(e);
        return;
      }
      const onProgress2 = (p) => {
        try {
          if( onProgress ) {
            onProgress(p);
          }
        } catch (e) {
          reject(e);
        }
      };
      if( resolved.isObjectURL ) {
        scope._loadURLResponse( resolved.response, url, resolve, onProgress2, reject );
        return;
      }

      // check if window.Worker is available
      const workerParams = asyncLoaderAvailable( scope.loaderName, scope.workerScript );
      if( workerParams === false ) {
        scope.load( resolved.resolvedUrl, resolve, onProgress2, reject );
        return;
      }

      // try to use workers instead of main thread
      startWorker( scope.workerScript, {
        methodNames : workerParams,
        timeOut : scope.timeOut,
        logger: scope.logger,
        args : { url : resolved.resolvedUrl, mimeType: scope.mimeType },
        onProgress: onProgress2 })
      .then(data => {
        resolve( data );
      })
      .catch((e) => {
        if( useWorkerLoaders ) {
          // useWorkerLoaders = false;
          scope.logger(e);
          scope.logger("Unable to resolve parallel worker (see warning above). Trying to use regular loader: " + (resolved.resolvedUrl ?? url));
        }
        scope.load( resolved.resolvedUrl, (v) => {
          scope.logger("Successfully retrieved via synchronus loader: " + resolved.resolvedUrl);
          resolve(v);
        }, onProgress2, reject );
      })
      .catch(reject);
    });
  }
}

class JSONLoader extends BasicLoader {

  responseType = 'json';
  loaderName = 'JSONLoader';

  parse( json ) {
    return json;
  }
}

class NiftiLoader extends BasicLoader {
  responseType = "arraybuffer";
  loaderName = "NiftiLoader";

  parse( buffer ) {
    return new NiftiImage( buffer );
  }
}

class MGHLoader extends BasicLoader {
  responseType = "arraybuffer";
  loaderName = "MGHLoader";

  parse( buffer ) {
    return new MGHImage( buffer );
  }
}

class FreeSurferMeshLoader extends BasicLoader {
  responseType = "arraybuffer";
  loaderName = "FreeSurferMeshLoader";

  parse( buffer ) {
    return new FreeSurferMesh( buffer );
  }
}

class FreeSurferNodeLoader extends BasicLoader {
  responseType = "arraybuffer";
  loaderName = "FreeSurferNodeLoader";

  parse( buffer ) {
    return new FreeSurferNodeValues( buffer );
  }
}

const debugManager = new LoadingManager();
debugManager.onStart = function ( url, itemsLoaded, itemsTotal ) {
  console.debug( 'Started loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.' );
};

debugManager.onLoad = function ( ) {
  console.debug( 'Loading complete!');
};

debugManager.onProgress = function ( url, itemsLoaded, itemsTotal ) {
  console.debug( 'Loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.' );
};

debugManager.onError = function ( url ) {
  console.debug( 'There was an error loading ' + url );
};
const silentManager = new LoadingManager();
silentManager.onStart = function ( url, itemsLoaded, itemsTotal ) { };
silentManager.onLoad = function ( ) { };
silentManager.onProgress = function ( url, itemsLoaded, itemsTotal ) { };
silentManager.onError = function ( url ) { };

function simpleLoad (loader, url, postMessage, token) {

  Cache.enabled = false;

  loader.load(
    url,
    ( obj ) => {
      postMessage({
        token: token,
        status: "done",
        object: obj
      })
    },
    ( progress ) => {
      postMessage({
        token: token,
        status: "progress",
        object: {
          lengthComputable: progress.lengthComputable,
          loaded    : progress.loaded,
          timeStamp : progress.timeStamp,
          total     : progress.total,
          type      : progress.type
        }
      })
    },
    (e) => {
      postMessage({
        token: token,
        status: "error",
        object: e
      })
    }
  );

  // no return since the postMessage is done in async
  return;
}

const loaderClasses = {
  "JSONLoader"  : JSONLoader,
  "NiftiLoader" : NiftiLoader,
  "MGHLoader"   : MGHLoader,
  "FreeSurferMeshLoader": FreeSurferMeshLoader,
  "FreeSurferNodeLoader": FreeSurferNodeLoader
}

for(let loaderType in loaderClasses) {
  const Cls = loaderClasses[ loaderType ];
  const simpleLoader = function({ url, mimeType } = {}, postMessage, token) {
    const loader = new Cls( silentManager );
    if( mimeType ) {
      loader.mimeType = mimeType;
    }
    simpleLoad(loader, url, postMessage, token);
  }
  simpleLoader._workerCallable = true;
  workerLoaders[ loaderType ] = simpleLoader;
}

function guessLoaderType( url ) {
  const urlLowerCase = url.toLowerCase();
  let loaderType;
  if( urlLowerCase.endsWith("nii") || urlLowerCase.endsWith("nii.gz") ) {
    loaderType = "NiftiLoader";
  } else if ( urlLowerCase.endsWith("mgh") || urlLowerCase.endsWith("mgz") ) {
    loaderType = "MGHLoader";
  } else if (
    urlLowerCase.endsWith("sulc") || urlLowerCase.endsWith("curv")
  ) {
    loaderType = "FreeSurferNodeLoader";
  } else if (
    urlLowerCase.endsWith("json")
  ) {
    loaderType = "JSONLoader";
  } else {
    loaderType = "FreeSurferMeshLoader";
  }
  return loaderType;
}

class CanvasFileLoader2 extends Loader {
  constructor( { workerScript, logger, maxTimeOut = 15000  } = {} ) {
    super( new LoadingManager() );
    this.workerScript = workerScript;
    this.maxTimeOut = maxTimeOut;
    this.debug = false;
    this.logger = logger;
    // keep a flag. If the flag mismatch, then no need to load
    this.flag = 0;
    this.cacheEnabled = true;
    /*
    this.manager.onStart = function ( url, itemsLoaded, itemsTotal )
    debugManager.onLoad = function ( )
    debugManager.onProgress = function ( url, itemsLoaded, itemsTotal )
    debugManager.onError = function ( url )
    */
  }

  setCacheEnabled( enabled ) {
    if( enabled ) {
      this.cacheEnabled = true;
    } else {
      Cache.clear();
      this.cacheEnabled = false;
    }
  }

  alterFlag() {
    this.flag++;
    if( this.flag > 4096 ) {
      this.flag = 0;
    }
  }

  stopWorkers() {
    stopWorker( this.workerScript )
      .catch(e => {});
  }

  load( url, onLoad, onProgress, onError ) {
    const currentFlag = this.flag;
    const loaderType = guessLoaderType( url );
    if( loaderType === undefined ) {
      onError(new Error(`Unknown format for file: ${ url }`));
      return;
    }
    const loaderCls = loaderClasses[ loaderType ];
    const loader = new loaderCls( this.manager, {
      logger: this.logger,
    } );
    loader.debug = this.debug;

    Cache.enabled = this.cacheEnabled;
    loader.load( url, (data) => {
      if( currentFlag !== this.flag ) {
        onError(new Error("Loader flag changed."));
        return;
      }
      onLoad( this.parse({
        data: data,
        loaderType: loaderType,
      }) );
    }, onProgress, onError );
  }

  loadAsync( url, onProgress ) {
    const currentFlag = this.flag;
    const loaderType = guessLoaderType( url );
    if( loaderType === undefined ) {
      onError(new Error(`Unknown format for file: ${ url }`));
      return;
    }
    const loaderCls = loaderClasses[ loaderType ];
    const loader = new loaderCls( this.manager, {
      workerScript: this.workerScript ,
      logger: this.logger,
    });
    loader.debug = this.debug;
    loader.timeOut = this.maxTimeOut;

    Cache.enabled = this.cacheEnabled;
    const p = loader.loadAsync(
      url,
      progress => {
        if( currentFlag !== this.flag ) {
          throw new Error("Loader flag changed.");
        }
        if( onProgress ) {
          onProgress( progress );
        }
      }
    )
    .then( data => {
      if( currentFlag !== this.flag ) {
        throw new Error("Loader flag changed.");
      }
      return this.parse({
        data: data,
        loaderType: loaderType,
        isAsync: true
      })
    });

    return p;
  }

  parse( data ) {
    if( data.loaderType === "JSONLoader" ) {
      return data.data;
    } else {
      if( data.isAsync ) {
        const content = data.data;
        switch (data.loaderType) {
          case 'NiftiLoader':
            return {
              "_originalData_": new NiftiImage().copy( data.data )
            };
            break;
          case 'MGHLoader':
            return {
              "_originalData_": new MGHImage().copy( data.data )
            };
            break;
          case 'FreeSurferMeshLoader':
            return {
              "_originalData_": new FreeSurferMesh().copy( data.data )
            };
            break;
          case 'FreeSurferNodeLoader':
            return {
              "_originalData_": new FreeSurferNodeValues().copy( data.data )
            };
            break;

          default:
            return {
              "_originalData_": data.data
            };
        }
      } else {
        return {
          "_originalData_": data.data
        };
      }
    }
  }

}

export { loaderClasses, debugManager, workerLoaders, CanvasFileLoader2, workerPool, resolveURL, Cache };
