import { CONSTANTS } from '../core/constants.js';
import { ColorMapKeywords } from '../jsm/math/Lut2.js';

// 17. Voxel color type

function registerPresetTractography( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_tractography = function(){
    const folderName = CONSTANTS.FOLDERS['tractography'] || 'Tractography Settings';

    this.gui.addController("Streamline Width", 0.0, {folderName: folderName})
      .min(0).max(1.5)
      .onChange(v => {
        if( typeof v !== "number" || v <= 0.0 ) {
          v = 0.0;
        }
        this.canvas.set_state('streamline_linewidth', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController("Streamline MinLen", 0.0, {folderName: folderName})
      .min(0).max(500).step(1)
      .onChange(v => {
        if( typeof v !== "number" || v <= 0.0 ) {
          v = 0;
        }
        this.canvas.set_state('streamline_minlen', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController("Streamline MaxLen", 500, {folderName: folderName})
      .min(0).max(500).step(1)
      .onChange(v => {
        if( typeof v !== "number" || v <= 0.0 || v >= 500 ) {
          v = Infinity;
        }
        this.canvas.set_state('streamline_maxlen', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController("Streamline Retention", 1.0, {folderName: folderName})
      .min(0.05).max(1).step(0.01)
      .onChange(v => {
        if( typeof v !== "number" || v >= 1 ) {
          v = 1.0;
        } else if ( v < 0.05 ) {
          v = 0.05;
        }
        this.canvas.set_state('streamline_retention', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });


  };

  return( ViewerControlCenter );
}

export {registerPresetTractography};
