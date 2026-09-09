import { CONSTANTS } from '../core/constants.js';
import { ColorMapKeywords } from '../core/CustomLut.js';

// 17. Voxel color type

function registerPresetTractography( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_tractography = function(){
    const folderName = CONSTANTS.FOLDERS['tractography'] || 'Tractography Settings';

    // Which cameras the streamlines render to. Kept in canvas state rather than
    // pushed onto instances, so bundles dropped after this changes pick up the
    // current choice as well.
    const displayLayers = {
      "all"         : CONSTANTS.LAYER_SYS_ALL_CAMERAS_7,
      "main camera" : CONSTANTS.LAYER_SYS_MAIN_CAMERA_8,
      "side panels" : CONSTANTS.LAYER_SYS_ALL_SIDE_CAMERAS_13,
    };

    this.gui.addController(
      "Streamline Display", "all",
      { args: Object.keys( displayLayers ), folderName: folderName })
      .onChange(v => {
        const layer = displayLayers[ v ] ?? CONSTANTS.LAYER_SYS_ALL_CAMERAS_7;
        this.canvas.set_state('streamline_display', layer);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    // The shader now compensates for camera zoom, so this is a direct on-screen
    // width across the whole range rather than an "auto when 0" toggle.
    const defaultLinewidth = CONSTANTS.GEOMETRY["streamline-linewidth-factor"];

    const ctrlLinewidth = this.gui
      .addController("Streamline Width", defaultLinewidth, {folderName: folderName})
      .min(0).max(1.5).step(0.01)
      .onChange(v => {
        if( typeof v !== "number" || v <= 0.0 ) {
          // 0 means "back to default", not "hide"; hiding is what the
          // `Show all (...)` / `Show:` checkboxes are for. Re-entry terminates
          // because the default clears this branch.
          ctrlLinewidth.setValue( defaultLinewidth );
          return;
        }
        this.canvas.set_state('streamline_linewidth', v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController("Streamline Opacity", 1.0, {folderName: folderName})
      .min(0).max(1)
      .onChange(v => {
        if( typeof v !== "number" || v > 1.0 ) {
          v = 1.0;
        } else if ( v < 0.0 ) {
          v = 0.0;
        }
        this.canvas.set_state('streamline_opacity', v);
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

    // Resolves once the distance tree is ready. Only 'active volume' needs one;
    // every other mode resolves immediately.
    const updateTargets = async () => {

      if( highlightStreamlineConfig.mode === 'active volume' ) {
        const datacube2Instance = this.canvas.get_state( "activeDataCube2Instance" );
        if( datacube2Instance ) {
          await datacube2Instance.updatedKDTree();
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
        this.canvas.set_state('streamline_highlight', highlightStreamlineConfig);
        this.broadcast();
        // the distance tree is built off the main thread, so refresh the
        // highlight once it exists rather than against a stale/absent one
        updateTargets().then(() => {
          this.canvas.setStreamlineHighlight();
          this.canvas.needsUpdate = true;
        });
      });

    const ctrlUpdateCache = this.gui
      .addController(
        "Update Distance Tree",
        () => {
          this.canvas.set_state('streamline_highlight', highlightStreamlineConfig);
          updateTargets().then(() => {
            this.canvas.setStreamlineHighlight({ forceUpdate : true });
            this.canvas.needsUpdate = true;
          });
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

    // ---- Baked-in streamlines ---------------------------------------------
    // Streamlines dropped onto the viewer get their own controllers from
    // `StreamlineHandler`, under "Custom Geometry Settings". Streamlines
    // declared from R are grouped by brain circuit and only expose visibility:
    // their colors are set in R, so no color pickers here.
    //
    // The circuit is the top-level folder under `fs/streamline`; a bundle name
    // carries whatever sub-folders it sits in (`stn/dlPFC_L`). Controllers are
    // named by the full `circuit/bundle` key rather than the bundle alone,
    // because `getController` falls back to a recursive search by name, so two
    // circuits owning a `dlPFC_L` would otherwise be indistinguishable to
    // `threejs_brain(controllers = ...)`.
    const streamlineCircuits = new Map();
    this.canvas.threebrain_instances.forEach(( inst ) => {
      if( !inst || !inst.isStreamline || !inst.object ) { return; }
      const params = inst._params;
      if( !params || !params.isStreamlineGeom ) { return; }

      const circuitName = params.streamline_group || "default";
      let circuit = streamlineCircuits.get( circuitName );
      if( !circuit ) {
        circuit = [];
        streamlineCircuits.set( circuitName, circuit );
      }
      circuit.push( inst );
    });

    streamlineCircuits.forEach(( instances, circuitName ) => {
      const circuitFolderName = `${ folderName } > ${ circuitName }`;
      const bundleControllers = [];

      // added first so it shows on top of the circuit folder
      const ctrlShowAll = this.gui.addController(
        `Show all (${ circuitName })`, true, { folderName : circuitFolderName } );

      instances.forEach(( inst ) => {
        const bundleName = inst._params.streamline_name;
        // matches `BrainStreamline$streamline_type` in R, i.e. the very key
        // `add_streamline()` was given
        const ctrl = this.gui
          .addController( `Show: ${ circuitName }/${ bundleName }`, true, { folderName : circuitFolderName } )
          .onChange(v => {
            inst.set_visibility( v ? true : false );
            this.broadcast();
            this.canvas.needsUpdate = true;
          });
        bundleControllers.push( ctrl );
      });

      ctrlShowAll.onChange(v => {
        const visible = v ? true : false;
        bundleControllers.forEach(( ctrl ) => { ctrl.setValue( visible ); });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    });

  };

  return( ViewerControlCenter );
}

export {registerPresetTractography};
