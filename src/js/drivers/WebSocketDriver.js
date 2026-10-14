import { asArray } from '../utility/asArray.js';
import { ViewerDriver, DriverError, INPUTS } from './ViewerDriver.js';

/**
 * The WebSocket transport: the viewer joins a hub on this computer
 * (`threebrain-hub serve`, 127.0.0.1) and other programs drive it through the
 * hub. The user always makes the first connection (Remote Control > Connect);
 * after that, "Auto-connect" (remembered per site) reconnects after drops and
 * on the next page load.
 *
 * Protocol 1, JSON text frames:
 *   viewer -> hub   { type: "hello", protocol: 1, role: "viewer", key?, viewer: {...} }
 *   hub -> viewer   { type: "welcome", id } | { type: "command", id, name, value }
 *   viewer -> hub   { type: "result", id, ok, value | error: { code, message } }
 *                   { type: "event", name, value }   (names of the Shiny inputs)
 */

const DEFAULT_PASSKEY = "17285";
const PROTOCOL = 1;
const STORAGE_KEY = "threeBrain.remoteControl";
// waits between reconnection attempts (ms); the last one repeats
const RETRY_DELAYS = [ 1000, 2000, 5000, 10000, 30000 ];
const PASSKEY = /^(\d{1,5})(?:\.([A-Za-z0-9_-]+))?$/;

const VERSION = {
  version   : typeof __THREEBRAIN_VERSION__ !== "undefined" ? __THREEBRAIN_VERSION__ : null,
  buildTime : typeof __THREEBRAIN_BUILD_TIME__ !== "undefined" ? __THREEBRAIN_BUILD_TIME__ : null,
};

function parsePasskey( text ) {
  const match = String( text ?? "" ).trim().match( PASSKEY );
  const port = match ? Number( match[1] ) : NaN;
  if( !match || port < 1 || port > 65535 ) {
    throw new DriverError( "bad_value",
      `"${ text }" is not a passkey: expected a port such as ${ DEFAULT_PASSKEY }, or port.key` );
  }
  return { port, key: match[2] ?? null };
}

// What this site remembers once a connection succeeded: { passkey, autoConnect }
function loadRemembered() {
  try {
    const value = JSON.parse( window.localStorage.getItem( STORAGE_KEY ) );
    return value && typeof value === "object" ? value : null;
  } catch (e) {
    return null;
  }
}

function saveRemembered( value ) {
  try {
    window.localStorage.setItem( STORAGE_KEY, JSON.stringify( value ) );
  } catch (e) {}
}

// A white background is drawn transparent (the page's CSS shows the white), so
// a raw canvas picture has see-through pixels where the user sees white. This
// paints the picture over `color`, from the PNG rather than the GPU canvas,
// which can be blank outside the frame that drew it.
function overBackground( dataURI, color ) {
  return new Promise(( resolve ) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement( "canvas" );
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext( "2d" );
      context.fillStyle = color;
      context.fillRect( 0, 0, canvas.width, canvas.height );
      context.drawImage( image, 0, 0 );
      resolve( canvas.toDataURL( "image/png" ) );
    };
    image.onerror = () => resolve( dataURI );
    image.src = dataURI;
  });
}

// JSON that survives cycles and three.js objects in event payloads
function toJSON( message ) {
  try {
    return JSON.stringify( message );
  } catch (e) {}
  const seen = new WeakSet();
  return JSON.stringify( message, ( key, value ) => {
    if( typeof value === "function" || typeof value === "bigint" ) { return undefined; }
    if( value && typeof value === "object" ) {
      if( value.isObject3D || value.isMaterial || value.isBufferGeometry || value.isTexture ) {
        return undefined;
      }
      if( seen.has( value ) ) { return undefined; }
      seen.add( value );
    }
    return value;
  });
}

class WebSocketDriver extends ViewerDriver {

  /** The viewer's driver, created on first use. */
  static attach( viewerApp ) {
    if( !viewerApp.remoteDriver ) {
      viewerApp.remoteDriver = new WebSocketDriver( viewerApp );
    }
    return viewerApp.remoteDriver;
  }

  constructor( viewerApp ) {
    super( viewerApp );
    this.isWebSocketDriver = true;

    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.viewerId = null;
    this.passkey = null;
    this.status = "Not connected";
    // the Remote Control panel listens here; it is rebuilt with each data update
    this.onStatusChange = null;

    const remembered = loadRemembered();
    this.everConnected = remembered !== null;
    this._autoConnect = remembered?.autoConnect ?? true;

    this._wanted = false;        // keep a connection: Connect was clicked, or Auto-connect
    this._automatic = false;     // the current connection attempt was not clicked
    this._welcomed = false;      // the hub accepted us since the last connect()
    this._retry = 0;
    this._retryTimer = null;
    this._retryWhenVisible = false;
    this._updating = false;
    this._queue = [];
    this._chain = Promise.resolve();

    this.$wrapper.addEventListener( "viewerApp.updateData.start", this._onUpdateStart );
    this.$wrapper.addEventListener( "viewerApp.updateData.end", this._onUpdateEnd );
    document.addEventListener( "visibilitychange", this._onVisibilityChange );
    this.listen();
    // created after the first load: the control panel exists already
    if( this.app.controlCenter && this.app.controllerGUI ) {
      this.rebindControlCenter();
    }
    this.enabled = true;
  }

  get autoConnect() {
    return this._autoConnect;
  }

  get retrying() {
    return this._retryTimer !== null || this._retryWhenVisible;
  }

  setAutoConnect( value ) {
    this._autoConnect = !!value;
    saveRemembered({ passkey: this.passkey, autoConnect: this._autoConnect });
    if( !this._autoConnect && this.retrying ) {
      this._stopRetrying();
      this._wanted = false;
      this._setStatus( "Disconnected" );
    }
  }

  // ---- connection ---------------------------------------------------------------

  /**
   * Joins the hub named by `passkey` ("17285" or "17285.key"). Returns false
   * (and says why in `status`) when the passkey is malformed.
   */
  connect( passkey, { automatic = false } = {} ) {
    let parsed;
    try {
      parsed = parsePasskey( passkey );
    } catch (e) {
      this._setStatus( e.message );
      return false;
    }
    this.passkey = String( passkey ).trim();
    this._wanted = true;
    this._automatic = automatic;
    this._welcomed = false;
    this._retry = 0;
    this._open( parsed );
    return true;
  }

  disconnect() {
    this._wanted = false;
    this._stopRetrying();
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    if( socket ) {
      try { socket.close( 1000, "Disconnected by the user" ); } catch (e) {}
    }
    this._setStatus( "Disconnected" );
  }

  _stopRetrying() {
    clearTimeout( this._retryTimer );
    this._retryTimer = null;
    this._retryWhenVisible = false;
  }

  _open({ port, key }) {
    this._stopRetrying();
    if( this.socket ) {
      const old = this.socket;
      this.socket = null;
      try { old.close(); } catch (e) {}
    }
    let socket;
    try {
      socket = new WebSocket( `ws://127.0.0.1:${ port }/` );
    } catch (e) {
      // e.g. Safari refuses ws:// from an https page (mixed content)
      this._wanted = false;
      const https = window.location.protocol === "https:" ? " (https page)" : "";
      this._setStatus( `Blocked by the browser${ https }: ${ e.message }` );
      return;
    }
    this.socket = socket;
    this.connecting = true;
    this._setStatus( `Connecting to 127.0.0.1:${ port }...` );

    let opened = false;
    socket.addEventListener( "open", () => {
      if( socket !== this.socket ) { return; }
      opened = true;
      socket.send( toJSON( this._hello( key ) ) );
    });
    socket.addEventListener( "message", ( event ) => {
      if( socket !== this.socket ) { return; }
      this._onMessage( event, port );
    });
    socket.addEventListener( "close", ( event ) => {
      if( socket !== this.socket ) { return; }
      this._onClose( event, opened, port );
    });
  }

  _hello( key ) {
    const hello = {
      type: "hello", protocol: PROTOCOL, role: "viewer",
      viewer: {
        container_id : this.containerID ?? "",
        title        : typeof this.app.settings?.title === "string" ? this.app.settings.title : "",
        page_title   : document.title,
        subjects     : [ ...this.canvas.subject_codes ],
        version      : VERSION,
      },
    };
    if( key ) { hello.key = key; }
    return hello;
  }

  _onMessage( event, port ) {
    let message;
    try {
      message = JSON.parse( event.data );
    } catch (e) {
      return;
    }
    if( message.type === "welcome" ) {
      this.connected = true;
      this.connecting = false;
      this.viewerId = message.id;
      this._welcomed = true;
      this._retry = 0;
      this.everConnected = true;
      saveRemembered({ passkey: this.passkey, autoConnect: this._autoConnect });
      this._setStatus( `Connected as ${ message.id }\n - 127.0.0.1:${ port }` );
    } else if( message.type === "command" ) {
      this._schedule( message );
    }
  }

  _onClose( event, opened, port ) {
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    if( event.code === 4401 ) {
      this._wanted = false;
      this._setStatus( "Wrong key: check the passkey (port.key)" );
      return;
    }
    if( event.code === 4400 ) {
      this._wanted = false;
      this._setStatus( `The hub refused this viewer: ${ event.reason || "protocol mismatch" }` );
      return;
    }
    if( !this._wanted ) {
      this._setStatus( "Disconnected" );
      return;
    }
    // reconnect only what was connected, or what Auto-connect started
    if( this._autoConnect && ( this._welcomed || this._automatic ) ) {
      this._scheduleRetry( port );
      return;
    }
    this._wanted = false;
    if( opened ) {
      this._setStatus( "Disconnected (the hub closed the connection)" );
    } else {
      this._setStatus( `No hub on 127.0.0.1:${ port }. Start one, or allow this site to reach this device.` );
    }
  }

  _scheduleRetry( port ) {
    const delay = RETRY_DELAYS[ Math.min( this._retry, RETRY_DELAYS.length - 1 ) ];
    this._retry++;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if( !this._wanted ) { return; }
      // a hidden tab waits until it is shown again
      if( document.visibilityState !== "visible" ) {
        this._retryWhenVisible = true;
        return;
      }
      this._open( parsePasskey( this.passkey ) );
    }, delay );
    this._setStatus( `Disconnected: reconnecting to 127.0.0.1:${ port } in ${ Math.round( delay / 1000 ) } s` );
  }

  _onVisibilityChange = () => {
    if( document.visibilityState !== "visible" || !this._retryWhenVisible ) { return; }
    this._retryWhenVisible = false;
    if( this._wanted && !this.socket ) {
      this._open( parsePasskey( this.passkey ) );
    }
  }

  _setStatus( text ) {
    this.status = text;
    if( typeof this.onStatusChange === "function" ) {
      try { this.onStatusChange( this ); } catch (e) {}
    }
  }

  _send( message ) {
    const socket = this.socket;
    if( !socket || socket.readyState !== WebSocket.OPEN ) { return; }
    socket.send( toJSON( message ) );
  }

  // ---- commands -------------------------------------------------------------------

  // Commands run one at a time, in arrival order; those that arrive while the
  // viewer reloads its data (the control panel does not exist then) wait for
  // the end of the update
  _schedule( message ) {
    this._chain = this._chain.then( () => this._run( message ) );
  }

  _onUpdateStart = () => {
    this._updating = true;
  }

  _onUpdateEnd = () => {
    this._updating = false;
    this._queue.splice( 0 ).forEach(( message ) => this._schedule( message ));
  }

  async _run( message ) {
    if( this._updating || !this.app.controlCenter || !this.app.controllerGUI ) {
      this._queue.push( message );
      return;
    }
    let reply;
    try {
      const value = await this._execute( message.name, message.value );
      reply = { type: "result", id: message.id, ok: true, value: value ?? null };
    } catch ( error ) {
      reply = {
        type: "result", id: message.id, ok: false,
        error: { code: error?.code ?? "exception", message: error?.message ?? String( error ) },
      };
    }
    this._send( reply );
  }

  async _execute( name, value ) {
    switch ( name ) {
      case "describe":
        return this.describe();
      case "get_input":
        return this.getInput( typeof value === "string" ? value : value?.name );
      case "get_state":
        return this.getState();
      case "capture":
        return this.capture( value ?? {} );
      default:
        return this.runCommand( name, value );
    }
  }

  describe() {
    return [
      ...this.describeCommands(),
      { name: "describe", description: "This list", destructive: false },
      { name: "get_input", destructive: false,
        description: `{ name }: viewer state, one of ${ INPUTS.join(", ") }` },
      { name: "get_state", destructive: false,
        description: "Control panel values, slice crosshair, camera and current subject" },
      { name: "capture", destructive: false,
        description: "{ timeout_ms }: screenshot as PNG data URLs, { dataURI, views }" },
    ];
  }

  /**
   * A picture of the viewer as the user sees it: `dataURI` is the main view,
   * `views` every view drawn (main first, then the side panels), all opaque PNG
   * data URLs.
   */
  async capture({ timeout_ms = 5000 } = {}) {
    if( document.visibilityState !== "visible" ) {
      throw new DriverError( "hidden",
        "The page is hidden (a background tab or a minimized window), so the viewer does not draw" );
    }
    const request = {};
    this.$wrapper.dispatchEvent( new CustomEvent( "viewerApp.captureOnce", { detail: request } ) );
    const deadline = performance.now() + Math.max( 100, Number( timeout_ms ) || 5000 );
    while( typeof request.dataURI !== "string" && performance.now() < deadline ) {
      await new Promise(( resolve ) => setTimeout( resolve, 30 ));
    }
    if( typeof request.dataURI !== "string" ) {
      throw new DriverError( "timeout", "The viewer did not draw a frame in time" );
    }
    const background = this.canvas.background_color || "#ffffff";
    const views = asArray( request.views ).map(( view ) => view.dataURI ).filter(( uri ) => typeof uri === "string" );
    return {
      dataURI: await overBackground( request.dataURI, background ),
      views: await Promise.all( views.map(( uri ) => overBackground( uri, background )) ),
    };
  }

  emit( name, value ) {
    if( !this.enabled || !this.connected ) { return; }
    this._send({ type: "event", name, value: value ?? null });
  }

  dispose() {
    this.disconnect();
    this.$wrapper.removeEventListener( "viewerApp.updateData.start", this._onUpdateStart );
    this.$wrapper.removeEventListener( "viewerApp.updateData.end", this._onUpdateEnd );
    document.removeEventListener( "visibilitychange", this._onVisibilityChange );
    super.dispose();
  }

}

export { WebSocketDriver, DEFAULT_PASSKEY, parsePasskey, loadRemembered };
