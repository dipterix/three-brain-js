import { GLTFExporter } from '../jsm/exporters/GLTFExporter.js';
import { PLYExporter } from '../jsm/exporters/PLYExporter.js';
import { OBJExporter } from '../jsm/exporters/OBJExporter.js';

import * as download from 'downloadjs';

function saveArrayBuffer( buffer, filename ) {

	// save( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename );
	download( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename, 'application/octet-stream' );

}

function saveString( text, filename ) {

	// save( new Blob( [ text ], { type: 'text/plain' } ), filename );
	download( new Blob( [ text ], { type: 'text/plain' } ), filename, 'text/plain' );

}

const exporterList = {
  "GLTF" : {
    cls: GLTFExporter,
    ext: "gltf",
    opt: {
      trs         : false,
    	onlyVisible : true,
    	binary      : false,
    	maxTextureSize : 4096,
    }
  },
  "GLB" : {
    cls : GLTFExporter,
    ext : "glb",
    opt : {
      trs         : false,
    	onlyVisible : true,
    	binary      : true,
    	maxTextureSize : 4096,
    }
  },
  "PLY" : {
    cls : PLYExporter,
    ext : "ply",
    opt : {
      binary: true
    }
  },
  "OBJ"  : {
    cls : OBJExporter,
    ext : "obj",
    opt : {}
  }
}

function exportScene( scene, type, options = {} ) {

  const exporterConfig = exporterList[ type ];
  const exporter = new exporterConfig.cls();
  const opt = Object.assign( Object.assign({}, exporterConfig.opt), options );
  const filename = `rave-model3D.${exporterConfig.ext}`;

  let exported = false;

	const result = exporter.parse(

		scene,

		function ( result ) {

		  exported = true;

			if ( result instanceof ArrayBuffer ) {

				saveArrayBuffer( result, filename );

			} else {

				const output = JSON.stringify( result, null, 2 );
				saveString( output, filename );

			}

		},
		function ( error ) {

		  exported = true;

			console.log( 'An error happened during parsing', error );

		},
		opt
	);

	if( !exported && result ) {

	  if ( result instanceof ArrayBuffer ) {

			saveArrayBuffer( result, filename );

		} else {

			const output = JSON.stringify( result, null, 2 );
			saveString( output, filename );

		}

	}

}

export { exportScene };

