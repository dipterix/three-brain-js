import { is_electrode } from '../geometry/electrode.js';
import { to_array } from '../utils.js';
import { CONSTANTS } from '../core/constants.js';
import { set_visibility } from '../utils.js';
import { gen_datacube2 } from '../geometry/datacube2.js';
import { gen_free } from '../geometry/free.js';
import { ColorMapKeywords, addToColorMapKeywords } from '../jsm/math/Lut2.js';

// 13. electrode visibility, highlight, groups
// 14. electrode mapping
// 16. Highlight selected electrodes and info

const colorMap = {};

function randomColor() {
  let color = Math.floor(Math.random()*16777215).toString(16);
  color = `#${ "0".repeat( 6 - color.length ) }${ color }`;
  return color;
}

function testColorString( s, randIfFail = false ) {
  let test = true;
  if( typeof s === "string" && s.length == 7 ) {
    for( let j = 1; j < 7; j++ ) {
      const c = s[ j ].toLowerCase();
      if( !"0123456789abcdef".includes(c) ) {
        test = false;
        break;
      }
    }
  } else {
    test = false;
  }

  if( test ) { return s; }

  if( randIfFail ) {
    return randomColor();
  }
  return;
}

function normalizeImageName( fileName ) {
  return fileName.toLowerCase().replaceAll(/\.(nii|nii\.gz|mgz|mgh)$/g, "");
}

function getColorFromFilename( filename ) {

  if( typeof filename === "string" ) {
    filename = normalizeImageName( filename );
    if( filename.length >= 6 ) {
      const s = "#" + filename.substring(filename.length - 6);
      return testColorString( s, true );
    }
  }
  return randomColor();
}

function ensureColorMap( filename ) {
  // assuming filename has been normalized
  if( !colorMap[ filename ] ) {
    colorMap[ filename ] = {
      single: getColorFromFilename( filename ),
      discrete: "default",
      continuous: "turbo",
    }
  }
  return colorMap[ filename ];
}

function getOrCreateController(gui, name, value, parameters, force = false) {
  let controller = gui.getController( name, parameters.folderName, true );
  if( controller.isfake ) {
    controller = gui.addController( name, value, parameters );
  } else if( force ) {
    controller.destroy();
    controller = gui.addController( name, value, parameters );
  }
  return controller;
}

async function updateColorMap( gui ) {
  return;
  for( let fname in colorMap ) {
    const color = colorMap[ fname ];
    gui.getController( `Color - ${ fname }` ).setValue( color );
  }
}

function addVisibilityController({ inst, canvas, gui, fileName, parentFolder }) {
  const visibilityName = `Visibility - ${ fileName }`;
  const innerFolderName = `${parentFolder} > ${fileName}`
  const opts = ["visible", "hidden"];

  // get default values
  let defaultValue;
  let defaultCtrl = gui.getController( "Visibility (all surfaces)", parentFolder, true );
  if( defaultCtrl.isfake ) {
    defaultCtrl = gui.getController( "Visibility (all volumes)", parentFolder, true );
  }
  if( !defaultCtrl.isfake ) {
    defaultValue = defaultCtrl.getValue();
  }
  if( typeof defaultValue !== "string" || opts.indexOf( defaultValue ) === -1 ) {
    defaultValue = "visible";
  }

  let ctrl = gui.getController( visibilityName, innerFolderName, true );
  if( ctrl.isfake ) {
    ctrl = gui.addController(
      visibilityName, "visible",
      {
        args: opts,
        folderName : innerFolderName
      }
    );
  }
  ctrl.onChange((v) => {
    if(!v) { return; }
    switch ( v ) {
      case 'visible':
        inst.forceVisible = true;
        break;
      case 'hidden':
        inst.forceVisible = false;
        break;
      default:
        // code
    };
    canvas.needsUpdate = true;
  }).setValue(defaultValue);
}

function addOpacityController({ inst, canvas, gui, fileName, parentFolder }) {
  const innerFolderName = `${parentFolder} > ${fileName}`
  const opacityName = `Opacity - ${ fileName }`;

  // get default values
  let defaultValue;
  let defaultCtrl = gui.getController( "Opacity (all surfaces)", parentFolder, true );
  if( defaultCtrl.isfake ) {
    defaultCtrl = gui.getController( "Opacity (all volumes)", parentFolder, true );
  }
  if( !defaultCtrl.isfake ) {
    defaultValue = defaultCtrl.getValue();
  }
  if( typeof defaultValue !== "number" ) {
    defaultValue = 1.0;
  }

  let ctrl = gui.getController( opacityName, innerFolderName, true );
  if( ctrl.isfake ) {
    ctrl = gui.addController(
      opacityName, 1,
      {
        folderName : innerFolderName
      }
    ).min(0).max(1).step(0.1);
  }

  if( inst.isDataCube2 ) {
    ctrl.onChange(v => {
      if(!v) { v = 0; }
      inst.object.material.uniforms.alpha.value = v;
      canvas.needsUpdate = true;
    }).setValue( defaultValue );
  } else {
    ctrl.onChange(v => {
      if(!v) { v = 0; }
      if( v < 0.99 ) {
        inst.object.material.transparent = true;
        inst.object.material.opacity = v;
      } else {
        inst.object.material.transparent = false;
      }
      canvas.needsUpdate = true;
    }).setValue( defaultValue );
  }


}

// For single value (surface)
function addColorController({ inst, canvas, gui, fileName, parentFolder, controlCenter }) {
  const innerFolderName = `${parentFolder} > ${fileName}`;

  const colorSettings = ensureColorMap( fileName );

  let currentColorMode;
  let colorModes;

  if( inst.isDataCube2 ) {
    colorModes = ["continuous", "discrete"];
    currentColorMode = inst.isDataContinuous ? "continuous" : "discrete";
  } else {
    colorModes = ["single color"];
    currentColorMode = "single color";
  }

  const colorModeCtrl = getOrCreateController(
    gui, `Color Mode - ${ fileName }`, currentColorMode,
    {
      args: colorModes,
      folderName : innerFolderName
    }, true);

  // Single color (fileName already normalized)
  const singleColorCtrl = getOrCreateController(
    gui, `Color - ${ fileName }`, colorSettings.single,
    {
      isColor: true,
      folderName : innerFolderName
    })
    .onChange( v => {
      if( !testColorString(v) ) { return; }
      if( currentColorMode !== "single color" ) { return; }
      colorSettings.single = v;

      if( inst.isFreeMesh ) {
        inst._materialColor.set( v );
        inst.object.material.vertexColors = false;
      }
      console.warn("Unable to set single color to datacube2");

      canvas.needsUpdate = true;
    })
    .hide();

  const continuousColorCtrl = getOrCreateController(
    gui, `Color Map (Continuous) - ${ fileName }`, colorSettings.continuous,
    {
      args: [...Object.keys( ColorMapKeywords )],
      folderName : innerFolderName
    },
    true)
    .onChange( async (v) => {

      if( currentColorMode !== "continuous" ) { return; }
      if( !ColorMapKeywords[ v ] ) { return; }

      if( inst.isDataCube2 ) {
        const lut = controlCenter.continuousLookUpTables.default;
        inst.useColorLookupTable( lut, v );
        colorSettings.continuous = v;
      }

      canvas.needsUpdate = true;

    }).hide();

  const discreteColorCtrl = getOrCreateController(
    gui, `Color Map (Discrete) - ${ fileName }`, colorSettings.discrete,
    {
      args: [...Object.keys( controlCenter.discreteLookUpTables )],
      folderName : innerFolderName
    },
    true )
    .onChange( async (v) => {

      if( currentColorMode !== "discrete" ) { return; }
      const lut = controlCenter.discreteLookUpTables[ v ];
      if( !lut ) { return; }

      if( inst.isDataCube2 ) {
        inst.useColorLookupTable( lut, v );
        colorSettings.discrete = v;
      }

      canvas.needsUpdate = true;
    }).hide();

  colorModeCtrl.onChange(v => {
    if( typeof v !== "string" ) { return; }
    if( colorModes.indexOf(v) === -1 ) { return; }

    currentColorMode = v;
    switch ( v ) {
      case 'single color':
        singleColorCtrl.show().setValue( colorSettings.single );
        continuousColorCtrl.hide();
        discreteColorCtrl.hide();
        break;

      case 'continuous':
        singleColorCtrl.hide();
        continuousColorCtrl.show().setValue( colorSettings.continuous );
        discreteColorCtrl.hide();
        break;

      case 'discrete':
        singleColorCtrl.hide();
        continuousColorCtrl.hide();
        discreteColorCtrl.show().setValue( colorSettings.discrete );
        break;

      default:
        // code
    }
  });

  // initialize
  colorModeCtrl.setValue( currentColorMode );

}


function addValueClippingController({ inst, canvas, gui, fileName, parentFolder }) {

  // TODO: support these formats
  if( !inst.isDataCube2 ) { return; }
  const innerFolderName = `${parentFolder} > ${fileName}`

  // get default values
  let lb = inst.__dataLB,
      ub = inst.__dataUB,
      range = inst._selectedDataValues;
  let currentLB = typeof range[ 0 ] === 'number' ? range[ 0 ] : lb;
  let currentUB = typeof range[ 1 ] === 'number' ? range[ 1 ] : ub;

  let controllerName = `Clipping Min - ${ fileName }`;
  let ctrl = gui.getController( controllerName, innerFolderName, true );
  if( ctrl.isfake ) {
    ctrl = gui.addController( controllerName, currentLB, { folderName : innerFolderName } );
  }
  ctrl.min(lb).max(ub).step(0.05)
    .onChange( async (v) => {
      if( typeof v !== "number" ) { return; }
      currentLB = v;
      inst._filterDataContinuous( currentLB, currentUB );
      canvas.needsUpdate = true;
    });


  controllerName = `Clipping Max - ${ fileName }`;
  ctrl = gui.getController( controllerName, innerFolderName, true );
  if( ctrl.isfake ) {
    ctrl = gui.addController( controllerName, currentUB, { folderName : innerFolderName } );
  }
  ctrl.min(lb).max(ub).step(0.05)
    .onChange( async (v) => {
      if( typeof v !== "number" ) { return; }
      currentUB = v;
      inst._filterDataContinuous( currentLB, currentUB );
      canvas.needsUpdate = true;
    });

}

function postProcessVolume({ data, fileName, gui, folderName, canvas, controlCenter }) {
  data.fileName = fileName;
  const inst = gen_datacube2( data, canvas );
  inst.forceVisible = true;

  const parentFolder = `${folderName} > Configure ROI Volumes`;
  const innerFolderName = `${folderName} > Configure ROI Volumes > ${ fileName }`;

  // Add visibility controler
  addVisibilityController({
    inst              : inst,
    canvas            : canvas,
    gui               : gui,
    fileName          : fileName,
    parentFolder: parentFolder
  });

  // transparency
  addOpacityController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder
  });

  addValueClippingController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder
  });

  // Always last
  addColorController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder,
    controlCenter: controlCenter,
  });

  canvas.needsUpdate = true;
}

function postProcessSurface({ data, fileName, gui, folderName, canvas, controlCenter }) {
  data.fileName = fileName;
  const inst = gen_free( data, canvas );
  inst.forceVisible = true;
  inst.object.layers.enable( CONSTANTS.LAYER_USER_ALL_SIDE_CAMERAS_4 );
  const parentFolder = `${folderName} > Configure ROI Surfaces`;
  const innerFolderName = `${folderName} > Configure ROI Surfaces > ${ fileName }`;

  // Add visibility controler
  addVisibilityController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder
  });

  // transparency
  addOpacityController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder
  });

  // Color always last
  addColorController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder,
    controlCenter : controlCenter
  });

  canvas.needsUpdate = true;
}

function postProcessText({ data, fileName, gui, folderName, canvas }) {
  window.dnd = data;
  if( Array.isArray( data ) ) {
    // treated as csv/tsv table
    if( !data.length ) { return; }

    const sample = data[ 0 ];
    if( !sample || typeof sample !== "object" ) { return; }

    if( sample["Filename"] && sample["Color"] ) {
      // this is a colormap
      data.forEach(el => {
        const fname = normalizeImageName( sample["Filename"] );
        const color = sample["Color"];
        if ( typeof color === "string" && color.length === 7 ) {
          colorMap[ fname ] = color;
        }
      });
      updateColorMap( gui );
      return;
    }
  }
}

function registerDragNDropFile( ViewerControlCenter ){
  ViewerControlCenter.prototype.addPreset_dragdrop = function(){
    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const fileNames = new Map();

    const dndctrl = this.gui.addController( "Dragdrop Uploader", () => {}, { folderName : folderName } );

    const folder = this.gui.getFolder( folderName );
    folder.domElement.classList.add("lil-gui-ensure-width");

    const $dragdropWrapper = document.createElement("div");
    $dragdropWrapper.style.width = "100%";
    $dragdropWrapper.style.minHeight = "60px";
    $dragdropWrapper.style.border = "1px dashed var(--text-color)";
    $dragdropWrapper.style.textAlign = "center";
    $dragdropWrapper.style.borderRadius = "1em";
    $dragdropWrapper.style.padding = "0.5em";
    $dragdropWrapper.style.transition = "color 0.3s ease-in-out, background-color 0.3s ease-in-out";

    const $dragdropText = document.createElement("span");
    $dragdropText.style.lineHeight = "var(--widget-height)";
    $dragdropText.innerHTML = "Drag files here<br /><small>Volumes (nii[.gz], mgz), surfaces (fs, gii), colormaps (csv, tsv)</small>";
    $dragdropText.style.pointerEvents = "none";
    $dragdropWrapper.appendChild($dragdropText);

    const highLightStyle = () => {
      $dragdropWrapper.style.border = "2px dashed var(--text-color)";
      $dragdropWrapper.style.backgroundColor = "var(--text-color)";
      $dragdropWrapper.style.color = "var(--background-color)";
    }
    const resetStyle = () => {
      $dragdropWrapper.style.border = "2px dashed var(--text-color)";
      $dragdropWrapper.style.backgroundColor = "var(--background-color)";
      $dragdropWrapper.style.color = "var(--text-color)";
    }

    const processFile = async (file) => {
      const fileName = file.name;
      const gui = this.gui;
      const canvas = this.canvas;
      const filenameLowerCase = fileName.toLowerCase();
      let dataType = "surface";
      if(
        filenameLowerCase.endsWith("nii") ||
        filenameLowerCase.endsWith("nii.gz") ||
        filenameLowerCase.endsWith("mgz") ||
        filenameLowerCase.endsWith("mgh")
      ) {
        dataType = "volume";
      } else if (
        filenameLowerCase.endsWith("json") ||
        filenameLowerCase.endsWith("csv") ||
        filenameLowerCase.endsWith("tsv")
      ) {
        dataType = "text";
      }

      let postProcess;
      switch ( dataType ) {
        case 'volume':
          postProcess = (p) => {
            const data = postProcessVolume(p);
            this.updateDataCube2Types();
            return data;
          };
          break;
        case 'surface':
          postProcess = postProcessSurface;
          break;
        default:
          postProcess = postProcessText;
      }

      const data = await this.canvas.fileLoader.loadFromResponse ( file );
      const normalizedFilename = normalizeImageName( fileName );
      fileNames.set( normalizedFilename , 1 );
      return postProcess({
        data: data,
        fileName: normalizedFilename,
        gui: gui,
        folderName: folderName,
        canvas: canvas,
        controlCenter: this
      });
    };

    $dragdropWrapper.ondrop = (ev) => {
      ev.preventDefault();
      resetStyle();
      if (ev.dataTransfer.items) {
        // Use DataTransferItemList interface to access the file(s)
        [...ev.dataTransfer.items].forEach((item, i) => {
          // If dropped items aren't files, reject them
          if (item.kind === "file") {
            const file = item.getAsFile();
            processFile( file );
          }
        });
      } else {
        // Use DataTransfer interface to access the file(s)
        [...ev.dataTransfer.files].forEach((file, i) => {
          processFile( file );
        });
      }

    };

    $dragdropWrapper.ondragover = (evt) => {
      evt.preventDefault();
      highLightStyle();
    };

    $dragdropWrapper.onmouseleave = (evt) => {
      resetStyle();
    };
    $dragdropWrapper.ondragleave = (evt) => {
      evt.preventDefault();
      resetStyle();
    };

    dndctrl.domElement.replaceChildren($dragdropWrapper);

    const surfaceFolderName = `${folderName} > Configure ROI Surfaces`;
    this.gui
      .addController(
        "Visibility (all surfaces)",
        "visible", { args: ["visible", "hidden"], folderName : surfaceFolderName } )
      .onChange(v => {
        if( typeof v !== "string" || !(v === "visible" || v === "hidden") ) { return; }

        fileNames.forEach( (_, fname) => {
          const ctrler = this.gui.getController( `Visibility - ${ fname }`, surfaceFolderName, true );
          ctrler.setValue( v );
        });
      });

    this.gui
      .addController(
        "Opacity (all surfaces)",
        1, { folderName : surfaceFolderName } )
      .min(0).max(1)
      .onChange(v => {
        if( !v ) { v = 0; }
        fileNames.forEach( (_, fname) => {
          const ctrler = this.gui.getController( `Opacity - ${ fname }`, surfaceFolderName, true );
          ctrler.setValue( v );
        });
      });


    const volumeFolderName = `${folderName} > Configure ROI Volumes`;
    this.gui
      .addController(
        "Visibility (all volumes)",
        "visible", { args: ["visible", "hidden"], folderName : volumeFolderName } )
      .onChange(v => {
        if( typeof v !== "string" || !(v === "visible" || v === "hidden") ) { return; }

        fileNames.forEach( (_, fname) => {
          const ctrler = this.gui.getController( `Visibility - ${ fname }`, volumeFolderName, true );
          ctrler.setValue( v );
        });
      });
    this.gui
      .addController(
        "Opacity (all volumes)",
        1, { folderName : volumeFolderName } )
      .min(0).max(1)
      .onChange( async (v) => {
        if( !v ) { v = 0; }
        this.gui.getController("Voxel Opacity").setValue( v );
        fileNames.forEach( (_, fname) => {
          const ctrler = this.gui.getController( `Opacity - ${ fname }`, volumeFolderName, true );
          ctrler.setValue( v );
        });
      });

  };

  return ViewerControlCenter;
}

export { registerDragNDropFile };
