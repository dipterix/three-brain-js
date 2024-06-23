/**
 * @Author: Zhengjia Wang
 * Adapter of model (threejs_scene) and viewer (htmlwidgets)
 */

// External libraries
import * as THREE from 'three';
import WebGL from './jsm/capabilities/WebGL.js'
import * as download from 'downloadjs';
import { json2csv } from 'json-2-csv';
import jsPDF from 'jspdf';
import ClipboardJS from 'clipboard';
import nifti from 'nifti-reader-js';
import gifti from 'gifti-reader-js';
import { svd, registerRigidPoints } from './Math/svd.js';
import QrCodeWithLogo from "qrcode-with-logos";

// Viewer class
import { CONSTANTS } from './core/constants.js';
import { ViewerWrapper } from './core/ViewerWrapper.js';
import { ViewerApp } from './core/ViewerApp.js';
import { StorageCache } from './core/StorageCache.js';

// Formats
import { MGHImage } from './formats/MGHImage.js';
import { NiftiImage } from './formats/NIfTIImage.js';
import { FreeSurferMesh } from './formats/FreeSurferMesh.js';
import { FreeSurferNodeValues } from './formats/FreeSurferNodeValues.js';
import { debugManager, loaderClasses, resolveURL, Cache } from './core/DataLoaders.js';

import { GLTFExporter } from './jsm/exporters/GLTFExporter.js';
import { exportScene } from './formats/exportScene.js'

import { workerPool } from './core/Workers.js';

// Addons
import { RShinyDriver } from './drivers/RShinyDriver.js'
import { DemoBackground } from './ext/DynamicBackground.js'
import css from '../css/dipterix.css';


/*
const threeBrainJS = {
  ViewerApp           : ViewerApp,
  ViewerWrapper       : ViewerWrapper,
  StorageCache        : StorageCache,
  constants           : CONSTANTS,
  utils : {
    THREE             : THREE,
    WebGL             : WebGL,
    json2csv          : json2csv,
    download          : download,
    ClipboardJS       : ClipboardJS
  }
}
*/

const Constants = CONSTANTS;
const ExternLibs = {
  THREE             : THREE,
  WebGL             : WebGL,
  json2csv          : json2csv,
  jsPDF             : jsPDF,
  downloadjs        : download,
  ClipboardJS       : ClipboardJS,
  nifti             : nifti,
  gifti             : gifti,
  QRCode            : QrCodeWithLogo,
  registration      : { svd : svd, registerRigidPoints : registerRigidPoints },
  DemoBackground    : DemoBackground,
};

const Drivers = {
  Shiny : RShinyDriver
};

const Importers = {
  FreeSurferMesh        : FreeSurferMesh,
  FreeSurferNodeValues  : FreeSurferNodeValues,
  MGHImage              : MGHImage,
  NiftiImage            : NiftiImage,
  debugManager          : debugManager,
  loaderClasses         : loaderClasses,
  resolveURL            : resolveURL,
  Cache                 : Cache,
};

const Exporters = {
  GLTFExporter          : GLTFExporter,
  exportScene           : exportScene,
}

const Workers = workerPool;

export { ViewerApp, ViewerWrapper, StorageCache, Importers, Exporters, Constants, Drivers, ExternLibs, Workers };
