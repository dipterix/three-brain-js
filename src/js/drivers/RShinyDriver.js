import { Vector3, Matrix4, Color } from 'three';
import { asArray } from '../utility/asArray.js';
import { asColor } from '../utility/color.js';
import { getThreeBrainInstance } from '../geometry/abstract.js';
import { is_electrode } from '../geometry/electrode.js';
import { CONSTANTS } from '../core/constants.js';

// events to $wrapper
// "viewerApp.mouse.click"
// "viewerApp.mainCamera.updated"
// "viewerApp.state.updated"

// [ignored]
// "viewerApp.mouse.enterViewer"
// "viewerApp.mouse.leaveViewer"
// "viewerApp.mouse.mousedown"
// "viewerApp.mouse.mouseup"
// "viewerApp.keyboad.keydown"
// "viewerApp.updateData.start"
"viewerApp.updateData.end"
"viewerApp.subject.changed"

"viewerApp.controller.setValue"
"viewerApp.canvas.setSliceCrosshair"

// controller events
"viewerApp.animationFrame.update"
"viewerApp.mouse.singleClick"
"viewerApp.mouse.doubleClick"
// "viewerApp.keyboad.keydown"
"viewerApp.animationFrame.update"
"viewerApp.controller.change"
"viewerApp.controller.broadcastData"

class RShinyDriver {

  constructor( viewerApp ) {

    this.debug = viewerApp.debug;

    this.isRShinyDriver = true;
    this.app = viewerApp;
    this.canvas = this.app.canvas;
    this.$wrapper = this.app.$wrapper;
    this.containerID = this.app.containerID;
    this.shinyCallbackID = `${ this.containerID }__shiny`;
    this.controllerData = {};

    // check if shiny is valid
    if( typeof window.Shiny !== "object" || window.Shiny === null ||
        typeof window.Shiny.onInputChange !== "function" ) {
      // this is not shiny, just return
      this._shiny = undefined;
      return;
    }

    this._shiny = window.Shiny;

    // register events
    this.$wrapper.addEventListener( "viewerApp.mouse.click", this._onClicked );
    this.$wrapper.addEventListener( "viewerApp.mainCamera.updated", this._onMainCameraUpdated );
    this.$wrapper.addEventListener( "viewerApp.state.updated" , this._onCanvasStateChanged );
    this.$wrapper.addEventListener( "viewerApp.subject.changed" , this._onSubjectChanged );
    this.$wrapper.addEventListener( "viewerApp.updateData.end" , this.rebindControlCenter );

    // Bind shiny
    this._shiny.addCustomMessageHandler(`threeBrain-RtoJS-${this.containerID}`, (data) => {

      if( typeof data.name !== "string" || data.name.length === 0 ) { return; }

      switch (data.name) {
        case 'background':
          this.driveBackground( data.value );
          break;
        case 'title':
          this.driveTitle( data.value );
          break;
        case 'zoom_level':
          this.driveMainCameraZoom( data.value );
          break;
        case 'camera':
          this.driveMainCameraPosition( data.value );
          break;
        case 'display_data':
          this.driveDisplayData( data.value );
          break;
        case 'font_magnification':
          this.driveTextSize( data.value );
          break;
        case 'controllers':
          this.driveController( data.value );
          break;
        case 'focused_electrode':
          this.driveChooseElectrode( data.value );
          break;
        case 'set_plane':
          this.driveSetCrosshair( data.value );
          break;
        case 'set_matrix_world':
          this.driveSetTransform( data.value );
          break;
        case 'set_localization_electrode':
          this.driveSetLocalization( data.value );
          break;
        case 'clear_localization':
          this.driveClearLocalization( data.value );
          break;
        case 'add_localization_electrode':
          this.driveAddLocalization( data.value );
          break;
        case 'set_incoming_localization_hemisphere':
          this.driveSetIncomingLocalizationHemisphere( data.value );
          break;
        default:
          // code
          console.warn(`Unknown Shiny command type: [${data.name}].`);
      }

    });


    this.enabled = true;
    this.debugVerbose("[RShinyDriver] Registered");


  }

  dispose() {
    if( this.app.controlCenter ) {
      try {
        // no need to remove this but just in case...
        this.app.controlCenter.removeEventListener( "viewerApp.controller.change" , this._onControllersUpdated );
        this.app.controlCenter.removeEventListener( "viewerApp.controller.broadcastData" , this._onControllersBroadcast );
      } catch (e) {}
    }
    // remove listeners
    this.$wrapper.removeEventListener( "viewerApp.mouse.click", this._onClicked );
    this.$wrapper.removeEventListener( "viewerApp.mainCamera.updated", this._onMainCameraUpdated );
    this.$wrapper.removeEventListener( "viewerApp.state.updated" , this._onCanvasStateChanged );
    this.$wrapper.removeEventListener( "viewerApp.subject.changed" , this._onSubjectChanged );
    this.$wrapper.removeEventListener( "viewerApp.updateData.end" , this.rebindControlCenter );
  }

  getObjectChosen() {
    const objectChosen = this.canvas.object_chosen;

    if( !objectChosen || !objectChosen.userData ) { return; }

    // World position in tkr-RAS
    const position = objectChosen.getWorldPosition( new Vector3() );

    const instance = getThreeBrainInstance( objectChosen );

    if(!instance) { return; }

    const g = instance._params;
    const groupName = instance.group_name || null;

    const data = {
      object        : g,
      name          : g.name,
      geom_type     : g.type,
      group         : groupName,
      position      : position.toArray(),
      edit_mode     : this.canvas.edit_mode,
      is_electrode  : false,
      current_time  : 0,
      time_range    : [ 0 , 0 ],
    };

    const colorMapName = this.canvas.get_state( 'color_map' );
    if( typeof colorMapName === "string" ) {
      data.current_clip = colorMapName;
      data.color_map = this.canvas.currentColorMap();
    } else {
      data.current_clip = "[none]";
    }

    data.current_time = this.canvas.animParameters.time;
    data.time_range = [
      this.canvas.animParameters.min,
      this.canvas.animParameters.max
    ];

    if( is_electrode(objectChosen) ) {
      const m = CONSTANTS.REGEXP_ELECTRODE.exec( g.name );
      if( m && m.length === 4 ){

        data.subject = m[1];
        data.electrode_number = parseInt( m[2] );
        data.is_electrode = true;
      }
    }

    return data;

  }

  rebindControlCenter = () => {
    // re-bind controller events
    this.app.controlCenter.addEventListener(
      "viewerApp.controller.change" , this._onControllersUpdated )
    this.app.controlCenter.addEventListener(
      "viewerApp.controller.broadcastData" , this._onControllersBroadcast );
  }

  _onControllersUpdated = async ( event ) => {
    const priority = event.priority || "deferred" ;
    const data = {};
    //Object.assign(this.controllerData, this.app.controlCenter.userData);
    this.app.controllerGUI.controllersRecursive()
      .forEach((controller) => {
        if( !controller.isfake ) {
          const value = controller.getValue();
          if( typeof value !== 'function' ) {
            data[ controller._name ] = value;
          }
        }
      });
    this.dispatchToShiny('controllers', data, priority);
  }

  _onControllersBroadcast = async ( event ) => {
    if( typeof event === "object" && typeof event.data === "object" ) {
      const priority = event.priority || "deferred" ;
      for( let key in event.data ) {
        this.dispatchToShiny(key, event.data[ key ], priority);
      }
    }
  }

  _onClicked = async ( event ) => {
    const clickEvent = event.detail;
    if( this.canvas.activated ) {

      const data = this.getObjectChosen();
      if( !data ) { return; }


      if( clickEvent.detail > 1 ) {
        this.dispatchToShiny('mouse_dblclicked', data, 'event');
      } else {
        this.dispatchToShiny('mouse_clicked', data, 'event');
      }
    }
  }

  _onMainCameraUpdated = async () => {

    this.debugVerbose(`Camera updated`);
    // get camera data
    const cameraState = this.canvas.mainCamera.getState();

    this.dispatchToShiny(
      'main_camera',
      {
        target    : cameraState.target,
        position  : cameraState.position,
        up        : cameraState.up,
        zoom      : cameraState.zoom
      }
    );
  }

  _onCanvasStateChanged = async () => {
    const data = Object.fromEntries( this.canvas.state_data );
    for(let k in data) {
      const v = data[k];
      if( v && typeof v === "object" && v.isThreeBrainObject ) {
        delete data[k];
      }
    }
    this.dispatchToShiny('canvas_state', data);
  }

  _onSubjectChanged = async () => {
    const subjectCode = this.canvas.get_state( "target_subject" );
    if( typeof subjectCode !== "string" || subjectCode === "" || subjectCode === "/" ) {
      return;
    }
    const subjectData = this.canvas.shared_data.get( subjectCode );
    if( typeof subjectData !== "object" || subjectData === null ) { return; }

    this.dispatchToShiny(
      'current_subject',
      {
        subject_code: subjectCode,
        Norig: subjectData.Norig,
        Torig: subjectData.Torig,
        xfm: subjectData.xfm
      }
    );
  }

  dispatchToShiny( name , value , priority = "deferred" ) {

    if( !this.enabled ){ return; }

    this.debugVerbose(`Sending data [${name}] to shiny app...`)
    // make sure shiny exists and is connected
    if( !this._shiny || !this._shiny.shinyapp.$socket ) { return; }
    const inputId = `${ this.containerID }_${ name }`;
    console.debug(`Dispatching to shiny with priority ${ priority }: ${ name }`);
    this._shiny.setInputValue(inputId, value, { priority : priority });
  }

  debugVerbose = ( message ) => {
    if( this.debug ) {
      console.debug( message );
    }
  };

  driveBackground( color ) {
    const c = asColor( color, new Color() );
    const controller = this.app.controllerGUI.getController('Background Color');
    controller.setValue( color );
  }

  driveTitle( title ) {
    if( typeof title === "string" ) {
      this.canvas.title = title;
    } else {
      this.canvas.title = "";
    }
    this.canvas.needsUpdate = true;
  }

  driveMainCameraZoom( zoomLevel ) {
    this.canvas.mainCamera.setZoom({ zoom : zoomLevel, updateProjection : true });
  }
  driveMainCameraPosition({ position, up } = {}) {
    // force position & up to be arrays
    position = asArray( position );
    up = asArray( up );
    if( position.length === 3 ) {
      this.canvas.mainCamera.position.fromArray( position );
    }
    if( up.length === 3 ){
      this.canvas.mainCamera.up.fromArray( up );
    }
    this.canvas.mainCamera.updateProjectionMatrix();
    this.canvas.needsUpdate = true;
  }
  driveDisplayData ({ variable , range } = {}) {
    if( typeof variable === 'string' && variable !== '' ){
      const controller = this.controllerGUI.getController( 'Display Data' );
      if( controller._names.includes( variable ) ) {
        controller.setValue( variable );
      }
    }

    range = asArray( range );
    if( range.length === 2 ){
      this.controllerGUI
        .getController( 'Display Range' )
        .setValue(`${range[0].toPrecision(5)},${range[1].toPrecision(5)}`);
    }
    this.canvas.needsUpdate = true;
  }
  driveTextSize( size ) {
    if( typeof size === 'number' && !isNaN( size ) ) {
      this.canvas.setFontSize( size );
      this.canvas.needsUpdate = true;
    }
  }
  driveController( data ) {
    if( typeof data !== "object" || data === null ) { return; }
    for( let name in data ) {
      this.$wrapper.dispatchEvent(new CustomEvent(
        "viewerApp.controller.setValue",
        { detail: { name: name , value : data[ name ] } }
      ));
    }
  }
  driveSetCrosshair({ x, y, z, centerCrosshair = true } = {}) {
    this.canvas.setSliceCrosshair({ x : x , y : y , z : z, centerCrosshair : centerCrosshair });
  }
  driveSetVoxelRenderDistance({ distance }) {
    if( typeof distance === "number" ) {
      distance = { near: distance, far : distance };
    } else if (Array.isArray( distance )) {
      const near = distance[0],
            far = distance[1];
      distance = { near: near, far : far };
    } else if ( distance && typeof distance === "object" ) {
      distance = { near: distance.near, far : distance.far };
    }
    this.canvas.setVoxelRenderDistance({ distance : distance });
  }
  driveChooseElectrode({ subjectCode, electrodeNumber } = {}) {

    if( typeof subjectCode !== "string" || electrodeNumber === undefined ) {
      return;
    }
    // this.canvas.electrodes.get("YAB")["YAB, 14 - G14"]
    subjectCode = subjectCode.trim();
    const namePrefix = `${subjectCode}, ${electrodeNumber} `;
    const meshCollection = this.canvas.electrodes.get( subjectCode );
    if( typeof meshCollection !== 'object' ) { return; }
    for( let name in meshCollection ) {
      if( name.startsWith( namePrefix ) ) {
        const mesh = meshCollection[ name ];
        if( is_electrode( mesh ) ) {
          this.canvas.focusObject( mesh, { helper : true } );
          this.canvas.needsUpdate = true;
          return;
        }
      }
    }

  }

  driveSetTransform({ instanceName, matrix, byrow = true } = {}) {
    const m44 = new Matrix4();
    if( byrow ) {
      m44.set(...matrix);
    } else {
      m44.fromArray( matrix );
    }
    const instance = this.canvas.threebrain_instances.get( instanceName );
    instance.useMatrix4( m44 );
    if( instance.transforms.model2tkr.isMatrix4 ) {
      instance.transforms.model2tkr.copy( m44 );
      instance.resetBuiltinTransforms();
    }

  }

  // localization
  driveSetLocalization({ which, params, update_shiny = false }) {
    this.app.controlCenter.localizeSetElectrode( which, params, update_shiny);
  }

  driveClearLocalization( updateShiny ) {
    this.app.controlCenter.clearLocalization( updateShiny );
  }

  driveSetIncomingLocalizationHemisphere( hemisphere ) {
    if( typeof hemisphere !== "string" || hemisphere.length === 0 ) {
      hemisphere = "auto";
    } else {
      hemisphere = hemisphere.toLowerCase();
    }
    if( hemisphere[0] === "l" ) {
      this.app.canvas.set_state("newElectrodesHemisphere", "left");
    } else if ( hemisphere[0] === "r" ) {
      this.app.canvas.set_state("newElectrodesHemisphere", "right");
    } else {
      this.app.canvas.set_state("newElectrodesHemisphere", "auto");
    }
  }

  driveAddLocalization( args = {} ) {

    this.enabled = false;

    const argsCopy = { ...args };
    argsCopy.mode = argsCopy.mode ?? "CT/volume";
    argsCopy.fireEvents = false;

    try {
      this.app.controlCenter.dispatcherEnabled = false;
      // const el =
      if( argsCopy.is_prototype ) {
        this.app.controlCenter.localizeAddPrototype( argsCopy );
      } else {
        this.app.controlCenter.localizeAddElectrode( argsCopy );
      }
    } catch (e) {

    } finally {
      this.app.controlCenter.dispatcherEnabled = true;
    }

    this.enabled = true;
  }

}


export { RShinyDriver };
