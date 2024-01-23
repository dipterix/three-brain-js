import {
  Vector2, Vector3, Color, Scene, Object3D, Matrix3, Matrix4,
  // OrthographicCamera,
  WebGLRenderer,
  DirectionalLight, AmbientLight,
  Raycaster, ArrowHelper, BoxHelper,
  LoadingManager, FileLoader, FontLoader,
  AnimationClip, AnimationMixer, Clock,
  Mesh, SubtractiveBlending,
  BufferGeometry, LineBasicMaterial, LineSegments
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
// import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutlinePass2 } from '../jsm/postprocessing/OutlinePass2.js';
// import { OutlineEffect2 } from '../jsm/effects/OutlineEffect2.js';

import Stats from 'three/addons/libs/stats.module.js';
import { json2csv } from 'json-2-csv';
import download from 'downloadjs';

// Core
import { ThrottledEventDispatcher } from './ThrottledEventDispatcher.js';
// import { OrthographicTrackballControls } from './OrthographicTrackballControls.js';
import { HauntedArcballControls } from './HauntedArcballControls.js';
import { HauntedOrthographicCamera } from './HauntedOrthographicCamera.js';
import { AnimationParameters } from './AnimationParameters.js';
import { CanvasContext2D } from './context.js';
import { CanvasFileLoader } from './loaders.js';
import { SideCanvas } from './SideCanvas.js';
import { StorageCache } from './StorageCache.js';
import { CanvasEvent } from './events.js';
import { CONSTANTS } from './constants.js';
import { Compass } from '../geometry/compass.js';
import { GeometryFactory } from './GeometryFactory.js';
import { NamedLut } from './NamedLut.js';

// Utility
import { asArray } from '../utility/asArray.js';
import { asColor, invertColor, colorLuma } from '../utility/color.js';
import { get_or_default, as_Matrix4, set_visibility, set_display_mode } from '../utils.js';
import { addToColorMapKeywords } from '../jsm/math/Lut2.js';

import { gen_sphere, is_electrode } from '../geometry/sphere.js';
import { gen_datacube } from '../geometry/datacube.js';
import { gen_datacube2 } from '../geometry/datacube2.js';
import { gen_tube } from '../geometry/tube.js';
import { gen_free } from '../geometry/free.js';
import { gen_linesements } from '../geometry/line.js';


const _mainCameraUpdatedEvent = {
  type  : "viewerApp.mainCamera.updated",
  muffled: true
}

const _stateDataChangeEvent = {
  type      : "viewerApp.state.updated",
  immediate : false
}

const _subjectStateChangedEvent = {
  type : "viewerApp.subject.changed"
}


/* ------------------------------------ Layer setups ------------------------------------
  Defines for each camera which layers are visible.
  Protocols are
    Layers:
      - 0, 2, 3: Especially reserved for main camera
      - 1, Shared by all cameras
      - 4, 5, 6: Reserved for side-cameras
      - 7: reserved for all, system reserved
      - 8: main camera only, system reserved
      - 9 side-cameras 1 only, system reserved
      - 10 side-cameras 2 only, system reserved
      - 11 side-cameras 3 only, system reserved
      - 12 side-cameras 4 only, system reserved
      - 13 all side cameras, system reserved
      - 14~31 invisible

*/

// A storage to cache large objects such as mesh data
const cached_storage = new StorageCache();


class ViewerCanvas extends ThrottledEventDispatcher {

  // private

  // public

  constructor(
    el, width, height, side_width = 250, shiny_mode=false, cache = false,
    debug = false, has_webgl2 = true
  ) {

    super( el );

    this._tmpVec3 = new Vector3();
    this._tmpMat4 = new Matrix4();

    this.isViewerCanvas = true;
    this.debug = debug;
    this.debugVerbose('Debug Mode: ON.');
    if(cache === true){
      this.use_cache = true;
      this.cache = cached_storage;
    }else if ( cache === false ){
      this.use_cache = false;
      this.cache = cached_storage;
    }else{
      this.use_cache = true;
      this.cache = cache;
    }

    // DOM container information
    this.$el = el;
    this.container_id = this.$el.getAttribute( 'data-target' );
    this._time_info = {
      selected_object : {
        position: new Vector3()
      }
    };
    this.timeChanged = true;
    // Is system supporting WebGL2? some customized shaders might need this feature
    // As of 08-2019, only chrome, firefox, and opera support full implementation of WebGL.
    this.has_webgl2 = has_webgl2;

    // Side panel initial size in pt
    this.side_width = side_width;
    this._sideCanvasCSSWidth = side_width;

    // Indicator of whether we are in R-shiny environment, might change the name in the future if python, matlab are supported
    this.shiny_mode = shiny_mode;

    // Element container
    this.main_canvas = document.createElement('div');
    this.main_canvas.className = 'THREEBRAIN-MAIN-CANVAS';
    this.main_canvas.style.width = width + 'px';
    this.$mainCanvas = this.main_canvas

    // Container that stores mesh objects from inputs (user defined) for each inquery
    this.mesh = new Map();
    this.threebrain_instances = new Map();

    // Stores all electrodes
    this.subject_codes = [];
    this.electrodes = new Map();
    this.slices = new Map();
    this.ct_scan = new Map();
    this.atlases = new Map();
    this.singletons = new Map();
    this._show_ct = false;
    this.surfaces = new Map();
    this.state_data = new Map();

    // action event listener functions and dispose flags
    this._disposed = false;

    // for global usage
    this.shared_data = new Map();

    // Stores all groups
    this.group = new Map();

    // All mesh/geoms in this store will be calculated when raycasting
    this.clickable = new Map();
    this.clickable_array = [];

    // Dispatcher of handlers when mouse is clicked on the main canvas
    this._mouse_click_callbacks = {};

    // update functions

    /* A render flag that tells renderers whether the canvas needs update.
          Case -1, -2, ... ( < 0 ) : stop rendering
          Case 0: render once
          Case 1, 2: render until reset
    lower _renderFlag will be ignored if higher one is set. For example, if
    _renderFlag=2 and pause_animation only has input of 1, renderer will ignore
    the pause signal.
    */
    this._renderFlag = 0;

    // Disable raycasting, soft deprecated
    this.disable_raycast = true;

    // If legend is drawn, should be continuous or discrete.
    this.color_type = 'continuous';

    // If there exists animations, this will control the flow;
    this.animation_clips = new Map();
    this.colorMaps = new Map();
    this.animParameters = new AnimationParameters();

    // Set pixel ratio, separate settings for main and side renderers
    this.pixel_ratio = [ window.devicePixelRatio, window.devicePixelRatio ];
    // Generate a canvas domElement using 2d context to put all elements together
    // Since it's 2d canvas, we might also add customized information onto it
    this.domElement = document.createElement('canvas');
    this.domContextWrapper = new CanvasContext2D( this.domElement, this.pixel_ratio[0] );
    this.domContext = this.domContextWrapper.context;
    this.background_color = '#ffffff'; // white background
    this.foreground_color = '#000000';
    this.domContext.fillStyle = this.background_color;


    // General scene.
    // Use solution from https://stackoverflow.com/questions/13309289/three-js-geometry-on-top-of-another to set render order
    this.scene = new Scene();
    this.origin = new Object3D();
    this.origin.position.copy( CONSTANTS.VEC_ORIGIN );
    this.scene.add( this.origin );

    // Add crosshair for side-canvas
    // generate crosshair
  	this.crosshairGroup = new Object3D();
  	const crosshairGeometryLR = new BufferGeometry()
  	  .setFromPoints([
  	    new Vector3( -256, 0, 0 ), new Vector3( - CONSTANTS.GEOMETRY["crosshair-gap-half"], 0, 0 ),
  	    new Vector3( CONSTANTS.GEOMETRY["crosshair-gap-half"], 0, 0 ), new Vector3( 256, 0, 0 )
  	  ]);
  	const crosshairMaterialLR = new LineBasicMaterial({
      color: 0x00ff00, transparent: true, depthTest : false
    });
    const crosshairLR = new LineSegments( crosshairGeometryLR, crosshairMaterialLR );
    crosshairLR.renderOrder = CONSTANTS.RENDER_ORDER.DataCube;
    crosshairLR.layers.set( CONSTANTS.LAYER_SYS_CORONAL_9 );
    crosshairLR.layers.enable( CONSTANTS.LAYER_SYS_AXIAL_10 );
    this.crosshairGroup.add( crosshairLR );
    this.crosshairGroup.LR = crosshairLR;

    const crosshairGeometryPA = new BufferGeometry()
  	  .setFromPoints([
  	    new Vector3( 0, -256, 0 ), new Vector3( 0, - CONSTANTS.GEOMETRY["crosshair-gap-half"], 0 ),
  	    new Vector3( 0, CONSTANTS.GEOMETRY["crosshair-gap-half"], 0 ), new Vector3( 0, 256, 0 )
  	  ]);
  	const crosshairMaterialPA = new LineBasicMaterial({
      color: 0x00ff00, transparent: true, depthTest : false
    });
    const crosshairPA = new LineSegments( crosshairGeometryPA, crosshairMaterialPA );
    crosshairPA.renderOrder = CONSTANTS.RENDER_ORDER.DataCube;
    crosshairPA.layers.set( CONSTANTS.LAYER_SYS_AXIAL_10 );
    crosshairPA.layers.enable( CONSTANTS.LAYER_SYS_SAGITTAL_11 );
    this.crosshairGroup.add( crosshairPA );
    this.crosshairGroup.PA = crosshairPA;

    const crosshairGeometryIS = new BufferGeometry()
  	  .setFromPoints([
  	    new Vector3( 0, 0, -256 ), new Vector3( 0, 0, - CONSTANTS.GEOMETRY["crosshair-gap-half"] ),
  	    new Vector3( 0, 0, CONSTANTS.GEOMETRY["crosshair-gap-half"] ), new Vector3( 0, 0, 256 )
  	  ]);
  	const crosshairMaterialIS = new LineBasicMaterial({
      color: 0x00ff00, transparent: true, depthTest : false
    });
    const crosshairIS = new LineSegments( crosshairGeometryIS, crosshairMaterialIS );
    crosshairIS.renderOrder = CONSTANTS.RENDER_ORDER.DataCube;
    crosshairIS.layers.set( CONSTANTS.LAYER_SYS_CORONAL_9 );
    crosshairIS.layers.enable( CONSTANTS.LAYER_SYS_SAGITTAL_11 );
    this.crosshairGroup.add( crosshairIS );
    this.crosshairGroup.IS = crosshairIS;

    // Add crosshair text
    this.scene.add( this.crosshairGroup );
    this._crosshairPosition = new Vector3();

    /* Main camera
        Main camera is initialized at 500,0,0. The distance is stayed at 500 away from
        origin (stay at right &look at left)
        The view range is set from -150 to 150 (left - right) respect container ratio
        render distance is from 1 to 10000, sufficient for brain object.
        Parameters:
          position: 500,0,0
          left: -150, right: 150, near 1, far: 10000
          layers: 0, 1, 2, 3, 7, 8
          center/lookat: origin (0,0,0)
          up: 0,1,0 ( heads up )
    */
    this.mainCamera = new HauntedOrthographicCamera( this, width, height );
    this._mainCameraPositionNormalized = new Vector3();

    // Add main camera to scene
    this.add_to_scene( this.mainCamera, true );

    // Add ambient light to make scene soft
    const ambient_light = new AmbientLight( CONSTANTS.COLOR_AMBIENT_LIGHT, 0.3 );
    ambient_light.layers.set( CONSTANTS.LAYER_SYS_ALL_CAMERAS_7 );
    ambient_light.name = 'main light - ambient';
    this.add_to_scene( ambient_light, true ); // soft white light


    // Set Main renderer, strongly recommend WebGL2
    if( this.has_webgl2 ){
      // We need to use webgl2 for VolumeRenderShader1 to work
      let main_canvas_el = document.createElement('canvas'),
          main_context = main_canvas_el.getContext( 'webgl2' );
    	this.main_renderer = new WebGLRenderer({
    	  antialias: false, alpha: true, canvas: main_canvas_el, context: main_context
    	});
    }else{
    	this.main_renderer = new WebGLRenderer({ antialias: false, alpha: true });
    }
  	this.main_renderer.setPixelRatio( this.pixel_ratio[0] );
  	this.main_renderer.setSize( width, height );
  	this.main_renderer.autoClear = false; // Manual update so that it can render two scenes
  	this.main_renderer.localClippingEnabled=true; // Enable clipping
  	this.main_renderer.setClearColor( this.background_color );

  	// Add composer
  	this.mainComposer = new EffectComposer( this.main_renderer );
  	/*
  	this.mainEffect = new OutlineEffect2( this.main_renderer, {
  	  defaultThickness: 0.003,
  	  defaultColor: [ 0, 0, 0 ],
  	  defaultAlpha: 1.0,
  	} );
  	*/

  	// Main renderer pass
  	this.mainRenderPass = new RenderPass( this.scene, this.mainCamera );
  	this.mainComposer.addPass( this.mainRenderPass );

    /*
    // outline pass
  	this.mainOutlinePass = new OutlinePass2( new Vector2( width, height ), this.scene, this.mainCamera );
  	this.mainOutlinePass.enabled = false;

  	this.mainOutlinePass.selectedObjects = this.clickable_array;
  	this.mainOutlinePass.edgeStrength = 1.5;
  	this.mainOutlinePass.edgeGlow = 1;
  	this.mainOutlinePass.edgeThickness = 1;
  	this.mainOutlinePass.pulsePeriod = 0;
  	this.mainOutlinePass.visibleEdgeColor.set( '#ffffff' );
  	this.mainOutlinePass.hiddenEdgeColor.set( '#ffffff' );
  	this.mainOutlinePass.overlayMaterial.blending = SubtractiveBlending;

  	this.mainComposer.addPass( this.mainOutlinePass );
  	*/

    // this.main_canvas.appendChild( this.main_renderer.domElement );
    this.main_canvas.appendChild( this.domElement );

    let wrapper_canvas = document.createElement('div');
    this.wrapper_canvas = wrapper_canvas;
    this.main_canvas.style.display = 'inline-flex';
    this.wrapper_canvas.style.display = 'flex';
    this.wrapper_canvas.style.flexWrap = 'wrap';
    this.wrapper_canvas.style.width = '100%';
    this.sideCanvasEnabled = false;
    this.sideCanvasList = {};

    // Generate inner canvas DOM element
    // coronal (FB), axial (IS), sagittal (LR)
    // 3 planes are draggable, resizable with open-close toggles 250x250px initial
    this.sideCanvasList.coronal = new SideCanvas( this, "coronal" );
    this.sideCanvasList.axial = new SideCanvas( this, "axial" );
    this.sideCanvasList.sagittal = new SideCanvas( this, "sagittal" );

    // Add video
    this.video_canvas = document.createElement('video');
    this.video_canvas.setAttribute( "autoplay", "false" );
    // this.video_canvas.setAttribute( "crossorigin", "use-credentials" );
    this.video_canvas.muted = true;

    // this.video_canvas.innerHTML = `<source src="" type="video/mp4">`
    this.video_canvas.height = height / 4;
    this.video_canvas._enabled = false;
    this.video_canvas._time_start = Infinity;
    this.video_canvas._duration = 0;
    this.video_canvas._mode = "hidden";


    // Add main canvas to wrapper element
    this.wrapper_canvas.appendChild( this.main_canvas );
    this.$el.appendChild( this.wrapper_canvas );

    // Controls
    this.trackball = new HauntedArcballControls( this );

    // Follower that fixed at bottom-left
    this.compass = new Compass( this.mainCamera, this.trackball );
    // Hide the anchor first
    this.add_to_scene( this.compass.container, true );


    // Mouse helpers
    this.mousePositionOnScreen = new Vector2();
    this.mouseRaycaster = new Raycaster();
    this._mouseEvent = undefined;

    this.focus_box = new BoxHelper();
    this.focus_box.material.color.setRGB( 1, 0, 0 );
    this.focus_box.userData.added = false;
    this.bounding_box = new BoxHelper();
    this.bounding_box.material.color.setRGB( 0, 0, 1 );
    this.bounding_box.userData.added = false;
    this.bounding_box.layers.set( CONSTANTS.LAYER_INVISIBLE_31 );


    this.setFontSize();

		// File loader
    this.fileLoader = new CanvasFileLoader( this, false );

    this.activated = false;
    this.$el.addEventListener( 'viewerApp.mouse.enterViewer', this._activateViewer );
    this.$el.addEventListener( 'viewerApp.mouse.leaveViewer', this._deactivateViewer );
    this.$el.addEventListener( 'viewerApp.mouse.mousedown', this._onMouseDown, { capture : true } );

    this.trackball.addEventListener( "start", this._onTrackballChanged );
    this.trackball.addEventListener( "change", this._onTrackballChanged );
    this.trackball.addEventListener( "end", this._onTrackballEnded );

    // this listener has been moved to controlCenter. Ideally all listeners go there
    // and this canvas is just in charge of passively rendering & updating things
    // this.$mainCanvas.addEventListener( 'mousemove', this._onMouseMove );
  }


  _onTrackballChanged = () => {
    if( !this.activated ) {
      this.activated = true;
    }
    this.needsUpdate = true;
  }

  _onTrackballEnded = () => {
    this.pause_animation( 1 );
    this.dispatch( _mainCameraUpdatedEvent );
  }

  _activateViewer = () => {
    this.activated = true;
    this.start_animation( 0 );
  }
  _deactivateViewer = () => { this.activated = false; }
  /* Moved to viewer control center
  _onMouseMove = ( event ) => {
    if( this.activated ) {
      this._mouseEvent = event;
    }
  }
  */
  _onMouseDown = ( event ) => {
    // async, but raycaster is always up to date
    const p = this.raycastClickables()
      .then((item) => {
        if( event.detail.button == 2 && item ) {
          if( item.object && item.object.isMesh && item.object.userData.construct_params ) {
            const crosshairPosition = item.object.getWorldPosition( new Vector3() );
            crosshairPosition.centerCrosshair = true;
            this.setSliceCrosshair( crosshairPosition );
          }
        }
      });
    return p;
  }

  raycastClickables = () => {

    const raycaster = this.updateRaycast();

    return new Promise(resolve => {

      if( !raycaster ) { resolve( undefined ); }

      // where clickable objects stay
      raycaster.layers.set( CONSTANTS.LAYER_SYS_RAYCASTER_14 );

      // Only raycast with visible
      const items = raycaster.intersectObjects(
        // asArray( this.clickable )
        this.clickable_array.filter((e) => { return( e.visible ) })
      );

      if( !items || items.length === 0 ) { resolve( undefined ); }

      const item = items[ 0 ];
      this.focus_object( item.object );

      resolve( item );
    })
  }

  /*---- Add objects --------------------------------------------*/
  add_to_scene( m, global = false ){
    if( global ){
      this.scene.add( m );
    }else{
      this.origin.add( m );
    }
  }

  // Generic method to add objects
  add_object(g){
    this.debugVerbose('Generating geometry '+g.type);
    let gen_f = GeometryFactory[ g.type ],
        inst = gen_f(g, this);

    if( !inst || typeof(inst) !== 'object' || !inst.object ){
      return;
    }

    // make sure subject array exists
    this.init_subject( inst.subject_code );


    inst.finish_init();
    return( inst );
  }

  // Make object clickable (mainly electrodes)
  add_clickable( name, obj ){
    if( this.clickable.has( name ) ){
      // remove from this.clickable_array
      const sub = this.clickable.get( name ),
            idx = this.clickable_array.indexOf( sub );
      if( idx > -1 ){
        this.clickable_array.splice(idx, 1);
      }
    }
    this.clickable.set( name, obj );
    this.clickable_array.push( obj );
  }

  // Add geom groups. This function can be async if the group contains
  // cached data. However, if there is no external data needed, then this
  // function is synchronous
  add_group(g, cache_folder = 'threebrain_data'){
    var gp = new Object3D();

    gp.name = 'group_' + g.name;
    asArray(g.layer).forEach( (ii) => { gp.layers.enable( ii ) } );
    gp.position.fromArray( g.position );

    if(g.trans_mat !== null){
      let trans = new Matrix4();
      trans.set(...g.trans_mat);
      let inverse_trans = new Matrix4().copy( trans ).invert();

      gp.userData.trans_mat = trans;
      gp.userData.inv_trans_mat = inverse_trans;

      if(!g.disable_trans_mat){
        gp.applyMatrix4(trans);
      }
    }

    gp.userData.construct_params = g;

    if(!g.group_data || typeof g.group_data !== "object") {
      g.group_data = {};
    }

    gp.userData.group_data = g.group_data;
    this.group.set( g.name, gp );
    this.add_to_scene(gp);

    // special case, if group name is "__global_data",
    // or starts with "_internal_group_data_", then set group variable
    const isGlobalGroup = g.name === '__global_data' && g.group_data;
    const isSubjectGroup = g.name.startsWith("_internal_group_data_") && g.group_data;
    if( isGlobalGroup ) {
      for( let _n in g.group_data ){
        this.shared_data.set(_n.substring(15), g.group_data[ _n ]);
      }
      // check if ".subject_codes" is in the name
      const subject_codes = asArray( this.shared_data.get(".subject_codes") );
      if( subject_codes.length > 0 ){

        // generate transform matrices
        subject_codes.forEach((scode) => {

          let subject_data = this.shared_data.get(scode);
          if( subject_data && typeof(subject_data) === "object" ){
            const Norig = as_Matrix4( subject_data.Norig );
            const Torig = as_Matrix4( subject_data.Torig );
            const xfm = as_Matrix4( subject_data.xfm );
            const tkrRAS_MNI305 = as_Matrix4( subject_data.vox2vox_MNI305 );
            const MNI305_tkrRAS = new Matrix4()
              .copy(tkrRAS_MNI305).invert();
            const tkrRAS_Scanner = new Matrix4()
              .copy(Norig)
              .multiply(
                new Matrix4()
                  .copy(Torig)
                  .invert()
              );
            subject_data.matrices = {
              Norig : Norig,
              Torig : Torig,
              xfm : xfm,
              tkrRAS_MNI305 : tkrRAS_MNI305,
              MNI305_tkrRAS : MNI305_tkrRAS,
              tkrRAS_Scanner: tkrRAS_Scanner
            };
          }

        });

      }
    } else if ( isSubjectGroup ) {
      // check subject code
      let scode = g.name.substr("_internal_group_data_".length);
      if ( typeof( g.group_data.subject_code ) === "string" ) {
        scode = g.group_data.subject_code;
      }
      let subject_data = g.group_data.subject_data;
      if( subject_data && typeof(subject_data) === "object" ){
        const Norig = as_Matrix4( subject_data.Norig );
        const Torig = as_Matrix4( subject_data.Torig );
        const xfm = as_Matrix4( subject_data.xfm );
        const tkrRAS_MNI305 = as_Matrix4( subject_data.vox2vox_MNI305 );
        const MNI305_tkrRAS = new Matrix4()
          .copy(tkrRAS_MNI305).invert();
        const tkrRAS_Scanner = new Matrix4()
          .copy(Norig)
          .multiply(
            new Matrix4()
              .copy(Torig)
              .invert()
          );
        subject_data.matrices = {
          Norig : Norig,
          Torig : Torig,
          xfm : xfm,
          tkrRAS_MNI305 : tkrRAS_MNI305,
          MNI305_tkrRAS : MNI305_tkrRAS,
          tkrRAS_Scanner: tkrRAS_Scanner
        };
        this.shared_data.set(scode, subject_data);
      }
    }

    // Async loading group cached data

    const cached_items = asArray( g.cached_items );

    const loadGroups = async () => {
      // Async loading cached items
      for( let ii in cached_items ) {
        const nm = cached_items[ ii ];
        const cache_info = g.group_data[nm];
        if(
          !cache_info || typeof(cache_info) !== "object" ||
          typeof cache_info.file_name !== "string"
        ) { continue; }
        const path = (cache_folder + g.cache_name + '/' + cache_info.file_name).replaceAll(/[\\\/]+/g, "/");
        this.debugVerbose(`Loading group [${ g.name }] data: [${ path }]`);
        const item = this.fileLoader.read( path );
        if( item && !item.data ) {
          await item.promise;
        }
        const v = this.fileLoader.parse( path );
        if( v && typeof(v) === "object" ) {
          for(let key in v) {
            if( key !== "_originalData_") {
              g.group_data[key] = v[key];
            }
          }
          if ("_originalData_" in v) {
            if( !(nm in g.group_data) ) {
              g.group_data[ nm ] = v[ "_originalData_" ];
            } else {
              const item = g.group_data[ nm ];
              if( typeof item === "object" && item !== null && item.is_cache ) {
                g.group_data[ nm ] = v[ "_originalData_" ];
              }
            }
          }
        }
      }

      // special case, if group name is "__global_data", then set group variable
      if( g.name === '__global_data' && g.group_data ){
        // this has to be done again to make sure cached data are set properly
        for( let _n in g.group_data ){
          this.shared_data.set(_n.substring(15), g.group_data[ _n ]);
        }

        const media_content = this.shared_data.get(".media_content");
        if( media_content ){
          for(let video_name in media_content){
            const content = media_content[video_name];
            if( !content.is_url ){
              content.url = (cache_folder + g.cache_name + '/' + content.url).replaceAll(/[\\\/]+/g, "/");
              content.is_url = true;
              const blob = await fetch(content.url).then(r => r.blob());
              content.url = URL.createObjectURL(blob);
            }
          }
        }

      }
    }

    return loadGroups();
  }

  // Debug stats (framerate)
  addNerdStats(){
    // if debug, add stats information
    if( this.__nerdStatsEnabled ) { return; }
    this.nerdStats = new Stats();
    this.nerdStats.dom.style.display = 'block';
    this.nerdStats.dom.style.position = 'absolute';
    this.nerdStats.dom.style.top = '0';
    this.nerdStats.dom.style.left = '0';
    this.$el.appendChild( this.nerdStats.dom );
    this.__nerdStatsEnabled = true;
  }

  /*---- Remove, dispose objects --------------------------------------------*/
  remove_object( obj, resursive = true, dispose = true, depth = 100 ){
    if( !obj && depth < 0 ){ return; }
    if( resursive ){
      if( Array.isArray( obj.children ) ){
        for( let ii = obj.children.length - 1; ii >= 0; ii = Math.min(ii-1, obj.children.length) ){
          if( ii < obj.children.length ){
            this.remove_object( obj.children[ ii ], resursive, dispose, depth - 1 );
          }
        }
      }
    }
    if( obj.parent ){
      this.debugVerbose( 'removing object - ' + (obj.name || obj.type) );
      obj.parent.remove( obj );
    }

    if( dispose ){
      this.dispose_object( obj );
    }
  }
  dispose_object( obj, quiet = false ){
    if( !obj || typeof obj !== 'object' ) { return; }
    const obj_name = obj.name || obj.type || 'unknown';
    if( !quiet ){
      this.debugVerbose('Disposing - ' + obj_name);
    }
    if( obj.userData && typeof obj.userData.dispose === 'function' ){
      this._try_dispose( obj.userData, obj.name, quiet );
    }else{
      // Not implemented, try to guess dispose methods
      this._try_dispose( obj.material, obj_name + '-material', quiet );
      this._try_dispose( obj.geometry, obj_name + '-geometry', quiet );
      this._try_dispose( obj, obj_name, quiet );
    }
  }

  _try_dispose( obj, obj_name = undefined, quiet = false ){
    if( !obj || typeof obj !== 'object' ) { return; }
    if( typeof obj.dispose === 'function' ){
      try {
        obj.dispose();
      } catch(e) {
        if( !quiet ){
          console.warn( 'Failed to dispose ' + (obj_name || obj.name || 'unknown') );
        }
      }
    }
  }

  dispose(){
    super.dispose();

    // Remove all objects, listeners, and dispose all
    this._disposed = true;
    this.activated = false;
    this.animParameters.dispose();

    // Remove listeners
    this.trackball.removeEventListener( "start", this._onTrackballChanged );
    this.trackball.removeEventListener( "change", this._onTrackballChanged );
    this.trackball.removeEventListener( "end", this._onTrackballEnded );
    this.$el.removeEventListener( 'viewerApp.mouse.enterViewer', this._activateViewer );
    this.$el.removeEventListener( 'viewerApp.mouse.leaveViewer', this._deactivateViewer );
    this.$el.removeEventListener( 'viewerApp.mouse.mousedown', this._onMouseDown );
    // this.$mainCanvas.removeEventListener( 'mousemove', this._onMouseMove );
    this.trackball.enabled = false;
    this.trackball.dispose();

    // Remove the rest objects in the scene
    this.remove_object( this.scene );

    // Remove customized objects
    this.clear_all();

    // dispose scene
    // this.scene.dispose();
    this.scene = null;

    // Remove el
    this.$el.innerHTML = '';

    // How to dispose renderers? Not sure
    this.domContext = null;
    this.domContextWrapper = null;
    this.main_renderer.dispose();
    this.sideCanvasList.coronal.dispose();
    this.sideCanvasList.axial.dispose();
    this.sideCanvasList.sagittal.dispose();

  }

  // Function to clear all meshes, but still keep canvas valid
  clear_all(){
    // Stop showing information of any selected objects
    this.object_chosen=undefined;
    this.clickable.clear();
    this.clickable_array.length = 0;
    this.title = undefined;

    this.subject_codes.length = 0;
    this.fileLoader.dispose();
    this.electrodes.clear();
    this.slices.clear();
    this.ct_scan.clear();
    this.surfaces.clear();
    this.atlases.clear();

    this.state_data.clear();
    this.shared_data.clear();
    this.colorMaps.clear();
    // this._mouse_click_callbacks['side_viewer_depth'] = undefined;

    this.debugVerbose('TODO: Need to dispose animation clips');
    this.animation_clips.clear();

    this.group.forEach((g) => {
      // g.parent.remove( g );
      this.remove_object( g );
    });
    this.mesh.forEach((m) => {
      this.remove_object( m );
      // m.parent.remove( m );
      // this.dispose_object(m);
      // this.scene.remove( m );
    });
    this.mesh.clear();
    // Call dispose method
    this.threebrain_instances.forEach((el) => {
      el.dispose();
    });
    this.threebrain_instances.clear();
    this.group.clear();

    this.singletons.forEach( (el) => {
      try {
        el.dispose();
      } catch (e) {}
    });
    this.singletons.clear();

    // set default values
    this._crosshairPosition.set( 0, 0, 0 );

  }



  /*---- Events -------------------------------------------------------------*/
  setControllerValue ({ name , value , folderName, immediate = true } = {}) {
    this.dispatch({
      type : "viewerApp.controller.setValue",
      data : {
        name : name,
        value: value,
        folderName : folderName
      },
      immediate : immediate
    });
  }

  setSliceCrosshair({x, y, z, immediate = true, centerCrosshair = false} = {}) {

    // set sagittal
    if( typeof x === "number" ) {
      if( x > 128 ) { x = 128; }
      if( x < -128 ) { x = -128; }
      this._crosshairPosition.x = x;
    }

    // set coronal
    if( typeof y === "number" ) {
      if( y > 128 ) { y = 128; }
      if( y < -128 ) { y = -128; }
      this._crosshairPosition.y = y;
    }

    // set axial
    if( typeof z === "number" ) {
      if( z > 128 ) { z = 128; }
      if( z < -128 ) { z = -128; }
      this._crosshairPosition.z = z;
    }
    this.crosshairGroup.position.copy( this._crosshairPosition );

    // Calculate datacube2 crosshair label/values
    // get active datacube2
    let crosshairText = "";
    const datacube2Instance = this.get_state( "activeDataCube2Instance" )
    if( datacube2Instance && datacube2Instance.isDataCube2 ) {
      crosshairText = datacube2Instance.getCrosshairValue( this._crosshairPosition );
    }

    // this.sideCanvasList.coronal.setFooter( crosshairText );
    // this.sideCanvasList.axial.setFooter( crosshairText );
    // this.sideCanvasList.sagittal.setFooter( crosshairText );

    this.dispatch({
      type : "viewerApp.canvas.setSliceCrosshair",
      data : {
        x : x, y : y, z : z,
        center: centerCrosshair,
        text: crosshairText
      },
      immediate : true
    });
    this.needsUpdate = true;
  }

  setVoxelRenderDistance({ distance, immediate = true } = {}) {
    if( typeof distance === "number" ) {
      this.set_state( "voxel_render_distance", distance );
    } else {
      distance = this.get_state( "voxel_render_distance" , 0.1 );
    }
    this.dispatch({
      type : "viewerApp.canvas.setVoxelRenderDistance",
      data : {
        distance: distance
      },
      immediate : immediate
    });
  }

  // callbacks
  handle_resize(width, height, lazy = false, center_camera = false){

    if( this._disposed ) { return; }
    if(width === undefined){
      width = this.client_width;
      height = this.client_height;

    }else{
      this.client_width = width;
      this.client_height = height;
    }

    // console.debug('width: ' + width + '; height: ' + height);

    if(lazy){
      this.trackball.handleResize();

      this.start_animation(0);

      return(undefined);
    }

    var main_width = width,
        main_height = height;

    // Because when panning controls, we actually set views, hence need to calculate this smartly
    // Update: might not need change
	  if( center_camera ){
      this.mainCamera.reset({ fov : true, position : false, zoom : false });
	  }else{
	    this.mainCamera.handleResize();
	  }

    this.main_canvas.style.width = main_width + 'px';
    this.main_canvas.style.height = main_height + 'px';

    // this.main_renderer.setSize( main_width, main_height );
    this.mainComposer.setSize( main_width, main_height );

    const pixelRatio = this.pixel_ratio[0];

    if( this.domElement.width != main_width * pixelRatio ){
      this.domElement.width = main_width * pixelRatio;
      this.domElement.style.width = main_width + 'px';
    }

    if( this.domElement.height != main_height * pixelRatio ){
      this.domElement.height = main_height * pixelRatio;
      this.domElement.style.height = main_height + 'px';
    }

    this.video_canvas.height = main_height / 4;

    this.trackball.handleResize();

    this.start_animation(0);

  }

  /*---- Setter/getters -----------------------------------------------------*/
  global_data(data_name){
    const gp = this.group.get("__global_data");
    let re = null;
    // group exists
    if(gp && gp.userData.group_data !== null && gp.userData.group_data.hasOwnProperty(data_name)){

      re = gp.userData.group_data[data_name];
    }

    return(re);

  }

  // Get data from some geometry settings. Try to get from geom first, then get from group
  get_data(data_name, from_geom, group_hint){

    const m = this.mesh.get( from_geom );
    let re, gp;

    if( m ){
      if(m.userData.hasOwnProperty(data_name)){
        // Object itself own the property, no group needs to go to
        return(m.userData[data_name]);
      }else{
        let g = m.userData.construct_params.group;
        if(g !== null){
          let group_name = g.group_name;
          gp = this.group.get( group_name );
          // set re
        }
      }
    }else if(group_hint !== undefined){
      let group_name = group_hint;
      gp = this.group.get( group_name );
      // set re

    }else if(this.debug){
      console.error('Cannot find data with name ' + from_geom + ' at group ' + group_hint);
    }

    // group exists
    if(gp && gp.userData.group_data !== null && gp.userData.group_data.hasOwnProperty(data_name)){

      re = gp.userData.group_data[data_name];
    }

    return(re);
  }


  // Canvas state
  set_state( key, val ) {
    const oldValue = this.state_data.get( key );
    if( oldValue !== val ) {
      this.debugVerbose(`[ViewerCanvas] setting state [${key}]`);
      this.state_data.set(key, val);
      this.dispatch( _stateDataChangeEvent );
    }
  }
  get_state( key, missing = undefined ) {
    if( this.state_data ) {
      return(get_or_default( this.state_data, key, missing ));
    } else {
      return( missing );
    }
  }

  // Font size magnification
  setFontSize( magnification = 1 ){
    // font size
    this._lineHeight_normal = Math.round( 24 * this.pixel_ratio[0] * magnification );
    this._lineHeight_small = Math.round( 20 * this.pixel_ratio[0] * magnification );
    this._fontSize_normal = Math.round( 20 * this.pixel_ratio[0] * magnification );
    this._fontSize_small = Math.round( 16 * this.pixel_ratio[0] * magnification );
    this._lineHeight_legend = Math.round( 20 * this.pixel_ratio[0] * magnification );
    this._fontSize_legend = Math.round( 16 * this.pixel_ratio[0] * magnification );
    this.set_state("font_magnification", magnification);
  }

  // Get mouse position (normalized)
  updateRaycast() {
    if( !this.activated ) { return; }
    if( !this._mouseEvent ) { return; }

    const event = this._mouseEvent;

    if( !event.offsetX && !event.offsetY ){
      // Firefox, where offsetX,Y are always 0
      const rect = this.domElement.getBoundingClientRect();
      this.mousePositionOnScreen.x = 2 * (event.clientX - rect.x) / rect.width - 1;
      // three.js origin is from bottom-left while html origin is top-left
      this.mousePositionOnScreen.y = 2 * (rect.y - event.clientY) / rect.height + 1;
    } else {
      this.mousePositionOnScreen.x = ( event.offsetX / this.domElement.clientWidth ) * 2 - 1;
      this.mousePositionOnScreen.y = - ( event.offsetY / this.domElement.clientHeight ) * 2 + 1;
    }
    this.mouseRaycaster.setFromCamera( this.mousePositionOnScreen, this.mainCamera );
    return this.mouseRaycaster;
  }

  // -------- Camera, control trackballs ........
  resetSideCanvas({
    width, zoomLevel = true, position = false,
    coronal = true, axial = true, sagittal = true
  } = {}) {
    if( typeof width !== 'number' ) {
      width = this._sideCanvasCSSWidth;
    }
    if( width * 3 > this.client_height ){
      width = Math.floor( this.client_height / 3 );
    }
    this.side_width = width;

    // Resize side canvas, make sure this.side_width is proper
    let pos = asArray( position );
    if( pos.length == 2 ) {
      const bounding = this.$el.getBoundingClientRect();
      const offsetX = Math.max( -bounding.x, pos[0] );
      let offsetY = Math.max( -bounding.y, pos[1] );
      if( coronal ) {
        this.sideCanvasList.coronal.reset({
          zoomLevel : zoomLevel,
          position : [ offsetX, offsetY ],
          crosshair: true
        });
      }
      offsetY += width;
      if( axial ) {
        this.sideCanvasList.axial.reset({
          zoomLevel : zoomLevel,
          position : [ offsetX, offsetY ],
          crosshair: true
        });
      }
      offsetY += width;
      if( sagittal ) {
        this.sideCanvasList.sagittal.reset({
          zoomLevel : zoomLevel,
          position : [ offsetX, offsetY ],
          crosshair: true
        });
      }
      offsetY += width;
    } else {
      if( coronal ) {
        this.sideCanvasList.coronal.reset({
          zoomLevel : zoomLevel,
          position : position,
          crosshair: true
        });
      }
      if( axial ) {
        this.sideCanvasList.axial.reset({
          zoomLevel : zoomLevel,
          position : position,
          crosshair: true
        });
      }
      if( sagittal ) {
        this.sideCanvasList.sagittal.reset({
          zoomLevel : zoomLevel,
          position : position,
          crosshair: true
        });
      }
    }

  }

  enableSideCanvas(){
	  // Add side renderers to the element
	  this.sideCanvasEnabled = true;
	  this.sideCanvasList.coronal.enabled = true;
	  this.sideCanvasList.axial.enabled = true;
	  this.sideCanvasList.sagittal.enabled = true;
	  this.start_animation( 0 );
	}
	disableSideCanvas(force = false){
	  this.sideCanvasEnabled = false;
	  this.sideCanvasList.coronal.enabled = false;
	  this.sideCanvasList.axial.enabled = false;
	  this.sideCanvasList.sagittal.enabled = false;
	  this.start_animation( 0 );
	}
  /*---- Choose & highlight objects -----------------------------------------*/

  focus_object( m = undefined, helper = false, auto_unfocus = false ){

    if( m ){
      if( this.object_chosen ){
        this.highlight( this.object_chosen, true );
      }
      this.object_chosen = m;
      this._last_object_chosen = m;
      this.highlight( this.object_chosen, false );
      this.animParameters.updateFocusedInstance( m.userData.instance );
      this.debugVerbose('object selected ' + m.name);


    } else {
      if( auto_unfocus ){
        if( this.object_chosen ) {
          this.highlight( this.object_chosen, true );
          this.animParameters.updateFocusedInstance( undefined );
          this.object_chosen = undefined;
          this.instanceChosen = undefined;
        }
      }
    }
  }

  /*
  * @param reset whether to reset (hide) box that is snapped to m
  */
  highlight( m, reset = false ){

    const highlight_disabled = get_or_default(
      this.state_data,
      'highlight_disabled',
      false
    );

    // use bounding box with this.focus_box
    if( !m || !m.isObject3D ){ return(null); }

    this.focus_box.setFromObject( m );
    if( !this.focus_box.userData.added ){
      this.focus_box.userData.added = true;
      this.add_to_scene( this.focus_box, true );
    }

    this.focus_box.visible = !reset && !highlight_disabled;

    // check if there is highlight helper
    if( m.children.length > 0 ){
      m.children.forEach((_c) => {
        if( _c.isMesh && _c.userData.is_highlight_helper ){
          set_visibility( _c, !reset );
          // _c.visible = !reset;
        }
      });
    }

  }

  /*---- Colors, animations, media ------------------------------------------*/
  createColorMap({
    dataName,           // data value
    displayName,        // display name
    controlColors,      // array of colors (key colors) or color name
    isContinuous = true,
    timeRange = null,   // time range where the color map is valid

    valueRange = null,  // for continuous
    hardRange = null,   // for continuous values that have theoretical boundaries

    valueKeys = null,   // for discrete  values
  } = {}){

    if( typeof dataName !== "string" ) { return; }

    const cmap = new NamedLut({
      colormap    : controlColors,
      continuous  : isContinuous,
      name        : typeof displayName === "string" ? displayName : dataName
    })

    if( Array.isArray( timeRange ) && timeRange.length > 0 ) {
      cmap.setTimeRange( timeRange[0], timeRange[1] );
    } else {
      cmap.setTimeRange( timeRange );
    }

    if( cmap.isContinuous ) {
      if( Array.isArray( hardRange ) && hardRange.length == 2 ) {
        cmap.setDataMin( hardRange[0] );
        cmap.setDataMax( hardRange[1] );
      }
      cmap._defaultMinV = valueRange[0];
      cmap._defaultMaxV = valueRange[1];
      cmap.setMin( valueRange[0] );
      cmap.setMax( valueRange[1] );
    } else {
      cmap.setKeys( valueKeys );
    }

    this.colorMaps.set( dataName, cmap );

  }

  switchColorMap( dataName, updateTimeRange = true ) {

    this.needsUpdate = true;

    let cmap = undefined;
    if( dataName ) {
      this.set_state( 'color_map', dataName );
      cmap = this.colorMaps.get( dataName );

      if( cmap && cmap.hasTimeRange ){
        this.set_state( 'time_range_min', cmap.minTime );
        this.set_state( 'time_range_max', cmap.maxTime );
      } else {
        this.set_state( 'time_range_min', 0 );
        this.set_state( 'time_range_max', 1 );
      }
    } else {
      cmap = this.colorMaps.get( this.get_state( 'color_map', '' ) );
    }

    if( updateTimeRange ) {
      this.updateTimeRange();
    }

    return cmap;
  }

  currentColorMap() {
    return this.colorMaps.get( this.get_state( 'color_map', '' ) );
  }

  switch_media( name ){
    this.video_canvas._playing = false;
    this.video_canvas.pause();
    this.video_canvas.currentTime = 0;
    this.video_canvas._enabled = false;

    const media_content = this.shared_data.get(".media_content");
    if( !media_content ){ return; }
    const content = media_content[ name ];
    if( !content ){ return; }
    // name (animation name), durtion, time_start, asp_ratio, url
    // set this.video_canvas;
    const video_height = this.video_canvas.height;
    this.video_canvas.src = content.url;
    this.video_canvas._time_start = content.time_start;
    this.video_canvas._asp_ratio = content.asp_ratio || (16/9);
    this.video_canvas._duration = content.duration || Infinity;
    this.video_canvas._name = content.name;
    this.video_canvas._enabled = true;

  }

  start_video( speed, video_time ){
    if( speed < 0.1 ){
      this.pause_video( video_time );
      return;
    }
    if( this.video_canvas.playbackRate !== speed ){
      this.video_canvas.playbackRate = speed;
    }

    if( !this.video_canvas._playing ) {
      this.video_canvas._playing = true;
      this.video_canvas.play(() => {
        this.video_canvas.currentTime = video_time.toFixed(2);
      });
    }
  }

  pause_video( video_time ){
    if( this.video_canvas._playing || !this.video_canvas.paused ){
      this.video_canvas._playing = false;
      this.video_canvas.pause();
    }

    if ( video_time !== undefined ){
      const delta = Math.abs(parseFloat(this.video_canvas.currentTime) - video_time);
      if( delta > 0.05 ){
        this.video_canvas.currentTime = video_time.toFixed(2);
      }
      // this.video_canvas.currentTime = video_time.toFixed(2);
    }
  }

  /*---- Update function at each animationframe -----------------------------*/

  // Animation-related:
  incrementTime(){
    this.timeChanged = this.animParameters.incrementTime();
  }

  // set renderer's flag (persistLevel):
  // 0: render once at next cycle
  start_animation( persistLevel = 0 ){
    // persistLevel 0, render once
    // persistLevel > 0, loop

    const _flag = this._renderFlag;
    if( persistLevel >= _flag ){
      this._renderFlag = persistLevel;
    }
    if( persistLevel >= 2 && _flag < 2 ){
      // _flag < 2 means prior state only renders the scene, but animation is paused
      // if _flag >= 2, then clock was running, then there is no need to start clock
      // persist >= 2 is a flag for animation to run
      // animation clips need a clock
      this.animParameters._clock.start();
    }
  }
  get needsUpdate () { return this._renderFlag >= 0; }
  set needsUpdate ( persistLevel ) {
    if( persistLevel === true ) {
      persistLevel = 0;
    }
    // persistLevel 0, render once
    // persistLevel > 0, loop
    const _flag = this._renderFlag;
    if( persistLevel >= _flag ){
      this._renderFlag = persistLevel;
    }
    if( persistLevel >= 2 && _flag < 2 ){
      // _flag < 2 means prior state only renders the scene, but animation is paused
      // if _flag >= 2, then clock was running, then there is no need to start clock
      // persist >= 2 is a flag for animation to run
      // animation clips need a clock
      this.animParameters._clock.start();
    }
  }

  // Pause animation
  pause_animation( level = 1 ){
    const _flag = this._renderFlag;
    if(_flag <= level){
      this._renderFlag = -1;

      // When animation is stopped, we need to check if clock is running, if so, stop it
      if( _flag >= 2 ){
        this.animParameters._clock.stop();
      }
    }
  }
  pauseAnimation ( persistLevel = 1 ) {
    this.pause_animation( persistLevel );
  }


  update(){

    this.trackball.update();
    this.compass.update();

    // check if time has timeChanged
    this.threebrain_instances.forEach((inst) => {
      inst.update();
    });
  }

  // re-render canvas to display additional information without 3D
  mapToCanvas(){
    const _width = this.domElement.width,
          _height = this.domElement.height;

    // Clear the whole canvas
    this.domContext.fillStyle = this.background_color;
    this.domContext.fillRect(0, 0, _width, _height);

    // copy the main_renderer context
    this.domContext.drawImage( this.main_renderer.domElement, 0, 0, _width, _height);

  }

  // Main render function, automatically scheduled
  render(){

    if( this.__nerdStatsEnabled ) { this.nerdStats.update(); }

    const _width = this.domElement.width;
    const _height = this.domElement.height;

    // Do not render if the canvas is too small
    // Do not change flags, wait util the state come back to normal
    if(_width <= 10 || _height <= 10) { return; }

    // double-buffer to make sure depth renderings
    //this.main_renderer.setClearColor( renderer_colors[0] );
    this.main_renderer.clear();

    this._mainCameraPositionNormalized.copy( this.mainCamera.position ).normalize();

    // Set crosshair quaternion and positions
    if( this.get_state("sideCameraTrackMainCamera", false) ) {
      this.crosshairGroup.position.set( 0, 0, 0 );
      this.crosshairGroup.quaternion.copy( this.mainCamera.quaternion );

      this.crosshairGroup.LR.layers.enable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this.crosshairGroup.PA.layers.enable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
    } else {
      this.crosshairGroup.quaternion.set( 0, 0, 0, 1 );
      this.crosshairGroup.LR.layers.disable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this.crosshairGroup.PA.layers.disable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
    }
    this.crosshairGroup.position.copy( this._crosshairPosition );

    // set electrode outline clearcoat value
    const renderOutlines = this.get_state( "outline_state", "auto" );
    if ( renderOutlines === "on" ) {
      // this.mainOutlinePass.enabled = true;
      this.set_state( "electrode_clearcoat", 0.5 );
    } else if ( renderOutlines === "off" ) {
      // this.mainOutlinePass.enabled = false;
      this.set_state( "electrode_clearcoat", 0.0 );
    } else {
      const left_opacity = this.get_state( "surface_opacity_left", 1.0 );
      const right_opacity = this.get_state( "surface_opacity_right", 1.0 );
      const left_mtype = this.get_state( "material_type_left", "normal" );
      const right_mtype = this.get_state( "material_type_right", "normal" );

      if( (left_mtype === "normal" && left_opacity > 0.2 && left_opacity < 1) ||
          (left_mtype === "wireframe" && left_opacity > 0.1) ||
          (right_mtype === "normal" && right_opacity > 0.2 && right_opacity < 1) ||
          (right_mtype === "wireframe" && right_opacity > 0.1)
      ) {
        // this.mainOutlinePass.enabled = true;
        this.set_state( "electrode_clearcoat", 0.5 );
      } else {
        // this.mainOutlinePass.enabled = false;
        this.set_state( "electrode_clearcoat", 0.0 );
      }
    }

    // Pre render all meshes
    this.mesh.forEach((m) => {
      const inst = m.userData.instance;
      if( inst && typeof inst === "object" && inst.isThreeBrainObject ) {
        try {
          inst.pre_render({ target : CONSTANTS.RENDER_CANVAS.main, mainCameraPositionNormalized : this._mainCameraPositionNormalized });
        } catch (e) {
          if( !this.__render_error ) {
            console.warn(e);
            this.__render_error = true;
          }
        }
      }
    });

    // Pre render all singletons
    this.singletons.forEach((s) => {

      if( s && typeof(s) === "object" && typeof s.pre_render === 'function' ) {
        try {
          s.pre_render();
        } catch (e) {
          if( !this.__render_error ) {
            console.warn(e);
            this.__render_error = true;
          }
        }
      }

    });

    // this.main_renderer.render( this.scene, this.mainCamera );

    this.mainComposer.render( this.scene, this.mainCamera );

    if(this.sideCanvasEnabled){

      // Pre render all meshes
      this.mesh.forEach((m) => {
        const inst = m.userData.instance;
        if( inst && typeof inst === "object" && inst.isThreeBrainObject ) {
          try {
            inst.pre_render({ target : CONSTANTS.RENDER_CANVAS.side });
          } catch (e) {
            if( !this.__render_error ) {
              console.warn(e);
              this.__render_error = true;
            }
          }
        }
      });

      this.sideCanvasList.coronal.render();
      this.sideCanvasList.axial.render();
      this.sideCanvasList.sagittal.render();


    }



		// draw main and side rendered images to this.domElement (2d context)
		this.mapToCanvas();


		// Add additional information
    // const _pixelRatio = this.pixel_ratio[0];
    // const _fontType = 'Courier New, monospace';

    this.domContext.fillStyle = this.foreground_color;

    // Draw title on the top left corner
    this.renderTitle( 0, 0, _width, _height );

    // Draw timestamp on the bottom right corner
    this.renderTimestamp( 0, 0, _width, _height );

    // Draw legend on the right side
    this.renderLegend( 0, 0, _width, _height );

    // Draw focused target information on the top right corner
    this.renderSelectedObjectInfo( 0, 0, _width, _height );

    // check if capturer is working
    if( this.capturer_recording && this.capturer ){
      this.capturer.add();
    }

    // this._draw_video( results, _width, _height );

    // reset render flag
    if(this._renderFlag === 0){
      this._renderFlag = -1;
    }

  }

  updateTimeRange(){
    let min_t0 = this.get_state( 'time_range_min0' );
    let max_t0 = this.get_state( 'time_range_max0' );
    let min_t = this.get_state( 'time_range_min', 0 );
    let max_t = this.get_state( 'time_range_max', 0 );

    if( min_t0 !== undefined ){
      min_t = Math.min( min_t, min_t0 );
    }

    if( max_t0 !== undefined ){
      max_t = Math.max( max_t, max_t0 );
    }
    this.animParameters.min = min_t;
    this.animParameters.max = max_t;
  }


  renderTitle( x = 10, y = 10, w = 100, h = 100 ){

    if( typeof this.title !== "string" ) { return; }

    const pixelRatio = this.pixel_ratio[0];

    this._fontType = 'Courier New, monospace';
    this._lineHeight_title = this._lineHeight_title || Math.round( 25 * pixelRatio );
    this._fontSize_title = this._fontSize_title || Math.round( 20 * pixelRatio );


    this.domContext.fillStyle = this.foreground_color;
    this.domContext.font = `${ this._fontSize_title }px ${ this._fontType }`;

    if( this.sideCanvasEnabled ) {
      x += this.side_width;
    }
    x += 10; // padding left
    x *= pixelRatio;

    // Add title
    let ii = 0, ss = [];
    ( this.title || '' )
      .split('\\n')
      .forEach( (ss, ii) => {
        this.domContext.fillText( ss , x , y + this._lineHeight_title * (ii + 1) );
      });
  }

  _draw_ani_old( x = 10, y = 10, w = 100, h = 100  ){

    this._lineHeight_normal = this._lineHeight_normal || Math.round( 25 * this.pixel_ratio[0] );
    this._fontSize_normal = this._fontSize_normal || Math.round( 15 * this.pixel_ratio[0] );

    // Add current time to bottom right corner
    if( this.animParameters.renderTimestamp ) {
      this.domContext.font = `${ this._fontSize_normal }px ${ this._fontType }`;
      this.domContext.fillText(
        // Current clock time
        `${ this.animParameters.time.toFixed(3) } s`,
        // offset
        w - this._fontSize_normal * 8, h - this._lineHeight_normal * 1);
    }
  }

  renderTimestamp( x = 10, y = 10, w = 100, h = 100, contextWrapper = undefined  ){

    if( !this.animParameters.exists ) { return; }

    if( !contextWrapper ){
      contextWrapper = this.domContextWrapper;
    }

    this._lineHeight_normal = this._lineHeight_normal || Math.round( 25 * this.pixel_ratio[0] );
    this._fontSize_normal = this._fontSize_normal || Math.round( 15 * this.pixel_ratio[0] );

    contextWrapper._lineHeight_normal = this._lineHeight_normal;
    contextWrapper._fontSize_normal = this._fontSize_normal;

    // Add current time to bottom right corner
    if( this.animParameters.renderTimestamp ) {
      contextWrapper.set_font( this._fontSize_normal, this._fontType );
      contextWrapper.fill_text(
        // Current clock time
        `${ this.animParameters.time.toFixed(3) } s`,

        // offset
        w - this._fontSize_normal * 8, h - this._lineHeight_normal * 2);
    }
  }

  renderLegend( x = 10, y = 10, w = 100, h = 100, contextWrapper = undefined ){

    const cmap = this.currentColorMap();

    // whether to draw legend
    if( !this.animParameters.renderLegend ) { return; }
    if( !cmap ) { return; }
    if( !cmap.lut.length ) { return; }
    if( !contextWrapper ){
      contextWrapper = this.domContextWrapper;
    }

    // Added: if info text is disabled, then legend should not display
    // correspoding value
    let hideInfoFocused = true;
    let currentValue;
    if( this.animParameters.hasObjectFocused && !this.get_state( 'info_text_disabled') ) {
      hideInfoFocused = false;
      currentValue = this.animParameters.objectFocused.currentDataValue;
    }

    this._lineHeight_legend = this._lineHeight_legend || Math.round( 15 * this.pixel_ratio[0] );
    this._fontSize_legend = this._fontSize_legend || Math.round( 10 * this.pixel_ratio[0] );

    const pixelRatio = this.pixel_ratio[0];
    cmap.renderLegend(
      contextWrapper, w, h,
      {
        legendWidth       : 25 * pixelRatio,
        // legendHeightRatio : 0.5,
        offsetTopRatio    : 0.3,
        offsetRight       : 0,
        lineHeight        : this._lineHeight_legend,
        fontSize          : this._fontSize_legend,
        fontType          : this._fontType,
        highlightValue    : currentValue,
        foreground        : this.foreground_color,
        background        : this.background_color
      }
    );
  }

  renderSelectedObjectInfo(
    x = 10, y = 10, w = 100, h = 100,
    contextWrapper = undefined, force_left = false ){

    // Add selected object information, or if not showing is set
    if( !this.animParameters.hasObjectFocused || this.get_state( 'info_text_disabled') ){
      // no object selected, discard
      return;
    }

    if( !contextWrapper ){
      contextWrapper = this.domContextWrapper;
    }

    const objectInfo = this.animParameters.objectFocused;

    this._lineHeight_normal = this._lineHeight_normal || Math.round( 25 * this.pixel_ratio[0] );
    this._lineHeight_small = this._lineHeight_small || Math.round( 15 * this.pixel_ratio[0] );
    this._fontSize_normal = this._fontSize_normal || Math.round( 15 * this.pixel_ratio[0] );
    this._fontSize_small = this._fontSize_small || Math.round( 10 * this.pixel_ratio[0] );

    contextWrapper.set_font_color( this.foreground_color );
    contextWrapper.set_font( this._fontSize_normal, this._fontType );

    let text_left;
    if( this.sideCanvasEnabled && !force_left ){
      text_left = w - Math.ceil( 50 * this._fontSize_normal * 0.42 );
    } else {
      text_left = Math.ceil( this._fontSize_normal * 0.42 * 2 );
    }
    if( !this.__textPosition ) {
      this.__textPosition = new Vector2();
    }
    const textPosition = this.__textPosition;
    textPosition.set(
      text_left,

      // Make sure it's not hidden by control panel
      this._lineHeight_normal + this._lineHeight_small + this.pixel_ratio[0] * 10
    );

    // Line 1: object name
    contextWrapper.fill_text( objectInfo.name, textPosition.x, textPosition.y );

    // Smaller
    contextWrapper.set_font( this._fontSize_small, this._fontType );

    // Line 2: Global position

    let pos = objectInfo.position;
    const electrodeInstance = objectInfo.instance && objectInfo.instance.isElectrode ? objectInfo.instance : null;
    if( electrodeInstance ){
      if( pos && (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) ){
        textPosition.y += this._lineHeight_small

        const subjectCode = electrodeInstance.subject_code;
        const subjectData = this.shared_data.get( subjectCode );

        if( subjectData && subjectData.matrices ) {
          this._tmpMat4.copy( subjectData.matrices.Torig ).invert()
            .premultiply( subjectData.matrices.Norig );
          this._tmpVec3.copy( pos ).applyMatrix4( this._tmpMat4 );
          pos = this._tmpVec3
          contextWrapper.set_font( this._fontSize_small, this._fontType, true );
          contextWrapper.fill_text(
            `           ${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}`,
            textPosition.x, textPosition.y
          );
          contextWrapper.set_font( this._fontSize_small, this._fontType, false );
          contextWrapper.fill_text( `ScanRAS: `, textPosition.x , textPosition.y );
        }
      }
    } else {
      textPosition.y += this._lineHeight_small;
      contextWrapper.fill_text(
        `tkrRAS:    (${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)})`,
        textPosition.x, textPosition.y
      );
    }

    // For electrodes
    if( electrodeInstance ){
      const mappingInfo = objectInfo.templateMapping;

      const _tn = electrodeInstance._thresholdName || '[None]';
      let _tv = electrodeInstance._currentThresholdValue;
      if( typeof _tv === 'number' ){
        _tv = _tv.toPrecision(4);
      }

      const _dn = electrodeInstance._animationName;
      let _dv = electrodeInstance._currentValue;

      if( typeof _dv === 'number' ){
        _dv = _dv.toPrecision(4);
      }

      // Line 3: mapping method & surface type
      /*
      text_position[ 1 ] = text_position[ 1 ] + this._lineHeight_small;

      contextWrapper.fill_text.fillText(
        `Surface: ${ _m.surface }, shift vs. MNI305: ${ _m.shift.toFixed(2) }`,
        text_position[ 0 ], text_position[ 1 ]
      );
      */

      // Line 4:
      if( _dv !== undefined ){
        textPosition.y += this._lineHeight_small;

        contextWrapper.fill_text(
          `Display:   ${ _dn } (${ _dv })`,
          textPosition.x, textPosition.y
        );
      }


      // Line 5:
      if( _tv !== undefined ){
        textPosition.y += this._lineHeight_small;

        contextWrapper.fill_text(
          `Threshold: ${ _tn } (${ _tv })`,
          textPosition.x, textPosition.y
        );
      }


    }

    // Line last: customized message
    textPosition.y += this._lineHeight_small;

    contextWrapper.fill_text(
      objectInfo.customInfo || '',
      textPosition.x, textPosition.y
    );

  }

  _draw_video( results, w, h, contextWrapper ){
    if( !this.video_canvas._enabled || this.video_canvas._mode === 'hidden' ){ return; }
    // set video time
    const video_time = results.last_time - this.video_canvas._time_start;

    if(
      this.video_canvas.ended || video_time <= 0 ||
      video_time > Math.min( this.video_canvas._duration, this.video_canvas.duration )
    ){
      this.pause_video( 0 );
      return;
    }

    if( this._renderFlag >= 2 ){
      this.start_video( results.speed || 1, video_time );
    } else {
      // static, set timer
      this.pause_video( video_time );
    }

    const video_height = this.video_canvas.height,
          video_width = video_height * this.video_canvas._asp_ratio;
    if( contextWrapper ){
      contextWrapper.draw_video(
        this.video_canvas, 0, h - video_height,
        video_width, video_height
      );
    } else {
      this.domContextWrapper.draw_video(
        this.video_canvas, 0, h - video_height,
        video_width, video_height
      );
    }


  }


  /*---- Subjects, electrodes, surfaces, slices ----------------------------*/
  init_subject( subject_code ){
    if( !subject_code ){ return; }
    if( ! this.subject_codes.includes( subject_code ) ){
      this.subject_codes.push( subject_code );
      this.electrodes.set( subject_code, {});
      this.slices.set( subject_code, {} );
      this.ct_scan.set( subject_code, {} );
      this.surfaces.set(subject_code, {} );
      this.atlases.set( subject_code, {} );
    }
  }

  getAllSurfaceTypes(){
    const corticalSurfaces = { 'pial' : 1 }; // always put pials to the first one
    const subCorticals = {};

    this.threebrain_instances.forEach((inst, name) => {
      if( inst.isFreeMesh ) {
        if( inst.isSubcortical ) {
          subCorticals[ inst.surface_type ] = 1;
        } else {
          corticalSurfaces[ inst.surface_type ] = 1;
        }
      }
    });

    return({
      cortical: Object.keys( corticalSurfaces ),
      subcortical: Object.keys( subCorticals )
    });
  }

  get_atlas_types(){
    const current_subject = this.get_state('target_subject') || "";
    let atlases = this.atlases.get( current_subject );
    if( !atlases ) {
      return([]);
    }
    atlases = Object.keys( atlases );
    const re = atlases.map((v) => {
      const m = CONSTANTS.REGEXP_ATLAS.exec( v );
      if( m && m.length >= 2 ){
        return( m[1] );
      }
      return( null );
    }).filter((v) => {
      return( typeof(v) === 'string' );
    })


    return( asArray( re ) );
  }

  get_ct_types(){
    const re = {};

    this.ct_scan.forEach( (vol, s) => {
      let volume_names = Object.keys( vol ),
          //  T1 (YAB)
          res = new RegExp('^(.*) \\(' + s + '\\)$').exec(g);
          // res = CONSTANTS.REGEXP_VOLUME.exec(g);

      if( res && res.length === 2 ){
        re[ res[1] ] = 1;
      }
    });
    return( Object.keys( re ) );
  }


  switch_subject( target_subject = '/', args = {}){

    if( this.subject_codes.length === 0 ){
      return( null );
    }

    const state = this.state_data;

    // not actually switch subjects, only reset some options
    if( !this.subject_codes.includes( target_subject ) ){

      // get current subject
      target_subject = state.get('target_subject');


      // no subject initiated, use template if multiple subjects
      if( !target_subject || !this.subject_codes.includes( target_subject ) ){
        // This happends when subjects are just loaded
        if( this.shared_data.get(".multiple_subjects") ){
          target_subject = this.shared_data.get(".template_subjects");
        }
      }

      // error-proof
      if( !target_subject || !this.subject_codes.includes( target_subject ) ){
        target_subject = this.subject_codes[0];
      }

    }
    let subject_changed = state.get('target_subject') === target_subject;
    state.set( 'target_subject', target_subject );

    let surface_type = args.surface_type || state.get( 'surface_type' ) || 'pial';
    let atlas_type = args.atlas_type || state.get( 'atlas_type' ) || 'none';
    let material_type_left = args.material_type_left || state.get( 'material_type_left' ) || 'normal';
    let material_type_right = args.material_type_right || state.get( 'material_type_right' ) || 'normal';
    let slice_type = args.slice_type || state.get( 'slice_type' ) || 'T1';
    let ct_type = args.ct_type || state.get( 'ct_type' ) || 'ct.aligned.t1';
    let ct_threshold = args.ct_threshold || state.get( 'ct_threshold' ) || 0.8;

    let map_template = state.get( 'map_template' ) || false;

    if( args.map_template !== undefined ){
      map_template = args.map_template;
    }
    let map_type_surface = args.map_type_surface || state.get( 'map_type_surface' ) || 'sphere.reg';
    let map_type_volume = args.map_type_volume || state.get( 'map_type_volume' ) || 'mni305';
    let surface_opacity_left = args.surface_opacity_left || state.get( 'surface_opacity_left' ) || 1;
    let surface_opacity_right = args.surface_opacity_right || state.get( 'surface_opacity_right' ) || 1;

    let activeSlices = state.get("activeSliceInstance");
    const shownSlices = [], hiddenSlices = [];
    if( activeSlices && activeSlices.isDataCube ) {
      if( activeSlices.coronalActive ) {
        shownSlices.push( "coronal" );
      } else {
        hiddenSlices.push( "coronal" );
      }
      if( activeSlices.sagittalActive ) {
        shownSlices.push( "sagittal" );
      } else {
        hiddenSlices.push( "sagittal" );
      }
      if( activeSlices.axialActive ) {
        shownSlices.push( "axial" );
      } else {
        hiddenSlices.push( "axial" );
      }
    }

    // TODO: add checks
    const subject_data  = this.shared_data.get( target_subject );

    // tkRAS should be tkrRAS, TODO: fix this typo
    const tkRAS_MNI305 = subject_data.matrices.tkrRAS_MNI305;
    const MNI305_tkRAS = subject_data.matrices.MNI305_tkrRAS;

    let scannerCenter = subject_data.scanner_center;
    if( !Array.isArray( scannerCenter ) || scannerCenter.length != 3) {
      scannerCenter = [0, 0, 0];
      subject_data.scanner_center = scannerCenter;
    }

    this.switch_slices( target_subject, slice_type );
    this.switch_ct( target_subject, ct_type, ct_threshold );
    this.switch_atlas( target_subject, atlas_type );
    /*
    this.switch_surface( target_subject, surface_type,
                          [surface_opacity_left, surface_opacity_right],
                          [material_type_left, material_type_right] );
                          */

    if( map_template ){
      this.map_electrodes( target_subject, map_type_surface, map_type_volume );
    }else{
      this.map_electrodes( target_subject, 'reset', 'reset' );
    }

    // reset overlay
    activeSlices = state.get("activeSliceInstance");
    if( activeSlices && activeSlices.isDataCube ) {
      activeSlices.showSlices( shownSlices );
      activeSlices.hideSlices( hiddenSlices );
    }

    state.set( 'surface_type', surface_type );
    state.set( 'atlas_type', atlas_type );
    state.set( 'material_type_left', material_type_left );
    state.set( 'material_type_right', material_type_right );
    state.set( 'slice_type', slice_type );
    state.set( 'ct_type', ct_type );
    state.set( 'ct_threshold', ct_threshold );
    state.set( 'map_template', map_template );
    state.set( 'map_type_surface', map_type_surface );
    state.set( 'map_type_volume', map_type_volume );
    state.set( 'surface_opacity_left', surface_opacity_left );
    state.set( 'surface_opacity_right', surface_opacity_right );
    state.set( 'tkRAS_MNI305', tkRAS_MNI305 );

    // reset origin to AC
    // this.origin.position.copy( anterior_commissure );

    // Re-calculate controls center so that rotation center is the center of mesh bounding box
    const pialSurfaceGroup = this.group.get(`Surface - pial (${target_subject})`);
    if( pialSurfaceGroup && pialSurfaceGroup.isObject3D ) {
      this.bounding_box.setFromObject( pialSurfaceGroup );
      this.bounding_box.geometry.computeBoundingBox();
      const _b = this.bounding_box.geometry.boundingBox;
      const newControlCenter = _b.min.clone()
        .add( _b.max ).multiplyScalar( 0.5 );
      newControlCenter.remember = true;
      this.trackball.lookAt( newControlCenter );
    } else {
      this.trackball.lookAt({
        x : scannerCenter[0],
        y : scannerCenter[1],
        z : scannerCenter[2],
        remember : true
      });
    }
    this.trackball.update();

    this.dispatch( _subjectStateChangedEvent );
    this.needsUpdate = true;

  }

  calculate_mni305(vec, nan_if_trans_not_found = true){
    if( !vec.isVector3 ){
      throw('vec must be a Vector3 instance');
    }

    const tkRAS_MNI305 = this.get_state('tkRAS_MNI305');
    if( tkRAS_MNI305 && tkRAS_MNI305.isMatrix4 ){
      // calculate MNI 305 position
      vec.applyMatrix4(tkRAS_MNI305);
    } else if( nan_if_trans_not_found ){
      vec.set(NaN, NaN, NaN);
    }
    return(vec);
  }

  /*
  switch_surface( target_subject, surface_type = 'pial', opacity = [1, 1], material_type = ['normal', 'normal'] ){
    // this.surfaces[ subject_code ][ g.name ] = m;
    // Naming - Surface         Standard 141 Right Hemisphere - pial (YAB)
    // or FreeSurfer Right Hemisphere - pial (YAB)
    this.surfaces.forEach( (sf, subject_code) => {
      for( let surface_name in sf ){
        const m = sf[ surface_name ];
        // m.visible = false;
        set_visibility( m, false );
        if( subject_code === target_subject ){

          if(
            surface_name === `Standard 141 Left Hemisphere - ${surface_type} (${target_subject})` ||
            surface_name === `FreeSurfer Left Hemisphere - ${surface_type} (${target_subject})`
          ){
            set_display_mode( m, material_type[0] );
            set_visibility( m, material_type[0] !== 'hidden' );
            m.material.wireframe = ( material_type[0] === 'wireframe' );
            m.material.opacity = opacity[0];
            // m.material.transparent = opacity[0] < 0.99;
          }else if(
            surface_name === `Standard 141 Right Hemisphere - ${surface_type} (${target_subject})` ||
            surface_name === `FreeSurfer Right Hemisphere - ${surface_type} (${target_subject})`
          ){
            set_display_mode( m, material_type[1] );
            set_visibility( m, material_type[1] !== 'hidden' );
            m.material.wireframe = ( material_type[1] === 'wireframe' );
            m.material.opacity = opacity[1];
            // m.material.transparent = opacity[1] < 0.99;
          }

        }
      }
    });
    this.start_animation( 0 );
  }
  */

  switch_slices( target_subject, slice_type = 'T1' ){

    const oldActiveSlices = this.get_state("activeSliceInstance")
    let newActiveSlices;
    //this.ssss
    this.slices.forEach( (vol, subject_code) => {
      for( let volume_name in vol ){
        const m = vol[ volume_name ];
        if( subject_code === target_subject && volume_name === `${slice_type} (${subject_code})`){
          set_visibility( m[0].parent, true );
          newActiveSlices = m[0].userData.instance;
        }else{
          // m[0].parent.visible = false;
          set_visibility( m[0].parent, false );
        }
      }
    });

    if( newActiveSlices !== oldActiveSlices ) {
      this.set_state( "activeSliceInstance", newActiveSlices );
    }

    this.start_animation( 0 );
  }

  // used to switch atlas, but can also switch other datacube2
  switch_atlas( target_subject, atlas_type ){
    /*if( subject_changed ) {
      let atlas_types = asArray( this.atlases.get(target_subject) );

    }*/

    const oldDataCube2 = this.get_state( "activeDataCube2Instance" );
    let newDataCube2;

    this.atlases.forEach( (al, subject_code) => {
      for( let atlas_name in al ){
        const m = al[ atlas_name ];
        if( subject_code === target_subject && atlas_name === `Atlas - ${atlas_type} (${subject_code})`){
          // m.visible = true;
          set_visibility( m, true );
          newDataCube2 = m.userData.instance;
        }else{
          // m.visible = false;
          set_visibility( m, false );
        }
      }
    });

    if( oldDataCube2 !== newDataCube2 ) {
      this.debugVerbose(`Setting volume data cube: ${atlas_type} (${target_subject})`);
      this.set_state( "activeDataCube2Instance", newDataCube2 );
    }
  }

  switch_ct( target_subject, ct_type = 'ct.aligned.t1', ct_threshold = 0.8 ){

    this.ct_scan.forEach( (vol, subject_code) => {
      for( let ct_name in vol ){
        const m = vol[ ct_name ];
        if( subject_code === target_subject && ct_name === `${ct_type} (${subject_code})`){
          // m.parent.visible = this._show_ct;
          set_visibility( m.parent, this._show_ct );
          m.material.uniforms.u_renderthreshold.value = ct_threshold;
        }else{
          // m.parent.visible = false;
          set_visibility( m.parent, false );
        }
      }
    });

    this.start_animation( 0 );
  }

  // get matrices
  getTransforms( subjectCode ) {
    const scode = typeof subjectCode === "string" ? subjectCode : this.get_state("target_subject", "/");
    const subjectData = this.shared_data.get( scode );
    if(
      !subjectData || typeof subjectData !== "object" ||
      typeof subjectData.matrices !== "object"
    ) {
      throw `Cannot obtain transform matrices from subject: ${scode}`;
    }
    return( subjectData.matrices );
  }

  // Map electrodes
  map_electrodes( target_subject, surface = 'sphere.reg', volume = 'mni305' ){

    /* debug code
    target_subject = 'N27';surface = 'std.141';volume = 'mni305';origin_subject='YAB';
    pos_targ = new Vector3(),
          pos_orig = new Vector3(),
          mat1 = new Matrix4(),
          mat2 = new Matrix4();
    el = canvas.electrodes.get(origin_subject)["YAB, 29 - aTMP6"];
    g = el.userData.construct_params,
              is_surf = g.is_surface_electrode,
              vert_num = g.vertex_number,
              surf_type = g.surface_type,
              mni305 = g.MNI305_position,
              origin_position = g.position,
              target_group = canvas.group.get( `Surface - ${surf_type} (${target_subject})` ),
              hide_electrode = origin_position[0] === 0 && origin_position[1] === 0 && origin_position[2] === 0;
              pos_orig.fromArray( origin_position );
mapped = false,
            side = (typeof g.hemisphere === 'string' && g.hemisphere.length > 0) ? (g.hemisphere.charAt(0).toUpperCase() + g.hemisphere.slice(1)) : '';
    */

    this.dispatch( {
      type : "viewerApp.electrodes.mapToTemplate",
      data : {
        subject : target_subject,
        surface : surface,
        volume  : volume
      },
      immediate : true
    });

    // also update singletons TODO: add event listeners
    const line_segs = this.singletons.get(
      CONSTANTS.SINGLETONS["line-segments"]
    );
    if( line_segs ) {
      line_segs.update_segments();
    }
    this.start_animation( 0 );
  }


  // export electrodes
  electrodes_info(args={}){

    const res = [];

    this.electrodes.forEach( ( collection , subject_code ) => {
      const _regexp = new RegExp(`^${subject_code}, ([0-9]+) \\- (.*)$`),
            // _regexp = CONSTANTS.REGEXP_ELECTRODE,
            subject_data  = this.shared_data.get( subject_code ),
            tkrRAS_Scanner = subject_data.matrices.tkrRAS_Scanner,
            xfm = subject_data.matrices.xfm,
            pos = new Vector3();
      let parsed, e, g, inst;
      const label_list = {};

      for( let k in collection ){
        parsed = _regexp.exec( k );
        // just incase
        if( parsed && parsed.length === 3 ){

          e = collection[ k ];
          const row = e.userData.instance.get_summary( args );

          if( row && typeof row ==="object" ) {
            res.push( row );
          }
        }

      }

    });

    return( res );
  }

  download_electrodes( format = 'json' ){
    const res = this.electrodes_info();

    if( res.length == 0 ){
      alert("No electrode found!");
      return;
    }

    if( format === 'json' ){
      download(
        JSON.stringify(res) ,
        'electrodes.json',
        'application/json'
      );
    }else if( format === 'csv' ){
      json2csv(res, (err, csv) => {
        download( csv , 'electrodes.csv', 'plan/csv');
      });
    }

  }

  // ------------------------------ Drivers -----------------------------------
  setBackground({ color } = {}) {
    if( color === undefined || color === null ) { return; }

    const c = asColor( color , new Color() );
    const backgroundLuma = colorLuma( c );
    this.background_color = `#${ c.getHexString() }`;

    invertColor( c );
    this.foreground_color = `#${ c.getHexString() }`;

    // set scenes
    if( !this.scene.background ) {
      this.scene.background = new Color();
    }
    this.scene.background.set( this.background_color );

    // Set renderer background to be v
    this.main_renderer.setClearColor( this.background_color );
    this.$el.style.backgroundColor = this.background_color;

    if( backgroundLuma < 0.4 ) {
      this.$el.classList.add( 'dark-viewer' );
    } else {
      this.$el.classList.remove( 'dark-viewer' );
    }

    try {
      this.sideCanvasList.coronal.setBackground( this.background_color );
      this.sideCanvasList.axial.setBackground( this.background_color );
      this.sideCanvasList.sagittal.setBackground( this.background_color );
    } catch (e) {}

    // force re-render
    this.start_animation(0);
  }
  resetCanvas() {
    // Center camera first.
    this.handle_resize( undefined, undefined, false, true );
		this.trackball.reset();
		this.mainCamera.reset();
    this.trackball.enabled = true;
    this.start_animation(0);
  }
  getSideCanvasCrosshairMNI305( m ) {
    // MNI 305 position of the intersection
    return this.calculate_mni305( m.copy( this._crosshairPosition ) );
  }

}



export { ViewerCanvas };



