import { EventDispatcher } from 'three';
import { Pane } from 'tweakpane';
import * as EssentialsPlugin from '@tweakpane/plugin-essentials';
import { to_array, to_dict } from '../utils.js';
import { EnhancedGUIController, COLOR_FALLBACK, normalizeColor } from './EnhancedGUIController.js';

const _openEvent = { type: 'open' };
const _closeEvent = { type: 'close' };

/**
 * The viewer's control panel: path-addressed folders ("A > B > C"), a
 * name-keyed controller registry, and open/close events carrying the folder
 * path.
 *
 * Backed by Tweakpane. The root wraps a `Pane`, a child folder wraps a
 * `FolderApi`; both expose the same container API, which is why one class can
 * serve as both. Controllers are `EnhancedGUIController`, which keeps the
 * lil-gui-shaped API the presets and the R driver were written against.
 */
class EnhancedGUI {

  constructor(args = {}){
    this.isEnhancedGUI = true;

    this.parent = args.parent;
    this._title = args.title;
    this._closed = false;

    this.folders = [];
    this.controllers = [];

    // everything is controlled here
    this.object = {};

    if( this.parent === undefined ) {
      this.__eventDispather = new EventDispatcher();
      this._fullPaths = [];

      // Tweakpane appends its own wrapper to `document.body` unless given a
      // container, and that wrapper is positioned as a floating panel. The
      // viewer places the panel itself, so hand it a container of our own and
      // let `domElement` be that container, so the whole pane moves as one.
      this.$container = document.createElement('div');
      this.$container.classList.add('threejs-control-pane');

      this._pane = new Pane({
        container : this.$container,
        title     : args.title,
        expanded  : true,
      });
      // Register plugin to the pane
      this._pane.registerPlugin(EssentialsPlugin);

      if( args.logoElement ) {
        // ---- Logo -----
        const logo = this.addFolder("_logo_");
        logo._pane.element.replaceWith( args.logoElement );
      }

      this.addFolder('Default');

    } else {
      this.__eventDispather = this.parent.__eventDispather;
      this._fullPaths = [...this.parent._fullPaths];
      this._fullPaths.push( this._title );

      this._pane = this.parent._pane.addFolder({
        title    : args.title,
        expanded : false,
      });
      this._closed = true;
    }

    // keep `_closed` honest when the user clicks the title bar
    this._pane.on( 'fold', ( event ) => {
      this._closed = !event.expanded;
      this._dispatchEvent( this._closed ? _closeEvent : _openEvent );
    });
  }

  get domElement() {
    // root: our own container, so the pane moves as one element;
    // child folder: the folder's own row
    return this.$container ?? this._pane.element;
  }

  get isFocused() {
    // lil-gui tracked a focus flag per controller; the panel's own DOM already
    // knows, and this stays correct across controller rebuilds
    const active = document.activeElement;
    return !!active && this.domElement.contains( active ) &&
      /^(INPUT|SELECT|TEXTAREA)$/.test( active.tagName );
  }

  blurAll() {
    const active = document.activeElement;
    // a <select> cannot be blurred here, or its option list will not appear
    if( active && active.tagName !== 'SELECT' && this.domElement.contains( active ) ) {
      active.blur();
    }
  }

  _dispatchEvent ( event ) {
    event.folderPath = this._fullPaths.join(">");
    this.__eventDispather.dispatchEvent( event );
  }
  dispatchEvent = ( event ) => {
    this._dispatchEvent( event );
  }
  addEventListener = ( type, callback ) => {
    this.__eventDispather.addEventListener( type, callback );
  }
  removeEventListener = ( type, callback ) => {
    this.__eventDispather.removeEventListener( type, callback );
  }

  show( visible = true ) {
    if( this.$container ) {
      // hide the container too, or an empty box is left behind
      this.$container.style.display = visible ? '' : 'none';
    }
    this._pane.hidden = !visible;
    return this;
  }
  hide() {
    return this.show( false );
  }

  dispose() {
    this.destroy();
  }

  destroy() {
    this.folders.forEach( folder => { folder.destroy(); });
    this.folders.length = 0;
    this.controllers.length = 0;
    if( this.parent ) {
      this.parent._forgetFolder( this );
    }
    try { this._pane.dispose(); } catch (e) {}
  }

  _forgetFolder( folder ) {
    const i = this.folders.indexOf( folder );
    if( i >= 0 ) { this.folders.splice( i, 1 ); }
  }
  _forgetController( controller ) {
    const i = this.controllers.indexOf( controller );
    if( i >= 0 ) { this.controllers.splice( i, 1 ); }
  }

  set closed( is_closed ){
    if( is_closed ) {
      this.close();
    } else {
      this.open();
    }
  }
  get closed(){
    return this._closed;
  }

  /**
   * Tweakpane animates folds itself, so this is `open` -- kept because the
   * presets and ViewerControlCenter call it by name.
   */
  openAnimated( open = true ){
    return this.open( open );
  }

  open( open = true ) {
    this._closed = !open;
    // the `fold` listener dispatches open/close
    this._pane.expanded = open;
    return this;
  }

  close() {
    return this.open( false );
  }

  controllersRecursive() {
    const result = [ ...this.controllers ];
    this.folders.forEach( folder => {
      result.push( ...folder.controllersRecursive() );
    });
    return result;
  }

  foldersRecursive() {
    const result = [ ...this.folders ];
    this.folders.forEach( folder => {
      result.push( ...folder.foldersRecursive() );
    });
    return result;
  }

  /**
   * The panel's state, as `{ controllers: { name: value }, folders: { title: ... } }`.
   *
   * This is what "Copy Controller State" writes and what a dropped
   * `isThreeBrainControllerData` JSON carries, so the shape is a file format:
   * folders keyed by title all the way down, buttons left out because they hold
   * no state.
   *
   * @param recursive pass false to record this folder's own controllers only
   */
  save( recursive = true ) {
    const obj = { controllers: {}, folders: {} };

    this.controllers.forEach( controller => {
      if( controller._isFunction || controller._isGraph ) { return; }
      obj.controllers[ controller._name ] = controller.save();
    });

    if( recursive ) {
      this.folders.forEach( folder => {
        obj.folders[ folder._title ] = folder.save( recursive );
      });
    }

    return obj;
  }

  /**
   * Restores values recorded by `save()`. Anything the state does not mention is
   * left as it is, so an older state file still loads into a newer viewer.
   *
   * @param recursive pass false to restore this folder's own controllers only
   */
  load( obj, recursive = true ) {
    if( !obj || typeof obj !== "object" ) { return this; }

    if( obj.controllers ) {
      this.controllers.forEach( controller => {
        if( controller._isFunction || controller._isGraph ) { return; }
        if( controller._name in obj.controllers ) {
          controller.load( obj.controllers[ controller._name ] );
        }
      });
    }

    if( recursive && obj.folders ) {
      this.folders.forEach( folder => {
        if( folder._title in obj.folders ) {
          folder.load( obj.folders[ folder._title ] );
        }
      });
    }

    return this;
  }

	// folders
  addFolder( title ){
    const subTitles = title.split(">")
      .map(v => { return v.trim(); });
    const folderName = subTitles.splice(0, 1)[0];

    // try to find from existing folders
    const existingFolders = this.folders.filter( folder => {
      return folder._title === folderName;
    })
    let currentFolder;
    if( existingFolders.length > 0 ) {
      currentFolder = existingFolders[0];
    } else {
      currentFolder = new EnhancedGUI( {
        parent: this, title : folderName
      });
      this.folders.push( currentFolder );
      currentFolder.close();
    }

    if( subTitles.length === 0 ) {
      return currentFolder;
    }
    return currentFolder.addFolder( subTitles.join(">") );
  }
  openFolder( title, animated = true, open = true ){
    const subTitles = title.split(">")
      .map(v => { return v.trim(); });
    const folderName = subTitles.splice(0, 1)[0];
    this.folders.forEach( folder => {
      if( folder._title === folderName ) {
        folder.open( open );
        folder.openFolder( subTitles.join(">"), animated );
      }
    })
  }
  closeFolder( title, animated = true ){
    this.openFolder( title, animated, false );
  }
  getFolder( title ) {
    if( !title || title.length === 0 ) { return this; }
    if( !Array.isArray(title) ) {
      title = title.split(">").map(v => { return v.trim(); });
    }
    const folderName = title.splice(0, 1)[0];
    for(let i in this.folders) {
      const folder = this.folders[i];
      if( folder._title === folderName ) {
        return folder.getFolder( title );
      }
    }
    return;
  }

  /**
   * Resolves a `folderName` / `folder_name` option to a folder, creating it if
   * it does not exist. An empty name means this folder, except at the root,
   * where it means "Default" -- the same rule `addController` follows.
   */
  _resolveFolder( options = {} ) {
    const path = ( options.folderName ?? options.folder_name ?? "" )
      .split(">").map(v => v.trim()).filter(v => v !== "");

    if( path.length === 0 ) {
      return this.parent === undefined ? this.addFolder("Default") : this;
    }
    return this.addFolder( path.join(">") );
  }

  /**
   * Draws a horizontal rule in a folder, to group the controllers around it.
   *
   * A separator is decoration rather than a controller: it is not registered,
   * so it stays out of the controller registry, out of `getController`, and out
   * of `save()`. Returns the blade, so a caller can hide or dispose it.
   */
  addSeparator( options = {} ) {
    if( !options || typeof options !== "object" ) { options = {}; }
    const folder = this._resolveFolder( options );
    return folder._pane.addBlade({ view: 'separator' });
  }

  /**
   * Adds a line plot row, for showing a series against time.
   *
   * Takes the same options as `addController`. The controller's value is the
   * current time, so `setValue( t )` moves the cursor; the series comes from
   * `setData( values, times )`, and the y-range follows the data until `min()`
   * or `max()` set one.
   *
   *   const graph = gui.addLineGraph('Display Data (Graph)', { folderName });
   *   graph.setData( values, times );
   *   graph.setValue( currentTime );
   */
  addLineGraph( name, options ) {
    if( !options || typeof options !== "object" ) { options = {}; }
    return this.addController( name, 0, { ...options, type : "linegraph" } );
  }

  // items
  addController( name, value, options ) {
    if( !options || typeof options !== "object" ) {
      options = {};
    }
    let fullPath = (options.folderName || options.folder_name || "") + ">" + name;
    fullPath = fullPath.split(">").map(v => v.trim()).filter(v => { return( v !== "" ); });
    if( fullPath.length == 0 ) {
      throw 'Invalid controller name: name cannot be blank.'
    }
    let folderName = fullPath.splice(0, fullPath.length - 1);
    if( this.parent === undefined && folderName.length === 0 ) {
      folderName.push("Default");
    }
    folderName = folderName.join(">");
    const folder = this.addFolder( folderName );
    const controllerName = fullPath[0];
    const isColor = options.isColor || options.is_color || false;
    const controllerArgs = options.args;

    // check if this folder has controller
    for(let i in folder.controllers) {
      const controller = folder.controllers[ i ];
      if( controller._name === controllerName ) {
        return controller;
      }
    }

    // guess the controller type, the way lil-gui's `add` does
    let type;
    if( options.type ) {
      // asked for explicitly, by addLineGraph
      type = options.type;
    } else if( isColor ) {
      type = "color";
    } else if( controllerArgs ) {
      type = "option";
    } else {
      switch ( typeof value ) {
        case 'number':  type = "number";   break;
        case 'string':  type = "string";   break;
        case 'boolean': type = "boolean";  break;
        default:        type = "function";
      }
    }

    // Tweakpane reads the bound value when the blade is built, so it has to be
    // there and it has to match the type
    if( value === undefined || value === null ) {
      switch ( type ) {
        case "color":   value = COLOR_FALLBACK; break;
        case "option":  value = Array.isArray( controllerArgs ) ? controllerArgs[0]
                                                                : Object.values( controllerArgs )[0];
                        break;
        case "number":  value = 0;   break;
        case "string":  value = "";  break;
        case "boolean": value = false; break;
        case "interval": value = { min: options.min ?? 0 , max: options.max ?? 1 }; break;
      }
    }

    const controllerObject = options.object ?? folder.object;
    controllerObject[ controllerName ] = type === "color" ? normalizeColor( value ) : value;

    const controller = new EnhancedGUIController({
      folder  : folder,
      name    : controllerName,
      object  : controllerObject,
      type    : type,
      choices : controllerArgs,
    });
    folder.controllers.push( controller );

    if( controller._isSelector || controller._isBool || controller._isNumber ) {
      // use function instead of => to alter "this"
      controller.onFinishChange(function(v) {
        this.blur();
      })
    }

    const tooltip = options.tooltip ?? controllerName;

    if( tooltip && typeof tooltip === "object" ) {
      controller.tooltip( tooltip.text, tooltip.key );
    } else if( typeof tooltip === "string" ) {
      controller.tooltip( tooltip );
    }

    return controller;
  }
  getController( name, folderName, explicit = false ) {
    if( Array.isArray( folderName ) ) { folderName = folderName.join(">"); }
    if( typeof folderName !== "string" ) { folderName = ""; }
    const fullPath = `${ folderName }>${name}`.split(">").map(v => v.trim())
      .filter(v => { return( v !== "" ); });
    let controllerName;
    if( fullPath.length == 1 ) {
      controllerName = fullPath[0];
      for(let i in this.controllers) {
        const controller = this.controllers[ i ];
        if( controller._name === controllerName ) {
          return controller;
        }
      }
    } else if ( fullPath.length > 1 ) {
      const folder = this.getFolder( fullPath.splice( 0, fullPath.length - 1 ) );
      controllerName = fullPath[0];
      if( folder ) {
        return folder.getController( controllerName );
      }
    }

    // recursive search name: TODO: consider whether this is necessary
    if( controllerName && !explicit ) {
      const allControllers = this.controllersRecursive();
      for(let i in allControllers) {
        const controller = allControllers[ i ];
        if( controller._name === controllerName ) {
          return controller;
        }
      }
    }


    // unable to find, return fake one
    return ({
      onChange : () => {},
      setValue : () => {},
      destroy  : () => {},
      tooltip  : () => {},
      isfake : true
    });
  }

  getOrAddController( name, value, options ) {
    let controller = this.getController( name, options.folderName, true );
    if( controller.isfake ) {
      controller = this.addController( name, value, options );
    } else if( options.force ) {
      controller.destroy();
      controller = this.addController( name, value, options );
    }
    return controller;
  }

  showControllers( names, folderName ) {
    if( Array.isArray( names ) ) {
      names.forEach( v => {
        this.showControllers( v, folderName );
      });
      return;
    }
    const controller = this.getController( names, folderName );
    if( controller.isfake ) { return; }
    controller.show()
  }
  hideControllers( names, folderName ) {
    if( Array.isArray( names ) ) {
      names.forEach( v => {
        this.hideControllers( v, folderName );
      });
      return;
    }
    const controller = this.getController( names, folderName );
    if( controller.isfake ) { return; }
    controller.hide();
  }

  setFromDictionary( args ){
    const keys = [
      "Background Color", "Camera Position", "Display Coordinates",

      "Show Panels", "Slice Brightness", "Slice Mode",
      "Coronal (P - A)", "Axial (I - S)", "Sagittal (L - R)",
      "Overlay Coronal", "Overlay Axial", "Overlay Sagittal",
      "Frustum Near", "Frustum Far",
      "Voxel Type", "Voxel Display", "Voxel Label", "Voxel Opacity",
      "Voxel Min", "Voxel Max", "Voxel Cmap", "Dynamic Color Map", "Symmetric Color Map",
      "Component Index",

      "Surface Material", "Surface Type", "Clipping Plane",
      "Left Hemisphere", "Right Hemisphere",
      "Left Opacity", "Right Opacity",
      "Left Mesh Clipping", "Right Mesh Clipping",
      "Subcortical Surface", "Sub-Left Opacity", "Sub-Right Opacity",
      "Surface Color", "Blend Factor", "Sigma", "Decay", "Range Limit",
      "Vertex Data", "Surface Color Data", "Surface Color Map", "Surface Color Min", "Surface Color Max",
      "Surface Threshold Data", "Surface Threshold Method",
      "Surface Threshold Range",

      "Map Electrodes", "Surface Mapping", "Volume Mapping",
      "Visibility", "Electrode Shape", "Outlines", "Text Scale","Text Visibility",

      "Display Data", "Display Range", "Threshold Data", "Threshold Range",
      "Threshold Method", "Additional Data",
      "Video Mode", "Speed", "Play/Pause",
      "Show Legend", "Show Time", "Highlight Box", "Info Text",
      "Time",

      "Edit Mode", "Auto Refine", "Brain Shift", "Max Shift"
    ];
    const data = to_dict( args );

    // Backward compatibility
    data["Surface Color Data"] = data["Surface Color Data"] ?? data["Vertex Data"];

    keys.forEach((k) => {
      const value = data[k];
      delete data[k];
      if( value !== undefined ){
        const controller = this.getController( k, "", false );
        if( !controller.isfake ) {
          console.debug(`Initialize setting ${ k } -> ${ value }`);
          try {
            controller.setValue( value );
          } catch (e) {
            console.warn(`Cannot initialize settings ${ k } -> ${ value }. \n${e}`);
          }
        }
      }
    });

    for(let k in data) {
      try {
        const controller = this.getController( k, "", false );
        if( !controller.isfake ) {
          const value = data[k];
          console.debug(`Initialize setting ${ k } -> ${ value }`);
          controller.setValue( value );
        }
      } catch (e) {
        console.warn(`Cannot initialize settings ${ k } (not supported)`);
      }
    }

  }

}


export { EnhancedGUI };
