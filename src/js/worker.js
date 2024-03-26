/**
 * @Author: Zhengjia Wang
 * Adapter of model (threejs_scene) and viewer (htmlwidgets)
 */

// External libraries
import * as download from 'downloadjs';
import { json2csv } from 'json-2-csv';
import ClipboardJS from 'clipboard';
import nifti from 'nifti-reader-js';
import { svd, registerRigidPoints } from './Math/svd.js';
import QrCodeWithLogo from "qrcode-with-logos";

// Formats
import { MGHImage } from './formats/MGHImage.js';
import { NiftiImage } from './formats/NIfTIImage.js';
import { FreeSurferMesh } from './formats/FreeSurferMesh.js';
import { FreeSurferNodeValues } from './formats/FreeSurferNodeValues.js';
import { debugManager, workerLoaders } from './core/DataLoaders.js';


const lib = {
  json2csv          : json2csv,
  downloadjs        : download,
  ClipboardJS       : ClipboardJS,
  nifti             : nifti,
  QRCode            : QrCodeWithLogo,
  registration      : { svd : svd, registerRigidPoints : registerRigidPoints },
  FreeSurferMesh        : FreeSurferMesh,
  FreeSurferNodeValues  : FreeSurferNodeValues,
  MGHImage              : MGHImage,
  NiftiImage            : NiftiImage,
  debugManager          : debugManager,
  workerLoaders         : workerLoaders
}

async function workerListener (event) {
  const methodNames = event.data.methodNames;
  const args = event.data.args;
  const token = event.data.token;

  if ( !Array.isArray(methodNames) ) {
    throw new TypeError(`Invalid method names: ${methodNames}. Must be an array`);
  }
  let method = lib;
  methodNames.forEach((name) => {
    method = method[ name ];
    if( method === undefined ) {
      throw new TypeError(`Cannot find object: threeBrain.${methodNames.join("")}`);
    }
  })
  if( typeof method !== "function" ) {
    throw new TypeError(`Object threeBrain.${methodNames.join("")} is not a function. Abort.`);
  }
  if( !method._workerCallable ) {
    throw new TypeError(`Method threeBrain.${methodNames.join("")} is not a worker-callable function.`);
  }

  postMessage({
    token: token,
    status: "started"
  });

  const re = method(args, postMessage, token);

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
