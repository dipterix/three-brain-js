import { AbstractThreeBrainObject } from './abstract.js';
import { Vector3, Matrix4, Color, Quaternion, Box3, Sphere,
         Data3DTexture, NearestFilter, FloatType,
         RGBAFormat, RedFormat, UnsignedByteType, LinearFilter,
         Mesh, InstancedMesh, Float32BufferAttribute,
         InstancedInterleavedBuffer, InterleavedBufferAttribute,
         InstancedBufferGeometry, BoxGeometry, BufferGeometry, SphereGeometry,
         BufferAttribute, InstancedBufferAttribute,
         MeshPhysicalMaterial, MeshBasicMaterial,
         DoubleSide, FrontSide } from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { StreamlineMaterial } from '../shaders/StreamlineMaterial.js';
import { Line2 }from 'three/addons/lines/Line2.js';
import { LineMaterial }from '../shaders/LineMaterial.js';
import { mulberry32 } from '../utility/mulberry32.js'
import { formatDataValue } from '../utility/formatDataValue.js';
import { computeStreamlineToTargets, makeSinglePointTree } from '../Math/computeStreamlineToTargets.js';
import { startWorker, stopWorker } from '../core/Workers.js';
import { CONSTANTS } from '../core/constants.js';


const tmpVec3 = new Vector3();
const _start = new Vector3();
const _end = new Vector3();
const tmpMat4 = new Matrix4();

class StreamlineGeometry extends InstancedBufferGeometry {

  computeBoundingBox() {

    if ( this.boundingBox === null ) {
      this.boundingBox = new Box3();
    }
    this.boundingBox.setFromArray( this.pointPositions );
  }

  computeBoundingSphere() {

    if ( this.boundingBox === null ) {
      this.computeBoundingBox();
    }
    if ( this.boundingSphere === null ) {
      this.boundingSphere = new Sphere();
    }
    const center = this.boundingSphere.center;
    const nPoints = this.pointPositions.length / 3;

    // Find the farthest distance from center to any vertex
    let maxRadiusSq = 0;

    for ( let i = 0; i < nPoints; i ++ ) {

      tmpVec3.fromArray( this.pointPositions, i * 3 );
      maxRadiusSq = Math.max( maxRadiusSq, center.distanceToSquared( tmpVec3 ) );

    }

    this.boundingSphere.center.copy( center );
    this.boundingSphere.radius = Math.sqrt( maxRadiusSq );

    if ( isNaN( this.boundingSphere.radius ) ) {

      console.error( 'StreamlineGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.', this );

    }
  }

  constructor( pointPositions, pointOffset ) {

    super();

    const positions = [ - 1, 2, 0, 1, 2, 0, - 1, - 1, 0, 1, - 1, 0 ];
    const uvs = [ - 1, 2, 1, 2, - 1, - 2, 1, - 2 ];
    const index = [ 0, 2, 1, 2, 3, 1 ];

    this.setIndex( index );
    this.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
    this.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );

    this.isStreamlineGeometry = true;
    this.type = 'StreamlineGeometry';

    if ( pointOffset[0] != 0 ) {
      this.pointOffset = [0, ...pointOffset];
    } else {
      this.pointOffset = pointOffset;
    }

    this.nTracts = this.pointOffset.length - 1;
    this.nSegments = this.pointOffset[ this.nTracts ] - 1;
    const length = this.pointOffset[ this.nTracts ];

    // Create an indexing array
    const randomGenerator = mulberry32(42);
    const tractIndex = Array.from({ length: this.nTracts }, () => randomGenerator())
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value)
      .map(entry => entry.index);
    this.tractIndex = tractIndex;

    // ith tract, seg length, start index
    this.tractRange = new Uint32Array( this.nTracts * 3 );

    this.pointPositions = new Float32Array( this.nSegments * 3 + 3 );
    this.setAttribute( 'instanceStart',
      new InstancedBufferAttribute( this.pointPositions.subarray(0, this.nSegments * 3), 3, 0 ) ); // xyz
    this.setAttribute( 'instanceEnd',
      new InstancedBufferAttribute( this.pointPositions.subarray(3), 3, 0 ) ); // xyz

    // Also create instanceWeight: mask array with
    // -2 - shall not plot
    // -1 - invisible (by filters)
    // >= 0 - visible
    const instanceWeight = new Float32Array( this.nSegments ).fill(0);
    this.instanceWeight = instanceWeight;
    this.setAttribute( 'instanceWeight',
      new InstancedBufferAttribute( instanceWeight, 1, 0 ) ); // xyz

    this.setAttribute( 'distanceToTargets',
      new InstancedBufferAttribute( new Float32Array( this.nSegments ), 1, 0 ) ); // xyz

    // Construct mapping from tractIndex
    let iPos = 0;
    for ( let i = 0; i < this.nTracts ; i++ ) {
      const idx = tractIndex[ i ],
            iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ],
            len = iEnd - iStart;
      if( len <= 0 ) { continue; }

      this.tractRange[ i * 3 ] = idx;

      // nSegments, including the last one, which is invalid
      this.tractRange[ i * 3 + 1 ] = len;
      this.tractRange[ i * 3 + 2 ] = iPos;

      // start of the tract, then fill len + 1 points
      // len + 1 th segment is invalid
      instanceWeight[ iPos + len - 1 ] = -2;

      // next tract
      iPos += len;
    }

    this.setPositions( pointPositions );

    this.instanceCount = this.nSegments;
    this.computeBoundingBox();
    this.computeBoundingSphere();
  }

  setPositions( array ) {

    const tractRange = this.tractRange,
          pointOffset = this.pointOffset,
          pointPositions = this.pointPositions,
          instanceWeight = this.instanceWeight;

    for ( let i = 0; i < this.nTracts ; i++ ) {
      const idx = this.tractRange[ i * 3 ],
            len = this.tractRange[ i * 3 + 1 ],
            iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ];
      if( len <= 0 ) { continue; }

      let iPos = this.tractRange[ i * 3 + 2 ];
      for( let iArr = iStart; iArr < iEnd; iPos++, iArr++ ) {

        const iPos3 = iPos * 3,
              iArr3 = iArr * 3;
        pointPositions[ iPos3 ] = array[ iArr3 ];
        pointPositions[ iPos3 + 1 ] = array[ iArr3 + 1 ];
        pointPositions[ iPos3 + 2 ] = array[ iArr3 + 2 ];

      }
    }

    this.getAttribute('instanceStart').needsUpdate = true;
    this.getAttribute('instanceEnd').needsUpdate = true;

    this.computeBoundingBox();
    this.computeBoundingSphere();
    return this;
  }

  setWeights( weights ) {
    const filterLength = Math.min(weights.length, this.nTracts);
    const tractRange = this.tractRange,
          pointOffset = this.pointOffset,
          instanceWeight = this.instanceWeight;

    for ( let i = 0; i < filterLength ; i++ ) {
      const idx = this.tractRange[ i * 3 ],
            len = this.tractRange[ i * 3 + 1 ],
            iStart = pointOffset[ idx ],
            iEnd   = pointOffset[ idx + 1 ],
            weight = weights[ idx ];
      if( len <= 0 ) { continue; }

      let iPos = this.tractRange[ i * 3 + 2 ];
      for( let j = 0; j < len - 1; j++, iPos++ ) {
        instanceWeight[ iPos ] = weight;
      }
    }

    this.getAttribute('instanceWeight').needsUpdate = true;

    return this;

  }

  async computeStreamlineDistances({
    targets, reset = false, visibleOnly = true,
    matrixWorld = new Matrix4()
  } = {}) {
    const instanceWeightAttr = this.getAttribute('instanceWeight'),
          instanceWeight = instanceWeightAttr.array,
          distanceToTargetsAttr = this.getAttribute('distanceToTargets'),
          distanceToTargets = distanceToTargetsAttr.array,
          pointOffset = this.pointOffset,
          pointPositions = this.pointPositions,
          tractRange = this.tractRange;

    if( reset ) {
      distanceToTargetsAttr.needsUpdate = true;
      distanceToTargets.fill( 0.0 );
      return this;
    }
    if(!targets) { return this; }

    // const targetArray = target.toArray();

    let maxInstanceCount = Infinity;
    if( visibleOnly ) {
      maxInstanceCount = this.instanceCount;
    }

    computeStreamlineToTargets(
      targets,                  // Float32Array or kdtree
      distanceToTargets,        // Float32Array, output: distance per segment
      instanceWeight,           // Float32Array, one per segment
      pointOffset,              // Int32Array, length nTracts+1
      pointPositions,           // Float32Array, length ~ 3*(total segments+1)
      tractRange,               // Uint32Array, nTracts * 3
      maxInstanceCount,         // Maximum number of instances
      matrixWorld
    );

    distanceToTargetsAttr.needsUpdate = true;

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

    // `imageObject` is set by the drag & drop handlers, which parse the file
    // themselves. Streamlines declared from R only carry a file path: the file
    // is registered as cached group data and loaded by the group loader, so ask
    // the group for it.
    let fiber = g.imageObject;
    if( !fiber && typeof g.streamline_name === "string" && g.group ) {
      fiber = canvas.get_data(
        `streamline_data_${ g.streamline_name }`, g.name, g.group.group_name );
    }

    if( !fiber || fiber.isInvalid || !fiber.points || !fiber.pointOffset ) {
      // The file is missing or could not be parsed. Stay inert instead of
      // throwing: one bad tract file must not take down the whole viewer.
      this.isInvalid = true;
      console.warn(`Streamline: unable to load streamline data for [${ this.name }]`);
      return;
    }

    const geometry = new StreamlineGeometry( fiber.points, fiber.pointOffset );
    // geometry.workerScript = this._canvas.workerScript;
    geometry.setWeights( fiber.lengthPerStreamline );
    this.lengthPerStreamline = fiber.lengthPerStreamline;
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
    this.object = new Line2( geometry, material );
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
    if( this.isInvalid ) { return; }

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
    if( this.isInvalid ) { return; }
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

  setHighlightMode({ mode, distanceToTargetsThreshold, fadedLinewidth, forceUpdate = false } = {}) {
    if( this.isInvalid ) { return; }
    let targetsNeedsUpdate = forceUpdate;
    if( typeof mode === 'string' && this.highlightConfig.mode !== mode ) {
      this.highlightConfig.mode = mode;
      targetsNeedsUpdate = true;
    }
    if( typeof distanceToTargetsThreshold === 'number' ) {
      if( distanceToTargetsThreshold <= 0 ) { distanceToTargetsThreshold = 0; }
      if( this.highlightConfig.distanceToTargetsThreshold != distanceToTargetsThreshold ) {
        this.highlightConfig.distanceToTargetsThreshold = distanceToTargetsThreshold;
      }
    }
    if( typeof fadedLinewidth === 'number' ) {
      if( fadedLinewidth <= 0 ) { fadedLinewidth = 0; }
      if( this.highlightConfig.fadedLinewidth != fadedLinewidth ) {
        this.highlightConfig.fadedLinewidth = fadedLinewidth;
      }
    }

    // update highlight mode
    switch ( this.highlightConfig.mode ) {
      case 'electrode':
      case 'crosshair':
        targetsNeedsUpdate = true;
        this.highlightConfig.datacube2Name = null;
        break;
      case 'active volume':
        // {"activeDataCube2Instance" => undefined}
        const datacube2Instance = this._canvas.get_state( "activeDataCube2Instance" );
        const oldInstName = this.highlightConfig.datacube2Name;
        if( datacube2Instance ) {
          this.highlightConfig.datacube2Name = datacube2Instance.name;
          if( datacube2Instance.name !== oldInstName ) {
            targetsNeedsUpdate = true;
          }
        } else {
          this.highlightConfig.datacube2Name = null;
        }
        break;
      default:
        this.highlightConfig.mode = 'none';
        this.highlightConfig.datacube2Name = null;
        this.highlightConfig.distanceToTargetsThreshold = Infinity;
        if( targetsNeedsUpdate ) {
          // reset
          this._updateHighlighted({ 'force' : true });
        }
        this.object.material.distanceThreshold = Infinity;
        this._canvas.needsUpdate = true;
        return;
    }

    let kdtree = null;

    if( targetsNeedsUpdate ) {
      switch ( this.highlightConfig.mode ) {
        case 'crosshair':
          // held by reference: the crosshair moves and the tree must follow
          kdtree = makeSinglePointTree( this._canvas.crosshairGroup.position );
          break;
        case 'electrode':
          kdtree = makeSinglePointTree( this._canvas.highlightTarget.position );
          break;
        case 'active volume':
          const datacube2Instance = this._canvas.get_state( "activeDataCube2Instance" );
          if( datacube2Instance ) {
            kdtree = datacube2Instance._kdtree;
          }
          break;
        default:
          kdtree = null;
          // const center = this._canvas.highlightTarget.position;
      }
      // Update highlighted streamlines
      this._updateHighlighted(kdtree, { 'force' : true });
    }
    this.object.material.distanceThreshold = this.highlightConfig.distanceToTargetsThreshold;
    this.object.material.fadedWidth = this.highlightConfig.fadedLinewidth;
    this._canvas.needsUpdate = true;
  }


  _setHighlightMode = (event) => {
    this.setHighlightMode( event.detail );
  }

  _setCrosshairHandler = (event) => {
    if( this.highlightConfig.mode !== 'crosshair' ) { return; }
    this.setHighlightMode();
  }

  _setFocusedObjectHandler = (event) => {
    if( this.highlightConfig.mode !== 'electrode' ) { return; }
    this.setHighlightMode();
  }

  _updateHighlighted(targets, { force = false, visibleOnly = true } = {}) {
    if( this.highlightConfig.mode === 'none' && !force ) { return; }

    let promise;
    if( this.highlightConfig.mode === 'none' ) {
      promise = this.object.geometry.computeStreamlineDistances({ 'reset' : true });
    } else {
      promise = this.object.geometry.computeStreamlineDistances({
        'reset' : false,
        'visibleOnly': visibleOnly,
        'targets': targets,
        'matrixWorld' : this.object.matrixWorld
      });
    }

    return promise.then(() => {
      this._canvas.needsUpdate = true;
    })
  }

  updateFocusMode({ mode, objectType } = {}) {
    if( mode === "ruler" || objectType === "all" || objectType === "streamline" ) {
      super.updateFocusMode({ mode : mode, objectType : objectType });
    } else {
      this.object.layers.disable( CONSTANTS.LAYER_SYS_RAYCASTER_ALL_15 );
    }
  }

  /**
   * Resolve a segment index (what `Line2` reports as `faceIndex`) to the tract
   * it belongs to.
   *
   * `tractRange` holds `[ tractID, nSegments, firstSegment ]` per tract, so this
   * is a scan for the range containing `segmentIndex`.
   *
   * @returns {{ tractID: number, length: number }|undefined}
   */
  tractFromSegment( segmentIndex ) {
    if( !this.object ) { return; }
    const geometry = this.object.geometry;
    if( !geometry || typeof segmentIndex !== "number" || segmentIndex < 0 ) { return; }

    const tractRange = geometry.tractRange;
    if( !tractRange ) { return; }

    const nTracts = tractRange.length / 3;
    for( let i = 0; i < nTracts; i++ ) {
      const first = tractRange[ i * 3 + 2 ],
            count = tractRange[ i * 3 + 1 ];
      if( segmentIndex >= first && segmentIndex < first + count ) {
        const tractID = tractRange[ i * 3 ];
        const lengths = this.lengthPerStreamline;
        return {
          tractID : tractID,
          length  : lengths ? lengths[ tractID ] : undefined,
        };
      }
    }
    return;
  }

  /**
   * Whether a segment belongs to a streamline that is actually drawn.
   *
   * `Line2.raycast` honours `geometry.instanceCount`, so retention and length
   * filtering are respected for free, but segments the shader discards are still
   * inside that count. `instanceWeight` encodes all three states (-2 never
   * plotted, being the connector at the end of each tract; -1 filtered out;
   * >= 0 visible), so this is the same `>= 0` test the distance sweep uses.
   */
  segmentIsVisible( segmentIndex ) {
    if( !this.object || !this.object.geometry ) { return false; }
    const weights = this.object.geometry.instanceWeight;
    if( !weights || segmentIndex < 0 || segmentIndex >= weights.length ) { return false; }
    return weights[ segmentIndex ] >= 0;
  }

  /**
   * Focus-mode info lines. `hit.faceIndex` is a segment index; the panel reports
   * the 1-based streamline it belongs to.
   */
  getInfoText( type, hit ) {
    switch ( type ) {

      case "type": {
        const circuit = this._params.streamline_group,
              bundle = this._params.streamline_name;
        const label = ( circuit && bundle ) ? `${ circuit }/${ bundle }` : ( bundle || circuit );
        const nSegments = ( this.object && this.object.geometry )
          ? this.object.geometry.nSegments : undefined;
        const count = ( nSegments === undefined ) ? "" : `, n=${ nSegments }`;
        if( label ) {
          return `Type:      Streamline (${ label }${ count })`;
        }
        return `Type:      Streamline${ count ? ` (${ count.slice(2) })` : "" }`;
      }

      case "index": {
        if( !hit || typeof hit.segmentIndex !== "number" ) { return; }
        const tract = this.tractFromSegment( hit.segmentIndex );
        if( !tract ) { return; }
        let text = `Line:      ${ tract.tractID + 1 }`;
        if( typeof tract.length === "number" && !isNaN( tract.length ) ) {
          text += `   Length: ${ formatDataValue( tract.length ) }`;
        }
        return text;
      }

      case "name":
        return this.name;

      // an unanswered key contributes no line
      default:
        return;
    }
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
    const nRemain = Math.max(Math.ceil( retentionRatio * totalTracts ), 100);

    const streamlineWeights = new Float16Array( lengthPerStreamline.length ).fill( - 1 );

    const tractRange = this.object.geometry.tractRange;

    let nVisible = 0, instanceCount = 0;
    for ( let iTract = 0; iTract < totalTracts; iTract++ ) {
      const idx = tractRange[ iTract * 3 ],
            len = tractRange[ iTract * 3 + 1 ],
            lineLength = lengthPerStreamline[ idx ];
      if( len <= 1 ) { continue; }

      if( lineLength >= min && lineLength <= max ) {
        streamlineWeights[ idx ] = lineLength;
        nVisible++;
      }
      instanceCount += len;
      if( nVisible >= nRemain ) {
        break;
      }
    }
    this.object.geometry.setWeights( streamlineWeights );
    this.object.geometry.instanceCount = instanceCount;

    this.setHighlightMode();

  }

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){
    if( this.isInvalid ) { return; }
    super.pre_render({ target : target });

    // Which cameras to render to. Re-applied only when the choice changes, and
    // ahead of the visibility guard below so a hidden bundle still carries the
    // right layer once it is shown again.
    const displayLayer = this._canvas.get_state(
      "streamline_display", CONSTANTS.LAYER_SYS_ALL_CAMERAS_7 );
    if( this._displayLayer !== displayLayer ) {
      this._displayLayer = displayLayer;
      this._params.layer = displayLayer;
      // via `setLayers` so the raycaster layer is preserved
      this.setLayers();
    }

    const lineOpacity = this._canvas.get_state("streamline_opacity", 1.0);

    // The shader divides by the camera's own zoom, so no CPU correction here.
    // This also fixes the side panels, which used to be pinned to a constant
    // because only `mainCamera.zoom` was available at this point.
    const defaultLinewidth = CONSTANTS.GEOMETRY["streamline-linewidth-factor"];
    let linewidth = this._canvas.get_state("streamline_linewidth", defaultLinewidth);
    if( typeof linewidth !== "number" || linewidth <= 0.0 ) {
      linewidth = defaultLinewidth;
    }

    this.object.material.linewidth = linewidth;
    this.object.material.lineOpacity = lineOpacity;

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

