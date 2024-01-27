import { Vector3, SpriteMaterial, DoubleSide, Raycaster, ArrowHelper, Group } from 'three';
import { vector3ToString } from '../utility/vector3ToString.js';
import { getDataCube2 } from '../utility/getDataCube2.js';
import { CONSTANTS } from '../core/constants.js';
import { is_electrode } from '../geometry/sphere.js';
import { intersect_volume, electrode_from_ct } from '../Math/raycast_volume.js';
import { projectOntoMesh } from '../Math/projectOntoMesh.js';
import { getAnatomicalLabelFromPosition } from '../Math/getAnatomicalLabelFromPosition.js';
import { getAnatomicalLabelFromIndex } from '../Math/getAnatomicalLabelFromIndex.js';
import * as download from 'downloadjs';
import { LineSegments2 } from '../jsm/lines/LineSegments2.js';
import { LineMaterial } from '../jsm/lines/LineMaterial.js';
import { LineSegmentsGeometry } from '../jsm/lines/LineSegmentsGeometry.js';
import { getVoxelBlobCenter } from '../Math/getVoxelBlobCenter.js';
import { getClosestVoxel } from '../Math/getClosestVoxel.js';


// Electrode localization
const pos = new Vector3();
const folderName = CONSTANTS.FOLDERS['localization'] || 'Electrode Localization';

const COL_SELECTED = 0xff0000,
      COL_ENABLED = 0xffbb00,
      COL_DISABLED = 0xf1f2d5;


const pal = [0x1874CD, 0x1F75C6, 0x2677BF, 0x2E78B9, 0x357AB2, 0x3C7BAC, 0x447DA5, 0x4B7E9F, 0x528098, 0x598292, 0x61838B, 0x688585, 0x70867E, 0x778878, 0x7E8971, 0x858B6B, 0x8D8C64, 0x948E5E, 0x9B9057, 0xA39151, 0xAA934A, 0xB29444, 0xB9963D, 0xC09737, 0xC89930, 0xCF9A2A, 0xD69C23, 0xDD9E1D, 0xE59F16, 0xECA110, 0xF3A209, 0xFBA403, 0xFFA300, 0xFFA000, 0xFF9D00, 0xFF9A00, 0xFF9700, 0xFF9400, 0xFF9100, 0xFF8E00, 0xFF8B00, 0xFF8800, 0xFF8500, 0xFF8100, 0xFF7E00, 0xFF7B00, 0xFF7800, 0xFF7500, 0xFF7200, 0xFF6F00, 0xFF6C00, 0xFF6900, 0xFF6600, 0xFF6300, 0xFF6000, 0xFF5D00, 0xFF5A00, 0xFF5700, 0xFF5400, 0xFF5100, 0xFF4E00, 0xFF4B00, 0xFF4800, 0xFF4500];

class LocElectrode {
  constructor(
    subject_code, localization_order, initial_position,
    canvas, autoRefine, electrode_scale = 1) {

    this.isLocElectrode = true;
    // temp vector 3
    this.__vec3 = new Vector3().set( 0, 0, 0 );
    this.subject_code = subject_code;
    this.localization_order = localization_order;
    this._canvas = canvas;
    if(Array.isArray(initial_position)){
      this.initialPosition = new Vector3().fromArray( initial_position );
    } else {
      this.initialPosition = initial_position.clone();
    }
    const initialPositionAsArray = this.initialPosition.toArray();

    // if auto refine is enabled
    if( autoRefine === undefined ) {
      autoRefine = this._canvas.get_state( "auto_refine_electrodes", false );
    }
    this._adjustRadiusBase = 1.0;
    if( autoRefine && typeof autoRefine === "number" && autoRefine > 0 ) {
      this._adjustRadiusBase = autoRefine;
    }

    this.Hemisphere = canvas.get_state("newElectrodesHemisphere", "auto");

    // get fs Label
    this.atlasLabels = {};
    this.atlasLabels[ "aseg" ] = { index : 0 , label : "Unknown" };
    this.atlasLabels[ "aparc+aseg" ] = { index : 0 , label : "Unknown" };
    this.atlasLabels[ "aparc.DKTatlas+aseg" ] = { index : 0 , label : "Unknown" };
    this.atlasLabels[ "aparc.a2009s+aseg" ] = { index : 0 , label : "Unknown" };
    this.atlasLabels[ "manual" ] = undefined;
    this.computeFreeSurferLabel();


    if( this.Hemisphere !== "left" && this.Hemisphere !== "right" ) {
      const regex = /(lh|rh|left|right)\-/g;

      for(let atlasType in this.atlasLabels) {
        const atlasLabel = this.atlasLabels[ atlasType ];
        if( atlasLabel && typeof atlasLabel === "object" && typeof atlasLabel.label === "string" ) {
          const m = regex.exec( atlasLabel.label.toLowerCase() );
          if( m && m.length >= 2 ){
            if( m[1][0] == "r" ) {
              this.Hemisphere = "right";
              break;
            } else if( m[1][0] == "l" ) {
              this.Hemisphere = "left";
              break;
            }
          }
        }
      }
    }

    if( this.Hemisphere !== "left" && this.Hemisphere !== "right" ) {
      // cannot determine from the FreeSurfer label, use this._determineHemisphere to decide
      this.Hemisphere = this._determineHemisphere({
        electrodePosition : this.initialPosition
      }) || "left";
    }

    this.Label = "NoLabel" + this.localization_order;
    this.Electrode = "";
    // leptomeningeal projection (this initialization makes sure if lepto is not found, we can still
    // project to pial)
    this.brainShiftEnabled = false;
    this.leptoPosition = this.initialPosition.clone(); // projected on leptomeningeal in world RAS
    this.distanceToLepto = 0;    // distance to leptoPosition

    // when shifted, shiftedPosition = a * this.leptoPosition + (1-a) _globalPosition,
    // a might not be zero when soft thresholding
    this.shiftedPosition = this.initialPosition.clone();
    this.distanceToShifted = 0;
    this.distanceFromShiftedToPial = 0;

    this.pialPosition = this.initialPosition.clone(); // position on pial surface (projected)
    this.distanceToPial = 0;    // distance to pial surface from _globalPosition

    this.pialVertexIndex = NaN; // nearest vertex index for this.pialPosition
    this.spherePosition = new Vector3(); // position on sphere.reg

    this._orig_name = `${this.subject_code}, ${this.localization_order} - ${this.Label}`;
    this._scale = electrode_scale;
    this._globalPosition = this.initialPosition.clone(); // used for cache, not accurate

    const inst = canvas.add_object({
      "name": this._orig_name,
      "type": "sphere",
      "time_stamp": [],
      "position": initialPositionAsArray,
      "value": null,
      "clickable": true,
      "layer": 0,
      "group":{
        "group_name": `group_Electrodes (${this.subject_code})`,
        "group_layer": 0,
        "group_position":[0,0,0]
      },
      "use_cache":false,
      "custom_info": "",
      "subject_code": this.subject_code,
      "radius": 1,
      "width_segments": 10,
      "height_segments": 6,
      "is_electrode":true,
      "is_surface_electrode": false, // dummy, use this.brainShiftEnabled
      "use_template":false,
      "surface_type": 'pial',
      "hemisphere": this.Hemisphere,
      "vertex_number": -1,
      "sub_cortical": true,
      "search_geoms": null,
      "custom_info" : autoRefine && this._adjustRadiusBase < 1 ? `Average spacing offset ${ this._adjustRadiusBase.toFixed(4) } mm (before refining)` : ""
    });

    this.instance = inst;
    this.object = inst.object;
    this.object.userData.localization_instance = this;
    this.update_color( COL_ENABLED );

    // set up label;
    this.instance.label = this.localization_order;
    this.instance.set_label_visible(true);
    // this.object.scale.set( this._scale, this._scale, this._scale );

    // Add line to indicate shift
    const line_geometry = new LineSegmentsGeometry();
    line_geometry.setPositions( [
      0,0,0,
      0,0,0
    ] );
    const line_material = new LineMaterial( {
      color: 0x0000ff,
      // depthTest: false,
      linewidth: 3,
      side: DoubleSide
    } );
    const line = new LineSegments2( line_geometry, line_material );
    this._line = line;
    line.computeLineDistances();
    line.scale.set( 1/this._scale , 1/this._scale , 1/this._scale );
    line_material.resolution.set(
      this._canvas.client_width || window.innerWidth,
      this._canvas.client_height || window.innerHeight
    );
    this.object.add( line );

    // brain-shift helper for surface electrodes

    // re-use __vec3
    this.shiftHelperGroup = new Group();
    this.shiftHelperGroup.visible = false;
    this.shiftHelperToShifted = new ArrowHelper();
    this.shiftHelperToShifted.setColor( 0xff0000 );
    this.shiftHelperToShifted.setLength( 0 );
    this.shiftHelperGroup.add( this.shiftHelperToShifted );

    this.shiftHelperToPial = new ArrowHelper();
    this.shiftHelperToPial.setColor( 0x0000ff );
    this.shiftHelperToPial.setLength( 0 );
    this.shiftHelperGroup.add( this.shiftHelperToPial );

    this.object.add( this.shiftHelperGroup );

    this.updateScale();
    this._enabled = true;

    // update project->lepto->pial
    this.updateProjection();

    if( autoRefine ) {
      this.adjust({ force: true });
    }

  }

  _determineHemisphere({ electrodePosition } = {}) {
    const leftPialName = `FreeSurfer Left Hemisphere - pial (${ this.subject_code })`;
    const rightPialName = `FreeSurfer Right Hemisphere - pial (${ this.subject_code })`;

    const leftPialInstance = this._canvas.threebrain_instances.get( leftPialName );
    const rightPialInstance = this._canvas.threebrain_instances.get( rightPialName );

    if( leftPialInstance === undefined ) {
      return "right";
    }
    if( rightPialInstance === undefined ) {
      return "left";
    }

    if( !electrodePosition ) {
      electrodePosition = this.object.getWorldPosition( this._globalPosition );
    }
    const projectLeft = projectOntoMesh( electrodePosition, leftPialInstance.object );
    const projectRight = projectOntoMesh( electrodePosition, rightPialInstance.object );
    if( projectLeft.distance < projectRight.distance ) {
      return "left";
    } else {
      return "right";
    }
  }

  _getSurfaceInstance({ hemisphere, surfaceType = "pial" } = {}) {
    if( hemisphere === undefined || typeof hemisphere !== "string" ) {
      hemisphere = this.Hemisphere;
      if( typeof hemisphere !== "string" ) {
        hemisphere = this._determineHemisphere() || "left";
      }
    }
    hemisphere = hemisphere.toLowerCase();
    let instanceName;
    if( hemisphere[0] === "l" ) {
      instanceName = `FreeSurfer Left Hemisphere - ${ surfaceType } (${ this.subject_code })`;
    } else {
      instanceName = `FreeSurfer Right Hemisphere - ${ surfaceType } (${ this.subject_code })`;
    }
    const instance = this._canvas.threebrain_instances.get( instanceName );
    return instance;
  }

  projectToLepto({hemisphere, direction} = {}) {
    const leptoInstance = this._getSurfaceInstance({
      hemisphere : hemisphere, surfaceType : "pial-outer-smoothed"
    });

    if( !leptoInstance ) {
      // Cannot find surface [pial-outer-smoothed], no such projection
      this.leptoPosition.copy( this.object.position );
      this.distanceToLepto = 0;
      this.updateShiftHelper();
      return;
    }

    // compute electrode position in leptomeningeal's model position
    const electrodePosition = this.object.getWorldPosition( this._globalPosition );

    // project electrode onto smooth envelope
    const projectionOnLepto = projectOntoMesh( electrodePosition , leptoInstance.object );
    this.leptoPosition.copy( projectionOnLepto.point );
    this.distanceToLepto = projectionOnLepto.distance;

    // update shift helper
    this.updateShiftHelper();

    // this.updateShiftHelper will run projectToPial
    // this.projectToPial();

    return {
      instance    : leptoInstance,
      point       : this.leptoPosition,
      distance    : this.distanceToLepto,
    };
  }

  projectToPial({ hemisphere } = {}) {
    const pialInstance = this._getSurfaceInstance({ hemisphere : hemisphere, surfaceType : "pial" });
    const sphereInstance = this._getSurfaceInstance({ hemisphere : hemisphere, surfaceType : "sphere.reg" });

    if( !pialInstance ) {
      // Cannot find surface [pial-outer-smoothed], no such projection
      this.pialPosition.copy( this.object.position );
      this.distanceToPial = 0;
      this.pialVertexIndex = NaN;
      return;
    }

    const electrodePosition = this.object.getWorldPosition( this._globalPosition );
    const shiftThreshold = this._canvas.get_state( "brain_shift_max", 0 );
    this.distanceToShifted = this.distanceToLepto < shiftThreshold ? this.distanceToLepto : shiftThreshold;
    this.shiftedPosition.copy( this.leptoPosition )
      .sub( electrodePosition ).normalize().multiplyScalar( this.distanceToShifted )
      .add( electrodePosition );

    const projectionOnPial = projectOntoMesh( this.shiftedPosition , pialInstance.object );
    this.pialPosition.copy( projectionOnPial.point );
    this.pialVertexIndex = projectionOnPial.vertexIndex;
    this.distanceToPial = this.pialPosition.distanceTo( electrodePosition );
    this.distanceFromShiftedToPial = this.pialPosition.distanceTo( this.shiftedPosition );

    // update position on sphere.reg
    if( !sphereInstance ) { return; }
    const spherePositionAttribute = sphereInstance.object.geometry.getAttribute("position");
    this.spherePosition.x = spherePositionAttribute.getX( this.pialVertexIndex );
    this.spherePosition.y = spherePositionAttribute.getY( this.pialVertexIndex );
    this.spherePosition.z = spherePositionAttribute.getZ( this.pialVertexIndex );

    return {
      instance    : pialInstance,
      point       : this.pialPosition,
      distance    : this.distanceToPial,
      vertexIndex : this.pialVertexIndex,
      spherePosition  : this.spherePosition
    };
  }

  updateShiftHelper({ electrodePosition } = {}) {
    if( !electrodePosition ) {
      electrodePosition = this.object.getWorldPosition( this._globalPosition );
    } else {
      this._globalPosition.copy( electrodePosition );
    }
    this.projectToPial();

    const shiftThreshold = this._canvas.get_state( "brain_shift_max", 0 );
    const shiftMode = this._canvas.get_state( "brain_shift_mode", "disabled" );
    const withinThreshold = this.distanceToLepto < shiftThreshold;

    // update helper from electrode to shifted
    const shift = this._globalPosition.sub( this.shiftedPosition ).multiplyScalar( -1 );
    this.shiftHelperToPial.position.copy( shift );
    this.shiftHelperToShifted.setDirection( shift.normalize() );
    this.shiftHelperToShifted.setLength( this.distanceToShifted );

    // update helper from shifted to pial
    shift.copy( this.pialPosition ).sub( this.shiftedPosition );
    this.shiftHelperToPial.setDirection( shift.normalize() );
    this.shiftHelperToPial.setLength( this.distanceFromShiftedToPial );

    switch (shiftMode) {
      case 'hard threshold':
        this.brainShiftEnabled = withinThreshold;
        break;
      case 'soft threshold':
        this.brainShiftEnabled = true;
        break;
      default:
        this.brainShiftEnabled = false;
    }
    this.shiftHelperGroup.visible = this.brainShiftEnabled;

  }

  updateProjection() {
    this.projectToLepto();
    // this.projectToPial();
  }

  dispose() {
    this.object.userData.dispose();
    try {
      const collection = this._canvas.electrodes.get(this.subject_code);
      if( collection.hasOwnProperty(this._orig_name) ){
        delete collection[ this._orig_name ];
      }
    } catch (e) {}
  }

  computeFreeSurferLabel({ position } = {}) {
    if( !position ) {
      if( this.brainShiftEnabled ) {
        position = this.leptoPosition;
      } else if ( this.object ) {
        position = this.object.getWorldPosition( this._globalPosition );
      } else {
        position = this.initialPosition;
      }
    }
    let inst;
    let maxStepSize = 2.0;

    if( this.brainShiftEnabled ) {
      // surface electrode, make sure the step size can reach pial surface
      maxStepSize = this.distanceFromShiftedToPial + 1;
      if( maxStepSize > 10 ) {
        maxStepSize = 10;
      } else if ( maxStepSize < 2 ) {
        maxStepSize = 2;
      }
    }

    // aseg
    inst = getDataCube2( this._canvas, "aseg", this.subject_code );
    this.atlasLabels[ "aseg" ] = getAnatomicalLabelFromPosition(
      this._canvas, position, inst, { maxStepSize : maxStepSize, hemisphere : this.Hemisphere } );

    // aparc+aseg
    inst = getDataCube2( this._canvas, "aparc_aseg", this.subject_code );
    this.atlasLabels[ "aparc+aseg" ] = getAnatomicalLabelFromPosition(
      this._canvas, position, inst, { preferredIndexRange : [
        [1001, 1035], [2001, 2035], [3001, 3035], [4001, 4035], // 2005 aparc labels, pial + white
        [1101, 1212], [2101, 2212], [3101, 3181], [4101, 4181], // 2005 seg values
        [3201, 3207], [4201, 4207]
      ], maxStepSize : maxStepSize, hemisphere : this.Hemisphere } );

    // aparc.DKTatlas+aseg
    inst = getDataCube2( this._canvas, "aparc_DKTatlas_aseg", this.subject_code );
    this.atlasLabels[ "aparc.DKTatlas+aseg" ] = getAnatomicalLabelFromPosition(
      this._canvas, position, inst, { preferredIndexRange : [
        [1001, 1035], [2001, 2035], [3001, 3035], [4001, 4035], // 2005 aparc labels, pial + white
        [1101, 1212], [2101, 2212], [3101, 3181], [4101, 4181], // 2005 seg values
        [3201, 3207], [4201, 4207]
      ], maxStepSize : maxStepSize, hemisphere : this.Hemisphere } );

    // aparc.a2009s+aseg
    inst = getDataCube2( this._canvas, "aparc_a2009s_aseg", this.subject_code );
    this.atlasLabels[ "aparc.a2009s+aseg" ] = getAnatomicalLabelFromPosition(
      this._canvas, position, inst, { preferredIndexRange : [
        [11101, 11175], [12101, 12175], [13101, 13175], [14101, 14175],
        [1001, 1035], [2001, 2035], [3001, 3035], [4001, 4035], // 2005 aparc labels, pial + white
        [1101, 1212], [2101, 2212], [3101, 3181], [4101, 4181], // 2005 seg values
        [3201, 3207], [4201, 4207]
      ], maxStepSize : maxStepSize, hemisphere : this.Hemisphere } );

    return this.atlasLabels;
  }

  useFreeSurferIndex( index ) {
    // this will only change manual
    this.atlasLabels[ "manual" ] = getAnatomicalLabelFromIndex( this._canvas, index );
    return this.atlasLabels;
  }

  update_label( label ){
    this.Label = label || ("N/A " + this.localization_order);
    const name = `${this.subject_code}, ${this.localization_order} - ${this.Label}`;
    this.instance.label = `${this.localization_order}-${this.Label}`;
    // this._map.draw_text( `${this.localization_order}-${this.Label}` );
    this.instance._params.name = name;
  }

  update( params ){
    const g = this.instance._params;
    for( let k in params ){
      switch (k) {
        case 'Electrode':
          this[k] = params[k];
          break;
        case 'FSIndex':
          this.useFreeSurferIndex( params[k] );
          break;
        case 'Label':
          this.update_label( params.Label );
          break;
        case 'SurfaceType':
          g.surface_type = params[k];
          break;
        case 'Radius':
          g.radius = parseFloat(params[k]);
          this.updateScale();
          break;
        case 'VertexNumber':
          g.vertex_number = parseInt(params[k]);
          break;
        case 'Hemisphere':
          const h = params[k].toLowerCase();
          if( h === "left" || h === "right" ) {
            const oldValue = this.Hemisphere;
            this.Hemisphere = h;
            g.hemisphere = h;
            if( oldValue !== h ) {
              this.computeFreeSurferLabel();
            }
          }
          break;
        case 'Notes':
          g.custom_info = params[k];
          break;
        default:
          // skip
      }
    }
  }

  updateScale( scale ){
    if( scale ){
      this._scale = scale;
    }
    // if( text_scale ){
    //   this._text_scale = text_scale;
    // }
    const v = this._scale * this.instance._params.radius;
    this.object.scale.set( v, v, v );
    this._line.scale.set( 1 / v, 1 / v, 1 / v );
    this.shiftHelperGroup.scale.set( 1 / v, 1 / v, 1 / v );
  }

  update_color( color ){
    if( !color ){
      if(this.enabled()){
        color = COL_ENABLED;
      } else {
        color = COL_DISABLED;
      }
    }
    this.instance.defaultColor.set( color );
    this.object.material.color.set( color );
  }

  reset_position() {
    this.object.position.copy( this.initialPosition );
    this.instance._params.position[0] = this.initialPosition.x;
    this.instance._params.position[1] = this.initialPosition.y;
    this.instance._params.position[2] = this.initialPosition.z;
    this.update_line();
  }

  update_line() {
    const positions = this._line.geometry.attributes.position;
    const dst = this.__vec3.copy( this.initialPosition ).sub( this.object.position );

    //__canvas.object_chosen.position.set(0,0,0)
    const inst_start = this._line.geometry.attributes.instanceStart.data.array,
          inst_end   = this._line.geometry.attributes.instanceEnd.data.array;

    inst_start[3] = dst.x;
    inst_start[4] = dst.y;
    inst_start[5] = dst.z;
    inst_end[3] = dst.x;
    inst_end[4] = dst.y;
    inst_end[5] = dst.z;
    this._line.geometry.attributes.instanceStart.needsUpdate = true;
    this._line.geometry.attributes.instanceEnd.needsUpdate = true;

    /*
    positions.array[0] = dst.x;
    positions.array[1] = dst.y;
    positions.array[2] = dst.z;
    positions.needsUpdate = true;
    */

    // update length
    let shift_idx = Math.floor(dst.length() * 10);
    if( shift_idx > 63 ){
      shift_idx = 63;
    }
    this._line.material.color.set( pal[shift_idx] );
    this.updateScale();
  }

  enabled() {
    return( this._enabled === true );
  }
  enable() {
    this.update_color( COL_ENABLED );
    this._enabled = true;
  }
  disable() {
    this.update_color( COL_DISABLED );
    this._enabled = false;
  }

  set_mode( mode ) {
    this.mode = mode;
  }

  get_volume_instance(){
    const atlas_type = this._canvas.get_state("atlas_type") || "none",
          sub = this.subject_code,
          inst = this._canvas.threebrain_instances.get(`Atlas - ${atlas_type} (${sub})`);
    if( inst && inst.isDataCube2 ){
      return( inst );
    }
    return;
  }

  adjust({ force = false, baseRadius = undefined } = {}) {
    if( !force && this.mode !== "CT/volume" ){ return; }
    const inst = this.get_volume_instance();
    if( !inst ){ return; }

    if( typeof baseRadius === "number" ) {
      this._adjustRadiusBase = baseRadius;
    } else {
      baseRadius = this._adjustRadiusBase;
    }
    if( baseRadius > 1.0 ) {
      baseRadius = 1.0;
    }

    let pos = this._adjust({ radius : 1.0 * baseRadius });
    this._setPosition( pos );


    pos = this._adjust({ radius : 2.0 * baseRadius });
    this._setPosition( pos );

    pos = this._adjust({ radius : 4.0 * baseRadius, force : true });
    this._setPosition( pos );

    this.update_line();
    this.updateProjection();
  }

  _setPosition( pos ) {
    if( !pos || typeof pos !== "object" || !pos.isVector3 ) { return; }
    const position = this.instance._params.position;
    position[0] = pos.x;
    position[1] = pos.y;
    position[2] = pos.z;
    this.object.position.copy( pos );
  }

  _adjust({ radius = 2.0, force = false } = {}) {

    const inst = this.get_volume_instance();

    const matrix_ = inst.object.matrixWorld.clone(),
          matrix_inv = matrix_.clone().invert();

    const modelShape = new Vector3().copy( inst.modelShape );
    const mx = modelShape.x,
          my = modelShape.y,
          mz = modelShape.z;
    const ct_data = inst.voxelData;

    let ct_threshold_min = inst.__dataLB;
    if( inst._selectedDataValues.length > 0 ) {
      ct_threshold_min = inst._selectedDataValues[0];
    }

    const pos = new Vector3().set(1, 0, 0),
          pos0 = new Vector3().set(0, 0, 0).applyMatrix4(matrix_);
    // calculate voxel size and IJK delta
    const voxDim = new Vector3().set(
      pos.set(1, 0, 0).applyMatrix4(matrix_).sub(pos0).length(),
      pos.set(0, 1, 0).applyMatrix4(matrix_).sub(pos0).length(),
      pos.set(0, 0, 1).applyMatrix4(matrix_).sub(pos0).length()
    )
    const delta = new Vector3().set(
      1 / voxDim.x,
      1 / voxDim.y,
      1 / voxDim.z
    );

    // default search nearest +-2mm voxels,
    // assuming electrodes are most likely to be contained

    // allowed radius is too small or the image is too , do not adjust
    /*if( radius < voxDim.length() ) { return; }
    let max_step_size = 2 * voxDim.length();
    if ( max_step_size <= radius ) { max_step_size}
    Math.max( radius,  );*/

    // force = true means ignoring radius when too small
    if( !force && radius < voxDim.length() ) { return; }
    const max_step_size = Math.max(radius, 2 * voxDim.length())

    // get position
    const position = this.instance._params.position;
    pos0.fromArray( position );
    pos.fromArray( position ).applyMatrix4( matrix_inv );

    // (p - vec3(0.5, -0.5, 0.5)) * scale_inv + 0.5
    // (pos+margin_voxels/2) is in IJK voxel coordinate right now
    // pos + margin_lengths/2 places the origin at voxel IJK corner
    // (pos + margin_lengths/2) / f scales to the voxel IJK corner
    //
    const ijk0 = new Vector3().set(
      Math.round( ( pos.x + modelShape.x / 2 ) - 1.0 ),
      Math.round( ( pos.y + modelShape.y / 2 ) - 1.0 ),
      Math.round( ( pos.z + modelShape.z / 2 ) - 1.0 )
    );
    const ijk1 = new Vector3().set(
      Math.max( Math.min( ijk0.x, mx - delta.x * max_step_size - 1 ), delta.x * max_step_size ),
      Math.max( Math.min( ijk0.y, my - delta.y * max_step_size - 1 ), delta.y * max_step_size ),
      Math.max( Math.min( ijk0.z, mz - delta.z * max_step_size - 1 ), delta.z * max_step_size )
    );

    const ijkLB = new Vector3().set(
      Math.round( ijk1.x - delta.x * max_step_size ),
      Math.round( ijk1.y - delta.y * max_step_size ),
      Math.round( ijk1.z - delta.z * max_step_size )
    );
    const ijkUB = new Vector3().set(
      Math.round( ijk1.x + delta.x * max_step_size ),
      Math.round( ijk1.y + delta.y * max_step_size ),
      Math.round( ijk1.z + delta.z * max_step_size )
    );
    const subVolumeShape = ijkUB.clone().sub(ijkLB).addScalar(1);
    const subVolume = new Float32Array( subVolumeShape.x * subVolumeShape.y * subVolumeShape.z );

    const multiply_factor = new Vector3().set( 1, mx, mx * my );
    const ijk_idx = new Vector3();

    let tmp;
    for( ijk_idx.x = ijkLB.x; ijk_idx.x <= ijkUB.x; ijk_idx.x += 1 ) {
      for( ijk_idx.y = ijkLB.y; ijk_idx.y <= ijkUB.y; ijk_idx.y += 1 ) {
        for( ijk_idx.z = ijkLB.z; ijk_idx.z <= ijkUB.z; ijk_idx.z += 1  ) {
          tmp = ct_data[ ijk_idx.dot(multiply_factor) ];

          subVolume[
            ijk_idx.x - ijkLB.x + subVolumeShape.x * ( ijk_idx.y - ijkLB.y + subVolumeShape.y * ( ijk_idx.z - ijkLB.z ))
          ] = tmp;
        }
      }
    }

    const ijk_new = getVoxelBlobCenter({
      x: subVolume,
      dim: subVolumeShape,
      initial: ijk0.clone().sub(ijkLB),
      sliceDensity: delta,
      maxSearch: max_step_size,
      threshold: ct_threshold_min
    });
    ijk_new.add( ijkLB );

    // (ijk + 0.5 - margin_voxels / 2) * f
    ijk_new.multiplyScalar( 2.0 ).sub( modelShape ).addScalar( 1.0 ).multiplyScalar( 0.5 );
    pos.copy( ijk_new );

    // reverse back
    pos.applyMatrix4( matrix_ );

    /*
    if(this.__interpolate_direction && this.__interpolate_direction.isVector3) {
      // already normalized
      const interp_dir = this.__interpolate_direction.clone();

      // reduce moving along interpolate_direction
      pos.copy( pos ).sub( pos0 );
      const inner_prod = pos.dot( interp_dir );
      pos.sub( interp_dir.multiplyScalar( inner_prod * 0.9 ) ).add( pos0 );
    }
    */

    return pos;
  }

}

function electrode_from_slice( scode, canvas ){
  const sliceInstance = canvas.get_state( "activeSliceInstance" );
  if( !sliceInstance || typeof(sliceInstance) !== "object" ||
    !sliceInstance.isDataCube ) { return; }
  const planes = sliceInstance.object;

  canvas.mouseRaycaster.layers.set( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );

  const items = canvas.mouseRaycaster.intersectObjects( planes );

  if( !items.length ){ return; }

  const p = items[0].point;
  pos.copy( p );
  return( pos );
}

function interpolate_electrode_from_ct( inst, canvas, electrodes, settings ){
  /**
   * settings = {
        rawInput : "<this is the user input>",
        strictSpacing : true,
        spacings  : [1.1,1.2,1.1,1.1,1.2,1,1,1],
        size      : spacings.length - 1, <- contacts to be interpolated
        distance  : spacings.reduce((a, b) => { return a + b; }) <- total expected distance
      };
   */
  if( !inst ){ return; }
  if( electrodes.length < 2 ){ return; }
  if( !settings || settings.spacings.length < 2 ){ return; }
  const src = canvas.mainCamera.position;

  // position of starting point
  const dst = new Vector3();
  electrodes[electrodes.length - 2].object.getWorldPosition( dst );

  // position of end point
  const end = new Vector3();
  electrodes[electrodes.length - 1].object.getWorldPosition( end );

  const direction = end.clone().sub( dst );

  let remainingDistance = settings.distance;

  // real vs expected spacing ratios
  let distanceRatio = direction.length() / remainingDistance;
  let totalLength = 0;
  let spacingOffset = 0;

  // position of last localized electrode
  const prev = dst.clone();

  const n = settings.spacings.length - 1;
  const step = new Vector3();
  const tmp = new Vector3();
  const est = new Vector3();

  const dir = new Vector3();
  const re = [];

  let added = false;
  for( let ii = 0; ii < n; ii++ ){

    const expectedSpacing = settings.spacings[ ii ];
    step.copy( prev ).sub( end ).multiplyScalar( 1 / remainingDistance );
    remainingDistance -= expectedSpacing;
    tmp.copy( step ).multiplyScalar( remainingDistance );
    est.copy( end ).add( tmp );
    dir.copy( est ).sub( src ).normalize();

    // adjust
    added = false;
    const stepLength = expectedSpacing * distanceRatio;

    const res = getClosestVoxel( inst, est, stepLength * 1.0, prev, stepLength * 0.8);
    if( isFinite( res.minDistance ) ) {
      const actualSpacing = prev.distanceTo( res.minDistanceXYZ );
      spacingOffset += Math.abs( actualSpacing - stepLength );
      totalLength += actualSpacing;
      prev.copy( res.minDistanceXYZ );
      re.push( res.minDistanceXYZ );
      added = true;
    }
    /*
    for( let delta = 0.5; delta < step.length() / 2; delta += 0.5 ){
      const res = intersect_volume(src, dir, inst, canvas, delta, false);
      if(!isNaN(res.x) && res.distanceTo(est) < 10 + delta / 10 ){
        prev.copy( res );
        re.push( res.clone() );
        added = true;
        break;
      }
    }
    if(!added) {
      const res = getClosestVoxel( inst, est, step.length() * 2.0, prev, step.length() * 0.8);
      if( isFinite( res.minDistance ) ) {
        prev.copy( res.minDistanceXYZ );
        re.push( res.minDistanceXYZ );
        added = true;
      }
    }
    */
    if(!added) {
      const actualSpacing = prev.distanceTo( est );
      spacingOffset += Math.abs( actualSpacing - stepLength );
      totalLength += actualSpacing;
      prev.copy( est );
      re.push( est.clone() );
    }

  }

  totalLength += prev.distanceTo( end );
  spacingOffset += Math.abs( prev.distanceTo( end ) - settings.spacings[ n ] );

  return({
    positions : re,
    direction : direction,
    strictSpacing : settings.strictSpacing,
    distanceRatio : totalLength / settings.distance,
    expectedSpacing : settings.distance,
    averageOffset : spacingOffset / ( n + 1 )
  });
}

function extrapolate_electrode_from_ct( inst, canvas, electrodes, settings ){
  /**
   * settings = {
        rawInput : "<this is the user input>",
        strictSpacing : true,
        spacings  : [1.1,1.2,1.1,1.1,1.2,1,1,1],
        distance  : spacings.reduce((a, b) => { return a + b; }) <- total expected distance
      };
   */
  if( !inst ){ return; }
  if( electrodes.length < 2 ){ return; }
  if( !settings || settings.spacings.length < 2 ){ return; }
  const src = canvas.mainCamera.position;
  const dst = new Vector3();
  const prev = new Vector3();
  const start = new Vector3()
  electrodes[electrodes.length - 2].object.getWorldPosition( start );
  electrodes[electrodes.length - 1].object.getWorldPosition( prev );
  dst.copy( start );

  /**
   * Unlike interpolate, the first two electrodes might be too far-away
   * The distanceRatio should be calculated at the final stage.
   *
   * Also extrapolation require one less than interpolation
   */
  const n = settings.spacings.length - 1; // electrodes to extrapolate
  const direction = prev.clone().sub( dst );

  // calculate initial distanceRatio
  const strictSpacing = settings.strictSpacing;
  let distanceRatio = direction.length() / settings.spacings[ 0 ];
  let totalLength = direction.length();
  let spacingOffset = Math.abs( totalLength - settings.spacings[ 0 ] );

  const step = direction.clone();
  const tmp = new Vector3();
  const est = new Vector3();

  const dir = new Vector3();
  const re = [];

  // prev is most recently registered electrode
  est.copy( prev );
  let added = false;
  let distanceToPrev;
  for( let ii = 1; ii <= n; ii++ ){

    const expectedSpacing = settings.spacings[ ii ];
    const stepLength = (strictSpacing ? 1.0 : distanceRatio) * expectedSpacing;
    step.copy( prev ).sub( dst ).normalize().multiplyScalar( stepLength );
    est.copy( prev ).add( step );
    dir.copy( est ).sub( src ).normalize();

    // adjust the est
    added = false
    /*
    for( let delta = 0.5; delta < stepLength * 0.3; delta += 0.5 ){
      const res = intersect_volume(src, dir, inst, canvas, delta, false);
      if(!isNaN(res.x) && res.distanceTo(est) < 10 + delta / 10){
        distanceToPrev = res.distanceTo( prev );
        if(
          distanceToPrev > 0.7 * stepLength &&
            distanceToPrev < 1.3 * stepLength
        ) {
          re.push( res.clone() );
          dst.copy( prev );
          prev.copy( res );
          added = true;
          break;
        }
      }
    }*/
    if( !added ) {

      const res = getClosestVoxel( inst, est, stepLength * 1.0, prev, stepLength * 0.8);
      if( isFinite( res.minDistance ) ) {
        const actualSpacing = prev.distanceTo( res.minDistanceXYZ );
        totalLength += actualSpacing;
        spacingOffset += Math.abs( actualSpacing - stepLength );

        dst.copy( prev );
        prev.copy( res.minDistanceXYZ );
        re.push( res.minDistanceXYZ );
        added = true;
      }
    }
    if( !added ) {
      const actualSpacing = prev.distanceTo( est );
      totalLength += actualSpacing;
      spacingOffset += Math.abs( actualSpacing - stepLength );

      dst.copy( prev );
      prev.copy( est );
      re.push( est.clone() );
    }
  }

  direction.copy( prev ).sub( start );

  return({
    positions : re,
    direction : direction,
    strictSpacing : settings.strictSpacing,
    distanceRatio : totalLength / settings.distance,
    expectedSpacing : settings.distance,
    // only useful when strictSpacing is true
    averageOffset : spacingOffset / ( n + 1 )
  });
}

function interpolate_electrode_from_slice( canvas, electrodes, settings ){
  /**
   * settings = {
        rawInput : "<this is the user input>",
        strictSpacing : true,
        spacings  : [1.1,1.2,1.1,1.1,1.2,1,1,1],
        distance  : spacings.reduce((a, b) => { return a + b; }) <- total expected distance
      };
   */
  if( electrodes.length < 2 ){ return; }
  if( settings.spacings.length < 2 ){ return; }

  const dst = new Vector3();
  electrodes[electrodes.length - 2].object.getWorldPosition( dst );

  const direction = new Vector3();
  electrodes[electrodes.length - 1].object.getWorldPosition( direction );
  direction.sub( dst );

  const distanceRatio = direction.length() / settings.distance;

  const n = settings.spacings.length - 1; // n to interpolate
  const step = direction.clone();
  const est = new Vector3();

  let res;
  const re = [];

  let cumSpacing = 0;
  for( let ii = 0; ii < n; ii++ ){

    cumSpacing += settings.spacings[ ii ];
    step.normalize().multiplyScalar( cumSpacing * distanceRatio );
    est.copy( dst ).add( step );

    re.push( est.clone() );
  }

  return({
    positions : re,
    direction : direction,
    strictSpacing : settings.strictSpacing,
    distanceRatio : distanceRatio,
    expectedSpacing : settings.distance,
    averageOffset : Math.abs(1 - distanceRatio) * settings.distance / ( n + 2 )
  });
}

function extrapolate_electrode_from_slice( canvas, electrodes, settings ){
  /**
   * settings = {
        rawInput : "<this is the user input>",
        strictSpacing : true,
        spacings  : [1.1,1.2,1.1,1.1,1.2,1,1,1],
        distance  : spacings.reduce((a, b) => { return a + b; }) <- total expected distance
      };
   */
  if( electrodes.length < 2 ){ return; }
  if( settings.spacings.length < 2 ){ return; }

  const dst = new Vector3();
  electrodes[electrodes.length - 2].object.getWorldPosition( dst );

  const direction = new Vector3();
  electrodes[electrodes.length - 1].object.getWorldPosition( direction );
  direction.sub( dst );

  const distanceRatio = direction.length() / settings.spacings[0];

  const n = settings.spacings.length - 1; // n to interpolate
  const step = direction.clone();
  const est = dst.clone().add( step );

  let res;
  const re = [];

  let cumSpacing = settings.spacings[ 0 ];
  for( let ii = 1; ii <= n; ii++ ){

    cumSpacing += settings.spacings[ ii ];
    step.normalize().multiplyScalar( cumSpacing * distanceRatio );
    est.copy( dst ).add( step );

    re.push( est.clone() );
  }

  direction.copy( est ).sub( dst );

  return({
    positions : re,
    direction : direction,
    strictSpacing : settings.strictSpacing,
    distanceRatio : distanceRatio,
    expectedSpacing : settings.distance,
    averageOffset : Math.abs(1 - distanceRatio) * settings.distance / ( n + 2 )
  });
}

function register_controls_localization( ViewerControlCenter ){

  ViewerControlCenter.prototype.intersectActiveDataCube2 = function( mode ) {
    // mode can be "CT/volume", "MRI slice", or "refine"
    // default is to derive from controller

    if( typeof mode !== "string" ) {
      const controller = this.gui.getController( 'Edit Mode' );
      if( !controller || controller.isfake ) { return }
      mode = controller.getValue();
    }

    const subjectCode = this.canvas.get_state("target_subject");
    if( !subjectCode || subjectCode == '' ) { return; }

    this.canvas.updateRaycast();

    let position;
    switch(mode){
      case "CT/volume":
        const inst = this.getActiveDataCube2();
        position = electrode_from_ct( inst, this.canvas );
        break;
      case "MRI slice":
        position = electrode_from_slice( subjectCode, this.canvas );
        break;
      default:
        return;
    }

    if(
      !position || typeof(position) !== "object" || !position.isVector3 ||
      isNaN( position.x )
    ) { return; }

    return position;
  }

  ViewerControlCenter.prototype.clearLocalization = function( fireEvents = true ){
    const electrodes = this.__localize_electrode_list;
    const scode = this.canvas.get_state("target_subject");
    const collection = this.canvas.electrodes.get(scode) || {};
    electrodes.forEach((el) => {
      el.dispose();
    });
    electrodes.length = 0;
    this.canvas.switch_subject();

    if( fireEvents ) {
      this.broadcast({
        data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
      });
    }
  };

  ViewerControlCenter.prototype.localizeAddElectrode = function({
    Coord_x, Coord_y, Coord_z, Hemisphere = "auto",
    mode, fireEvents = true, ...moreArgs
  } = {}){
    const electrodes = this.__localize_electrode_list;
    const scode = this.canvas.get_state("target_subject");
    let edit_mode = mode;
    if(!edit_mode){
      const edit_mode = this.gui.getController( 'Edit Mode', folderName ).getValue();
    }
    let electrode_size = this.gui.getController('Electrode Scale', folderName).getValue() || 1.0;
    if(edit_mode === "disabled" ||
       edit_mode === "refine"){ return; }

    const el = new LocElectrode(
      scode, electrodes.length + 1, [Coord_x, Coord_y, Coord_z],
      this.canvas, false, electrode_size);
    el.set_mode( edit_mode );
    electrodes.push( el );

    // update electrode
    el.update( moreArgs );

    this.canvas.switch_subject();

    if( fireEvents ){
      this.broadcast({
        data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
      });
    }

    return( el );
  };

  ViewerControlCenter.prototype.localizeSetElectrode = function(
    which, params, fireEvents = true
  ){
    const electrodes = this.__localize_electrode_list;
    const scode = this.canvas.get_state("target_subject");

    const _regexp = new RegExp(`^${scode}, ([0-9]+) \\- (.*)$`);

    electrodes.forEach((el) => {

      const localization_order = el.localization_order;
      if(localization_order == which){
        el.update( params );
      }

    });
    this.canvas.switch_subject();

    if( fireEvents ){
      this.broadcast({
        data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
      });
    }
  };

  const shiftDirectionSum = new Vector3();
  ViewerControlCenter.prototype.startBrainShift = function({
    mode, threshold, sameDirection, dryRun
  } = {}){
    if( typeof mode === "string" ) {
      switch (mode[0]) {
        case 's':
          this.canvas.set_state( "brain_shift_mode", "soft threshold" );
          break;
        case 'h':
          this.canvas.set_state( "brain_shift_mode", "hard threshold" );
          break;
        default:
          this.canvas.set_state( "brain_shift_mode", "disabled" );
      }
    }
    if( typeof threshold === "number" ) {
      this.canvas.set_state( "brain_shift_max", threshold );
    }
    if( typeof sameDirection === "boolean" ) {
      this.canvas.set_state( "brain_shift_homogeneous", sameDirection );
    } else {
      sameDirection = this.canvas.get_state( "brain_shift_homogeneous", false );
    }

    if( dryRun ) { return; }

    const electrodes = this.__localize_electrode_list;
    // reuse static (not really) variable
    shiftDirectionSum.set( 0, 0, 0 );

    // first pass
    electrodes.forEach((el) => {
      el.updateShiftHelper();
      if( el.brainShiftEnabled ) {
        // get shift from electrode to its projection to leptomeningeal
        shiftDirectionSum.add(
          el.__vec3.copy( el.leptoPosition ).sub( el._globalPosition ).normalize()
        );
      }
    });

    this.broadcast({
      data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
    });
    this.canvas.needsUpdate = true;
  }

  ViewerControlCenter.prototype.addPreset_localization = function(){

    const electrodes = this.__localize_electrode_list;
    let refine_electrode;

    const edit_mode = this.gui
      .addController(
        'Edit Mode', "disabled", {
          folderName: folderName,
          args: ['disabled', 'CT/volume', 'MRI slice', 'refine']
        })
      .onChange((v) => {

        if( !v ){ return; }
        if( refine_electrode && refine_electrode.isLocElectrode ){
          // reset color
          refine_electrode.update_color();
          refine_electrode = null;
        }
        this.gui.hideControllers([
          '- tkrRAS', '- MNI305', '- T1 RAS', 'Interp Size',
          'Interpolate', 'Extrapolate', 'Register from Crosshair',
          'Reset Highlighted', "Auto Refine",
          'Auto-Adjust Highlighted', 'Auto-Adjust All'
        ], folderName);
        if( v === 'disabled' ){ return; }
        if( v === 'refine' ) {
          this.gui.showControllers([
            '- tkrRAS', '- MNI305', '- T1 RAS',
            'Auto-Adjust Highlighted', 'Auto-Adjust All', 'Reset Highlighted'
          ], folderName);
        } else {
          this.gui.showControllers([
            '- tkrRAS', '- MNI305', '- T1 RAS', 'Auto Refine',
            'Interp Size', 'Interpolate',
            'Extrapolate', 'Register from Crosshair'
          ], folderName);

          if( v === "MRI slice" ) {
            // disable Auto Refine
            const ctlr = this.gui.getController( 'Auto Refine' );
            ctlr.setValue( false );
          }
        }

        this.broadcast();
        this._update_canvas();

      });
    const auto_refine = this.gui
      .addController(
        'Auto Refine', false, {
          folderName: folderName
        })
      .onChange(v => {
        this.canvas.set_state( "auto_refine_electrodes", v );
      })
      .setValue( true );

    const elec_size = this.gui
      .addController( 'Electrode Scale', 1.0, { folderName: folderName })
      .min(0.2).max(2).decimals(1)
      .onChange((v) => {

        electrodes.forEach((el) => {
          el.updateScale( v );
        });

        this._update_canvas();

      });

    this.gui
      .addController('Brain Shift', "disabled", {
        folderName: folderName,
        args: ['disabled', 'soft threshold', 'hard threshold']
      })
      .onChange(v => {
        if( v === "disabled" ) {
          ctrlMaxShift.hide();
        } else {
          ctrlMaxShift.show();
        }
        this.startBrainShift({ mode : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });

    const ctrlMaxShift = this.gui
      .addController('Max Shift', 50.0, { folderName: folderName })
      .min(0.0).max(50).step(0.1).decimals(1)
      .onChange(v => {
        this.startBrainShift({ threshold : v });
        this.broadcast();
        this.canvas.needsUpdate = true;
      });
    ctrlMaxShift.hide();
    // initialize state values
    this.startBrainShift({ mode : "disabled", threshold : 50.0, dryRun : true });

    // remove electrode
    /* this.gui.addController( 'Enable/Disable Electrode', () => {
      if( refine_electrode &&
          refine_electrode.isLocElectrode ){
        if( refine_electrode.enabled() ){
          refine_electrode.disable();
          refine_electrode = null;
        } else {
          refine_electrode.enable();
          refine_electrode = null;
        }

        this.broadcast({
          data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
        });


        this._update_canvas();
      }
    },  { folderName: folderName }); */

    this.gui.addController( 'Auto-Adjust Highlighted', () => {
      if( refine_electrode &&
          refine_electrode.isLocElectrode ){
        refine_electrode.adjust();

        this.broadcast({
          data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
        });


        this._update_canvas();
      }
    },  { folderName: folderName });

    this.gui.addController( 'Reset Highlighted', () => {
      if( refine_electrode &&
          refine_electrode.isLocElectrode ){

        refine_electrode.reset_position();

        this.broadcast({
          data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
        });


        this._update_canvas();
      }
    },  { folderName: folderName });

    this.gui.addController( 'Auto-Adjust All', () => {
      electrodes.forEach((el) => {
        el.adjust();
      });

      this.broadcast({
        data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
      });


      this._update_canvas();
    },  { folderName: folderName });



    // Calculate RAS
    const tkr_loc = this.gui.addController( '- tkrRAS', "", {
      folderName: folderName
    });
    const mni_loc = this.gui.addController( '- MNI305', "", {
      folderName: folderName
    });
    const t1_loc = this.gui.addController( '- T1 RAS', "", {
      folderName: folderName
    });

    // interpolate
    const interpolate_size = this.gui.addController( 'Interp Size', "1", {
      folderName: folderName
    }).onChange((v) => {
      // let RAVE know!
      this.broadcast();
    });

    const parseInterpolationSize = () => {
      const v = interpolate_size.getValue();
      const spacings = [];

      let size = Math.round( v );
      if( !isNaN(size) && size > 0 ) {
        // equally spaced, add size + 1 spacing
        for(let ii = 0; ii <= size; ii++ ) {
          spacings.push(1);
        }
        return {
          rawInput : v,
          strictSpacing : false,
          spacings  : spacings,
          size      : spacings.length - 1,
          distance  : spacings.reduce((a, b) => { return a + b; })
        };
      }

      const vSplit = v.split(",");
      for(let ii in vSplit) {
        const item = vSplit[ ii ].trim();
        // e.g. 1.2 x 2, 1.3, 1.4 x 3
        const m1 = item.trim().match(/^([0-9\.]+)[ ]{0,}x[ ]{0,}([0-9]+)$/i);
        const m2 = item.trim().match(/^([0-9\.]+)$/i);
        if ( m1 ) {
          const spacing = parseFloat(m1[1]);
          const count = Math.round( m1[2] );
          if( count && count > 0 ) {
            if ( isNaN(spacing) || spacing <= 0 ) { return undefined; }
            for(let jj = 0; jj < count; jj++ ) {
              spacings.push( spacing );
            }
          }
        } else if( m2 ) {
          const spacing = parseFloat(m2[1]);
          if ( isNaN(spacing) || spacing <= 0 ) { return undefined; }
          spacings.push( spacing );
        } else {
          return undefined;
        }
      }

      return {
        rawInput : v,
        strictSpacing : true,
        spacings  : spacings,
        size      : spacings.length - 1,
        distance  : spacings.reduce((a, b) => { return a + b; })
      };
    }

    this.gui.addController(
      'Interpolate',
      () => {
        let v = parseInterpolationSize();
        if( !v ){ return; }
        const mode = edit_mode.getValue();
        const scode = this.canvas.get_state("target_subject");
        if( !mode || mode == "disabled" ||
            mode == "refine" ||
            !scode || scode === ""
        ){ return; }

        if( electrodes.length < 2 ){
          alert("Please localize at least 2 electrodes first.");
          return;
        }

        let res;

        if( mode == "CT/volume" ){
          const inst = this.getActiveDataCube2();
          res = interpolate_electrode_from_ct( inst, this.canvas, electrodes, v );
        } else {
          res = interpolate_electrode_from_slice( this.canvas, electrodes, v );
        }
        // return({
        //   positions : re,
        //   direction : direction,
        //   strictSpacing : settings.strictSpacing,
        //   distanceRatio : distanceRatio,
        //   expectedSpacing : settings.distance,
        //   averageOffset : Math.abs(1 - distanceRatio) * settings.distance / ( n + 2 )
        // });

        if( res.positions.length ){
          const last_elec = electrodes.pop();
          res.direction.normalize();
          res.positions.push(new Vector3().fromArray(
            last_elec.instance._params.position
          ));
          last_elec.dispose();
          let autoRefine = auto_refine.getValue();
          if( autoRefine && res.strictSpacing &&
              typeof res.distanceRatio === "number" ) {
            autoRefine = res.averageOffset;
            console.log(autoRefine);
          }

          res.positions.forEach((pos) => {
            const el = new LocElectrode(
              scode, electrodes.length + 1, pos, this.canvas, autoRefine,
              elec_size.getValue());
            el.set_mode( mode );
            el.__interpolate_direction = res.direction.clone().normalize();
            electrodes.push( el );
          });

          this.canvas.switch_subject();
        }

        this.broadcast({
          data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
        });


      },
      { folderName: folderName }
    );

    this.gui.addController(
      'Extrapolate',
      () => {
        let v = parseInterpolationSize();
        if( !v ){ return; }
        const mode = edit_mode.getValue();
        const scode = this.canvas.get_state("target_subject");
        if( !mode || mode == "disabled" ||
            mode == "refine" ||
            !scode || scode === ""
        ){ return; }

        if( electrodes.length < 2 ){
          alert("Please localize at least 2 electrodes first.");
          return;
        }

        let res;

        if( mode == "CT/volume" ){
          const inst = this.getActiveDataCube2();
          res = extrapolate_electrode_from_ct( inst, this.canvas, electrodes, v );
        } else {
          res = extrapolate_electrode_from_slice( this.canvas, electrodes, v );
        }
        // return({
        //   positions : re,
        //   direction : direction,
        //   strictSpacing : settings.strictSpacing,
        //   distanceRatio : distanceRatio,
        //   expectedSpacing : settings.distance,
        //   averageOffset : Math.abs(1 - distanceRatio) * settings.distance / ( n + 2 )
        // });

        if( res.positions.length ){
          res.direction.normalize();
          let autoRefine = auto_refine.getValue();
          if( autoRefine && res.strictSpacing &&
              typeof res.distanceRatio === "number" ) {
            autoRefine = res.averageOffset;
            console.log( autoRefine );
          }

          res.positions.forEach((pos) => {
            const el = new LocElectrode(
              scode, electrodes.length + 1, pos, this.canvas, autoRefine,
              elec_size.getValue());
            el.set_mode( mode );
            electrodes.push( el );
          });

          this.canvas.switch_subject();
        }

        this.broadcast({
          data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
        });


      },
      { folderName: folderName }
    );

    // Add electrode from crosshair
    this.gui.addController( 'Register from Crosshair', () => {
      const mode = edit_mode.getValue();
      const scode = this.canvas.get_state("target_subject");
      if( !mode || mode == "disabled" ||
          mode == "refine" ||
          !scode || scode === ""
      ){ return; }
      const tkrRAS = new Vector3().copy( this.canvas._crosshairPosition );
      const el = new LocElectrode(
              scode, electrodes.length + 1, tkrRAS, this.canvas,
              false, elec_size.getValue());
      el.set_mode( mode );
      electrodes.push( el );
      this.canvas.switch_subject();
      this.broadcast({
        data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
      });
    }, {
      folderName: folderName
    });

    // Download as CSV
    this.gui.addController( 'Download Current as CSV', () => {
      this.canvas.download_electrodes("csv");
    }, {
      folderName: folderName
    });

    // add canvas update
    let throttleCount = 0;
    this.addEventListener( "viewerApp.animationFrame.update", () => {

      const mode = edit_mode.getValue();

      let position;
      if( mode === 'refine' ) {
        if(
          refine_electrode &&
          refine_electrode.isLocElectrode
        ){
          pos.copy( refine_electrode.object.position );
          position = pos;
        }
      } else {
        position = this.intersectActiveDataCube2( mode );
      }

      if( !position || !position.isVector3 ) {
        tkr_loc.setValue("");
        mni_loc.setValue("");
        t1_loc.setValue("");
        return;
      } else {
        const subjectCode = this.canvas.get_state("target_subject"),
              subjectData = this.canvas.shared_data.get( subjectCode );

        // tkrRAS
        tkr_loc.setValue( vector3ToString( position ) );

        // T1 ScannerRAS = Norig*inv(Torig)*[tkrR tkrA tkrS 1]'
        position.applyMatrix4( subjectData.matrices.tkrRAS_Scanner );
        t1_loc.setValue( vector3ToString( position ) );

        // MNI305 = xfm * ScannerRAS
        position.applyMatrix4( subjectData.matrices.xfm );
        mni_loc.setValue( vector3ToString( position ) );
      }
    });

    // bind dblclick
    this.addEventListener( "viewerApp.mouse.doubleClick", () => {
      const scode = this.canvas.get_state("target_subject"),
            mode = edit_mode.getValue();
        if(
          !mode || mode == "disabled" ||
          !scode || scode === ""
        ){ return; }


        if( mode === "CT/volume" || mode === "MRI slice" ){

          // If mode is add,
          const electrode_position = this.intersectActiveDataCube2( mode );
          if(
            !electrode_position ||
            !electrode_position.isVector3 ||
            isNaN( electrode_position.x )
          ){ return; }

          const num = electrodes.length + 1,
              group_name = `group_Electrodes (${scode})`;
          const el = new LocElectrode(
            scode, num, electrode_position, this.canvas, undefined,
            elec_size.getValue());
          el.set_mode( mode );
          electrodes.push( el );
          this.canvas.switch_subject();
        } else {

          // mode is to refine
          // make electrode shine!
          const el = this.canvas.object_chosen;
          if( el && is_electrode( el ) ){
            if(
              refine_electrode &&
              refine_electrode.isLocElectrode &&
              is_electrode( refine_electrode.object )
            ){
              refine_electrode.update_color();
            }
            refine_electrode = el.userData.localization_instance;
            refine_electrode.update_color( COL_SELECTED );
          }
        }

        this.canvas.needsUpdate = true;

        this.broadcast({
          data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
        });


    });

    // bind adjustment
    const xyzTo123 = { x : 0 , y : 1, z : 2 };
    const adjust_electrode_position = ({
      axis, step = 0.1
    }) => {
      if( !refine_electrode || !is_electrode( refine_electrode.object ) ){ return; }
      const mode = edit_mode.getValue();
      if( mode !== "refine" ){ return; }

      pos.set(0, 0, 0);
      pos[ axis ] = step;
      pos.applyQuaternion( this.canvas.crosshairGroup.quaternion );

      refine_electrode.object.position.add( pos );

      // refine_electrode.object.position[ axis ] += step;
      // refine_electrode.object.userData.construct_params.position[ xyzTo123[ axis ] ] += step;
      refine_electrode.object.userData.construct_params.position[0] = refine_electrode.object.position.x
      refine_electrode.object.userData.construct_params.position[1] = refine_electrode.object.position.y
      refine_electrode.object.userData.construct_params.position[2] = refine_electrode.object.position.z
      refine_electrode.update_line();
      refine_electrode.updateProjection();
      this.broadcast({
        data : { "localization_table" : JSON.stringify( this.canvas.electrodes_info() ) }
      });

      this._update_canvas();
    }

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_ADJUST_ELECTRODE_LOCATION_R,
      // shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      callback  : ( event ) => {
        if( event.shiftKey ) {
          adjust_electrode_position({ axis : 'x' , step : -0.1 });
        } else {
          adjust_electrode_position({ axis : 'x' , step : 0.1 });
        }
      }
    });

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_ADJUST_ELECTRODE_LOCATION_A,
      // shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      callback  : ( event ) => {
        if( event.shiftKey ) {
          adjust_electrode_position({ axis : 'y' , step : -0.1 });
        } else {
          adjust_electrode_position({ axis : 'y' , step : 0.1 });
        }
      }
    });

    this.bindKeyboard({
      codes     : CONSTANTS.KEY_ADJUST_ELECTRODE_LOCATION_S,
      // shiftKey  : false,
      ctrlKey   : false,
      altKey    : false,
      metaKey   : false,
      callback  : ( event ) => {
        if( event.shiftKey ) {
          adjust_electrode_position({ axis : 'z' , step : -0.1 });
        } else {
          adjust_electrode_position({ axis : 'z' , step : 0.1 });
        }
      }
    });

    // open folder
    this.gui.openFolder( folderName, false );
    this.gui.openFolder( CONSTANTS.FOLDERS[ 'atlas' ] , false );

    this.gui.hideControllers([
      '- tkrRAS', '- MNI305', '- T1 RAS', 'Interp Size',
      'Interpolate', 'Extrapolate',
      'Auto-Adjust Highlighted', 'Auto-Adjust All', 'Reset Highlighted',
      'Auto Refine', 'Register from Crosshair'
    ], folderName);
  };

  return( ViewerControlCenter );

}

export { register_controls_localization };
