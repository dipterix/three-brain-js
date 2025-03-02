import { SHARED_SETTINGS } from '../core/SharedSettings.js';

const objectColorSettings = SHARED_SETTINGS.OBJECT_COLORS;

/**
 * each file data handler must be able to
 *  handle a file,
 *  tell which type
 *  handle app,
 *      add objects
 *      set controllers
 *      set states
 */
class FileDataHandler {

  // whether this handler is final, meaning that
  // if the data passes the assertion and is correctly handled,
  // then the following handlers will ignore the data
  isFinal = false;

  async _updateColorMap( app ) {
    const gui = app.controllerGUI;
    if( !gui ) { return; }

    for( let fname in objectColorSettings ) {
      const color = objectColorSettings[ fname ].single;
      gui.getController( `Color - ${ fname }.nii` ).setValue( color );
      gui.getController( `Color - ${ fname }.nii.gz` ).setValue( color );
      gui.getController( `Color - ${ fname }.mgz` ).setValue( color );

      gui.getController( `Color - ${ fname }.gii` ).setValue( color );
      gui.getController( `Color - ${ fname }.stl` ).setValue( color );
      gui.getController( `Color - ${ fname }` ).setValue( color );
    }
  }

  assertData( data, filename ) {
    // do nothing
  }

  testData( data, filename ) {
    // return true or false if this handler can handle this data
    try {
      this.assertData( data, filename );
      return true;
    } catch (e) {
      return false;
    }
    return false;
  }

  handleData( data, app, filename, options = {} ) {
    const result = this.assertData( data, filename );
    return result;
  }
}

export { FileDataHandler };
