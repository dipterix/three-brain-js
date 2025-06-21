import { AbstractThreeBrainObject } from './abstract.js';
import { Vector3, Matrix4, Color, Quaternion, Box3, Sphere,
         Data3DTexture, NearestFilter, FloatType,
         RGBAFormat, RedFormat, UnsignedByteType, LinearFilter,
         Mesh, InstancedMesh, Float32BufferAttribute, Uint32BufferAttribute,
         Uint8BufferAttribute,
         InstancedInterleavedBuffer, InterleavedBufferAttribute,
         BoxGeometry, BufferGeometry,
         BufferAttribute, InstancedBufferAttribute,
         MeshPhysicalMaterial, MeshBasicMaterial,
         DoubleSide, FrontSide } from 'three';
import { LineSegmentsGeometry } from '../jsm/lines/LineSegmentsGeometry.js'
import { StreamlineMaterial } from '../shaders/StreamlineMaterial.js';
import { Line2 }from '../jsm/lines/Line2.js';
import { LineMaterial }from '../jsm/lines/LineMaterial.js';
import { CONSTANTS } from '../core/constants.js';
import { mulberry32 } from '../utility/mulberry32.js';

const tmpVec3 = new Vector3();
const _start = new Vector3();
const _end = new Vector3();
const tmpMat4 = new Matrix4();

class StreamlineGeometry extends BufferGeometry {

  constructor( pointOffset, streamlinePositions ) {

		super();

		this.isStreamlineGeometry = true;

		this.type = 'StreamlineGeometry';


    if ( pointOffset[0] != 0 ) {
      this.pointOffset = [0, ...pointOffset];
    } else {
      this.pointOffset = pointOffset;
    }

    this.nTracts = this.pointOffset.length - 1;
		const length = this.pointOffset[ this.nTracts ];
    this.distanceToCenter = new Float32Array( this.nTracts );

    // Number of line segments
		// this.attributeItemLength = length - this.nTracts;
		this.attributeItemLength = 0;
    for (let i = 0; i < this.nTracts; i++) {

      const len = this.pointOffset[i + 1] - this.pointOffset[i];

      if (len >= 2) {
        this.attributeItemLength += len - 1;
      }

    }

    const index = new Uint32Array( this.attributeItemLength * 6 );
    const position = new Float32Array( this.attributeItemLength * 12 );
    const direction = new Float32Array( this.attributeItemLength * 12 );
    const lineWeight = new Uint8Array( this.attributeItemLength * 4 ).fill( 1 );

    this.setIndex( new Uint32BufferAttribute( index, 1 ) );
		this.setAttribute( 'position', new Float32BufferAttribute( position, 3 ) );
		this.setAttribute( 'direction', new Float32BufferAttribute( direction, 3 ) );
		this.setAttribute( 'lineWeight', new Uint8BufferAttribute( lineWeight, 1, false ) );

    if( streamlinePositions ) {
      this.setPositions( streamlinePositions );
    }

    // Keep track of streamline indices that are visible
    this.visibleTractCount = 0;
    this.visibleTracts = new Uint32Array( this.nTracts );

		this.instanceCount = 0; // should be this.attributeItemLength; but since it's unset
		// this.computeBoundingBox();
		// this.computeBoundingSphere();

	}

	setPositions( array ) {

	  const streamlinePositions = array;
	  const indexAttr = this.getIndex(),
	        index = indexAttr.array,
	        positionAttr = this.getAttribute("position"),
	        position = positionAttr.array,
	        directionAttr = this.getAttribute("direction"),
	        direction = directionAttr.array;

	  let iPos = 0;
    for (let idx = 0; idx < this.nTracts; idx++) {

      const iStart = this.pointOffset[ idx ],
            iEnd = this.pointOffset[ idx + 1 ];

      const len = iEnd - iStart;

      if (len < 2) {
        this.distanceToCenter[ idx ] = Infinity;
        continue;
      }

      for( let i = iStart; i < iEnd - 1; i++, iPos++ ) {

        _start.fromArray( streamlinePositions, i * 3 );
        _end.fromArray( streamlinePositions, i * 3 + 3 );

        const iPos12 = iPos * 12,
              iPos6 = iPos * 6,
              iPos4 = iPos * 4;

        position[ iPos12 ] = _start.x;
        position[ iPos12 + 1 ] = _start.y;
        position[ iPos12 + 2 ] = _start.z;

        position[ iPos12 + 3 ] = _end.x;
        position[ iPos12 + 4 ] = _end.y;
        position[ iPos12 + 5 ] = _end.z;

        position[ iPos12 + 6 ] = _start.x;
        position[ iPos12 + 7 ] = _start.y;
        position[ iPos12 + 8 ] = _start.z;

        position[ iPos12 + 9 ] = _end.x;
        position[ iPos12 + 10 ] = _end.y;
        position[ iPos12 + 11 ] = _end.z;

        // direction, normalized
        const segDirection = _end.sub( _start ).normalize();
        direction[ iPos12 ] = segDirection.x;
        direction[ iPos12 + 1 ] = segDirection.y;
        direction[ iPos12 + 2 ] = segDirection.z;
        direction[ iPos12 + 3 ] = segDirection.x;
        direction[ iPos12 + 4 ] = segDirection.y;
        direction[ iPos12 + 5 ] = segDirection.z;
        direction[ iPos12 + 6 ] = -segDirection.x;
        direction[ iPos12 + 7 ] = -segDirection.y;
        direction[ iPos12 + 8 ] = -segDirection.z;
        direction[ iPos12 + 9 ] = -segDirection.x;
        direction[ iPos12 + 10 ] = -segDirection.y;
        direction[ iPos12 + 11 ] = -segDirection.z;

        // 0, 2, 1, 2, 3, 1
        index[ iPos6 ] = iPos4;
        index[ iPos6 + 1 ] = iPos4 + 2;
        index[ iPos6 + 2 ] = iPos4 + 1;
        index[ iPos6 + 3 ] = iPos4 + 2;
        index[ iPos6 + 4 ] = iPos4 + 3;
        index[ iPos6 + 5 ] = iPos4 + 1;

      }

    }

    indexAttr.needsUpdate = true;
    positionAttr.needsUpdate = true;
    directionAttr.needsUpdate = true;

    this.computeBoundingBox();
    this.computeBoundingSphere();

		return this;

	}

  // visibleArray is an array of true or false values
  filterVisible( visibleArray ) {
    const lineWeightAttr = this.getAttribute("lineWeight"),
	        lineWeight = lineWeightAttr.array;

	  let iPos = 0;
    for (let idx = 0; idx < this.nTracts; idx++) {

      const iStart = this.pointOffset[ idx ],
            iEnd = this.pointOffset[ idx + 1 ],
            visible = visibleArray[ idx ];
      const len = iEnd - iStart;
      if (len < 2) { continue; }
      lineWeight.fill( visible, iPos * 4, (iPos + len - 1) * 4 );
      iPos += len - 1;
    }

    lineWeightAttr.needsUpdate = true;

    return this;
    const positionOrig = this._positionArray;
    if(!positionOrig) { return; }

    const pointOffset = this.pointOffset;
    const distanceToCenter = this.distanceToCenter,
          visibleTracts = this.visibleTracts;
    const hasMask = visibleArray ? true : false;
    const filterLength = hasMask ? Math.min(visibleArray.length, this.nTracts) : this.nTracts;
    const lineSegments = this.lineSegments,
          streamlineDistance = this.streamlineDistance;

    // Find now many segments (instances) will be visible
    let nSegments = 0, nn = 0;
    this.visibleTractCount = 0;
    for ( let idx = 0; idx < filterLength ; idx++ ) {
      if( hasMask && !visibleArray[ idx ] ) { continue; }
      const iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ],
            distance = distanceToCenter[ idx ];
      if( iEnd - iStart < 2 ) { continue; }

      nSegments += (iEnd - iStart - 1);
      visibleTracts[ this.visibleTractCount++ ] = idx;

      for( let i = iStart; i < iEnd - 1; i++, nn++ ) {

        const i3 = i * 3,
              nn6 = nn * 6;

        lineSegments[ nn6 ] = positionOrig[ i3 ];
        lineSegments[ nn6 + 1 ] = positionOrig[ i3 + 1 ];
        lineSegments[ nn6 + 2 ] = positionOrig[ i3 + 2 ];
        lineSegments[ nn6 + 3 ] = positionOrig[ i3 + 3 ];
        lineSegments[ nn6 + 4 ] = positionOrig[ i3 + 4 ];
        lineSegments[ nn6 + 5 ] = positionOrig[ i3 + 5 ];
        streamlineDistance[ nn ] = distance;
      }
    }

    this.instanceCount = nSegments;
    this.lineSegmentsBuffer.addUpdateRange( 0, nSegments * 6 );
    this.lineSegmentsBuffer.needsUpdate = true;
    this.streamlineDistanceBuffer.addUpdateRange( 0, nSegments );
    this.streamlineDistanceBuffer.needsUpdate = true;
    if( !hasMask ) {
      this.computeBoundingBox();
      this.computeBoundingSphere();
    }

    // this.computeLineDistances();
    return this;

  }

  computeStreamlineDistances({ target, reset = false, visibleOnly = true } = {}) {
    return;
    if( reset ) {
      this.distanceToCenter.fill( 0.0 );
      this.streamlineDistance.fill( 0.0 );
      return;
    }
    if( !target || !target.isVector3 ) { return; }
    const positionOrig = this._positionArray;
    if( !positionOrig ) { return; }
    // calculate nearest distance to target
    const pointOffset = this.pointOffset,
          distanceToCenter = this.distanceToCenter,
          streamlineDistance = this.streamlineDistance,
          visibleTracts = this.visibleTracts;

    const point = new Vector3();
    let dist = 1e6; // Float32Array might not be infinity-friendly???
    streamlineDistance.fill( 1e3 );

    if( visibleOnly ) {
      let nn = 0;
      for ( let ii = 0; ii < this.visibleTractCount ; ii++ ) {
        const idx = visibleTracts[ ii ];
        const iStart = pointOffset[ idx ],
              iEnd   = pointOffset[ idx + 1 ];
        const nSegments = iEnd - iStart - 1;
        if( nSegments < 1 ) { continue; }
        dist = 1e6;
        for( let i = iStart; i < iEnd; i++ ) {
          const dist2 = point
            .fromArray( positionOrig, i * 3 )
            .distanceToSquared( target );
          if( dist2 < dist ) {
            dist = dist2;
          }
        }
        dist = Math.sqrt( dist );
        distanceToCenter[ idx ] = dist;
        streamlineDistance.fill( dist, nn, nn + nSegments );
        nn += nSegments;
      }
    } else {
      for( let idx = 0; idx < this.nTracts; idx++ ) {
        dist = 1e6;
        const iStart = pointOffset[ idx ],
              iEnd   = pointOffset[ idx + 1 ];
        for( let i = iStart; i < iEnd; i++ ) {
          const dist2 = point
            .fromArray( positionOrig, i * 3 )
            .distanceToSquared( target );
          if( dist2 < dist ) {
            dist = dist2;
          }
        }
        distanceToCenter[ idx ] = Math.sqrt( dist );
      }

      let nn = 0;
      for ( let ii = 0; ii < this.visibleTractCount ; ii++ ) {
        const idx = visibleTracts[ ii ];
        const iStart = pointOffset[ idx ],
              iEnd   = pointOffset[ idx + 1 ];
        const nSegments = iEnd - iStart - 1;
        if( nSegments < 1 ) { continue; }
        dist = distanceToCenter[ idx ];
        streamlineDistance.fill( dist, nn, nn + nSegments );
        nn += nSegments;
      }
    }

    this.streamlineDistanceBuffer.addUpdateRange( 0, this.instanceCount );
    this.streamlineDistanceBuffer.needsUpdate = true;

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
    const geometry = new StreamlineGeometry( fiber.pointOffset, fiber.points );
    // geometry.setPositions( fiber.points );
    this.lengthPerStreamline = fiber.lengthPerStreamline;
    this.streamlineVisibility = Array( geometry.nTracts ).fill(true);
    this._retentionRatio = 1;
    this._streamlineLengthMin = 0;
    this._streamlineLengthMax = Infinity;

    const material = new StreamlineMaterial( {
			color: 0xff0000,
			linewidth: 0.5, // in world units with size attenuation, pixels otherwise
			vertexColors: false,
			transparent: true,
			alphaToCoverage: true,

		} );
		material.color.set( g.color );
    material.alphaToCoverage = false;
		material.needsUpdate = true;
    this.object = new Mesh( geometry, material );
		this.object.scale.set( 1, 1, 1 );

		// filter mode
		this.highlightConfig = {
		  mode  : 'none',
		  radius: 1,

		  // should be the model space
		  center: new Vector3(),
		};
		this._canvas.$el.addEventListener( "viewerApp.canvas.setStreamlineHighlight", this._setHighlightMode );
		this._canvas.$el.addEventListener( "viewerApp.canvas.setSliceCrosshair", this._setCrosshairHandler );
		this._canvas.$el.addEventListener( "viewerApp.canvas.newObjectFocused", this._setFocusedObjectHandler );

  }

  finish_init(){
    // Finalize setups
    super.finish_init();

    this.registerToMap( ['tracts'] );

    let canvasStateHighlightConfig = this._canvas.get_state('streamline_highlight');
    if( canvasStateHighlightConfig ) {
      this.setHighlightMode( canvasStateHighlightConfig );
    }
  }

  dispose(){
    super.dispose();
    this.object.removeFromParent();
    const trackList = this._canvas.tracts.get( this.subject_code )
    if( trackList[ this.name ] === this ) {
      delete trackList[ this.name ];
    }

    try {
      this._canvas.$el.removeEventListener( "viewerApp.canvas.setStreamlineHighlight", this._setHighlightMode );
      this._canvas.$el.removeEventListener( "viewerApp.canvas.setSliceCrosshair", this._setCrosshairHandler );
      this._canvas.$el.removeEventListener( "viewerApp.canvas.newObjectFocused", this._setFocusedObjectHandler );
    } catch (e) {}

    try {
      this.object.material.dispose();
      this.object.geometry.dispose();
    } catch (e) {}
  }

  setHighlightMode({ mode, radius, center, update = true } = {}) {
    let needsUpdate = false;
    if( typeof mode === 'string' ) {
      const oldMode = this.highlightConfig.mode;
      switch (mode) {
        case 'electrode':
        case 'crosshair':
          this.highlightConfig.mode = mode;
          break;
        default:
          this.highlightConfig.mode = 'none';
          this.highlightConfig.radius = Infinity;
      }
      if( this.highlightConfig.mode !== oldMode ) {
        needsUpdate = true;
      }
    }
    if( this.highlightConfig.mode === 'none' ) {
      if( needsUpdate ) {
        this.updateHighlighted({ 'force' : true });
      }
      this.object.material.distanceThreshold = Infinity;
      this._canvas.needsUpdate = true;
      return;
    }
    if( typeof radius === 'number' ) {
      if( radius <= 0 ) { radius = 0; }
      const oldRadius = this.highlightConfig.radius;
      if( this.highlightConfig.radius != radius ) {
        this.highlightConfig.radius = radius;
        needsUpdate = true;
      }
    }
    if( !center || typeof center !== 'object' && !center.isVector3 ) {
      switch (mode) {
        case 'crosshair':
          center = this._canvas.crosshairGroup.position;
          break;
        default:
          center = this._canvas.highlightTarget.position;
      }
    }

    const modeCenter = tmpVec3.copy( center ).applyMatrix4( tmpMat4.copy( this.object.matrixWorld ).invert() );

    const dist = modeCenter.distanceToSquared( this.highlightConfig.center );
    if( dist > 0 ) {
      this.highlightConfig.center.copy( modeCenter );
      needsUpdate = true;
    }
    if( needsUpdate && update ) {
      // Update highlighted streamlines
      this.updateHighlighted({ 'force' : true });
    }
    this.object.material.distanceThreshold = this.highlightConfig.radius;
    this._canvas.needsUpdate = true;
  }


  _setHighlightMode = (event) => {
    this.setHighlightMode( event.detail );
  }

  _setCrosshairHandler = (event) => {
    if( this.highlightConfig.mode !== 'crosshair' ) { return; }
    this.setHighlightMode({ 'center' : this._canvas.crosshairGroup.position });
  }

  _setFocusedObjectHandler = (event) => {
    if( this.highlightConfig.mode !== 'electrode' ) { return; }
    this.setHighlightMode({ 'center' : this._canvas.highlightTarget.position });
  }

  updateHighlighted({ force = false, visibleOnly = true } = {}) {
    if( this.highlightConfig.mode === 'none' && !force ) { return; }
    if( this.highlightConfig.mode === 'none' ) {
      this.object.geometry.computeStreamlineDistances({ 'reset' : true });
    } else {
      this.object.geometry.computeStreamlineDistances({
        'reset' : false,
        'visibleOnly': visibleOnly,
        'target': this.highlightConfig.center,
      });
    }
    this._canvas.needsUpdate = true;
  }

  filterByLength({ min, max, retentionRatio } = {}) {
    if ( typeof retentionRatio !== "number" ) {
      retentionRatio = this._retentionRatio;
    } else {
      if( retentionRatio > 1 ) {
        retentionRatio = 1;
      } else if ( retentionRatio < 0.0 ) {
        retentionRatio = 0.0;
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
        if( nVisible >= 100 && rn > retentionRatio ) {
          streamlineVisibility[ ii ] = false;
        } else {
          streamlineVisibility[ ii ] = true;
        }
      }
    }
    this.object.geometry.filterVisible( streamlineVisibility );
    this.object.scale.set( 1, 1, 1 );
		// this.object.computeLineDistances();

		this.updateHighlighted({ 'force' : true, 'visibleOnly' : false });

  }

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){
    super.pre_render({ target : target });
    let linewidth = this._canvas.get_state("streamline_linewidth", 0.0);
    let shadowStrengh = 0.0;
    if( linewidth <= 0.0 ) {
      // automatically adjust linewidth such that linewidth * camera zoom level is 1.5
      if ( target === CONSTANTS.RENDER_CANVAS.main ) {
        const zoomLevel = this._canvas.mainCamera.zoom;
        const linewidthFactor = CONSTANTS.GEOMETRY["streamline-linewidth-factor"];
        linewidth = linewidthFactor / zoomLevel;
        if ( linewidth > linewidthFactor ) {
          // shadowStrengh = - linewidth / linewidthFactor + 1;
          linewidth = linewidthFactor;
        }
      } else {
        linewidth = 0.5;
      }
    }
    this.object.material.linewidth = linewidth;
    this.object.material.shadowStrengh = shadowStrengh;

    if( !this.object.visible ) { return; }

    let minLen = this._canvas.get_state('streamline_minlen', 0);
    if( minLen <= 0 ) { minLen = 0; }
    let maxLen = this._canvas.get_state('streamline_maxlen', Infinity);
    if( maxLen >= 500 ) { maxLen = Infinity; }
    let retentionRatio = this._canvas.get_state('streamline_retention', 0);
    if( retentionRatio < 0.01 ) {
      // 500 streamlines
      retentionRatio = CONSTANTS.GEOMETRY["streamline-retention-count"] / this.object.geometry.nTracts;
      if( retentionRatio > 1 ) {
        retentionRatio = 1;
      }
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

