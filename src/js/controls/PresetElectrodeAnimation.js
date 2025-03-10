import { get_or_default } from '../utils.js';
import { asArray } from '../utility/asArray.js';
import { CONSTANTS } from '../core/constants.js';
import { set_visibility } from '../utils.js';
import { testColorString } from '../utility/color.js';

// 15. animation, play/pause, speed, clips...

const CanvasState = CONSTANTS.CANVAS_RENDER_STATE;

function registerPresetElectrodeAnimation( ViewerControlCenter ){


  ViewerControlCenter.prototype.changeAnimClip = function( clipName ){

    const cmap = this.canvas.switchColorMap( clipName );

    // this.canavs.switch_media( clipName );
    this.canvas.threebrain_instances.forEach( (inst) => {
      if( inst && typeof inst.switchTrack === "function" ) {
        inst.switchTrack( clipName );
      }
    });

    // time range is updated
    // this.canvas.updateTimeRange();
    this.ctrlAnimTime.min( this.animParameters.min ).max( this.animParameters.max )
      // .onChange(v => { this.canvas.needsUpdate = true; });

    // update video playback speed FIXME?
    // const playbackSpeed = this.ctrlAnimSpeed.getValue() || 1;

    if( !cmap ){
      this.ctrlLegendVisible.setValue( false );
      this.ctrlRenderTimestamp.setValue( false );
      this.ctrlDisplayRange.setValue( "" );
      if( clipName === '[None]' ){
        this.canvas.electrodes.forEach((_d) => {
          for( let _kk in _d ){
            // _d[ _kk ].visible = true;
            set_visibility( _d[ _kk ], true );
          }
        });
      }
    } else {

      this.animParameters.time = this.animParameters.min;
      this.ctrlLegendVisible.setValue(true);

      // If inactive electrodes are hidden, re-calculate visibility
      this.updateElectrodeVisibility();
      // reset color-range
      if( cmap.isContinuous ) {
        this.ctrlDisplayRange.setValue( `${cmap.minV.toPrecision(4)},${cmap.maxV.toPrecision(4)}` );
        this.ctrlDisplayRange.show();
      } else {
        this.ctrlDisplayRange.setValue("");
        this.ctrlDisplayRange.hide();
      }
      this.canvas.needsUpdate = true;
    }
  }

  ViewerControlCenter.prototype.addPreset_animation = function(){

    // Check if animation is needed
    // if( asArray( this.settings.color_maps ).length === 0 ){ return; }

    const controllerData = this.animParameters.object;

    // Animation is needed
    const step = 0.001,
          folderName = CONSTANTS.FOLDERS[ 'animation' ];

    let cnames = Object.keys( this.settings.color_maps ),
        names = ['[None]'],
        initial = this.settings.default_colormap;

    // Make sure the initial value exists, and [None] is included in the option
    cnames.forEach(n => {
      if( n === 'Subject' && cnames.includes('[Subject]') ){
        return;
      }
      names.push( n );
    });
    this.animClipNames = names;

    if( !initial || !names.includes( initial ) || initial.startsWith('[') ){
      initial = undefined;
      names.forEach((_n) => {
        if( !initial && !_n.startsWith('[') ){
          initial = _n;
        }
      });
    }

    if( !initial ){
      initial = '[None]';
    }

    // Defines when clip name is changed (variable changed)

    this.ctrlClipName = this.gui
      .addController(
        'Display Data', initial,
        {
          folderName : folderName, args : names ,
          object : this.animParameters.object,
        })
      .onChange((v) => {
        if( !this.animClipNames.includes(v) ) { return; }
        this.changeAnimClip( v );
        this.canvas.set_state('display_variable', v);
        // this.fire_change({ 'clip_name' : v, 'display_data' : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    this.ctrlClipName._allChoices = this.animClipNames;

    this.ctrlDisplayRange = this.gui
      .addController(
        'Display Range', '',
        { folderName : folderName , object : this.animParameters.object })
      .onChange((v) => {

        const dataName = this.ctrlClipName.getValue();
        const cmap = this.canvas.switchColorMap( dataName, false );

        if( !cmap || !cmap.isContinuous ) { return; }

        let ss = v;
        v = v.split(',').map(x => {
          return( parseFloat(x) );
        }).filter(x => {
          return( !isNaN(x) );
        });


        if( v.length > 0 && !(v.length === 1 && v[0] === 0) ){
          let v1 = v[0], v2 = Math.abs(v[0]);
          if( v.length == 1 ){
            v1 = -v2;
          }else{
            v2 = v[1];
          }
          cmap.setMin( v1 );
          cmap.setMax( v2 );
        } else {
          cmap.resetMin();
          cmap.resetMax();
        }
        this.canvas.threebrain_instances.forEach( (inst) => {
          if( inst && typeof inst.updateDataRange === "function" ) {
            inst.updateDataRange( dataName );
          }
        });

        this.broadcast();
        this.canvas.needsUpdate = true;

      });

    this.ctrlDataThreshold = this.gui
      .addController(
        'Threshold Data', '[None]',
        { folderName : folderName, args : names , object : this.animParameters.object })
      .onChange((v) => {
        const cmap = this.canvas.colorMaps.get(v);
        if(!cmap){
          // this is not a value we can refer to
          this.ctrlThresholdRange.setValue('');
          this.canvas.set_state('threshold_active', false);
          return;
        }

        const previous_type = this.canvas.get_state('threshold_type');
        const previous_value = this.canvas.get_state('threshold_type');

        // set flags to canvas
        this.canvas.set_state('threshold_active', true);
        this.canvas.set_state('threshold_variable', v);

        if( cmap.isContinuous ){
          this.canvas.set_state('threshold_type', 'continuous');
          this.gui.showControllers( 'Threshold Method', folderName );

          if( previous_type !== 'continuous' ){
            this.ctrlThresholdRange.setValue( this.__threshold_values_continuous || '' );
          }

        }else{
          // '' means no threshold
          this.canvas.set_state('threshold_type', 'discrete');
          this.ctrlThresholdRange.setValue( cmap.keys.join('|') );
          this.gui.hideControllers( 'Threshold Method' , folderName);
        }
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.ctrlThresholdRange = this.gui
      .addController(
        'Threshold Range', '',
        { folderName : folderName , object : this.animParameters.object })
      .onChange((v) => {
        const is_continuous = this.canvas.get_state( 'threshold_type', 'discrete') == 'continuous';
        v = `${ v }`;
        let candidates = v.split(/[\|,]/).map((x) => { return(x.trim()); });

        if(is_continuous){
          candidates = candidates.map(x => { return(parseFloat(x)); })
                                 .filter(x => { return(!isNaN(x)); });
          /*
          candidates = candidates.map((x) => {
            let s = Array.from(x).map((s) => {
              return( '0123456789.,-eE~'.indexOf(s) === -1 ? '' : s );
            }).join('').split(/[,~]/);
            if( s.length === 2 ){
              s[0] = parseFloat( s[0] );
              s[1] = parseFloat( s[1] );
            }else{
              return([]);
            }
            if( isNaN( s[0] ) || isNaN( s[1] ) ){
              return([]);
            }
            return(s);
          });
          */
          this.__threshold_values_continuous = v;
        }
        // set flag

        this.canvas.set_state('threshold_values', candidates);
        this.broadcast();
        this.canvas.needsUpdate = true;
      });


    this.gui
      .addController(
        'Threshold Method', '|v| >= T1',
        { folderName : folderName, args : CONSTANTS.THRESHOLD_OPERATORS })
      .onChange((v) => {
        const isContinuous = this.canvas.get_state( 'threshold_type', 'discrete') == 'continuous';
        if( isContinuous ){
          const op = CONSTANTS.THRESHOLD_OPERATORS.indexOf(v);
          if( op > -1 ){
            this.canvas.set_state('threshold_method', op);
            this.broadcast();
            this.canvas.needsUpdate = true;
          }
        }else{
          // ignores discrete data
        }
      });
    this.canvas.set_state('threshold_method', 2);

    // Add keyboard shortcut
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_SYNC_THRESHOLD,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_SYNC_THRESHOLD,
        name    : 'Threshold Data',
        folderName : folderName,
        title   : `Set threshold for contacts to be colored/visible.`
      },
      callback  : () => {
        const currentThresholdRange = this.ctrlThresholdRange.getValue();
        this.ctrlDataThreshold.setValue( this.ctrlClipName.getValue() );
        this.ctrlThresholdRange.setValue( currentThresholdRange );
      }
    });


    this.gui
      .addController(
        'Additional Data', '[None]',
        {
          folderName : folderName, args : names ,
          object : this.animParameters.object })
      .onChange( (v) => {
        if( !names.includes(v) ) { return; }
        this.canvas.set_state('additional_display_variable', v);
        // this.fire_change({ 'clip_name' : v, 'display_data' : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.gui
      .addController(
        'Inactive Color', '#c2c2c2',
        {
          isColor: true,
          folderName : folderName
        })
      .onChange( (v) => {
        v = testColorString(v);
        if( !v ) { return; }
        this.canvas.set_state( 'inactiveElectrodeColor', v );
        // this.fire_change({ 'clip_name' : v, 'display_data' : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.ctrlAnimPlay = this.gui
      .addController(
        'Play/Pause', false,
        {
          folderName : folderName,
          object : this.animParameters.object,
        })
      .onChange(v => {
        if(v){
          this.canvas._renderFlag = this.canvas._renderFlag | CanvasState.Animate;
          this.canvas.animParameters.start();
        }else{
          this.canvas._renderFlag = this.canvas._renderFlag & (CanvasState.Animate ^ CanvasState.Mask);
          this.canvas.animParameters.stop();
        }
        this.broadcast();
      });


    this.ctrlAnimSpeed = this.gui
      .addController(
        'Speed', 1,
        {
          args : {
            'x 0.01' : 0.01,
            'x 0.05' : 0.05,
            'x 0.1' : 0.1,
            'x 0.2': 0.2,
            'x 0.5': 0.5,
            'x 1': 1,
            'x 2':2,
            'x 5':5
          },
          folderName : folderName,
          object : this.animParameters.object
        }
      );

    this.ctrlAnimTime = this.gui
      .addController( 'Time', this.animParameters.min,
                      { folderName : folderName, object : this.animParameters.object })
      .min( this.animParameters.min )
      .max( this.animParameters.max )
      .step( step ).decimals( 3 ).onChange((v) => {
        const currentTime = this.animParameters.time;
        if( Math.abs( currentTime - v ) >= 0.001 ) {
          this.animParameters.time = v;
        }
        this.canvas.needsUpdate = true;
      });

    // Add keyboard shortcut
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_TOGGLE_ANIMATION,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_TOGGLE_ANIMATION,
        name    : 'Play/Pause',
        folderName : folderName,
      },
      callback  : () => {
        const isPlaying = this.ctrlAnimPlay.getValue();
        this.ctrlAnimPlay.setValue( !isPlaying );
      }
    });

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ANIMATION,
      // shiftKey  : can be true or false
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      tooltip   : {
        key     : CONSTANTS.TOOLTIPS.KEY_CYCLE_ANIMATION,
        name    : 'Display Data',
        folderName : folderName,
      },
      callback  : ( event ) => {
        const names = this.animClipNames;
        if( event.shiftKey ) {
          let current_idx = names.indexOf( this.ctrlClipName.getValue() ) - 1;
          if( current_idx < 0 ){ current_idx += names.length; }
          if( current_idx >= 0 ){
            this.ctrlClipName.setValue( names[ current_idx ] );
          }
        } else {
          let current_idx = (names.indexOf( this.ctrlClipName.getValue() ) + 1) % names.length;
          if( current_idx >= 0 ){
            this.ctrlClipName.setValue( names[ current_idx ] );
          }
        }
      }
    });

    this.canvas.video_canvas._mode = "muted";
    this.canvas.video_canvas.muted = true;
    this.gui
      .addController(
        'Video Mode', "muted", {
          folderName: folderName, args : ["hidden", "muted", "normal"]
        })
      .onChange((v) => {
        if( v === undefined || v === "hidden" ){
          this.canvas.video_canvas._mode = "hidden"
        } else {
          this.canvas.video_canvas._mode = v;
          if( v === "muted" ){
            this.canvas.video_canvas.muted = true;
          } else {
            this.canvas.video_canvas.muted = false;
          }
        }
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.ctrlLegendVisible = this.gui
      .addController(
        'Show Legend', true,
        { folderName: folderName, object : this.animParameters.object })
      .onChange((v) => {
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    this.ctrlRenderTimestamp = this.gui
      .addController(
        'Show Time', true,
        { folderName: folderName, object : this.animParameters.object })
      .onChange((v) => {
        // this.fire_change({ 'render_timestamp' : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    // enable animation
    this.animParameters.exists = true;
    this.ctrlLegendVisible.setValue( this.settings.show_legend );
    this.ctrlRenderTimestamp.setValue( this.settings.render_timestamp || false );
    this.ctrlClipName.setValue( initial );
    this.gui.openFolder( folderName, false );

  }

  return( ViewerControlCenter );

}

export { registerPresetElectrodeAnimation };
