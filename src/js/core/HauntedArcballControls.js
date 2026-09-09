import { Controls, MathUtils, MOUSE, Vector2, Vector3, Quaternion } from 'three';
import { CONSTANTS } from './constants.js';

const STATE = {
  NONE: - 1,
  ROTATE: 0,
  ZOOM: 1,
  PAN: 2,
  TOUCH_ROTATE: 3,
  TOUCH_ZOOM_PAN: 4
};
const EPS = 0.000001;

/**
 * Wheel `deltaY` is reported in different units depending on the browser:
 * Chrome/Safari report pixels (`deltaMode = 0`, ~100 per notch) while Firefox
 * reports lines (`deltaMode = 1`, ~3 per notch). The pixel factor keeps the
 * historical feel of this viewer; the other two follow the ratios three.js
 * uses in `TrackballControls` (1 line = 40 pixels, 1 page = 2.5 lines).
 */
const WHEEL_SCALE = {
  0 : 0.01,   // DOM_DELTA_PIXEL
  1 : 0.4,    // DOM_DELTA_LINE
  2 : 1.0     // DOM_DELTA_PAGE
};

// events
const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };

// module-level scratch objects, shared by all instances (three.js convention)
const _mouseChange = new Vector2();
const _mouseOnBall = new Vector3();
const _projectedOnBall = new Vector3();
const _objectUp = new Vector3();
const _eyeDirection = new Vector3();
const _rotateAxis = new Vector3();
const _rotateQuaternion = new Quaternion();

/**
 * Translates the modifier keys held during a rotation into a constrained
 * rotation axis. Precedence is explicit so that combinations such as
 * `alt+shift` resolve to a defined value instead of falling through.
 */
function axisFixFromEvent( event ) {
  if ( event.altKey ) { return 3; }
  if ( event.ctrlKey || event.metaKey ) { return 2; }
  if ( event.shiftKey ) { return 1; }
  return 0;
}

class HauntedArcballControls extends Controls {
  constructor( canvas ) {

    super( canvas.mainCamera, null );

    this._canvas = canvas;

  	// API

  	this.screen = { left: 0, top: 0, width: 0, height: 0 };

  	this.radius = 0;

  	this.rotateSpeed = 1.0;
  	this.zoomSpeed = 0.02;

  	this.noRotate = false;
  	this.noZoom = false;
  	this.noPan = false;

  	this.staticMoving = false;
  	this.dynamicDampingFactor = 0.5;

  	this.minZoom = 0.5;
  	this.maxZoom = CONSTANTS.MAIN_CAMERA_MAX_ZOOM;

  	// Zoom towards the cursor instead of the center of the viewport
  	this.cursorZoom = true;

  	this.mouseButtons = {
  	  LEFT   : MOUSE.ROTATE,
  	  MIDDLE : MOUSE.DOLLY,
  	  RIGHT  : MOUSE.PAN
  	};

  	// internals
	  this.target = new Vector3();
    this._changed = false;
    this.state = STATE.NONE;

		this._eye = new Vector3();

		this._rotateStart = new Vector3();
		this._rotateEnd = new Vector3();

		this._zoomStart = new Vector2();
		this._zoomEnd = new Vector2();

		this._touchZoomDistanceStart = 0;
		this._touchZoomDistanceEnd = 0;

		this._panStart = new Vector2();
		this._panEnd = new Vector2();
		this._mouseOnScreen = new Vector2();

		// rotation
		this._isRotating = false;
		// fix axis? altKey -> 3, ctrl -> 2, shift -> 1, 0 for nothing
		this._rotationAxisFixed = 0;

		// zoom
		this._isZooming = false;
		// anchor of the next zoom step, in normalized device coordinates
		this._zoomPointNDC = new Vector2();

		// pan
		this._isPanning = false;

		// pointers
		this._pointers = [];
		this._pointerPositions = {};

		// event listeners
		this._onPointerDown = onPointerDown.bind( this );
		this._onPointerMove = onPointerMove.bind( this );
		this._onPointerUp = onPointerUp.bind( this );
		this._onPointerCancel = onPointerCancel.bind( this );
		this._onMouseWheel = onMouseWheel.bind( this );
		this._onContextMenu = onContextMenu.bind( this );

		// for reset

  	this.target0 = this.target.clone();
  	if( this.object._originalPosition && this.object._originalPosition.isVector3 ) {
  	  this.position0 = this.object._originalPosition;
  	} else {
  	  this.position0 = this.object.position.clone();
  	}
  	this.up0 = this.object.up.clone();

  	this.left0 = this.object.left;
  	this.right0 = this.object.right;
  	this.top0 = this.object.top;
  	this.bottom0 = this.object.bottom;

    // finalize
    this.connect( canvas.main_canvas );

  	this.handleResize();

  	// force an update at start
  	this.update();

  }

  connect( element ) {

    super.connect( element );

    this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
    this.domElement.addEventListener( 'pointercancel', this._onPointerCancel );
    // `passive: false` is required: this listener calls `preventDefault()` so
    // the page does not scroll while the user zooms the viewer.
  	this.domElement.addEventListener( 'wheel', this._onMouseWheel, { passive : false } );
    this.domElement.addEventListener( 'contextmenu', this._onContextMenu );

    // replaces the `preventDefault()` calls the mouse/touch handlers used to make
    this.domElement.style.touchAction = 'none';
    this.domElement.style.userSelect = 'none';

  }

  disconnect() {

    if( !this.domElement ) { return; }

    this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
    this.domElement.removeEventListener( 'pointercancel', this._onPointerCancel );
    this.domElement.removeEventListener( 'wheel', this._onMouseWheel );
    this.domElement.removeEventListener( 'contextmenu', this._onContextMenu );

    this.domElement.ownerDocument.removeEventListener( 'pointermove', this._onPointerMove );
    this.domElement.ownerDocument.removeEventListener( 'pointerup', this._onPointerUp );

    this.domElement.style.touchAction = '';
    this.domElement.style.userSelect = '';

    this._pointers.length = 0;
    this._pointerPositions = {};

  }

  dispose() {
    this.disconnect();
  }

  /**
   * Caches the viewport rectangle in client coordinates. Bails out when the
   * element has no layout (a hidden Shiny tab, `display: none`, ...): keeping
   * the previous values avoids dividing by a zero `radius` and poisoning the
   * camera with `NaN`.
   */
  _updateScreen() {

    const box = this.domElement.getBoundingClientRect();

    if( box.width <= 0 || box.height <= 0 ) { return false; }

    this.screen.left = box.left;
    this.screen.top = box.top;
    this.screen.width = box.width;
    this.screen.height = box.height;

    this.radius = 0.5 * Math.max( this.screen.width, this.screen.height );

    return true;
  }

  handleResize() {

    this._updateScreen();

		this.left0 = this.object.left;
		this.right0 = this.object.right;
		this.top0 = this.object.top;
		this.bottom0 = this.object.bottom;

  }

  getMouseOnScreen( clientX, clientY ) {
    if( this.screen.width <= 0 || this.screen.height <= 0 ) {
      // no valid layout; a constant keeps pan/zoom deltas at zero
      return this._mouseOnScreen.set( 0, 0 );
    }
    this._mouseOnScreen.set(
      ( clientX - this.screen.left ) / this.screen.width,
			( clientY - this.screen.top ) / this.screen.height
    );
    return this._mouseOnScreen;
  }

  getMouseProjectionOnBall( clientX, clientY, fixAxis = 0 ) {

    if( this.radius <= 0 ) {
      // no valid layout; return a constant so the rotation angle stays 0
      return _projectedOnBall.set( 0, 0, 1 );
    }

		_mouseOnBall.set(
			( clientX - this.screen.width * 0.5 - this.screen.left ) / this.radius,
			( this.screen.height * 0.5 + this.screen.top - clientY ) / this.radius,
			0.0
		);
		let length = _mouseOnBall.length();

		if( this._rotationAxisFixed > 0 ) {
		  fixAxis = this._rotationAxisFixed;
		}
		if( fixAxis === 1 ){
		  // Fix x
		  _mouseOnBall.x = 0;
		  length = Math.abs( _mouseOnBall.y );
		}else if ( fixAxis === 2 ){
		  _mouseOnBall.y = 0;
		  length = Math.abs( _mouseOnBall.x );
		}else if ( fixAxis === 3 ){
		  if( length === 0 ) {
		    return _projectedOnBall.set( 0, 0, 1 );
		  }
		  _mouseOnBall.normalize();
		  length = 1;
		}

		if ( length > 1.0 ) {
			_mouseOnBall.normalize();
		} else {
			_mouseOnBall.z = Math.sqrt( 1.0 - length * length );
		}

		_eyeDirection.subVectors( this.object.position, this.target );

		_projectedOnBall.copy( this.object.up ).setLength( _mouseOnBall.y );
		_projectedOnBall.add( _objectUp.copy( this.object.up ).cross( _eyeDirection ).setLength( _mouseOnBall.x ) );
		_projectedOnBall.add( _eyeDirection.setLength( _mouseOnBall.z ) );
		return _projectedOnBall;

  }

  /**
   * Records where the next zoom step should be anchored. `(0, 0)` is the
   * center of the viewport, i.e. the classic "zoom to center" behavior.
   */
  _setZoomPoint( clientX, clientY ) {
    if( this.screen.width <= 0 || this.screen.height <= 0 ) { return; }
    this._zoomPointNDC.set(
      ( clientX - this.screen.left ) / this.screen.width * 2 - 1,
      1 - ( clientY - this.screen.top ) / this.screen.height * 2
    );
  }

  /**
   * Shifts the camera frustum without resizing it. This viewer pans by moving
   * the frustum rather than the camera so that rotation stays centered on
   * `target` (the crosshair). `right - left` and `top - bottom` are invariant
   * here, which is what lets pan and cursor-anchored zoom compose.
   */
  _offsetFrustum( dx, dy ) {

    this.object.left += dx;
		this.object.right += dx;
		this.object.top += dy;
		this.object.bottom += dy;

		this.left0 = this.object.left;
		this.right0 = this.object.right;
		this.top0 = this.object.top;
		this.bottom0 = this.object.bottom;

  }

  /**
   * Applies (and clamps) a new zoom level, compensating the frustum so the
   * anchored point stays put when `cursorZoom` is on.
   *
   * @returns {boolean} whether the requested zoom had to be clamped
   */
  _applyZoom( zoom ) {

    const previousZoom = this.object.zoom;
    const nextZoom = MathUtils.clamp( zoom, this.minZoom, this.maxZoom );
    const clamped = nextZoom !== zoom;

    if( nextZoom === previousZoom ) { return clamped; }

    this.object.zoom = nextZoom;

    if( this.cursorZoom ) {
      /**
       * An orthographic projection maps NDC `u` to the camera-space coordinate
       * `center + u * ( right - left ) / ( 2 * zoom )`. Holding that coordinate
       * fixed while `zoom` goes from `z0` to `z1` means shifting the frustum
       * center by `u * ( right - left ) / 2 * ( 1 / z0 - 1 / z1 )`. Using the
       * clamped zooms keeps this exact at the zoom limits and under damping.
       */
      const k = 1 / previousZoom - 1 / nextZoom;
      this._offsetFrustum(
        this._zoomPointNDC.x * ( this.object.right - this.object.left ) * 0.5 * k,
        this._zoomPointNDC.y * ( this.object.top - this.object.bottom ) * 0.5 * k
      );
    }

    return clamped;
  }

  rotateCamera() {

    // Use angleTo to avoid floating errors
    // Math.acos( this._rotateStart.dot( this._rotateEnd ) / this._rotateStart.length() / this._rotateEnd.length() );
		let angle = this._rotateStart.angleTo( this._rotateEnd );

    /**
     * In some cases (for example, promise), `angle` can be very small number
     * e.g.1e-7, resulting the rendering never stops.
     * Set threshold here.
     */
		if( Math.abs(angle) > EPS ) {
	    // start event - only dispatch when transitioning from not-rotating to rotating
		  if( !this._isRotating ) {
		    this._isRotating = true;
		    this.dispatchEvent( _startEvent );
		  }

			_rotateAxis.crossVectors( this._rotateStart, this._rotateEnd ).normalize();

			angle *= this.rotateSpeed;

			_rotateQuaternion.setFromAxisAngle( _rotateAxis, - angle );

			this._eye.applyQuaternion( _rotateQuaternion );

			this.object.up.applyQuaternion( _rotateQuaternion );

			this._rotateEnd.applyQuaternion( _rotateQuaternion );

			if ( this.staticMoving ) {

				this._rotateStart.copy( this._rotateEnd );

			} else {

				_rotateQuaternion.setFromAxisAngle( _rotateAxis, angle * ( this.dynamicDampingFactor - 1.0 ) );
				this._rotateStart.applyQuaternion( _rotateQuaternion );

			}

			this._changed = true;

		} else if ( this._isRotating ){
		  this._isRotating = false;
		  this.dispatchEvent( _endEvent );
		}
  }

  zoomCamera() {

    if ( this.state === STATE.TOUCH_ZOOM_PAN ) {

			const factor = this._touchZoomDistanceEnd / this._touchZoomDistanceStart;
			this._touchZoomDistanceStart = this._touchZoomDistanceEnd;

      if( Math.abs( factor - 1.0 ) > EPS && factor > 0.0 ){

        // start event - only dispatch when transitioning from not-zooming to zooming
        if( !this._isZooming ) {
			    this._isZooming = true;
			    this.dispatchEvent( _startEvent );
			  }

        this._applyZoom( this.object.zoom * factor );

        this._changed = true;
      }else if( this._isZooming ){
			  // stop event
			  this._isZooming = false;
			  this.dispatchEvent( _endEvent );
			}

		} else {

			const factor = 1.0 + ( this._zoomEnd.y - this._zoomStart.y ) * this.zoomSpeed;

			if ( Math.abs( factor - 1.0 ) > EPS && factor > 0.0 ) {

			  // start event - only dispatch when transitioning from not-zooming to zooming
			  if( !this._isZooming ) {
			    this._isZooming = true;
			    this.dispatchEvent( _startEvent );
			  }

				const clamped = this._applyZoom( this.object.zoom / factor );

				if( clamped || this.staticMoving ) {

				  // drop the pending delta so it cannot pile up against the limit
					this._zoomStart.copy( this._zoomEnd );

				} else {

					this._zoomStart.y += ( this._zoomEnd.y - this._zoomStart.y ) * this.dynamicDampingFactor;

				}

				this._changed = true;

			}else if( this._isZooming ){
			  // stop event
			  this._isZooming = false;
			  this.dispatchEvent( _endEvent );
			}

		}
  }

  enableZoom() {
    this.noZoom = false;
    // discard any delta accumulated while zooming was off
    this._zoomStart.copy( this._zoomEnd );
  }

  disableZoom() {
    this.noZoom = true;
    this._zoomStart.copy( this._zoomEnd );
  }

  panCamera() {

		_mouseChange.copy( this._panEnd ).sub( this._panStart );

		if ( _mouseChange.lengthSq() > 0.00001 ) {
		  // start event - only dispatch when transitioning from not-panning to panning
		  if( !this._isPanning ) {
		    this._isPanning = true;
		    this.dispatchEvent( _startEvent );
		  }

			// Scale movement to keep clicked/dragged position under cursor
			_mouseChange.x *= ( this.object.right - this.object.left ) / this.object.zoom;
			_mouseChange.y *= ( this.object.top - this.object.bottom ) / this.object.zoom;

			/**
			 * The halving is deliberate, not a scaling mistake: `_panStart` chases
			 * `_panEnd` by `dynamicDampingFactor` every frame, so for the default
			 * 0.5 the applied series 0.5 * ( d + d/2 + d/4 + ... ) sums to exactly
			 * `d`, i.e. the grabbed point tracks the cursor 1:1.
			 */
			this._offsetFrustum( - _mouseChange.x / 2, _mouseChange.y / 2 );

			if ( this.staticMoving ) {

				this._panStart.copy( this._panEnd );

			} else {

				this._panStart.add( _mouseChange.subVectors( this._panEnd, this._panStart ).multiplyScalar( this.dynamicDampingFactor ) );

			}

			this._changed = true;

		}else if (this._isPanning){
		  this._isPanning = false;
		  this.dispatchEvent( _endEvent );
		}

  }

  update() {
    this._eye.subVectors( this.object.position, this.target );

		if ( ! this.noRotate ) {

			this.rotateCamera();

		}

		if ( ! this.noZoom ) {

			this.zoomCamera();

		}

		if ( ! this.noPan ) {

			this.panCamera();

		}

		this.object.position.addVectors( this.target, this._eye );

		this.object.lookAt( this.target );

		if ( this._changed ) {

		  this.object.updateProjectionMatrix();

			this.dispatchEvent( _changeEvent );

			this._changed = false;

		}
  }

  lookAt({ x , y , z , remember = false } = {}) {
    if( typeof x === "number" ) { this.target.x = x; }
    if( typeof y === "number" ) { this.target.y = y; }
    if( typeof z === "number" ) { this.target.z = z; }

    if( remember ) {
      this.target0.copy( this.target );
    }
  }

  reset() {
    this.state = STATE.NONE;

		/**
		 * Drop any interaction still in flight. Damping means a wheel tick or a
		 * drag keeps being applied for a few frames after the input ended, so
		 * without this the tail lands *after* the reset and nudges the camera
		 * back off its initial state. Zeroing the deltas (rather than the
		 * `_isRotating`/`_isZooming`/`_isPanning` flags) lets the next `update()`
		 * dispatch the usual `end` events.
		 */
		this._rotateStart.copy( this._rotateEnd );
		this._zoomStart.copy( this._zoomEnd );
		this._panStart.copy( this._panEnd );
		this._touchZoomDistanceStart = this._touchZoomDistanceEnd;

		this.target.copy( this.target0 );
		this.object.position.copy( this.position0 );
		this.object.up.copy( this.up0 );

		this._eye.subVectors( this.object.position, this.target );

		this.object.left = this.left0;
		this.object.right = this.right0;
		this.object.top = this.top0;
		this.object.bottom = this.bottom0;

		this.object.lookAt( this.target );
		this.object.updateProjectionMatrix();

		this.dispatchEvent( _changeEvent );

		this._changed = false;
  }

  // ---- pointer bookkeeping (see three.js TrackballControls) ----------------

  _pointerIndex( pointerId ) {
    for ( let i = 0; i < this._pointers.length; i ++ ) {
      if ( this._pointers[ i ].pointerId === pointerId ) { return i; }
    }
    return - 1;
  }

  _addPointer( event ) {
    this._pointers.push( event );
    this._trackPointer( event );
  }

  _removePointer( event ) {
    delete this._pointerPositions[ event.pointerId ];

    const index = this._pointerIndex( event.pointerId );
    if( index >= 0 ) {
      this._pointers.splice( index, 1 );
    }
  }

  _trackPointer( event ) {
    let position = this._pointerPositions[ event.pointerId ];

    if ( position === undefined ) {
      position = new Vector2();
      this._pointerPositions[ event.pointerId ] = position;
    }

    position.set( event.clientX, event.clientY );
  }

  _getPointerPosition( index ) {
    return this._pointerPositions[ this._pointers[ index ].pointerId ];
  }

  _getSecondPointerPosition( event ) {
    const pointer = ( event.pointerId === this._pointers[ 0 ].pointerId ) ?
      this._pointers[ 1 ] : this._pointers[ 0 ];
    return this._pointerPositions[ pointer.pointerId ];
  }

}

// ---- listeners -------------------------------------------------------------

function onPointerDown( event ) {

  if ( this.enabled === false ) { return; }

  // A mouse fires one `pointerdown` per button, all sharing the same
  // `pointerId`; only the first one starts an interaction.
  if ( this._pointerIndex( event.pointerId ) >= 0 ) { return; }

  if ( this._pointers.length === 0 ) {

    /**
     * `setPointerCapture` throws `NotFoundError` when the pointer is no longer
     * active (a pointer that was already released, a synthesized event, ...).
     * Losing capture only costs us the guarantee that moves outside the
     * element keep arriving, so never let it abort the interaction.
     */
    try {
      this.domElement.setPointerCapture( event.pointerId );
    } catch ( e ) {}

    this.domElement.ownerDocument.addEventListener( 'pointermove', this._onPointerMove );
    this.domElement.ownerDocument.addEventListener( 'pointerup', this._onPointerUp );

  }

  this._addPointer( event );

  this._updateScreen();

  if ( event.pointerType === 'touch' ) {
    onTouchStart.call( this, event );
  } else {
    onMouseDown.call( this, event );
  }

}

function onPointerMove( event ) {

  if ( this.enabled === false ) { return; }
  if ( this._pointerIndex( event.pointerId ) < 0 ) { return; }

  if ( event.pointerType === 'touch' ) {
    onTouchMove.call( this, event );
  } else {
    onMouseMove.call( this, event );
  }

}

function onPointerUp( event ) {

  if ( this._pointerIndex( event.pointerId ) < 0 ) { return; }

  /**
   * The lifted pointer is dropped *before* the state is recomputed so that
   * `this._pointers.length` reflects what is still touching the screen: going
   * from two fingers to one resumes rotation, and the last finger up returns
   * the controls to `NONE`.
   */
  this._removePointer( event );

  if ( event.pointerType === 'touch' ) {
    onTouchEnd.call( this, event );
  } else {
    onMouseUp.call( this );
  }

  if ( this._pointers.length === 0 ) {

    try {
      if ( this.domElement.hasPointerCapture( event.pointerId ) ) {
        this.domElement.releasePointerCapture( event.pointerId );
      }
    } catch ( e ) {}

    this.domElement.ownerDocument.removeEventListener( 'pointermove', this._onPointerMove );
    this.domElement.ownerDocument.removeEventListener( 'pointerup', this._onPointerUp );

  }

}

function onPointerCancel( event ) {

  this._removePointer( event );

  if ( this._pointers.length === 0 ) {

    this.state = STATE.NONE;

    this.domElement.ownerDocument.removeEventListener( 'pointermove', this._onPointerMove );
    this.domElement.ownerDocument.removeEventListener( 'pointerup', this._onPointerUp );

    this.dispatchEvent( _endEvent );

  }

}

function onMouseDown( event ) {

  let mouseAction;

  switch ( event.button ) {
    case 0:
      mouseAction = this.mouseButtons.LEFT;
      break;
    case 1:
      mouseAction = this.mouseButtons.MIDDLE;
      break;
    case 2:
      mouseAction = this.mouseButtons.RIGHT;
      break;
    default:
      mouseAction = - 1;
  }

  switch ( mouseAction ) {
    case MOUSE.ROTATE:
      this.state = STATE.ROTATE;
      break;
    case MOUSE.DOLLY:
      this.state = STATE.ZOOM;
      break;
    case MOUSE.PAN:
      this.state = STATE.PAN;
      break;
    default:
      this.state = STATE.NONE;
  }

	if ( this.state === STATE.ROTATE && ! this.noRotate ) {

		this._rotateStart.copy( this.getMouseProjectionOnBall( event.clientX, event.clientY, axisFixFromEvent( event ) ) );
		this._rotateEnd.copy( this._rotateStart );

	} else if ( this.state === STATE.ZOOM && ! this.noZoom ) {

	  this._zoomStart.copy( this.getMouseOnScreen( event.clientX, event.clientY ) );
		this._zoomEnd.copy( this._zoomStart );
		this._setZoomPoint( event.clientX, event.clientY );

	} else if ( this.state === STATE.PAN && ! this.noPan ) {

		this._panStart.copy( this.getMouseOnScreen( event.clientX, event.clientY ) );
		this._panEnd.copy( this._panStart );

	}

  this.dispatchEvent( _startEvent );

}

function onMouseMove( event ) {

	if ( this.state === STATE.ROTATE && ! this.noRotate ) {

		this._rotateEnd.copy( this.getMouseProjectionOnBall( event.clientX, event.clientY, axisFixFromEvent( event ) ) );

	} else if ( this.state === STATE.ZOOM && ! this.noZoom ) {

		this._zoomEnd.copy( this.getMouseOnScreen( event.clientX, event.clientY ) );

	} else if ( this.state === STATE.PAN && ! this.noPan ) {

		this._panEnd.copy( this.getMouseOnScreen( event.clientX, event.clientY ) );

	}

}

function onMouseUp() {

	this.state = STATE.NONE;

	this.dispatchEvent( _endEvent );

}

function onMouseWheel( event ) {

	if ( this.enabled === false ) { return; }
	if ( this.noZoom === true ) { return; }

	event.preventDefault();
	event.stopPropagation();

	// the cached rect goes stale when the surrounding page scrolls
	this._updateScreen();
	this._setZoomPoint( event.clientX, event.clientY );

	this._zoomStart.y += event.deltaY * ( WHEEL_SCALE[ event.deltaMode ] ?? WHEEL_SCALE[ 0 ] );

	this.dispatchEvent( _startEvent );
	this.dispatchEvent( _endEvent );

}

function onTouchStart() {

	switch ( this._pointers.length ) {

		case 1: {
			this.state = STATE.TOUCH_ROTATE;
			const p = this._getPointerPosition( 0 );
			this._rotateStart.copy( this.getMouseProjectionOnBall( p.x, p.y ) );
			this._rotateEnd.copy( this._rotateStart );
			break;
		}

		default: {
			this.state = STATE.TOUCH_ZOOM_PAN;
			const p0 = this._getPointerPosition( 0 );
			const p1 = this._getPointerPosition( 1 );
			this._touchZoomDistanceEnd = this._touchZoomDistanceStart = p0.distanceTo( p1 );

			const x = ( p0.x + p1.x ) / 2;
			const y = ( p0.y + p1.y ) / 2;
			this._panStart.copy( this.getMouseOnScreen( x, y ) );
			this._panEnd.copy( this._panStart );
			this._setZoomPoint( x, y );
			break;
		}

	}

	this.dispatchEvent( _startEvent );

}

function onTouchMove( event ) {

	this._trackPointer( event );

	switch ( this._pointers.length ) {

		case 1:
			this._rotateEnd.copy( this.getMouseProjectionOnBall( event.clientX, event.clientY ) );
			break;

		default: {
			const position = this._getSecondPointerPosition( event );

			const dx = event.clientX - position.x;
			const dy = event.clientY - position.y;
			this._touchZoomDistanceEnd = Math.sqrt( dx * dx + dy * dy );

			const x = ( event.clientX + position.x ) / 2;
			const y = ( event.clientY + position.y ) / 2;
			this._panEnd.copy( this.getMouseOnScreen( x, y ) );
			this._setZoomPoint( x, y );
			break;
		}

	}

}

function onTouchEnd() {

	switch ( this._pointers.length ) {

		case 0:
			this.state = STATE.NONE;
			break;

		case 1: {
			// a pinch degraded into a single-finger rotation; re-seed it
			this.state = STATE.TOUCH_ROTATE;
			const p = this._getPointerPosition( 0 );
			this._rotateEnd.copy( this.getMouseProjectionOnBall( p.x, p.y ) );
			this._rotateStart.copy( this._rotateEnd );
			break;
		}

		default: {
			this.state = STATE.TOUCH_ZOOM_PAN;
			const p0 = this._getPointerPosition( 0 );
			const p1 = this._getPointerPosition( 1 );
			this._touchZoomDistanceEnd = this._touchZoomDistanceStart = p0.distanceTo( p1 );

			const x = ( p0.x + p1.x ) / 2;
			const y = ( p0.y + p1.y ) / 2;
			this._panEnd.copy( this.getMouseOnScreen( x, y ) );
			this._panStart.copy( this._panEnd );
			this._setZoomPoint( x, y );
			break;
		}

	}

	this.dispatchEvent( _endEvent );

}

function onContextMenu( event ) {

	event.preventDefault();

}

export { HauntedArcballControls };
