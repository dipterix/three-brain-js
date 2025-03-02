import { CONSTANTS } from '../core/constants.js';
import { FileDataHandler } from './FileDataHandler.js';
import { gen_free } from '../geometry/free.js';
import { normalizeImageName, getColorFromFilename } from '../utility/normalizeImageName.js';

class SurfaceHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( !data.isSurfaceMesh ) {
      throw new Error("SurfaceHandler: data is not a valid mesh surface geometry");
    }
    return data;
  }

  handleData( data, app, filename ) {
    super.handleData( data, app, filename );

    const normalizedFilename = normalizeImageName( filename );

    data.fileName = filename;

    const inst = gen_free( data, app.canvas );
    inst.forceVisible = true;
    inst.object.layers.enable( CONSTANTS.LAYER_USER_ALL_SIDE_CAMERAS_4 );

    // Visibility
    app.controlCenter.dragdropAddVisibilityController( inst, filename );

    // Transparency
    app.controlCenter.dragdropAddOpacityController( inst, filename );

    // Colors
    app.controlCenter.dragdropAddColorController( inst, filename );

    // Update object

    // update controller

    // update canvas
    app.canvas.needsUpdate = true;

    // Make sure the instance can be properly disposed
    const disposeFolder = () => {
      try {
        const folder = app.controllerGUI.getFolder( `${CONSTANTS.FOLDERS[ 'dragdrop' ]} > Configure ROI Surfaces > ${ normalizedFilename }` );
        if( folder ) { folder.destroy(); }
      } catch (e) {
        console.warn(e);
      }
      app.controlCenter.removeEventListener( "viewerApp.dragdrop.clearAllSurfaces", disposeItem );
      app.controlCenter.removeEventListener( "viewerApp.dragdrop.setVisibleAllSurfaces", setVisible );
      app.controlCenter.removeEventListener( "viewerApp.dragdrop.setOpacityAllSurfaces", setOpacity );
    };
    const disposeItem = () => {
      try {
        inst.dispose();
        // delete app.canvas.surfaces.get( inst.subject_code )[ inst.name ];
      } catch (e) {
        console.warn(e);
      }
      disposeFolder();
    };

    const setVisible = (event) => {
      if( event.value === "hidden" || event.value === false ) {
        app.controllerGUI.getController( `Visibility - ${ normalizedFilename }` ).setValue( 'hidden' );
      } else {
        app.controllerGUI.getController( `Visibility - ${ normalizedFilename }` ).setValue( 'visible' );
      }
    };

    const setOpacity = ( event ) => {
      // type  : "viewerApp.dragdrop.setOpacityAllSurfaces",
      if( typeof event.value !== "number" ) { return; }
      app.controllerGUI.getController( `Opacity - ${ normalizedFilename }` ).setValue( event.value );
    };

    // When clean button is clicked
    app.controlCenter.addEventListener( "viewerApp.dragdrop.clearAllSurfaces", disposeItem );
    app.controlCenter.addEventListener( "viewerApp.dragdrop.setVisibleAllSurfaces", setVisible );
    app.controlCenter.addEventListener( "viewerApp.dragdrop.setOpacityAllSurfaces", setOpacity );

    // also register so when the object is disposed,
    inst.addEventListener( CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart, disposeFolder );
  }

}

export { SurfaceHandler };
