import { Vector3, Matrix4, Color, EventDispatcher } from 'three';
import { CONSTANTS } from './constants.js';
import { ensureObjectColorSettings } from './SharedSettings.js';
import { is_electrode } from '../geometry/electrode.js';
import { copyToClipboard } from '../utility/copyToClipboard.js';
import { vector3ToString } from '../utility/vector3ToString.js';
import { asColor } from '../utility/color.js';
import { ColorMapKeywords, addToColorMapKeywords } from './CustomLut.js';
import { testColorString } from '../utility/color.js';
import { normalizeImageName } from '../utility/normalizeImageName.js';
import { setShaderProperty } from '../utils.js';

// 1. Background colors
import { registerPresetBackground } from '../controls/PresetBackground.js';

// 2. Record Videos
import { registerPresetRecorder } from '../controls/PresetRecorder.js';

// 3. Reset Camera
// 4. Camera Position
import { registerPresetMainCamera } from '../controls/PresetMainCamera.js';

// 5. display axis anchor
import { registerPresetCoordinateCompass } from '../controls/PresetCoordinateCompass.js';

// 6. toggle side panel
// 7. reset side panel position
// 8. coronal, axial, sagittal position (depth)
// 9. Electrode visibility in side canvas
import { registerPresetSliceOverlay } from '../controls/PresetSliceOverlay.js';

// 10. subject code
import { registerPresetSwitchSubject } from '../controls/PresetSwitchSubject.js';


// 11. surface type
// 12. Hemisphere material/transparency
// surface color
import { registerPresetSurface } from '../controls/PresetSurface.js';

// 13. electrode visibility, highlight, groups
// 14. electrode mapping
// 15. Highlight selected electrodes and info
import { registerPresetElectrodes } from '../controls/PresetElectrodes.js';

import { registerDragNDropFile } from '../controls/PresetDragNDropFile.js';

// 16. animation, play/pause, speed, clips...
import { registerPresetElectrodeAnimation } from '../controls/PresetElectrodeAnimation.js';

// 17. Voxel color type
import { registerPresetRaymarchingVoxels } from '../controls/PresetRaymarchingVoxels.js';

// 18. tractography
import { registerPresetTractography } from '../controls/PresetTractography.js';

// 19. Electrode localization
import { register_controls_localization } from '../controls/localization.js';

// 20. ACPC realignment
import { registerPresetACPCReAlign } from '../controls/PresetACPCReAlign.js';

// 998. QRCode
import { registerPresetQRCode } from '../controls/PresetQRCode.js';

// 999. QRCode
import { registerPresetHiddenFeatures } from '../controls/PresetHiddenFeatures.js';

// Focus mode (hold F)
import { registerPresetFocusObject } from '../controls/PresetFocusObject.js';

// const mouseMoveEvent = { type : "viewerApp.mouse.mousemove" };
const mouseSingleClickEvent = { type : "viewerApp.mouse.singleClick" };
const mouseDoubleClickEvent = { type : "viewerApp.mouse.doubleClick" };
// const clearAllVolumeEvent = { type : "viewerApp.dragdrop.clearAllVolumes" };
// const clearAllSurfaceEvent = { type : "viewerApp.dragdrop.clearAllSurfaces" };

const keyDownEvent = { type : "viewerApp.keyboad.keydown" };
const keyUpEvent = { type : "viewerApp.keyboad.keyup" };
const animationFrameUpdateEvent = { type : "viewerApp.animationFrame.update" };

const tmpVec3 = new Vector3();

const continuousLookUpTables = {};
const discreteLookUpTables = {};

class ViewerControlCenter extends EventDispatcher {

  /**
   * Initialization, defines canvas (viewer), gui controller (viewer), and settings (initial values)
   */
  constructor( viewerApp ){

    super();

    this.throttleLevel = 4;
    this.dispatcherEnabled = true;
    this._updateCount = 0;
    this.app = viewerApp;
    this.canvas = viewerApp.canvas;
    this.gui = viewerApp.controllerGUI;
    this.settings = viewerApp.settings;
    this.globalClock = viewerApp.globalClock;
    this.userData = {};

    this.electrode_regexp = RegExp('^electrodes-(.+)$');

    this.cache = {};

    // colormap for surfaces and volumes
    continuousLookUpTables.default = {...this.canvas.global_data('__global_data__.SurfaceColorLUT')};
    continuousLookUpTables.default.colorIDAutoRescale = true;
    discreteLookUpTables.default = {...this.canvas.global_data('__global_data__.VolumeColorLUT')};
    discreteLookUpTables.freesurfer = this.canvas.global_data('__global_data__.FSColorLUT');
    this.continuousLookUpTables = continuousLookUpTables;
    this.discreteLookUpTables = discreteLookUpTables;

    this.localizationData = {
      electrodes : [],
      electrodePrototype : null,
    };

    this.localizationData.getContactRadiusFromPrototype = (index) => {
      const inst = this.localizationData.electrodePrototype;
      if(!inst || typeof inst !== "object" || !inst.isElectrodePrototype) {
        // default radius
        return 1.0;
      }
      if(
        index < 0 || !Array.isArray(inst.contactCenter) ||
        inst.contactCenter.length <= index
      ) {
        return 1.0;
      }
      const radius = inst.contactCenter[index].radius;
      if( typeof radius !== "number" ) {
        return 1.0;
      }
      return radius;
    }

    this.animParameters = this.canvas.animParameters;

    this._animOnTimeChange = ( event ) => {
      // update time controller
      if( this.ctrlAnimTime !== undefined ) {
        // Update without triggering updating value (onChange callback)
        this.ctrlAnimTime.updateDisplay();
      }
      // move the cursor on the electrode activity plot
      if( this.ctrlClipGraph !== undefined ) {
        this.ctrlClipGraph.setValue( event.value );
      }
    };
    this.animParameters.addEventListener( "animation.time.onChange", this._animOnTimeChange );

    // keyboard event dispatcher
    this.canvas.$el.addEventListener( "viewerApp.keyboad.keydown" , this._onKeyDown );
    this.canvas.$el.addEventListener( "viewerApp.keyboad.keyup" , this._onKeyUp );
    this.canvas.$mainCanvas.addEventListener( 'mousemove', this._onMouseMove );
    this.canvas.$el.addEventListener( "viewerApp.mouse.click" , this._onClicked );
    this.canvas.$el.addEventListener( "viewerApp.canvas.setSliceCrosshair", this._onSetSliceCrosshair );

    // dead loop...
    // this.canvas.$el.addEventListener( "viewerApp.subject.changed", this.updateSelectorOptions );

    // other keyboard events

    // use `>` to go to next electrode
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ELECTRODES_NEXT,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      callback  : () => {
        const focusedObject = this.canvas.object_chosen || this.canvas._last_object_chosen;
        this.canvas.needsUpdate = true;

        if( is_electrode(focusedObject) ) {
          // check if this is a prototype geometry
          const inst = focusedObject.userData.instance;
          if( inst.isElectrodePrototype ) {

            // this is the focused contact
            const newFocusedContact = inst.state.focusedContact + 1;

            if( newFocusedContact < inst.contactCenter.length ) {

              // Not the last contact
              const intersectPoint = focusedObject.localToWorld( inst.contactCenter[ newFocusedContact ].clone() );

              this.canvas.focusObject(
                focusedObject,
                {
                  helper : true,
                  intersectPoint : intersectPoint
                }
              );

              return;
            }
          }
        }

        // place flag first as the function might ends early
        let previousObject, firstObject;

        for( let meshName of this.canvas.mesh.keys() ){
          const obj = this.canvas.mesh.get( meshName );
          if( is_electrode( obj ) && obj.visible ) {

            if ( !focusedObject || ( previousObject && focusedObject && previousObject.name === focusedObject.name ) ) {
              previousObject = obj;
              break;
            }

            previousObject = obj;
            if( firstObject === undefined ) { firstObject = obj; }

          }
        }
        if( previousObject && focusedObject && previousObject.name === focusedObject.name ){

          // focus on the first one
          previousObject = firstObject;

        }

        if( is_electrode(previousObject) ){
          const inst = previousObject.userData.instance;

          if( inst.isElectrodePrototype ) {

            const intersectPoint = previousObject.localToWorld( inst.contactCenter[ 0 ].clone() );

            this.canvas.focusObject(
              previousObject,
              {
                helper : true,
                intersectPoint : intersectPoint
              }
            );

          } else {

            this.canvas.focusObject( previousObject, { helper : true } );

          }
        }
      }
    })

    // use `<` to go to previous electrode
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_CYCLE_ELECTRODES_PREV,
      shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      callback  : () => {
        const focusedObject = this.canvas.object_chosen || this.canvas._last_object_chosen;
        let previousObject;
        // place flag first as the function might ends early
        this.canvas.needsUpdate = true;

        if( is_electrode(focusedObject) ) {
          // check if this is a prototype geometry
          const inst = focusedObject.userData.instance;
          if( inst.isElectrodePrototype ) {

            // this is the focused contact
            const newFocusedContact = inst.state.focusedContact - 1;

            if( newFocusedContact >= 0 ) {

              // Not the last contact
              const intersectPoint = focusedObject.localToWorld( inst.contactCenter[ newFocusedContact ].clone() );

              this.canvas.focusObject(
                focusedObject,
                {
                  helper : true,
                  intersectPoint : intersectPoint
                }
              );

              return;
            }
          }
        }


        for( let meshName of this.canvas.mesh.keys() ){
          const obj = this.canvas.mesh.get( meshName );
          if( is_electrode( obj ) && obj.visible ) {

            if( previousObject && focusedObject && obj.name == focusedObject.name ){
              break;
            }
            previousObject = obj;

          }
        }
        if( is_electrode(previousObject) ){
          const inst = previousObject.userData.instance;

          if( inst.isElectrodePrototype ) {

            const intersectPoint = previousObject.localToWorld( inst.contactCenter[ inst.contactCenter.length - 1 ].clone() );

            this.canvas.focusObject(
              previousObject,
              {
                helper : true,
                intersectPoint : intersectPoint
              }
            );

          } else {

            this.canvas.focusObject( previousObject, { helper : true } );

          }
        }
      }
    })

    // `z/Z` to zoom-in/out
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_ZOOM,
      // shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      metaIsCtrl: false,
      callback  : ( event ) => {
        const camera = this.canvas.mainCamera;
        let zoom = camera.zoom;
        if( event.shiftKey ) {
          zoom *= 1.2; // zoom in
        } else {
          zoom /= 1.2; // zoom out
        }
        if( zoom > CONSTANTS.MAIN_CAMERA_MAX_ZOOM ) { zoom = CONSTANTS.MAIN_CAMERA_MAX_ZOOM; }
        if( zoom < 0.5 ) { zoom = 0.5; }
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        this.canvas.needsUpdate = true;
      }
    });

    // `r` to use ruler
    const rulerRecord = {
      lastNKnots : 0,
      lastNAddedKnots: 0,
      lastTime : Date.now()
    };
    this.bindKeyboard({
      codes     : CONSTANTS.USE_RULER,
      // shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      metaIsCtrl: false,
      callback  : [
        ( event ) => {

          if( event.shiftKey ) {

            // shift key is pressed, reset ruler
            this.canvas.setRuler( 'reset' );
            rulerRecord.lastNKnots = 0;

          } else {

            // if user double-pressed R:
            // last cycle didn't add any knots
            // and user clicked very quickly
            if( rulerRecord.lastNAddedKnots === 0 && (Date.now() - rulerRecord.lastTime) < 200 ) {
              this.canvas.setRuler( 'undo' );
            }

            // let canvas know to add clicks to the ruler
            this.canvas.setRuler( 'enable' );

          }

        },
        ( event ) => {
          this.canvas.setRuler( 'disable' );
          rulerRecord.lastTime = Date.now();
          const nKnots = this.canvas.rulerHelper.knots.length;
          rulerRecord.lastNAddedKnots = nKnots - rulerRecord.lastNKnots;
          rulerRecord.lastNKnots = nKnots;
        }
      ]
    });

    // enable debug feature
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_DEBUG,
      shiftKey  : true,
      ctrlKey   : true,
      altKey    : true,
      metaKey   : false,
      tooltip   : null,
      callback  : ( event ) => {
        if( typeof this.toggleDebugger === "function" ) {
          this.toggleDebugger();
        }
      }
    });

    // Hidden gems!
    this.bindKeyboard({
      codes     : CONSTANTS.KEY_HIDDEN_FEATURES,
      shiftKey  : true,
      ctrlKey   : true,
      altKey    : true,
      metaKey   : false,
      tooltip   : null,
      callback  : ( event ) => {
        if(!this.hiddenFeaturesEnabled) {
          this.addPreset_hiddenFeatures();
          this.hiddenFeaturesEnabled = true;
        }
      }
    });


    // Installs driver
    this.canvas.$el.addEventListener( "viewerApp.controller.setValue" , this._onDriveController );
    this.canvas.$el.addEventListener( "viewerApp.controller.setOpen" , this._onSetOpen );

  }

  dispose() {
    this.canvas.$el.removeEventListener( "viewerApp.keyboad.keydown" , this._onKeyDown );
    this.canvas.$el.removeEventListener( "viewerApp.keyboad.keyup" , this._onKeyUp );
    this.canvas.$mainCanvas.removeEventListener( 'mousemove', this._onMouseMove );
    this.canvas.$el.removeEventListener( "viewerApp.mouse.click" , this._onClicked );
    this.canvas.$el.removeEventListener( "viewerApp.controller.setValue" , this._onDriveController );
    this.canvas.$el.removeEventListener( "viewerApp.controller.setOpen" , this._onSetOpen );
    this.canvas.$el.removeEventListener( "viewerApp.canvas.setSliceCrosshair", this._onSetSliceCrosshair );
    if( this._onInstanceChosenUpdateGraph ) {
      this.canvas.$el.removeEventListener( "viewerApp.canvas.newObjectFocused", this._onInstanceChosenUpdateGraph );
    }
    // this.canvas.$el.removeEventListener( "viewerApp.subject.changed", this.updateSelectorOptions );
    if ( this._animOnTimeChange ) {
      this.animParameters.removeEventListener( "animation.time.onChange", this._animOnTimeChange );
    }
  }

  _onSetSliceCrosshair = ( event ) => {
    if( typeof event.detail.x === "number" ) {
      const controller = this.gui.getController( 'Sagittal (L - R)' );
      if( !controller.isfake ) {
        controller.object[ 'Sagittal (L - R)' ] = event.detail.x;
        controller.updateDisplay();
      }
    }
    if( typeof event.detail.y === "number" ) {
      const controller = this.gui.getController( 'Coronal (P - A)' );
      if( !controller.isfake ) {
        controller.object[ 'Coronal (P - A)' ] = event.detail.y;
        controller.updateDisplay();
      }
    }
    if( typeof event.detail.z === "number" ) {
      const controller = this.gui.getController( 'Axial (I - S)' );
      if( !controller.isfake ) {
        controller.object[ 'Axial (I - S)' ] = event.detail.z;
        controller.updateDisplay();
      }
    }
    // Calculate MNI305 positions

    // these three are display-only: write the value and refresh the widget,
    // without firing the change handlers
    const showCoordinate = ( controllerName, coordSys ) => {
      const controller = this.gui.getController( controllerName );
      if( controller.isfake ) { return; }
      const position = this.canvas.getSideCanvasCrosshair( tmpVec3, { "coordSys" : coordSys } );
      controller.object[ controller.property ] =
        `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`;
      controller.updateDisplay();
    };

    showCoordinate( "Affine MNI152", "MNI152" );
    showCoordinate( "Crosshair ScanRAS", "Scanner" );
    showCoordinate( "Crosshair tkrRAS", "tkrRAS" );

  }

  _onSetOpen = ( event ) => {
    // should be { status, animated } or true/false
    const message = event.detail;
    if( message === true || message === false ) {
      this.gui.open( message );
    }
    if( typeof message !== "object" || message === null ) { return; }
    if( message.open === true || message.open === false ) {
      if( message.animated ) {
        this.gui.openAnimated( message.open );
      } else {
        this.gui.open( message.open );
      }
    }

  }

  _onDriveController = ( event ) => {

    // should be { name, value, folderName }
    let messages = event.detail;
    if( !Array.isArray( messages ) ) {
      messages = [messages];
    }
    messages.forEach(( message ) => {
      if( typeof message !== "object" || message === null ) { return; }

      if( typeof message.name !== "string" || message.name === "" ) { return; }

      // get controller
      const controller = this.gui.getController( message.name , message.folderName );
      if( !controller || controller.isfake ) {
        console.warn(`Cannot find threeBrain viewer controller: ${ message.name }`);
        return;
      }

      if( controller._disabled ) {
        console.warn(`ThreeBrain viewer controller is disabled: ${ message.name }`);
        return;
      }

      switch ( controller._type ) {

        // Button
        case "function":
          controller.fire();
          return;

        // Color
        case "color":
          controller.setValue(
            asColor( message.value, new Color() ).getHexString()
          );
          return;

        // Boolean
        case "boolean":
          if( message.value ) {
            controller.setValue( true );
          } else {
            controller.setValue( false );
          }
          return;

        // String
        case "string":
          if( typeof message.value === "object" ) {
            controller.setValue( JSON.stringify( message.value ) );
          } else {
            controller.setValue( message.value.toString() );
          }
          return;

        // option
        case "option":
          if(
            (
              Array.isArray( controller._names ) &&
              controller._names.includes( message.value )
            ) || (
              Array.isArray( controller._values ) &&
              controller._values.includes( message.value )
            )
          ) {
            controller.setValue( message.value );
          } else {
            console.warn(`ThreeBrain viewer controller [${ message.name }] does not contain option choice: ${ message.value }`);
          }
          return;

        // Number
        case "number":
          if( typeof message.value !== "number" || isNaN( message.value ) ||
              !isFinite( message.value ) ) {
            console.warn(`ThreeBrain viewer controller [${ message.name }] needs a valid (not NaN, Infinity) numerical input.`);
          } else {

            if(
              ( controller._min !== undefined && controller._min > message.value ) ||
              ( controller._max !== undefined && controller._max < message.value )
            ) {
              console.warn(`Trying to ThreeBrain viewer controller [${ message.name }]  numerical value that is out of range.`);
            }

            controller.setValue( message.value );
          }
          return;

      }


      console.warn(`Unimplemented controller type for [${ message.name }].`);
    })

  }

  _onMouseMove = ( event ) => {
    if( this.canvas.activated ) {
      this.canvas._mouseEvent = event;
      // this.dispatchEvent( mouseMoveEvent );
    }
  }

  _onClicked = ( event ) => {
    const clickEvent = event.detail;
    if( this.canvas.activated ) {

      if( clickEvent.detail > 1 ) {
        this.dispatchEvent( mouseDoubleClickEvent );
      } else {
        this.dispatchEvent( mouseSingleClickEvent );
      }
    }
  }

  _onKeyDown = ( event ) => {
    if( this.canvas.activated ) {
      const keyboardEvent = event.detail;

      keyDownEvent.key      = keyboardEvent.key;
      keyDownEvent.code     = keyboardEvent.code;
      keyDownEvent.shiftKey = keyboardEvent.shiftKey;
      keyDownEvent.ctrlKey  = keyboardEvent.ctrlKey;
      keyDownEvent.altKey   = keyboardEvent.altKey;
      keyDownEvent.metaKey  = keyboardEvent.metaKey;

      this.dispatchEvent( keyDownEvent );
    }
    /*
    const keyboardEvent = event.detail;
    const keyboardData = {
      type      : "viewerApp.keyboad.keydown",
      key       : keyboardEvent.key,
      code      : keyboardEvent.code,
      // keyCode   : keyboardEvent.keyCode, // deprecated API, use code instead
      shiftKey  : keyboardEvent.shiftKey,
      ctrlKey   : keyboardEvent.ctrlKey,
      altKey    : keyboardEvent.altKey,
      metaKey   : keyboardEvent.metaKey
    };

    // this event will not be registered to $wrapper and will be bound to this class
    // so auto-disposed when replaced
    this.dispatchEvent( keyboardData );
    */

  }

  _onKeyUp = ( event ) => {
    this.dispatchEvent( keyUpEvent );
  }

  bindKeyboard({
    codes, callback, tooltip,
    shiftKey, ctrlKey, altKey,
    metaKey, metaIsCtrl = false
  } = {}) {
    if( codes === null || codes === undefined ) { return; }
    let codeArray;
    if( !Array.isArray( codes ) ) {
      codeArray = [ codes ];
    } else {
      codeArray = codes;
    }
    let onKeyDownCallback = callback,
        onKeyUpCallback = null;
    if(Array.isArray(callback)) {
      onKeyDownCallback = callback[0];
      onKeyUpCallback = callback[1];
    }
    this.addEventListener( "viewerApp.keyboad.keydown", ( event ) => {
      if( !codeArray.includes( event.code ) ) { return; }
      if( shiftKey !== undefined && ( event.shiftKey !== shiftKey ) ) { return; }
      if( altKey !== undefined && ( event.altKey !== altKey ) ) { return; }
      if( metaIsCtrl ) {
        if( ctrlKey !== undefined || metaKey !== undefined ) {
          if( (ctrlKey || metaKey) !== (event.ctrlKey || event.metaKey) ) { return; }
        }
      } else {
        if( ctrlKey !== undefined && ( event.ctrlKey !== ctrlKey ) ) { return; }
        if( metaKey !== undefined && ( event.metaKey !== metaKey ) ) { return; }
      }
      onKeyDownCallback( event );
    });
    if( typeof onKeyUpCallback === "function" ) {
      this.addEventListener( "viewerApp.keyboad.keyup", ( event ) => {
        onKeyUpCallback( event );
      });
    }
    if( tooltip && typeof tooltip === "object" ) {
      const controller = this.gui.getController( tooltip.name, tooltip.folderName );
      controller.tooltip( tooltip.title, tooltip.key );
    }
  }

  enablePlayback ( enable = true ) {
    if( !this.ctrlAnimPlay ) { return; }
    this.ctrlAnimPlay.setValue( enable );
  }

  updateSelectorOptions() {
    this.updateDataCube2Types();
    // this.set_surface_ctype( true );
    this.canvas.needsUpdate = true;
  }

  /**
   * Allow controllers to update select options without destroying controller
   */
  updateSingleSelectorOptions({ name, options, folderName, value, explicit = false, force = false } = {}){

    if( !Array.isArray( options ) || options.length === 0 ) { return; }
    const controller = this.gui.getController( name, folderName, explicit );
    if( controller.isfake ) { return controller; }

    let currentValue;
    if( typeof value === "string" && options.includes( value ) ) {
      currentValue = value;
    } else {
      currentValue = controller.getValue();
      if( !options.includes( currentValue ) ) { currentValue = options[ 0 ]; }
    }

    controller._allChoices = options;

    if(
      !force && options.length === controller._values.length &&
      controller._values.every(item => options.includes(item))
    ) {
      controller.setValue( currentValue );
      return controller;
    }

    // the choice list is fixed when the widget is built, so this replaces it
    controller.options( options );
    controller.setValue( currentValue ).updateDisplay();

    return controller;
  }

  updateDataCube2Types( atlas ){

    const cube2Types = this.canvas.get_atlas_types();
    cube2Types.push("none");

    return this.updateSingleSelectorOptions({
      name    : 'Voxel Type',
      options : cube2Types,
      value   : atlas,
    });

  }

  updateElectrodeDisplayNames( varname ) {
    const dataNames = ["[None]", ...this.canvas.colorMaps.keys()];

    this.animClipNames = dataNames;

    if ( typeof varname === "string" ) {
      const userDataNames = dataNames.filter(v => !v.startsWith("["));
      if ( userDataNames.length > 0 && !userDataNames.includes( varname ) ) {
        varname = userDataNames[ 0 ];
      }
    }

    this.updateSingleSelectorOptions({
      name    : 'Display Data',
      options : dataNames,
      value   : varname,
    });

    this.updateSingleSelectorOptions({
      name    : 'Threshold Data',
      options : dataNames,
      force   : true
    });

    this.updateSingleSelectorOptions({
      name    : 'Additional Data',
      options : dataNames,
      force   : true
    });

  }

  // update gui controllers
  update(){

    if( this._updateCount >= this.throttleLevel ) {
      this._updateCount = 0;
    } else {
      this._updateCount++;
    }
    if( this._updateCount !== 0 ) { return; }

    this.dispatchEvent( animationFrameUpdateEvent );

  }

  // priority is deferred or event, see shiny
  // broadcastController: true, false or "auto"; default is "auto", i.e.
  // when data is undefined, broadcast controller, otherwise broadcast data
  // only
  broadcast({ data, priority = "deferred", broadcastController = "auto" } = {}){

    if( !this.dispatcherEnabled ) { return; }

    if( typeof data === "object" ) {
      Object.assign( this.userData , data );
      this.dispatchEvent({
        type : "viewerApp.controller.broadcastData",
        data : data,
        priority : priority
      });
      if( broadcastController !== true) { return; }
    }
    this.dispatchEvent({
      type : "viewerApp.controller.change",
      priority : priority
    });
  }

  getControllerData ({ saveToClipboard = false } = {}) {
    const data = {
      isThreeBrainControllerData : true,
      controllerData : this.gui.save( true ),
      sliceCrosshair : {},
      cameraState : this.canvas.mainCamera.getState()
    };

    // some extra information
    const position = new Vector3();

    // position is in tkrRAS
    const tkrRAS = this.canvas.getSideCanvasCrosshair( position, { coordSys : "tkrRAS" } );
    data.sliceCrosshair.tkrRAS = vector3ToString( tkrRAS );

    // position is in Scanner
    const scanRAS = this.canvas.getSideCanvasCrosshair( position, { coordSys : "Scanner" } );
    data.sliceCrosshair.scannerRAS = vector3ToString( scanRAS );

    // position is in MNI-305
    const mni305 = this.canvas.getSideCanvasCrosshair( position, { coordSys : "MNI305" } );
    data.sliceCrosshair.mni305RAS = vector3ToString( mni305 );

    // position is in MNI-152
    const mni152 = this.canvas.getSideCanvasCrosshair( position, { coordSys : "MNI152" } );
    data.sliceCrosshair.mni152RAS = vector3ToString( mni152 );

    if( saveToClipboard ) {
      copyToClipboard( JSON.stringify( data ) );
    }
    return data;
  }

  // ---- For handling drag & drop behaviors
  getDragDropFolderPath( fileName, parentName ) {
    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const normalizedFileName = normalizeImageName( fileName );

    let parentFolder = folderName;
    if( parentName ) {
      parentFolder = `${folderName} > ${parentName}`;
    }
    const innerFolderName = `${parentFolder} > ${normalizedFileName}`
    return innerFolderName;
  }

  // enables controlling of visibility
  dragdropAddVisibilityController( inst, fileName ) {
    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const normalizedFileName = normalizeImageName( fileName );

    let parentFolder;
    if( inst.isDataCube2 || inst.isDataCube ) {
      parentFolder = `${folderName} > Configure ROI Volumes`;
    } else {
      parentFolder = `${folderName} > Configure ROI Surfaces`;
    }


    const visibilityName = `Visibility - ${ normalizedFileName }`;
    const innerFolderName = `${parentFolder} > ${normalizedFileName}`
    const opts = ["visible", "hidden"];

    // get default values
    let defaultValue;
    let defaultCtrl = this.gui.getController( "Visibility (all surfaces)", parentFolder, true );
    if( defaultCtrl.isfake ) {
      defaultCtrl = this.gui.getController( "Visibility (all volumes)", parentFolder, true );
    }
    if( !defaultCtrl.isfake ) {
      defaultValue = defaultCtrl.getValue();
    }
    if( typeof defaultValue !== "string" || opts.indexOf( defaultValue ) === -1 ) {
      defaultValue = "visible";
    }

    let ctrl = this.gui.getController( visibilityName, innerFolderName, true );
    if( ctrl.isfake ) {
      ctrl = this.gui.addController(
        visibilityName, "visible",
        {
          args: opts,
          folderName : innerFolderName
        }
      );
    }
    ctrl.onChange((v) => {
      if(!v) { return; }
      switch ( v ) {
        case 'visible':
          inst.forceVisible = true;
          break;
        case 'hidden':
          inst.forceVisible = false;
          break;
        default:
          // code
      };
      this.canvas.needsUpdate = true;
    }).setValue(defaultValue);
  }

  // enables controlling of opacity
  dragdropAddOpacityController( inst, fileName ) {
    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const normalizedFileName = normalizeImageName( fileName );

    let parentFolder;
    if( inst.isDataCube2 || inst.isDataCube ) {
      parentFolder = `${folderName} > Configure ROI Volumes`;
    } else {
      parentFolder = `${folderName} > Configure ROI Surfaces`;
    }

    const innerFolderName = `${parentFolder} > ${normalizedFileName}`
    const opacityName = `Opacity - ${ normalizedFileName }`;

    // get default values
    let defaultValue;
    let defaultCtrl = this.gui.getController( "Opacity (all surfaces)", parentFolder, true );
    if( defaultCtrl.isfake ) {
      defaultCtrl = this.gui.getController( "Opacity (all volumes)", parentFolder, true );
    }
    if( !defaultCtrl.isfake ) {
      defaultValue = defaultCtrl.getValue();
    }
    if( typeof defaultValue !== "number" ) {
      defaultValue = 1.0;
    }

    let ctrl = this.gui.getController( opacityName, innerFolderName, true );
    if( ctrl.isfake ) {
      ctrl = this.gui.addController(
        opacityName, 1,
        {
          folderName : innerFolderName
        }
      ).min(0).max(1).step(0.1);
    }

    if( inst.isDataCube2 ) {
      ctrl.onChange(v => {
        inst.setOpacity( v );
        this.canvas.needsUpdate = true;
      }).setValue( defaultValue );
    } else {
      ctrl.onChange(v => {
        if(!v) { v = 0; }
        if( v < 0.99 ) {
          setShaderProperty( inst.object.material, 'transparent', true );
          inst.object.material.opacity = v;
        } else {
          setShaderProperty( inst.object.material, 'transparent', false );
        }
        this.canvas.needsUpdate = true;
      }).setValue( defaultValue );
    }


  }

  // for continuous data, clipping
  dragdropAddValueClippingController( inst, fileName ) {
    // TODO: support these formats
    // if( !inst.isDataCube2 && !inst.isFreeMesh ) { return; }

    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const normalizedFileName = normalizeImageName( fileName );

    let parentFolder;
    if( inst.isDataCube2 || inst.isDataCube ) {
      parentFolder = `${folderName} > Configure ROI Volumes`;
    } else {
      parentFolder = `${folderName} > Configure ROI Surfaces`;
    }

    const innerFolderName = `${parentFolder} > ${normalizedFileName}`

    if ( inst.isDataCube2 ) {

      // get default values
      let lb = inst.__dataLB,
          ub = inst.__dataUB,
          range = inst._selectedDataValues;
      let currentLB = typeof range[ 0 ] === 'number' ? range[ 0 ] : lb;
      let currentUB = typeof range[ 1 ] === 'number' ? range[ 1 ] : ub;
      let controllerName = `Clipping Min - ${ normalizedFileName }`;
      let ctrl = this.gui.getController( controllerName, innerFolderName, true );
      if( ctrl.isfake ) {
        ctrl = this.gui.addController( controllerName, currentLB, { folderName : innerFolderName } );
      }
      ctrl.min(lb).max(ub).step(0.05)
        .onChange( async (v) => {
          if( typeof v !== "number" ) { return; }
          currentLB = v;
          inst._filterDataContinuous( currentLB, currentUB );
          this.canvas.needsUpdate = true;
        });


      controllerName = `Clipping Max - ${ normalizedFileName }`;
      ctrl = this.gui.getController( controllerName, innerFolderName, true );
      if( ctrl.isfake ) {
        ctrl = this.gui.addController( controllerName, currentUB, { folderName : innerFolderName } );
      }
      ctrl.min(lb).max(ub).step(0.05)
        .onChange( async (v) => {
          if( typeof v !== "number" ) { return; }
          currentUB = v;
          inst._filterDataContinuous( currentLB, currentUB );
          this.canvas.needsUpdate = true;
        });

    }
    // surface measurements are ranged by `Surface Color Min/Max` and clipped
    // by the `Surface Threshold` controllers instead


  }

  // For handling single plain color
  dragdropAddColorController( inst, fileName, currentColorMode ) {

    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const normalizedFileName = normalizeImageName( fileName );

    let parentFolder;
    if( inst.isDataCube2 || inst.isDataCube ) {
      parentFolder = `${folderName} > Configure ROI Volumes`;
    } else {
      parentFolder = `${folderName} > Configure ROI Surfaces`;
    }
    const innerFolderName = `${parentFolder} > ${normalizedFileName}`
    const colorSettings = ensureObjectColorSettings( fileName );

    let colorModes;

    if( inst.isDataCube2 ) {
      colorModes = ["single color", "continuous", "discrete"];
      if( typeof currentColorMode !== "string" ) {
        currentColorMode = inst.isDataContinuous ? "continuous" : "discrete";
      }
    } else {
      colorModes = ["single color", "continuous"];
      if( typeof currentColorMode !== "string" ) {
        currentColorMode = "single color";
      }
    }

    const colorModeCtrl = this.gui
      .getOrAddController(`Color Mode - ${ normalizedFileName }`, currentColorMode, {
        args: colorModes,
        folderName : innerFolderName,
        force : true
      });

    // Single color (fileName already normalized)
    const singleColorCtrl = this.gui
      .getOrAddController(`Color - ${ normalizedFileName }`, colorSettings.single, {
        isColor: true,
        folderName : innerFolderName
      })
      .onChange( v => {
        if( !testColorString(v) ) { return; }
        if( currentColorMode !== "single color" ) { return; }
        colorSettings.single = v;

        if( inst.isFreeMesh ) {
          inst._materialColor.set( v );
          setShaderProperty( inst.object.material, 'vertexColors', false );
        } else if( inst.isDataCube2 ) {
          const lut = this.continuousLookUpTables.default;
          inst.useColorLookupTable( lut, v );
        }

        this.canvas.needsUpdate = true;
      })
      .hide();

    const continuousColorCtrl = this.gui
      .getOrAddController(`Color Map (Continuous) - ${ normalizedFileName }`, colorSettings.continuous, {
        args: [...Object.keys( ColorMapKeywords )],
        folderName : innerFolderName,
        force : true
      })
      .onChange( async (v) => {

        if( currentColorMode !== "continuous" ) { return; }
        if( !ColorMapKeywords[ v ] ) { return; }

        if( inst.isDataCube2 ) {
          const lut = this.continuousLookUpTables.default;
          inst.useColorLookupTable( lut, v );
          colorSettings.continuous = v;
        } else if ( inst.isFreeMesh ) {
          // the measurement is colored by the surface color controllers
          const data = inst.object.userData[`${ inst._hemispherePrefix }h_annotation_[custom measurement]`];
          if( data ) {
            inst._materialColor.set( "#FFFFFF" );
            setShaderProperty( inst.object.material, 'vertexColors', true );

            // re-selecting the data would reset the color range
            const ctrlVertData = this.gui.getController("Surface Color Data");
            if( !ctrlVertData.isfake && ctrlVertData.getValue() !== "[custom measurement]" ) {
              ctrlVertData.setValue("[custom measurement]");
            }
            this.gui.getController("Surface Color Map").setValue( v );
          }
          colorSettings.continuous = v;
        }

        this.canvas.needsUpdate = true;

      }).hide();

    const discreteColorCtrl = this.gui
      .getOrAddController(`Color Map (Discrete) - ${ normalizedFileName }`, colorSettings.discrete, {
        args: [...Object.keys( this.discreteLookUpTables )],
        folderName : innerFolderName,
        force : true
      })
      .onChange( async (v) => {

        if( currentColorMode !== "discrete" ) { return; }
        const lut = this.discreteLookUpTables[ v ];
        if( !lut ) { return; }

        if( inst.isDataCube2 ) {
          inst.useColorLookupTable( lut, v );
          colorSettings.discrete = v;
        }

        this.canvas.needsUpdate = true;
      }).hide();

    colorModeCtrl.onChange(v => {
      if( typeof v !== "string" ) { return; }
      if( colorModes.indexOf(v) === -1 ) { return; }

      currentColorMode = v;
      switch ( v ) {
        case 'single color':
          singleColorCtrl.show().setValue( colorSettings.single );
          continuousColorCtrl.hide();
          discreteColorCtrl.hide();
          break;

        case 'continuous':
          singleColorCtrl.hide();
          continuousColorCtrl.show().setValue( colorSettings.continuous );
          discreteColorCtrl.hide();
          break;

        case 'discrete':
          singleColorCtrl.hide();
          continuousColorCtrl.hide();
          discreteColorCtrl.show().setValue( colorSettings.discrete );
          break;

        default:
          // code
      }
    });

    // initialize
    colorModeCtrl.setValue( currentColorMode );

  }

}

ViewerControlCenter = registerPresetBackground( ViewerControlCenter );
ViewerControlCenter = registerPresetRecorder( ViewerControlCenter );
ViewerControlCenter = registerPresetMainCamera( ViewerControlCenter );
ViewerControlCenter = registerPresetCoordinateCompass( ViewerControlCenter );
ViewerControlCenter = registerPresetSliceOverlay( ViewerControlCenter );
ViewerControlCenter = registerPresetSwitchSubject( ViewerControlCenter );
ViewerControlCenter = registerPresetSurface( ViewerControlCenter );
ViewerControlCenter = registerPresetElectrodes( ViewerControlCenter );
ViewerControlCenter = registerDragNDropFile( ViewerControlCenter );
ViewerControlCenter = registerPresetElectrodeAnimation( ViewerControlCenter );
ViewerControlCenter = registerPresetRaymarchingVoxels( ViewerControlCenter );
ViewerControlCenter = registerPresetTractography( ViewerControlCenter );
ViewerControlCenter = register_controls_localization( ViewerControlCenter );
ViewerControlCenter = registerPresetACPCReAlign( ViewerControlCenter );
ViewerControlCenter = registerPresetQRCode( ViewerControlCenter );
ViewerControlCenter = registerPresetHiddenFeatures( ViewerControlCenter );
ViewerControlCenter = registerPresetFocusObject( ViewerControlCenter );

export { ViewerControlCenter };
