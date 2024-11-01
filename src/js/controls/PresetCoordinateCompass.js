import { CONSTANTS } from '../core/constants.js';

// 5. display axis anchor

function registerPresetCoordinateCompass( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_compass = function(){
    const folderName = CONSTANTS.FOLDERS[ 'toggle-helpper' ];
    this.gui.addController('Display Coordinates', true, { folderName : folderName })
      .onChange((v) => {

        if( v ) {

          this.canvas.compass.visible = true;

          // compass object in side viewers
          const slideMode = this.gui.getController('Slice Mode').getValue();

          if( slideMode === "canonical" ) {
            this.canvas.crosshairCompass.visible = false;
          } else {
            this.canvas.crosshairCompass.visible = true;
          }

        } else {

          this.canvas.compass.visible = false;
          this.canvas.crosshairCompass.visible = false;

        }

        this.canvas.needsUpdate = true;
        this.broadcast();

      });
  };

  return( ViewerControlCenter );

}

export { registerPresetCoordinateCompass };
