import { AbstractThreeBrainObject, ElasticGeometry } from './abstract.js';
import {
  MeshBasicMaterial, MeshPhysicalMaterial, SpriteMaterial, InterpolateDiscrete,
  Mesh, Vector2, Vector3, Matrix4, Color,
  ColorKeyframeTrack, NumberKeyframeTrack, AnimationClip, AnimationMixer,
  SphereGeometry, InstancedMesh, DoubleSide
} from 'three';
import { addColorCoat } from '../shaders/addColorCoat.js';
import { Sprite2, TextTexture } from '../ext/text_sprite.js';
import { asArray } from '../utility/asArray.js';
import { pointPositionByDistances, registerRigidPoints } from '../Math/svd.js';
import { CONSTANTS } from '../core/constants.js';

const MATERIAL_PARAMS_BASIC = {
  'transparent'   : true,
  'reflectivity'  : 0,
  'color'         : 0xffffff,
  'vertexColors'  : false,
  'side'          : DoubleSide,
};

const MATERIAL_PARAMS_MORE = {
  ...MATERIAL_PARAMS_BASIC,
  'roughness'           : 1,
  'metalness'           : 0,
  'ior'                 : 0,
  'clearcoat'           : 0.0,
  'clearcoatRoughness'  : 1,
  'flatShading'         : false,
}

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
    try {
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
    } catch (e) {}

    this.object.material.dispose();
    this.object.geometry.dispose();

    try {
      this._canvas.$el.removeEventListener(
        "viewerApp.electrodes.mapToTemplate",
        this.mapToTemplate
      )
    } catch (e) {}

    if( this.instancedObjects ) {
      this.instancedObjects.dispose();
    }
  }

  // fat arrow to make sure listeners are correct for child classes
  mapToTemplate = ( event ) => {
    const mapConfig = event.detail;
    const subjectCode = mapConfig.subject,
          surfaceMapping = mapConfig.surface,
          volumeMapping = mapConfig.volume;

    if( surfaceMapping === "reset" || volumeMapping === "reset" ) {
      this.useMatrix4( this.transforms.model2tkr );
      this.state.templateMappingActive = false;
      this.state.templateSubject = this.subject_code;
      this.state.templateMappingMethod = "Affine";
      this.state.templateCoordSys = "MNI305";
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

    if( isSurfaceElectrode && surfaceMapping === "sphere.reg" ) {
      this.mapToTemplateSurface({ subjectCode : subjectCode });
      return;
    }

    this.mapToTemplateAffine({ subjectCode : subjectCode });
  }

  constructor (g, canvas) {
    super( g, canvas );
    // correct hemisphere
    g.hemisphere = guessHemisphere( g );

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
      fixColor          : [false],          // Whether to fix the electrode color, array of size `colorSize`
      useBasicMaterial  : false,            // whether to use basic material? true when have data, false when fixed color or no data

      templateMappingActive: false,         // whether the electrode is mapped to template
      templateSubject   : this.subject_code,
      templateMappingMethod: "Affine",
      templateCoordSys  : "MNI305",

    };


    this.transforms = {
      model2tkr       : null,  // will set soon
      spherePosition  : new Vector3(),
      model2mni305    : new Matrix4(),
      model2scan      : new Matrix4(),
      native2template : {},
    };


    // When to fix the color
    this.fixedColor = undefined;
    if( g.fixed_color && typeof( g.fixed_color ) === "object" ) {
      if( g.fixed_color.color ) {
        this.fixedColor = {
          'color' : new Color().set( g.fixed_color.color ),
          'names' : asArray( g.fixed_color.names ),
          'inclusive' : g.fixed_color.inclusive ? true: false
        };
      }
    }

    // default color when not values set
    this.defaultColor = new Color().set(1, 1, 1);
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
      const groupObject = this.get_group_object();
      if( groupObject && groupObject.userData.group_data ) {
        if( !geomParams || typeof geomParams !== "object" ) {
          geomParams = groupObject.userData.group_data[`prototype_${protoName}`];
        }
        this.protoName = protoName;
      }
    } else {
      this.protoName = protoName;
    }
    if( geomType === "SphereGeometry" ) {
      if (!geomParams || typeof geomParams !== "object") {
        geomParams = { radius : baseSize };
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
    const fixedClearCoat = this._geometry.parameters.fixedClearCoat;
    const transform = this._geometry.parameters.transform;
    const hasTransform = this._geometry.parameters.hasTransform;
    this.contactCenter = this._geometry.parameters.contactCenter;

    this._shaderUniforms = {
      fixedClearCoat : { value : fixedClearCoat ? true : false },
      clearcoat      : { value : 0.0 },
      useDataTexture : { value : 0 },
      dataTexture    : { value : this._dataTexture },
    };

    // materials
    this._materials = {
      'MeshBasicMaterial' : addColorCoat( new MeshBasicMaterial( MATERIAL_PARAMS_BASIC ), this._shaderUniforms ),
      'MeshPhysicalMaterial': addColorCoat( new MeshPhysicalMaterial( MATERIAL_PARAMS_MORE ), this._shaderUniforms )
    };

    // mesh
    this.object = new Mesh(this._geometry, this._materials.MeshPhysicalMaterial );
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
    this._instancedShaderUniforms = {
      fixedClearCoat : { value : false },
      clearcoat      : { value : 0.0 },
      useDataTexture : { value : 0 },
      dataTexture    : { value : null },
    };
    if( Array.isArray( this.contactCenter ) && this.contactCenter.length > 0 ) {
      this.hasInstancedMesh = true;
      const nContacts = this.contactCenter.length;
      const instancedGeometry = new SphereGeometry( 1 );
      // materials
      const instancedMaterial = addColorCoat(
        new MeshBasicMaterial({
          'transparent'   : false,
          'reflectivity'  : 0,
          'color'         : 0xffffff,
          'vertexColors'  : false,
        }),
        this._instancedShaderUniforms
      );
      const instancedObjects = new InstancedMesh( instancedGeometry, instancedMaterial, nContacts );
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
    this.transforms.model2mni305
      .copy( subjectTransforms.tkrRAS_MNI305 )
      .multiply( model2tkr );

    // adjust if MNI305 position is set
    const mni305Array = this._params.MNI305_position;
    if( Array.isArray( mni305Array ) && mni305Array.length >= 3 ) {
      const userMNI305 = new Vector3().fromArray( mni305Array );
      const dist = userMNI305.length();
      if( !isNaN(dist) && isFinite(dist) && dist > 0 ) {
        this.transforms.model2mni305.setPosition( userMNI305 );
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

  updateControlPoints ({ which, worldPosition }) {
    const controlPoints = this._geometry.parameters.controlPoints;
    if( which ) {
      if( !worldPosition.isVector3 ) {
        throw new TypeError("electrode.updateControlPoints: `worldPosition` must be a THREE.Vector3");
      }
      if( !isFinite( worldPosition.lengthSq()) ) { return; }
      if( !Array.isArray( controlPoints.model ) || controlPoints.model.length < 3 ) {
        throw new RangeError("electrode.updateControlPoints: insufficient prototype controlPoints.")
      }
      // no need to update
      if( which >= 0 && which < controlPoints.model.length ) {
        let cw = controlPoints.world[ which ];
        if( !cw || typeof cw !== "object" || !cw.isVector3 ) {
          cw = new Vector3().copy( worldPosition );
          controlPoints.world[ which ] = cw;
        }
      }
    }

    const m44 = registerRigidPoints( controlPoints.model , controlPoints.world );
    this.useMatrix4(m44);
  }

  // After everything else is set (including controllers)
  finish_init(){

    super.finish_init();

    // add to canvas electrode list
    this.register_object( ['electrodes'] );
    if( this.isElectrodePrototype ) {
      // get_or_default( this._canvas[ nm ], this.subject_code, {} )[ this.name ] = this.object;
      if( !this._canvas.electrodePrototypes.has(this.subject_code) ) {
        this._canvas.electrodePrototypes.set( this.subject_code, {} );
      }
      const prototypeList = this._canvas.electrodePrototypes.get( this.subject_code );
      prototypeList[ this.protoName ] = this;
    }

    // electrodes must be clickable, ignore the default settings
    this._canvas.add_clickable( this.name, this.object );
    this._canvas.add_clickable( this.name+"__instanced", this.instancedObjects );

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
    )

  }

  getKFValues( time, varname ) {
    if ( !this.hasAnimationTracks ) { return; }
    if ( varname === "[None]" ) { return; }
    const keyFrame = this.animationKeyFrames[ varname ];
    if( !keyFrame ) { return null; }

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
    const thresholdRanges = asArray( this._thresholdRanges );
    const operators = this._canvas.get_state('threshold_method');
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

    if( this.state.thresholdTest === false ) {
      this.state.useBasicMaterial = false;
    } else {
      if(
        currentVariableName !== this.state.thresholdVariable ||
        currentThresholdTestArrays !== this.state.thresholdTestArray ||
        currentThresholdValues !== this.state.thresholdValues ||
        currentThresholdRanges !== this._thresholdRanges
      ) {
        this.colorNeedsUpdate = true;
      }
    }
  }

  getInfoText(type = "display") {
    let infoPrefix, varname, values;
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
    }

    const currentContactFocused = this.state.focusedContact;
    let chanNum = this.contactCenter[ currentContactFocused ].chanNum;
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
      this.state.useBasicMaterial = false;
      this.colorNeedsUpdate = true;
      return;
    }

    this.state.displayVariable = displayVariableName;

    if( displayValues === null ) {
      // varname exists, but track not found or invalid
      this.state.displayActive = false;
      this.state.displayValues = undefined;
      this.state.useBasicMaterial = false;
      this.colorNeedsUpdate = true;
      return;
    }

    this.state.displayActive = true;
    this.state.displayValues = displayValues;

    if( !currentDisplayActive || currentDisplayVariable !== displayVariableName || currentDisplayValues !== displayValues ) {
      this.colorNeedsUpdate = true;
    }

    if ( this.state.thresholdTest !== false ) {
      this.state.useBasicMaterial = true;
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

  updateFixedColor() {

    // colorSize         : 1,                // size of the colors: 1 for using one color for all, or n for different contacts
    // fixColor          : [false],          // Whether to fix the electrode color, array of size `colorSize`
    // useBasicMaterial

    const colorSize = this.state.colorSize;
    const fixColor = this.state.fixColor;

    if( !this.fixedColor ) {
      for( let i = 0 ; i < colorSize; i++ ) {
        fixColor[ i ] = false;
      }
      return;
    }
    const displayVariableName = this.state.displayVariable;

    // TODO: fix me when fixed color needs to be considered for each sub-element
    let useFixedColor = false;

    switch ( displayVariableName ) {
      case '[None]':
        useFixedColor = true;
        break;

      case '[Subject]':
        useFixedColor = false;
        break;

      default: {
        const cmap = this._canvas.currentColorMap();
        if( this.fixedColor.inclusive ) {
          useFixedColor = this.fixedColor.names.includes( cmap.name );
        } else {
          useFixedColor = ! this.fixedColor.names.includes( cmap.name );
        }
      }
    };

    if( useFixedColor && colorSize > 0 && !fixColor[ 0 ]) {
      this.colorNeedsUpdate = true;
    }

    for( let i = 0 ; i < colorSize; i++ ) {
      fixColor[ i ] = useFixedColor;
    }

    if( useFixedColor) {
      this.state.useBasicMaterial = false;
    }

  }
  updateMaterialType() {
    if( this.state.useBasicMaterial ) {
      this.object.material = this._materials.MeshBasicMaterial;
    } else {
      this.object.material = this._materials.MeshPhysicalMaterial;
    }
  }

  updateVisibility() {
    // 4. set visibility
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
    // useBasicMaterial  // whether basic material is used

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
    if( (this.state.fixColor[0] && this.fixedColor) || !(thresholdPassed && this.state.displayActive) ) {
      let fixedColor;
      if( this.state.fixColor[0] && this.fixedColor ) {
        fixedColor = this.fixedColor.color;
      } else {
        fixedColor = this.defaultColor;
      }

      if( this.colorNeedsUpdate ) {
        this.colorNeedsUpdate = undefined;

        if( params.useDataTexture && this._dataTexture ) {
          const useChannelMap = params.useChannelMap;
          const textureWidth = params.textureWidth;
          const textureHeight = params.textureHeight;
          const colorArray = this._dataTexture.image.data;
          const channelMap = this._geometry.getAttribute("channelMap");

          colorArray.fill(50);

          if( useChannelMap && channelMap ) {
            const n = channelMap.count;
            const channelMapArray = channelMap.array;

            let j, r, c, w, h, k, l;
            for( let i = 0; i < n ; i++ ) {
              // set RGB 0-255
              r = channelMapArray[ i * 4 ] - 1;
              c = channelMapArray[ i * 4 + 1 ] - 1;
              w = Math.min(channelMapArray[ i * 4 + 2 ], textureWidth - r);
              h = Math.min(channelMapArray[ i * 4 + 3 ], textureHeight - c);
              if (r >= 0 && c >= 0 && w > 0 && h > 0 && r < textureWidth && c < textureHeight) {

                for( l = 0; l < h; l++ ) {
                  for( k = 0; k < w; k++ ) {
                    j = r + k + ( c + l ) * textureWidth;
                    colorArray[ j * 4 ] = fixedColor.r * 255;
                    colorArray[ j * 4 + 1 ] = fixedColor.g * 255;
                    colorArray[ j * 4 + 2 ] = fixedColor.b * 255;
                    colorArray[ j * 4 + 3 ] = 255;
                  }
                }
              }
            }

          } else {
            const count = colorArray.length / 4;
            for(let i = 0; i < count; i++ ) {
              colorArray[ i * 4 ] = fixedColor.r * 255;
              colorArray[ i * 4 + 1 ] = fixedColor.g * 255;
              colorArray[ i * 4 + 2 ] = fixedColor.b * 255;
              colorArray[ i * 4 + 3 ] = 255;
            }
          }

          currentMaterial.color.set(1, 1, 1);
          this._dataTexture.needsUpdate = true;
          this._shaderUniforms.useDataTexture.value = 1;
        } else {
          currentMaterial.color.copy( fixedColor );
          this._shaderUniforms.useDataTexture.value = 0;
        }
        if( instancedObjectVisible ) {
          const count = this.instancedObjects.count;
          for(let i = 0; i < count; i++ ) {
            instanceColorArray[ i * 3 ] = fixedColor.r;
            instanceColorArray[ i * 3 + 1 ] = fixedColor.g;
            instanceColorArray[ i * 3 + 2 ] = fixedColor.b;
          }
          this.instancedObjects.instanceColor.needsUpdate = true;
        }
      }
    } else if( this.colorNeedsUpdate ) {
      this.colorNeedsUpdate = undefined;

      if(
        this.state.useBasicMaterial && params.useDataTexture &&
        this._dataTexture // && Array.isArray( this.state.displayValues )
      ) {

        const useChannelMap = params.useChannelMap;
        const textureWidth = params.textureWidth;
        const textureHeight = params.textureHeight;
        const colorArray = this._dataTexture.image.data;
        const channelMap = this._geometry.getAttribute("channelMap");
        const fixedColor = this.defaultColor;

        const values = this.state.displayValues;
        const tmpColor = this._tmpColor;

        const valueIsArray = Array.isArray( values );
        let v;

        // transparent by default;
        colorArray.fill(50);

        if( useChannelMap && channelMap ) {
          const colorCount = channelMap.count;
          const channelMapArray = channelMap.array;
          const n = Array.isArray( values ) ? Math.min( colorCount, values.length ) : colorCount;


          let j, r, c, w, h, k, l;
          for( let i = 0; i < n ; i++ ) {
            if( useThresholdArray && !thresholdTestArray[ i ]) {
              if( instancedObjectVisible ) {
                instanceColorArray[ i * 3 ] = fixedColor.r;
                instanceColorArray[ i * 3 + 1 ] = fixedColor.g;
                instanceColorArray[ i * 3 + 2 ] = fixedColor.b;
              }
              continue;
            }

            // set RGB 0-255
            r = channelMapArray[ i * 4 ] - 1;
            c = channelMapArray[ i * 4 + 1 ] - 1;
            w = Math.min(channelMapArray[ i * 4 + 2 ], textureWidth - r);
            h = Math.min(channelMapArray[ i * 4 + 3 ], textureHeight - c);
            if (r >= 0 && c >= 0 && w > 0 && h > 0 && r < textureWidth && c < textureHeight) {
              v = valueIsArray ? values[i] : values;
              if( v === null ) {
                tmpColor.setHex( 0xc2c2c2 );
              } else {
                cmap.getColor( v , tmpColor );// .convertLinearToSRGB();
              }

              if( instancedObjectVisible ) {
                // tmpColor.convertLinearToSRGB();
                this.instancedObjects.setColorAt( i, tmpColor );
              } else {
                for( l = 0; l < h; l++ ) {
                  for( k = 0; k < w; k++ ) {
                    j = r + k + ( c + l ) * textureWidth;
                    colorArray[ j * 4 ] = tmpColor.r * 255;
                    colorArray[ j * 4 + 1 ] = tmpColor.g * 255;
                    colorArray[ j * 4 + 2 ] = tmpColor.b * 255;
                    colorArray[ j * 4 + 3 ] = 255;
                  }
                }
              }

            }
          }

        } else {
          const colorCount = textureWidth * textureHeight;
          const n = Array.isArray( values ) ? Math.min( colorCount, values.length ) : colorCount;

          for( let i = 0; i < n ; i++ ) {

            if( useThresholdArray && !thresholdTestArray[ i ]) {
              if( instancedObjectVisible ) {
                instanceColorArray[ i * 3 ] = fixedColor.r;
                instanceColorArray[ i * 3 + 1 ] = fixedColor.g;
                instanceColorArray[ i * 3 + 2 ] = fixedColor.b;
              }
              continue;
            }

            v = valueIsArray ? values[i] : values;
            if( v === null ) {
              tmpColor.setHex( 0xc2c2c2 );
            } else {
              cmap.getColor( v , tmpColor );//.convertLinearToSRGB();
            }

            if( instancedObjectVisible ) {
              // tmpColor.convertLinearToSRGB();
              this.instancedObjects.setColorAt( i, tmpColor );
            } else {
              // set RGB 0-255
              colorArray[ i * 4 ] = tmpColor.r * 255;
              colorArray[ i * 4 + 1 ] = tmpColor.g * 255;
              colorArray[ i * 4 + 2 ] = tmpColor.b * 255;
              colorArray[ i * 4 + 3 ] = 255;
            }
          }

        }



        this._dataTexture.needsUpdate = true;
        this._shaderUniforms.useDataTexture.value = 1;
        if( instancedObjectVisible ) {
          this.instancedObjects.instanceColor.needsUpdate = true;
        }

      } else {
        this._shaderUniforms.useDataTexture.value = 0;
        if( Array.isArray( this.state.displayValues ) ) {
          cmap.getColor( this.state.displayValues[0] , currentMaterial.color );
        } else {
          cmap.getColor( this.state.displayValues, currentMaterial.color );
        }
      }
    }

    // also set clearcoat
    const clearCoatValue = this._canvas.get_state( "electrode_clearcoat", 0.0 );
    if( typeof clearCoatValue === "number" ) {
      this._shaderUniforms.clearcoat.value = clearCoatValue;
      this._instancedShaderUniforms.clearcoat.value = clearCoatValue;
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
    this.updateThresholdTest(time);
    this.updateAdditionalDisplayValue(time);

    //  displayActive     : false,            // whether active keyframe is found for animation
    //  displayVariable   : "[None]",         // variable name used for displaying
    //  displayValues     : undefined,        // Array or number, electrode value(s) for displaying
    this.updateDisplayValue(time);

    // colorSize         : 1,                // size of the colors: 1 for using one color for all, or n for different contacts
    // fixColor          : [false],          // Whether to fix the electrode color, array of size `colorSize`
    // useBasicMaterial  // whether basic material is used
    this.updateFixedColor();


    // Determine the material
    this.updateMaterialType();

    // visible?
    this.updateVisibility();

    // update color
    this.updateColors();

  }

  updateContactPosition() {
    const whichContact = this.state.focusedContact;

    let contactIsSet = false;
    if( whichContact >= 0 ) {
      const cpos = this.contactCenter[ whichContact ];

      if( cpos && cpos.isVector3 ) {
        this.state.contactPositions.tkrRAS.copy( cpos ).applyMatrix4( this.transforms.model2tkr );
        this.state.contactPositions.scanner.copy( cpos ).applyMatrix4( this.transforms.model2scan );
        this.state.contactPositions.mni305.copy( cpos ).applyMatrix4( this.transforms.model2mni305 );
        contactIsSet = true;
      }
    }

    if( !contactIsSet ) {
      this.state.focusedContact = 0;
      this.state.contactPositions.tkrRAS.setFromMatrixPosition( this.transforms.model2tkr );
      this.state.contactPositions.scanner.setFromMatrixPosition( this.transforms.model2scan );
      this.state.contactPositions.mni305.setFromMatrixPosition( this.transforms.model2mni305 );
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
    return;
  }

  useMatrix4( m44 ) {
    super.useMatrix4( m44, { applyScale : this.isElectrodePrototype } );
    this.matrixNeedsUpdate = true;
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
        maps.model2tkr_Affine.copy( this.transforms.model2mni305 )
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

    const origSubject = this.subject_code,
          g = this._params;
    if( typeof g.hemisphere != "string" ) { return false; }
    let hemisphere = g.hemisphere.toLowerCase();
    if( hemisphere[0] === "l" ) {
      hemisphere = "Left";
    } else {
      hemisphere = "Right";
    }

    if( typeof subjectCode !== "string" || subjectCode === "" || subjectCode === "/" ) {
      subjectCode = this._canvas.get_state("target_subject");
    }

    const transformName = "model2Surface";

    recalculate = recalculate || this._ensureTemplateCache( subjectCode, [ transformName ] );

    // this.transforms.native2template[ subjectCode ].model2Surface;
    if( !recalculate ) { return subjectCode; }

    // make sure we have the rotation
    this.getAffineTranformToTemplate({ subjectCode: subjectCode });
    const mappings = this.transforms.native2template[ subjectCode ];
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
    // const group = this.get_group_object();
    // if( group ) {
    //   const worldToModel = group.matrixWorld.clone().invert();
    //   newPosition.applyMatrix4( worldToModel );
    // }

    // 0 0 0 -> newPosition
    model2Surface.copy( mappings.model2tkr_Affine ).setPosition( newPosition );

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

  mapToTemplateSurface({ subjectCode } = {}) {

    const g = this._params;
    let surfaceType = g.surface_type;
    if( typeof surfaceType !== "string" ) {
      surfaceType = "pial"
    }

    const mappedSubject = this.getSurfaceTransformToTemplate( { subjectCode : subjectCode, surfaceType : surfaceType } );

    if( mappedSubject === this.subject_code ) {
      this.useMatrix4( this.transforms.model2tkr );
      this.state.templateMappingActive = false;
      this.state.templateSubject = this.subject_code;
      this.state.templateMappingMethod = "Affine";
      this.state.templateCoordSys = "MNI305";
      return this.state;
    }

    if( typeof mappedSubject === "string" ) {
      const mappings = this.transforms.native2template[ mappedSubject ];
      this.useMatrix4( mappings.model2Surface );
      this.state.templateMappingActive = true;
      this.state.templateSubject = subjectCode;
      this.state.templateMappingMethod = "SurfaceMapping";
      this.state.templateCoordSys = "sphere.reg";
      return this.state;
    }

    return this.mapToTemplateAffine({ subjectCode: subjectCode });

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
  if(e && e.isMesh && e.userData.construct_params && e.userData.construct_params.is_electrode){
    return(true);
  }else{
    return(false);
  }
}

export { gen_electrode, is_electrode };
