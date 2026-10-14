import { Vector3, Matrix4, Color } from 'three';
import { asArray } from '../utility/asArray.js';
import { asColor } from '../utility/color.js';
import { getThreeBrainInstance } from '../geometry/abstract.js';
import { is_electrode } from '../geometry/electrode.js';
import { TextDecor } from '../geometry/textdecor.js';
import {
  CONTROLLER_VALUE_CHANGED, CONTROLLER_SPEC_CHANGED
} from '../core/EnhancedGUIController.js';

// Controller values and specs are reported once the control panel has been
// quiet this long (ms). Handlers that do not broadcast, and crosshair clicks on
// the slices, would otherwise leave the receiver with stale values
const CONTROLLER_REPORT_DELAY = 500;

/**
 * Commands a driver accepts: name -> the `drive*` method that applies it. The
 * names and value shapes are the ones R's `ViewerProxy` sends, whatever the
 * transport (Shiny custom messages, a WebSocket).
 */
const COMMANDS = {
  background                          : { method: "driveBackground",
    doc: "Background color, e.g. \"#000000\"" },
  title                               : { method: "driveTitle",
    doc: "Title shown over the viewer; \"\" clears it" },
  zoom_level                          : { method: "driveMainCameraZoom",
    doc: "Main camera zoom, a number > 0" },
  camera                              : { method: "driveMainCameraPosition",
    doc: "{ position: [x, y, z], up: [x, y, z] }: camera position (distance 500) and up direction" },
  display_data                        : { method: "driveDisplayData",
    doc: "{ variable: name, range: [min, max] }: data shown on the electrodes and its color range" },
  set_electrode_data                  : { method: "driveSetElectrodeData",
    doc: "{ data, palettes, valueRanges, clearFirst, updateDisplay, override }: electrode values; data has columns Electrode, optional Subject and Time, and one column per variable" },
  set_electrode_palette               : { method: "driveSetElectrodePalette",
    doc: "{ colors: [colors], name: variable }: color palette of a variable" },
  font_magnification                  : { method: "driveTextSize",
    doc: "Text size factor, a number" },
  controllers                         : { method: "driveController",
    doc: "{ <control panel name>: value }: sets control panel values (get_input \"controller_specs\" lists them)" },
  focused_electrode                   : { method: "driveChooseElectrode",
    doc: "{ subject_code, electrode }: selects one electrode contact" },
  set_plane                           : { method: "driveSetCrosshair",
    doc: "{ x, y, z }: moves the slice crosshair (tkrRAS, mm)" },
  set_matrix_world                    : { method: "driveSetTransform", destructive: true,
    doc: "{ instanceName, matrix: [16 numbers], byrow }: replaces an object's transform" },
  set_localization_electrode          : { method: "driveSetLocalization", destructive: true,
    doc: "{ which, params }: edits a localized electrode" },
  clear_localization                  : { method: "driveClearLocalization", destructive: true,
    doc: "Removes every localized electrode" },
  add_localization_electrode          : { method: "driveAddLocalization", destructive: true,
    doc: "{ Coord_x, Coord_y, Coord_z, Hemisphere, ... }: adds a localized electrode" },
  set_incoming_localization_hemisphere: { method: "driveSetIncomingLocalizationHemisphere",
    doc: "\"left\", \"right\" or \"auto\": hemisphere of electrodes localized next" },
  text_decoration_set                 : { method: "driveTextDecorationSet",
    doc: "{ id, text, position: [x, y, z], font_size, color, layer }: creates or updates a text label" },
  text_decoration_delete              : { method: "driveTextDecorationDelete",
    doc: "{ id: id or [ids] }: deletes text labels" },
};

// Viewer state a driver can report on request (`getInput()`), named like the
// inputs the Shiny driver sends
const INPUTS = [
  "controllers", "controller_specs", "main_camera", "canvas_state", "current_subject",
  "text_decorations", "localization_table", "mouse_clicked",
];

class DriverError extends Error {
  constructor( code, message ) {
    super( message );
    this.code = code;
  }
}

/**
 * Applies commands to a viewer and reports what happens in it. Transports
 * (Shiny, a WebSocket) subclass this, call `listen()` once they can send, and
 * implement `emit( name, value, priority )`.
 */
class ViewerDriver {

  constructor( viewerApp ) {
    this.debug = viewerApp.debug;
    this.app = viewerApp;
    this.canvas = this.app.canvas;
    this.$wrapper = this.app.$wrapper;
    this.containerID = this.app.containerID;
    this.controllerData = {};
    this.enabled = false;
  }

  // ---- what the driver accepts ---------------------------------------------

  hasCommand( name ) {
    return Object.prototype.hasOwnProperty.call( COMMANDS, name );
  }

  /** Applies one command; throws `DriverError` with code `unknown_command`. */
  runCommand( name, value ) {
    if( !this.hasCommand( name ) ) {
      throw new DriverError( "unknown_command", `Unknown command "${ name }"` );
    }
    const result = this[ COMMANDS[ name ].method ]( value );
    // the viewer only draws when asked; some commands did not ask
    this.canvas.needsUpdate = true;
    return result;
  }

  describeCommands() {
    return Object.entries( COMMANDS ).map(([ name, spec ]) => ({
      name, description: spec.doc, destructive: !!spec.destructive,
    }));
  }

  // ---- listening ------------------------------------------------------------

  /** Registers the listeners that report viewer events through `emit()`. */
  listen() {
    if( this._listening ) { return; }
    this._listening = true;
    this.$wrapper.addEventListener( "viewerApp.mouse.click", this._onClicked );
    this.$wrapper.addEventListener( "viewerApp.canvas.objectFocused", this._onObjectFocused );
    this.$wrapper.addEventListener( "viewerApp.mainCamera.updated", this._onMainCameraUpdated );
    this.$wrapper.addEventListener( "viewerApp.state.updated" , this._onCanvasStateChanged );
    this.$wrapper.addEventListener( "viewerApp.subject.changed" , this._onSubjectChanged );
    this.$wrapper.addEventListener( "viewerApp.updateData.end" , this.rebindControlCenter );
  }

  dispose() {
    clearTimeout( this._controllersTimer );
    clearTimeout( this._controllerSpecsTimer );
    this.enabled = false;
    if( this.app.controlCenter ) {
      try {
        this.app.controlCenter.removeEventListener( "viewerApp.controller.change" , this._onControllersUpdated );
        this.app.controlCenter.removeEventListener( "viewerApp.controller.broadcastData" , this._onControllersBroadcast );
      } catch (e) {}
    }
    if( this.app.controllerGUI ) {
      try {
        this.app.controllerGUI.removeEventListener( CONTROLLER_VALUE_CHANGED, this._scheduleControllersUpdate );
        this.app.controllerGUI.removeEventListener( CONTROLLER_SPEC_CHANGED, this._scheduleControllerSpecsUpdate );
      } catch (e) {}
    }
    this.$wrapper.removeEventListener( "viewerApp.mouse.click", this._onClicked );
    this.$wrapper.removeEventListener( "viewerApp.canvas.objectFocused", this._onObjectFocused );
    this.$wrapper.removeEventListener( "viewerApp.mainCamera.updated", this._onMainCameraUpdated );
    this.$wrapper.removeEventListener( "viewerApp.state.updated" , this._onCanvasStateChanged );
    this.$wrapper.removeEventListener( "viewerApp.subject.changed" , this._onSubjectChanged );
    this.$wrapper.removeEventListener( "viewerApp.updateData.end" , this.rebindControlCenter );
    this._listening = false;
  }

  /** Sends one input/event; subclasses implement it. */
  emit( name, value, priority = "deferred" ) {
    throw new Error( "ViewerDriver.emit() is implemented by the transport" );
  }

  debugVerbose = ( message ) => {
    if( this.debug ) {
      console.debug( message );
    }
  };

  // ---- reporting ------------------------------------------------------------

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
      subject       : instance.subject_code
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

      data.is_electrode = true;

      if( instance.isElectrodePrototype ) {

        const contact = instance.contactCenter[ instance.state.focusedContact ];
        data.electrode_number = contact.chanNum;
        data.position = instance.state.contactPositions.tkrRAS.toArray();
        data.isElectrodePrototype = true;

        data.object = {
          "name"  : g.name,
          "type"  : "electrode",
          "position"  : data.position,
          "group" :{
            "group_name" : groupName
          },
          "subject_code" : instance.subject_code,
          "subtype" : "CustomGeometry",
          "radius"  : contact.radius,
          "prototype_name"  : instance.protoName,
          "is_electrode"    : true,
          "use_template"    : g.use_template,
          "surface_type"    : g.surface_type,
          "hemisphere"      : g.hemisphere,
          "MNI305_position" : instance.state.contactPositions.mni305.toArray(),
          "MNI152_position" : instance.state.contactPositions.mni152.toArray(),
          "scanner_position": instance.state.contactPositions.scanner.toArray(),
          "number"          : data.electrode_number,
        };

      } else {

        data.electrode_number = instance.numbers[0];

        data.object = {
          "name"  : g.name,
          "type"  : "electrode",
          "position"  : data.position,
          "group" :{
            "group_name" : groupName
          },
          "subject_code" : instance.subject_code,
          "subtype" : "SphereGeometry",
          "radius"  : g.radius,
          "prototype_name"  : null,
          "is_electrode"    : true,
          "use_template"    : g.use_template,
          "surface_type"    : g.surface_type,
          "hemisphere"      : g.hemisphere,
          "MNI305_position" : instance.state.contactPositions.mni305.toArray(),
          "MNI152_position" : instance.state.contactPositions.mni152.toArray(),
          "scanner_position": instance.state.contactPositions.scanner.toArray(),
          "number"          : data.electrode_number,
        };

      }

    }

    return data;

  }

  // Controllers flagged `_localOnly` (the Remote Control fields) belong to this
  // browser, not to the viewer's state, and are never reported
  _reportedControllers() {
    return this.app.controllerGUI.controllersRecursive()
      .filter(( controller ) => !controller.isfake && !controller._localOnly );
  }

  // `controller_specs`: what each controller accepts, keyed by its name (an
  // object, because shiny flattens arrays sent as input values)
  collectControllerSpecs() {
    const specs = {};
    this._reportedControllers()
      .forEach((controller) => {
        const spec = {
          name     : controller._name,
          folder   : controller._folder._fullPaths.join(">"),
          type     : controller._type,
          hidden   : controller._hidden,
          disabled : controller._disabled
        };
        if( controller._isSelector ) {
          spec.choices = controller._names ?? [];
          spec.values = controller._values ?? [];
        }
        if( controller._min !== undefined ) { spec.min = controller._min; }
        if( controller._max !== undefined ) { spec.max = controller._max; }
        if( controller._step !== undefined ) { spec.step = controller._step; }
        specs[ controller._name ] = spec;
      });
    return specs;
  }

  collectControllers() {
    const data = {};
    this._reportedControllers()
      .forEach((controller) => {
        const value = controller.getValue();
        if( typeof value !== 'function' ) {
          data[ controller._name ] = value;
        }
      });
    return data;
  }

  collectMainCamera() {
    const cameraState = this.canvas.mainCamera.getState();
    return {
      target    : cameraState.target,
      position  : cameraState.position,
      up        : cameraState.up,
      zoom      : cameraState.zoom
    };
  }

  collectCanvasState() {
    const data = Object.fromEntries( this.canvas.state_data );
    for(let k in data) {
      const v = data[k];
      if( v && typeof v === "object" && v.isThreeBrainObject ) {
        delete data[k];
      }
    }
    return data;
  }

  collectCurrentSubject() {
    const subjectCode = this.canvas.get_state( "target_subject" );
    if( typeof subjectCode !== "string" || subjectCode === "" || subjectCode === "/" ) {
      return;
    }
    const subjectData = this.canvas.shared_data.get( subjectCode );
    if( typeof subjectData !== "object" || subjectData === null ) { return; }
    return {
      subject_code: subjectCode,
      Norig: subjectData.Norig,
      Torig: subjectData.Torig,
      xfm: subjectData.xfm
    };
  }

  collectTextDecorations() {
    const summaries = [];
    this.canvas.textDecorators.forEach((inst) => {
      summaries.push( inst.toSummary() );
    });
    return summaries;
  }

  /** The viewer state the Shiny driver would send as input `name`. */
  getInput( name ) {
    switch ( name ) {
      case "controllers": return this.collectControllers();
      case "controller_specs": return this.collectControllerSpecs();
      case "main_camera": return this.collectMainCamera();
      case "canvas_state": return this.collectCanvasState();
      case "current_subject": return this.collectCurrentSubject() ?? null;
      case "text_decorations": return this.collectTextDecorations();
      case "localization_table": return JSON.stringify( this.canvas.electrodes_info() );
      case "mouse_clicked": return this.getObjectChosen() ?? null;
      default:
        throw new DriverError( "bad_value",
          `Unknown input "${ name }"; one of: ${ INPUTS.join(", ") }` );
    }
  }

  /**
   * The viewer state: `controllers` (panel values by name, as in the
   * `controllers` input), `sliceCrosshair`, `cameraState`, `currentSubject`, and
   * `controllerData` (the panel's own nested save format).
   */
  getState() {
    const state = this.app.controlCenter.getControllerData();
    state.controllers = this.collectControllers();
    state.currentSubject = this.collectCurrentSubject() ?? null;
    return state;
  }

  rebindControlCenter = () => {
    // re-bind controller events
    this.app.controlCenter.addEventListener(
      "viewerApp.controller.change" , this._onControllersUpdated )
    this.app.controlCenter.addEventListener(
      "viewerApp.controller.broadcastData" , this._onControllersBroadcast );
    // the control panel is rebuilt with each data update: listen to the new one
    const gui = this.app.controllerGUI;
    gui.addEventListener( CONTROLLER_VALUE_CHANGED, this._scheduleControllersUpdate );
    gui.addEventListener( CONTROLLER_SPEC_CHANGED, this._scheduleControllerSpecsUpdate );

    // report the initial controller values
    this._onControllersUpdated({ priority : "deferred" });
    this._onControllerSpecsUpdated();
  }

  _scheduleControllersUpdate = () => {
    clearTimeout( this._controllersTimer );
    this._controllersTimer = setTimeout( () => {
      this._onControllersUpdated({ priority : "deferred" });
    }, CONTROLLER_REPORT_DELAY );
  }

  _scheduleControllerSpecsUpdate = () => {
    clearTimeout( this._controllerSpecsTimer );
    this._controllerSpecsTimer = setTimeout(
      this._onControllerSpecsUpdated, CONTROLLER_REPORT_DELAY );
  }

  _onControllerSpecsUpdated = () => {
    this.emit('controller_specs', this.collectControllerSpecs(), "deferred");
  }

  _onControllersUpdated = async ( event ) => {
    const priority = event.priority || "deferred" ;
    this.emit('controllers', this.collectControllers(), priority);
  }

  _onControllersBroadcast = async ( event ) => {
    if( typeof event === "object" && typeof event.data === "object" ) {
      const priority = event.priority || "deferred" ;
      for( let key in event.data ) {
        this.emit(key, event.data[ key ], priority);
      }
    }
  }

  _onClicked = async ( event ) => {
    const clickEvent = event.detail;
    if( this.canvas.activated ) {

      const data = this.getObjectChosen();
      if( !data ) { return; }


      if( clickEvent.detail > 1 ) {
        this.emit('mouse_dblclicked', data, 'event');
      } else {
        this.emit('mouse_clicked', data, 'event');
      }
    }
  }

  /**
   * Focus mode (hold F) picked something.
   *
   * Deliberately its own input rather than riding on `mouse_clicked`: focus mode
   * does not change the selection, so apps listening for clicks should not see
   * it. The payload is a flat record of identifiers and values -- no instance,
   * no `Object3D`, no `_params` blob -- with 1-based indices for R.
   */
  _onObjectFocused = async ( event ) => {
    if( !this.canvas.activated ) { return; }
    // `ThrottledEventDispatcher` puts the payload straight on `detail`
    const data = event.detail;
    if( !data ) { return; }
    this.emit( 'mouse_focused', data, 'event' );
  }

  _onMainCameraUpdated = async () => {
    this.debugVerbose(`Camera updated`);
    this.emit( 'main_camera', this.collectMainCamera() );
  }

  _onCanvasStateChanged = async () => {
    this.emit('canvas_state', this.collectCanvasState());
  }

  _onSubjectChanged = async () => {
    const subject = this.collectCurrentSubject();
    if( !subject ) { return; }
    this.emit( 'current_subject', subject );
  }

  // ---- commands ---------------------------------------------------------------

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
    // the control panel is rebuilt with each data update: always ask the app
    const gui = this.app.controllerGUI;
    if( typeof variable === 'string' && variable !== '' ){
      const controller = gui.getController( 'Display Data' );
      if( !controller.isfake && controller._names.includes( variable ) ) {
        controller.setValue( variable );
      }
    }

    range = asArray( range );
    if( range.length === 2 ){
      gui
        .getController( 'Display Range' )
        .setValue(`${range[0].toPrecision(5)},${range[1].toPrecision(5)}`);
    }
    this.canvas.needsUpdate = true;
  }

  driveSetElectrodeData({
    data, palettes = {}, valueRanges = {},
    clearFirst = false, updateDisplay = true,
    override = false
  } = {}) {
    if( !data ) { return; }
    if( !Array.isArray( data ) ) {
      if( typeof data !== "object" ) { return; }
      // this could be data.frame but column-major
      const _data = data;
      const columnNames = Object.keys( _data );
      const nrow = _data[ columnNames[0] ].length;

      data = [];
      for( let i = 0; i < nrow ; i++ ) {
        const row = {};
        columnNames.forEach(nm => {
          row[ nm ] = _data[ nm ][ i ];
        });
        data.push( row );
      }
    }
    if( !Array.isArray( data ) || data.length === 0 ) { return; }
    if( clearFirst ) {
      this.canvas.colorMaps.clear();
    }
    this.app.updateElectrodeData({
      data : data,
      palettes : palettes,
      valueRanges : valueRanges,
      updateDisplay : updateDisplay,
      override : override,
    });
    this.canvas.needsUpdate = true;
  }

  driveSetElectrodePalette({ colors, name } = {}) {
    this.canvas.setColorMapControlColors( colors, name );
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
  driveChooseElectrode({
    subjectCode, electrodeNumber,
    // names sent by R's `set_focused_electrode`
    subject_code, electrode
  } = {}) {

    subjectCode = subjectCode ?? subject_code;
    electrodeNumber = electrodeNumber ?? electrode;
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

  // ---- Text decoration helpers -------------------------------------------

  /**
   * Collect summaries of all current text decorations and push them out.
   */
  _syncTextDecorations() {
    this.emit( "text_decorations", this.collectTextDecorations() );
  }

  /**
   * Create or update a text decoration.
   * @param {object} params
   * @param {string}   params.id         - stable decoration ID
   * @param {string}   [params.text]     - label text
   * @param {number[]} [params.position] - [x, y, z] in world space
   * @param {number}   [params.font_size]- world-space height
   * @param {string}   [params.color]    - CSS colour string
   * @param {number|number[]} [params.layer] - camera layer(s)
   */
  driveTextDecorationSet({ id, text, position, font_size, color, layer } = {}) {
    if ( typeof id !== 'string' || id.length === 0 ) { return; }

    const existing = this.canvas.textDecorators.get( id );

    if ( existing ) {
      // Update in place.
      if ( typeof text === 'string' )           { existing.setText( text ); }
      if ( Array.isArray( position ) && position.length === 3 ) {
        existing.setPosition( position[0], position[1], position[2] );
      }
      if ( typeof font_size === 'number' && font_size > 0 ) {
        existing.setFontSize( font_size );
      }
      if ( typeof color === 'string' )          { existing.setColor( color ); }
    } else {
      // Build a minimal geometry-params object and create a new TextDecor.
      const g = {
        name        : `__text_decor_${id}__`,
        type        : 'textdecor',
        decor_id    : id,
        text        : typeof text === 'string'   ? text      : '',
        font_size   : typeof font_size === 'number' && font_size > 0 ? font_size : 5,
        color       : typeof color === 'string'  ? color     : '#ffffff',
        position    : Array.isArray( position ) && position.length === 3
                        ? position : [0, 0, 0],
        layer       : layer != null ? layer : [1],
        clickable   : false,
        subject_code: '',
        group       : null,
        trans_mat   : null,
        disable_trans_mat: false,
        render_order: 1
      };
      new TextDecor( g, this.canvas );
    }

    this.canvas.needsUpdate = true;
    this._syncTextDecorations();
  }

  /**
   * Delete one or more text decorations by ID.
   * @param {object} params
   * @param {string|string[]} params.id - decoration ID or array of IDs
   */
  driveTextDecorationDelete({ id } = {}) {
    const ids = Array.isArray( id ) ? id : ( typeof id === 'string' ? [id] : [] );
    ids.forEach( (decorId) => {
      const inst = this.canvas.textDecorators.get( decorId );
      if ( inst ) {
        inst._dispose();
      }
    });
    this.canvas.needsUpdate = true;
    this._syncTextDecorations();
  }

}


export { ViewerDriver, DriverError, COMMANDS, INPUTS };
