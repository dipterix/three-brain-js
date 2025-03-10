import { CONSTANTS } from '../core/constants.js';
import { getThreeBrainInstance } from '../geometry/abstract.js';

// 11. surface type
// 12. Hemisphere material/transparency
// surface color

function registerPresetSurface( ViewerControlCenter ){


  ViewerControlCenter.prototype.addPreset_surface_type2 = function(){

    const folderName = CONSTANTS.FOLDERS[ 'surface-selector' ],
          initialSurfaceType = this.canvas.get_state( 'surface_type' ) || 'pial',
          surfaceTypeChoices = this.canvas.getAllSurfaceTypes().cortical,
          initialMaterialType = this.canvas.get_state( 'surface_material_type' ) || 'MeshPhysicalMaterial',
          materialChoices = ['MeshPhysicalMaterial', 'MeshLambertMaterial'],
          corticalDisplay = ['normal', 'mesh clipping x 0.3', 'mesh clipping x 0.1', 'wireframe', 'hidden'];

    if( !Array.isArray( surfaceTypeChoices ) || surfaceTypeChoices.length === 0 ){ return; }

    const controllerSurfaceMaterial = this.gui
      .addController('Surface Material', "", {
                      args : materialChoices, folderName : folderName })
      .onChange((v) => {
        this.canvas.set_state( 'surface_material_type', v );
        // this.fire_change({ 'surface_material' : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    controllerSurfaceMaterial.setValue( initialMaterialType );
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_MATERIAL,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_MATERIAL,
        name    : 'Surface Material',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const selectedType = controllerSurfaceMaterial.getValue();
        let selectedIndex = ( materialChoices.indexOf( selectedType ) + 1 );
        selectedIndex = selectedIndex % materialChoices.length;
        if( selectedIndex >= 0 ){
          controllerSurfaceMaterial.setValue( materialChoices[ selectedIndex ] );
        }
      }
    });

    const controllerSurfaceType = this.gui
      .addController( 'Surface Type' , "" ,
                      {args : surfaceTypeChoices, folderName : folderName })
      .onChange((v) => {
        this.canvas.switch_subject( '/', { 'surface_type': v });

        // check if morph is feasible
        const subjectCode = this.canvas.get_state("target_subject");
        let surfaceUseMorph = false;

        let pialSurfaceSummary, targetSurfaceSummary;

        try {
          const morphDuration = 2;
          pialSurfaceSummary = this.canvas.getSurfaceSummary( subjectCode, "pial" );
          targetSurfaceSummary = this.canvas.getSurfaceSummary( subjectCode, v );

          if(
            // summary exist
            pialSurfaceSummary && targetSurfaceSummary &&

            // morph is available!
            pialSurfaceSummary.left.nvertices === targetSurfaceSummary.left.nvertices &&
            pialSurfaceSummary.right.nvertices === targetSurfaceSummary.right.nvertices
          ) {
            const pialSurfaces = this.canvas.getSurfaces( subjectCode, "pial" );
            let targetSurfaces;
            if( v === "pial" || v === "pial.T1" ) {
              targetSurfaces = { "left" : null, "right" : null };
            } else {
              targetSurfaces = this.canvas.getSurfaces( subjectCode, v );
            }

            getThreeBrainInstance( pialSurfaces.left ).useMorphTarget( targetSurfaces.left, { duration : morphDuration } );
            getThreeBrainInstance( pialSurfaces.right ).useMorphTarget( targetSurfaces.right, { duration : morphDuration } );

            surfaceUseMorph = true;
          }
        } catch (e) {
          console.warn(e);
        }

        this.canvas.set_state("surfaceUseMorph", surfaceUseMorph);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    controllerSurfaceType.setValue( initialSurfaceType );
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_SURFACE,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_SURFACE,
        name    : 'Surface Type',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const selectedType = controllerSurfaceType.getValue();
        let selectedIndex = ( surfaceTypeChoices.indexOf( selectedType ) + 1 );
        selectedIndex = selectedIndex % surfaceTypeChoices.length;
        if( selectedIndex >= 0 ){
          controllerSurfaceType.setValue( surfaceTypeChoices[ selectedIndex ] );
        }
      }
    });



    const overlayChoices = ['disabled', 'axial', 'coronal', 'sagittal'];
    const controllerClippingPlane = this.gui
      .addController(
        'Clipping Plane', 'disabled',
        { args : overlayChoices, folderName : folderName }
      )
      .onChange((v) => {
        this.canvas.set_state( "surfaceClippingPlane", v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_CLIPPING_PLANE,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_CLIPPING_PLANE,
        name    : 'Clipping Plane',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let idx = overlayChoices.indexOf( controllerClippingPlane.getValue() ) + 1;
        if( idx >= overlayChoices.length ) {
          idx = 0;
        }
        controllerClippingPlane.setValue( overlayChoices[ idx ] );
      }
    });


    const ctrlLHStyle = this.gui
      .addController('Left Hemisphere', 'normal', { args : corticalDisplay , folderName : folderName })
      .onChange((v) => {
        // corticalDisplay = ['normal', 'mesh clipping x 0.3', 'mesh clipping x 0.1', 'wireframe', 'hidden'];
        if( !v ) { return; }
        switch (v) {
          case 'normal':
          case 'wireframe':
          case 'hidden':
            this.canvas.switch_subject( '/', { 'material_type_left': v });
            ctrlLHThre.setValue( 1.0 );
            break;
          case 'mesh clipping x 0.3':
            this.canvas.switch_subject( '/', { 'material_type_left': 'normal' });
            ctrlLHThre.setValue( 0.3 );
            break;
          case 'mesh clipping x 0.1':
            this.canvas.switch_subject( '/', { 'material_type_left': 'normal' });
            ctrlLHThre.setValue( 0.1 );
            break;
          default:
            return;
        }

        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_LEFT,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_LEFT,
        name    : 'Left Hemisphere',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let styleIndex = (corticalDisplay.indexOf( ctrlLHStyle.getValue() ) + 1) % corticalDisplay.length;
        if( styleIndex >= 0 ){
          ctrlLHStyle.setValue( corticalDisplay[ styleIndex ] );
        }
      }
    });

    const ctrlRHStyle = this.gui
      .addController('Right Hemisphere', 'normal', { args : corticalDisplay, folderName : folderName })
      .onChange((v) => {
        // corticalDisplay = ['normal', 'mesh clipping x 0.3', 'mesh clipping x 0.1', 'wireframe', 'hidden'];
        if( !v ) { return; }
        switch (v) {
          case 'normal':
          case 'wireframe':
          case 'hidden':
            this.canvas.switch_subject( '/', { 'material_type_right': v });
            ctrlRHThre.setValue( 1.0 );
            break;
          case 'mesh clipping x 0.3':
            this.canvas.switch_subject( '/', { 'material_type_right': 'normal' });
            ctrlRHThre.setValue( 0.3 );
            break;
          case 'mesh clipping x 0.1':
            this.canvas.switch_subject( '/', { 'material_type_right': 'normal' });
            ctrlRHThre.setValue( 0.1 );
            break;
          default:
            return;
        }
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_RIGHT,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_RIGHT,
        name    : 'Right Hemisphere',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let styleIndex = (corticalDisplay.indexOf( ctrlRHStyle.getValue() ) + 1) % corticalDisplay.length;
        if( styleIndex >= 0 ){
          ctrlRHStyle.setValue( corticalDisplay[ styleIndex ] );
        }
      }
    });

    const ctrlLHOpacity = this.gui
      .addController('Left Opacity', 1.0, { folderName : folderName })
      .min( 0.1 ).max( 1 ).decimals( 1 )
      .onChange((v) => {
        this.canvas.switch_subject( '/', { 'surface_opacity_left': v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_LEFT_OPACITY,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_LEFT_OPACITY,
        name    : 'Left Opacity',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let opacity = ctrlLHOpacity.getValue() - 0.3;
        if( opacity < 0 ){ opacity = 1; }
        ctrlLHOpacity.setValue( opacity );
      }
    });

    const ctrlRHOpacity = this.gui
      .addController('Right Opacity', 1.0, { folderName : folderName })
      .min( 0.1 ).max( 1 ).decimals( 1 )
      .onChange((v) => {
        this.canvas.switch_subject( '/', { 'surface_opacity_right': v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_RIGHT_OPACITY,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_RIGHT_OPACITY,
        name    : 'Right Opacity',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let opacity = ctrlRHOpacity.getValue() - 0.3;
        if( opacity < 0 ){ opacity = 1; }
        ctrlRHOpacity.setValue( opacity );
      }
    });

    const ctrlLHThre = this.gui
      .addController('Left Mesh Clipping', 1.0, { folderName : folderName })
      .min( 0.1 ).max( 1 ).decimals( 1 )
      .onChange((v) => {
        if( typeof v !== "number" ) {
          v = 1.0;
        }
        this.canvas.set_state( 'surface_mesh_clipping_left', v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_LEFT_MESH_CLIPPING,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_LEFT_MESH_CLIPPING,
        name    : 'Left Mesh Clipping',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let threshold = ctrlLHThre.getValue();
        if( threshold > 0.5 ) {
          threshold = 0.4;
        } else {
          threshold = threshold - 0.1;
          if( threshold < 0.05 ) {
            threshold = 1;
          }
        }
        ctrlLHThre.setValue( threshold );
      }
    });


    const ctrlRHThre = this.gui
      .addController('Right Mesh Clipping', 1.0, { folderName : folderName })
      .min( 0.1 ).max( 1 ).decimals( 1 )
      .onChange((v) => {
        if( typeof v !== "number" ) {
          v = 1.0;
        }
        this.canvas.set_state( 'surface_mesh_clipping_right', v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_RIGHT_MESH_CLIPPING,
      shiftKey  : true,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_RIGHT_MESH_CLIPPING,
        name    : 'Right Mesh Clipping',
        folderName : folderName,
      },
      callback  : ( event ) => {
        let threshold = ctrlRHThre.getValue();
        if( threshold > 0.5 ) {
          threshold = 0.4;
        } else {
          threshold = threshold - 0.1;
          if( threshold < 0.05 ) {
            threshold = 1;
          }
        }
        ctrlRHThre.setValue( threshold );
      }
    });

  };

  ViewerControlCenter.prototype.addPreset_surface_subcortical = function(){

    const folderName = CONSTANTS.FOLDERS[ 'surface-selector' ],
          surfaceTypeChoices = this.canvas.getAllSurfaceTypes().subcortical,
          subcorticalDisplay = ['none', 'both', 'left', "right"];

    if( !Array.isArray( surfaceTypeChoices ) || surfaceTypeChoices.length === 0 ){ return; }

    const controllerSubcorticalDisplay = this.gui
      .addController( 'Subcortical Surface' , "both" ,
                      {args : subcorticalDisplay, folderName : folderName })
      .onChange((v) => {
        this.canvas.set_state( "subcortical_display", v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.canvas.set_state( "subcortical_display", "both" );

    this.gui
      .addController('Sub-Left Opacity', 0.5, { folderName : folderName })
      .min( 0.1 ).max( 1 ).decimals( 1 )
      .onChange((v) => {
        this.canvas.set_state( "subcortical_opacity_left", v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.canvas.set_state( "subcortical_opacity_left", 0.5 );

    this.gui
      .addController('Sub-Right Opacity', 0.5, { folderName : folderName })
      .min( 0.1 ).max( 1 ).decimals( 1 )
      .onChange((v) => {
        this.canvas.set_state( "subcortical_opacity_right", v );
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.canvas.set_state( "subcortical_opacity_right", 0.5 );

  }

  ViewerControlCenter.prototype.addPreset_surface_color = function(){
    const folderName = CONSTANTS.FOLDERS[ 'surface-selector' ],
          maps = {
            'vertices' : CONSTANTS.VERTEX_COLOR,
            'sync from voxels' : CONSTANTS.VOXEL_COLOR,
            'sync from electrodes' : CONSTANTS.ELECTRODE_COLOR,
            'none' : CONSTANTS.DEFAULT_COLOR,
          },
          options = Object.keys( maps );

    const ctrlSurfaceColorType = this.gui
      .addController('Surface Color', "none", {args : options, folderName : folderName })
      .onChange((v) => {

        switch (v) {
          case "sync from voxels":
            this.gui.showControllers(['Sigma', 'Blend Factor'], folderName );
            this.gui.hideControllers(['Decay', 'Range Limit', 'Vertex Data'], folderName );
            break;

          case "sync from electrodes":
            this.gui.showControllers(['Decay', 'Range Limit', 'Blend Factor'], folderName );
            this.gui.hideControllers(['Sigma', 'Vertex Data'], folderName );
            break;

          case "vertices":
            this.gui.showControllers(['Blend Factor', 'Vertex Data'], folderName );
            this.gui.hideControllers(['Sigma', 'Decay', 'Range Limit'], folderName );
            break;

          default:
            // none
            v = "none";
            this.gui.hideControllers(['Blend Factor', 'Sigma', 'Decay', 'Range Limit', 'Vertex Data'], folderName );
        }

        this.canvas.set_state( "surface_color_type", v);
        // this.fire_change({ 'surface_color_type' : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      })
      .setValue( this.canvas.get_state("surface_color_type", 'vertices') );

    this.gui
      .addController( "Blend Factor", 1.0, { folderName : folderName } )
      .min( 0 ).max( 1 ).decimals( 2 )
      .onChange((v) => {
        if( typeof(v) != "number" ){
          v = 1;
        } else if( v < 0 ){
          v = 0;
        } else if (v > 1){
          v = 1;
        }
        // this.set_surface_ctype( true, { 'blend' : v } );
        this.canvas.set_state("surface_color_blend", v);
        this.canvas.needsUpdate = true;
      }).setValue( 1.0 );

    // ---------- for node-color -----------------------------------------------

    // get all possible annotations
    const _annotationCounts = { '[none]' : true };
    this.canvas.threebrain_instances.forEach(inst => {
      if(!inst || !inst.isFreeMesh) { return; }
      if(!Array.isArray(inst._annotationList)) { return; }
      inst._annotationList.forEach(nm => {
        _annotationCounts[ nm ] = true;
      });
    });
    const annotationList = Object.keys( _annotationCounts );
    annotationList.push("[custom measurement]");
    annotationList.push("[custom annotation]");

    const ctrlVertAnnot = this.gui
      .addController("Vertex Data", '[none]', {
        args: annotationList,
        folderName : folderName })
      .onChange((v) => {
        this.canvas.set_state("surfaceAnnotation", v);
        this.canvas.needsUpdate = true;
      });

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_SURFACE_COLOR,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_SURFACE_COLOR,
        name    : 'Vertex Data',
        folderName : folderName,
      },
      callback  : ( event ) => {
        // options
        let selectedIndex = (annotationList.indexOf( ctrlVertAnnot.getValue() ) + 1) % annotationList.length;
        if( selectedIndex >= 0 ){
          ctrlVertAnnot.setValue( annotationList[ selectedIndex ] );
        }
      }
    });

    // ---------- for voxel-color ----------------------------------------------

    const map_delta = this.gui
      .addController("Sigma", 1, { folderName : folderName }).min( 0 ).max( 10 )
      .onChange((v) => {
        if( v !== undefined ){
          if( v < 0 ){ v = 0; }
          // this.set_surface_ctype( true, { 'sigma' : v } );
          this.canvas.set_state("surface_color_sigma", v);
          this.canvas.needsUpdate = true;
        }
      }).setValue( 1 );

    // ---------- for electrode maps -------------------------------------------
    this.gui.addController("Decay", 0.6, { folderName : folderName })
      .min( 0.05 ).max( 1 ).step( 0.05 ).decimals( 2 )
      .onChange((v) => {
        if( v !== undefined ){
          if( v < 0.05 ){ v = 0.05; }
          // this.set_surface_ctype( true, { 'decay' : v } );
          this.canvas.set_state("surface_color_decay", v);
          this.canvas.needsUpdate = true;
        }
      }).setValue( 0.6 );

    this.gui.addController("Range Limit", 5.0, { folderName : folderName })
      .min( 1.0 ).max( 30.0 ).step( 1.0 ).decimals( 1 )
      .onChange((v) => {
        if( v !== undefined ){
          if( v < 1.0 ){ v = 1.0; }
          // this.set_surface_ctype( true, { 'radius' : v } );
          this.canvas.set_state("surface_color_radius", v);
          this.canvas.needsUpdate = true;
        }
      }).setValue( 5.0 );

    // 'elec_decay'        : { value : 2.0 },
    // 'blend_factor'      : { value : 0.4 }


    this.gui.hideControllers(['Sigma', 'Decay', 'Range Limit'], folderName);
  };

  return( ViewerControlCenter );

}

export { registerPresetSurface };
