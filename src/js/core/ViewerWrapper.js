// External libraries
import { CONSTANTS } from './constants.js';
import { MathUtils } from 'three';
import { StorageCache } from './StorageCache.js';
import { ViewerApp } from './ViewerApp.js';

class ViewerWrapper {

  /**
   * The whole point of class ViewerWrapper is to separate actual viewer
   * from the enclosing HTML element. This is becuase we want to reuse the
   * viewer in shiny applications.
   */

  get containerID () {
    // previously this.element_id
    return this.$container.getAttribute('id');
  }
  get cacheID () {
    return `__THREEBRAIN_CONTAINER_${ this.containerID }__`;
  }
  get shinyID () {
    return `${ this.containerID }__shiny`;
  }
  get viewerCanvas () {
    if( !this.viewer ) { return; }
    return this.viewer.canvas;
  }

  getCachedViewer() {
    if( !this.cache ) { return; }
    return this.cache.get_item( this.cacheID , undefined );
  }
  cacheViewer () {
    if( !this.cache ){ return; }
    if( !this.viewer || !this.viewer.isViewerApp ) { return; }
    this.cache.set_item( this.cacheID , this.viewer );
  }

  constructor({
    $container, width, height,

    // HTMLWidgets.viewerMode, whether to full screen
    viewerMode = false, cache = false
  } = {}){

    /**
     * ll the viewer data are cached here so we don't need to reload
     * duplicated data. However, this global cache might
     * 1. use lots of memories when lots of different subject are loaded
     * 2. Unable to update data if file on disk is changed.
     *
     * I do not plan to solve these issue as I can loading 10 different
     * subjects without too much pressure. Also this is in web browser,
     * simply refresh the page and cache will go away. The speed performance
     * is what matters for now.
     */
    if( cache === true ){
      this.cache = window.global_cache ?? new StorageCache();
    } else {
      this.cache = cache;
    }

    // Flag
    this.initialized = false;
    this.width = width;
    this.height = height;
    this.viewerMode = viewerMode;
    this.debug = false;
    this.uuid = MathUtils.generateUUID();

    // DOM related
    this.$container = $container;
    this.$container.classList.add('threejs-brain-container');

    this.$loaderIcon = document.createElement("div");
    this.$loaderIcon.classList.add("threejs-brain-loader");

    // Viewer & Data ( initial small settings containing path to configuration )
    this.viewer = this.getCachedViewer();
    this.viewerBootstrapData = undefined;
    // this will be the root element of the viewer
    this.$viewerWrapper = undefined;

    // Debug switch: `?forceWebGL` (or `=1`, `=true`) in the page URL runs the
    // renderers on their WebGL2 backend even when WebGPU is available. Without
    // it, the renderers pick WebGPU and fall back to WebGL2 by themselves.
    const searchParams = new URLSearchParams( window.location.search );
    const forceWebGL = searchParams.get( "forceWebGL" );
    this.forceWebGL = forceWebGL === "" || forceWebGL === "1" || forceWebGL === "true";

    // Debug switch: `?sharedDevice=0` gives every canvas a renderer of its own,
    // as they had before they shared one GPU device. Only WebGPU can share.
    const sharedDevice = searchParams.get( "sharedDevice" );
    this.shareRenderer = !( sharedDevice === "0" || sharedDevice === "false" );


    if( this.viewer === undefined ) {
      // ---- Initialize ---------------------------------------------------------
      // Create wrapper for viewer, this will be the root element of the viewer
      // This is the first time, hence consider adding modal to prevent rendering
      this.addModal();

    } else {

      /**
       * This happens in Shiny mode where the entire ViewerWrapper is removed
       * by external code. The viewer app does not go away, we can get from
       * cache
       */

      this.activateViewer();

    }

  }

  addModal = () => {
    if( this.$modal ) { return; }
    this.$container.classList.add("threejs-brain-blank-container");
    this.$modal = document.createElement("div");
    this.$modal.classList.add("threejs-brain-modal");
    this.$modal.innerText = "Click me to load 3D viewer.";
    this.$container.innerHTML = "";
    this.$container.appendChild( this.$modal );
    this.$container.addEventListener( "click", this.activateViewer );
  }

  activateViewer = () => {
    this.$container.removeEventListener( "click", this.activateViewer );

    if( this.$modal ) {
      this.$modal.innerText = ""
      this.$modal.appendChild( this.$loaderIcon )
      this.$modal = undefined;
    }

    // Reuse the viewer whenever there is one: this wrapper may have been built
    // around a fresh element that Shiny put in place of the old one (same id,
    // so `getCachedViewer()` finds it), and rebuilding would strand the cached
    // viewer's renderers, each holding a GPU device or WebGL2 context.
    if( this.initialized || ( this.viewer && this.viewer.isViewerApp ) ) {
      this.useCachedViewer( true );
    } else {
      this.createViewer( true );
    }

    this.render();

  }

  // 1-op: this function will be executed once and then will always no-op
  createViewer( insertViewer = false ) {
    if( this.initialized ) {
      return this.useCachedViewer( insertViewer );
    }
    this.$viewerWrapper = document.createElement('div');
    this.$viewerWrapper.classList.add( 'threejs-brain-canvas' );
    this.$viewerWrapper.setAttribute( 'data-target', this.containerID );
    if( this.viewerMode ) {
      this.$viewerWrapper.style.height = '100vh';
      this.$viewerWrapper.style.width = '100vw';
    }
    this.viewer = new ViewerApp({
      $wrapper : this.$viewerWrapper,
      width : this.width, height : this.height,
      cache : this.cache,
      debug : this.debug || CONSTANTS.DEBUG,
      forceWebGL : this.forceWebGL,
      shareRenderer : this.shareRenderer
    });

    this.cacheViewer();
    this.initialized = true;

    if( insertViewer ) {
      // clear the container element
      this.$container.innerHTML = '';
      this.$container.classList.remove("threejs-brain-blank-container");
      this.$container.appendChild( this.$viewerWrapper );

      this.resize();
    }
    // otherwise no need to resize as the $viewerWrapper is just created, and
    // there is no way the wrapper is added to DOM

    this.$container.dispatchEvent(new CustomEvent( "viewerApp.created", {} ));
  }

  useCachedViewer( insertViewer = false ) {
    if( !this.viewer || !this.viewer.isViewerApp ) {
      this.viewer = this.getCachedViewer();
      this.cacheViewer();
    }
    if( !this.viewer || !this.viewer.isViewerApp ) {
      return this.createViewer( insertViewer );
    }
    if( this.debug ) {
      console.debug('[ViewerWrapper.useCachedViewer]: Re-using an existing/cached viewer.');
    }


    // the viewer's root element, which `createViewer()` made and the removed
    // container held until now
    this.$viewerWrapper = this.viewer.$wrapper;
    if( this.viewerMode ) {
      this.$viewerWrapper.style.height = '100vh';
      this.$viewerWrapper.style.width = '100vw';
    }

    // make sure (can be overkill)
    this.initialized = true;
    if( insertViewer ) {
      // clear the container element
      this.$container.innerHTML = '';
      this.$container.classList.remove("threejs-brain-blank-container");
      this.$container.appendChild( this.$viewerWrapper );

    }
    this.resize();
  }

  receiveData({ data , reset = false } = {}) {
    // data contains basic viewer settings, which contains path to viewer data file

    /**
     * The render is async, hence we can't use this.viewerBootstrapData here
     * this is to backup the data in case we create viewer after receiving data:
     *    When shiny renders the HTMLWidget, this object will receive the data,
     *    store it in `this.viewerBootstrapData`. However, there is a chance
     *    that the user hasn't clicked this.$modal to initialize the viewer yet.
     *
     * The solution is to store the data, when this.createViewer is called,
     * it checks whether data has been received. If so, render it
     */
    this.viewerBootstrapData = {
      bootstrapData : data,
      reset : reset
    };
    this.debug = data.settings.debug || CONSTANTS.DEBUG;

    if( !this.initialized ) {
      if( data.force_render ) {
        this.activateViewer();
      }
      return;
    }

    this.render( reset );

    if( this.debug ) {
      window.appWrapper = this;
    }


  }

  render() {
    if( !this.viewer || !this.viewerBootstrapData ) {
      // throw 'THREEBRAIN: Cannot render viewer without the viewer UI and data.'.
      return;
    }
    this.viewer.bootstrap( this.viewerBootstrapData );
  }

  async resize( width, height ) {
    if( this.viewer ){
      this.viewer.resize(
        width ?? this.width,
        height ?? this.height
      );
    }
  }
}

export { ViewerWrapper }
