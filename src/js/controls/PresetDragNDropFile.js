import { is_electrode } from '../geometry/electrode.js';
import { to_array } from '../utils.js';
import { CONSTANTS } from '../core/constants.js';
import { set_visibility } from '../utils.js';
import { NiftiImage } from '../formats/NIfTIImage.js';
import { MGHImage } from '../formats/MGHImage.js';
import { FreeSurferMesh } from '../formats/FreeSurferMesh.js';
import { gen_datacube2 } from '../geometry/datacube2.js';
import { gen_free } from '../geometry/free.js';

// 13. electrode visibility, highlight, groups
// 14. electrode mapping
// 16. Highlight selected electrodes and info

const colorMap = {};

function normalizeImageName( fileName ) {
  return fileName.toLowerCase().replaceAll(/\.(nii|nii\.gz|mgz|mgh)$/g, "");
}

async function updateColorMap( gui ) {
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

function addColorController({ inst, canvas, gui, fileName, parentFolder }) {
  const innerFolderName = `${parentFolder} > ${fileName}`
  const colorName = `Color - ${ fileName }`;

  let ctrl = gui.getController( colorName, innerFolderName, true );
  let defaultColor = colorMap[ fileName ];

  if( ctrl.isfake ) {
    if( fileName.length > 7 && fileName[fileName.length - 7] === "." ) {
      let tmp = "";
      for(let j = fileName.length - 6; j < fileName.length; j++ ) {
        const c = fileName[ j ].toLowerCase();
        if( "0123456789abcdef".includes(c) ) {
          tmp += c;
        } else {
          break;
        }
      }
      if(tmp.length === 6) {
        defaultColor = `#${tmp}`;
      }
    }
    ctrl = gui.addController(
      colorName, "#FFFFFF",
      {
        isColor: true,
        folderName : innerFolderName
      }
    );
  } else {
    defaultColor = ctrl.getValue();
  }

  if( typeof defaultColor !== "string" || defaultColor.length !== 7 ) {
    defaultColor = Math.floor(Math.random()*16777215).toString(16);
    defaultColor = `#${ "0".repeat( 6 - defaultColor.length ) }${ defaultColor }`;
  }
  ctrl.onChange((v) => {
    if(!v) { return; }
    if( inst.isFreeMesh ) {
      inst._materialColor.set( v );
      inst.object.material.vertexColors = false;
    }
    canvas.needsUpdate = true;
  })
  .setValue( defaultColor );

}

function postProcessVolume( data, fileName, gui, folderName, canvas ) {
  data.fileName = fileName;
  const inst = gen_datacube2( data, canvas );
  inst.forceVisible = true;
  const innerFolderName = `${folderName} > Additional Volumes > ${ fileName }`;

  // Add visibility controler
  addVisibilityController({
    inst              : inst,
    canvas            : canvas,
    gui               : gui,
    fileName          : fileName,
    innerFolderName   : innerFolderName
  });

  // transparency
  addOpacityController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder
  });

  canvas.needsUpdate = true;
}

function postProcessSurface( data, fileName, gui, folderName, canvas ) {
  data.fileName = fileName;
  const inst = gen_free( data, canvas );
  inst.forceVisible = true;
  inst.object.layers.enable( CONSTANTS.LAYER_USER_ALL_SIDE_CAMERAS_4 );
  const parentFolder = `${folderName} > Additional Surfaces`;
  const innerFolderName = `${folderName} > Additional Surfaces > ${ fileName }`;

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

  // Color
  addColorController({
    inst        : inst,
    canvas      : canvas,
    gui         : gui,
    fileName    : fileName,
    parentFolder: parentFolder
  });

  canvas.needsUpdate = true;
}

function postProcessText( data, fileName, gui, folderName, canvas ) {
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
      window.ffff = file;
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
          postProcess = postProcessVolume;
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
      postProcess( data, normalizedFilename, gui, folderName, canvas );
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

    const surfaceFolderName = `${folderName} > Additional Surfaces`;
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

  };

  return ViewerControlCenter;
}

export { registerDragNDropFile };
