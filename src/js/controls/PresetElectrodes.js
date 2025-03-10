import { is_electrode } from '../geometry/electrode.js';
import { to_array } from '../utils.js';
import { CONSTANTS } from '../core/constants.js';
import { set_visibility } from '../utils.js';

// 13. electrode visibility, highlight, groups
// 14. electrode mapping
// 16. Highlight selected electrodes and info

function registerPresetElectrodes( ViewerControlCenter ){

  ViewerControlCenter.prototype.updateElectrodeVisibility = function( visibleString ){
    if( typeof visibleString !== "string" ) {
      const controller = this.gui.getController( 'Visibility', CONSTANTS.FOLDERS[ 'electrode-style' ]);
      if( controller.isfake ) { return; }
      visibleString = controller.getValue();
    }

    this.enablePlayback( false );
    this.canvas.set_state('electrode_visibility', visibleString );

    // this.fire_change({ 'electrode_visibility' : visibleString });
    this.broadcast();
    this.canvas.needsUpdate = true;
    return(true);
  };

  ViewerControlCenter.prototype.updateElectrodeText = function(args){
    if(typeof args !== "object" || !args) { return; }

    let change_scale = false, scale = 0,
        change_visible = false, visible = false;

    if(typeof args.scale === "number" && args.scale > 0) {
      change_scale = true;
      scale = args.scale;
    }
    if( args.visible !== undefined ) {
      change_visible = true;
      visible = args.visible ? true: false;
    }

    if(!change_scale && !change_visible) { return; }

    // render electrode colors by subjects
    this.canvas.subject_codes.forEach((subject_code, ii) => {
      to_array( this.canvas.electrodes.get( subject_code ) ).forEach((e) => {
        if(e.isMesh && e.userData.instance && e.userData.instance.isElectrode ) {
          if( change_visible ) {
            e.userData.instance.setLabelVisible( visible );
          }
          if( change_scale ) {
            e.userData.instance.setLabelScale ( scale )
          }
        }
      });
    });

    const electrode_label = this.canvas.get_state('electrode_label', {});

    if( change_scale ) {
      electrode_label.scale = scale;
    }
    if( change_visible ) {
      electrode_label.visible = visible;
    }
    this.canvas.set_state('electrode_label', electrode_label);

    // this.fire_change({ 'electrode_label' : electrode_label });
    this.broadcast();
    this.canvas.needsUpdate = true;
    return(true);
  };

  ViewerControlCenter.prototype.addPreset_electrodes = function(){
    const folderName = CONSTANTS.FOLDERS[ 'electrode-style' ];
    const showInactives = this.settings.show_inactive_electrodes;
    const visibleChoices = ['all visible', 'threshold only', 'hide inactives', 'hidden'];
    const initialSelection = showInactives? 'all visible': 'hide inactives';

    const controllerElectrodeVisiblility = this.gui
      .addController( 'Visibility', initialSelection,
                      { args : visibleChoices, folderName : folderName } )
      .onChange(( v ) => {
        this.updateElectrodeVisibility( v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    controllerElectrodeVisiblility.setValue( initialSelection );
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ELEC_VISIBILITY,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_ELEC_VISIBILITY,
        name    : 'Visibility',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let selectedIndex = ( visibleChoices.indexOf( controllerElectrodeVisiblility.getValue() ) + 1) % visibleChoices.length;
        if( selectedIndex >= 0 ){
          controllerElectrodeVisiblility.setValue( visibleChoices[ selectedIndex ] );
        }
      }
    });

    const elecShapeOptions = ['prototype+sphere', 'prototype', 'contact-only'];
    const elecShapeCtrl =  this.gui
      .addController( 'Electrode Shape', initialSelection,
                      { args : elecShapeOptions, folderName : folderName } )
      .onChange(( v ) => {
        this.canvas.set_state( 'electrode_representation', v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      })
      .setValue( 'prototype+sphere' );
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ELEC_SHAPE,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_ELEC_SHAPE,
        name    : 'Electrode Shape',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let selectedIndex = ( elecShapeOptions.indexOf( elecShapeCtrl.getValue() ) + 1) % elecShapeOptions.length;
        if( selectedIndex >= 0 ){
          elecShapeCtrl.setValue( elecShapeOptions[ selectedIndex ] );
        }
      }
    });

    this.gui
      .addController( 'Prototype Cutoff', 0, { folderName : folderName } )
      .min(0).max(500).step(1)
      .onChange(( v ) => {
        this.canvas.set_state( 'electrode_prototype_length_cutoff', v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      })

    this.canvas.set_state("outline_state", "auto");
    const outlineOptions = ["auto", "on", "off"];
    const controllerElectrodeOutline = this.gui.addController( 'Outlines', "auto",
                      { args : outlineOptions, folderName : folderName } )
      .onChange(( v ) => {
        this.canvas.set_state("outline_state", v);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ELEC_OUTLINE,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_ELEC_OUTLINE,
        name    : 'Outlines',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const v = controllerElectrodeOutline.getValue();
        controllerElectrodeTextVisible.setValue( !v );
        let selectedIndex = ( outlineOptions.indexOf( controllerElectrodeOutline.getValue() ) + 1) % outlineOptions.length;
        if( selectedIndex >= 0 ){
          controllerElectrodeOutline.setValue( outlineOptions[ selectedIndex ] );
        }
      }
    });

    const translucentOptions = ["contact-only", "none", "contact+outline"];
    const controllerElectrodeTranslucent = this.gui.addController( 'Translucent', "contact+outline",
                      { args : translucentOptions, folderName : folderName } )
      .onChange(( v ) => {
        switch ( v ) {
          case "none":
            this.canvas.set_state("electrode_translucent", 0);
            break;
          case "contact+outline":
            this.canvas.set_state("electrode_translucent", 2);
            break;
          default:
            this.canvas.set_state("electrode_translucent", 1);
        }
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ELEC_TRANSLUCENT,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_ELEC_TRANSLUCENT,
        name    : 'Translucent',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let selectedIndex = ( translucentOptions.indexOf( controllerElectrodeTranslucent.getValue() ) + 1) % translucentOptions.length;
        if( selectedIndex >= 0 ){
          controllerElectrodeTranslucent.setValue( translucentOptions[ selectedIndex ] );
        }
      }
    });

    this.canvas.set_state('electrode_label', { scale : 2, visible : false });
    this.gui
      .addController('Text Scale', 1.5, { folderName : folderName })
      .min( 1 ).max( 6 ).decimals( 1 )
      .onChange((v) => {
        this.updateElectrodeText({ scale : v });
        this.broadcast();
      });

    const controllerElectrodeTextVisible = this.gui
      .addController('Text Visibility', false, { folderName : folderName })
      .onChange((v) => {
        this.updateElectrodeText({ visible : v });
        this.broadcast();
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_TOGGLE_ELEC_LABEL_VISIBILITY,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_TOGGLE_ELEC_LABEL_VISIBILITY,
        name    : 'Text Visibility',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const v = controllerElectrodeTextVisible.getValue();
        controllerElectrodeTextVisible.setValue( !v );
      }
    });

  };

  ViewerControlCenter.prototype.addPreset_map_template = function(){

    let surfaceTypeChoices = this.canvas.getAllSurfaceTypes().cortical;
    if( !Array.isArray( surfaceTypeChoices ) || surfaceTypeChoices.length === 0 ){
      surfaceTypeChoices = ["pial"];
    }
    surfaceTypeChoices = surfaceTypeChoices.filter(x => CONSTANTS.FREESURFER_SURFACE_TYPES.includes(x))
    surfaceTypeChoices.unshift("auto");

    const folderName = CONSTANTS.FOLDERS[ 'electrode-mapping' ];
    const controllerMapElectrodes = this.gui
      .addController('Map Electrodes', false, { folderName : folderName })
      .onChange((v) => {
        this.canvas.switch_subject( '/', { 'map_template': v });
        if( v ){
          this.gui.showControllers( [
            'Surface Mapping' , 'Volume Mapping',
            'Target Surface', 'Projection Threshold'
          ] , folderName );
        } else {
          this.gui.hideControllers( [
            'Surface Mapping' , 'Volume Mapping',
            'Target Surface', 'Projection Threshold'
          ], folderName );
        }
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController('Surface Mapping', 'sphere.reg',
                            { args : ['sphere.reg', 'mni305', 'mni305+shift', 'mni305.affine', 'no mapping'], folderName : folderName })
      .onChange((v) => {
        this.canvas.switch_subject( '/', { 'map_type_surface': v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController('Volume Mapping', 'mni305',
                            { args : ['mni305', 'mni305.affine+fix.target', 'mni305.affine', 'sphere.reg', 'no mapping'], folderName : folderName })
      .onChange((v) => {
        this.canvas.switch_subject( '/', { 'map_type_volume': v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController('Projection Threshold', 30, { folderName : folderName })
      .min(0).max(30).step(0.1)
      .onChange((v) => {
        this.canvas.set_state( 'electrodeProjectionThreshold' , v );
        this.canvas.switch_subject( '/' );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.canvas.set_state( 'electrodeProjectionThreshold' , 30 );

    this.gui.addController('Target Surface', 'auto',
                            { args : surfaceTypeChoices, folderName : folderName })
      .onChange((v) => {
        this.canvas.set_state( 'map_surface_target' , v );
        this.canvas.switch_subject( '/' );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    // hide mapping options
    this.gui.hideControllers( [ 'Surface Mapping', 'Volume Mapping', 'Target Surface', 'Projection Threshold' ] , folderName );

    // need to check if this is multiple subject case
    if( this.canvas.shared_data.get( ".multiple_subjects" ) ){
      // Do mapping by default
      controllerMapElectrodes.setValue( true );
      // and open gui
      // this.gui.openFolder( folderName );
    }

  };

  ViewerControlCenter.prototype.addPreset_display_highlights = function(){
    const folderName = CONSTANTS.FOLDERS['highlight-selection'] || 'Data Visualization';

    this.gui.addController('Highlight Box', true, { folderName : folderName })
      .onChange((v) => {
        this.canvas.set_state( 'highlight_disabled', !v );
        this.canvas.focusObject( this.canvas.object_chosen );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui.addController('Info Text', true, { folderName : folderName })
      .onChange((v) => {
        this.canvas.set_state( 'info_text_disabled', !v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
  };

  return( ViewerControlCenter );

}

export { registerPresetElectrodes };
