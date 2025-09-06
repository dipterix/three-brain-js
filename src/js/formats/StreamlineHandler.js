import { CONSTANTS } from '../core/constants.js';
import { FileDataHandler } from './FileDataHandler.js';
import { gen_streamline } from '../geometry/streamline.js';
import { ensureObjectColorSettings } from '../core/SharedSettings.js';
import { normalizeImageName, getColorFromFilename } from '../utility/normalizeImageName.js';
import { testColorString } from '../utility/color.js';

class StreamlineHandler extends FileDataHandler {

  isFinal = true;

  assertData( data, fileName ) {

    const fileNameLowerCase = fileName.toLowerCase();
    if( !(
      fileNameLowerCase.endsWith("trk") ||
      fileNameLowerCase.endsWith("trk.gz") ||
      fileNameLowerCase.endsWith("tt") ||
      fileNameLowerCase.endsWith("tt.gz") ||
      fileNameLowerCase.endsWith("tck")
    )) {
      throw new Error(`StreamlineHandler: ${ fileName } is not supported`);
    }

    if( !data.isStreamline ) {
      throw new Error("StreamlineHandler: data is not a streamline");
    }
    return data;
  }

  handleData( data, app, fileName ) {
    super.handleData( data, app, fileName );

    data.fileName = fileName;
    const normalizedFilename = normalizeImageName( fileName );
    const inst = gen_streamline( data, app.canvas );

    // Visibility
    app.controlCenter.dragdropAddVisibilityController( inst, fileName );

    const parentFolder = app.controlCenter.getDragDropFolderPath( fileName, "Configure Streamlines" );

    const addOrUpdateController = (name, value, args = {}) => {
      const controllerName = `${name} - ${ normalizedFilename }`;
      let controller = app.controllerGUI.getController( controllerName, parentFolder, true );
      if( controller.isfake ) {
        controller = app.controllerGUI.addController(
          controllerName, value,
          {
            folderName : parentFolder,
            ...args
          }
        );
      }
      return controller;
    };

    const ctrlVisibility = addOrUpdateController("Visibility", true);
    ctrlVisibility.onChange(v => {
      inst.set_visibility( v ? true : false );
      app.canvas.needsUpdate = true;
    });
    ctrlVisibility.setValue(true);

    // Clamp values
    // app.controlCenter.dragdropAddValueClippingController( inst, fileName );
    window.dddd = data;
    // Colors
    const colorSettings = ensureObjectColorSettings( fileName, { 'defaultSingle' : data.color });
    const ctrlColor = addOrUpdateController("Color", colorSettings.single, { isColor : true });
    ctrlColor.onChange( v => {
        if( !testColorString(v) ) { return; }
        colorSettings.single = v;
        inst.object.material.color.set( v );
        app.canvas.needsUpdate = true;
      });
    ctrlColor.setValue( colorSettings.single );

    // Update object
    // app.controlCenter.updateDataCube2Types( normalizedFilename );

    // update controller
    app.canvas.needsUpdate = true;

    // Make sure the instance can be properly disposed
    const disposeItem = () => {

      try {
        inst.removeEventListener( CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart, disposeItem );
        inst.dispose();
        // delete app.canvas.surfaces.get( inst.subject_code )[ inst.name ];
      } catch (e) {
        console.warn(e);
      }

      try {
        const folder = app.controllerGUI.getFolder( parentFolder );
        if( folder ) { folder.destroy(); }
      } catch (e) {
        console.warn(e);
      }

      app.controlCenter.removeEventListener( "viewerApp.dragdrop.clearAllTracts", disposeItem );
      app.controlCenter.removeEventListener( "viewerApp.dragdrop.setVisibleAllTracts", setVisible );
    };

    const setVisible = (event) => {
      if( event.value === "hidden" || event.value === false ) {
        ctrlVisibility.setValue( false );
      } else {
        ctrlVisibility.setValue( true );
      }
    };

    /*
    const setOpacity = ( event ) => {
      // type  : "viewerApp.dragdrop.setOpacityAllSurfaces",
      if( typeof event.value !== "number" ) { return; }
      app.controllerGUI.getController( `Opacity - ${ normalizedFilename }` ).setValue( event.value );
    };
    */

    // When clean button is clicked
    app.controlCenter.addEventListener( "viewerApp.dragdrop.clearAllTracts", disposeItem );
    app.controlCenter.addEventListener( "viewerApp.dragdrop.setVisibleAllTracts", setVisible );
    // app.controlCenter.addEventListener( "viewerApp.dragdrop.setOpacityAllVolumes", setOpacity );

    // also register so when the object is disposed,
    inst.addEventListener( CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart, disposeItem );

  }

}

export { StreamlineHandler };
