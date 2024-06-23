import { Color, Clock } from 'three';
import { DemoBackground } from './DynamicBackground.js'

function mobileCheck () {
  let check = false;
  try {
    (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
  } catch (e) {}
  return check;
};

const DEMO_STAGES = {

  "DEFAULT" : {
    "background" : [ new Color().set( "#ffa500" ), new Color().set( "#f5eee6" ) ],
    "sideCanvas" : {
      "coronal" : { zoom : 1 }, "sagittal" : { zoom : 1 }, "axial" : { zoom : 1 },
    },
    "controllers" : {"immediate":[{"name":"Display Coordinates","value":false},{"name":"Slice Mode","value":"canonical"},{"name":"Voxel Type","value":"none"},{"name":"Voxel Display","value":"normal"},{"name":"Voxel Label","value":""},{"name":"ISO Surface","value":false},{"name":"Surface Type","value":"pial"},{"name":"Clipping Plane","value":"disabled"},{"name":"Left Hemisphere","value":"normal"},{"name":"Right Hemisphere","value":"normal"},{"name":"Surface Color","value":"none"},{"name":"Visibility","value":"hide inactives"},{"name":"Electrode Shape","value":"prototype+sphere"},{"name":"Outlines","value":"auto"},{"name":"Translucent","value":"contact-only"},{"name":"Text Visibility","value":false},{"name":"Visibility (all surfaces)","value":"visible"},{"name":"Visibility (all volumes)","value":"visible"},{"name":"Display Data","value":"[None]"},{"name":"Display Range","value":""},{"name":"Threshold Data","value":"[None]"},{"name":"Threshold Range","value":""},{"name":"Threshold Method","value":"|v| >= T1"},{"name":"Additional Data","value":"[None]"},{"name":"Show Legend","value":false},{"name":"Show Time","value":false},{"name":"Highlight Box","value":false},{"name":"Info Text","value":false}],"transition":[{"name":"Slice Brightness","value":0},{"name":"Slice Contrast","value":0},{"name":"Crosshair Gap","value":0},{"name":"Coronal (P - A)","value":-100},{"name":"Axial (I - S)","value":-100},{"name":"Sagittal (L - R)","value":-100},{"name":"Frustum Near","value":5},{"name":"Frustum Far","value":10},{"name":"Voxel Opacity","value":0},{"name":"Voxel Min","value":-100000},{"name":"Voxel Max","value":100000},{"name":"Left Opacity","value":1},{"name":"Right Opacity","value":1},{"name":"Left Mesh Clipping","value":1},{"name":"Right Mesh Clipping","value":1},{"name":"Blend Factor","value":1},{"name":"Sigma","value":1},{"name":"Decay","value":0.6},{"name":"Range Limit","value":5},{"name":"Text Scale","value":1.5},{"name":"Inactive Color","value":"#c2c2c2"}],"onCompletion":[{"name":"Overlay Coronal","value":false},{"name":"Overlay Axial","value":false},{"name":"Overlay Sagittal","value":false},{"name":"Show Panels","value":false}]},
  },

  "ELEC_COLOR" : {
    "background" : [ new Color().set( "#FF4500" ), new Color().set( "#f5eee6" ) ],
    "sideCanvas" : {
      "coronal" : { zoom : 1 }, "sagittal" : { zoom : 1 }, "axial" : { zoom : 1 },
    },
    "controllers" : {"immediate":[{"name":"Display Coordinates","value":false},{"name":"Show Panels","value":true},{"name":"Slice Mode","value":"canonical"},{"name":"Overlay Coronal","value":true},{"name":"Overlay Axial","value":true},{"name":"Overlay Sagittal","value":true},{"name":"Voxel Type","value":"none"},{"name":"Voxel Display","value":"anat. slices"},{"name":"Voxel Label","value":"1035,3035,1034,3034,1001,1030,3030,2015,2009"},{"name":"ISO Surface","value":false},{"name":"Surface Type","value":"pial"},{"name":"Clipping Plane","value":"disabled"},{"name":"Left Hemisphere","value":"mesh clipping x 0.3"},{"name":"Right Hemisphere","value":"mesh clipping x 0.3"},{"name":"Surface Color","value":"none"},{"name":"Electrode Shape","value":"prototype+sphere"},{"name":"Outlines","value":"auto"},{"name":"Translucent","value":"contact+outline"},{"name":"Text Visibility","value":false},{"name":"Visibility (all surfaces)","value":"visible"},{"name":"Visibility (all volumes)","value":"visible"},{"name":"Display Data","value":"LabelPrefix"},{"name":"Display Range","value":""},{"name":"Threshold Data","value":"[None]"},{"name":"Threshold Range","value":""},{"name":"Threshold Method","value":"|v| >= T1"},{"name":"Additional Data","value":"[None]"},{"name":"Show Legend","value":false},{"name":"Show Time","value":false},{"name":"Highlight Box","value":false},{"name":"Info Text","value":false}],"transition":[{"name":"Slice Brightness","value":0},{"name":"Slice Contrast","value":0},{"name":"Crosshair Gap","value":0},{"name":"Coronal (P - A)","value":0},{"name":"Axial (I - S)","value":0},{"name":"Sagittal (L - R)","value":0},{"name":"Frustum Near","value":5},{"name":"Frustum Far","value":10},{"name":"Voxel Opacity","value":1},{"name":"Voxel Min","value":-100000},{"name":"Voxel Max","value":100000},{"name":"Left Opacity","value":0.4},{"name":"Right Opacity","value":0.4},{"name":"Left Mesh Clipping","value":0.2},{"name":"Right Mesh Clipping","value":0.2},{"name":"Blend Factor","value":1},{"name":"Sigma","value":1},{"name":"Decay","value":0.6},{"name":"Range Limit","value":5},{"name":"Text Scale","value":1.5},{"name":"Inactive Color","value":"#c2c2c2"}],"onCompletion":[{"name":"Visibility","value":"all visible"}]}
  },

  "ANIMATION" : {
    "background" : [ new Color().set( "#A52A2A" ), new Color().set( "#f5eee6" ) ],
    "sideCanvas" : {
      "coronal" : { zoom : 3 }, "sagittal" : { zoom : 3.5 }, "axial" : { zoom : 2.5 },
    },
    "controllers" : {"immediate":[{"name":"Display Coordinates","value":false},{"name":"Show Panels","value":true},{"name":"Slice Mode","value":"canonical"},{"name":"Overlay Coronal","value":false},{"name":"Overlay Axial","value":false},{"name":"Overlay Sagittal","value":false},{"name":"Voxel Type","value":"none"},{"name":"Voxel Display","value":"normal"},{"name":"Voxel Label","value":""},{"name":"ISO Surface","value":false},{"name":"Surface Type","value":"pial"},{"name":"Clipping Plane","value":"disabled"},{"name":"Clipping Plane","value":"disabled"},{"name":"Left Hemisphere","value":"mesh clipping x 0.3"},{"name":"Right Hemisphere","value":"mesh clipping x 0.3"},{"name":"Surface Color","value":"none"},{"name":"Visibility","value":"all visible"},{"name":"Electrode Shape","value":"prototype+sphere"},{"name":"Outlines","value":"auto"},{"name":"Translucent","value":"contact+outline"},{"name":"Text Visibility","value":false},{"name":"Visibility (all surfaces)","value":"visible"},{"name":"Visibility (all volumes)","value":"visible"},{"name":"Display Data","value":"Response"},{"name":"Threshold Data","value":"[None]"},{"name":"Threshold Range","value":""},{"name":"Threshold Method","value":"|v| >= T1"},{"name":"Additional Data","value":"[None]"},{"name":"Show Legend","value":true},{"name":"Show Time","value":true},{"name":"Highlight Box","value":true},{"name":"Info Text","value":true}],"transition":[{"name":"Slice Brightness","value":0},{"name":"Slice Contrast","value":0},{"name":"Crosshair Gap","value":15},{"name":"Coronal (P - A)","value":3.4456},{"name":"Axial (I - S)","value":-15.9097},{"name":"Sagittal (L - R)","value":-52.5983},{"name":"Frustum Near","value":5},{"name":"Frustum Far","value":10},{"name":"Voxel Opacity","value":0},{"name":"Voxel Min","value":-100000},{"name":"Voxel Max","value":100000},{"name":"Left Opacity","value":0.4},{"name":"Right Opacity","value":0.4},{"name":"Left Mesh Clipping","value":0.2},{"name":"Right Mesh Clipping","value":0.2},{"name":"Blend Factor","value":1},{"name":"Sigma","value":1},{"name":"Decay","value":0.6},{"name":"Range Limit","value":5},{"name":"Text Scale","value":1.5},{"name":"Inactive Color","value":"#c2c2c2"},{"name":"Speed","value":1}],"onCompletion":[{"name":"Play/Pause","value":true},{"name":"Display Range","value":"-5,5"}]}
  },

  "ATLAS" : {
    "background" : [ new Color().set( "#7D26CD" ), new Color().set( "#f5eee6" ) ],
    "sideCanvas" : {
      "coronal" : { zoom : 3 }, "sagittal" : { zoom : 3.5 }, "axial" : { zoom : 2.5 },
    },
    "controllers": {"immediate":[{"name":"Display Coordinates","value":false},{"name":"Show Panels","value":true},{"name":"Slice Mode","value":"canonical"},{"name":"Voxel Type","value":"wmparc"},{"name":"Voxel Display","value":"anat. slices"},{"name":"Voxel Label","value":"1035,3035,1034,3034,1001,1030,3030,2015,2009"},{"name":"Surface Type","value":"pial"},{"name":"Clipping Plane","value":"disabled"},{"name":"Left Hemisphere","value":"mesh clipping x 0.1"},{"name":"Right Hemisphere","value":"mesh clipping x 0.1"},{"name":"Surface Color","value":"none"},{"name":"Visibility","value":"all visible"},{"name":"Electrode Shape","value":"prototype+sphere"},{"name":"Outlines","value":"off"},{"name":"Translucent","value":"contact+outline"},{"name":"Text Visibility","value":false},{"name":"Visibility (all surfaces)","value":"visible"},{"name":"Visibility (all volumes)","value":"visible"},{"name":"Display Data","value":"FSLabel"},{"name":"Threshold Data","value":"[None]"},{"name":"Threshold Range","value":""},{"name":"Threshold Method","value":"|v| >= T1"},{"name":"Additional Data","value":"[None]"},{"name":"Show Legend","value":false},{"name":"Show Time","value":false},{"name":"Highlight Box","value":true},{"name":"Info Text","value":true},{"name":"Play/Pause","value":false}],"transition":[{"name":"Slice Brightness","value":0},{"name":"Slice Contrast","value":0},{"name":"Crosshair Gap","value":15},{"name":"Coronal (P - A)","value":5.5},{"name":"Axial (I - S)","value":-25.3},{"name":"Sagittal (L - R)","value":-58.6},{"name":"Frustum Near","value":5},{"name":"Frustum Far","value":10},{"name":"Voxel Min","value":-100000},{"name":"Voxel Max","value":100000},{"name":"Left Opacity","value":0.4},{"name":"Right Opacity","value":0.4},{"name":"Left Mesh Clipping","value":0.1},{"name":"Right Mesh Clipping","value":0.11},{"name":"Blend Factor","value":1},{"name":"Sigma","value":1},{"name":"Decay","value":0.6},{"name":"Range Limit","value":5},{"name":"Text Scale","value":1.5},{"name":"Inactive Color","value":"#c2c2c2"}],"onCompletion":[{"name":"Overlay Coronal","value":false},{"name":"Overlay Axial","value":false},{"name":"Overlay Sagittal","value":false}],"onCompletion":[{"name":"Display Range","value":"-5,5"},{"name":"ISO Surface","value":true},{"name":"Voxel Display","value":"normal"},{"name":"Voxel Opacity","value":0.249}]}
  },

  "ANAT_SLICE" : {
    "background" : [ new Color().set( "#1874CD" ), new Color().set( "#f5eee6" ) ],
    "controllers": {"immediate":[{"name":"Display Coordinates","value":false},{"name":"Show Panels","value":true},{"name":"Slice Mode","value":"canonical"},{"name":"Overlay Coronal","value":true},{"name":"Voxel Type","value":"wmparc"},{"name":"Voxel Display","value":"anat. slices"},{"name":"Voxel Label","value":"1035,3035,1034,3034,1001,1030,3030,2015,2009"},{"name":"ISO Surface","value":false},{"name":"Surface Type","value":"pial"},{"name":"Clipping Plane","value":"coronal"},{"name":"Left Hemisphere","value":"normal"},{"name":"Right Hemisphere","value":"normal"},{"name":"Surface Color","value":"none"},{"name":"Visibility","value":"all visible"},{"name":"Electrode Shape","value":"prototype+sphere"},{"name":"Outlines","value":"auto"},{"name":"Translucent","value":"contact+outline"},{"name":"Text Visibility","value":false},{"name":"Visibility (all surfaces)","value":"visible"},{"name":"Visibility (all volumes)","value":"visible"},{"name":"Display Data","value":"Response"},{"name":"Display Range","value":"-5,5"},{"name":"Threshold Data","value":"[None]"},{"name":"Threshold Range","value":""},{"name":"Threshold Method","value":"|v| >= T1"},{"name":"Additional Data","value":"[None]"},{"name":"Show Legend","value":false},{"name":"Show Time","value":false},{"name":"Highlight Box","value":true},{"name":"Info Text","value":true},{"name":"Overlay Axial","value":false},{"name":"Overlay Sagittal","value":true}],"transition":[{"name":"Slice Brightness","value":0},{"name":"Slice Contrast","value":0},{"name":"Crosshair Gap","value":15},{"name":"Coronal (P - A)","value":3.4456},{"name":"Axial (I - S)","value":-15.9097},{"name":"Sagittal (L - R)","value":-52.5983},{"name":"Frustum Near","value":5},{"name":"Frustum Far","value":10},{"name":"Voxel Min","value":-100000},{"name":"Voxel Max","value":100000},{"name":"Left Opacity","value":1},{"name":"Right Opacity","value":1},{"name":"Left Mesh Clipping","value":1},{"name":"Right Mesh Clipping","value":1},{"name":"Blend Factor","value":1},{"name":"Sigma","value":1},{"name":"Decay","value":0.6},{"name":"Range Limit","value":5},{"name":"Text Scale","value":1.5},{"name":"Voxel Opacity","value":1},{"name":"Inactive Color","value":"#c2c2c2"}],"onCompletion":[{"name":"Time","value":1.02}]}
  },

  "CLIPPING" : {
    "background" : [ new Color().set( "#006400" ), new Color().set( "#f5eee6" ) ],
    "controllers": {"immediate":[{"name":"Display Coordinates","value":true},{"name":"Show Panels","value":true},{"name":"Slice Mode","value":"line-of-sight"},{"name":"Overlay Coronal","value":true},{"name":"Overlay Axial","value":false},{"name":"Overlay Sagittal","value":true},{"name":"Voxel Type","value":"wmparc"},{"name":"Voxel Display","value":"normal"},{"name":"Voxel Label","value":"1035,3035,1034,3034,1001,1030,3030,2015,2009"},{"name":"ISO Surface","value":true},{"name":"Surface Type","value":"pial"},{"name":"Clipping Plane","value":"coronal"},{"name":"Left Hemisphere","value":"normal"},{"name":"Right Hemisphere","value":"normal"},{"name":"Surface Color","value":"none"},{"name":"Visibility","value":"all visible"},{"name":"Electrode Shape","value":"prototype+sphere"},{"name":"Outlines","value":"auto"},{"name":"Translucent","value":"contact+outline"},{"name":"Text Visibility","value":false},{"name":"Visibility (all surfaces)","value":"visible"},{"name":"Visibility (all volumes)","value":"visible"},{"name":"Display Data","value":"Response"},{"name":"Display Range","value":"-5,5"},{"name":"Threshold Data","value":"[None]"},{"name":"Threshold Range","value":""},{"name":"Threshold Method","value":"|v| >= T1"},{"name":"Additional Data","value":"[None]"},{"name":"Show Legend","value":false},{"name":"Show Time","value":false},{"name":"Highlight Box","value":false},{"name":"Info Text","value":false}],"transition":[{"name":"Slice Brightness","value":0},{"name":"Slice Contrast","value":0},{"name":"Crosshair Gap","value":15},{"name":"Coronal (P - A)","value":3.4456},{"name":"Axial (I - S)","value":-15.9097},{"name":"Sagittal (L - R)","value":-52.5983},{"name":"Frustum Near","value":5},{"name":"Frustum Far","value":10},{"name":"Voxel Opacity","value":0.49},{"name":"Voxel Min","value":-100000},{"name":"Voxel Max","value":100000},{"name":"Left Opacity","value":1},{"name":"Right Opacity","value":1},{"name":"Left Mesh Clipping","value":1},{"name":"Right Mesh Clipping","value":1},{"name":"Blend Factor","value":1},{"name":"Sigma","value":1},{"name":"Decay","value":0.6},{"name":"Range Limit","value":5},{"name":"Text Scale","value":1.5},{"name":"Inactive Color","value":"#c2c2c2"}],"onCompletion":[]}

  }

};

class DemoStage {

  get enabled () { return this.clock.running };

  constructor ( app ) {
    this.app = app;
    this.canvas = null;

    this.clock = new Clock( false );
    this.currentStage = undefined;

    // whether this.switchStage( name ) `name` needs to be valid
    this.explicit = false;

    this.autoSwitch = true;
    this.autoSwitchPeriod = 10;

    this._switchDelay = this.autoSwitchPeriod;
    this._rotationDelay = this._switchDelay / 2;
    this.autoRotate = true;
    this.cameraRotationSpeed = 0.1; // full rotation takes 1 / cameraRotationSpeed second

    this.transitionDuration = 4;
    this.transitionData = new Map();

    //
    this.background = new DemoBackground({
      palettes : [0xffffff, 0xffffff]
    })
    this.bgColor0 = this.background.scene.background;
    this.bgColor1 = this.background.object.material.color;

    this.onMobile = mobileCheck();

  }

  getElapsedTime () {
    if ( !this.clock.running ) { return 0; }
    return this.clock.getElapsedTime();
  }

  _sanitizeName( name ) {
    if( typeof name !== "string" || !DEMO_STAGES[ name ] ) {
      if( this.explicit ) { return; }
      const stageKeys = Object.keys( DEMO_STAGES );
      if( this.currentStage && stageKeys.indexOf( this.currentStage ) >= 0 ) {
        let idx = stageKeys.indexOf( this.currentStage ) + 1;
        if( idx >= stageKeys.length ) {
          idx = 0;
        }
        name = stageKeys[ idx ];
      } else {
        name = stageKeys[ Math.floor( Math.random() * stageKeys.length ) ];
      }
    }
    if( !name || !DEMO_STAGES[ name ] ) { return; }
    return name;
  }


  async switchStage({ name, duration = 1 } = {}) {
    name = this._sanitizeName( name );
    if( !name ) { return; }
    const stageData = DEMO_STAGES[ name ];
    this.stageData = stageData;
    const controllerData = stageData.controllers,
          backgroundData = DEMO_STAGES[ name ].background;

    this.reset();
    this.transitionData.clear();

    this.transitionData.set("_bgColor0_", [ this.bgColor0.clone(), backgroundData[0] ] );
    this.transitionData.set("_bgColor1_", [ this.bgColor1.clone(), backgroundData[1] ] );

    if( this.app.controllerGUI ) {

      // Collect transition Data
      controllerData.transition.forEach(item => {
        const c = this.app.controllerGUI.getController( item.name );
        if( c.isfake ) { return; }
        const v = c.getValue();
        if( v == item.value ) { return; }
        if( typeof v === "number" ) {
          this.transitionData.set( item.name, [ v, item.value ]);
        } else {
          try {
            const srcColor = new Color().set( v.startsWith("#") ? v : `#${ v }` );
            const dstColor = new Color().set( item.value.startsWith("#") ? item.value : `#${ item.value }` );
            if( !isNaN( srcColor.getHex() ) && !isNaN( dstColor.getHex() )) {
              this.transitionData.set( item.name, [ srcColor, dstColor ]);
            }
          } catch (e) {}
        }
      });

      if( stageData.sideCanvas ) {
        for( let sliceType in stageData.sideCanvas ) {
          const sideData = stageData.sideCanvas[ sliceType ];
          const zoomLevel = this.canvas.sideCanvasList[ sliceType ].zoomLevel;
          this.transitionData.set( `_${sliceType}.zoom`, [ zoomLevel, sideData.zoom ]);
        }
      }

      this.app.canvas.setControllerValues({
        data : controllerData.immediate,
        immediate: true
      });
    }
    this.transitionDuration = duration;

    this.currentStage = name;
    this.start();
  }

  update() {
    if( !this.clock.running ) { return; }
    const timeDelta = this.clock.getDelta();
    const elapsed = this.getElapsedTime();

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

  }

  init() {
    if( this._initialized ) { return; }
    if( !this.app.canvas ) { return; }
    this._initialized = true;

    this.reset();
    this.canvas = this.app.canvas;
    this.canvas.set_state( "info_text_position", "right" );
    this.canvas.disableSideCanvas();
    this.app.controllerGUI.close();

    try {
      window.threeBrain.demoApp = this.app;

      const object = this.canvas.scene.getObjectByName(
        "mesh_electrode_PAV038, 77 - LU5");

      if( object ) {
        this.canvas.focusObject( object );
      }

      this.canvas.pixel_ratio[1] = 1;
      this.canvas.sideCanvasList.coronal.renderer.setPixelRatio(1);
      this.canvas.sideCanvasList.axial.renderer.setPixelRatio(1);
      this.canvas.sideCanvasList.sagittal.renderer.setPixelRatio(1);
    } catch (e) {}

    // Add background
    this.bgColor0.set( 0x000000 );
    this.bgColor1.set( 0x000000 );
    this.canvas.scene.background = this.background;

    // transition function
    this.canvas.resetCanvas();
    this.canvas.trackball.noZoom = false;
    this.canvas.trackball.noPan = false;
    this.canvas.trackball._panStart.set(0.5, 0.5);
    this.canvas.trackball._panEnd.set( 0.72, 0.44);
    this.canvas.trackball._zoomStart.y = 0.0;
    this.canvas.trackball._zoomEnd.y = 10.0;

    this.canvas.trackball.addEventListener( "start", this._freezeTrackBall );
    this.canvas.trackball.domElement.addEventListener( 'wheel', this._onDemoMouseWheel, false );
    this.canvas.trackball.panCamera();
    this.canvas.trackball.zoomCamera();

    this.canvas.sideCanvasList.axial.$el.style.width = "160px";
    this.canvas.sideCanvasList.axial.$el.style.height = "160px";
    this.canvas.sideCanvasList.axial.$el.style.left = "0";
    this.canvas.sideCanvasList.axial.$el.style.top = "0";

    this.canvas.sideCanvasList.sagittal.$el.style.width = "160px";
    this.canvas.sideCanvasList.sagittal.$el.style.height = "160px";
    this.canvas.sideCanvasList.sagittal.$el.style.left = "160px";
    this.canvas.sideCanvasList.sagittal.$el.style.top = "0";

    this.canvas.sideCanvasList.coronal.$el.style.width = "160px";
    this.canvas.sideCanvasList.coronal.$el.style.height = "160px";
    this.canvas.sideCanvasList.coronal.$el.style.left = "320px";
    this.canvas.sideCanvasList.coronal.$el.style.top = "0";

    this.switchStage({ name : "DEFAULT" });
  }

  dispose() {
    if( !this._initialized ) { return; }
    if( !this.canvas ) { return; }

    this.reset();
    this.canvas.set_state( "info_text_position", undefined );

    this.canvas.scene.background = new Color();

    // transition function
    this.canvas.trackball.noZoom = false;
    this.canvas.trackball.noPan = false;
    this.canvas.trackball.enableZoom();
    this.canvas.enableSideCanvas();

    this.canvas.trackball.removeEventListener( "start", this._freezeTrackBall );
    this.canvas.trackball.domElement.removeEventListener( 'wheel', this._onDemoMouseWheel, false );

    this.canvas.pixel_ratio[1] = window.devicePixelRatio;

    this.canvas.resetCanvas();
    this.canvas.resetSideCanvas();
    this.canvas.handle_resize();
    this.app.controllerGUI.openAnimated();

    this._initialized = false;
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

  reset() {
    this.clock.stop();
  }

  start() {
    this.clock.start();
  }

}


export { DemoStage };

