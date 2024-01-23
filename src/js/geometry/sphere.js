import { AbstractThreeBrainObject } from './abstract.js';
// MeshBasicMaterial, MeshLambertMaterial,
import {
  MeshBasicMaterial, MeshPhysicalMaterial, SpriteMaterial, InterpolateDiscrete,
  SphereGeometry, Mesh, Vector3, Matrix4, Color,
  ColorKeyframeTrack, NumberKeyframeTrack, AnimationClip, AnimationMixer
} from 'three';
import { Sprite2, TextTexture } from '../ext/text_sprite.js';
import { to_array, get_or_default, remove_comments } from '../utils.js';
import { asArray } from '../utility/asArray.js';
import { CONSTANTS } from '../core/constants.js';
import { projectOntoMesh } from '../Math/projectOntoMesh.js';
import { OutlinePass } from '../jsm/postprocessing/OutlinePass.js';

const MATERIAL_PARAMS_BASIC = {
  'transparent' : true,
  'reflectivity' : 0,
  'color': 0xffffff
};

const MATERIAL_PARAMS_MORE = {
  ...MATERIAL_PARAMS_BASIC,
  'roughness' : 1,
  'metalness' : 0,
  'ior' : 0,
  'clearcoat' : 0.0,
  'clearcoatRoughness' : 1,
  'flatShading' : false
}

function addColorCoat( material ) {
  if( material.clearcoat === undefined ) {
    material.clearcoat = 0.0;
  }
  material.onBeforeCompile = ( shader , renderer ) => {
    material.userData.shader = shader;

    shader.uniforms.clearcoat2 = { get value() {
      return material.clearcoat;
    } };

    shader.vertexShader = remove_comments(`
varying float reflectProd;
`) + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      remove_comments(
`#include <fog_vertex>

// uniform vec3 cameraPosition; - camera position in world space
vec3 cameraRay = normalize( position.xyz - cameraPosition.xyz );

reflectProd = abs( dot( normalize( normal ), cameraRay ) );
`)
    );


    shader.fragmentShader = remove_comments(`
uniform float clearcoat2;
varying float reflectProd;
`) + shader.fragmentShader;

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <dithering_fragment>",
    remove_comments(
`
#include <dithering_fragment>

gl_FragDepth = gl_FragCoord.z;
if ( clearcoat2 > 0.0 && reflectProd < clearcoat2 ) {
  gl_FragColor.rgb = vec3( 0.0 );
  gl_FragDepth = gl_DepthRange.near;
}
`));
  };

  return material;
}


class Sphere extends AbstractThreeBrainObject {
  constructor (g, canvas) {
    super( g, canvas );

    this.type = 'Sphere';
    this.isSphere = true;
    this.isElectrode = false;
    this.animationActive = false;
    this._animationName = "[None]";
    this._currentValue = undefined;
    this._currentThresholdValue = undefined;

    this.animationKeyFrames = {};

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


    // Register g.keyframes
    this._material_type = 'MeshPhysicalMaterial';
    for( let frameName in g.keyframes ) {
      const kf = g.keyframes[ frameName ];
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

        // Make material based on value
        this._material_type = 'MeshBasicMaterial';
      }
    }

    this._materials = {
      'MeshBasicMaterial' : addColorCoat( new MeshBasicMaterial( MATERIAL_PARAMS_BASIC ) ),
      'MeshPhysicalMaterial': addColorCoat( new MeshPhysicalMaterial( MATERIAL_PARAMS_MORE ) )
    };

    const gb = new SphereGeometry( g.radius, g.width_segments, g.height_segments );
    this._geometry = gb;

    gb.name = 'geom_sphere_' + g.name;


    const mesh = new Mesh(gb, this._materials[ this._material_type ]);
    mesh.name = 'mesh_sphere_' + g.name;
    const gb2 = gb.clone();
    gb2.name = gb.name + "--clone"

    // FIXME: need to use class instead of canvas.mesh
    let linked = false;
    if(g.use_link){
      // This is a linkedSphereGeom which should be attached to a surface mesh
      let vertex_ind = Math.floor(g.vertex_number - 1),
          target_name = g.linked_geom,
          target_mesh = canvas.mesh.get( target_name );

      if(target_mesh && target_mesh.isMesh){
        let target_pos = target_mesh.geometry.attributes.position.array;
        mesh.position.set(target_pos[vertex_ind * 3], target_pos[vertex_ind * 3+1], target_pos[vertex_ind * 3+2]);
        linked = true;
      }
    }

    if(!linked){
      mesh.position.fromArray(g.position);
    }

    // make sure not hidden by other objects;
    mesh.renderOrder = -500;

    this._mesh = mesh;
    this.object = mesh;

    // Add text label to electrodes
    this._text_label = `${this._params.number || ""}`;
    const map = new TextTexture( this._text_label, { 'weight' : 900 } );
    const material = new SpriteMaterial( {
      map: map,
      transparent: true,
      depthTest : false,
      depthWrite : false,
      color: 0xffffff
    } );
    const sprite = new Sprite2( material );
    sprite.visible = false;
    this._mesh.add( sprite );


    this._text_sprite = sprite;
    this._text_map = map;

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

    this._link_userData();
  }

  _link_userData(){
    // register for compatibility
    // this._mesh.userData.get_track_data = ( track_name, reset_material ) => {
    //   return( this.get_track_data( track_name, reset_material ) );
    // };
    this._mesh.userData.dispose = () => { this.dispose(); };
  }

  get hasAnimationTracks () {
    for( let k in this.animationKeyFrames ) {
      return true;
    }
    return false;
  }

  get label() {
    return this._text_label;
  }

  set label(name) {
    this._text_label = `${name}`;
    // console.debug(`Setting label: ${this._text_label}`);
    this._text_map.draw_text( this._text_label );
  }

  set_label_scale ( v ) {
    if( !this.isElectrode ) { return; }
    if( v && v > 0 ) {
      this._text_map.updateScale( v * (this._params.radius || 1) );
    }
  }

  set_label_visible (visible) {
    if( !this.isElectrode ) { return; }
    if( visible ) {
      this._text_sprite.visible = true;
    } else {
      this._text_sprite.visible = false;
    }
  }

  dispose(){
    try {
      this._text_sprite.removeFromParent();
      this._text_sprite.material.map.dispose();
      this._text_sprite.material.dispose();
      this._text_sprite.geometry.dispose();
    } catch (e) {}

    try {
      this._mesh.removeFromParent();
    } catch (e) {}

    this._mesh.material.dispose();
    this._mesh.geometry.dispose();

    try {
      this._canvas.$el.removeEventListener(
        "viewerApp.electrodes.mapToTemplate",
        this.mapToTemplate
      )
    } catch (e) {}
  }

  switchTrack( dataName ) {
    if( typeof dataName !== "string" ) {
      dataName = "[None]";
    }
    this._animationName = dataName;
    if( !this.hasAnimationTracks ) {
      this._mesh.material = this._materials.MeshPhysicalMaterial;
      this.animationActive = false;
      return;
    }

    if( this.animationKeyFrames[ dataName ] ) {
      this._mesh.material = this._materials.MeshBasicMaterial;
      this.animationActive = true;
    } else {
      this._mesh.material = this._materials.MeshPhysicalMaterial;
      this.animationActive = false;
    }

    this.update();
    this._canvas.needsUpdate = true;
  }

  update() {
    if( !this.hasAnimationTracks ) { return; }

    // kf = [ [ time, value], ... ], time is sorted
    const time = this._canvas.animParameters.time;
    let idx;

    this._currentValue = undefined;
    if( this.animationActive ) {
      const kf = this.animationKeyFrames[ this._animationName ];
      if( kf ) {
        for( idx = 0 ; idx < kf.length - 1 ; idx++ ) {
          if( kf[ idx + 1 ][0] > time && kf[ idx ][0] <= time ) { break; }
        }
        if( idx >= kf.length ) { idx = kf.length - 1; }
        this._currentValue = kf[ idx ][1];
      }
    }

    // check threshold
    this._currentThresholdValue = undefined;
    const thresholdName = this._canvas.get_state('threshold_variable');
    this._thresholdName = thresholdName;
    if( this._canvas.get_state( 'threshold_active', false) ) {
      if( typeof thresholdName === "string" ) {
        const kfThreshold = this.animationKeyFrames[ thresholdName ];
        if( kfThreshold ) {
          for( idx = 0 ; idx < kfThreshold.length - 1 ; idx++ ) {
            if( kfThreshold[ idx + 1 ][0] > time && kfThreshold[ idx ][0] <= time ) { break; }
          }
          if( idx >= kfThreshold.length ) { idx = kfThreshold.length - 1; }
          this._currentThresholdValue = kfThreshold[ idx ][1];
        }
      }
    }

  }

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){

    super.pre_render({ target : target });
    this.object.material.transparent = target !== CONSTANTS.RENDER_CANVAS.main;

    if( target !== CONSTANTS.RENDER_CANVAS.main ) { return; }

    // 0. check if raw position is 0,0,0
    const origPos = this.object.userData.construct_params.position;
    if( this.isElectrode && origPos[0] === 0 && origPos[1] === 0 && origPos[2] === 0 ) {
      this.object.visible = false;
      return ;
    }

    // 1. whether passed threshold
    const cmap = this._canvas.currentColorMap();
    const currentValue = this._currentValue;

    // whether the threshold test passed
    let thresholdTestPassed = true;

    // either:
    // electrode fix_color is set & enabled
    // or:
    // thresholdTestPassed (true), has animation & currentValue is valid
    let isActive = true;


    // 2. check if electrode fix_color is set & enabled
    // useFixedColor=true when cmap.name is '[None]' or in/not in this.fixedColor.names,
    // depending on this.fixedColor.inclusive
    let useFixedColor = false;

    if( this.fixedColor ) {
      if( !cmap ) {
        useFixedColor = true;
      } else {
        switch (cmap.name) {
          case '[None]':
            useFixedColor = true;
            break;

          case '[Subject]':
            useFixedColor = false;
            break;

          default:
            if( this.fixedColor.inclusive ) {
              useFixedColor = this.fixedColor.names.includes( cmap.name );
            } else {
              useFixedColor = ! this.fixedColor.names.includes( cmap.name );
            }
        };
      }
    }

    if( useFixedColor ) {
      // 2.1 display this.fixedColor.color only

      // 2.1.1 always use MeshPhysicalMaterial
      this.object.material = this._materials.MeshPhysicalMaterial;

      // 2.1.2 set color
      this.object.material.color.copy( this.fixedColor.color );

    } else {
      // 2.2 display values

      // 2.2.1 check if threshold is passed
      if( this._currentThresholdValue !== undefined ) {
        thresholdTestPassed = false;
        const currentThresholdValue = this._currentThresholdValue;
        const thresholdRanges = asArray( this._canvas.get_state('threshold_values') );
        const operators = this._canvas.get_state('threshold_method');
        if( this._canvas.get_state('threshold_type') === "continuous" ) {
          // '|v| < T1', '|v| >= T1', 'v < T1',
          // 'v >= T1', 'v in [T1, T2]', 'v not in [T1,T2]'
          if(
            thresholdRanges.length > 0 && operators >= 0 &&
            operators < CONSTANTS.THRESHOLD_OPERATORS.length
          ){
            const opstr = CONSTANTS.THRESHOLD_OPERATORS[ operators ]
            let t1 = thresholdRanges[0];

            if( opstr === 'v = T1' && currentThresholdValue == t1 ){
              thresholdTestPassed = true;
            } else if( opstr === '|v| < T1' && Math.abs(currentThresholdValue) < t1 ){
              thresholdTestPassed = true;
            } else if( opstr === '|v| >= T1' && Math.abs(currentThresholdValue) >= t1 ){
              thresholdTestPassed = true;
            } else if( opstr === 'v < T1' && currentThresholdValue < t1 ){
              thresholdTestPassed = true;
            } else if( opstr === 'v >= T1' && currentThresholdValue >= t1 ){
              thresholdTestPassed = true;
            } else {
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
              if( opstr === 'v in [T1, T2]' && currentThresholdValue <= t2 && currentThresholdValue >= t1 ){
                thresholdTestPassed = true;
              } else if( opstr === 'v not in [T1,T2]' && ( currentThresholdValue > t2 || currentThresholdValue < t1 ) ){
                thresholdTestPassed = true;
              }
            }

          } else {
            thresholdTestPassed = true;
          }
        } else {
          // discrete
          thresholdTestPassed = thresholdRanges.includes( currentThresholdValue );
        }
      }

      // 2.2.2 set isActive - thresholdTestPassed (true), has animation & currentValue is valid
      isActive = thresholdTestPassed && this.animationActive && currentValue !== undefined;

      // 2.2.3 change material, don't use switch_material as that's heavy
      if( isActive && this.object.material.isMeshPhysicalMaterial ){
        this.object.material = this._materials.MeshBasicMaterial;
      }else if( !isActive && this.object.material.isMeshBasicMaterial ){
        this.object.material = this._materials.MeshPhysicalMaterial;
      }

      // 2.2.4 if active, set material color
      if( isActive ) {
        cmap.getColor( currentValue , this.object.material.color );
      } else {
        // reset color
        this.object.material.color.set(1, 1, 1);
      }
    }

    // 3. set outline
    this.object.material.clearcoat = this._canvas.get_state( "electrode_clearcoat", 0.0 );

    // 4. set visibility
    const vis = this._canvas.get_state( 'electrode_visibility', 'all visible');

    switch (vis) {
      case 'all visible':
        this.object.visible = true;
        break;
      case 'hidden':
        this.object.visible = false;
        break;
      case 'hide inactives':
        // The electrode has no value, hide
        if( isActive ){
          this.object.visible = true;
        }else{
          this.object.visible = false;
        }
        break;
      case 'threshold only':
        // show even the object does not have values
        if( thresholdTestPassed ){
          this.object.visible = true;
        }else{
          this.object.visible = false;
        }
        break;
    }

  }

  switch_material( material_type, update_canvas = false ){
    if( material_type in this._materials ){
      const _m = this._materials[ material_type ];
      this._material_type = material_type;
      this._mesh.material = _m;
      this._mesh.material.needsUpdate = true;
      if( update_canvas ){
        this._canvas.needsUpdate = true;
      }
    }
  }

  /*
  add_track_data( track_name, data_type, value, time_stamp = 0 ){
    let first_value = value, track_value = value;
    if(Array.isArray(time_stamp)){
      if(!Array.isArray(value) || time_stamp.length !== value.length ){
        return;
      }
      first_value = value[0];
    }else if(Array.isArray(value)){
      first_value = value[0];
      track_value = first_value;
    }
    if( !data_type ){
      data_type = (typeof first_value === 'number')? 'continuous' : 'discrete';
    }
    this._mesh.userData.ani_exists = true;
    this._mesh.userData.ani_params[track_name] = {
      "name"      : track_name,
      "time"      : time_stamp,
      "value"     : value,
      "data_type" : data_type,
      "target"    : ".material.color",
      "cached"    : false
    };
    if(!this._animationAllNames.includes( track_name )){
      this._animationAllNames.push( track_name );
    }
  }

  get_track_data( track_name, reset_material ){
    let re;

    if( this.hasAnimationTracks ){
      if( track_name === undefined ){ track_name = this._animationName; }
      re = this._mesh.userData.ani_params[ track_name ];
    }

    if( reset_material ){
      if( re && re.value !== null ){
        this._mesh.material = this._materials.MeshBasicMaterial;
        this.animationActive = true;
      }else{
        this._mesh.material = this._materials.MeshPhysicalMaterial;
        this.animationActive = false;
      }
    }

    return( re );
  }
  */

  get_summary({
    reset_fs_index = false,
    enabled_only = true
  } = {}) {
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

  _mapToTemplateSurface( hemisphere, { subjectCode, surfaceType = "pial", dryRun = false } = {}) {

    if( !this.isElectrode ) { return; }

    const g = this._params;

    if( !g.is_surface_electrode ) { return; }
    if( !Array.isArray( g.sphere_position ) ) { return; }

    let hemisphere_ = hemisphere.toLowerCase();
    if( hemisphere_ !== "left" && hemisphere_ !== "right" ) { return; }
    if( hemisphere_ === "left" ) {
      hemisphere_ = "Left";
    } else {
      hemisphere_ = "Right";
    }

    if( typeof subjectCode !== "string" || subjectCode === "" || subjectCode === "/" ) {
      subjectCode = this._canvas.get_state("target_subject");
    }
    const surfaceName = `FreeSurfer ${hemisphere_} Hemisphere - ${surfaceType} (${subjectCode})`;
    const sphereName = `FreeSurfer ${hemisphere_} Hemisphere - sphere.reg (${subjectCode})`;

    // get surfaces
    const surfaceInstance = this._canvas.threebrain_instances.get( surfaceName );
    const sphereInstance = this._canvas.threebrain_instances.get( sphereName );

    // check if both sphere exist
    if( !surfaceInstance || !surfaceInstance.isThreeBrainObject ) { return; }
    if( !sphereInstance || !sphereInstance.isThreeBrainObject ) { return; }

    const electrodeSpherePosition = new Vector3().fromArray( g.sphere_position );

    // Not mapped, invalid sphere position (length should be ~100)
    if( electrodeSpherePosition.length() < 0.5 ) { return; }

    const spherePositions = sphereInstance.object.geometry.getAttribute("position");

    let minDist = Infinity,
        minDistArg = 0,
        tmpDist = 0,
        tmp = new Vector3();
    for(let i = 0; i < spherePositions.count; i++) {
      tmpDist = tmp
        .set( spherePositions.getX( i ), spherePositions.getY( i ), spherePositions.getZ( i ))
        .distanceTo( electrodeSpherePosition );
      if( tmpDist < minDist ) {
        minDistArg = i;
        minDist = tmpDist;
      }
    }

    // minDistArg is the node number
    const surfacePositions = surfaceInstance.object.geometry.getAttribute("position");
    const newPosition = new Vector3().set(
      surfacePositions.getX( minDistArg ),
      surfacePositions.getY( minDistArg ),
      surfacePositions.getZ( minDistArg )
    );

    // get electrode group and get the group
    const group = this.get_group_object();
    if( group ) {
      const worldToModel = group.matrixWorld.clone().invert();
      newPosition.applyMatrix4( worldToModel );
    }

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

  }

  mapToTemplateSurface ({ subjectCode } = {}) {

    if( !this.isElectrode ) { return; }

    const g = this._params;
    let surfaceType = g.surface_type,
        hemisphere = g.hemisphere;

    if( typeof surfaceType !== "string" ) {
      surfaceType = "pial"
    }
    if( typeof hemisphere !== "string" || !['left', 'right'].includes( hemisphere ) ) {
      const mapLeft = this._mapToTemplateSurface( "left", {
        surfaceType : surfaceType, dryRun : true,
        subjectCode : subjectCode
      });
      const mapRight = this._mapToTemplateSurface( "right", {
        surfaceType : surfaceType, dryRun : true,
        subjectCode : subjectCode
      });

      if( !mapLeft || !mapRight ) { return; }
      if( mapLeft.shiftDistance < mapRight.shiftDistance ) {
        hemisphere = "left";
        g.hemisphere = "left";
      } else {
        hemisphere = "right";
        g.hemisphere = "right";
      }
    }

    return this._mapToTemplateSurface( hemisphere, {
      surfaceType : surfaceType, subjectCode : subjectCode
    });

  }

  mapToTemplateVolume({ subjectCode, linear = false, mapToLeptomeningeal = false } = {}) {
    const origSubject = this.subject_code,
          g = this._params;

    //target_group = this.group.get( `Surface - ${surf_type} (${target_subject})` ),
    const mni305Array = g.MNI305_position,
          origPosition = g.position;

    if( typeof subjectCode !== "string" || subjectCode === "" || subjectCode === "/" ) {
      subjectCode = this._canvas.get_state("target_subject");
    }

    const mniPosition = new Vector3();

    if( linear ) {

      const origSubjectData  = this._canvas.shared_data.get( origSubject );
      const tkrRAS_MNI305 = origSubjectData.matrices.tkrRAS_MNI305;
      mniPosition.fromArray( origPosition ).applyMatrix4( tkrRAS_MNI305 );

    } else {
      // check cache
      if( this.object.userData.MNI305_position === undefined ) {
        this.object.userData.MNI305_position = new Vector3().set( 0, 0, 0 );
        if(
          Array.isArray(mni305Array) && mni305Array.length >= 3 &&
          !( mni305Array[0] === 0 && mni305Array[1] === 0 && mni305Array[2] === 0 )
        ) {
          this.object.userData.MNI305_position.fromArray( mni305Array );
        } else {

          // calculate MNI 305 by myself
          const origSubjectData  = this._canvas.shared_data.get( origSubject );
          const tkrRAS_MNI305 = origSubjectData.matrices.tkrRAS_MNI305;

          this.object.userData.MNI305_position
            .fromArray( origPosition ).applyMatrix4( tkrRAS_MNI305 );
        }
      }

      mniPosition.copy( this.object.userData.MNI305_position );
    }

    if( !mniPosition.length() ) { return; }

    const targetSubjectData = this._canvas.shared_data.get( subjectCode );
    const mappedPosition = mniPosition.clone().applyMatrix4( targetSubjectData.matrices.MNI305_tkrRAS );

    let shiftDistance = 0;

    if( mapToLeptomeningeal && typeof g.hemisphere === "string" ) {
      let hemisphere_ = g.hemisphere.toLowerCase();
      if( hemisphere_ === "left" ) {
        hemisphere_ = "Left";
      } else {
        hemisphere_ = "Right";
      }
      const leptoName = `FreeSurfer ${hemisphere_} Hemisphere - pial-outer-smoothed (${subjectCode})`;
      const leptoInstance = this._canvas.threebrain_instances.get( leptoName );

      if( leptoInstance && leptoInstance.isThreeBrainObject ) {
        const projectionOnLepto = projectOntoMesh( mappedPosition , leptoInstance.object );
        mappedPosition.copy( projectionOnLepto.point );
        shiftDistance = projectionOnLepto.distance;
      }
    }

    // TODO: take electrode group into consideration
    this.object.position.copy( mappedPosition );
    this.object.userData._template_mni305 = mniPosition.clone();
    this.object.userData._template_mapped = true;
    this.object.userData._template_space = 'mni305';
    this.object.userData._template_shift = shiftDistance;
    this.object.userData._template_surface = g.surface_type;
    this.object.userData._template_hemisphere = g.hemisphere;

    return {
      mapping : "mni305",
      newPosition: mniPosition.clone()
    }

  }

  mapToTemplate = ( event ) => {
    if( !this.isElectrode ) { return; }

    const mapConfig = event.detail;
    const subjectCode = mapConfig.subject,
          surfaceMapping = mapConfig.surface,
          volumeMapping = mapConfig.volume;
    const g = this._params;

    // not a valid position, do not map
    if( g.position[0] === 0 && g.position[1] === 0 && g.position[2] === 0 ) {
      this.object.position.fromArray( g.position );
      this.object.userData._template_mapped = false;
      this.object.userData._template_space = 'original';
      this.object.userData._template_mni305 = undefined;
      this.object.userData._template_shift = 0;
      this.object.userData._template_surface = g.surface_type;
      this.object.userData._template_hemisphere = g.hemisphere;

      return;
    }

    // check if this is surface mapping is needed
    let result;
    if( g.is_surface_electrode ) {

      if( surfaceMapping === "sphere.reg" ) {
        result = this.mapToTemplateSurface({ subjectCode : subjectCode });

        // result is object, then mapped, return
        if( result ) { return result; }
      }

      if ( surfaceMapping === "mni305" || surfaceMapping === "sphere.reg" ) {
        result = this.mapToTemplateVolume({ subjectCode : subjectCode });
      } else if ( surfaceMapping === "mni305+shift" ) {
        result = this.mapToTemplateVolume({
          subjectCode : subjectCode,
          mapToLeptomeningeal: true
        });
      } else if ( surfaceMapping === "mni305.linear" ) {
        result = this.mapToTemplateVolume({
          subjectCode : subjectCode,
          linear : true
        });
      }
      if( result ) { return result; }
      // result is undefined, surface mapping failed, volume mapping
    } else {
      if ( volumeMapping === "mni305" ) {
        result = this.mapToTemplateVolume({ subjectCode : subjectCode });
      }  else if ( volumeMapping === "mni305.linear" ) {
        result = this.mapToTemplateVolume({
          subjectCode : subjectCode,
          linear : true
        });
      }
      if( result ) { return result; }
    }
    this.object.position.fromArray( g.position );
    this.object.userData._template_mapped = false;
    this.object.userData._template_space = 'original';
    this.object.userData._template_mni305 = undefined;
    this.object.userData._template_shift = 0;
    this.object.userData._template_surface = g.surface_type;
    this.object.userData._template_hemisphere = g.hemisphere;

  }

  finish_init(){

    super.finish_init();

    // switch back to spherical mesh as object
    this.object = this._mesh;

    if( is_electrode( this.object ) ){

      this.isElectrode = true;

      const g = this._params,
            subject_code = this.subject_code;

      this.register_object( ['electrodes'] );
      // electrodes must be clickable, ignore the default settings
      this._canvas.add_clickable( this.name, this.object );

      // this._text_sprite.visible = true;
      const electrode_label = this._canvas.state_data.get("electrode_label");
      if( typeof electrode_label === "object" && electrode_label ) {
        this.set_label_scale( electrode_label.scale || 1.5 );
      } else {
        this.set_label_scale( 1.5 );
      }

      this._canvas.$el.addEventListener(
        "viewerApp.electrodes.mapToTemplate",
        this.mapToTemplate
      )



    }


  }

}


function gen_sphere(g, canvas){
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

  const el = new Sphere(g, canvas);

  if( subject_code ){
    // make sure subject array exists
    canvas.init_subject( subject_code );
  }
  return( el );
}

function add_electrode (canvas, number, name, position, surface_type = 'NA',
                        custom_info = '', is_surface_electrode = false,
                        radius = 2, color = [1,1,0],
                        group_name = '__electrode_editor__',
                        subject_code = '__localization__') {
  if( subject_code === '__localization__' ){
    name = `__localization__, ${number} - `
  }
  let _el;
  if( !canvas.group.has(group_name) ){
    canvas.add_group( {
      name : group_name, layer : 0, position : [0,0,0],
      disable_trans_mat: false, group_data: null,
      parent_group: null, subject_code: subject_code, trans_mat: null
    } );
  }

  // Check if electrode has been added, if so, remove it
  try {
    _el = canvas.electrodes.get( subject_code )[ name ];
    _el.parent.remove( _el );
  } catch (e) {}

  const g = { "name":name, "type":"sphere", "time_stamp":[], "position":position,
          "value":null, "clickable":true, "layer":0,
          "group":{"group_name":group_name,"group_layer":0,"group_position":[0,0,0]},
          "use_cache":false, "custom_info":custom_info,
          "subject_code":subject_code, "radius":radius,
          "width_segments":10,"height_segments":6,
          "is_electrode":true,
          "is_surface_electrode": is_surface_electrode,
          "use_template":false,
          "surface_type": surface_type,
          "hemisphere":null,"vertex_number":-1,"sub_cortical":true,"search_geoms":null};

  if( subject_code === '__localization__' ){
    // look for current subject code
    const scode = canvas.get_state("target_subject");
    const search_group = canvas.group.get( `Surface - ${surface_type} (${scode})` );

    const gp_position = new Vector3(),
          _mpos = new Vector3();
    _mpos.fromArray( position );

    // Search 141 nodes
    if( search_group && search_group.userData ){
      let lh_vertices = search_group.userData.group_data[`free_vertices_Standard 141 Left Hemisphere - ${surface_type} (${scode})`],
          rh_vertices = search_group.userData.group_data[`free_vertices_Standard 141 Right Hemisphere - ${surface_type} (${scode})`],
          is_141 = true;

      if( !lh_vertices || !rh_vertices ){
        is_141 = false;
        lh_vertices = search_group.userData.group_data[`free_vertices_FreeSurfer Left Hemisphere - ${surface_type} (${scode})`];
        rh_vertices = search_group.userData.group_data[`free_vertices_FreeSurfer Right Hemisphere - ${surface_type} (${scode})`];
      }


      const mesh_center = search_group.getWorldPosition( gp_position );
      if( lh_vertices && rh_vertices ){
        // calculate
        let _tmp = new Vector3(),
            node_idx = -1,
            min_dist = Infinity,
            side = '',
            _dist = 0;

        lh_vertices.forEach((v, ii) => {
          _dist = _tmp.fromArray( v ).add( mesh_center ).distanceToSquared( _mpos );
          if( _dist < min_dist ){
            min_dist = _dist;
            node_idx = ii;
            side = 'left';
          }
        });
        rh_vertices.forEach((v, ii) => {
          _dist = _tmp.fromArray( v ).add( mesh_center ).distanceToSquared( _mpos );
          if( _dist < min_dist ){
            min_dist = _dist;
            node_idx = ii;
            side = 'right';
          }
        });
        if( node_idx >= 0 ){
          if( is_141 ){
            g.vertex_number = node_idx;
            g.hemisphere = side;
            g._distance_to_surf = Math.sqrt(min_dist);
          }else{
            g.vertex_number = -1;
            g.hemisphere = side;
            g._distance_to_surf = Math.sqrt(min_dist);
          }
        }

      }
    }
    // calculate MNI305 coordinate
    const mat1 = new Matrix4(),
          pos_targ = new Vector3();
    const v2v_orig = get_or_default( canvas.shared_data, scode, {} ).vox2vox_MNI305;

    if( v2v_orig ){
      mat1.set( v2v_orig[0][0], v2v_orig[0][1], v2v_orig[0][2], v2v_orig[0][3],
                v2v_orig[1][0], v2v_orig[1][1], v2v_orig[1][2], v2v_orig[1][3],
                v2v_orig[2][0], v2v_orig[2][1], v2v_orig[2][2], v2v_orig[2][3],
                v2v_orig[3][0], v2v_orig[3][1], v2v_orig[3][2], v2v_orig[3][3] );
      pos_targ.fromArray( position ).applyMatrix4(mat1);
      g.MNI305_position = pos_targ.toArray();
    }

  }

  canvas.add_object( g );


  _el = canvas.electrodes.get( subject_code )[ name ];
  _el.userData.electrode_number = number;

  if( subject_code === '__localization__' ){
    // make electrode color red
    _el.material.color.setRGB(color[0], color[1], color[2]);
  }

  return( _el );
}


function add_electrode2 (g, canvas){
  const subject_code = g.subject_code;

  if( !subject_code ){
    throw Error("No subject code in `add_electrode2`");
  }

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
  const el = gen_sphere(g, canvas);

  if( !el || typeof(el) !== 'object' || !el.object ){
    return;
  }

  // make sure subject array exists
  canvas.init_subject( subject_code );
  el.finish_init();
  return( el );
}

function is_electrode(e) {
  if(e && e.isMesh && e.userData.construct_params && e.userData.construct_params.is_electrode){
    return(true);
  }else{
    return(false);
  }
}

export { gen_sphere, is_electrode };
