import { AbstractThreeBrainObject } from './abstract.js';
import { Vector3, Matrix4, Color, Quaternion,
         Data3DTexture, NearestFilter, FloatType,
         RGBAFormat, RedFormat, UnsignedByteType, LinearFilter,
         Mesh, InstancedMesh,
         BoxGeometry, BufferGeometry, SphereGeometry,
         BufferAttribute, InstancedBufferAttribute,
         MeshPhysicalMaterial, MeshBasicMaterial,
         DoubleSide, FrontSide } from 'three';
import { LineSegmentsGeometry } from '../jsm/lines/LineSegmentsGeometry.js'
import { StreamlineMaterial } from '../shaders/StreamlineMaterial.js';
import { Line2 }from '../jsm/lines/Line2.js';
import { CONSTANTS } from '../core/constants.js';

const tmpVec3 = new Vector3();
const tmpMat4 = new Matrix4();

function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class StreamlineGeometry extends LineSegmentsGeometry {

  constructor( pointOffset ) {

		super();

		this.isStreamlineGeometry = true;

		this.type = 'StreamlineGeometry';

    if ( pointOffset[0] !== 0 ) {
      this.pointOffset = [0, ...pointOffset];
    } else {
      this.pointOffset = [...pointOffset];
    }

    this.nTracts = pointOffset.length - 1;
		const length = pointOffset[ this.nTracts ];

		// attribute sizes (e.g. position should be nNodes * 3)
		this.attributeItemLength = length - this.nTracts;

    this._positionArray = new Float32Array( this.attributeItemLength * 6 );

	}

  _setStreamlineAttribute( dstArray, srcArray, itemCount ) {
    if( dstArray.length != this.attributeItemLength * itemCount ) {
      throw new Error( 'dstArray.length != this.attributeItemLength * itemCount' );
    }
    const pointOffset = this.pointOffset;
    let n = 0;
    for ( let idx = 0; idx < pointOffset.length - 1 ; idx++ ) {
      const iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ];
      for( let i = iStart; i < iEnd - 1; i++, n+=itemCount ) {
        for( let j = 0; j < itemCount; j++ ) {
          dstArray[ n + j ] = srcArray[ i * itemCount + j ];
        }
      }
    }
    return dstArray;
  }

	setPositions( array ) {

		// converts [ x1, y1, z1,  x2, y2, z2, ... ] to pairs format

		const points = this._positionArray;

		const pointOffset = this.pointOffset;
    let n = 0;
    for ( let idx = 0; idx < pointOffset.length - 1 ; idx++ ) {
      const iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ];
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

  filterVisible( visibleArray ) {
    const positionOrig = this._positionArray;

    if( visibleArray === undefined ) {
      // reset to all visible
      super.setPositions( positionOrig );
      return this;
    }
    // visibleArray is an array of true or false values
    const pointOffset = this.pointOffset;
    const position = new Float32Array( this.attributeItemLength * 6 );

    let n = 0, nn = 0, instanceCount = 0;
    for ( let idx = 0; idx < pointOffset.length - 1 ; idx++ ) {
      if ( visibleArray.length <= idx ) {
        break;
      }
      const visible = visibleArray[ idx ];
      const iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ];
      if ( visible ) {
        for( let i = iStart; i < iEnd - 1; i++, n+=6, nn+=6 ) {
          position[ nn ] = positionOrig[ n ];
          position[ nn + 1 ] = positionOrig[ n + 1 ];
          position[ nn + 2 ] = positionOrig[ n + 2 ];
          position[ nn + 3 ] = positionOrig[ n + 3 ];
          position[ nn + 4 ] = positionOrig[ n + 4 ];
          position[ nn + 5 ] = positionOrig[ n + 5 ];
          instanceCount++;
        }
      } else {
        n += ( iEnd - iStart - 1 ) * 6;
      }
    }
    super.setPositions( position.slice(0, instanceCount * 6) );
  }

	setColors( array ) {

		// converts [ r1, g1, b1,  r2, g2, b2, ... ] to pairs format

		const colors = new Float32Array( this.attributeItemLength * 6 );

		const pointOffset = this.pointOffset;
    let n = 0;
    for ( let idx = 0; idx < pointOffset.length - 1 ; idx++ ) {
      const iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ];
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

class Streamline extends AbstractThreeBrainObject {
  constructor(g, canvas){

    super( g, canvas );

    // this._params is g
    // this.name = this._params.name;
    // this.group_name = this._params.group.group_name;

    this.type = 'Streamline';
    this.isStreamline = true;

    let fiber = g.imageObject;

    const geometry = new StreamlineGeometry( fiber.pointOffset );
    geometry.setPositions( fiber.points );
    this.lengthPerStreamline = fiber.lengthPerStreamline;
    this.streamlineVisibility = Array( geometry.nTracts ).fill(true);
    this._retentionRatio = 1;
    this._streamlineLengthMin = 0;
    this._streamlineLengthMax = Infinity;

    const material = new StreamlineMaterial( {

			color: 0xff0000,
			linewidth: 0.5, // in world units with size attenuation, pixels otherwise
			vertexColors: false,

			dashed: false,
			alphaToCoverage: true,

		} );
		material.color.set( g.color );
    material.alphaToCoverage = false;
		material.worldUnits = true;
		material.needsUpdate = true;
    this.object = new Line2( geometry, material );
		this.object.scale.set( 1, 1, 1 );
		this.object.computeLineDistances();

  }

  finish_init(){
    // Finalize setups
    super.finish_init();

    this.registerToMap( ['tracts'] );
  }

  dispose(){
    super.dispose();
    this.object.removeFromParent();
    const trackList = this._canvas.tracts.get( this.subject_code )
    if( trackList[ this.name ] === this ) {
      delete trackList[ this.name ];
    }

    try {
      this.object.material.dispose();
      this.object.geometry.dispose();
    } catch (e) {}
  }

  filterByLength({ min, max, retentionRatio } = {}) {
    if ( typeof retentionRatio !== "number" ) {
      retentionRatio = this._retentionRatio;
    } else {
      if( retentionRatio > 1 ) {
        retentionRatio = 1;
      } else if ( retentionRatio < 0.05 ) {
        retentionRatio = 0.05;
      }
      this._retentionRatio = retentionRatio;
    }
    if( typeof min !== "number" ) {
      min = this._streamlineLengthMin;
    }
    if( typeof max !== "number" ) {
      max = this._streamlineLengthMax;
    }
    if( min > max ) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    this._streamlineLengthMin = min;
    this._streamlineLengthMax = max;

    const totalTracts = this.object.geometry.nTracts;
    const lengthPerStreamline = this.lengthPerStreamline;
    const streamlineVisibility = this.streamlineVisibility;

    const randomGenerator = mulberry32(42);

    let nVisible = 0;
    for( let ii = 0 ; ii < totalTracts; ii++ ) {
      const lineLength = lengthPerStreamline[ ii ];
      const rn = randomGenerator();

      if( lineLength < min || lineLength > max ) {
        streamlineVisibility[ ii ] = false;
      } else {
        nVisible++;
        if( nVisible >= 10 && rn > retentionRatio ) {
          streamlineVisibility[ ii ] = false;
        } else {
          streamlineVisibility[ ii ] = true;
        }
      }
    }
    this.object.geometry.filterVisible( streamlineVisibility );

  }

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){
    super.pre_render({ target : target });
    let linewidth = this._canvas.get_state("streamline_linewidth", 0.0);
    if( linewidth <= 0.0 ) {
      // automatically adjust linewidth such that linewidth * camera zoom level is 1.5
      if ( target === CONSTANTS.RENDER_CANVAS.main ) {
        const zoomLevel = this._canvas.mainCamera.zoom;
        linewidth = 1.5 / zoomLevel;
        if ( linewidth > 1.5 ) {
          linewidth = 1.5;
        }
      } else {
        linewidth = 0.5;
      }
    }
    this.object.material.linewidth = linewidth;

    if( !this.object.visible ) { return; }

    let minLen = this._canvas.get_state('streamline_minlen', 0);
    if( minLen <= 0 ) { minLen = 0; }
    let maxLen = this._canvas.get_state('streamline_maxlen', Infinity);
    if( maxLen >= 500 ) { maxLen = Infinity; }
    let retentionRatio = this._canvas.get_state('streamline_retention', 1);
    if( retentionRatio < 0.05 ) {
      retentionRatio = 0.05;
    } else if ( retentionRatio > 1 ) {
      retentionRatio = 1;
    }

    if(
      this._retentionRatio != retentionRatio ||
      this._streamlineLengthMin != minLen ||
      this._streamlineLengthMax != maxLen
    ) {
      this.filterByLength({
        min : minLen,
        max : maxLen,
        retentionRatio: retentionRatio,
      });
      // make sure the numbers are recorded
      this._retentionRatio = retentionRatio;
      this._streamlineLengthMin = minLen;
      this._streamlineLengthMax = maxLen;
    }

  }
}



function gen_streamline(g, canvas){
  let manualFinish = false;
  if( g && (g.isStreamline) ) {
    if( g.isInvalid ) { return; }
    const subjectCode = canvas.get_state("target_subject");
    const fileName = g.fileName ?? "Custom";
    const name = `Streamline - ${ fileName } (${subjectCode})`;
    manualFinish = true;

    g = {
      clickable: false,
      custom_info: "",
      disable_trans_mat: false,
      group: { group_name: `Streamline - Custom (${subjectCode})`, group_layer: 0, group_position: [0, 0, 0] },
      isStreamline: true,
      keyframes: [],
      layer: CONSTANTS.LAYER_SYS_ALL_CAMERAS_7,
      name: name,
      position: [0, 0, 0],
      render_order: 1,
      subject_code: subjectCode,
      // threshold : 0.4,
      time_stamp: [],
      trans_mat : null,
      type: "streamline",
      use_cache: false,
      value: null,
      color: '#ff0000',
      // color_map: colorMap,
      imageObject: g,
    }

    const inst = new Streamline(g, canvas);
    // make sure subject array exists
    canvas.init_subject( inst.subject_code );
    inst.finish_init();

    return( inst );
  }

  return( new Streamline(g, canvas) );
}

export { gen_streamline };

