import { CONSTANTS } from '../core/constants.js';
import { FileDataHandler } from './FileDataHandler.js';
import { normalizeImageName } from '../utility/normalizeImageName.js';
import { SHARED_SETTINGS } from '../core/SharedSettings.js';

class SurfaceMeasurementHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( !data.isSurfaceMeasurement ) {
      throw new Error("SurfaceMeasurementHandler: data is not a valid mesh surface measurement");
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

    // obtain the current subject
    const subjectCode = app.canvas.get_state("target_subject");

    // get the surface
    const surfaceList = app.canvas.surfaces.get( subjectCode );
    const lut = app.controlCenter.continuousLookUpTables.default;

    let maxAbsVal = Math.max(data.max, -data.min);
    if( maxAbsVal <= 0 ) { maxAbsVal = 1; }

    hemi.forEach((hemisphere) => {
      const surface = surfaceList[`FreeSurfer ${ hemisphere } Hemisphere - pial (${subjectCode})`];
      if( !surface ) { return; }

      const surfaceName = `${ hemisphere[0].toLowerCase() }h.pial`;
      const inst = surface.userData.instance;
      const innerFolderName = `${folderName} > Configure ROI Surfaces > ${surfaceName}`;

      // let nodeDataObject = this._canvas.get_data(`${ this._hemispherePrefix }h_annotation_${annotName}`,
      // be available
      data.min = -maxAbsVal;
      data.max = maxAbsVal;
      inst.object.userData[`${ inst._hemispherePrefix }h_annotation_[custom measurement]`] = data;
      if( !inst._annotationList.includes("[custom measurement]") ) {
        inst._annotationList.push("[custom measurement]");
      }

      const cmapName = SHARED_SETTINGS.OBJECT_COLORS[`${ inst._hemispherePrefix }h.pial`].continuous;
      inst.state.defaultColorMap = cmapName;
      inst.setColors( data.vertexData, {
        isContinuous : true,
        overlay : true,
        minValue: -maxAbsVal,
        maxValue: maxAbsVal,
        dataName: "[custom measurement]",
      });

      // Colors
      app.controlCenter.dragdropAddColorController( inst, surfaceName, "continuous" );

      app.controllerGUI.getController("Vertex Data").setValue("[custom measurement]");

      app.controlCenter.dragdropAddValueClippingController( inst, surfaceName );

      // Make sure the vertex data can be properly disposed
      const disposeItem = () => {
        const crtlVertData = app.controllerGUI.getController('Vertex Data');
        const currentDataName = crtlVertData.isfake ? "[none]" : crtlVertData.getValue();

        // make sure the pial surface is back to vertex color
        inst._materialColor.set( "#ffffff" );
        inst.object.material.vertexColors = true;
        inst.object.userData[`${ inst._hemispherePrefix }h_annotation_[custom measurement]`] = undefined;
        // let surface handle the rerest
        inst.setColors( null, {
          overlay       : true,
          dataName: "[none]",
        });

        // make sure the data is set back to previous
        crtlVertData.setValue( currentDataName === "[custom measurement]" ? "[none]" : currentDataName );
        try {
          const folder = app.controllerGUI.getFolder( innerFolderName );
          if( folder ) { folder.destroy(); }
        } catch (e) {
          console.warn(e);
        }
        app.controlCenter.removeEventListener( "viewerApp.dragdrop.clearAllSurfaces", disposeItem );
      };

      // When clean button is clicked
      app.controlCenter.addEventListener( "viewerApp.dragdrop.clearAllSurfaces", disposeItem );

      // also register so when the object is disposed,
      inst.addEventListener(CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart, disposeItem);
    })

    app.controllerGUI.getController("Surface Color").setValue("vertices");
    // update canvas
    app.canvas.needsUpdate = true;

  }

}

export { SurfaceMeasurementHandler };
