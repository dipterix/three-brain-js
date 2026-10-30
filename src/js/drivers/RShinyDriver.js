import { ViewerDriver } from './ViewerDriver.js';

/**
 * The Shiny transport: commands arrive as custom messages
 * `threeBrain-RtoJS-<containerID>` from R's `ViewerProxy`, and viewer state goes
 * back as input `<containerID>_<name>`.
 */
class RShinyDriver extends ViewerDriver {

  constructor( viewerApp ) {

    super( viewerApp );

    this.isRShinyDriver = true;
    this.shinyCallbackID = `${ this.containerID }__shiny`;

    // check if shiny is valid
    if( typeof window.Shiny !== "object" || window.Shiny === null ||
        typeof window.Shiny.onInputChange !== "function" ) {
      // this is not shiny, just return
      this._shiny = undefined;
      return;
    }

    this._shiny = window.Shiny;

    // register events
    this.listen();

    // Bind shiny
    this._shiny.addCustomMessageHandler(`threeBrain-RtoJS-${this.containerID}`, (data) => {

      if( typeof data.name !== "string" || data.name.length === 0 ) { return; }

      if( !this.hasCommand( data.name ) ) {
        console.warn(`Unknown Shiny command type: [${data.name}].`);
        return;
      }
      this.runCommand( data.name, data.value );

    });

    this.enabled = true;
    this.debugVerbose("[RShinyDriver] Registered");

  }

  emit( name , value , priority = "deferred" ) {

    if( !this.enabled ){ return; }

    this.debugVerbose(`Sending data [${name}] to shiny app...`)
    // make sure shiny exists and is connected
    // We need to rethink this._shiny.shinyapp.$socket...
    // If shiny is not connected, we should queue the data and send it when it connects.
    if( !this._shiny || !this._shiny.shinyapp.$socket ) { return; }
    const inputId = `${ this.containerID }_${ name }`;
    this.debugVerbose(`Dispatching to shiny with priority ${ priority }: ${ name }`);
    this._shiny.setInputValue(inputId, value, { priority : priority });
  }

  // the name it had before the transports were split
  dispatchToShiny( name , value , priority = "deferred" ) {
    this.emit( name, value, priority );
  }

}


export { RShinyDriver };
