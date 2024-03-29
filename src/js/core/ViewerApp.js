import { ThrottledEventDispatcher } from './ThrottledEventDispatcher.js';
import { asArray } from '../utility/asArray.js';
import { EnhancedGUI } from './EnhancedGUI.js';
import { ViewerControlCenter } from './ViewerControlCenter.js';
import { ViewerCanvas } from './ViewerCanvas.js';
import { MouseKeyboard } from './MouseKeyboard.js';
import { CONSTANTS } from './constants.js';
import { requestAnimationFrame } from './requestAnimationFrame.js';
import { CanvasFileLoader2 } from './DataLoaders.js';


const _updateDataStartEvent = {
  type      : "viewerApp.updateData.start",
  immediate : true
}

const _updateDataEndEvent = {
  type      : "viewerApp.updateData.end",
  immediate : true
}


class ViewerApp extends ThrottledEventDispatcher {

  constructor({

    // Element to store 3D viewer
    $wrapper,

    // in case $wrapper has 0 width or height
    width, height,

    // use cache? true, false, or the cache object
    cache = false,

    // debug mode?
    debug = false

  }) {

    super( $wrapper );

    // Flags
    this.debug = debug;
    this.isViewerApp = true;
    this.controllerClosed = false;
    this.ready = false;
    // this.outputId = this.$wrapper.getAttribute( 'data-target' );

    // data
    this.geoms = [];
    this.settings = {};

    this.fileLoader = new CanvasFileLoader2({
      logger: this.debugVerbose
    });

    // ---- initialize : DOM elements ------------------------------------------
    /** The layout is:
     * $wrapper:
     *   - A: 1. Settings panel
     *        - 2. Controller wrapper
     *          - 3. Controller placeholder ( this one will be replaced )
     *        - 4. Information container
     *          - 5. Progress wrapper
     *            - Progress bar ( for css reasons, this requires a wrapper )
     *          - 6. Information text
     *   - B. Canvas container
     *      - Coronal panel
     *      - Axial panel
     *      - Sagittal panel
     *      - Main canvas
     */
    this.$wrapper = $wrapper;
    // --- A ---
    // 1. Control panel
    this.$settingsPanel = document.createElement('div');
    this.$settingsPanel.style.maxHeight = `${ height ?? this.$wrapper.clientHeight }px`;
    this.$settingsPanel.classList.add( 'threejs-control' )

    // 2. Controller wrapper
    this.$controllerContainer = document.createElement('div');
    this.$controllerContainer.style.width = '100%';

    // 3. Controller placeholder
    // initialized as placeholder, will be replaced by lil-gui
    // this.$controllerGUI = document.createElement('div');

    // 4. Information container
    this.$informationContainer = document.createElement('div');
    this.$informationContainer.style.width = '100%';
    this.$informationContainer.style.padding = '0 0 10px 0'; // avoid ugly text layout

    // 5. Progress
    this.$progressWrapper = document.createElement('div');
    this.$progressWrapper.classList.add( "threejs-control-progress" );
    this.$progress = document.createElement('span');
    this.$progress.style.width = '0';

    // 6. Information text
    this.$informationText = document.createElement('div');
    this.$informationText.style.width = '100%';

    // Assemble A.1-6
    /*    1. Settings panel
     *        - 2. Controller wrapper
     *          - 3. Controller placeholder ( this one will be replaced )
     *        - 4. Information container
     *          - 5. Progress wrapper
     *            - Progress bar ( for css reasons, this requires a wrapper )
     *          - 6. Information text
     */
    // add 3 to 2
    // this.$controllerContainer.appendChild( this.$controllerGUI );
    // add 2 to 1
    this.$settingsPanel.appendChild( this.$controllerContainer );
    // add $progress to 5
    this.$progressWrapper.appendChild( this.$progress );
    // add 5 to 4
    this.$informationContainer.appendChild( this.$progressWrapper );
    // add 6 to 4
    this.$informationContainer.appendChild( this.$informationText );
    // add 4 to 1
    this.$settingsPanel.appendChild( this.$informationContainer );
    // add 1 to $wrapper
    this.$wrapper.appendChild( this.$settingsPanel );

    // --- B Canvas container ------------------------------------------------
    this.canvas = new ViewerCanvas(
      this.$wrapper,
      width ?? this.$wrapper.clientWidth,
      height ?? this.$wrapper.clientHeight,
      250, false, this.debug, true,
      this.fileLoader );

    // Add listeners for mouse
    this.mouseKeyboard = new MouseKeyboard( this );

    this.animate();
  }

  get mouseLocation () { return this.mouseKeyboard.mouseLocation; }

  dispose() {
    this._disposed = true;
    super.dispose();
    this.mouseKeyboard.dispose();
    if( this.controllerGUI ) {
      try { this.controllerGUI.dispose(); } catch (e) {}
      this.controllerGUI = undefined;
    }
    if( this.controlCenter ) {
      try { this.controlCenter.dispose(); } catch (e) {}
      this.controlCenter = undefined;
    }
  }

  setProgressBar({
    // 0 - 100
    progress, message, details, autoHide = true } = {}) {

    if( progress < 0 ) { return; }
    if( progress >= 100 ) { progress = 100; }

    const oldProgress = this.__progress;
    this.__progress = progress;
    if( message ) {
      this.__message = message;
    }
    this.$progress.style.width = `${ progress }%`;

    if( oldProgress !== progress ) {
      this.debugVerbose(`[ViewerApp.setProgressBar ${ Math.floor(this.__progress) }%]: ${ message } (${ details ?? "no details" })`);
    }
    if( this.__message ) {
      this.$informationText.innerHTML = `<small>${ this.__message }<br />&nbsp;&nbsp;${ details ?? "" }</small>`;
    } else {
      this.$informationText.innerHTML = "";
    }

    if( autoHide && progress >= 99.99999 ) {
      this.$informationContainer.style.display = 'none';
    } else {
      this.$informationContainer.style.display = 'block';
    }
  }

  resize( width, height ) {
    const _width = width ?? this.$wrapper.clientWidth;
    const _height = height ?? this.$wrapper.clientHeight;
    if( _width <= 0 || _height <= 0 ){ // Do nothing! as the canvas is usually invisible
      return ;
    }
    this.$settingsPanel.style.maxHeight = _height + 'px';
    if( this.controllerClosed ) {
      this.canvas.handle_resize( _width, _height );
    } else {
      this.canvas.handle_resize( _width - 300, _height );
    }
    /* FIXME : move to canvas, not here!!!
    if( this._reset_flag ){
      this._reset_flag = false;
      this.canvas.sideCanvasList.coronal.reset({ zoomLevel: true, position: true, size : true });
      this.canvas.sideCanvasList.axial.reset({ zoomLevel: true, position: true, size : true });
      this.canvas.sideCanvasList.sagittal.reset({ zoomLevel: true, position: true, size : true });
    }
    this.canvas.start_animation(0);
    */
  }

  bootstrap( { bootstrapData, reset = false } ) {
    this.debug = this.debug || bootstrapData.debug;

    // read configurations
    const path = bootstrapData.settings.cache_folder + bootstrapData.data_filename;

    this.setProgressBar({
      progress  : 0,
      message   : "Loading configuration files..."
    });

    this.fileLoader.alterFlag();
    const currentLoaderFlag = this.fileLoader.flag;

    const fileReader = new FileReader();
    this.__fileReader = fileReader;

    /**
     * The render process is async and may take time
     * If new data come in and this.render is called,
     * then this.fileLoader.flag will be altered, and this reader
     * is obsolete. In such case, abandon the rendering process
     * as there is a new process rendering up-to-date data
     */
    const readerIsObsolete = ( step ) => {
      const re = currentLoaderFlag !== this.fileLoader.flag;
      if( re ) {
        if( step ) {
          this.debugVerbose( `[ViewerApp.bootstrap]: configuration is obsolete, abandon current process at step [${step}] to yield.` );
        } else {
          this.debugVerbose( "[ViewerApp.bootstrap]: configuration is obsolete, abandon current process to yield." );
        }
      }
      return ( re );
    };

    const parseConfigJSON = (text) => {
      const viewerData = JSON.parse(text);
      viewerData.settings = bootstrapData.settings;

      this.setProgressBar({
        progress  : 5,
        message   : "Updating viewer data..."
      });

      this.updateData({
        data : viewerData,
        reset : reset,
        isObsolete : readerIsObsolete
      })
    }

    let configDataPath = path;

    if( path.startsWith("#") ) {
      // the data is embeded
      const configElements = document.querySelectorAll(`script[data-for='${ path }']`);
      const data = [];
      configElements.forEach((e) => {
        data[ parseInt(e.getAttribute("data-partition")) ] = atob(e.innerHTML.trim());
      });
      parseConfigJSON( data.join("") );
    } else {
      fileReader.onload = (evt) => {

        fileReader.onload = undefined;
        if( readerIsObsolete( "parsing consiguration" ) ) { return; }

        this.setProgressBar({
          progress  : 5,
          message   : "Parsing configurations..."
        });

        parseConfigJSON( evt.target.result );
      }

      window.fetch( configDataPath ).then( r => r.blob() ).then( blob => {
        fileReader.readAsText( blob );
      });
    }
  }


  enableDebugger() {
    window.app = this;
    window.groups = this.groups;
    window.geoms = this.geoms;
    window.settings = this.settings;
    window.canvas = this.canvas;
    window.controllerGUI = this.controllerGUI;
    this.debug = true;
    this.canvas.debug = true;
    this.canvas.addNerdStats();
    this.fileLoader.debug = true;
  }

  disableDebugger() {
    if( !this.debug ) { return; }
    this.debug = false;
    this.canvas.debug = false;
    // this.canvas.addNerdStats();
    this.fileLoader.debug = false;
    delete window.app;
    delete window.groups;
    delete window.geoms;
    delete window.settings;
    delete window.canvas;
    delete window.controllerGUI;
  }

  async updateData({ data, reset = false, isObsolete = false }) {
    // Stop all workers
    await this.fileLoader.stopWorkers();

    this.dispatch( _updateDataStartEvent );

    const _isObsolete = ( args ) => {
      let re = false;
      if( typeof isObsolete !== 'function' ) {
        re = isObsolete;
      } else {
        try { re = isObsolete( args ); } catch (e) {}
      }
      return re;
    }
    if( _isObsolete( "Updating viewer data" ) ) { return; }

    this.debug = data.settings.debug || false;

    // clear canvas
    this.canvas.needsUpdate = false;
    this.canvas.clear_all();
    if( this.controllerGUI ) {
      try { this.controllerGUI.dispose(); } catch (e) {}
      this.controllerGUI = undefined;
    }
    if( this.controlCenter ) {
      try { this.controlCenter.dispose(); } catch (e) {}
      this.controlCenter = undefined;
    }

    this.groups = asArray( data.groups );
    this.geoms = asArray( data.geoms );
    this.settings = data.settings;
    this.initialControllerValues = data.settings.default_controllers || {};
    this.hasAnimation = data.settings.has_animation;
    this.colorMaps = asArray( data.settings.color_maps );

    // canvas flags
    this.canvas.debug = this.debug;
    this.canvas.mainCamera.needsReset = reset === true;
    // this.shiny.set_token( this.settings.token );
    const workerURL = this.settings.worker_script;
    this.fileLoader.workerScript = workerURL;
    this.fileLoader.setCacheEnabled( data.settings.enable_cache || false );

    if( this.debug ) {
      this.enableDebugger();
    }


    this.canvas.title = this.settings.title;

    if( _isObsolete("Adding color maps") ) { return; }

    this.colorMaps.forEach( params => {
      // calculate cmap, add time range so that the last value is always displayed
      // let tr = v.time_range;
      this.canvas.createColorMap({
        dataName      : params.name,
        displayName   : params.alias,
        controlColors : asArray( params.color_vals ),

        isContinuous  : params.value_type === "continuous",
        timeRange     : params.time_range,

        valueRange    : params.value_range,
        hardRange     : params.hard_range,

        valueKeys     : asArray( params.value_names )
      });

    });

    if( _isObsolete("Loading group data") ) { return; }

    this.setProgressBar({
      progress  : 10,
      message   : "Loading group data..."
    });

    const nGroups = this.groups.length;
    let count = 1, progressIncrement = 0.5 / nGroups * 40;

    const groupPromises = {};
    const queueGroup = ( g, { message, lazy = false } = {} ) => {

      let item;
      if( groupPromises[ g.name ] ) {
        item = groupPromises[ g.name ];
        if( item.promise ) { return item; }
      } else {
        item = {
          loaded: false,
          definition: g,
        };
        groupPromises[ g.name ] = item;
      }

      if( lazy ) { return item; }

      this.setProgressBar({
        progress : this.__progress + progressIncrement,
        message : `Loading group: ${g.name}`
      });

      item.loaded = false;

      item.promise = this.canvas.add_group(g, this.settings.cache_folder, ( msg ) => {
        this.setProgressBar({
          progress : this.__progress,
          message: message,
          details : `from group ${g.name} (${count}/${ nGroups }) <br />&nbsp;&nbsp;loading ${msg}`
        });
      }).then(() => {
        item.loaded = true;
        count++;
        this.setProgressBar({
          progress : this.__progress + progressIncrement,
          message : `Loaded group: ${g.name}`
        });
      });

      return item;
    };

    this.groups.forEach((g, ii) => {

      if( g.name.startsWith("_") ) {
        // Must load before loading any object
        queueGroup( g );
      } else {
        queueGroup( g, { lazy: true } );
      }

    })

    // in the meanwhile, sort geoms
    this.geoms.sort((a, b) => {
      return( a.render_order - b.render_order );
    });

    for( let groupName in groupPromises ) {
      const promise = groupPromises[ groupName ].promise;
      if( promise ) { await promise; }
    }

    if( _isObsolete("Adding geometries") ) { return; }

    const nGeoms = this.geoms.length;
    const geomPromises = [];
    const queueObject = ( g ) => {
      if( _isObsolete("Loaded group data") ) { return; }
      const message = `Adding object ${g.name}`;
      this.setProgressBar({
        progress : this.__progress + 40 / nGeoms,
        message : message
      });

      try {
        this.canvas.add_object( g, ( msg ) => {
          this.setProgressBar({
            progress : this.__progress,
            message : message,
            details : msg
          });
        });
        this.setProgressBar({
          progress : this.__progress,
          message : `Added object ${g.name}`
        });
      } catch (e) {
        console.warn( e );
      }

    };
    this.geoms.forEach( (g) => {
      const message = `Adding object ${g.name}`;

      let groupPromise = null;
      if( g && g.group && typeof g.group.group_name === "string" ) {
        let queuedGroupItem = groupPromises[ g.group.group_name ];
        if( queuedGroupItem && !queuedGroupItem.loaded ) {
          const promise = queueGroup( queuedGroupItem.definition, { lazy: false, message: message } )
            .promise.then(() => { queueObject( g ); });
          geomPromises.push( promise );
          return;
        }
      }
      queueObject( g );

    });

    this.setProgressBar({
      progress : this.__progress,
      message : "Waiting for the file loaders..."
    });

    if( geomPromises.length ) {
      await Promise.all( geomPromises );
    }
    if( _isObsolete("finalization") ) { return; }

    this.setProgressBar({
      progress : 90,
      message : "Finalizing..."
    });


    // ---- Finalizing: add controllers ----------------------------------------
    this.updateControllers({ reset : true });


    // FIXME: Add driver, which contains shiny support
    // this.shiny.register_gui( this.gui, this.presets );


    this.resize( this.$wrapper.clientWidth, this.$wrapper.clientHeight );

    // Force starting rendering
    this.canvas.render();
    this.canvas.needsUpdate = true;

    if( typeof( callback ) === 'function' ){
      try {
        callback();
      } catch (e) {
        console.warn(e);
      }
    }

    // canvas is ready. set flag
    this.ready = true;

    // run customized js code
    if( this.settings.custom_javascript &&
        this.settings.custom_javascript !== ''){

      this.debugVerbose("[ViewerApp.updateData]: Executing customized js code:\n"+this.settings.custom_javascript);
      (( viewerApp ) => {
        try {
          ((canvas, controlCenter) => {
            eval( this.settings.custom_javascript );
          }) (
            this.canvas,
            this.controlCenter
          )
        } catch (e) {
          console.warn(e);
        }
      })( this );
    }

    // Make sure it's hidden though progress will hide it
    this.$informationContainer.style.display = 'none';

    this.setProgressBar({
      progress : 100,
      message : "Done."
    });

    this.dispatch( _updateDataEndEvent );

  }

  updateControllers( { reset = false } = {} ) {
    if( this.controllerGUI ) {
      try { this.controllerGUI.dispose(); } catch (e) {}
      this.controllerGUI = undefined;
    }
    if( this.controlCenter ) {
      try { this.controlCenter.dispose(); } catch (e) {}
      this.controlCenter = undefined;
    }
    this.controllerGUI = new EnhancedGUI({
      autoPlace: false,
      title : "3D Viewer Control Panel"
    });
    // --------------- Register GUI controller ---------------
    // Set default on close handler
    this.controllerGUI.addEventListener( "open", ( event ) => {
      if( event.folderPath !== "" ) { return; }
      this.controllerClosed = false;
      this.resize( this.$wrapper.clientWidth, this.$wrapper.clientHeight );
    });
    this.controllerGUI.addEventListener( "close", ( event ) => {
      if( event.folderPath !== "" ) { return; }
      this.controllerClosed = true;
      this.resize( this.$wrapper.clientWidth, this.$wrapper.clientHeight );
    });

    this.$controllerContainer.innerHTML = '';

    if( this.settings.hide_controls ) {

      // Do not show controller GUI at all.
      this.controllerClosed = true;
      this.controllerGUI.hide();

    } else {

      this.controllerGUI.show();
      if( this.settings.control_display ) {
        this.controllerClosed = false;
      } else {
        // fold the controller GUI
        this.controllerClosed = true;
      }
    }
    if( this.controllerClosed ) {
      this.controllerGUI.close();
    } else {
      this.controllerGUI.open();
    }

    this.$controllerContainer.appendChild( this.controllerGUI.domElement );


    this.controllerGUI.addFolder( "Volume Settings" );
    this.controllerGUI.addFolder( "Surface Settings" );
    this.controllerGUI.addFolder( "Electrode Settings" );

    // ---- Add Presets --------------------------------------------------------
    const enabledPresets = this.settings.control_presets;
    this.controlCenter = new ViewerControlCenter( this );
    this.controlCenter.toggleDebugger = () => {
      if( this.debug ) {
        this.disableDebugger();
      } else {
        this.enableDebugger();
      }
    }
    // ---- Defaults -----------------------------------------------------------
    this.controlCenter.addPreset_background();
    this.controlCenter.addPreset_setCameraPosition2();
    this.controlCenter.addPreset_compass();
    this.controlCenter.addPreset_recorder();
    this.controlCenter.addPreset_resetCamera();
    this.controlCenter.addPreset_copyViewerState();
    // this.controlCenter.addPreset_recorder();

    // ---- Side canvas --------------------------------------------------------
    if( this.settings.side_camera ){
    //   // this.gui.add_folder('Side Canvas').open();
      this.controlCenter.addPreset_enableSidePanel();
      this.controlCenter.addPreset_resetSidePanel();
      this.controlCenter.addPreset_sideSlices();
      this.controlCenter.addPreset_sideViewElectrodeThreshold();
    }

    // ---- Subject volume, surface, and electrodes ----------------------------
    this.controlCenter.addPreset_subject2();
    this.controlCenter.addPreset_surface_type2();
    this.controlCenter.addPreset_surface_subcortical();
    this.controlCenter.addPreset_surface_color();
    this.controlCenter.addPreset_map_template();
    this.controlCenter.addPreset_electrodes();
    this.controlCenter.addPreset_voxel();

    // ---- Localization -------------------------------------------------------
    if( enabledPresets.includes( "localization" )) {
      this.controlCenter.addPreset_localization();
    }

    // ---- ACPC Realignment ---------------------------------------------------
    if( enabledPresets.includes( "acpcrealign" )) {
      this.controlCenter.addPreset_acpcrealign();
    }

    // ---- Custom File upload -------------------------------------------------
    this.controlCenter.addPreset_dragdrop();

    // ---- Data Visualization -------------------------------------------------
    this.controlCenter.addPreset_animation();
    this.controlCenter.addPreset_display_highlights();

    // ---- QR Code ----------
    this.controlCenter.addPreset_qrcode();

    // Update inputs that require selectors since the options might vary
    this.controlCenter.updateSelectorOptions();


    // The following stuff need to run *after* controller set up
    // TODO: consider moving these to the canvas class
    /* Update camera zoom. If we set camera position, then shiny will behave weird and we have to
    * reset camera every time. To solve this problem, we only reset zoom level
    *
    * this is the line that causes the problem
    */
    this.canvas.mainCamera.setZoom({ zoom : this.settings.start_zoom });
    this.canvas.setFontSize( this.settings.font_magnification || 1 );

    // Compile everything
    // this.canvas.main_renderer.compile( this.canvas.scene, this.canvas.mainCamera );

    // Set side camera
    if( this.settings.side_camera || false ){

      // Set canvas zoom-in level
      if( this.settings.side_display || false ){
        this.canvas.enableSideCanvas();
        // reset so that the size is displayed correctly
        // this._reset_flag = true;
      }else{
        this.canvas.disableSideCanvas();
      }

    }else{
      this.canvas.disableSideCanvas();
    }

    // remember last settings

    if( reset ) {
      this.controllerGUI.setFromDictionary( this.initialControllerValues );
    }
  }

  // Do not call this function directly after the initial call
  // use "this.canvas.needsUpdate = true;" to render once
  // use "this.canvas.needsUpdate = 1;" to keep rendering
  // this.pauseAnimation(1); to stop rendering
  // Only use 0 or 1
  animate(){

    if( this._disposed ){ return; }
    this.canvas.rendering = true;

    requestAnimationFrame( this.animate.bind(this) );

    // If this.$el is hidden, do not render
    if( !this.ready || this.$wrapper.clientHeight <= 0 ){
      return;
    }

    const _width = this.canvas.domElement.width;
    const _height = this.canvas.domElement.height;

    // Do not render if the canvas is too small
    // Do not change flags, wait util the state come back to normal
    if(_width <= 10 || _height <= 10) { return; }

    // needs to incrementTime after update so chosen object information can be up to date
    this.canvas.incrementTime();
    this.canvas.update();

    if( this.controlCenter ) {
      this.controlCenter.update();
    }

    this.canvas.render();

    this.canvas.rendering = false;

	}
}

export { ViewerApp };
