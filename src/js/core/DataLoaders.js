import { Loader, FileLoader, LoadingManager, EventDispatcher } from 'three';
import { Cache } from './StorageCache.js';
import { workerLoaders, asyncLoaderAvailable,
  startWorker, stopWorker } from './Workers.js';

import { parse as csvParse } from 'papaparse';
import { NiftiImage } from '../formats/NIfTIImage.js';
import { MGHImage } from '../formats/MGHImage.js';
import { GiftiMesh } from '../formats/GIfTIMesh.js';
import { FreeSurferMesh } from '../formats/FreeSurferMesh.js';
import { FreeSurferNodeValues } from '../formats/FreeSurferNodeValues.js';

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
        scope.logger(e);
        scope.logger("Unable to resolve parallel worker (see warning above). Trying to use regular loader: " + (resolved.resolvedUrl ?? url));
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

class CSVLoader extends BasicLoader {

  responseType = 'csv';
  loaderName = 'CSVLoader';
  mimeType = undefined; // so text string is returned

  parse( csv, config ) {
    return csvParse( csv, {
      header: true,
      dynamicTyping: true,
    }).data;
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

class GiftiLoader extends BasicLoader {
  responseType = "text";
  loaderName = "GiftiLoader";
  mimeType = undefined; // so text string is returned

  parse( buffer ) {
    return new GiftiMesh( buffer );
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

const loaderClasses = {
  "JSONLoader"  : JSONLoader,
  "CSVLoader"   : CSVLoader,
  "NiftiLoader" : NiftiLoader,
  "MGHLoader"   : MGHLoader,
  "GiftiLoader" : GiftiLoader,
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
  } else if ( urlLowerCase.endsWith("gii") || urlLowerCase.endsWith("gii.gz") ) {
    loaderType = "GiftiLoader";
  } else if ( urlLowerCase.endsWith("sulc") || urlLowerCase.endsWith("curv") ) {
    loaderType = "FreeSurferNodeLoader";
  } else if ( urlLowerCase.endsWith("json") ) {
    loaderType = "JSONLoader";
  } else if ( urlLowerCase.endsWith("csv") || urlLowerCase.endsWith("tsv") ) {
    loaderType = "CSVLoader";
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

  loadFromResponse ( response, altType ) {
    return new Promise((resolve, reject) => {
      const loaderType = guessLoaderType( response.name ) || guessLoaderType( altType );
      if( loaderType === undefined ) {
        const err = new Error(`Unknown format for file: ${ response.name }`);
        reject( err );
        return;
      }
      const loaderCls = loaderClasses[ loaderType ];
      const loader = new loaderCls( this.manager, {
        logger: this.logger,
      });

      let p;
      switch ( loader.responseType ) {
  			case 'arraybuffer':
  				p = response.arrayBuffer();
  				break;
  			case 'blob':
  				p = response.blob();
  				break;
  			case 'document':
  			  p = response.text()
  					.then( text => {
  						const parser = new DOMParser();
  						return parser.parseFromString( text, loader.mimeType );
  					});
  				break;
  			case 'json':
  			  p = response.json();
  			  break;
  			default:
  			  p = response.text();
  		};
  		p.then(data => {
  		  resolve( loader.parse( data ) );
  		})
  		.catch(reject);

    });

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
          case 'GiftiLoader':
            return {
              "_originalData_": new GiftiMesh().copy( data.data )
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

export { loaderClasses, debugManager, silentManager, CanvasFileLoader2, resolveURL, Cache, workerLoaders };
