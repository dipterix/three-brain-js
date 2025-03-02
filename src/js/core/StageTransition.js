import { Color, Vector3 } from 'three';

class StageTransition {

  constructor ( app, transitionData = [], {
    // only play once
    loops = 0,

    // 4 s for transition
    trasitionDuration = 1.5,

    // then wait for 6 s before next
    transitionTimeout = 6,

    // whether to record videos
    enableRecording = false,

    autoDispose = true,

    resetCanvas = false,
  } = {} ) {
    this.app = app;
    this.canvas = null;

    if( transitionData ) {
      if( !Array.isArray( transitionData ) ) {
        transitionData = [transitionData];
      }
    } else {
      transitionData = [];
    }
    this.transitionData = transitionData;

    this.globalClock = this.app.globalClock;
    this.loops = loops;
    this.enableRecording = enableRecording;
    this.autoDispose = autoDispose;

    // current stage in the transitionData
    this._stageIndex = -1;

    this.defaultTransitionDuration = trasitionDuration;
    this.defaultTransitionTimeout = transitionTimeout;

    this.startState = new Map();
    this.finishState = new Map();
    this.currentState = new Map();

    this._initialized = false;
    this._resetCanvas = resetCanvas;
    this._running = false;
    this._timeStarted = 0;
    this._background = undefined; // this.background.scene.background;
    this._stageData = {};
    this._tmpCol1 = new Color();
    this._tmpCol2 = new Color();
    this._tmpVec3 = new Vector3();
  }

  get running() {
    return this._running && this.globalClock.running;
  }

  getElapsedTime () {
    if ( !this.running ) { return Infinity; }
    return this.globalClock.getElapsedTime() - this._timeStarted;
  }

  init() {
    if( this._initialized ) { return; }
    if( !this.app.canvas ) { return; }
    this._initialized = true;
    this.stop();

    this.canvas = this.app.canvas;
    // this.canvas.set_state( "info_text_position", "right" );
    // this.canvas.disableSideCanvas();
    // this.app.controllerGUI.close();

    // debug
    // window.threeBrain.demoApp = this.app;

    // Add background
    if( !this.canvas.scene.background || !this.canvas.scene.background.isColor ) {
      this.canvas.scene.background = this.canvas._backgroundObject;
    }
    this._background = this.canvas.scene.background;
    this.currentState.set("backgroundColor", this.canvas.scene.background);
    this.startState.set("backgroundColor", new Color());
    this.finishState.set("backgroundColor", new Color());

    // Add main camera
    this.currentState.set("cameraMain", {
      position : new Vector3(),
      up : new Vector3(),
      zoom: 1
    });
    this.startState.set("cameraMain", {
      position : new Vector3(),
      up : new Vector3(),
      zoom: 1
    });
    this.finishState.set("cameraMain", {
      position : new Vector3(),
      up : new Vector3(),
      zoom: 1
    });

    // controllers
    this.currentState.set("controllers", []);
    this.startState.set("controllers", []);
    this.finishState.set("controllers", []);

    // transition function
    if( this._resetCanvas ) {
      this.canvas.resetCanvas();
    }
    this.canvas.trackball.noZoom = false;
    this.canvas.trackball.noPan = false;
    // this.canvas.trackball._panStart.set(0.5, 0.5);
    // this.canvas.trackball._panEnd.set( 0.72, 0.44);
    // this.canvas.trackball._zoomStart.y = 0.0;
    // this.canvas.trackball._zoomEnd.y = 10.0;

    // this.canvas.trackball.addEventListener( "start", this._freezeTrackBall );
    // this.canvas.trackball.domElement.addEventListener( 'wheel', this._onDemoMouseWheel, false );
    this.canvas.trackball.panCamera();
    this.canvas.trackball.zoomCamera();
  }

  _syncCanvas( stateMap ) {
    stateMap.get("backgroundColor").copy( this.canvas.scene.background );
    const cameraMain = stateMap.get("cameraMain");
    cameraMain.zoom = this.canvas.mainCamera.zoom;
    cameraMain.position.copy(this.canvas.mainCamera.position);
    cameraMain.up.copy(this.canvas.mainCamera.up);
  }

  start() {
    if( this._running ) { return; }
    // make sure inited
    this.init();

    // Sync canvas state
    this._syncCanvas( this.currentState );
    this._syncCanvas( this.startState );
    this._syncCanvas( this.finishState );

    this._stageIndex = -1;
    this._loops = this.loops;

    if( this.enableRecording ) {
      const controller = this.app.controllerGUI.getController("Record");
      if(!controller.isfake && !controller.getValue()) {
        controller.setValue(true);
      }
    }

    this.nextStage();
    // this._timeStarted = this.globalClock.setTimeout( this.morphState.duration );
  }

  stop() {
    this._running = false;

    if( this.enableRecording ) {
      const controller = this.app.controllerGUI.getController("Record");
      if(!controller.isfake && controller.getValue()) {
        controller.setValue(false);
      }
    }
  }

  nextStage() {
    if( this.transitionData.length === 0 ) {
      this.stop();
      if( this.autoDispose ) {
        this.dispose();
      }
      return;
    }
    // switch start and finish state
    const tmpState = this.startState;
    this.startState = this.finishState;
    this.finishState = tmpState;

    this._stageIndex++;
    if( this._stageIndex >= this.transitionData.length ) {
      this._stageIndex -= this.transitionData.length;
      this._loops--;
      if( this._loops < 0 ) {
        this.stop();
        if( this.autoDispose ) {
          this.dispose();
        }
        return;
      }
    }
    const stageData = this.transitionData[ this._stageIndex ];
    this._stageData = stageData;

    if( typeof stageData.trasitionDuration !== "number" ) {
      stageData.trasitionDuration = this.defaultTransitionDuration;
    }

    if( typeof stageData.transitionTimeout !== "number" ) {
      stageData.transitionTimeout = this.defaultTransitionTimeout;
    }
    const transitionTimeTotal = stageData.trasitionDuration + stageData.transitionTimeout;

    /**
     * `stageData` example:
     * {
     *    background : "#ccffff",
     *    camera : { position, up, zoom, },
     *    controllers: { ... }
     * }
     */

    // make sure by default finishState does not change current
    this._syncCanvas( this.finishState );

    // background color
    if( typeof stageData.background === "string" ) {
      this.finishState.get("backgroundColor").set( stageData.background );
    }

    // zoom
    if( stageData.cameraMain && typeof stageData.cameraMain === "object" ) {
      const cameraMain = this.finishState.get("cameraMain");
      if( typeof stageData.cameraMain.zoom === "number" ) {
        cameraMain.zoom = stageData.cameraMain.zoom;
      }
      if( stageData.cameraMain.position ) {
        cameraMain.position.copy( stageData.cameraMain.position );
      }
      if( stageData.cameraMain.up ) {
        cameraMain.up.copy( stageData.cameraMain.up );
      }
    }

    // TODO: side camera

    // controllers
    let controllerData = stageData.controllers;
    if( !controllerData || typeof controllerData !== "object" ) {
      controllerData = {};
      stageData.controllers = controllerData;
    }

    let immediateControllers = controllerData.immediate;
    if( !immediateControllers || typeof immediateControllers !== "object" ) {
      immediateControllers = {};
      controllerData.immediate = immediateControllers;
    }

    let animatedControllers = controllerData.animated;
    if( !animatedControllers || typeof animatedControllers !== "object" ) {
      animatedControllers = {};
      controllerData.animated = animatedControllers;
    }

    let delayedControllers = controllerData.delayed;
    if( !delayedControllers || typeof delayedControllers !== "object" ) {
      delayedControllers = {};
      controllerData.delayed = delayedControllers;
    }

    // set immediate controllers right now
    const immediateControllerData = [];
    for(let name in immediateControllers) {
      const controller = this.app.controllerGUI.getController(name);
      if(!controller.isfake) {
        immediateControllerData.push({
          name  : name,
          value : immediateControllers[name],
        });
      }
    }

    this.app.canvas.setControllerValues({
      data : immediateControllerData,
      immediate: true
    });

    // for each controller
    const currentControllers = this.currentState.get("controllers"),
          startControllers = this.startState.get("controllers"),
          finishControllers = this.finishState.get("controllers");

    currentControllers.length = 0;
    startControllers.length = 0;
    finishControllers.length = 0;

    for(let name in animatedControllers) {
      const controller = this.app.controllerGUI.getController(name);
      if(controller.isfake) {
        continue;
      }
      startControllers.push({
        name  : name,
        value : controller.getValue(),
      });
      currentControllers.push({
        name  : name,
        value : controller.getValue(),
      });
      finishControllers.push({
        name  : name,
        value : animatedControllers[name],
        isColor: controller._isColor,
      });
    }
    // registerControllers(delayedControllers);


    this._running = true;
    this._idle = false;
    this._timeStarted = this.globalClock.setTimeout( transitionTimeTotal );
  }

  update() {
    if( !this._running ) { return; }

    const elapsed = this.getElapsedTime();
    const stageData = this._stageData;

    if( elapsed >= stageData.transitionTimeout + stageData.trasitionDuration ) {
      this.nextStage();
      return;
    }

    let transitionFactorLinear = 1;
    if( elapsed < stageData.trasitionDuration ) {
      transitionFactorLinear = elapsed / stageData.trasitionDuration;
    }
    let transitionFactor = (
            0.5 - 1 / (1 + Math.exp( (transitionFactorLinear - 0.5) * 12 ) )
          ) * 1.0 + 0.5;

    if( transitionFactorLinear >= 1 ) {
      transitionFactor = 1;
      if( this._idle ) {
        return;
      } else {
        this._idle = true;
      }
    }

    // set background
    const backgroundColor = this.currentState.get("backgroundColor"),
          startBackground = this.startState.get("backgroundColor"),
          finishBackground = this.finishState.get("backgroundColor");
    backgroundColor.lerpColors( startBackground, finishBackground, transitionFactorLinear );

    // main camera
    const currentCameraMain = this.currentState.get("cameraMain"),
          startCameraMain = this.startState.get("cameraMain"),
          finishCameraMain = this.finishState.get("cameraMain");
    currentCameraMain.zoom = startCameraMain.zoom + ( finishCameraMain.zoom - startCameraMain.zoom ) * transitionFactor;
    currentCameraMain.position
      .lerpVectors( startCameraMain.position, finishCameraMain.position, transitionFactor )
      .normalize();
    currentCameraMain.up.lerpVectors( startCameraMain.up, finishCameraMain.up, transitionFactor )
      .cross( currentCameraMain.position )
      .cross( currentCameraMain.position )
      .normalize()
      .multiplyScalar( -1 );

    const cameraMainUpLenSq = currentCameraMain.up.lengthSq();
    currentCameraMain.position.forceZUp = false;
    currentCameraMain.position.updateProjection = false;

    if( isNaN(cameraMainUpLenSq) || cameraMainUpLenSq < 0.5 ) {
      currentCameraMain.position.forceZUp = true;
      this.canvas.mainCamera.setPosition( currentCameraMain.position );
    } else {
      this.canvas.mainCamera.setPosition( currentCameraMain.position );
      this.canvas.mainCamera.up.copy( currentCameraMain.up );
    }
    this.canvas.mainCamera.setZoom({ zoom: currentCameraMain.zoom });

    // controllers
    const currentControllers = this.currentState.get("controllers"),
          startControllers = this.startState.get("controllers"),
          finishControllers = this.finishState.get("controllers");

    const tmpColor1 = this._tmpCol1,
          tmpColor2 = this._tmpCol2;
    for(let i = 0; i < finishControllers.length; i++) {
      const cs = startControllers[i],
            cf = finishControllers[i],
            cc = currentControllers[i];

      if( cf.isColor ) {
        if( cs.value.startsWith("#") ) {
          tmpColor1.set( cs.value );
        } else {
          tmpColor1.set( `#${cs.value}` );
        }
        if( cf.value.startsWith("#") ) {
          tmpColor2.set( cf.value );
        } else {
          tmpColor2.set( `#${cf.value}` );
        }
        tmpColor1.lerp( tmpColor2, transitionFactor );
        cc.value = tmpColor1.getHexString();
      } else if ( typeof cf.value === "number" ){
        cc.value = cs.value + ( cf.value - cs.value ) * transitionFactor;
      } else {
        cc.value = cf.value;
      }
    }

    if(currentControllers.length > 0) {
      this.app.canvas.setControllerValues({
        data : currentControllers,
        immediate: true
      });
    }

    if( this._idle ) {

      // onComplete
      const delayedControllerData = [],
            delayedControllers = stageData.controllers.delayed;
      for(let name in delayedControllers) {
        const controller = this.app.controllerGUI.getController(name);
        if(!controller.isfake) {
          delayedControllerData.push({
            name  : name,
            value : delayedControllers[name],
          });
        }
      }

      if(delayedControllerData.length > 0) {
        this.app.canvas.setControllerValues({
          data : delayedControllerData,
          immediate: true
        });
      }

    }


    /*
    if( this.transitionData.size > 0 ) {
      let transitionFactorLinear = elapsed / this.transitionDuration;
      let transitionFactor = Math.pow( transitionFactorLinear, 0.5 );

      if( transitionFactorLinear >= 1 ) {
        transitionFactor = 1;
        transitionFactorLinear = 1;
      }
      const _data = [];
      this.transitionData.forEach((data, name) => {
        if( name.startsWith("_") ) { return; }
        const src = data[0];
        const dst = data[1];
        if( src.isColor ) {
          const v = new Color();
          v.lerpColors( src, dst, transitionFactor );
          _data.push( { name: name, value: v } );
        } else {
          _data.push( { name: name, value: src + ( dst - src ) * transitionFactor } );
        }
      })
      this.app.canvas.setControllerValues({
        data : _data,
        immediate: true
      });

      for( let sliceType in this.canvas.sideCanvasList ) {
        const zoomLevels = this.transitionData.get( `_${sliceType}.zoom` );
        if( zoomLevels ) {
          const zoomLevel = zoomLevels[0] + transitionFactorLinear * ( zoomLevels[1] - zoomLevels[0] );
          this.canvas.sideCanvasList[ sliceType ].zoom( zoomLevel );
        }
      }

      const bgColorData0 = this.transitionData.get("_bgColor0_");
      const bgColorData1 = this.transitionData.get("_bgColor1_");
      this.bgColor0.lerpColors( bgColorData0[0], bgColorData0[1], transitionFactorLinear );
      this.bgColor1.lerpColors( bgColorData1[0], bgColorData1[1], transitionFactorLinear );

      if( transitionFactorLinear === 1 ) {
        this.transitionData.clear();

        if( this.stageData ) {
          this.app.canvas.setControllerValues({
            data : this.stageData.controllers.onCompletion,
            immediate: true
          });
        }
      }
      this.app.canvas.needsUpdate = true;
    }


    if( !this.app.controllerClosed ) { return; }

    // If on mobile, then save battery
    if( this.onMobile ) { return; }

    // rotate camera
    if( [0, 3].includes( this.app.canvas.trackball._state ) ) {
      // user is rotating
      this.autoRotate = false;
      this._rotationDelay = this.autoSwitchPeriod;
      this._switchDelay = this.autoSwitchPeriod;

      if( this._autoSwitch === undefined ) {
        this._autoSwitch = this.autoSwitch;
      }
      this.autoSwitch = false;
    } else {
      if( this.autoRotate ) {
        const camera = this.canvas.mainCamera;
        camera.position.applyAxisAngle( camera.up, - this.cameraRotationSpeed * timeDelta * (2. * Math.PI) );
        camera.updateProjectionMatrix();
      } else {
        this._rotationDelay -= timeDelta;
        if( this._rotationDelay <= 0 ) {
          this.autoRotate = true;
        }
      }
    }

    if( this._autoSwitch !== undefined ) {
      this._switchDelay -= timeDelta;
      if( this._switchDelay <= 0 ) {
        this.autoSwitch = this._autoSwitch;
        this._autoSwitch = undefined;
      }
    }

    this.app.canvas.needsUpdate = true;

    if( this.autoSwitch && elapsed > this.autoSwitchPeriod ) {
      this.switchStage({ duration : this.transitionDuration });
    }
    */

  }

  dispose() {
    this._running = false;
    if( this.canvas ) {

      // transition function
      this.canvas.trackball.noZoom = false;
      this.canvas.trackball.noPan = false;
      this.canvas.trackball.enableZoom();
      // this.canvas.enableSideCanvas();

      // this.canvas.trackball.removeEventListener( "start", this._freezeTrackBall );
      // this.canvas.trackball.domElement.removeEventListener( 'wheel', this._onDemoMouseWheel, false );

      // this.canvas.pixel_ratio[1] = window.devicePixelRatio;

      // this.canvas.resetCanvas();
      // this.canvas.resetSideCanvas();
      this.canvas.handle_resize();
      // this.app.controllerGUI.openAnimated();

      this.canvas = null;
      this._initialized = false;

    }

    const index = this.app.transitions.indexOf( this );
    if (index > -1) { // only splice array when item is found
      this.app.transitions.splice(index, 1); // 2nd parameter means remove one item only
    }

  }

  _freezeTrackBall = () => {
    const trackball = this.app.canvas.trackball;
    if( trackball._isZooming || trackball._isPanning ) { return; }
    trackball.removeEventListener( "end", this._freezeTrackBall );
    trackball.disableZoom();
    trackball.noZoom = true;
    trackball.noPan = true;
  }

  _onDemoMouseWheel = ( event ) => {

  }


}


export { StageTransition };
