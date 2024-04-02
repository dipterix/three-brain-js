import { CONSTANTS } from '../core/constants.js';


// 17. Voxel color type

function registerPresetRaymarchingVoxels( ViewerControlCenter ){

  ViewerControlCenter.prototype.getActiveDataCube2 = function(){
    const instance = this.canvas.get_state( "activeDataCube2Instance" );
    if( instance && instance.isDataCube2 ) { return instance; }
    return;
  };

  ViewerControlCenter.prototype.getActiveSlice = function(){
    const instance = this.canvas.get_state( "activeSliceInstance" );
    if( instance && instance.isDataCube ) { return instance; }
    return;
  };


  ViewerControlCenter.prototype.addPreset_voxel = function(){
    const folderName = CONSTANTS.FOLDERS['atlas'] || 'Volume Settings';
          // _atype = this.canvas.get_state( 'atlas_type' ) || 'none';  //_s
    // Add controllers for continuous lut
    let voxelLB = -100000, voxelUB = 100000;
    const applyContinuousSelection = () => {
      const dataCubeInstance = this.getActiveDataCube2();
      if( !dataCubeInstance ) { return; }
      const lut = dataCubeInstance.lut;
      if( !lut || lut.mapDataType !== "continuous" ) { return; }
      dataCubeInstance._filterDataContinuous( voxelLB, voxelUB );
      this.canvas.set_state( "surface_color_refresh", Date() );
      this.canvas.needsUpdate = true;
    }

    // Add controllers for discrete lut
    let selectedLabels = [];
    const applyDiscreteSelection = () => {
      const dataCubeInstance = this.getActiveDataCube2();
      if( !dataCubeInstance ) { return; }
      const lut = dataCubeInstance.lut;
      if( !lut || lut.mapDataType !== "discrete" ) { return; }
      dataCubeInstance._filterDataDiscrete( selectedLabels );
      this.canvas.set_state( "surface_color_refresh", Date() );
      this.canvas.needsUpdate = true;
    }

    this._onDataCube2TypeChanged = async (v) => {
      this.canvas.switch_subject( '/', {
        'atlas_type': v
      });
      const dataCubeInstance = this.getActiveDataCube2();
      if( !dataCubeInstance ) {
        // hide selection controllers
        this.gui.hideControllers(['Voxel Display', 'Voxel Label', 'Voxel Min', 'Voxel Max'], folderName);
      } else if( dataCubeInstance.isDataContinuous ) {
        this.gui.showControllers(['Voxel Display', 'Voxel Min', 'Voxel Max'], folderName);
        this.gui.hideControllers(['Voxel Label'], folderName);
        // update controllers' min, max, steps
        const nColorKeys = Object.keys(dataCubeInstance.lut.map).length;
        const lb = Math.floor( dataCubeInstance.__dataLB ),
              ub = Math.ceil( dataCubeInstance.__dataUB );
        ctrlContinuousThresholdLB.min( lb ).max( ub )
          .step( (ub - lb) / ( nColorKeys - 1 ) )
          .setValue( Math.max( voxelLB , lb ) ).updateDisplay();
        ctrlContinuousThresholdUB.min( lb ).max( ub )
          .step( (ub - lb) / ( nColorKeys - 1 ) )
          .setValue( Math.min( voxelUB, ub ) ).updateDisplay();
        // applyContinuousSelection();
      } else {
        this.gui.showControllers(['Voxel Display', 'Voxel Label'], folderName);
        this.gui.hideControllers(['Voxel Min', 'Voxel Max'], folderName);
        applyDiscreteSelection();
      }

      const dataSliceInstance = this.getActiveSlice();
      if( dataSliceInstance ) {
        dataSliceInstance.setOverlay( dataCubeInstance );
      }

      // this.fire_change({ 'atlas_type' : v });
      this.broadcast();
      this.canvas.needsUpdate = true;
    }

    // Controls which datacube2 to display
    const voxTypeCtrl = this.gui
      .addController('Voxel Type', 'none', {args : ['none'], folderName : folderName })
      .onChange( this._onDataCube2TypeChanged );
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_VOXEL_TYPE,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_VOXEL_TYPE,
        name    : 'Voxel Type',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const currentValue = voxTypeCtrl.getValue();

        let cube2Types = voxTypeCtrl._allChoices;
        if( !Array.isArray(cube2Types) ) {
          cube2Types = this.canvas.get_atlas_types();
          cube2Types.push("none");
          voxTypeCtrl._allChoices = cube2Types;
        }

        let selectedIndex = ( cube2Types.indexOf( currentValue ) + 1 );
        if( selectedIndex >= cube2Types.length ) {
          selectedIndex = 0;
        }
        voxTypeCtrl.setValue( cube2Types[ selectedIndex ] );
      }
    });

    // Controls how the datacube should be displayed
    const voxelDisplayTypes = ['hidden', 'normal', 'side camera', 'main camera', 'anat. slices'];
    const ctrlDC2Display = this.gui
      .addController(
        'Voxel Display', 'side camera',
        {
          args : voxelDisplayTypes,
          folderName : folderName
        })
      .onChange( (v) => {
        this.canvas.atlases.forEach( (al, subject_code) => {
          for( let atlas_name in al ){
            const m = al[ atlas_name ];
            if( m.isMesh && m.userData.instance.isThreeBrainObject ){
              const inst = m.userData.instance;
              if( inst.isDataCube2 ){
                inst.set_display_mode( v );
              }
            }
          }
        });

        // TODO use event dispatcher
        this.canvas.set_state("voxelDisplay", v);
        this.canvas.set_state( "surface_color_refresh", Date() );
        this.canvas.needsUpdate = true;
      })
      .setValue( 'side camera' );
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ATLAS_MODE,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_ATLAS_MODE,
        name    : 'Voxel Display',
        folderName : folderName,
      },
      callback  : () => {
        let idx = voxelDisplayTypes.indexOf( ctrlDC2Display.getValue() ) + 1;
        if( idx >= voxelDisplayTypes.length ) { idx = 0; }

        ctrlDC2Display.setValue( voxelDisplayTypes[ idx ] );
      }
    });

    // Controls the opacity of the voxels
    this.canvas.set_state("overlayAlpha", -1);
    this.gui
      .addController('Voxel Opacity', 0.0, { folderName : folderName })
      .min(0).max(1).decimals(2)
      .onChange( async (v) => {
        const opa = v < 0.001 ? -1 : v;
        let inst = this.getActiveDataCube2();
        // mesh.material.uniforms.alpha.value = opa;
        if( inst ){
          inst.object.material.uniforms.alpha.value = opa;

          if( opa < 0 ){
            inst.updatePalette();
          }
        }
        this.canvas.set_state("overlayAlpha", opa);
        // this.fire_change({ 'atlas_alpha' : opa });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });



    const ctrlContinuousThresholdLB = this.gui
      .addController('Voxel Min', -100000, { folderName : folderName })
      .min(-100000).max(100000).step( 0.1 )
      .onChange( async ( v ) => {
        voxelLB = v;
        applyContinuousSelection();
      });
    const ctrlContinuousThresholdUB = this.gui
      .addController('Voxel Max', 100000, { folderName : folderName })
      .min(-100000).max(100000).step( 0.1 )
      .onChange( async ( v ) => {
        voxelUB = v;
        applyContinuousSelection();
      });



    const ctrlDiscreteSelector = this.gui
      .addController('Voxel Label', "", { folderName : folderName })
      .onChange( async (v) => {
        if(typeof(v) !== "string"){ return; }

        selectedLabels.length = 0;
        const selected = v.split(",").forEach((v) => {
          v = v.trim();
          if( v.match(/^[-]{0,1}[0-9]+$/g) ) {
            v = parseInt(v);
            if( !isNaN(v) ) {
              selectedLabels.push( v );
            }
            return;
          }

          const split = v.split(/[:-]/g);
          if( !Array.isArray(split) || split.length <= 1 ) { return; }

          const start = parseInt( split[0] ),
                end = parseInt( split[1] );
          if( isNaN(start) || isNaN(end) || start > end ) { return; }
          for(let i = start; i <= end; i++ ) {
            selectedLabels.push( i );
          }
        });
        applyDiscreteSelection();
      });

  };

  return( ViewerControlCenter );

}

export { registerPresetRaymarchingVoxels };
