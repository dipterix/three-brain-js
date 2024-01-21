import { CONSTANTS } from '../core/constants.js';
import { Vector3 } from 'three';

// 6. toggle side panel
// 7. reset side panel position
// 8. coronal, axial, sagittal position (depth)
// 9. Electrode visibility in side canvas

function registerPresetSliceOverlay( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_enableSidePanel = function(){
    const folderName = CONSTANTS.FOLDERS[ 'toggle-side-panels' ];
    const initialDisplay = this.settings.side_display || false;

    this.gui.addController(
      'Show Panels', true, { folderName: folderName })
      .onChange((v) => {
        if( v ){
          this.canvas.enableSideCanvas();
        }else{
          this.canvas.disableSideCanvas();
        }
        // this.fire_change({ 'side_display' : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      })
      .setValue( initialDisplay );

    this.gui.addController(
      'Slice Brightness', 0.0, { folderName: folderName })
      .min(-1).max(1).step(0.01)
      .onChange((v) => {
        this.canvas.set_state("sliceIntensityBias", v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      })

    const sliceModeOptions = ["canonical", "line-of-sight"];
    let defaultVal = "canonical";
    if( this.canvas.get_state("sideCameraTrackMainCamera", false) ) {
      defaultVal = "line-of-sight";
    }

    const controllerSliceMode = this.gui
      .addController( 'Slice Mode', "canonical", {
        args: sliceModeOptions, folderName: folderName
      })
      .onChange((v) => {
        if( v === "line-of-sight" ){
          this.canvas.set_state("sideCameraTrackMainCamera", true);
        }else{
          this.canvas.set_state("sideCameraTrackMainCamera", false);
        }
        this.canvas.needsUpdate = true;
        this.broadcast();
      })
      .setValue( defaultVal );

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_SLICE_MODE,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_SLICE_MODE,
        name    : 'Slice Mode',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let selectedIndex = ( sliceModeOptions.indexOf( controllerSliceMode.getValue() ) + 1) % sliceModeOptions.length;
        if( selectedIndex >= 0 ){
          controllerSliceMode.setValue( sliceModeOptions[ selectedIndex ] );
        }
      }
    });
  };

  ViewerControlCenter.prototype.addPreset_resetSidePanel = function(){
    const folderName = CONSTANTS.FOLDERS[ 'reset-side-panels' ],
          sideCameraZoom = this.settings.side_canvas_zoom,
          sidePanelWidth = this.settings.side_canvas_width,
          sidePanelOffset = this.settings.side_canvas_shift;
    this.canvas._sideCanvasCSSWidth = sidePanelWidth;
    const resetSidePanels = () => {
      this.canvas.resetSideCanvas( sideCameraZoom, sidePanelWidth, sidePanelOffset );
    };
    const resetController = this.gui.addController(
      'Reset Slice Canvas', resetSidePanels, { folderName: folderName });

    // reset first
    resetSidePanels();
  }

  ViewerControlCenter.prototype.showSlices = function( slices, show = true ) {
    const activeSlice = this.canvas.get_state( "activeSliceInstance" );
    if( !activeSlice || !activeSlice.isDataCube ) { return; }
    if( show ) {
      activeSlice.showSlices( slices );
    } else {
      activeSlice.hideSlices( slices );
    }
  }
  ViewerControlCenter.prototype.addPreset_sideSlices = function(){
    const folderName = CONSTANTS.FOLDERS[ 'side-three-planes' ];

    // TODO set initial value
    const controllerCoronal = this.gui.addController(
      'Coronal (P - A)', 0, { folderName : folderName }
    ).min(-128).max(128).step(0.1).decimals( 1 ).onChange((v) => {
      this.canvas.setSliceCrosshair({ y : v , centerCrosshair : true });
    });

    const controllerAxial = this.gui
      .addController('Axial (I - S)', 0, { folderName : folderName })
      .min(-128).max(128).step(0.1).decimals( 1 ).onChange((v) => {
        // this.setSlice({ z : v });
        this.canvas.setSliceCrosshair({ z : v , centerCrosshair : true });
      });

    const controllerSagittal = this.gui
      .addController('Sagittal (L - R)', 0, { folderName : folderName })
      .min(-128).max(128).step(0.1).decimals( 1 ).onChange((v) => {
        // this.setSlice({ x : v });
        this.canvas.setSliceCrosshair({ x : v , centerCrosshair : true });
      });

    const controllerCrosshair = this.gui
      .addController( 'Intersect MNI305', "0.00, 0.00, 0.00", { folderName: folderName } )


    const controllerOverlayCoronal = this.gui
      .addController('Overlay Coronal', false, { folderName : folderName })
      .onChange((v) => {
        this.showSlices( 'coronal', v );
      });

    const controllerOverlayAxial = this.gui
      .addController('Overlay Axial', false, { folderName : folderName })
      .onChange((v) => {
        this.showSlices( 'axial', v );
      });

    const controllerOverlaySagittal = this.gui
      .addController('Overlay Sagittal', false, { folderName : folderName })
      .onChange((v) => {
        this.showSlices( 'sagittal', v );
      });

    // register keyboard shortcuts

    // Coronal
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_OVERLAY_CORONAL,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_OVERLAY_CORONAL,
        name    : 'Overlay Coronal',
        folderName : folderName,
      },
      callback  : () => {
        const _v = controllerOverlayCoronal.getValue();
        controllerOverlayCoronal.setValue( !_v );
      }
    });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_MOVE_CORONAL,
      // shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_MOVE_CORONAL,
        name    : 'Coronal (P - A)',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const _v = controllerCoronal.getValue();
        if( event.shiftKey ){
          controllerCoronal.setValue( _v - 1 );
        } else {
          controllerCoronal.setValue( _v + 1 );
        }
      }
    });

    // Axial
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_OVERLAY_AXIAL,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_OVERLAY_AXIAL,
        name    : 'Overlay Axial',
        folderName : folderName,
      },
      callback  : () => {
        const _v = controllerOverlayAxial.getValue();
        controllerOverlayAxial.setValue( !_v );
      }
    });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_MOVE_AXIAL,
      // shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_MOVE_AXIAL,
        name    : 'Axial (I - S)',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const _v = controllerAxial.getValue();
        if( event.shiftKey ){
          controllerAxial.setValue( _v - 1 );
        } else {
          controllerAxial.setValue( _v + 1 );
        }
      }
    });

    // Sagittal
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_OVERLAY_SAGITTAL,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_OVERLAY_SAGITTAL,
        name    : 'Overlay Sagittal',
        folderName : folderName,
      },
      callback  : () => {
        const _v = controllerOverlaySagittal.getValue();
        controllerOverlaySagittal.setValue( !_v );
      }
    });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_MOVE_SAGITTAL,
      // shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_MOVE_SAGITTAL,
        name    : 'Sagittal (L - R)',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const _v = controllerSagittal.getValue();
        if( event.shiftKey ){
          controllerSagittal.setValue( _v - 1 );
        } else {
          controllerSagittal.setValue( _v + 1 );
        }
      }
    });

  }

  ViewerControlCenter.prototype.addPreset_sideViewElectrodeThreshold = function(){
    const folderName = CONSTANTS.FOLDERS[ 'side-electrode-dist' ];
    // show electrodes trimmed
    this.gui.addController('Render Distance', 0.4, { folderName : folderName })
      .min(0.1).max(222).step(0.1)
      .onChange((v) => {
        this.canvas.setVoxelRenderDistance({
          distance : v
        });
        // type : "viewerApp.canvas.setVoxelRenderDistance",
        // this.canvas.sideCanvasList.coronal.renderThreshold = v;
        // this.canvas.sideCanvasList.axial.renderThreshold = v;
        // this.canvas.sideCanvasList.sagittal.renderThreshold = v;
        this.broadcast();
        this.canvas.needsUpdate = true;
      })
      .setValue( 0.4 );
  }

  return( ViewerControlCenter );

}

export { registerPresetSliceOverlay };
