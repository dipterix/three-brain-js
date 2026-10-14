import { CONSTANTS } from '../core/constants.js';
import { WebSocketDriver, DEFAULT_PASSKEY, loadRemembered } from '../drivers/WebSocketDriver.js';

// "Remote Control": joins a hub on this computer so other programs (R, Python,
// AI agents) can drive this viewer. The hub prints a passkey ("17285", or
// "17285.key" when it has a key); paste it and click Connect.


function registerPresetRemoteControl( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_remoteControl = function(){

    const folderName = CONSTANTS.FOLDERS[ 'focus-object' ];
    const app = this.app;
    const gui = this.gui;
    const remembered = loadRemembered();

    const defaultPasskey = String( app.remoteDriver?.passkey ?? app.settings?.remote_passkey ?? remembered?.passkey ?? DEFAULT_PASSKEY )

    const passkey = gui.addController( "Passkey", defaultPasskey, { folder_name: folderName } );
    const connect = gui.addController( "Connect", () => {
      const driver = app.remoteDriver;

      // If connected, disconnect
      if( driver && ( driver.connected || driver.connecting || driver.retrying ) ) {
        driver.disconnect();
        return;
      }

      // Create driver and link
      const created = WebSocketDriver.attach( app );
      created.onStatusChange = refresh;
      created.connect( passkey.getValue() );

    }, { folder_name: folderName } );

    const status = gui
      .addController(
        "Remote Connection Status", "Not connected",
        {
          type: "multiline",
          folder_name: folderName,
          moreArgs: { multiline: true, rows: 2, readonly: true }
        })
      .disable();
    
    const autoConnect = gui.addController( "Auto-connect", true, { folder_name: folderName } )
      .onChange(( value ) => {
        if( app.remoteDriver ) { app.remoteDriver.setAutoConnect( value ); }
      });

    // settings of this browser, not state of the viewer: never reported
    [ passkey, connect, status, autoConnect ].forEach(( controller ) => {
      controller._localOnly = true;
    });

    // writes a value without firing change handlers
    const display = ( controller, value ) => {
      controller.object[ controller.property ] = value;
      controller.updateDisplay();
    };

    // the checkbox appears once this site has connected
    const refresh = () => {
      const driver = app.remoteDriver;
      const busy = !!driver && ( driver.connected || driver.connecting || driver.retrying );
      connect.name( busy ? "Disconnect" : "Connect" );
      display( status, driver ? driver.status : "Not connected" );
      const everConnected = driver ? driver.everConnected : remembered !== null;
      if( everConnected === autoConnect._hidden ) { autoConnect.show( everConnected ); }
      display( autoConnect, driver ? driver.autoConnect : ( remembered?.autoConnect ?? true ) );
    };
    if( app.remoteDriver ) { app.remoteDriver.onStatusChange = refresh; }
    refresh();

    // a site that connected before, with Auto-connect left on, reconnects by
    // itself once the viewer has loaded
    if( !app.remoteDriver && remembered?.autoConnect === true && typeof remembered.passkey === "string" ) {
      app.$wrapper.addEventListener( "viewerApp.updateData.end", () => {
        if( app.remoteDriver ) { return; }
        const created = WebSocketDriver.attach( app );
        created.onStatusChange = refresh;
        created.connect( remembered.passkey, { automatic: true } );
      }, { once: true } );
    }
  };

  return ViewerControlCenter;

}

export { registerPresetRemoteControl };
