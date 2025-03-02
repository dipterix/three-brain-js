import { CONSTANTS } from '../core/constants.js';

// 13. electrode visibility, highlight, groups
// 14. electrode mapping
// 16. Highlight selected electrodes and info

const clearAllVolumeEvent = { type : "viewerApp.dragdrop.clearAllVolumes" };
const clearAllSurfaceEvent = { type : "viewerApp.dragdrop.clearAllSurfaces" };

function registerDragNDropFile( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_dragdrop = function(){
    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
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

    $dragdropWrapper.ondrop = async (ev) => {
      ev.preventDefault();
      resetStyle();

      const files = [];

      const queueFile = ( item ) => {
        // default is [...ev.dataTransfer.files].forEach( ... );
        let file = item;
        if ( item.kind === "file" ) {
          // item is not file, and needs to unwrap
          // [...ev.dataTransfer.items].forEach(...)
          file = item.getAsFile();
        }
        if( file.name.match(/(json|csv|tsv|txt)$/gi) ) {
          files.push( file );
        } else {
          files.unshift( file );
        }
      };

      [...( ev.dataTransfer.items || ev.dataTransfer.files)].forEach( queueFile );

      while( files.length > 0 ) {
        const file = files.pop();
        const data = await this.canvas.fileLoader.loadFromResponse( file );
        await this.app.handleFileData ( data, file.name, {} );
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
        this.dispatchEvent( clearAllSurfaceEvent );
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
        this.dispatchEvent({
          type  : "viewerApp.dragdrop.setVisibleAllSurfaces",
          value : v
        });
      });

    this.gui
      .addController(
        "Opacity (all surfaces)",
        1, { folderName : surfaceFolderName } )
      .min(0).max(1)
      .onChange(v => {
        if( !v ) { v = 0; }
        this.dispatchEvent({
          type  : "viewerApp.dragdrop.setOpacityAllSurfaces",
          value : v
        });
      });


    const volumeFolderName = `${folderName} > Configure ROI Volumes`;

    this.gui.addController(
      "Clear Uploaded Volumes",
      () => {
        this.dispatchEvent( clearAllVolumeEvent );
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
        this.dispatchEvent({
          type  : "viewerApp.dragdrop.setVisibleAllVolumes",
          value : v
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

        this.dispatchEvent({
          type  : "viewerApp.dragdrop.setOpacityAllVolumes",
          value : v
        });
      });

  };

  return ViewerControlCenter;
}

export { registerDragNDropFile };
