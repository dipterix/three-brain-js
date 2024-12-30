import { Vector3 } from 'three';
import { CONSTANTS } from '../core/constants.js';
import { getThreeBrainInstance } from '../geometry/abstract.js';

const CanvasState = CONSTANTS.CANVAS_RENDER_STATE;

function registerPresetHiddenFeatures( ViewerControlCenter ){


  ViewerControlCenter.prototype.addPreset_hiddenFeatures = function() {

    const folderName = CONSTANTS.FOLDERS[ 'hidden-features' ];

    const ctrlMorphTarget = this.gui
      .addController('Underlay Threshold', 0.5,
                      { folderName : folderName },
                      {
                        // tooltip
                        text : "Credit: this feature was requested by Dr. Yvonne Y. Chen."
                      })
      .min( 0.0 ).max( 1.0 ).step( 0.01 )
      .onChange((v) => {

      // find surfaces
      const pialSurfaces = this.canvas.getSurfaces(null, "pial");

      v = (0.7 * v + 0.3) * 255;

      const g = 76; // 255 * 0.3

      for(let hemi in pialSurfaces) {
        const geometry = pialSurfaces[ hemi ].geometry;
        const primaryColor = geometry.getAttribute("color"),
              underlayColor = geometry.getAttribute("underlayColor");
        const primaryArray = primaryColor.array,
              underlayArray = underlayColor.array;

        for(let i = 0; i < underlayColor.count; i++) {
          const c = underlayArray[ i * 3 ];
          if( c < v ) {
            primaryArray[ i * 4 ] = g;
            primaryArray[ i * 4 + 1 ] = g;
            primaryArray[ i * 4 + 2 ] = g;
          } else {
            primaryArray[ i * 4 ] = c;
            primaryArray[ i * 4 + 1 ] = c;
            primaryArray[ i * 4 + 2 ] = c;
          }
        }

        primaryColor.needsUpdate = true;
      }

      this.broadcast();
      this.canvas.needsUpdate = true;
    }).setValue( 0.5 );










    this.gui.openFolder( folderName );

  };


  return( ViewerControlCenter );
}

export { registerPresetHiddenFeatures };
