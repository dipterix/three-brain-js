import { Vector3, Matrix4, Color, EventDispatcher } from 'three';
import { CONSTANTS } from './constants.js';
import { is_electrode } from '../geometry/electrode.js';
import { copyToClipboard } from '../utility/copyToClipboard.js';
import { vector3ToString } from '../utility/vector3ToString.js';
import { asColor } from '../utility/color.js';

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

// 18. Electrode localization
import { register_controls_localization } from '../controls/localization.js';

// 19. ACPC realignment
import { registerPresetACPCReAlign } from '../controls/PresetACPCReAlign.js';

// 998. QRCode
import { registerPresetQRCode } from '../controls/PresetQRCode.js';

// 999. QRCode
import { registerPresetHiddenFeatures } from '../controls/PresetHiddenFeatures.js';

// const mouseMoveEvent = { type : "viewerApp.mouse.mousemove" };
const mouseSingleClickEvent = { type : "viewerApp.mouse.singleClick" };
const mouseDoubleClickEvent = { type : "viewerApp.mouse.doubleClick" };

const keyDownEvent = { type : "viewerApp.keyboad.keydown" };
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

    this._animOnTimeChange = () => {
      // update time controller
      if( this.ctrlAnimTime !== undefined ) {
        this.ctrlAnimTime.updateDisplay();
      }
    };
    this.animParameters._eventDispatcher.addEventListener( "animation.time.onChange", this._animOnTimeChange );

    // keyboard event dispatcher
    this.canvas.$el.addEventListener( "viewerApp.keyboad.keydown" , this._onKeyDown );
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
        if( zoom > 10 ) { zoom = 10; }
        if( zoom < 0.5 ) { zoom = 0.5; }
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        this.canvas.needsUpdate = true;
      }
    });


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
    this.canvas.$mainCanvas.removeEventListener( 'mousemove', this._onMouseMove );
    this.canvas.$el.removeEventListener( "viewerApp.mouse.click" , this._onClicked );
    this.canvas.$el.removeEventListener( "viewerApp.controller.setValue" , this._onDriveController );
    this.canvas.$el.removeEventListener( "viewerApp.controller.setOpen" , this._onSetOpen );
    this.canvas.$el.removeEventListener( "viewerApp.canvas.setSliceCrosshair", this._onSetSliceCrosshair );
    if( this.upLoadedFiles ) {
      this.upLoadedFiles.clear();
    }
    // this.canvas.$el.removeEventListener( "viewerApp.subject.changed", this.updateSelectorOptions );
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

    const ctrlChMNI = this.gui.getController( "Affine MNI152" );
    if( !ctrlChMNI.isfake && ctrlChMNI.$input ) {
      const crosshairMNI = this.canvas.getSideCanvasCrosshair( tmpVec3, { "coordSys" : "MNI152" } );
      ctrlChMNI.$input.value = `${crosshairMNI.x.toFixed(1)}, ${crosshairMNI.y.toFixed(1)}, ${crosshairMNI.z.toFixed(1)}`;
    }
    // this.gui.getController( "Affine MNI152" )
    //   .setValue( `${crosshairMNI.x.toFixed(1)}, ${crosshairMNI.y.toFixed(1)}, ${crosshairMNI.z.toFixed(1)}` );

    const ctrlChScan = this.gui.getController( "Crosshair ScanRAS" );
    if( !ctrlChScan.isfake && ctrlChScan.$input ) {
      const crosshairScanner = this.canvas.getSideCanvasCrosshair( tmpVec3, { "coordSys" : "Scanner" } );
      ctrlChScan.$input.value = `${crosshairScanner.x.toFixed(1)}, ${crosshairScanner.y.toFixed(1)}, ${crosshairScanner.z.toFixed(1)}`;
    }

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

      // check controller type
      const classList = controller.domElement.classList;

      // Button
      if( classList.contains( "function" ) ) {
        controller.$button.click();
        return;
      }

      // Color
      if( classList.contains( "color" ) ) {
        controller.setValue(
          asColor( message.value, new Color() ).getHexString()
        );
        return;
      }

      // Boolean
      if( classList.contains( "boolean" ) ) {
        if( message.value ) {
          controller.setValue( true );
        } else {
          controller.setValue( false );
        }
        return;
      }

      // String
      if( classList.contains( "string" ) ) {
        if( typeof message.value === "object" ) {
          controller.setValue( JSON.stringify( message.value ) );
        } else {
          controller.setValue( message.value.toString() );
        }
        return;
      }

      // option
      if( classList.contains( "option" ) ) {
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
      }

      // Number
      if( classList.contains( "number" ) ) {

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
      callback( event );
    });
    if( typeof tooltip === "object" && tooltip !== null ) {
      this.gui.addTooltip(
        tooltip.key,
        tooltip.name,
        tooltip.folderName,
        tooltip.title
      );
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

    controller._values.length = 0;
    controller.$select.innerHTML = "";
    options.forEach(t => {
      const $opt = document.createElement("option");
      $opt.innerHTML = t;
      controller.$select.appendChild( $opt );
      controller._values.push( t );
    });

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

    const position = this.canvas.getSideCanvasCrosshairMNI305( new Vector3() );
    const subject = this.canvas.get_state( "target_subject" );
    const subjectData = this.canvas.shared_data.get( subject );

    // position is in tkrRAS
    data.sliceCrosshair.tkrRAS = vector3ToString( position );

    // position is in Scanner
    position.applyMatrix4( subjectData.matrices.tkrRAS_Scanner );
    data.sliceCrosshair.scannerRAS = vector3ToString( position );

    // position is in MNI-305
    position.applyMatrix4( subjectData.matrices.xfm );
    data.sliceCrosshair.mni305RAS = vector3ToString( position );

    // position is in MNI-152
    position.applyMatrix4( new Matrix4().set(
      0.9975,   -0.0073,  0.0176,   -0.0429,
      0.0146,   1.0009,   -0.0024,  1.5496,
      -0.0130,  -0.0093,  0.9971,   1.1840,
      0,        0,        0,        1
    ) );
    data.sliceCrosshair.mni152RAS = vector3ToString( position );

    if( saveToClipboard ) {
      copyToClipboard( JSON.stringify( data ) );
    }
    return data;
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
ViewerControlCenter = register_controls_localization( ViewerControlCenter );
ViewerControlCenter = registerPresetACPCReAlign( ViewerControlCenter );
ViewerControlCenter = registerPresetQRCode( ViewerControlCenter );
ViewerControlCenter = registerPresetHiddenFeatures( ViewerControlCenter );

export { ViewerControlCenter };
