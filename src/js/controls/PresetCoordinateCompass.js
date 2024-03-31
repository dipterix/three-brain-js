import { CONSTANTS } from '../core/constants.js';

// 5. display axis anchor

function registerPresetCoordinateCompass( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_compass = function(){
    const folderName = CONSTANTS.FOLDERS[ 'toggle-helpper' ];
    this.gui.addController('Display Coordinates', true, { folderName : folderName })
      .onChange((v) => {

        if( v ) {
          this.canvas.compass.visible = true;
          this.canvas.compass.forceVisible = undefined;
          this.canvas.crosshairCompass.forceVisible = undefined;
        } else {
          this.canvas.compass.forceVisible = false;
          this.canvas.crosshairCompass.forceVisible = false;
        }


        this.canvas.needsUpdate = true;
        this.broadcast();
      });
  };

  return( ViewerControlCenter );

}

export { registerPresetCoordinateCompass };
