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

function processFormatedFile({ file, canvas, gui, cls, folderName, generator, useColor }) {
  const fileName = file.name;
  return file.arrayBuffer()
    .then((buffer) => {
      const image = new cls( buffer );
      image.fileName = fileName;
      const inst = generator( image, canvas );
      inst.forceVisible = true;
      if( inst.isFreeMesh ) {
        inst.object.material.vertexColors = false;
        inst.object.layers.enable( CONSTANTS.LAYER_USER_ALL_SIDE_CAMERAS_4 );
      }

      const innerFolderName = `${folderName} > ${ fileName }`;

      // Add visibility controler
      const visibilityName = `Visibility - ${ fileName }`;
      let ctrl = gui.getController( visibilityName, innerFolderName, true );
      if( ctrl.isfake ) {
        ctrl = gui.addController(
          visibilityName, "visible",
          {
            args: ["visible", "hidden"],
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
      })
      .setValue("visible");

      // color controller
      const colorName = `Color - ${ fileName }`;
      ctrl = gui.getController( colorName, innerFolderName, true );
      ctrl.destroy();
      if( useColor ) {
        let defaultColor = `#${ Math.floor(Math.random()*16777215).toString(16) }`;
        // guess color from file name
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
        gui.addController(
          colorName, "#FFFFFF",
          {
            isColor: true,
            folderName : innerFolderName
          }
        )
        .onChange((v) => {
          if(!v) { return; }
          if( inst.isFreeMesh ) {
            inst._materialColor.set( v );
            inst.object.material.vertexColors = false;
          }
          canvas.needsUpdate = true;
        })
        .setValue( defaultColor );
      }

      // transparency
      const opacityName = `Opacity - ${ fileName }`;
      ctrl = gui.getController( opacityName, innerFolderName, true );
      if( ctrl.isfake ) {
        ctrl = gui.addController(
          opacityName, 1,
          {
            folderName : innerFolderName
          }
        ).min(0).max(1);
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
      }).setValue(1);

      gui.openFolder(innerFolderName);
      canvas.needsUpdate = true;

      return {
        fileName: file.name,
        instance: inst
      };
    });
}

function registerDragNDropFile( ViewerControlCenter ){
  ViewerControlCenter.prototype.addPreset_dragdrop = function(){
    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];

    const dndctrl = this.gui.addController( "Dragdrop Uploader", () => {}, { folderName : folderName } );
    const $dragdropWrapper = document.createElement("div");
    $dragdropWrapper.style.width = "100%";
    $dragdropWrapper.style.height = "60px";
    $dragdropWrapper.style.border = "1px dashed var(--text-color)";
    $dragdropWrapper.style.borderRadius = "1em";
    $dragdropWrapper.style.display = "flex";
    $dragdropWrapper.style.display = "flex";
    $dragdropWrapper.style.alignItems = "center";
    $dragdropWrapper.style.justifyContent = "center";
    $dragdropWrapper.style.transition = "color 0.3s ease-in-out, background-color 0.3s ease-in-out";


    const $dragdropText = document.createElement("span");
    $dragdropText.style.lineHeight = "var(--widget-height)";
    $dragdropText.innerHTML = "Drag files here<br /><small>nii, mgz, surface</small>";
    $dragdropText.style.pointerEvent = "none";
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

    const fileNames = [];

    const processFile = (file) => {
      const fileName = file.name;
      const gui = this.gui;
      const canvas = this.canvas;
      const filenameLowerCase = fileName.toLowerCase();
      if( filenameLowerCase.endsWith("nii") || filenameLowerCase.endsWith("nii.gz") ) {
        return processFormatedFile({
          file      : file,
          canvas    : canvas,
          gui       : gui,
          cls       : NiftiImage,
          folderName: `${folderName} > Additional Volumes`,
          generator : gen_datacube2,
          useColor  : false
        });
      }
      if( filenameLowerCase.endsWith("mgz") || filenameLowerCase.endsWith("mgh") ) {
        return processFormatedFile({
          file      : file,
          canvas    : canvas,
          gui       : gui,
          cls       : MGHImage,
          folderName: `${folderName} > Additional Volumes`,
          generator : gen_datacube2,
          useColor  : false
        });
      }
      return processFormatedFile({
        file      : file,
        canvas    : canvas,
        gui       : gui,
        cls       : FreeSurferMesh,
        folderName: `${folderName} > Additional Surfaces`,
        generator : gen_free,
        useColor  : true
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
            processFile( file )
            .then( re => {
              if( re && typeof re === "object" && typeof re.fileName === "string" ) {
                fileNames.push( re.fileName );
              }
            });
          }
        });
      } else {
        // Use DataTransfer interface to access the file(s)
        [...ev.dataTransfer.files].forEach((file, i) => {
          processFile( file )
          .then( re => {
            if( re && typeof re === "object" && typeof re.fileName === "string" ) {
              fileNames.push( re.fileName );
            }
          });
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

        fileNames.forEach( fname => {
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
        fileNames.forEach( fname => {
          const ctrler = this.gui.getController( `Opacity - ${ fname }`, surfaceFolderName, true );
          ctrler.setValue( v );
        });
      });

  };

  return ViewerControlCenter;
}

export { registerDragNDropFile };
