import { is_electrode } from '../geometry/electrode.js';
import { to_array } from '../utils.js';
import { CONSTANTS } from '../core/constants.js';
import { set_visibility } from '../utils.js';
import { gen_datacube2 } from '../geometry/datacube2.js';
import { gen_free } from '../geometry/free.js';
import { ColorMapKeywords, addToColorMapKeywords } from '../jsm/math/Lut2.js';
import { randomColor, testColorString } from '../utility/color.js';
import { normalizeImageName, getColorFromFilename } from '../utility/normalizeImageName.js';

// 13. electrode visibility, highlight, groups
// 14. electrode mapping
// 16. Highlight selected electrodes and info

const colorMap = {
  "lh.pial" : {
    single : "#FFFFFF",
    discrete: "default",
    continuous: "BlueRed",
  },
  "rh.pial" : {
    single : "#FFFFFF",
    discrete: "default",
    continuous: "BlueRed",
  }
};

function ensureColorMap( filename ) {
  // assuming filename has been normalized
  const prefix = filename.replaceAll(/\.(nii|nii\.gz|stl|gii|mgh|mgz)$/gi, "");
  if( !colorMap[ prefix ] ) {
    colorMap[ prefix ] = {
      single: getColorFromFilename( prefix ),
      discrete: "default",
      continuous: "rainbow",
    }
  }
  return colorMap[ prefix ];
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
  for( let fname in colorMap ) {
    const color = colorMap[ fname ].single;

    gui.getController( `Color - ${ fname }.nii` ).setValue( color );
    gui.getController( `Color - ${ fname }.nii.gz` ).setValue( color );
    gui.getController( `Color - ${ fname }.mgz` ).setValue( color );

    gui.getController( `Color - ${ fname }.gii` ).setValue( color );
    gui.getController( `Color - ${ fname }.stl` ).setValue( color );
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
      inst.setOpacity( v );
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
function addColorController({ inst, canvas, gui, fileName, parentFolder, controlCenter, currentColorMode }) {
  const innerFolderName = `${parentFolder} > ${fileName}`;

  const colorSettings = ensureColorMap( fileName );

  let colorModes;

  if( inst.isDataCube2 ) {
    colorModes = ["single color", "continuous", "discrete"];
    if( typeof currentColorMode !== "string" ) {
      currentColorMode = inst.isDataContinuous ? "continuous" : "discrete";
    }
  } else {
    colorModes = ["single color", "continuous"];
    if( typeof currentColorMode !== "string" ) {
      currentColorMode = "single color";
    }
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
      } else if( inst.isDataCube2 ) {
        const lut = controlCenter.continuousLookUpTables.default;
        inst.useColorLookupTable( lut, v );
      }

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
      } else if ( inst.isFreeMesh ) {
        const trackInfo = inst.setTrackValues({ cmapName : v });
        if( trackInfo ) {
          inst._materialColor.set( "#FFFFFF" );
          inst.object.material.vertexColors = true;
        }
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

function postProcessVolume({ data, fileName, folderName, app }) {
  const gui = app.controllerGUI;
  const controlCenter = app.controlCenter;
  const canvas = app.canvas;
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

  return inst;
}

function postProcessSurface({ data, fileName, folderName, app }) {
  const gui = app.controllerGUI;
  const controlCenter = app.controlCenter;
  const canvas = app.canvas;
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

  return inst;
}

function postProcessSurfaceColor({ data, fileName, folderName, app }) {
  const gui = app.controllerGUI;
  const controlCenter = app.controlCenter;
  const canvas = app.canvas;
  data.fileName = fileName;
  const parentFolder = `${folderName} > Configure ROI Surfaces`;

  // get hemisphere and surface type (maybe)
  let hemi = ["Left", "Right"];
  if ( fileName.startsWith("lh") ) {
    hemi = ["Left"];
  } else if ( fileName.startsWith("rh") ) {
    hemi = ["Right"];
  }

  // obtain the current subject
  const subjectCode = canvas.get_state("target_subject");

  // get the surface
  const surfaceList = canvas.surfaces.get( subjectCode );
  const lut = controlCenter.continuousLookUpTables.default;

  let maxAbsVal = Math.max(data.max, -data.min);
  if( maxAbsVal <= 0 ) { maxAbsVal = 1; }

  for(let h = 0; h < hemi.length; h++) {
    const surface = surfaceList[`FreeSurfer ${hemi[h]} Hemisphere - pial (${subjectCode})`];
    if( surface ) {
      const surfaceName = `${ hemi[h][0].toLowerCase() }h.pial`;
      const inst = surface.userData.instance;
      const innerFolderName = `${folderName} > Configure ROI Surfaces > ${surfaceName}`;
      inst.setTrackValues({
        values   : data.vertexData,
        cmapName : "rainbow",
        minValue : -maxAbsVal,
        maxValue : maxAbsVal
      });
      addColorController({
        inst        : inst,
        canvas      : canvas,
        gui         : gui,
        fileName    : surfaceName,
        parentFolder: parentFolder,
        controlCenter : controlCenter,
        currentColorMode: "continuous"
      });
    }
  }
  canvas.needsUpdate = true;
  const sDispCtrl = gui.getController("Surface Color");
  sDispCtrl.setValue("vertices");

  // no object needs to be added to the canvas
  return;
}

function postProcessText({ data, fileName, folderName, app }) {
  const gui = app.controllerGUI;
  const controlCenter = app.controlCenter;
  const canvas = app.canvas;

  if( Array.isArray( data ) ) {
    // treated as csv/tsv table
    if( !data.length ) { return; }

    const sample = data[ 0 ];
    if( !sample || typeof sample !== "object" ) { return; }

    if( sample["Filename"] && sample["Color"] ) {
      // this is a colormap
      data.forEach(el => {
        if(!el) { return; }
        const color = el["Color"];
        if ( typeof color === "string" && color.length === 7 ) {
          const fname = normalizeImageName( el["Filename"] );
          ensureColorMap( fname ).single = color;
        }
      });
      updateColorMap( gui );
      return;
    } else if ( sample["Electrode"] ) {
      app.updateElectrodeData({ data : data });
    }
  }
}

function registerDragNDropFile( ViewerControlCenter ){
  ViewerControlCenter.prototype.addPreset_dragdrop = function(){
    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const fileNames = new Map();
    this.upLoadedFiles = fileNames;

    const dndctrl = this.gui.addController( "Dragdrop Uploader", () => {}, { folderName : folderName } );

    const folder = this.gui.getFolder( folderName );
    folder.domElement.classList.add("lil-gui-ensure-width");
    folder.open();

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
    $dragdropText.innerHTML = "Drag files here<br /><small>Volumes (nii[.gz], mgz), surfaces (fs, gii, stl), colormaps (csv, tsv)</small>";
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
      } else if (
        filenameLowerCase.endsWith("curv") ||
        filenameLowerCase.endsWith("sulc")
      ) {
        dataType = "surfaceColor";
      } else if (
        filenameLowerCase.endsWith("annot")
      ) {
        dataType = "surfaceAnnot";
      } else if (
        filenameLowerCase.endsWith("tt.gz") ||
        filenameLowerCase.endsWith("tt")
      ) {
        dataType = "fiberTract";
      }
      const normalizedFilename = normalizeImageName( fileName );

      if( !fileNames.has( normalizedFilename ) ) {
        fileNames.set( normalizedFilename , {} );
      }

      let postProcess;
      switch ( dataType ) {
        case 'volume':
          postProcess = (p) => {
            const data = postProcessVolume(p);
            this.updateDataCube2Types( normalizedFilename );
            const vDispCtrl = this.gui.getController("Voxel Display");
            vDispCtrl.setValue("normal");
            return data;
          };
          break;
        case 'surface':
          postProcess = postProcessSurface;
          break;
        case 'surfaceColor':
          postProcess = postProcessSurfaceColor;
          break;
        case 'surfaceAnnot':
          postProcess = ({ data } = {}) => {
            // get hemisphere and surface type (maybe)
            let hemi = ["Left", "Right"];
            if ( filenameLowerCase.startsWith("lh") ) {
              hemi = ["Left"];
            } else if ( fileName.startsWith("rh") ) {
              hemi = ["Right"];
            }

            // window.annot = data;

            // obtain the current subject
            const subjectCode = canvas.get_state("target_subject");

            // get the surface
            const surfaceList = canvas.surfaces.get( subjectCode );

            for(let h = 0; h < hemi.length; h++) {
              const surface = surfaceList[`FreeSurfer ${hemi[h]} Hemisphere - pial (${subjectCode})`];
              if( surface ) {
                const surfaceName = `${ hemi[h][0].toLowerCase() }h.pial`;
                const inst = surface.userData.instance;
                inst.setTrackColors({ colors : data.vertexColor, colorSize : 4, colorMax : 255 });
              }
            }
            canvas.needsUpdate = true;
            const sDispCtrl = gui.getController("Surface Color");
            sDispCtrl.setValue("vertices");
          };
          break;
        case 'fiberTract':
          postProcess = ({ data } = {}) => {
            window.fiber = data;
          };
          break;
        default:
          postProcess = postProcessText;
      }

      const data = await this.canvas.fileLoader.loadFromResponse( file );

      const inst = postProcess({
        data: data,
        fileName: normalizedFilename,
        folderName: folderName,
        app: this.app
      });

      if( inst && inst.isThreeBrainObject ) {
        const item = fileNames.get( normalizedFilename );
        item[ inst.type ] = inst;
      }
      return inst;
    };

    $dragdropWrapper.ondrop = async (ev) => {
      ev.preventDefault();
      resetStyle();

      const files = [];

      const queueFile = ( file ) => {
        if( file.name.match(/(json|csv|tsv|txt)$/gi) ) {
          files.push( file );
        } else {
          files.unshift( file );
        }
      };

      if (ev.dataTransfer.items) {
        // Use DataTransferItemList interface to access the file(s)
        [...ev.dataTransfer.items].forEach((item, i) => {
          // If dropped items aren't files, reject them
          if (item.kind === "file") {
            queueFile( item.getAsFile() );
          }
        });
      } else {
        // Use DataTransfer interface to access the file(s)
        [...ev.dataTransfer.files].forEach((file, i) => {
          queueFile( file );
        });
      }


      while( files.length > 0 ) {
        await processFile( files.pop() );
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

    this.gui.addController(
      "Clear Uploaded Surfaces",
      () => {
        fileNames.forEach( (item, fname) => {

          try {
            if( item.FreeMesh ) {
              item.FreeMesh.dispose();
              delete item.FreeMesh;
            }
          } catch (e) {
            console.warn(e);
          }

          try {
            const folder = this.gui.getFolder( `${surfaceFolderName} > ${fname}` );
            if( folder ) {
              folder.destroy();
            }
          } catch (e) {
            console.warn(e);
          }

        });

        this.canvas.needsUpdate = true;
      },
      { folderName : surfaceFolderName }
    );

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

    this.gui.addController(
      "Clear Uploaded Volumes",
      () => {
        fileNames.forEach( (item, fname) => {

          try {
            if( item.DataCube2 ) {
              item.DataCube2.dispose();
              delete item.DataCube2;
            }
          } catch (e) {
            console.warn(e);
          }

          try {
            const folder = this.gui.getFolder( `${volumeFolderName} > ${fname}` );
            if( folder ) {
              folder.destroy();
            }
          } catch (e) {
            console.warn(e);
          }

        });

        this.updateDataCube2Types();

        this.canvas.needsUpdate = true;
      },
      { folderName : volumeFolderName }
    );

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
