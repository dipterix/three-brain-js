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

    this.gui.addController("Line MinLen", 0.0, {folderName: folderName})
      .min(0).max(500).step(1)
      .onChange(v => {
        if( typeof v !== "number" || v <= 0.0 ) {
          v = 0;
        }
        this.canvas.set_state('streamline_minlen', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController("Line MaxLen", 500, {folderName: folderName})
      .min(0).max(500).step(1)
      .onChange(v => {
        if( typeof v !== "number" || v <= 0.0 || v >= 500 ) {
          v = Infinity;
        }
        this.canvas.set_state('streamline_maxlen', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController("Line Retention", 0.0, {folderName: folderName})
      .min(0.0).max(1).step(0.01)
      .onChange(v => {
        if( typeof v !== "number" || v < 0.01 ) {
          v = 0.0;
        } else if ( v > 1.0 ) {
          v = 1.0;
        }
        this.canvas.set_state('streamline_retention', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    const highlightStreamlineConfig = {
      mode              : 'none',
      distanceToTargetsThreshold : 1,
      fadedLinewidth       : 0.01
    };
    this.canvas.set_state('streamline_highlight', highlightStreamlineConfig);

    const updateTargets = () => {

      if( highlightStreamlineConfig.mode === 'active volume' ) {
        const datacube2Instance = this.canvas.get_state( "activeDataCube2Instance" );
        if( datacube2Instance ) {
          datacube2Instance.updatedKDTree();
        }
      }

    }

    const ctrlLineSelector = this.gui
      .addController(
        "Line Selector", 'none',
        {
          args: ['none', 'crosshair', 'active volume', 'electrode'],
          folderName: folderName
        })
      .onChange(v => {
        if( typeof v !== 'string' ) { return; }
        highlightStreamlineConfig.mode = v;
        updateTargets();
        this.canvas.set_state('streamline_highlight', highlightStreamlineConfig);
        this.canvas.setStreamlineHighlight();
        this.canvas.needsUpdate = true;
        this.broadcast();
      });

    const ctrlUpdateCache = this.gui
      .addController(
        "Update Distance Tree",
        () => {
          updateTargets();
          this.canvas.set_state('streamline_highlight', highlightStreamlineConfig);
          this.canvas.setStreamlineHighlight({ forceUpdate : true });
          this.canvas.needsUpdate = true;
        }, {
          folderName: folderName
        }
      );

    this.gui.addController("Distance Threshold", 1, {folderName: folderName})
      .min(0.1).max(15).step(0.1)
      .onChange(v => {
        if( typeof v !== 'number' ) { return; }
        if( v <= 0.1 ) {
          v = 0.1;
        } else if( v >= 15 ) {
          v = Infinity;
        }
        highlightStreamlineConfig.distanceToTargetsThreshold = v;
        this.canvas.set_state('streamline_highlight', highlightStreamlineConfig);
        this.broadcast();
        // this.canvas.needsUpdate = true;
        this.canvas.setStreamlineHighlight();
      });


    this.gui.addController("Faded Linewidth", 1, {folderName: folderName})
      .min(0).max(1).step(0.1)
      .onChange(v => {
        if( typeof v !== 'number' ) { return; }
        if( v < 0.0 ) {
          v = 0.0;
        }
        highlightStreamlineConfig.fadedLinewidth = v * 0.01;
        this.canvas.set_state('streamline_highlight', highlightStreamlineConfig);
        this.broadcast();
        // this.canvas.needsUpdate = true;
        this.canvas.setStreamlineHighlight();
      });




  };

  return( ViewerControlCenter );
}

export {registerPresetTractography};
