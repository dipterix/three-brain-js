import { AbstractThreeBrainObject } from './abstract.js';
import { Vector3, Matrix4, Color, Quaternion,
         Data3DTexture, NearestFilter, FloatType,
         RGBAFormat, RedFormat, UnsignedByteType, LinearFilter,
         Mesh, InstancedMesh,
         BoxGeometry, BufferGeometry, SphereGeometry,
         BufferAttribute,
         MeshPhysicalMaterial, MeshBasicMaterial,
         DoubleSide, FrontSide } from 'three';
import { LineSegmentsGeometry } from '../jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from '../jsm/lines/LineMaterial.js';
import { Line2 }from '../jsm/lines/Line2.js';
import { CONSTANTS } from '../core/constants.js';

const tmpVec3 = new Vector3();
const tmpMat4 = new Matrix4();

class FiberGeometry extends LineSegmentsGeometry {

  constructor( cutoff ) {

		super();

		this.isFiberGeometry = true;

		this.type = 'FiberGeometry';

		this.cutoff = cutoff;

    this.nTracts = cutoff.length - 1;
		const length = cutoff[ this.nTracts ];

		// attribute sizes (e.g. position should be nNodes * 3)
		this.attributeItemLength = 2 * ( length - this.nTracts );

	}

	setPositions( array ) {

		// converts [ x1, y1, z1,  x2, y2, z2, ... ] to pairs format

		const points = new Float32Array( this.attributeItemLength * 3 );

		const cutoff = this.cutoff;
    let n = 0;
    for ( let idx = 0; idx < cutoff.length - 1 ; idx++ ) {
      const iStart = cutoff[ idx ],
            iEnd   = cutoff[ idx + 1 ];
      for( let i = iStart; i < iEnd - 1; i++, n+=6 ) {
        const i3 = i * 3;
        points[ n ] = array[ i3 ];
  			points[ n + 1 ] = array[ i3 + 1 ];
  			points[ n + 2 ] = array[ i3 + 2 ];

  			points[ n + 3 ] = array[ i3 + 3 ];
  			points[ n + 4 ] = array[ i3 + 4 ];
  			points[ n + 5 ] = array[ i3 + 5 ];
      }
    }
		super.setPositions( points );

		return this;

	}

	setColors( array ) {

		// converts [ r1, g1, b1,  r2, g2, b2, ... ] to pairs format

		const colors = new Float32Array( this.attributeItemLength * 3 );

		const cutoff = this.cutoff;
    let n = 0;
    for ( let idx = 0; idx < cutoff.length - 1 ; idx++ ) {
      const iStart = cutoff[ idx ],
            iEnd   = cutoff[ idx + 1 ];
      for( let i = iStart; i < iEnd - 1; i++, n+=6 ) {
        const i3 = i * 3;
        colors[ n ] = array[ i3 ];
  			colors[ n + 1 ] = array[ i3 + 1 ];
  			colors[ n + 2 ] = array[ i3 + 2 ];

  			colors[ n + 3 ] = array[ i3 + 3 ];
  			colors[ n + 4 ] = array[ i3 + 4 ];
  			colors[ n + 5 ] = array[ i3 + 5 ];
      }
    }

		super.setColors( colors );

		return this;

	}

	fromLine( line ) {

		const geometry = line.geometry;

		this.setPositions( geometry.attributes.position.array ); // assumes non-indexed

		// set colors, maybe

		return this;

	}
}

class FiberTract extends AbstractThreeBrainObject {
  constructor(g, canvas){

    super( g, canvas );

    // this._params is g
    // this.name = this._params.name;
    // this.group_name = this._params.group.group_name;

    this.type = 'FiberTract';
    this.isFiberTract = true;

    let fiber = g.imageObject;
    // if( g.imageObject ) {
    // }

    const geometry = new FiberGeometry( fiber.cutoff );
    geometry.setPositions( fiber.points );

    const material = new LineMaterial( {

			color: 0xccff99,
			linewidth: 0.2, // in world units with size attenuation, pixels otherwise
			vertexColors: false,

			dashed: false,
			alphaToCoverage: true,

		} );
		material.color.copy( fiber.color );
		material.worldUnits = true;
		material.needsUpdate = true;

    this.object = new Line2( geometry, material );
		this.object.computeLineDistances();
		this.object.scale.set( 1, 1, 1 );

  }
}



function gen_fibertract(g, canvas){
  if( g && (g.isTTTract) ) {
    if( g.isInvalid ) { return; }
    const subjectCode = canvas.get_state("target_subject");
    const fileName = g.fileName ?? "Custom";
    const name = `FiberTract - ${ fileName } (${subjectCode})`;

    g = {
      clickable: false,
      custom_info: "",
      disable_trans_mat: false,
      group: { group_name: `FiberTract - Custom (${subjectCode})`, group_layer: 0, group_position: [0, 0, 0] },
      isFiberTract: true,
      keyframes: [],
      layer: CONSTANTS.LAYER_SYS_ALL_CAMERAS_7,
      name: name,
      position: [0, 0, 0],
      render_order: 1,
      subject_code: subjectCode,
      // threshold : 0.4,
      time_stamp: [],
      trans_mat : null,
      type: "fibertract",
      use_cache: false,
      value: null,
      // color_map: colorMap,
      imageObject: g,
    }

    const inst = new FiberTract(g, canvas);
    // make sure subject array exists
    canvas.init_subject( inst.subject_code );
    inst.finish_init();
    return( inst );
  }

  return( new FiberTract(g, canvas) );
}

export { gen_fibertract };

