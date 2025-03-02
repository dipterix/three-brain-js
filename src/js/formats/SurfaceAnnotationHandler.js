import { CONSTANTS } from '../core/constants.js';
import { FileDataHandler } from './FileDataHandler.js';
import { normalizeImageName } from '../utility/normalizeImageName.js';
import { SHARED_SETTINGS } from '../core/SharedSettings.js';

class SurfaceAnnotationHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( !data.isSurfaceAnnotation ) {
      throw new Error("SurfaceAnnotationHandler: data is not a valid mesh surface annotation");
    }
    return data;
  }

  handleData( data, app, filename ) {
    super.handleData( data, app, filename );

    const folderName = CONSTANTS.FOLDERS[ 'dragdrop' ];
    const normalizedFilename = normalizeImageName( filename );

    data.fileName = filename;

    // get hemisphere and surface type (maybe)
    let hemi = ["Left", "Right"];
    if ( normalizedFilename.startsWith("lh") ) {
      hemi = ["Left"];
    } else if ( normalizedFilename.startsWith("rh") ) {
      hemi = ["Right"];
    }

    // window.annot = data;

    // obtain the current subject
    const subjectCode = app.canvas.get_state("target_subject");

    // get the surface
    const surfaceList = app.canvas.surfaces.get( subjectCode );
    // const lut = app.controlCenter.continuousLookUpTables.default;

    hemi.forEach(hemisphere => {
      const surface = surfaceList[`FreeSurfer ${hemisphere} Hemisphere - pial (${subjectCode})`];
      if( !surface ) { return; }

      const surfaceName = `${ hemisphere[0].toLowerCase() }h.pial`;
      const inst = surface.userData.instance;

      inst.object.userData[`${ inst._hemispherePrefix }h_annotation_[custom annotation]`] = data;
      if( !inst._annotationList.includes("[custom annotation]") ) {
        inst._annotationList.push("[custom annotation]");
      }

      inst.setColors( data.vertexColor, {
        isContinuous  : false,
        overlay       : true,
        // for discontinuous
        discreteColorSize : 4,
        discreteColorMax  : 255,
        dataName: "[custom annotation]",
      });

      app.controllerGUI.getController("Vertex Data").setValue("[custom annotation]");

      // Make sure the vertex data can be properly disposed
      const disposeItem = () => {
        const crtlVertData = app.controllerGUI.getController('Vertex Data');
        const currentDataName = crtlVertData.isfake ? "[none]" : crtlVertData.getValue();

        // make sure the pial surface is back to vertex color
        inst._materialColor.set( "#ffffff" );
        inst.object.material.vertexColors = true;
        inst.object.userData[`${ inst._hemispherePrefix }h_annotation_[custom annotation]`] = undefined;
        // let surface handle the rerest
        inst.setColors( null, {
          overlay       : true,
          dataName: "[none]",
        });

        // make sure the data is set back to previous
        crtlVertData.setValue( currentDataName === "[custom annotation]" ? "[none]" : currentDataName );
        app.controlCenter.removeEventListener( "viewerApp.dragdrop.clearAllSurfaces", disposeItem );
      };

      // When clean button is clicked
      app.controlCenter.addEventListener( "viewerApp.dragdrop.clearAllSurfaces", disposeItem );

      // also register so when the object is disposed,
      inst.addEventListener(CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart, disposeItem);
    });

    app.controllerGUI.getController("Surface Color").setValue("vertices");
    // update canvas
    app.canvas.needsUpdate = true;

  }

}

export { SurfaceAnnotationHandler };
