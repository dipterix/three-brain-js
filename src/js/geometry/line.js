import { CONSTANTS } from '../core/constants.js';
import { AbstractThreeBrainObject } from './abstract.js';
import { Vector3, Color, Mesh, DoubleSide, VertexColors, InstancedBufferAttribute } from 'three';
import { LineSegments2 } from '../jsm/lines/LineSegments2.js';
import { LineMaterial } from '../jsm/lines/LineMaterial.js';
import { LineSegmentsGeometry } from '../jsm/lines/LineSegmentsGeometry.js';
import { to_array } from '../utils.js';

const tmp_vec3 = new Vector3();
const tmp_col = new Color();

class LineSegmentsMesh extends AbstractThreeBrainObject {
  constructor(g, canvas){

    super( g, canvas );
    // this._params is g
    // this.name = this._params.name;
    // this.group_name = this._params.group.group_name;

    this.type = 'LineSegmentsMesh';
    this.isLineSegmentsMesh = true;
    this.valid = true;

    // check if the line type is static or dynamic
    // for dynamic lines, the positions must be a vectors of
    // electrode names.
    this.isDynamic = this._params.dynamic || false;

    this._anchors = [];   // only used when dynamic
    this._vertices = [];  // only used when static
    this._frame = 0;
    this._vColorData = [];
    this._lineWidthData = [];
    this._worldUnits = false;

    this.nSegments = this._params.vertices.length;
    this.geometry = new LineSegmentsGeometry();

    // formalize this._vColorData
    const vcolors = to_array( this._params.vertex_colors || this._params.color );
    if( vcolors.length > 0 ) {
      for(let i = 0; i < vcolors.length; i++) {
        tmp_col.set( vcolors[ i ] );
        this._vColorData.push( tmp_col.r, tmp_col.g, tmp_col.b );
      }
    }

    // formalize this._lineWidthData
    this._lineWidthData = to_array( this._params.line_widths || this._params.width );
    if( this._lineWidthData.length === 0 ) {
      this._worldUnits = true;
    }

    // Initialize geometry attributes
    this.vPositions = new Float32Array( this.nSegments * 3 );
    this.vColors = new Float32Array( this.nSegments * 3 );
    this.lineWidths = new Float32Array( this.nSegments );

    // set position
    // this.updateSegmentPositions();

    // Set geometry attributes
    this.geometry.setPositions( this.vPositions );
    this.geometry.setColors( this.vColors );
    this.geometry.setAttribute(
        "linewidth",
        new InstancedBufferAttribute(this.lineWidths, 1));

    this.material = new LineMaterial({
      // color: 0x0000ff,
      vertexColors: true,
      // depthTest: false,
      dashed: false,
      worldUnits: this._worldUnits,
      linewidth: 1,
      // side: DoubleSide,
      alphaToCoverage: false,

      onBeforeCompile: (shader) => {
        shader.vertexShader = `
          ${shader.vertexShader}
        `.replace(`uniform float linewidth;`, `attribute float linewidth;`);
      }
    });

    this.reference_position = new Vector3();
    if( !this.isDynamic ) {
      const pos = to_array( this._params.position );
      if( pos.length === 3 ) {
        this.reference_position.fromArray(pos);
      }
    }

    this.object = new LineSegments2( this.geometry, this.material );

    this.updateResolutions();

    this.needsUpdate = false;

    this.finish_init();

    // Do not use object. This is not regular mesh
    this.object = null;

  }

  finish_init () {

    super.finish_init();
    // set vertex positions here because the positions might dynamically link to
    // some objects that was unavailable during construction

    if( this.isDynamic ) {
      // use _anchors
      this._params.vertices.forEach( (v, ii) => {
        if( !this.valid ) { return; }
        if( v.hasOwnProperty("subject_code") ) {
          const subjectCode = v["subject_code"];
          const electrodeNumber = v["electrode"];

          const elist = this._canvas.electrodes.get(subjectCode);

          // mark as invalid, and this line will (should) be hidden
          if( !elist ) {
            throw `Cannot obtain electrode list from subject [${ subjectCode }]`;
          }

          let electrode = undefined;

          for(let k in elist) {
            const elec = elist[k];
            // check if object is electrode and number matches
            if( typeof(elec) === "object" ) {
              const inst = elec.userData.instance;
              if( inst && inst.isSphere && inst._params.number === electrodeNumber ) {
                // this is it
                electrode = inst;
              }
            }
          }

          if( !electrode ) {
            throw `Cannot obtain electrode [${electrodeNumber}] from subject [${ subjectCode }]`;
          }
          this._anchors[ii] = {
            "type" : "dynamic",
            "linkedTo" : electrode,
          };
        } else {
          const v_ = to_array( v["position"] );
          if( v_.length === 3 ) {
            this._anchors[ii] = {
              "type" : "static",
              "linkedTo" : v_,
            };
          } else {
            throw "Static electrode position must have length of 3";
          }
        }
      });

    } else {
      // static: this._params.vertices could be a simple array ?
      this._params.vertices.forEach( (v, ii) => {
        if( !this.valid ) { return; }

        const v_ = to_array( v );
        if( v_.length != 3 ) {
          throw "Static electrode position must have length of 3";
        }
        this._vertices.push( v_[0], v_[1], v_[2] );
      });
    }

    this.updateSegmentPositions();
    this.updateLineWidths();
    this.updateVColors();
    this.updateResolutions();
  }

  updateResolutions () {
    this.material.resolution.set(
      this._canvas.client_width || window.innerWidth,
      this._canvas.client_height || window.innerHeight
    );
  }

  updateSegmentPositions () {

    if( !this.valid ) { return; }

    // Set this.vPositions
    const vPositions = this.vPositions;

    if( this.isDynamic ) {
      const vPositionInstances = Math.min( this._anchors.length, this.nSegments );

      for( let ii = 0; ii < vPositionInstances; ii++ ) {
        const anchor = this._anchors[ ii ];
        if( anchor.type === "dynamic" ) {
          anchor.linkedTo.object.getWorldPosition( tmp_vec3 );
        } else {
          tmp_vec3.fromArray( anchor.linkedTo );
        }

        vpositions[ ii * 3 ] = tmp_vec3.x;
        vpositions[ ii * 3 + 1 ] = tmp_vec3.y;
        vpositions[ ii * 3 + 2 ] = tmp_vec3.z;
      }

    } else {
      vPositions.set( this._vertices );
    }

    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.object.computeLineDistances();

  }

  updateLineWidths( frame ) {

    // this._vColorData = [];
    // this._lineWidthData = [];
    if( !this.valid ) { return; }
    if( this._lineWidthData.length === 0 ) { return; }

    if( typeof frame !== "number" ) {
      frame = this._frame;
    }
    if( frame <= 0 ) {
      frame = 0;
    } else if ( frame >= this.nSegments ) {
      frame = frame % this.nSegments;
    }
    this._frame = frame;

    const startIdx = frame;
    const endIdx = frame + this.nSegments;
    const maxAvailableIdx = Math.min( this._lineWidthData.length - startIdx, endIdx );

    if( maxAvailableIdx <= 0 ) { return; }

    const lineWidthData = this._lineWidthData;
    const lineWidths = this.lineWidths;

    for( let ii = startIdx; ii < maxAvailableIdx; ii++ ) {
      lineWidths[ ii - startIdx ] = lineWidthData[ ii ];
    }
    for( let ii = maxAvailableIdx; ii < endIdx; ii++ ) {
      lineWidths[ ii - startIdx ] = 0;
    }

  }

  updateVColors( frame ) {

    // this._vColorData = [];
    // this._lineWidthData = [];
    if( !this.valid ) { return; }
    if( this._vColorData.length === 0 ) { return; }

    if( typeof frame !== "number" ) {
      frame = this._frame;
    }
    if( frame <= 0 ) {
      frame = 0;
    } else if ( frame >= this.nSegments ) {
      frame = frame % this.nSegments;
    }
    this._frame = frame;

    const startIdx = frame * 3;
    const endIdx = ( frame + this.nSegments ) * 3;
    const maxAvailableIdx = Math.min( this._vColorData.length - startIdx, endIdx );

    if( maxAvailableIdx <= 0 ) { return; }

    const vColorData = this._vColorData;
    const vColor = this.vColors;

    for( let ii = startIdx; ii < maxAvailableIdx; ii++ ) {
      vColor[ ii - startIdx ] = vColorData[ ii ];
    }
    for( let ii = maxAvailableIdx; ii < endIdx; ii++ ) {
      vColor[ ii - startIdx ] = 0;
    }
  }

  pre_render() {
    super.pre_render();
    this.updateResolutions();
  }

  dispose() {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.disposed = true;
  }
}

function gen_linesements(g, canvas){
  return( new LineSegmentsMesh(g, canvas) );
}


export { gen_linesements };


