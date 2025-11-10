import { AbstractThreeBrainObject, ElasticGeometry, getThreeBrainInstance } from './abstract.js';
import {
  MeshBasicMaterial, MeshPhysicalMaterial, SpriteMaterial, InterpolateDiscrete,
  BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute,
  Mesh, Vector2, Vector3, Matrix4, Color, ArrowHelper,
  ColorKeyframeTrack, NumberKeyframeTrack, AnimationClip, AnimationMixer,
  SphereGeometry, InstancedMesh, DoubleSide, FrontSide, AlwaysDepth
} from 'three';
// import { addColorCoat } from '../shaders/addColorCoat.js';
import {
  ElectrodeBasicMaterial, ElectrodePhysicalMaterial
} from '../shaders/ElectrodeMaterial.js';
import { Sprite2, TextTexture } from '../ext/text_sprite.js';
import { asArray } from '../utility/asArray.js';
import { testColorString } from '../utility/color.js';
import { pointPositionByDistances, registerRigidPoints, registerRigidPoints2 } from '../Math/svd.js';
import { CONSTANTS } from '../core/constants.js';


const MATERIAL_PARAMS_BASIC = {
  'transparent'   : true,
  'reflectivity'  : 0,
  'color'         : 0xffffff,
  'vertexColors'  : false,
  'side'          : FrontSide,
};

function guessHemisphere(g) {
  // guess hemisphere from freesurfer label
  if( !g.hemisphere || !['left', 'right'].includes( g.hemisphere ) ) {

    g.hemisphere = null;

    let fsLabel = g.anatomical_label;
    if( typeof fsLabel === "string" ) {
      fsLabel = fsLabel.toLowerCase();
      if(
        fslabel.startsWith("ctx-lh") ||
        fslabel.startsWith("ctx_lh") ||
        fslabel.startsWith("left")
      ) {
        g.hemisphere = "left";
      } else if (
        fslabel.startsWith("ctx-rh") ||
        fslabel.startsWith("ctx_rh") ||
        fslabel.startsWith("right")
      ) {
        g.hemisphere = "right";
      }
    }

  }
  return g.hemisphere;
}

class Electrode extends AbstractThreeBrainObject {

  _registerAnimationKeyFrames( keyframes ) {
    // only call once during initialization (maybe called later)
    if( !this.animationKeyFrames ) {
      this.animationKeyFrames = {};
    }
    if( keyframes === undefined ) {
      keyframes = this._params.keyframes;
    }
    for( let frameName in keyframes ) {
      const kf = keyframes[ frameName ];
      const times = asArray( kf.time );
      const values = asArray( kf.value );

      if( values.length > 0 ) {
        if( times.length === 0 ) {
          times.push( 0 );
        }
        const timeValuePairs = times.map((t, i) => {
          return( [ t , values[ i ] ] );
        })
        timeValuePairs.sort( (e1, e2) => { return( e1[0] - e2[0] ) });
        this.animationKeyFrames[ frameName ] = timeValuePairs;
      }
    }

    return Object.keys( this.animationKeyFrames );
  }

  get hasAnimationTracks () {
    for( let k in this.animationKeyFrames ) {
      return true;
    }
    return false;
  }

  get label() {
    if( typeof this.state.customLabel === "string" ) {
      return this.state.customLabel;
    }
    const nChannels = this.numbers.length;
    if( nChannels === 0 ) { return ""; }
    if( nChannels === 1 ) {
      return `${ this.numbers[0] }`;
    }
    return `${ this.numbers[0] } - ${ this.numbers[ nChannels - 1 ] }`;
  }

  set label( name ) {
    if( !name ) {
      this.state.customLabel = undefined;
    } else {
      this.state.customLabel = `${name}`;
    }
    // this.updateTextSprite();
    // console.debug(`Setting label: ${this._text_label}`);
    this._textMap.draw_text( this.label );
  }

  setLabelScale ( v ) {
    if( v && v > 0 ) {
      this._textMap.updateScale( v * (this._geometry.parameters.size || 1) );
    }
  }

  setLabelVisible ( visible ) {
    if( visible ) {
      this._textSprite.visible = true;
    } else {
      this._textSprite.visible = false;
    }
  }

  getSummary({ reset_fs_index = false, enabled_only = true } = {}) {

    let localization_instance = this.object.userData.localization_instance;

    let enabled = this._enabled !== false;
    if(
      localization_instance &&
      typeof localization_instance === "object" &&
      localization_instance.isLocElectrode === true
    ) {
      if( enabled && typeof( localization_instance.enabled ) === "function" ){
        enabled = localization_instance.enabled();
      }
    } else {
      localization_instance = {};
    }

    // return nothing if electrode is disabled
    if( enabled_only && !enabled ) {
      return;
    }

    // prepare data
    const subject_code = this.subject_code,
          subject_data  = this._canvas.shared_data.get( subject_code ),
          tkrRAS_Scanner = subject_data.matrices.tkrRAS_Scanner,
          xfm = subject_data.matrices.xfm,
          Torig_inv = subject_data.matrices.Torig.clone().invert(),
          _regexp = new RegExp(`^${subject_code}, ([0-9]+) \\- (.*)$`),
          parsed = _regexp.exec( this.name ),
          tkrRASOrig = new Vector3(),
          pos = new Vector3();  // pos is reused

    let electrode_number = localization_instance.Electrode || "",
        tentative_label = "",
        localization_order = localization_instance.localization_order;
    if( parsed && parsed.length === 3 ) {
      if( electrode_number === "" ) {
        electrode_number = parsed[1];
      }
      tentative_label = parsed[2] || `NoLabel${electrode_number}`;
      localization_order = localization_order || parseInt( parsed[1] );
    } else {
      tentative_label = `NoLabel${electrode_number}`;
    }

    // initialize summary data with Column `Subject`
    const summary = {
      Subject: this.subject_code,
      Electrode: electrode_number
    };

    // get position in tkrRAS, set `Coord_xyz`
    tkrRASOrig.fromArray( this._params.position );
    if( localization_instance.brainShiftEnabled ) {
      pos.copy( localization_instance.pialPosition );
    } else {
      pos.copy( tkrRASOrig );
    }
    summary.Coord_x = pos.x;
    summary.Coord_y = pos.y;
    summary.Coord_z = pos.z;

    if( enabled_only && pos.length() === 0 ) {
      return;
    }

    // Clinical `Label`
    summary.Label = localization_instance.Label || tentative_label;

    // Localization order (`LocalizationOrder`)
    summary.LocalizationOrder = localization_order;

    // get FreeSurfer Label `FSIndex` + `FSLabel`
    if( reset_fs_index ) {
      localization_instance[ "manual" ] = undefined;
    }
    try { localization_instance.computeFreeSurferLabel() } catch (e) {}
    const atlasLabels = localization_instance.atlasLabels;

    if( atlasLabels ) {
      let seekOrder = ["manual", "aparc.a2009s+aseg", "aparc+aseg", "aparc.DKTatlas+aseg", "aseg"];
      for( let ii in seekOrder ) {
        const atlasType = seekOrder[ ii ];
        const atlasLabel = atlasLabels[ atlasType ];
        if( typeof atlasLabel === "object" ) {
          if( atlasType === "manual" || atlasType === "aseg" || atlasLabel.index > 0 ) {
            summary.FSIndex = atlasLabel.index;
            summary.FSLabel = atlasLabel.label;
            break;
          }
        }
      }

      for( let ii = 1; ii < seekOrder.length; ii++ ) {
        const atlasType = seekOrder[ ii ];
        const atlasLabel = atlasLabels[ atlasType ];
        const atlasTypeReformat = atlasType.replaceAll(/[^a-zA-Z0-9]/g, "_");
        summary[ `FSIndex_${ atlasTypeReformat }` ] = atlasLabel.index;
        summary[ `FSLabel_${ atlasTypeReformat }` ] = atlasLabel.label;
      }
    }

    //  T1 MRI scanner RAS (T1RAS)
    pos.applyMatrix4( tkrRAS_Scanner );
    summary.T1_x = pos.x;
    summary.T1_y = pos.y;
    summary.T1_z = pos.z;

    //  MNI305_x MNI305_y MNI305_z
    pos.applyMatrix4( xfm );
    summary.MNI305_x = pos.x;
    summary.MNI305_y = pos.y;
    summary.MNI305_z = pos.z;

    // `SurfaceElectrode` `SurfaceType` `Radius` `VertexNumber` `Hemisphere`
    const isSurfaceElectrode = localization_instance.brainShiftEnabled ?? this._params.is_surface_electrode;
    summary.SurfaceElectrode = isSurfaceElectrode ? 'TRUE' : 'FALSE';
    summary.SurfaceType = this._params.surface_type || "pial";
    summary.Radius =  this._params.radius;
    summary.VertexNumber = this._params.vertex_number;     // vertex_number is already changed if std.141 is used
    summary.Hemisphere = this._params.hemisphere;

    // Original tkrRAS
    summary.OrigCoord_x = tkrRASOrig.x;
    summary.OrigCoord_y = tkrRASOrig.y;
    summary.OrigCoord_z = tkrRASOrig.z;

    // xyz on sphere.reg
    if( localization_instance.brainShiftEnabled ) {
      summary.DistanceShifted = localization_instance.distanceToShifted;
      summary.DistanceToPial = localization_instance.distanceFromShiftedToPial;
      summary.Sphere_x = localization_instance.spherePosition.x;
      summary.Sphere_y = localization_instance.spherePosition.y;
      summary.Sphere_z = localization_instance.spherePosition.z;
    } else {
      summary.DistanceShifted = 0;
      summary.DistanceToPial = localization_instance.distanceFromShiftedToPial ?? 0;
      if( this._params.sphere_position ) {
        summary.Sphere_x = this._params.sphere_position[0];
        summary.Sphere_y = this._params.sphere_position[1];
        summary.Sphere_z = this._params.sphere_position[2];
      } else {
        summary.Sphere_x = 0;
        summary.Sphere_y = 0;
        summary.Sphere_z = 0;
      }
    }

    // CustomizedInformation `Notes`
    summary.Notes = this._params.custom_info || '';

    // get MRI VoxCRS = inv(Torig)*[tkrR tkrA tkrS 1]'
    pos.fromArray( this._params.position ).applyMatrix4( Torig_inv );
    summary.Voxel_i = Math.round( pos.x );
    summary.Voxel_j = Math.round( pos.y );
    summary.Voxel_k = Math.round( pos.z );

    return( summary );
  }

  dispose(){
    super.dispose();
    try {
      this._canvas.removeClickable( this.name );
      this._canvas.removeClickable( this.name+"__instanced" );
      this.object.removeFromParent();

      if( typeof this.protoName === "string" ) {
        const l = this._canvas.electrodePrototypes.get( this.subject_code );
        if(l && typeof l === "object")  {
          delete l[ this.protoName ];
        }
      }
    } catch (e) {}

    try {
      this._textSprite.removeFromParent();
      this._textSprite.material.map.dispose();
      this._textSprite.material.dispose();
      this._textSprite.geometry.dispose();
      if( this._dataTexture ) {
        this._dataTexture.dispose();
      }
      if( this._textMap ) {
        this._textMap.dispose();
      }
    } catch (e) {}

    this.object.material.dispose();
    this.object.geometry.dispose();

    try {
      this._canvas.$el.removeEventListener(
        "viewerApp.electrodes.mapToTemplate",
        this.mapToTemplate
      )
      this._canvas.$el.removeEventListener(
        "viewerApp.electrodes.updateData",
        this.updateElectrodeData
      )
      this._canvas.$el.removeEventListener(
        "viewerApp.electrodes.colorMapChanged",
        this.onColorMapUpdated
      )
    } catch (e) {}

    if( this.instancedObjects ) {
      this.instancedObjects.dispose();
      delete this.instancedObjects.userData.instance;
    }
  }



  // fat arrow to make sure listeners are correct for child classes
  mapToTemplate = ( event ) => {
    const mapConfig = event.detail;
    const subjectCode = mapConfig.subject,
          surfaceMapping = mapConfig.surface,
          surfaceType = mapConfig.surfaceType,
          volumeMapping = mapConfig.volume;

    if( surfaceMapping === "reset" || volumeMapping === "reset" ) {
      this.useMatrix4( this.transforms.model2tkr );
      this.state.templateMappingActive = false;
      this.state.templateSubject = this.subject_code;
      this.state.templateMappingMethod = "Affine";
      this.state.templateCoordSys = "MNI305";

      this.updatePrototypeModel({ coordinateSys : "native" });
      return;
    }
    // check if this is a surface
    let isSurfaceElectrode = false;
    if( this.object.userData.localization_instance ) {
      if( this.object.userData.localization_instance.brainShiftEnabled ) {
        isSurfaceElectrode = true;
      }
    } else if(this._params.is_surface_electrode) {
      isSurfaceElectrode = true;
    }

    // determine the mapping type
    let mappingType = volumeMapping;
    if( isSurfaceElectrode ) {
      mappingType = surfaceMapping;
    }

    switch (mappingType) {
      case "sphere.reg": {
        // Snap to surfaces
        this.mapToTemplateSurface({ subjectCode : subjectCode, surfaceType : surfaceType });
        this.updatePrototypeModel({ coordinateSys : "native" });
        break;
      }

      case "mni305.affine+fix.target": {
        this.mapToTemplateAffine({ subjectCode : subjectCode });
        this.updatePrototypeModel({ coordinateSys : "mni305FixTarget", rigid : true });
        break;
      }

      case "mni305": {
        this.mapToTemplateAffine({ subjectCode : subjectCode });
        this.updatePrototypeModel({ coordinateSys : "mni305User" });
        break;
      }

      default:
        this.mapToTemplateAffine({ subjectCode : subjectCode });
        this.updatePrototypeModel({ coordinateSys : "native" });
    }

  }

  updateElectrodeData = ( event ) => {

    const keyframes = event.detail;
    if( !keyframes || typeof keyframes !== "object" ) { return; }

    const subjectCode = this.subject_code;
    const subjectKeyframes = keyframes[ subjectCode ];
    if( !subjectKeyframes ) { return; }

    if( !this.animationKeyFrames ) {
      this.animationKeyFrames = {};
    }

    for(let name in subjectKeyframes) {
      const data = subjectKeyframes[ name ];
      const keyframe = {};
      this.contactCenter.forEach((c, idx) => {
        const d = data[ c.chanNum ];
        if( !d || typeof d !== "object" ) { return; }
        d.timeValues.forEach( v => {
          if( !keyframe[ v.time ] ) {
            keyframe[ v.time ] = [];
          }
          keyframe[ v.time ][ idx ] = v.value;
        });
      });
      const keyframe2 = Object.keys( keyframe ).map(t => {
        return [t, keyframe[ t ]];
      }).sort((a, b) => {
        return a[0] - b[0];
      });
      if( keyframe2.length ) {
        this.animationKeyFrames[ name ] = keyframe2;
      } else if ( this.animationKeyFrames[ name ] ){
        delete this.animationKeyFrames[ name ];
      }
    }

    this.colorNeedsUpdate = true;

  }

  /**
   * @params chanNum channel number. For single contact, this is `this.numbers`;
   * for multi-channel electrodes, this is the contact number
   * @params kfName key-frame name, usually the current display variable name
   */
  getFixedColor ( chanNum, kfName ) {
    if( !this._mapFixedColor ) { return; }
    if( kfName === "[Subject]" ) { return; }
    if( !chanNum ) { return; }
    const colSettings = this._mapFixedColor[ chanNum.toString() ];
    if( !colSettings ) { return; }
    if( kfName === "[None]" ) { return colSettings.default; }

    if( typeof kfName === "string" && colSettings.maps && colSettings.maps[ kfName ] ) {
      return colSettings.maps[ kfName ];
    }

    if( colSettings.inclusive ) {
      return colSettings.default;
    }
    return;
  }

  constructor (g, canvas) {
    super( g, canvas );
    // correct hemisphere
    g.hemisphere = guessHemisphere( g );

    const groupObject = this.getGroupObject3D();
    const groupData = this.getGroupData();

    // member setups
    this.type = "Electrode";
    this.isElectrode = true;

    // channel number(s)
    if( this._params.number ) {
      // assuming it's sorted
      this.numbers = asArray( this._params.number );
    } else {
      this.numbers = [];
    }
    // TODO: add channel number -> UV mapping
    // if( this._params.channel_orders)

    // this.animationActive = false;
    // this._animationName = "[None]";

    this.colorNeedsUpdate = true;        // whether updateColors needs to run

    this.state = {
      // For inner text
      customLabel       : undefined,

      // contact focused, for multi-contact electrode only
      focusedContact    : -1,
      contactPositions  : {
        tkrRAS  : new Vector3(),    // If focusedContact >= 0, contact position, else electrode center position;
        scanner : new Vector3(),
        mni152  : new Vector3(),
        mni305  : new Vector3(),
      },

      // updated during update()
      displayRepresentation: "prototype+sphere", // shape-only, contact-only, or shape+contact
      displayActive     : false,            // whether active keyframe is found for animation
      displayVariable   : "[None]",         // variable name used for displaying
      displayValues     : undefined,        // Array or number, electrode value(s) for displaying
      additionalDisplayActive   : false,
      additionalDisplayVariable : "[None]",
      additionalDisplayValues   : undefined,

      thresholdActive   : false,            // whether threshold is on
      thresholdVariable : "[None]",         // threshold variable names
      thresholdValues   : undefined,        // Array or number, electrode value(s) for threshold
      thresholdTest     : true,             // whether threshold is passed; always true if threshold is inactive
      thresholdTestArray: [],               // Used for multiple contacts; used when multiple values exist and `thresholdTest` is undefined

      colorSize         : 1,                // size of the colors: 1 for using one color for all, or n for different contacts
      anyFixedColor     : false,
      fixColor          : [false],          // Whether to fix the electrode color, array of size `colorSize`
      fixedColor        : [new Color()],    // If `fixColor[i]`, then show `fixedColor[i]`

      templateMappingActive: false,         // whether the electrode is mapped to template
      templateSubject   : this.subject_code,
      templateMappingMethod: "Affine",
      templateCoordSys  : "MNI305",

    };

    this.direction = new Vector3().set(0, 0, 1);
    this.up = new Vector3().set(0, 0, 0);  // example, DBS front face
    this.transforms = {
      model2tkr           : null,  // will set soon
      spherePosition      : new Vector3(),
      // Affine transform from freesurfer
      model2mni305Affine  : new Matrix4(),
      model2scan          : new Matrix4(),
      native2template     : {},
    };


    // When to fix the color
    this._mapFixedColor = null;
    if( groupData && groupData["fixed_colors"] ) {
      this._mapFixedColor = groupData["fixed_colors"];
    }

    // default color when not values set
    this.defaultColor = new Color().set(0xc2c2c2);
    this._tmpColor = new Color().set(1, 1, 1);
    this._tmpVec3 = new Vector3();
    this._tmpMat4 = new Matrix4();

    // animation key-values
    // this.animationKeyFrames = {};
    const variableNames = this._registerAnimationKeyFrames();


    // build geometry
    const baseSize = g.size || g.radius || g.width || g.height || 1;
    const protoName = g.prototype_name;
    let geomType = g.subtype === "CustomGeometry" ? "CustomGeometry" : "SphereGeometry";
    let geomParams = g.geomParams;

    // geomParams can be in g.geomParams or in group_data
    this.protoName = undefined;
    if( typeof(protoName) === "string" ) {
      if( groupData ) {
        if( !geomParams || typeof geomParams !== "object" ) {
          geomParams = groupData[`prototype_${protoName}`];
        }
        this.protoName = protoName;
      }
    } else {
      this.protoName = protoName;
    }
    if( geomType === "SphereGeometry" ) {
      if (!geomParams || typeof geomParams !== "object") {
        geomParams = {
          radius : baseSize,
          channel_numbers: [g.number],
        };
      }
      this.isElectrodePrototype = false;
    } else {
      if (!geomParams || typeof geomParams !== "object") {
        throw new TypeError("Cannot find proper `geomParams` for the electrode " + g.name);
      }
      this.isElectrodePrototype = true;
    }
    this._params.geomParams = geomParams;
    this._geometryType = geomType;

    this._geometry = new ElasticGeometry( geomType, geomParams );
    this._geometry.name = `geom_electrode_${ g.name }`;
    this._geometry.computeBoundingSphere();
    this._dataTexture = this._geometry.dataTexture;
    this._fixedOutline = this._geometry.parameters.fixedOutline;
    const transform = this._geometry.parameters.transform;
    const hasTransform = this._geometry.parameters.hasTransform;
    this.contactCenter = this._geometry.parameters.contactCenter;

    // materials
    if( this.isElectrodePrototype ) {
      this._material = new ElectrodePhysicalMaterial( MATERIAL_PARAMS_BASIC );
    } else {
      this._material = new ElectrodeBasicMaterial( MATERIAL_PARAMS_BASIC );
    }

    this._material.setModelDirection( this._geometry.parameters.modelDirection );

    // mesh
    this.object = new Mesh( this._geometry, this._material );
    this.object.renderOrder = CONSTANTS.RENDER_ORDER.Electrode;
    // make sure not hidden by other objects;
    this.object.name = 'mesh_electrode_' + g.name;
    if( hasTransform ) {
      // overwrite g.position
      g.position[0] = transform.elements[ 12 ];
      g.position[1] = transform.elements[ 13 ];
      g.position[2] = transform.elements[ 14 ];

      this.useMatrix4( transform );
      this.isPositionValid = true;
    } else {
      this.object.position.fromArray( g.position );
      transform.setPosition( this.object.position );
      if( this.object.position.lengthSq() === 0 ) {
        this.isPositionValid = false;
      } else {
        this.isPositionValid = true;
      }
    }

    // model to world (tkr-RAS)
    this.transforms.model2tkr = transform;
    this.resetBuiltinTransforms();


    // Build inner text sprite (text label to electrodes); requires
    // this.state and this.numbers
    this._textMap = new TextTexture( this.label, { 'weight' : 900 } );
    this._textSprite = new Sprite2( new SpriteMaterial({
      map: this._textMap,
      transparent: true,
      depthTest : false,
      depthWrite : false,
      color: 0xffffff
    }));
    this._textSprite.visible = false;
    this.object.add( this._textSprite );

    // Also add instancedMesh within the object
    if( this.isElectrodePrototype && Array.isArray( this.contactCenter ) && this.contactCenter.length > 0 ) {
      this.hasInstancedMesh = true;
      const nContacts = this.contactCenter.length;
      const instancedGeometry = new SphereGeometry( 1 );
      // materials
      const instancedMaterial = new ElectrodeBasicMaterial({
        'transparent'   : false,
        'reflectivity'  : 0,
        'color'         : 0xffffff,
        'vertexColors'  : false,
      });
      const instancedObjects = new InstancedMesh( instancedGeometry, instancedMaterial, nContacts );
      instancedObjects.renderOrder = CONSTANTS.RENDER_ORDER.InstancedElectrode;
      instancedObjects.layers.set( CONSTANTS.LAYER_SYS_ALL_CAMERAS_7 );
      instancedObjects.layers.enable( CONSTANTS.LAYER_SYS_RAYCASTER_CLICKABLE_14 );
      instancedObjects.layers.enable( CONSTANTS.LAYER_SYS_RAYCASTER_15 );
      instancedObjects.userData.instance = this;
      this.instancedObjects = instancedObjects;

      const contactMatrix = new Matrix4().identity();
      this.contactCenter.forEach( (el, ii) => {
        const contactRadius = el.radius ?? 0.1;
        contactMatrix
          .makeScale(contactRadius, contactRadius, contactRadius)
          .setPosition( el );
        instancedObjects.setMatrixAt( ii, contactMatrix );
        instancedObjects.setColorAt( ii, this.defaultColor );
      });
      this.instancedObjects.instanceMatrix.needsUpdate = true;
      this.object.add( instancedObjects );
    }

    const modelUp = this._geometry.parameters.modelUp;
    if( modelUp.lengthSq() > 0.5 ) {
      this._hasModelUp = true;

      this.arrowHelper = new ArrowHelper(
        modelUp,
        new Vector3( 0, 0, 0 ),
        3, 0x1a1a1a, 2
      );
      this.arrowHelper.scale.set(2, 1, 0.5);
      this.arrowHelper.cone.material.opacity = 0.5;
      this.arrowHelper.cone.material.transparent = true;
      this.arrowHelper.line.visible = false;
      this.object.add( this.arrowHelper );

    } else {

      this._hasModelUp = false;
      this.arrowHelper = null;
    }

    this.object.userData.dispose = () => { this.dispose(); };
  }

  resetBuiltinTransforms() {
    // calculate model2xxx transforms
    const subjectTransforms = this._canvas.shared_data.get( this.subject_code ).matrices;
    const model2tkr = this.transforms.model2tkr;
    const tkrPos = new Vector3().setFromMatrixPosition( model2tkr );

    // model to scannerRAS ( model -> tkr -> T1 scanner)
    this.transforms.model2scan
      .copy( subjectTransforms.tkrRAS_Scanner )
      .multiply( model2tkr );

    // model to MNI305 ( model -> tkr -> MNI305)
    // `model2mni305Affine` is an affine transform from model to MNI305
    this.transforms.model2mni305Affine
      .copy( subjectTransforms.tkrRAS_MNI305 )
      .multiply( model2tkr );

    // adjust if MNI305 position is set
    const mni305Array = this._params.MNI305_position;
    if( Array.isArray( mni305Array ) && mni305Array.length >= 3 && this.contactCenter.length > 0 ) {

      let mni305Count = mni305Array.length / 3;
      if( mni305Count > this.contactCenter.length ) {
        mni305Count = this.contactCenter.length;
      }

      // since we will apply `model2mni305Affine` when template-mapped
      // we need to calculate its inverse so the model space coordinates can be calculated
      const mni305ToModelAffine = this.transforms.model2mni305Affine.clone().invert();

      // calculate _mni305FixTargetXYZ - _nativeXYZ
      const targetContact = this.contactCenter[ 0 ];
      const offset = new Vector3().fromArray( mni305Array );

      // check if mni305Array is zero (no-op)
      if( offset.lengthSq() > 0 ) {
        // calculate offset from native to mni305 in model space
        offset.applyMatrix4( mni305ToModelAffine );

        offset.x -= targetContact._nativeX;
        offset.y -= targetContact._nativeY;
        offset.z -= targetContact._nativeZ;
      }

      // set _mni305FixTargetXYZ and _mni305UserZ
      const tmpVec3 = this._tmpVec3;
      for( let i = 0; i < this.contactCenter.length; i++ ) {

        const contactPosition = this.contactCenter[ i ];

        // apply offset to model
        contactPosition._mni305FixTargetX = contactPosition._nativeX + offset.x;
        contactPosition._mni305FixTargetY = contactPosition._nativeY + offset.y;
        contactPosition._mni305FixTargetZ = contactPosition._nativeZ + offset.z;

        if( i < mni305Count ) {

          // Calculate user-specified contact-level mni305 in model space
          tmpVec3.fromArray( mni305Array, i * 3 );

          if( tmpVec3.lengthSq() > 0 ) {

            tmpVec3.applyMatrix4( mni305ToModelAffine );
            contactPosition._mni305UserX = tmpVec3.x;
            contactPosition._mni305UserY = tmpVec3.y;
            contactPosition._mni305UserZ = tmpVec3.z;

          } else {

            contactPosition._mni305UserX = targetContact._nativeX;
            contactPosition._mni305UserY = targetContact._nativeY;
            contactPosition._mni305UserZ = targetContact._nativeZ;

          }

        }

      }

    }

    // get spherePosition
    const spherePosition = this.transforms.spherePosition;
    if( Array.isArray( this._params.sphere_position ) && this._params.sphere_position.length >= 3 ) {
      spherePosition.fromArray( this._params.sphere_position );
    } else {
      spherePosition.set(0, 0, 0);
    }
    if( spherePosition.length() < 0.5 ) {

      let hemisphere = this._params.hemisphere; // left, right, or null
      let nodeNumber = -1;
      const surfaceType = this._params.surface_type ??  "pial";

      const leftSurfInstance = this._canvas.threebrain_instances.get( `FreeSurfer Left Hemisphere - ${surfaceType} (${ this.subject_code })` ),
            rightSurfInstance = this._canvas.threebrain_instances.get( `FreeSurfer Right Hemisphere - ${surfaceType} (${ this.subject_code })` );

      let hasLeft = ( leftSurfInstance && leftSurfInstance.isThreeBrainObject ) ? true: false;
      let hasRight = ( rightSurfInstance && rightSurfInstance.isThreeBrainObject ) ? true: false;

      if( hemisphere ) {
        hasLeft = hasLeft && hemisphere === "left";
        hasRight = hasRight && hemisphere === "right";
      }

      let minDistToSurf = Infinity,
          tmpDistToSurf = 0,
          tmpPos = new Vector3();
      if( hasLeft ) {
        hemisphere = "left"
        const surfPos = leftSurfInstance.object.geometry.getAttribute("position");
        for(let i = 0; i < surfPos.count; i++) {
          tmpPos.fromArray( surfPos.array, surfPos.itemSize * i );
          tmpDistToSurf = tmpPos.distanceToSquared( tkrPos );
          if( tmpDistToSurf < minDistToSurf ) {
            minDistToSurf = tmpDistToSurf;
            nodeNumber = i;
          }
        }
      }

      if( hasRight ) {
        const surfPos = rightSurfInstance.object.geometry.getAttribute("position");
        for(let i = 0; i < surfPos.count; i++) {
          tmpPos.fromArray( surfPos.array, surfPos.itemSize * i );
          tmpDistToSurf = tmpPos.distanceToSquared( tkrPos );
          if( tmpDistToSurf < minDistToSurf ) {
            minDistToSurf = tmpDistToSurf;
            hemisphere = "right";
            nodeNumber = i;
          }
        }
      }

      if( nodeNumber < 0 || !hemisphere ) { return; }

      if( nodeNumber >= 0 && !this._params.hemisphere ) {
        this._params.hemisphere = hemisphere;
      }

      const sphereName = `FreeSurfer ${ hemisphere[0] === "l" ? "Left" : "Right" } Hemisphere - sphere.reg (${ this.subject_code })`,
            sphereInstance = this._canvas.threebrain_instances.get( sphereName );

      if( !sphereInstance || !sphereInstance.isThreeBrainObject ) { return; }
      const sphereGeomPositions = sphereInstance.object.geometry.getAttribute("position");
      spherePosition.fromArray( sphereGeomPositions.array, sphereGeomPositions.itemSize * nodeNumber );
    }

  }

  updatePrototypeModel ({ coordinateSys = "native", rigid = false } = {}) {

    if( !Array.isArray( this.contactCenter ) || this.contactCenter.length === 0 ) {
      coordinateSys = "native";
    } else {

      // no such coordinateSys
      if( this.contactCenter[0][ `_${ coordinateSys }X` ] === undefined ) {
        coordinateSys = "native";
      }

      const xName = `_${ coordinateSys }X`,
            yName = `_${ coordinateSys }Y`,
            zName = `_${ coordinateSys }Z`;
      const contactMatrix = new Matrix4().identity();

      this.contactCenter.forEach( (el, ii) => {

        el.set( el[ xName ], el[ yName ], el[ zName ] );

        if( this.hasInstancedMesh ) {
          const contactRadius = el.radius ?? 0.1;
          contactMatrix.makeScale(contactRadius, contactRadius, contactRadius).setPosition( el );
          this.instancedObjects.setMatrixAt( ii, contactMatrix );
        }
      });

      if( this.hasInstancedMesh ) {
        this.instancedObjects.instanceMatrix.needsUpdate = true;
      }

    }

    // has to be prototype
    this._geometry.updatePositions(rigid);
  }

  updateElectrodeDirection() {
    if(!this.isElectrodePrototype) {
      this.up.set( 0, 0, 0 );
      this.direction.set(0, 0, 1);
      return;
    }
    this.object.updateMatrixWorld();
    const matrixWorld = this.object.matrixWorld;
    const modelDirection = this._geometry.parameters.modelDirection;
    if( modelDirection.lengthSq() < 0.1 ) {
      this.direction.set(0, 0, 1);
    } else {
      this.direction.copy( modelDirection );
    }

    this.direction.applyMatrix4( matrixWorld )
      .sub( this._tmpVec3.setFromMatrixPosition( matrixWorld ) )
      .normalize();

    this.up.copy( this._geometry.parameters.modelUp )
      .applyMatrix4( matrixWorld )
      .sub( this._tmpVec3 )
      .normalize();

    return;
  }

  // After everything else is set (including controllers)
  finish_init(){

    super.finish_init();

    // add to canvas electrode list
    this.registerToMap( ['electrodes'] );
    if( this.isElectrodePrototype ) {
      // get_or_default( this._canvas[ nm ], this.subject_code, {} )[ this.name ] = this.object;
      if( !this._canvas.electrodePrototypes.has(this.subject_code) ) {
        this._canvas.electrodePrototypes.set( this.subject_code, {} );
      }
      const prototypeList = this._canvas.electrodePrototypes.get( this.subject_code );
      prototypeList[ this.protoName ] = this;
    }

    // electrodes must be clickable, ignore the default settings
    this._canvas.makeClickable( this.name, this.object );
    if( this.hasInstancedMesh ) {
      this._canvas.makeClickable( this.name+"__instanced", this.instancedObjects );
    }

    // set label size
    const electrodeLabelState = this._canvas.state_data.get("electrode_label");
    if( typeof electrodeLabelState === "object" && electrodeLabelState ) {
      this.setLabelScale( electrodeLabelState.scale || 1.5 );
    } else {
      this.setLabelScale( 1.5 );
    }

    this._canvas.$el.addEventListener(
      "viewerApp.electrodes.mapToTemplate",
      this.mapToTemplate
    );
    this._canvas.$el.addEventListener(
      "viewerApp.electrodes.updateData",
      this.updateElectrodeData
    );
    this._canvas.$el.addEventListener(
      "viewerApp.electrodes.colorMapChanged",
      this.onColorMapUpdated
    );

  }

  getKFValues( time, varname ) {
    if ( !this.hasAnimationTracks ) { return; }
    if ( varname === "[None]" ) { return; }
    const keyFrame = this.animationKeyFrames[ varname ];
    if( !keyFrame || !Array.isArray(keyFrame) || !keyFrame.length ) { return null; }

    let idx;
    for( idx = 0 ; idx < keyFrame.length - 1 ; idx++ ) {
      if( keyFrame[ idx + 1 ][0] > time && keyFrame[ idx ][0] <= time ) { break; }
    }
    if( idx >= keyFrame.length ) { idx = keyFrame.length - 1; }

    return keyFrame[ idx ][ 1 ];
  }

  updateThresholdTest(time) {

    const thresholdActive = this._canvas.get_state( 'threshold_active', false);
    const thresholdVariableName = thresholdActive ? this._canvas.get_state('threshold_variable', "[None]") : "[None]";
    const tVals = this.getKFValues( time , thresholdVariableName );
    const currentVariableName = this.state.thresholdVariable;

    if( tVals === undefined ) {
      this.state.thresholdActive = false;
      this.state.thresholdVariable = "[None]";
      this.state.thresholdValues = undefined;
      // default pass threshold
      this.state.thresholdTest = true;
      return;
    }
    this.state.thresholdVariable = thresholdVariableName;
    if( tVals === null ) {
      this.state.thresholdActive = false;
      this.state.thresholdValues = undefined;
      // default pass threshold
      this.state.thresholdTest = true;
      return;
    }

    const currentThresholdValues = this.state.thresholdValues;
    const currentThresholdTestArrays = this.state.thresholdTestArray;
    const currentThresholdRanges = this._thresholdRanges;
    // This can be an array or number
    this.state.thresholdActive = true;
    this.state.thresholdValues = tVals;
    this.state.thresholdTest = false;

    // test the threshold ranges agaist electrode value(s)
    this._thresholdRanges = this._canvas.get_state('threshold_values');
    this._thresholdOperator = this._canvas.get_state('threshold_method');
    const thresholdRanges = asArray( this._thresholdRanges );
    const operators = this._thresholdOperator;
    const isContinuous = this._canvas.get_state('threshold_type') === "continuous";

    if( isContinuous ) {
      // '|v| < T1', '|v| >= T1', 'v < T1',
      // 'v >= T1', 'v in [T1, T2]', 'v not in [T1,T2]'
      if(
        thresholdRanges.length > 0 && operators >= 0 &&
        operators < CONSTANTS.THRESHOLD_OPERATORS.length
      ){
        const opstr = CONSTANTS.THRESHOLD_OPERATORS[ operators ]
        let t1 = thresholdRanges[0];

        let isPassed;

        switch ( opstr ) {
          case 'v = T1':
            isPassed = ( v ) => { return v == t1; };
            break;

          case '|v| < T1':
            isPassed = ( v ) => { return Math.abs( v ) < t1; };
            break;

          case '|v| >= T1':
            isPassed = ( v ) => { return Math.abs( v ) >= t1; };
            break;

          case 'v < T1':
            isPassed = ( v ) => { return v < t1; };
            break;

          case 'v >= T1':
            isPassed = ( v ) => { return v >= t1; };
            break;

          default:
            // 'v in [T1, T2]' or 'v not in [T1,T2]'
            let t2 = Math.abs(t1);
            if( thresholdRanges.length === 1 ){
              t1 = -t2;
            } else {
              t2 = thresholdRanges[1];
              if( t1 > t2 ){
                t2 = t1;
                t1 = thresholdRanges[1];
              }
            }
            if( opstr === 'v in [T1, T2]' ) {
              isPassed = ( v ) => { return (v <= t2 && v >= t1); };
            } else {
              // 'v not in [T1,T2]'
              isPassed = ( v ) => { return (v > t2 && v < t1); };
            }
        };

        if( Array.isArray( tVals ) ) {
          const testArray = this.state.thresholdTestArray;
          let anyPassed = false;
          for(let ii in tVals) {
            const subPassed = isPassed( tVals[ii] );
            anyPassed = anyPassed || subPassed;
            testArray[ ii ] = subPassed;
          }
          if( anyPassed ) {
            this.state.thresholdTest = undefined;
          } else {
            this.state.thresholdTest = false;
          }

        } else {
          this.state.thresholdTest = isPassed( tVals );
        }

      } else {
        this.state.thresholdTest = true;
      }
    } else {
      // discrete
      if( thresholdRanges.length > 0 ) {
        const tVals = this.state.thresholdValues;
        if( Array.isArray( tVals ) ) {
          const testArray = this.state.thresholdTestArray;
          let anyPassed = false;
          for(let ii in tVals) {
            const subPassed = thresholdRanges.includes( tVals[ii] );
            anyPassed = anyPassed || subPassed;
            testArray[ ii ] = subPassed;
          }

          if( anyPassed ) {
            this.state.thresholdTest = undefined;
          } else {
            this.state.thresholdTest = false;
          }
        } else {
          this.state.thresholdTest = thresholdRanges.includes( tVals );;
        }
      } else {
        this.state.thresholdTest = true;
      }
    }

  }

  getInfoText(type = "display") {
    let infoPrefix, varname, values;

    const currentContactFocused = this.state.focusedContact;
    let chanNum = this.contactCenter[ currentContactFocused ].chanNum;

    if( type === "display" ) {
      if( !this.state.displayActive ) { return; }
      infoPrefix = "Display:   ";
      varname = this.state.displayVariable;
      values = this.state.displayValues;
    } else if ( type === "threshold" ) {
      if( !this.state.thresholdActive ) { return; }
      infoPrefix = "Threshold: ";
      varname = this.state.thresholdVariable;
      values = this.state.thresholdValues;
    } else if ( type === "additionalDisplay" ) {
      if( !this.state.additionalDisplayActive ) { return; }
      infoPrefix = "More:      ";
      varname = this.state.additionalDisplayVariable;
      values = this.state.additionalDisplayValues;
    } else {
      // Default returns name
      if( typeof chanNum === "number" || typeof chanNum === "string" ) {
        const nContacts = this.contactCenter.length;
        if(nContacts > 1) {
          chanNum = ` [ch=${chanNum}, ord=${currentContactFocused + 1}] `;
        } else {
          chanNum = ` [ch=${chanNum}] `;
        }
      } else {
        chanNum = "";
      }
      return `${this.name}${ chanNum }`;
    }

    const valueSize = Array.isArray( values ) ? values.length : 1;

    if( Array.isArray( values ) && valueSize === 1 ) {
      values = values[0];
      chanNum = "";
    } else {
      if( values === null || values === undefined ) {
        return;
      }
      if( Array.isArray( values ) ) {
        values = values[ currentContactFocused ];
      }
      if( typeof chanNum === "number" || typeof chanNum === "string" ) {
        chanNum = `[ch=${chanNum}] `;
      } else {
        chanNum = "";
      }
    }
    if( typeof chanNum !== "string" ) {
      chanNum = "";
    }

    if( typeof values === 'number' ){
      values = values.toPrecision(4);
    }

    if( typeof values !== "string" ) {
      return;
    }
    return `${ infoPrefix }${ varname } ${chanNum}(${ values })`;
  }

  updateDisplayValue (time) {

    // updated during update()
    //  displayActive     : false,            // whether active keyframe is found for animation
    //  displayVariable   : "[None]",         // variable name used for displaying
    //  displayValues     : undefined,        // Array or number, electrode value(s) for displaying

    const displayVariableName = this._canvas.get_state('display_variable', "[None]");
    const displayValues = this.getKFValues( time, displayVariableName );
    const currentDisplayActive = this.state.displayActive;
    const currentDisplayVariable = this.state.displayVariable;
    const currentDisplayValues = this.state.displayValues;

    if( displayValues === undefined ) {
      // varname not found or invalid
      this.state.displayActive    = false;
      this.state.displayVariable  = "[None]";
      this.state.displayValues    = undefined;
      this.colorNeedsUpdate = true;
      return;
    }

    this.state.displayVariable = displayVariableName;

    if( displayValues === null ) {
      // varname exists, but track not found or invalid
      this.state.displayActive = false;
      this.state.displayValues = undefined;
      this.colorNeedsUpdate = true;
      return;
    }

    this.state.displayActive = true;
    this.state.displayValues = displayValues;

    if( !currentDisplayActive || currentDisplayVariable !== displayVariableName || currentDisplayValues !== displayValues ) {
      this.colorNeedsUpdate = true;
    }

  }

  updateAdditionalDisplayValue (time) {

    const varname = this._canvas.get_state('additional_display_variable', "[None]");
    const values = this.getKFValues( time, varname );

    if( values === undefined ) {
      // varname not found or invalid
      this.state.additionalDisplayActive    = false;
      this.state.additionalDisplayVariable  = "[None]";
      this.state.additionalDisplayValues    = undefined;
      return;
    }

    this.state.additionalDisplayVariable = varname;

    if( values === null ) {
      // varname exists, but track not found or invalid
      this.state.additionalDisplayActive = false;
      this.state.additionalDisplayValues = undefined;
      return;
    }

    this.state.additionalDisplayActive = true;
    this.state.additionalDisplayValues = values;
  }

  updateDataRange() {
    this.colorNeedsUpdate = true;
  }
  onColorMapUpdated = () => {
    this.colorNeedsUpdate = true;
  }

  updateFixedColor() {

    // colorSize         : 1,                // size of the colors: 1 for using one color for all, or n for different contacts
    // fixColor          : [false],          // Whether to fix the electrode color, array of size `colorSize`

    const colorSize = this.state.colorSize;
    const fixColor = this.state.fixColor;
    const fixedColor = this.state.fixedColor;

    /** TODO: remove this
    if( !this.fixedColor ) {
      for( let i = 0 ; i < colorSize; i++ ) {
        fixColor[ i ] = false;
      }
      return;
    }
    */
    const displayVariableName = this.state.displayVariable;

    let anyFixedColor = false;
    let colorNeedsUpdate = false;

    if( this.isElectrodePrototype ) {
      if( Array.isArray( this.contactCenter ) ) {
        this.contactCenter.forEach( (center, ii) => {

          if( !fixedColor[ ii ] ) {
            fixedColor[ ii ] = new Color();
          }
          const colorHexStr = this.getFixedColor( center.chanNum, displayVariableName );

          if( !colorNeedsUpdate ) {
            colorNeedsUpdate = fixColor[ ii ] ^ (colorHexStr !== undefined);
          }

          if( !colorHexStr ) {
            fixColor[ ii ] = false;
            return;
          }
          fixedColor[ ii ].set( colorHexStr );
          fixColor[ ii ] = true;
          anyFixedColor = true;
        });
      }
    } else {
      const colorHexStr = this.getFixedColor( Array.isArray(this.numbers) && this.numbers.length > 0 ? this.numbers[0] : this.numbers, displayVariableName );
      if( !colorNeedsUpdate ) {
        colorNeedsUpdate = fixColor[ 0 ] ^ (colorHexStr !== undefined);
      }
      if( !colorHexStr ) {
        fixColor[ 0 ] = false;
      } else {
        anyFixedColor = true;
        fixColor[ 0 ] = true;
        fixedColor[ 0 ].set( colorHexStr );
      }
    }

    this.state.anyFixedColor = anyFixedColor;

  }

  updateVisibility() {

    // 4.1 Update prototype cutoff length
    let cutoffLen = this._canvas.get_state( 'electrode_prototype_length_cutoff', 0 );
    this._material.setMaxRenderLength( cutoffLen );

    // 4.2 set visibility
    const vis = this._canvas.get_state( 'electrode_visibility', 'all visible');
    const repr = this._canvas.get_state( 'electrode_representation', 'shape+contact' );

    const setVisible = ( visible ) => {
      if( visible ) {
        this.object.visible = true;
        if( this.hasInstancedMesh ) {
          switch (repr) {
            case 'prototype':
              this.object.layers.enableAll();
              this.instancedObjects.visible = false;
              break;

            case 'contact-only':
              this.object.layers.disableAll();
              this.instancedObjects.visible = true;
              break;

            default:
              this.object.layers.enableAll();
              this.instancedObjects.visible = true;
          }
        }
      } else {
        this.object.visible = false;
        if( this.hasInstancedMesh ) {
          this.instancedObjects.visible = false;
        }
      }
    };
    switch (vis) {
      case 'all visible':
        setVisible( true );
        break;
      case 'hidden':
        setVisible( false );
        break;
      case 'hide inactives':
        // The electrode has no value, hide
        if( this.state.displayActive && this.state.thresholdTest !== false ){
          setVisible( true );
        } else {
          setVisible( false );
        }
        break;
      case 'threshold only':
        // show even the object does not have values
        if( this.state.thresholdTest !== false ){
          setVisible( true );
        }else{
          setVisible( false );
        }
        break;
    }

    if( this.state.displayRepresentation !== repr ) {
      this.state.displayRepresentation = repr;
      this.colorNeedsUpdate = true;
    }

  }

  updateColors() {
    // colorSize         : 1,                // size of the colors: 1 for using one color for all, or n for different contacts
    // fixColor          : [false],          // Whether to fix the electrode color, array of size `colorSize`

    // no need to visualize
    const objectVisible = this.object.visible,
          instancedObjectVisible = this.hasInstancedMesh ? this.instancedObjects.visible : false;
    if( !objectVisible && !instancedObjectVisible ) { return; }

    const cmap = this._canvas.currentColorMap();
    const currentMaterial = this.object.material;
    const params = this._geometry.parameters;

    const thresholdPassed = this.state.thresholdTest !== false;
    const useThresholdArray = this.state.thresholdTest === undefined;
    const thresholdTestArray = this.state.thresholdTestArray;
    const instanceColorArray = instancedObjectVisible ? this.instancedObjects.instanceColor.array : undefined;

    // check if fixed color
    if( this.colorNeedsUpdate ) {
      this.colorNeedsUpdate = undefined;

      const defaultColor = this.defaultColor;
      const channelMap = this._geometry.getAttribute("channelMap");
      const markerMap = this._geometry.getAttribute("markerMap");

      const useFixedColor = this.state.fixColor;
      const fixedColorArray = this.state.fixedColor;


      const useDefaultColor = !(thresholdPassed && this.state.displayActive);
      const anyFixedColor = this.state.anyFixedColor;
      const useDataTexture = (
        params.useDataTexture && this._dataTexture
      ) ? true : false;

      // Prototype has electrode mappings giving mapping locations on texture
      // u, v, width, and height
      const useChannelMap = (
        useDataTexture && params.useChannelMap && channelMap
      ) ? true : false;
      const useMarkerMap = useChannelMap && params.useMarkerMap && markerMap;
      /**
       * The logic is:
       * if fixColor[ ii ] === true, then use fixedColor[ ii ]
       * else if useDefaultColor, then use defaultColor
       * else if useDataTexture, get from data texture
       * else use this.state.displayValues or *[0]
       */

      // If using data texture, we need to step into each texture unit
      // and set values to `this._dataTexture.image.data`
      if( useDataTexture ) {
        const textureWidth = params.textureWidth;
        const textureHeight = params.textureHeight;
        const colorArray = this._dataTexture.image.data;
        colorArray.fill(200);

        const values = this.state.displayValues;
        const valueIsArray = Array.isArray( values );

        // get number of channels to fill
        const nChannels = useChannelMap ? channelMap.count : colorArray.length / 4;

        // channel mapping (x, y, width, height)
        const channelMapArray = useChannelMap ? channelMap.array : [];
        const markerMapArray = useMarkerMap ? markerMap.array : [];

        let color; // Reused color object, used to calculate & assign color

        // For each contact
        for( let i = 0 ; i < nChannels ; i++ ) {

          if( useFixedColor[ i ] ) {
            // The color should be fixed
            color = fixedColorArray[ i ];
          } else if ( useDefaultColor ) {
            // Using default color
            color = this.defaultColor;
          } else {
            if( useThresholdArray && !thresholdTestArray[ i ] ) {
              // fail the threshold, hence using default colors
              color = this.defaultColor;
            } else {
              const v = valueIsArray ? values[ i ] : values;
              if( v === null || v === undefined ) {
                // No value, using default color
                color = this.defaultColor;
              } else {
                // Query the color map
                color = cmap.getColor( v , this._tmpColor );
              }
            }
          }

          if( instancedObjectVisible ) {
            // Do not render color on prototype, using instancedMesh anyway
            this.instancedObjects.setColorAt( i, color );
          } else {
            // temporary variables
            let j,              // Contact location in colorArray
                r, c, w, h,     // row-column-width-height in texture if `useChannelMap`
                k, l, k1, l1;           // iterator

            if( useMarkerMap ) {
              r = markerMapArray[ i * 4 ] - 1;
              c = markerMapArray[ i * 4 + 1 ] - 1;
              w = markerMapArray[ i * 4 + 2 ]; // Math.min(, textureWidth - r);
              h = markerMapArray[ i * 4 + 3 ]; // Math.min(, textureHeight - c);
              if (r >= 0 && c >= 0 && w > 0 && h > 0 && r < textureWidth && c < textureHeight) {

                for( l = 0, l1 = 0; l < h; l++, l1++ ) {
                  if( l1 >= textureHeight ) {
                    l1 -= textureHeight;
                  }
                  for( k = 0, k1 = 0; k < w; k++, k1++ ) {
                    if( k1 >= textureWidth ) {
                      k1 -= textureWidth;
                    }
                    j = r + k1 + ( c + l1 ) * textureWidth;
                    colorArray[ j * 4 ] = 50;
                    colorArray[ j * 4 + 1 ] = 50;
                    colorArray[ j * 4 + 2 ] = 50;
                    colorArray[ j * 4 + 3 ] = 255;
                  }
                }
              }
            }

            if( useChannelMap ) {
              r = channelMapArray[ i * 4 ] - 1;
              c = channelMapArray[ i * 4 + 1 ] - 1;
              w = channelMapArray[ i * 4 + 2 ]; // Math.min(, textureWidth - r);
              h = channelMapArray[ i * 4 + 3 ]; // Math.min(, textureHeight - c);
              if (r >= 0 && c >= 0 && w > 0 && h > 0 && r < textureWidth && c < textureHeight) {

                for( l = 0, l1 = 0; l < h; l++, l1++ ) {
                  if( l1 >= textureHeight ) {
                    l1 -= textureHeight;
                  }
                  for( k = 0, k1 = 0; k < w; k++, k1++ ) {
                    if( k1 >= textureWidth ) {
                      k1 -= textureWidth;
                    }
                    j = r + k1 + ( c + l1 ) * textureWidth;
                    colorArray[ j * 4 ] = color.r * 255;
                    colorArray[ j * 4 + 1 ] = color.g * 255;
                    colorArray[ j * 4 + 2 ] = color.b * 255;
                    colorArray[ j * 4 + 3 ] = 255;
                  }
                }
              }

            } else {
              colorArray[ i * 4 ] = color.r * 255;
              colorArray[ i * 4 + 1 ] = color.g * 255;
              colorArray[ i * 4 + 2 ] = color.b * 255;
              colorArray[ i * 4 + 3 ] = 255;
            }
          }

        }

        // material color needs to be set, also notify GPU to update textures
        currentMaterial.color.set(1, 1, 1);
        this._dataTexture.needsUpdate = true;
        this._material.useDataTexture( this._dataTexture, true );

        if( instancedObjectVisible ) {
          this.instancedObjects.instanceColor.needsUpdate = true;
        }

      } else {

        this._material.useDataTexture( this._dataTexture, false );

        if( useFixedColor.length > 0 && useFixedColor[0] ) {
          // The color should be fixed
          currentMaterial.color.copy( fixedColorArray[0] );
        } else if( useDefaultColor ) {
          currentMaterial.color.copy( this.defaultColor );
        } else {
          if( Array.isArray( this.state.displayValues ) ) {
            cmap.getColor( this.state.displayValues[0] , currentMaterial.color );
          } else {
            cmap.getColor( this.state.displayValues, currentMaterial.color );
          }
        }
      }

    }

    // also set clearcoat
    const outlineThreshold = this._canvas.get_state( "electrode_clearcoat", 0.0 );
    if( typeof outlineThreshold === "number" ) {
      if( !this._fixedOutline ) {
        this._material.useOutline( outlineThreshold );
      }
      if( this.isElectrodePrototype ) {
        this.instancedObjects.material.useOutline( outlineThreshold );
      }
    }

    const electrodeTranslucent = this._canvas.get_state( "electrode_translucent", 2 );
    if( this.isElectrodePrototype ) {
      this.instancedObjects.material.setTranslucent( electrodeTranslucent );
      this._material.setTranslucent( electrodeTranslucent );
    } else {
      this._material.setTranslucent( electrodeTranslucent );
    }
  }

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){

    super.pre_render({ target : target });

    const isMainRenderer = target === CONSTANTS.RENDER_CANVAS.main;
    if(!isMainRenderer) { return; }

    // check if prototype exists (if yes, hide this electrode sphere)
    if( this._geometryType === "SphereGeometry" && this.protoName !== undefined ) {

      if( this._superseded === undefined ) {
        // exists a prototype
        if( this._canvas.electrodePrototypes.has( this.protoName ) ) {
          this.object.visible = false;
          this._superseded = true;
          return;
        } else {
          this._superseded = false;
        }
      } else if ( this._superseded ) {
        return;
      }
    }

    if( this._geometryType === "SphereGeometry" ) {
      this.object.material.transparent = !isMainRenderer;
    }

    if( this.matrixNeedsUpdate ) {
      this.matrixNeedsUpdate = undefined;
      try {
        this.updateContactPosition();
      } catch (e) {
        console.warn(e);
      }
    }

    // ---- Section 0. check if raw position is 0,0,0 --------------------------
    if( this.isElectrode && !this.isPositionValid ) {
      this.object.visible = false;
      return ;
    }

    if( this._hasModelUp ) {
      if( this._canvas.crossArrowHelper.visible ) {
        this._canvas.crossArrowHelper.setDirection( this.up );
      }
      // this.arrowHelper.setDirection( this.up );
    }

    const time = this._canvas.animParameters.time;

    // ---- Section 1: Handle display, threshold -------------------------------
    /** For reference
    this.state = {
      displayVariable   : "[None]",
      displayValues     : [],
      thresholdVariable : "[None]",
      thresholdValues   : undefined
      thresholdTest     : true
    };
    */

    // updates
    // this.state.thresholdActive     true/false
    // this.state.thresholdVariable   "name"
    // this.state.thresholdValues     [] or number
    // this.state.thresholdTest       true/false
    const previousThresholdVariable = this.state.thresholdVariable;
    const previousThresholdActive = this.state.thresholdActive;
    const previousThresholdTest = this.state.thresholdTest;
    const previousThresholdTestArray = this.state.thresholdTestArray;
    const previousThresholdRanges = this._thresholdRanges;
    const previousThresholdOperator = this._thresholdOperator;
    this.updateThresholdTest(time);
    if(
      ( previousThresholdActive !== this.state.thresholdActive ) ||
      ( previousThresholdVariable !== this.state.thresholdVariable ) ||
      ( previousThresholdTest !== this.state.thresholdTest ) ||
      ( previousThresholdTestArray !== this.state.thresholdTestArray ) ||
      ( previousThresholdRanges !== this._thresholdRanges ) ||
      ( previousThresholdOperator !== this._thresholdOperator )
    ) {
      this.colorNeedsUpdate = true;
    }


    this.updateAdditionalDisplayValue(time);

    //  displayActive     : false,            // whether active keyframe is found for animation
    //  displayVariable   : "[None]",         // variable name used for displaying
    //  displayValues     : undefined,        // Array or number, electrode value(s) for displaying
    const previousDisplayVariable = this.state.displayVariable;
    this.updateDisplayValue(time);

    // colorSize         : 1,                // size of the colors: 1 for using one color for all, or n for different contacts
    // fixColor          : [false],          // Whether to fix the electrode color, array of size `colorSize`
    if( this.colorNeedsUpdate ||
        previousDisplayVariable !== this.state.displayVariable ) {
      // displayVariable has changed, check fixed colors
      this.updateFixedColor();
      this.colorNeedsUpdate = true;
    }

    // visible?
    this.updateVisibility();

    // update color

    const defaultColorHex = testColorString( this._canvas.get_state( 'inactiveElectrodeColor' ) );
    if( this.colorNeedsUpdate || defaultColorHex ) {
      const previousDefaultColor = this.defaultColor.getHex();
      this.defaultColor.set( defaultColorHex );
      if( this.defaultColor.getHex() !== defaultColorHex ) {
        this.colorNeedsUpdate = true;
      }
    }
    this.updateColors();

  }

  updateContactPosition() {
    const whichContact = this.state.focusedContact;

    let contactIsSet = false;
    if( whichContact >= 0 ) {
      const cpos = this.contactCenter[ whichContact ];

      if( cpos && cpos.isVector3 ) {
        this.state.contactPositions.tkrRAS
          .set( cpos._nativeX, cpos._nativeY, cpos._nativeZ )
          .applyMatrix4( this.transforms.model2tkr );
        this.state.contactPositions.scanner
          .set( cpos._nativeX, cpos._nativeY, cpos._nativeZ )
          .applyMatrix4( this.transforms.model2scan );

        this.state.contactPositions.mni305
          .set( cpos._mni305UserX, cpos._mni305UserY, cpos._mni305UserZ )
          .applyMatrix4( this.transforms.model2mni305Affine );

        contactIsSet = true;
      }
    }

    if( !contactIsSet ) {
      this.state.focusedContact = 0;
      this.state.contactPositions.tkrRAS.setFromMatrixPosition( this.transforms.model2tkr );
      this.state.contactPositions.scanner.setFromMatrixPosition( this.transforms.model2scan );
      this.state.contactPositions.mni305.setFromMatrixPosition( this.transforms.model2mni305Affine );

    }

    // update MNI152
    this.state.contactPositions.mni152
      .copy( this.state.contactPositions.mni305 )
      .applyMatrix4( CONSTANTS.MNI305_to_MNI152 );

    // return contact world position
    return this.state.contactPositions.tkrRAS;
  }

  focusContactFromWorld( pos ) {
    if( !pos || !pos.isVector3 ) {
      this.state.focusedContact = 0;
      this.updateContactPosition();
      return;
    }
    this.object.worldToLocal( pos );
    let cid = -1, dst = Infinity;
    this.contactCenter.forEach((v, ii) => {
      if( !v ) { return; };
      const d = pos.distanceToSquared(v);
      if( d < dst ) {
        dst = d;
        cid = ii;
      }
    });

    this.state.focusedContact = cid;
    this.updateContactPosition();

    // update pos to snaping to the electrode
    if( cid >= 0 ) {
      const contact = this.contactCenter[ cid ];
      pos.copy( contact );
      pos.radius = contact.radius ?? 1.0;
      pos.chanNum = contact.chanNum;
    }
    this.object.localToWorld( pos );
    return;
  }

  useMatrix4( m44 ) {

    // super.useMatrix4( m44, { applyScale : true } );
    if( this.isElectrodePrototype ) {
      super.useMatrix4( m44, { applyScale : true } );
    } else {

      // rigid mapping (same scale)
      super.useMatrix4( m44, { applyScale : false } );

      // If contactCenter is defined, this is a single-contact (sphere mode)
      // with fixed mapping points. Make sure the positions are correct
      if(Array.isArray(this.contactCenter) && this.contactCenter.length > 0) {
        const fixedModelPosition = this.contactCenter[0];
        const fixedWorldPosition = this._tmpVec3.copy(fixedModelPosition).applyMatrix4(m44).clone();

        const worldOffset = this.object.localToWorld( this._tmpVec3.copy(fixedModelPosition) ).sub( fixedWorldPosition ).multiplyScalar( -1 );
        this.object.position.add( worldOffset );

        this.object.updateMatrix();
      }
    }

    this.updateElectrodeDirection();
    this.matrixNeedsUpdate = true;
    this._canvas.needsUpdate = true;
  }

  _ensureTemplateCache( subjectCode, names = [] ) {
    if( typeof subjectCode !== "string" ) {
      throw new TypeError("_ensureTemplateCache: subjectCode must be string");
    }
    let recalculate = false;
    if( typeof this.transforms.native2template[ subjectCode ] !== "object" ) {
      recalculate = true;
      this.transforms.native2template[ subjectCode ] = {};
    }
    const mappings = this.transforms.native2template[ subjectCode ];
    for(let i = 0; i < names.length; i++) {
      const name = names[ i ];
      if( !mappings[ name ] ) {
        recalculate = true;
        if( subjectCode === this.subject_code ) {
          mappings[ name ] = new Matrix4().copy( this.transforms.model2tkr );
        } else {
          mappings[ name ] = new Matrix4();
        }
      }
    }
    return recalculate;
  }

  // using affine matrix to calculate mapping from model to
  getAffineTranformToTemplate( { subjectCode, recalculate = false } = {} ) {
    if( typeof subjectCode !== "string" || subjectCode === "" || subjectCode === "/" ) {
      subjectCode = this._canvas.get_state("target_subject");
    }

    recalculate = recalculate || this._ensureTemplateCache( subjectCode, ['model2tkr_Affine'] );

    const maps = this.transforms.native2template[ subjectCode ];

    if ( recalculate ) {
      const origSubject = this.subject_code;

      if( origSubject === subjectCode ) {
        maps.model2tkr_Affine.copy( this.transforms.model2tkr );
      } else {

        const targetSubjectData = this._canvas.shared_data.get( subjectCode );

        // MNI305 to template tkrRAS
        maps.model2tkr_Affine.copy( this.transforms.model2mni305Affine )
          .premultiply( targetSubjectData.matrices.MNI305_tkrRAS );

      }

    }

    return subjectCode;

  }

  getSurfaceTransformToTemplate({ subjectCode, surfaceType = "pial", recalculate = false } = {}) {
    // get spherePosition
    const spherePosition = this.transforms.spherePosition;
    // no sphere position available
    if( !spherePosition || spherePosition.length() < 0.5 ) {
      return false;
    }

    let hemisphere;
    const origSubject = this.subject_code,
          g = this._params;
    if( typeof g.hemisphere != "string" ) {
      const mni152 = this.state.contactPositions.mni152;
      if( mni152.lengthSq() === 0 || mni152.x === 0 ) {
        return false;
      }
      if( mni152.x > 0 ) {
        hemisphere = "Right";
      } else {
        hemisphere = "Left";
      }
    } else {
      hemisphere = g.hemisphere.toLowerCase();
      if( hemisphere[0] === "l" ) {
        hemisphere = "Left";
      } else {
        hemisphere = "Right";
      }
    }

    if( typeof subjectCode !== "string" || subjectCode === "" || subjectCode === "/" ) {
      subjectCode = this._canvas.get_state("target_subject");
    }

    const transformName = "model2Surface";

    recalculate = recalculate || this._ensureTemplateCache( subjectCode, [ transformName ] );

    const mappings = this.transforms.native2template[ subjectCode ];
    if( !mappings[ transformName ] || mappings[ transformName ].surfaceType !== surfaceType ) {
      recalculate = true;
    }

    // this.transforms.native2template[ subjectCode ].model2Surface;
    if( !recalculate ) { return subjectCode; }

    // make sure we have the rotation
    this.getAffineTranformToTemplate({ subjectCode: subjectCode });
    const model2Surface = mappings[ transformName ].copy( mappings.model2tkr_Affine );

    // Not mapped, invalid sphere position (length should be ~100)
    if( spherePosition.length() < 0.5 ) { return false; }

    const surfaceName = `FreeSurfer ${hemisphere} Hemisphere - ${surfaceType} (${subjectCode})`,
          sphereName = `FreeSurfer ${hemisphere} Hemisphere - sphere.reg (${subjectCode})`,
          surfaceInstance = this._canvas.threebrain_instances.get( surfaceName ),
          sphereInstance = this._canvas.threebrain_instances.get( sphereName );

    // check if both sphere exist
    if(
      !surfaceInstance || !surfaceInstance.isThreeBrainObject ||
      !sphereInstance || !sphereInstance.isThreeBrainObject
    ) { return false; }

    const templateSpherePos = sphereInstance.object.geometry.getAttribute("position");
    let minDist = Infinity,
        minDistArg = 0,
        tmpDist = 0,
        tmp = new Vector3();
    for(let i = 0; i < templateSpherePos.count; i++) {
      tmp.fromArray( templateSpherePos.array , templateSpherePos.itemSize * i );
      tmpDist = tmp.distanceTo( spherePosition );
      if( tmpDist < minDist ) {
        minDistArg = i;
        minDist = tmpDist;
      }
    }

    // minDistArg is the node number
    if( minDistArg < 0 ) { return false; }

    const surfacePositions = surfaceInstance.object.geometry.getAttribute("position");
    const newPosition = tmp.fromArray( surfacePositions.array , surfacePositions.itemSize * minDistArg );

    // TODO: do we need to consider group matrix???
    // get electrode group and get the group
    // const group = this.getGroupObject3D();
    // if( group ) {
    //   const worldToModel = group.matrixWorld.clone().invert();
    //   newPosition.applyMatrix4( worldToModel );
    // }

    // 0 0 0 -> newPosition
    model2Surface.copy( mappings.model2tkr_Affine ).setPosition( newPosition );

    // Get surface position and make sure it's world position
    // normally this is no-op, except for inflated brain, where surface origins
    // are not 0,0,0
    model2Surface.premultiply( surfaceInstance.object.matrixWorld );

    model2Surface.surfaceType = surfaceType;

    /**
    const shiftDistance = tmp.fromArray( g.position ).distanceTo( newPosition );

    if( !dryRun ) {
      this.object.position.copy( newPosition );

      this.object.userData._template_mapped = true;
      this.object.userData._template_space = 'sphere.reg';
      this.object.userData._template_surface = surfaceType;
      this.object.userData._template_hemisphere = hemisphere_;
      this.object.userData._template_shift = shiftDistance;
    }

    return {
      mapping : "sphere.reg",
      hemisphere: hemisphere_,
      shiftDistance: shiftDistance,
      newPosition: newPosition
    }
    */
    return subjectCode;

  }


  mapToTemplateAffine({ subjectCode } = {}) {

    const mappedSubject = this.getAffineTranformToTemplate({ subjectCode : subjectCode });

    if( typeof mappedSubject === "string" && mappedSubject !== this.subject_code ) {
      const mappings = this.transforms.native2template[ mappedSubject ];
      this.useMatrix4( mappings.model2tkr_Affine );
      this.state.templateMappingActive = true;
      this.state.templateSubject = subjectCode;
    } else {
      this.useMatrix4( this.transforms.model2tkr );
      this.state.templateMappingActive = false;
      this.state.templateSubject = this.subject_code;
    }

    this.state.templateMappingMethod = "Affine";
    this.state.templateCoordSys = "MNI305";

    return this.state;
  }

  mapToTemplateSurface({ subjectCode, surfaceType } = {}) {

    if( typeof surfaceType !== "string" || surfaceType === 'auto' ) {
      surfaceType = this._canvas.get_state("surface_type", "pial");
      if( !CONSTANTS.FREESURFER_SURFACE_TYPES.includes( surfaceType ) ) {
        surfaceType = this._params.surface_type;
        if( typeof surfaceType !== "string" ) {
          surfaceType = "pial";
        }
      }
    }

    const projectionOffset = this._params.surface_offset;
    let useSurfaceMapping = false;
    if( typeof projectionOffset === "number" ) {
      const offsetThreshold = this._canvas.get_state('electrodeProjectionThreshold', 0);
      if( offsetThreshold < 0 || offsetThreshold >= 30 || projectionOffset <= offsetThreshold ) {
        useSurfaceMapping = true;
      }
    } else {
      useSurfaceMapping = true;
    }

    if( useSurfaceMapping ) {
      const mappedSubject = this.getSurfaceTransformToTemplate( {
        subjectCode : subjectCode,
        surfaceType : surfaceType
      } );

      if( typeof mappedSubject === "string" ) {
        const mappings = this.transforms.native2template[ mappedSubject ];
        this.useMatrix4( mappings.model2Surface );
        this.state.templateMappingActive = true;
        this.state.templateSubject = subjectCode;
        this.state.templateMappingMethod = "SurfaceMapping";
        this.state.templateCoordSys = "sphere.reg";
        return this.state;
      }
    }

    return this.mapToTemplateAffine({ subjectCode: subjectCode });

  }

  cloneForExporter({
    target            = CONSTANTS.RENDER_CANVAS.main,
    materialModifier  = {}
  } = {}) {

    if( !this.isElectrodePrototype || !this.hasInstancedMesh ) {

      return super.cloneForExporter({
        target            : CONSTANTS.RENDER_CANVAS.main,
        materialModifier  : {}
      });

    }

    if( !this.object.visible ) { return null; }

    const instancedMesh = this.instancedObjects;

    const count = instancedMesh.count;
    const geometry = instancedMesh.geometry;

    const positionAttr = geometry.attributes.position,
          positionCount = positionAttr.count,
          positionArray = positionAttr.array;
    const indexAttr = geometry.index,
          indexArray = new Uint32Array( indexAttr.array ),
          indexCount = indexAttr.count;


    const newPositionCount = positionCount * count * 3;
    const newPositionArray = new Float32Array( newPositionCount );
    const newColorArray = new Float32Array( newPositionCount );
    const newIndexArray = new Uint32Array( indexCount * count );

    const vec3 = new Vector3();
    const mat4 = new Matrix4();
    const color = new Color();

    for ( let i = 0; i < count; i++ ) {

      instancedMesh.getMatrixAt( i, mat4 );
      instancedMesh.getColorAt( i, color );
      // GLTF assumes linear RGB
      color.convertSRGBToLinear();
      const positionOffset = positionCount * i;

      for( let j = 0; j < positionCount; j++ ) {
        vec3.fromArray( positionArray , j * 3 );
        vec3.applyMatrix4( mat4 );
        vec3.toArray( newPositionArray, (j + positionOffset) * 3 );
        color.toArray( newColorArray, (j + positionOffset) * 3 );
      }

      if( i > 0 ) {
        // No need to increase the index for first instance
        for( let j = 0; j < indexCount ; j++ ) {
          indexArray[j] += positionCount;
        }
      }

      newIndexArray.set( indexArray, indexCount * i );

    }

    const geom = new BufferGeometry();
    const pos = new Float32BufferAttribute( newPositionArray, 3 );
    const col = new Float32BufferAttribute( newColorArray, 3 );

    geom.setIndex( new Uint32BufferAttribute(newIndexArray, 1) );
    geom.setAttribute( 'position', pos );
    geom.setAttribute( 'color', col );

    const material = new MeshBasicMaterial({
      vertexColors: true
    });

    const mesh = new Mesh( geom, material );
    mesh.applyMatrix4( instancedMesh.matrixWorld );
    return mesh;
  }

}

function gen_electrode(g, canvas) {
  const subject_code = g.subject_code;

  if( subject_code ){
    // make sure subject group exists
    if( g.group && g.group.group_name ){
      const group_name = g.group.group_name;

      if( !canvas.group.has(group_name) ){
        canvas.add_group( {
          name : group_name, layer : 0, position : [0,0,0],
          disable_trans_mat: true, group_data: null,
          parent_group: null, subject_code: subject_code,
          trans_mat: null
        });
      }
    }
  }

  const el = new Electrode(g, canvas);

  if( subject_code ){
    // make sure subject array exists
    canvas.init_subject( subject_code );
  }
  return( el );
}

function is_electrode(e) {

  if(!e || !e.isMesh) { return false; }

  const inst = getThreeBrainInstance(e);
  if(!inst || !inst.isElectrode) { return false; }

  return(true);
}

export { gen_electrode, is_electrode };
