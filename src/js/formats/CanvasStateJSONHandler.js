import { FileDataHandler } from './FileDataHandler.js';

class CanvasStateJSONHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( typeof data === "string" ) {
      data = JSON.parse("");
    }
    if( !data || typeof data !== "object" ) {
      throw new Error("CanvasStateJSONHandler: undefined empty data");
    }

    if( !data.isThreeBrainControllerData ) {
      throw new Error("CanvasStateJSONHandler: data has no flag `isThreeBrainControllerData` set to true.");
    }
    return data;
  }

  handleData( data, app, filename ) {
    const parsedData = super.handleData( data, app, filename );

    const controllerData = parsedData.controllerData;
    if( controllerData && typeof controllerData === "object") {
      app.controllerGUI.load( controllerData );
    }
    const cameraData = parsedData.cameraState;
    if( cameraData && typeof cameraData === "object" ) {
      if( cameraData.target ) {
        app.canvas.mainCamera.lookAt( cameraData.target );
      }
      if( cameraData.up ) {
        app.canvas.mainCamera.up.copy( cameraData.up );
      }
      if( typeof cameraData.zoom === "number" ) {
        app.canvas.mainCamera.zoom = cameraData.zoom;
      }
      if( cameraData.position ) {
        cameraData.position.updateProjection = false;
        app.canvas.mainCamera.setPosition( cameraData.position );
      }
      app.canvas.mainCamera.updateProjectionMatrix();
    }
  }

}

export { CanvasStateJSONHandler };
