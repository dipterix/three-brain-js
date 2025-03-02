import { CONSTANTS } from '../core/constants.js';
import { FileDataHandler } from './FileDataHandler.js';
import { gen_datacube2 } from '../geometry/datacube2.js';
import { normalizeImageName, getColorFromFilename } from '../utility/normalizeImageName.js';

class VolumeHandler extends FileDataHandler {

  isFinal = true;

  assertData( data, filename ) {

    const filenameLowerCase = filename.toLowerCase();
    if( !(
      filenameLowerCase.endsWith("nii") ||
      filenameLowerCase.endsWith("nii.gz") ||
      filenameLowerCase.endsWith("mgz") ||
      filenameLowerCase.endsWith("mgh")
    )) {
      throw new Error("VolumeHandler: filename is not a valid NIfTI nor MGH/MGZ filename");
    }

    if( !data.isNiftiImage && !data.isMGHImage ) {
      throw new Error("VolumeHandler: data is not a valid NIfTI nor MGH/MGZ volume");
    }
    return data;
  }

  handleData( data, app, filename ) {
    super.handleData( data, app, filename );

    data.fileName = filename;
    const normalizedFilename = normalizeImageName( filename );
    const inst = gen_datacube2( data, app.canvas );
    inst.forceVisible = true;

    // Visibility
    app.controlCenter.dragdropAddVisibilityController( inst, filename );

    // Transparency
    app.controlCenter.dragdropAddOpacityController( inst, filename );

    // Clamp values
    app.controlCenter.dragdropAddValueClippingController( inst, filename );

    // Colors
    app.controlCenter.dragdropAddColorController( inst, filename );

    // Update object
    app.controlCenter.updateDataCube2Types( normalizedFilename );

    // update controller
    app.controllerGUI.getController("Voxel Display").setValue("normal");
    app.canvas.needsUpdate = true;

    // Make sure the instance can be properly disposed
    const disposeFolder = () => {
      try {
        const folder = app.controllerGUI.getFolder( `${CONSTANTS.FOLDERS[ 'dragdrop' ]} > Configure ROI Volumes > ${ normalizedFilename }` );
        if( folder ) { folder.destroy(); }
      } catch (e) {
        console.warn(e);
      }
      app.controlCenter.removeEventListener( "viewerApp.dragdrop.clearAllVolumes", disposeItem );
      app.controlCenter.removeEventListener( "viewerApp.dragdrop.setVisibleAllVolumes", setVisible );
      app.controlCenter.removeEventListener( "viewerApp.dragdrop.setOpacityAllVolumes", setOpacity );
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
    app.controlCenter.addEventListener( "viewerApp.dragdrop.clearAllVolumes", disposeItem );
    app.controlCenter.addEventListener( "viewerApp.dragdrop.setVisibleAllVolumes", setVisible );
    app.controlCenter.addEventListener( "viewerApp.dragdrop.setOpacityAllVolumes", setOpacity );

    // also register so when the object is disposed,
    inst.addEventListener( CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart, disposeFolder );

  }

}

export { VolumeHandler };
