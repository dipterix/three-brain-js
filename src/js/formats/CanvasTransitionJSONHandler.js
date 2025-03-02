import { FileDataHandler } from './FileDataHandler.js';

class CanvasTransitionJSONHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( typeof data === "string" ) {
      data = JSON.parse("");
    }
    if( !data || typeof data !== "object" ) {
      throw new Error("CanvasTransitionJSONHandler: undefined empty data");
    }

    if( !data.isThreeBrainTransition ) {
      throw new Error("CanvasTransitionJSONHandler: data has no flag `isThreeBrainTransition` set to true.");
    }

    const transitionData = data.transitionData;
    if(!Array.isArray(transitionData)) {
      throw new Error("CanvasTransitionJSONHandler: data has flag `isThreeBrainTransition` set to true. Hoever, there is no `transitionData` or `transitionData` is empty.");
    }
    return data;
  }

  handleData( data, app, filename, { autoDispose = true } = {} ) {
    const parsedData = super.handleData( data, app, filename );
    const transitionData = data.transitionData;
    let transitionParams = data.parameters;
    if(!transitionParams || typeof transitionParams !== "object") {
        transitionParams = {};
    }
    transitionParams.autoDispose = autoDispose;
    const transition = app.addTransitions(transitionData, transitionParams);
    transition.start();

    return transition;
  }

}

export { CanvasTransitionJSONHandler };
