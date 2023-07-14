import { Vector3 } from 'three';
import { CONSTANTS } from '../core/constants.js';

// 3. Reset Camera
// 4. Camera Position

function registerPresetMainCamera( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_resetCamera = function(){
    const folderName = CONSTANTS.FOLDERS[ 'reset-main-camera' ];
    this.gui.addController( 'Reset Canvas', () => {
      this.canvas.resetCanvas();
    }, { folderName: folderName });

  };

  ViewerControlCenter.prototype.addPreset_copyViewerState = function(){
    const folderName = CONSTANTS.FOLDERS[ 'copy-viewer-state' ];
    this.gui.addController("Copy Controller State", () => {
      this.getControllerData({ saveToClipboard : true });
    }, { folderName: folderName });

    let stateText = "";

    const ctrlApplyState = this.gui.addController("Paste to Set State", "", { folderName: folderName })
      .onChange((v) => {
        const currentText = v.trim();
        stateText = currentText;

        if( stateText !== "" ) {
          setTimeout(() => {
            if( stateText === "" || stateText !== currentText ) { return; }
            try {
              const data = JSON.parse( stateText );
              if( typeof data === "object" && data !== null && data.isThreeBrainControllerData ) {
                const controllerData = data.controllerData;
                if( controllerData && typeof controllerData === "object") {
                  this.gui.load( controllerData );
                }
              }
              ctrlApplyState.setValue("");
            } catch (e) {}
          }, 500);
        }
      });

  }

  ViewerControlCenter.prototype.initializeCameraPosition = function(){
    if( this.canvas.mainCamera.needsReset ){
      /**
       * initialize camera position. This requires `.mainCamera.needsReset` from Canvas
       * If .mainCamera.needsReset=false, this means we are in shiny_mode and the widget
       * has already been loaded once
       */
      const cameraPosition = new Vector3().fromArray(
        this.settings.camera_pos
      );
      cameraPosition.forceZUp = true;
      this.canvas.mainCamera.setPosition( cameraPosition );
      this._update_canvas();
    }
  }

  ViewerControlCenter.prototype.addPreset_setCameraPosition2 = function(){
    const folderName = CONSTANTS.FOLDERS[ 'main-camera-position' ];
    const controller = this.gui.addController('Camera Position', '[free rotate]', {
      args : ['[free rotate]', '[lock]', 'right', 'left', 'anterior', 'posterior', 'superior', 'inferior'],
      folderName : folderName
    }).onChange((v) => {

      if( v === '[free rotate]' ) {
        this.canvas.trackball.enabled = true;
        return;
      }
      if( v === '[lock]' ){
        this.canvas.trackball.enabled = false;
        return;
      }
      this.canvas.trackball.enabled = true;
      this.canvas.mainCamera.setPosition2( v );
      controller.object["Camera Position"] = '[free rotate]';
      controller.updateDisplay()

      this._update_canvas();
    });

    this.initializeCameraPosition();

  }


  return( ViewerControlCenter );
}

export { registerPresetMainCamera };
