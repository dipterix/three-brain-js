import { CONSTANTS } from './constants.js';
import { Vector3, Matrix4, OrthographicCamera, DirectionalLight, WebGLRenderer, Quaternion } from 'three';
import { get_element_size } from '../utils.js';
import { makeDraggable } from '../utility/draggable.js';
import { makeResizable } from '../utility/resizable.js';

const tmpVec3 = new Vector3();
const tmpVec3Alt = new Vector3();
const tmpQuaternion = new Quaternion();
const tmpMat4 = new Matrix4();


const SIDECANVAS_ZINDEX_BASE = CONSTANTS.ZINDEX_BASE + 1;

class SideCanvas {

  get zIndex () {
    const re = parseInt( this.$el.style.zIndex );
    if( isNaN(re) ) { return( 0 ); }
    return re - SIDECANVAS_ZINDEX_BASE;
  }
  set zIndex (v) {
    this.$el.style.zIndex = v + SIDECANVAS_ZINDEX_BASE;
  }

  set enabled( v ) {
    if( v ) {
      this._enabled = true;
	    this.$el.style.display = 'block';
    } else {
      this._enabled = false;
	    this.$el.style.display = 'none';
    }
  }

  get enabled () {
    return this._enabled;
  }

  _updateRenderThreshold( distance, save = true ) {
    if( typeof distance !== "number" ) {
      distance = this._renderThreshold;
    } else {
      if( distance < 0 ) { distance = -distance; }
      if ( save ) {
        this._renderThreshold = distance;
      }
    }
    this.camera.near = 500 - distance;
    this.camera.updateProjectionMatrix();
    this.mainCanvas.needsUpdate = true;
  }
  get renderThreshold() {
    return this._renderThreshold;
  }

  set renderThreshold( distance ) {
    this._updateRenderThreshold( distance );
  }

  zoom( level ) {

    // { enabled: true, fullWidth: 256, fullHeight: 256, offsetX: 0, offsetY: 0, width: 256, height: 256 }
    const view = this.camera.view;
    // calculate origin in model
    this.mainCanvas.crosshairGroup.worldToLocal( tmpVec3.set(0, 0, 0) );

    const boundingCenterX = tmpVec3Alt.copy( this.camera.position ).cross( this.camera.up ).normalize().dot( tmpVec3 );
    const boundingCenterY = tmpVec3.dot( this.camera.up );

    let viewCenterX = 128;
    let viewCenterY = 128;

    // If we want to center the side-camera at origin
    // viewCenterY -= boundingCenterY;
    // viewCenterX -= boundingCenterX;

    if( level ) {
      this.zoomLevel = level;
    }
    if( this.zoomLevel > 10 ) { this.zoomLevel = 10; }
    if( this.zoomLevel < 1.05 ) { this.zoomLevel = 1; }

    view.width = view.fullWidth / this.zoomLevel;
    view.height = view.fullHeight / this.zoomLevel;

    view.offsetX = viewCenterX - view.width / 2.0;
    view.offsetY = viewCenterY - view.height / 2.0;

    if( view.offsetX < viewCenterX - boundingCenterX - 128 ) {
      view.offsetX = viewCenterX - boundingCenterX - 128;
    } else if ( view.offsetX + view.width > viewCenterX - boundingCenterX + 128 ) {
      view.offsetX = viewCenterX - boundingCenterX + 128 - view.width;
    }

    if( view.offsetY < viewCenterY - boundingCenterY - 128 ) {
      view.offsetY = viewCenterY - boundingCenterY - 128;
    } else if ( view.offsetY + view.height > viewCenterY - boundingCenterY + 128 ) {
      view.offsetY = viewCenterY - boundingCenterY + 128 - view.height;
    }

    this.camera.setViewOffset(
      view.fullWidth,
      view.fullHeight,
      view.offsetX,
      view.offsetY,
      view.width,
      view.height
    );
    // this.camera.updateProjectionMatrix();
    this.mainCanvas.needsUpdate = true;
  }

  raiseTop() {
    if( !this.mainCanvas.sideCanvasEnabled ) { return }

    const sideCanvasCollection = this.mainCanvas.sideCanvasList;

    let zIndex = [
      [parseInt(sideCanvasCollection.coronal.zIndex), 'coronal'],
      [parseInt(sideCanvasCollection.axial.zIndex), 'axial'],
      [parseInt(sideCanvasCollection.sagittal.zIndex), 'sagittal']
    ];
    zIndex.sort((v1,v2) => {return(v1[0] - v2[0])});
    zIndex.forEach((v, ii) => {
      const type = v[ 1 ];
      sideCanvasCollection[ type ].zIndex = ii;
    });
    this.zIndex = 4;
  }

  reset({
    zoomLevel = false, position = true, size = true, crosshair = false
  } = {}) {
    let width, height, offsetX, offsetY;
    if( position === true ) {
      offsetX = 0;
      offsetY = this.order * width;
    } else if (Array.isArray(position) && position.length == 2) {
      offsetX = position[0];
      offsetY = position[1];
    }
    if( size === true ) {
      const defaultWidth = Math.ceil( this.mainCanvas.side_width );
      width = defaultWidth;
      height = defaultWidth;
    }
    this.setDimension({
      width   : width,
      height  : height,
      offsetX : offsetX,
      offsetY : offsetY
    });

    if( crosshair ) {
      this.mainCanvas.setSliceCrosshair({ x : 0, y : 0, z : 0, immediate : false });
    }

    if( zoomLevel === true ) {
      this.zoom( 1 );
    } else if( typeof zoomLevel === "number" ) {
      if( zoomLevel > 10 ) { zoomLevel = 10; }
      if( zoomLevel < 1 ) { zoomLevel = 1; }
      this.zoom( zoomLevel );
    }
  }
  setDimension({ width, height, offsetX, offsetY } = {}) {
    // ignore height
    let w = width ?? height;
    if( w === undefined && offsetX === undefined && offsetY === undefined) {
      return;
    }
    if( w === undefined ) {
      w = Math.ceil( this.mainCanvas.side_width );
    }
    if( w <= 10 ) {
      w = 10;
    }
    this.$el.style.width = `${w}px`;
    this.$el.style.height = `${w}px`;
    this.$canvas.style.width = '100%';
		this.$canvas.style.height = '100%';

    let _offsetX = Math.round( offsetX || 0 );
    let _offsetY = Math.round( offsetY || (this.order * w) );
    if( _offsetX === 0 ) { _offsetX = '0'; } else { _offsetX = `${_offsetX}px`; }
    if( _offsetY === 0 ) { _offsetY = '0'; } else { _offsetY = `${_offsetY}px`; }

    this.$el.style.left = _offsetX;
    this.$el.style.top = _offsetY;

  }

  setFooter( footer ) {
    if(!footer) {
      footer = "";
    }
    this.$footer.innerHTML = footer;
  }


  get headerText () {
    if( this.mainCanvas.get_state("sideCameraTrackMainCamera", "canonical") !== "canonical" ) {
      switch ( this.type ) {
        case 'coronal':
          return "Normal (Horizontal)";
          break;
        case 'axial':
          return "Line of Sight";
          break;
        case 'sagittal':
          return "Normal (Vertical)";
          break;
        default:
      }
    } else {
      switch ( this.type ) {
        case 'coronal':
          return "CORONAL (R=R)";
          break;
        case 'axial':
          return "AXIAL (R=R)";
          break;
        case 'sagittal':
          return "SAGITTAL";
          break;
        default:
      }
    }
  }

  setHeader( header ) {
    if( typeof header === "string" && this._headerText !== header ) {
      this._headerText = header;
      this.$header.innerHTML = this._headerText;
    }
  }

  _calculateCrosshair( event ) {
    const mouseX = event.clientX;
    const mouseY = event.clientY;
    const canvasPosition = this.$canvas.getBoundingClientRect(); // left, top
    const canvasSize = get_element_size( this.$canvas );

    const right = event.clientX - canvasPosition.left - canvasSize[0]/2 - 1;
    const up = canvasSize[1]/2 + canvasPosition.top - event.clientY + 2;

    this.raiseTop();
    this.pan({
      right : right, up : up, unit : "css",
      updateMainCamera : !event.shiftKey
    });
  }


  render() {
    if( !this._enabled ) { return; }
    this.renderer.clear();

    this.setHeader( this.headerText );

    // Let side slices track camera rotation
    this.renderer.render( this.mainCanvas.scene, this.camera );
  }

  dispose() {
    this.$header.removeEventListener( "dblclick" , this._onDoubleClick );
    this.$zoomIn.removeEventListener( "click" , this._onZoomInClicked );
    this.$zoomIn.removeEventListener( "click" , this._onZoomOutClicked );
    this.$recenter.removeEventListener( "click" , this._onRecenterClicked );
    this.$reset.removeEventListener( "click" , this._onResetClicked );

    this.$canvas.removeEventListener( "mousedown" , this._onMouseDown );
    this.$canvas.removeEventListener( "contextmenu" , this._onContextMenu );
    this.$canvas.removeEventListener( "mouseup" , this._onMouseUp );
    this.$canvas.removeEventListener( "mousemove" , this._onMouseMove );
    this.$canvas.removeEventListener( "wheel" , this._onMouseWheel );

    this.mainCanvas.$el.removeEventListener(
      "viewerApp.canvas.setVoxelRenderDistance",
      this._onSetVoxelRenderDistance );
    this.mainCanvas.$el.removeEventListener(
      "viewerApp.canvas.setSliceCrosshair",
      this._onSetSliceCrosshair );

    this.renderer.dispose();
  }

  setBackground( color ) {
    color = "#000000";
    this._backgroundColor = color;
    this.renderer.setClearColor( color );
    this.$el.style.backgroundColor = color;
  }


  pan({ right = 0, up = 0, unit = "css", updateMainCamera = true } = {}) {
    //  this.raiseTop();

    // { enabled: true, fullWidth: 256, fullHeight: 256, offsetX: 0, offsetY: 0, width: 256, height: 256 }
    const view = this.camera.view;

    // data is xy coord relative to $canvas
    let depthX, depthY;
    if( unit === "css" ) {
      const canvasSize = get_element_size( this.$canvas );
      depthX = right / canvasSize[0] * view.width;
      depthY = up / canvasSize[1] * view.height;
    } else {
      depthX = right;
      depthY = up;
    }

    let sagittalDepth, coronalDepth, axialDepth;
    let centerCanvas = false;

    // Use the underlying position, because this might happen very fast (before rendering)
    tmpVec3.copy( this.mainCanvas._crosshairPosition )
      .applyQuaternion( tmpQuaternion.copy( this.mainCanvas.crosshairGroup.quaternion ).invert() );

    const halfMarginWidth = (view.fullWidth - view.width) / 2.0;
    const halfMarginHeight = (view.fullHeight - view.height) / 2.0;
    const centerOffsetHoriz = view.offsetX - halfMarginWidth;
    const centerOffsetVerti = view.offsetY - halfMarginHeight;

    switch ( this.type ) {
      case 'coronal':
        tmpVec3.x += centerOffsetHoriz + depthX;
        tmpVec3.z += -centerOffsetVerti + depthY;

        this.camera.setViewOffset(
          view.fullWidth,
          view.fullHeight,
          halfMarginWidth - depthX,
          halfMarginHeight + depthY,
          view.width,
          view.height
        );
        centerCanvas = ["sagittal", "axial"];
        break;
      case 'axial':
        tmpVec3.x += centerOffsetHoriz + depthX;
        tmpVec3.y += -centerOffsetVerti + depthY;

        this.camera.setViewOffset(
          view.fullWidth,
          view.fullHeight,
          halfMarginWidth - depthX,
          halfMarginHeight + depthY,
          view.width,
          view.height
        );

        centerCanvas = ["sagittal", "coronal"];
        break;
      case 'sagittal':
        tmpVec3.y += -centerOffsetHoriz - depthX;
        tmpVec3.z += -centerOffsetVerti + depthY;

        this.camera.setViewOffset(
          view.fullWidth,
          view.fullHeight,
          halfMarginWidth - depthX,
          halfMarginHeight + depthY,
          view.width,
          view.height
        );
        centerCanvas = ["coronal", "axial"];
        break;
      default:
        throw 'SideCanvas: type must be coronal, sagittal, or axial';
    }

    // console.log(`x: ${depthX}, y: ${depthY} of [${canvasSize[0]}, ${canvasSize[1]}]`);
    // console.log(`x: ${sagittalDepth}, y: ${coronalDepth}, z: ${axialDepth}`);

    tmpVec3.applyQuaternion( this.mainCanvas.crosshairGroup.quaternion );

    // update slice depths
    if( updateMainCamera ) {
      this.mainCanvas.setSliceCrosshair({
        x : tmpVec3.x,
        y : tmpVec3.y,
        z : tmpVec3.z,
        immediate : false,
        centerCrosshair : centerCanvas
      });
    }
    this.mainCanvas.needsUpdate = true;
  }

  constructor ( mainCanvas, type = "coronal" ) {

    this.type = type;
    switch ( this.type ) {
      case 'coronal':
        this.order = 2;
        break;
      case 'axial':
        this.order = 0;
        break;
      case 'sagittal':
        this.order = 1;
        break;
      default:
        throw 'SideCanvas: type must be coronal, sagittal, or axial';
    }

    this.mainCanvas = mainCanvas;
    this.zoomLevel = 1;
    this.pixelRatio = this.mainCanvas.pixel_ratio[1];
    this._renderThreshold = 2.0;

    this._enabled = true;
    this._lookAt = new Vector3( 0, 0, 0 );
    this._container_id = mainCanvas.container_id;
    const _w = this.mainCanvas.client_width ?? 256;
    const _h = this.mainCanvas.client_height ?? 256;
    this._renderHeight = 256;
    this._canvasHeight = this._renderHeight * this.mainCanvas.pixel_ratio[1];

    this.$el = document.createElement('div');
    this.$el.id = this._container_id + '__' + type;
    this.$el.style.display = 'none';
    this.$el.className = 'THREEBRAIN-SIDE resizable';
    this.$el.style.zIndex = this.order;
    this.$el.style.top = ( this.order * this.mainCanvas.side_width ) + 'px';

    // Make header
    this.$header = document.createElement('div');
    this.$header.innerHTML = "";
    this.$header.className = 'THREEBRAIN-SIDE-HEADER';
    this.$header.id = this._container_id + '__' + type + 'header';
    this.setHeader();
    this.$el.appendChild( this.$header );

    // Add side canvas element
    this.$canvas = document.createElement('canvas');
    this.$canvas.width = this._canvasHeight;
    this.$canvas.height = this._canvasHeight;
    this.$canvas.style.width = '100%';
		this.$canvas.style.height = '100%';
		this.$canvas.style.position = 'absolute';
		this.$el.appendChild( this.$canvas );
		this.context = this.$canvas.getContext('webgl2');

		// Add footer
		this.$footer = document.createElement('div');
    this.$footer.innerText = "";
    this.$footer.className = 'THREEBRAIN-SIDE-FOOTER';
    this.$footer.id = this._container_id + '__' + type + 'footer';
    this.$el.appendChild( this.$footer );

		this.renderer = new WebGLRenderer({
    	  antialias: false, alpha: true,
    	  canvas: this.$canvas, context: this.context,
    	  depths: false
    	});
  	this.renderer.setPixelRatio( this.mainCanvas.pixel_ratio[1] );
  	this.renderer.autoClear = false; // Manual update so that it can render two scenes
  	this.renderer.setSize( this._renderHeight, this._renderHeight );

		// Add widgets
		// zoom in tool
		this.$zoomIn = document.createElement('div');
		this.$zoomIn.className = 'zoom-tool';
		this.$zoomIn.style.top = '23px'; // for header
		this.$zoomIn.innerText = '+';
		this.$el.appendChild( this.$zoomIn );

		// zoom out tool
    this.$zoomOut = document.createElement('div');
		this.$zoomOut.className = 'zoom-tool';
		this.$zoomOut.style.top = '50px'; // header + $zoomIn
		this.$zoomOut.innerText = '-';
		this.$el.appendChild( this.$zoomOut );

		// toggle pan (translate) tool
		this.$recenter = document.createElement('div');
		this.$recenter.className = 'zoom-tool';
		this.$recenter.style.top = '77px'; // header + $zoomIn + $zoomOut
		this.$recenter.innerText = 'C';
		this.$el.appendChild( this.$recenter );


		this.$reset = document.createElement('div');
		this.$reset.className = 'zoom-tool';
		this.$reset.style.top = '104px'; // header + $zoomIn + $zoomOut + $recenter
		this.$reset.innerText = '0';
		this.$el.appendChild( this.$reset );

		// Add resize anchors to bottom-right
		this.$resizeWrapper = document.createElement('div');
		this.$resizeWrapper.className = 'resizers';
		const $resizeAnchor = document.createElement('div');
		$resizeAnchor.className = 'resizer bottom-right';
		this.$resizeWrapper.appendChild( $resizeAnchor );
		this.$el.appendChild( this.$resizeWrapper );

		// make sure z-index is set so overlay canvas is underneath
		this.zIndex = 0;

		// Make header draggable within viewer
    makeDraggable( this.$el, this.$header, undefined, () => {
      this.raiseTop();
    });


    // Make $el resizable, keep current width and height
    makeResizable( this.$el, true );


    // remembers rotation
    this.quaternion = new Quaternion();

    // --------------- Register 3js objects -------------
    // Add OrthographicCamera

    // need to see ranges from +- 128 * sqrt(3) ~= +-222
    // The distance to origin is 500, hence the render range is:
    //  near = 500 - 222 = 278
    //  far  = 500 + 222 = 722
    this.camera = new OrthographicCamera( -128, 128, 128, -128, 1, 1000 );
    this.camera.setViewOffset( 256, 256, 0, 0, 256, 256 );
		this.camera.layers.enable( CONSTANTS.LAYER_USER_ALL_CAMERA_1 );
		this.camera.layers.enable( CONSTANTS.LAYER_USER_ALL_SIDE_CAMERAS_4 );
		this.camera.layers.enable( 5 );
		this.camera.layers.enable( 6 );
		this.camera.layers.enable( 7 );
		this.camera.layers.enable( CONSTANTS.LAYER_SYS_ALL_SIDE_CAMERAS_13 );

		// Side light is needed so that side views are visible.
		this.directionalLight = new DirectionalLight( CONSTANTS.COLOR_MAIN_LIGHT , 1.5 );

		switch ( this.type ) {
      case 'coronal':
        this.camera.position.fromArray( [0, -500, 0] );
        this.camera.up.set( 0, 0, 1 );
        this.camera.layers.enable( CONSTANTS.LAYER_SYS_CORONAL_9 );
        this.directionalLight.position.fromArray([0, -500, 0]); // set direction from P to A
        this.directionalLight.layers.set( CONSTANTS.LAYER_SYS_CORONAL_9 );
        break;
      case 'axial':
        this.camera.position.fromArray( [0, 0, 500] );
        this.camera.up.set( 0, 1, 0 );
        this.camera.layers.enable( CONSTANTS.LAYER_SYS_AXIAL_10 );
        this.directionalLight.position.fromArray([0, 0, 500]); // set direction from I to S
        this.directionalLight.layers.set( CONSTANTS.LAYER_SYS_AXIAL_10 );
        break;
      case 'sagittal':
        this.camera.position.fromArray( [-500, 0, 0] );
        this.camera.up.set( 0, 0, 1 );
        this.camera.layers.enable( CONSTANTS.LAYER_SYS_SAGITTAL_11 );
        this.directionalLight.position.fromArray([-500, 0, 0]); // set direction from L to R
        this.directionalLight.layers.set( CONSTANTS.LAYER_SYS_SAGITTAL_11 );
        break;
      default:
        throw 'SideCanvas: type must be coronal, sagittal, or axial';
    }

    this._lookAt.copy( this.mainCanvas.crosshairGroup.position );
    this.camera.lookAt( this._lookAt );
    this.camera.aspect = 1;
    // Backup position
    this.origCameraPosition = this.camera.position.clone();
    this.origCameraUp = this.camera.up.clone();
    this.origCameraQuaternion = this.camera.quaternion.clone();
    // this.camera.add( this.directionalLight );

    // this.mainCanvas.add_to_scene( this.camera, true );
    // this.mainCanvas.add_to_scene( this.directionalLight, true );
    this.mainCanvas.crosshairGroup.add( this.camera );
    this.mainCanvas.crosshairGroup.add( this.directionalLight );
    this.camera.updateProjectionMatrix();
    this.mainCanvas.wrapper_canvas.appendChild( this.$el );


    // ---- Bind events --------------------------------------------------------
    // double-click on header to reset position
    this.$header.addEventListener( "dblclick" , this._onDoubleClick );
    this.$zoomIn.addEventListener( "click" , this._onZoomInClicked );
    this.$zoomOut.addEventListener( "click" , this._onZoomOutClicked );
    this.$recenter.addEventListener( "click" , this._onRecenterClicked );
    this.$reset.addEventListener( "click" , this._onResetClicked );

    this.$canvas.addEventListener( "mousedown" , this._onMouseDown );
    this.$canvas.addEventListener( "contextmenu" , this._onContextMenu );
    this.$canvas.addEventListener( "mouseup" , this._onMouseUp );
    this.$canvas.addEventListener( "mousemove" , this._onMouseMove );
    this.$canvas.addEventListener( "wheel" , this._onMouseWheel );

    this.mainCanvas.$el.addEventListener(
      "viewerApp.canvas.setVoxelRenderDistance",
      this._onSetVoxelRenderDistance );
    this.mainCanvas.$el.addEventListener(
      "viewerApp.canvas.setSliceCrosshair",
      this._onSetSliceCrosshair );
  }

  _onResetClicked = () => {
	  this.$canvas.style.top = '0';
    this.$canvas.style.left = '0';
	  this.zoom( 1 );
	}

  _onMouseDown = ( evt ) => {
    evt.preventDefault();
    this._focused = true;
    this._calculateCrosshair( evt );
  }

  _onContextMenu = ( evt ) => {
    evt.preventDefault();
  }

  _onMouseUp = ( evt ) => {
    evt.preventDefault();
    this._focused = false;
  }

  _onMouseMove = ( evt ) => {
    if( !this._focused ) { return; }
    evt.preventDefault();
    this._calculateCrosshair( evt );
  }

  _onMouseWheel = ( evt ) => {
    evt.preventDefault();

    if( !evt.deltaY ) { return; }
    const delta = evt.deltaY * 0.005;

    tmpVec3.copy( this.mainCanvas._crosshairPosition )
      .applyQuaternion( tmpQuaternion.copy( this.mainCanvas.crosshairGroup.quaternion ).invert() );

    let centerCrosshair;

    switch (this.type) {
      case 'sagittal':
        tmpVec3.x += delta;
        centerCrosshair = ["coronal", "axial"]
        break;
      case 'coronal':
        tmpVec3.y += delta;
        centerCrosshair = ["sagittal", "axial"]
        break;
      case 'axial':
        tmpVec3.z += delta;
        centerCrosshair = ["coronal", "sagittal"]
        break;
      default:
        // code
    }
    tmpVec3.applyQuaternion( this.mainCanvas.crosshairGroup.quaternion );
    this.mainCanvas.setSliceCrosshair({
      x : tmpVec3.x,
      y : tmpVec3.y,
      z : tmpVec3.z,
      centerCrosshair : centerCrosshair
    });

  }

  _onRecenterClicked = () => {
    this.zoom();
  }

  _onZoomOutClicked = () => {
    let newZoomLevel = this.zoomLevel / 1.2;
	  this.zoom( newZoomLevel );
  }

  _onZoomInClicked = () => {
    let newZoomLevel = this.zoomLevel * 1.2;
	  this.zoom( newZoomLevel );
  }
  _onDoubleClick = () => {
    this.reset({ zoomLevel : false, position : true, size : true })
  }

  _onSetVoxelRenderDistance = ( event ) => {
    if( typeof event.detail.distance === "number" ) {
      this._updateRenderThreshold( event.detail.distance );
    }
  }
  _onSetSliceCrosshair = ( event ) => {
    if( !event.detail || typeof event.detail !== "object" ) { return; }

    this.setFooter( event.detail.text ?? "" );

    if(
      event.detail.center === true ||
      (
        Array.isArray( event.detail.center ) &&
        event.detail.center.includes( this.type )
      )
    ) {
      this.zoom();
    }

    /*data : {
        x : x, y : y, z : z,
        text : crosshairText,
        center: centerCrosshair
      },*/
  }

}

export{ SideCanvas };
