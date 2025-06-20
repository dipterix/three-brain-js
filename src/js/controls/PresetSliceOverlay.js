import { CONSTANTS } from '../core/constants.js';
import { Vector3, Matrix4 } from 'three';

// 6. toggle side panel
// 7. reset side panel position
// 8. coronal, axial, sagittal position (depth)
// 9. Electrode visibility in side canvas

function registerPresetSliceOverlay( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_enableSidePanel = function(){
    const folderName = CONSTANTS.FOLDERS[ 'toggle-side-panels' ];
    const initialDisplay = this.settings.side_display || false;

    const sidePanelCtrl = this.gui.addController(
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

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_SIDE_PANEL,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_SIDE_PANEL,
        name    : 'Show Panels',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const oldval = sidePanelCtrl.getValue();
        sidePanelCtrl.setValue( !oldval );
      }
    });

    this.gui.addController(
      'Slice Brightness', 0.0, { folderName: folderName })
      .min(-1).max(1).step(0.01)
      .onChange((v) => {
        this.canvas.set_state("sliceBrightness", v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      })

    this.gui.addController(
      'Slice Contrast', 0.0, { folderName: folderName })
      .min(-1).max(1).step(0.01)
      .onChange((v) => {
        this.canvas.set_state("sliceContrast", v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      })

    const sliceModeOptions = ["canonical", "line-of-sight", "snap-to-electrode", "column-row-slice"];

    const controllerSliceMode = this.gui
      .addController( 'Slice Mode', "canonical", {
        args: sliceModeOptions, folderName: folderName
      })
      .onChange((v) => {
        if( typeof v !== "string" ) { return; }

        let compassVisible = this.gui.getController( "Display Coordinates" ).getValue();

        switch ( v ) {
          case "line-of-sight":
            this.canvas.set_state("sideCameraTrackMainCamera", "line-of-sight");
            break;
          case "snap-to-electrode":
            this.canvas.set_state("sideCameraTrackMainCamera", "snap-to-electrode");
            break;
          case "active-voxel": // compatible
          case "column-row-slice":
            this.canvas.set_state("sideCameraTrackMainCamera", "column-row-slice");
            break;

          default:
            this.canvas.set_state("sideCameraTrackMainCamera", "canonical");
            compassVisible = false;
        }
        this.canvas.crosshairCompass.visible = compassVisible;
        this.canvas.needsUpdate = true;
        this.broadcast();
      })
      .setValue( "canonical" );

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


    this.gui.addController( 'Crosshair Gap', 0.0, { folderName: folderName })
      .min(0).max(50).step(1)
      .onChange(v => {
        if ( typeof v === "number" && v >= 0 && v < 100 ) {
          if( v >= 49 ) {
            v = 600;
          }
          this.canvas.setCrosshairGap( v );
          this.broadcast();
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
      this.broadcast();
    });

    const controllerAxial = this.gui
      .addController('Axial (I - S)', 0, { folderName : folderName })
      .min(-128).max(128).step(0.1).decimals( 1 ).onChange((v) => {
        // this.setSlice({ z : v });
        this.canvas.setSliceCrosshair({ z : v , centerCrosshair : true });
        this.broadcast();
      });

    const controllerSagittal = this.gui
      .addController('Sagittal (L - R)', 0, { folderName : folderName })
      .min(-128).max(128).step(0.1).decimals( 1 ).onChange((v) => {
        // this.setSlice({ x : v });
        this.canvas.setSliceCrosshair({ x : v , centerCrosshair : true });
        this.broadcast();
      });

    const tmpVec3 = new Vector3();
    const tmpMat4 = new Matrix4();

    const parseRASString = (v) => {
      const va = v.split(/[, ]+/g);
      if( va.length != 3 ) { return; }
      for(let i = 0; i < 3; i++) {
        const tmp = parseFloat(va[i]);
        if(isNaN(tmp)) { return; }
        va[i] = tmp;
      }
      return va;
    };

    this.gui
      .addController(
        'Crosshair ScanRAS', "0.00, 0.00, 0.00",
        {
          folderName: folderName,
          tooltip : "Scanner (T1 MRI) RAS coordinate"
        })
      .onChange(v => {

        const worldToScanner = this.canvas.get_state("tkrRAS_Scanner");
        if(!worldToScanner || !worldToScanner.isMatrix4) { return; }

        const va = parseRASString(v);
        if(!va) { return; }

        tmpMat4.copy(worldToScanner).invert();

        // set crosshair
        tmpVec3.fromArray(va).applyMatrix4( tmpMat4 );

        tmpVec3.centerCrosshair = true;
        this.canvas.setSliceCrosshair( tmpVec3 );
      });

    this.gui
      .addController(
        'Crosshair tkrRAS', "0.00, 0.00, 0.00",
        {
          folderName: folderName,
          tooltip : "FreeSurfer tk-registered surface RAS coordinate"
        })
      .onChange(v => {

        const va = parseRASString(v);
        if(!va) { return; }

        // set crosshair
        tmpVec3.fromArray(va);

        tmpVec3.centerCrosshair = true;
        this.canvas.setSliceCrosshair( tmpVec3 );
      });

    this.gui
      .addController(
        'Affine MNI152', "0.00, 0.00, 0.00",
        {
          folderName: folderName,
          tooltip : "MNI152 coordinate with affine transform (coarse estimate)"
        })
      .onChange(v => {

        const worldToMNI305 = this.canvas.get_state("tkrRAS_MNI305");
        if(!worldToMNI305 || !worldToMNI305.isMatrix4) { return; }

        const va = parseRASString(v);
        if(!va) { return; }

        const MNI152ToWorld = tmpMat4.copy(worldToMNI305)
          .premultiply( CONSTANTS.MNI305_to_MNI152 )
          .invert();

        // set crosshair
        tmpVec3.fromArray(va).applyMatrix4( MNI152ToWorld );

        tmpVec3.centerCrosshair = true;
        this.canvas.setSliceCrosshair( tmpVec3 );
      })


    const controllerOverlayCoronal = this.gui
      .addController('Overlay Coronal', false, { folderName : folderName })
      .onChange((v) => {
        this.showSlices( 'coronal', v );
        this.broadcast();
      });

    const controllerOverlayAxial = this.gui
      .addController('Overlay Axial', false, { folderName : folderName })
      .onChange((v) => {
        this.showSlices( 'axial', v );
        this.broadcast();
      });

    const controllerOverlaySagittal = this.gui
      .addController('Overlay Sagittal', false, { folderName : folderName })
      .onChange((v) => {
        this.showSlices( 'sagittal', v );
        this.broadcast();
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

    const renderDistances = {
      near: 1,
      far: 1
    };

    // show electrodes trimmed
    this.gui.addController('Frustum Near', 1, { folderName : folderName })
      .min(0.1).max(15).step(0.1)
      .onChange((v) => {
        if( typeof v !== 'number' ) { return; }
        if( v >= 15 ) {
          v = 250;
        } else if (v < 0.1) {
          v = 0.1;
        }
        renderDistances.near = v;
        this.canvas.setVoxelRenderDistance({
          distance : renderDistances
        });
        // type : "viewerApp.canvas.setVoxelRenderDistance",
        // this.canvas.sideCanvasList.coronal.renderThreshold = v;
        // this.canvas.sideCanvasList.axial.renderThreshold = v;
        // this.canvas.sideCanvasList.sagittal.renderThreshold = v;
        this.broadcast();
        this.canvas.needsUpdate = true;
      })
      .setValue( 1 );

    this.gui.addController('Frustum Far', 1, { folderName : folderName })
      .min(0.1).max(15).step(0.1)
      .onChange((v) => {
        if( typeof v !== 'number' ) { return; }
        if( v >= 15 ) {
          v = 250;
        } else if (v < 0.1) {
          v = 0.1;
        }
        renderDistances.far = v;
        this.canvas.setVoxelRenderDistance({
          distance : renderDistances
        });
        // type : "viewerApp.canvas.setVoxelRenderDistance",
        // this.canvas.sideCanvasList.coronal.renderThreshold = v;
        // this.canvas.sideCanvasList.axial.renderThreshold = v;
        // this.canvas.sideCanvasList.sagittal.renderThreshold = v;
        this.broadcast();
        this.canvas.needsUpdate = true;
      })
      .setValue( 1 );
  }

  return( ViewerControlCenter );

}

export { registerPresetSliceOverlay };
