import { Vector2, LineDashedMaterial } from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, float, vec2, vec3, vec4, attribute, uv, mix, smoothstep,
  positionGeometry, modelViewMatrix, cameraProjectionMatrix, varyingProperty,
  diffuseColor, dashSize, gapSize, materialLineWidth, materialLineScale,
  materialLineDashSize, materialLineGapSize, materialLineDashOffset,
  viewport, screenDPR
} from 'three/tsl';

/**
 * Fat lines for `LineSegments2` and `Line2`, as a node (TSL) material. It is a
 * fork of three's `Line2NodeMaterial` that keeps what the viewer's GLSL fork of
 * `LineMaterial` did:
 *   - `lineWidthNode` can replace the width, e.g. with a per-segment attribute
 *   - lines in world units are shaded darker towards their edges, like tubes
 *   - alpha-to-coverage stays off unless asked for
 *
 * Screen-space widths are CSS pixels of the canvas being drawn, as before:
 * three's WebGL `LineSegments2` overwrote `resolution` with each renderer's
 * viewport. `resolution` is still a property, for callers and for raycasting.
 *
 * Use it with the `three/addons/lines/LineSegments2.js` and `Line2.js` classes.
 * Their raycasting reads `material.resolution`, which callers set to the main
 * canvas size; the WebGPU variants read the viewport of whichever renderer drew
 * last, often a side view.
 */

const _defaultValues = /*@__PURE__*/ new LineDashedMaterial();

const worldStart = varyingProperty( 'vec3', 'worldStart' );
const worldEnd = varyingProperty( 'vec3', 'worldEnd' );
const lineDistance = varyingProperty( 'float', 'lineDistance' );
const worldPos = varyingProperty( 'vec4', 'worldPos' );

const trimSegmentAlpha = Fn( ( { start, end } ) => {

  const a = cameraProjectionMatrix.element( 2 ).element( 2 ); // 3nd entry in 3th column
  const b = cameraProjectionMatrix.element( 3 ).element( 2 ); // 3nd entry in 4th column

  // different near estimates for reversed and default depth buffers; a is
  // positive with a reversed depth buffer
  const nearEstimate = a.greaterThan( 0 ).select( b.negate().div( a.add( 1 ) ), b.mul( - 0.5 ).div( a ) );

  return nearEstimate.sub( start.z ).div( end.z.sub( start.z ) );

}, { start: 'vec4', end: 'vec4', return: 'float' } );

const closestLineToLine = Fn( ( { p1, p2, p3, p4 } ) => {

  const p13 = p1.sub( p3 );
  const p43 = p4.sub( p3 );

  const p21 = p2.sub( p1 );

  const d1343 = p13.dot( p43 );
  const d4321 = p43.dot( p21 );
  const d1321 = p13.dot( p21 );
  const d4343 = p43.dot( p43 );
  const d2121 = p21.dot( p21 );

  const denom = d2121.mul( d4343 ).sub( d4321.mul( d4321 ) );
  const numer = d1343.mul( d4321 ).sub( d1321.mul( d4343 ) );

  const mua = numer.div( denom ).clamp();
  const mub = d1343.add( d4321.mul( mua ) ).div( d4343 ).clamp();

  return vec2( mua, mub );

}, { p1: 'vec3', p2: 'vec3', p3: 'vec3', p4: 'vec3', return: 'vec2' } );

const lineWidthOf = ( material ) =>
  material.lineWidthNode ? float( material.lineWidthNode ) : materialLineWidth;

const mvpLine = Fn( ( { material } ) => {

  const useDash = material._useDash;
  const useWorldUnits = material._useWorldUnits;
  const lineWidth = lineWidthOf( material );

  const instanceStart = attribute( 'instanceStart' );
  const instanceEnd = attribute( 'instanceEnd' );

  // camera space

  const start = vec4( modelViewMatrix.mul( vec4( instanceStart, 1.0 ) ) ).toVar( 'start' );
  const end = vec4( modelViewMatrix.mul( vec4( instanceEnd, 1.0 ) ) ).toVar( 'end' );

  let distanceStart, distanceEnd;

  if ( useDash ) {

    distanceStart = float( attribute( 'instanceDistanceStart' ) ).toVar( 'distanceStart' );
    distanceEnd = float( attribute( 'instanceDistanceEnd' ) ).toVar( 'distanceEnd' );

  }

  if ( useWorldUnits ) {

    worldStart.assign( start.xyz );
    worldEnd.assign( end.xyz );

  }

  const aspect = viewport.z.div( viewport.w );

  // segments that end in, or behind, the camera plane of a perspective camera
  // must be trimmed before the ndc-space calculations below

  const perspective = cameraProjectionMatrix.element( 2 ).element( 3 ).equal( - 1.0 ); // 4th entry in the 3rd column

  If( perspective, () => {

    If( start.z.lessThan( 0.0 ).and( end.z.greaterThan( 0.0 ) ), () => {

      const alpha = trimSegmentAlpha( { start, end } );
      end.assign( vec4( mix( start.xyz, end.xyz, alpha ), end.w ) );

      if ( useDash ) {

        distanceEnd.assign( mix( distanceStart, distanceEnd, alpha ) );

      }

    } ).ElseIf( end.z.lessThan( 0.0 ).and( start.z.greaterThanEqual( 0.0 ) ), () => {

      const alpha = trimSegmentAlpha( { start: end, end: start } );
      start.assign( vec4( mix( end.xyz, start.xyz, alpha ), start.w ) );

      if ( useDash ) {

        distanceStart.assign( mix( distanceEnd, distanceStart, alpha ) );

      }

    } );

  } );

  if ( useDash ) {

    const dashScaleNode = material.dashScaleNode ? float( material.dashScaleNode ) : materialLineScale;
    const offsetNode = material.offsetNode ? float( material.offsetNode ) : materialLineDashOffset;

    let lineDist = positionGeometry.y.lessThan( 0.5 ).select( dashScaleNode.mul( distanceStart ), dashScaleNode.mul( distanceEnd ) );
    lineDist = lineDist.add( offsetNode );

    lineDistance.assign( lineDist );

  }

  // clip space
  const clipStart = cameraProjectionMatrix.mul( start );
  const clipEnd = cameraProjectionMatrix.mul( end );

  // ndc space
  const ndcStart = clipStart.xyz.div( clipStart.w );
  const ndcEnd = clipEnd.xyz.div( clipEnd.w );

  // direction
  const dir = ndcEnd.xy.sub( ndcStart.xy ).toVar();

  // account for clip-space aspect ratio
  dir.x.assign( dir.x.mul( aspect ) );
  dir.assign( dir.normalize() );

  const clip = vec4().toVar();

  if ( useWorldUnits ) {

    // get the offset direction as perpendicular to the view vector

    const worldDir = end.xyz.sub( start.xyz ).normalize();
    const tmpFwd = mix( start.xyz, end.xyz, 0.5 ).normalize();
    const worldUp = worldDir.cross( tmpFwd ).normalize();
    const worldFwd = worldDir.cross( worldUp );

    worldPos.assign( positionGeometry.y.lessThan( 0.5 ).select( start, end ) );

    // height offset
    const hw = lineWidth.mul( 0.5 );
    worldPos.addAssign( vec4( positionGeometry.x.lessThan( 0.0 ).select( worldUp.mul( hw ), worldUp.mul( hw ).negate() ), 0 ) );

    // dashes have no endcaps, so do not extend the line
    if ( ! useDash ) {

      // cap extension
      worldPos.addAssign( vec4( positionGeometry.y.lessThan( 0.5 ).select( worldDir.mul( hw ).negate(), worldDir.mul( hw ) ), 0 ) );

      // add width to the box
      worldPos.addAssign( vec4( worldFwd.mul( hw ), 0 ) );

      // endcaps
      If( positionGeometry.y.greaterThan( 1.0 ).or( positionGeometry.y.lessThan( 0.0 ) ), () => {

        worldPos.subAssign( vec4( worldFwd.mul( 2.0 ).mul( hw ), 0 ) );

      } );

    }

    // project the worldpos
    clip.assign( cameraProjectionMatrix.mul( worldPos ) );

    // shift the depth of the projected points so the line segments overlap neatly
    const clipPose = vec3().toVar();

    clipPose.assign( positionGeometry.y.lessThan( 0.5 ).select( ndcStart, ndcEnd ) );
    clip.z.assign( clipPose.z.mul( clip.w ) );

  } else {

    const offset = vec2( dir.y, dir.x.negate() ).toVar( 'offset' );

    // undo aspect ratio adjustment
    dir.x.assign( dir.x.div( aspect ) );
    offset.x.assign( offset.x.div( aspect ) );

    // sign flip
    offset.assign( positionGeometry.x.lessThan( 0.0 ).select( offset.negate(), offset ) );

    // endcaps
    If( positionGeometry.y.lessThan( 0.0 ), () => {

      offset.assign( offset.sub( dir ) );

    } ).ElseIf( positionGeometry.y.greaterThan( 1.0 ), () => {

      offset.assign( offset.add( dir ) );

    } );

    // adjust for linewidth
    offset.assign( offset.mul( lineWidth ) );

    // widths are CSS pixels of the canvas being drawn
    offset.assign( offset.div( viewport.w.div( screenDPR ) ) );

    // select end
    clip.assign( positionGeometry.y.lessThan( 0.5 ).select( clipStart, clipEnd ) );

    // back to clip space
    offset.assign( offset.mul( clip.w ) );

    clip.assign( clip.add( vec4( offset, 0, 0 ) ) );

  }

  return clip;

} )();

// Discards fragments outside the line, and returns ( alpha, shade ) to
// multiply the color with
const lineFragment = Fn( ( { material, renderer } ) => {

  const useAlphaToCoverage = material._useAlphaToCoverage && renderer.currentSamples > 0;
  const useDash = material._useDash;
  const useWorldUnits = material._useWorldUnits;
  const lineWidth = lineWidthOf( material );

  const vUv = uv();

  if ( useDash ) {

    const dashSizeNode = material.dashSizeNode ? float( material.dashSizeNode ) : materialLineDashSize;
    const gapSizeNode = material.gapSizeNode ? float( material.gapSizeNode ) : materialLineGapSize;

    dashSize.assign( dashSizeNode );
    gapSize.assign( gapSizeNode );

    vUv.y.lessThan( - 1.0 ).or( vUv.y.greaterThan( 1.0 ) ).discard(); // discard endcaps
    lineDistance.mod( dashSize.add( gapSize ) ).greaterThan( dashSize ).discard(); // todo - FIX

  }

  const alpha = float( 1 ).toVar( 'alpha' );
  const shade = float( 1 ).toVar( 'shade' );

  if ( useWorldUnits ) {

    // closest points on the view ray and the segment. The ray runs from the view
    // origin through the fragment, also for orthographic cameras, as in the
    // GLSL fork (its orthographic branch was only taken for perspective cameras)
    const rayEnd = worldPos.xyz.normalize().mul( 1e5 );
    const lineDir = worldEnd.sub( worldStart );
    const params = closestLineToLine( { p1: worldStart, p2: worldEnd, p3: vec3( 0.0, 0.0, 0.0 ), p4: rayEnd } );

    const p1 = worldStart.add( lineDir.mul( params.x ) );
    const p2 = rayEnd.mul( params.y );
    const delta = p1.sub( p2 );
    const norm = delta.length().div( lineWidth );

    // darker towards the sides, like a tube; not on the endcaps
    const lineDirUnit = lineDir.normalize();
    const across = delta.sub( lineDirUnit.mul( delta.dot( lineDirUnit ) ) );
    const residual = vec2( across.x, across.y ).length().div( lineWidth ).mul( 4.0 ).sub( 1.0 ).toVar();
    If( residual.greaterThan( 0.0 ).and( residual.lessThanEqual( 1.0 ) ), () => {

      shade.assign( smoothstep( 0.0, 1.2, residual ).oneMinus() );

    } );

    if ( useAlphaToCoverage ) {

      const dnorm = norm.fwidth();
      alpha.assign( smoothstep( dnorm.negate().add( 0.5 ), dnorm.add( 0.5 ), norm ).oneMinus() );

    } else {

      norm.greaterThan( 0.5 ).discard();

    }

  } else {

    // round endcaps

    if ( useAlphaToCoverage ) {

      const a = vUv.x;
      const b = vUv.y.greaterThan( 0.0 ).select( vUv.y.sub( 1.0 ), vUv.y.add( 1.0 ) );

      const len2 = a.mul( a ).add( b.mul( b ) );

      const dlen = float( len2.fwidth() ).toVar( 'dlen' );

      If( vUv.y.abs().greaterThan( 1.0 ), () => {

        alpha.assign( smoothstep( dlen.oneMinus(), dlen.add( 1 ), len2 ).oneMinus() );

      } );

    } else {

      If( vUv.y.abs().greaterThan( 1.0 ), () => {

        const a = vUv.x;
        const b = vUv.y.greaterThan( 0.0 ).select( vUv.y.sub( 1.0 ), vUv.y.add( 1.0 ) );
        const len2 = a.mul( a ).add( b.mul( b ) );

        len2.greaterThan( 1.0 ).discard();

      } );

    }

  }

  return vec2( alpha, shade );

} )();

class LineMaterial extends NodeMaterial {

  static get type() {

    return 'LineMaterial';

  }

  constructor( parameters = {} ) {

    super();

    this.isLineMaterial = true;

    this.setDefaultValues( _defaultValues );

    this.vertexColors = parameters.vertexColors;

    this.dashOffset = 0;

    // replaces `linewidth` when set, e.g. `attribute( 'linewidth', 'float' )`
    this.lineWidthNode = null;

    this.offsetNode = null;
    this.dashScaleNode = null;
    this.dashSizeNode = null;
    this.gapSizeNode = null;

    // the main canvas size, set by callers; read by `LineSegments2.raycast`
    this.resolution = new Vector2( 1, 1 );

    this._useDash = parameters.dashed ?? false;
    this._useAlphaToCoverage = false;
    this._useWorldUnits = false;

    this.setValues( parameters );

  }

  setupDiffuseColor( builder ) {

    super.setupDiffuseColor( builder );

    const alphaShade = vec2( lineFragment ).toVar( 'alphaShade' );
    diffuseColor.a.mulAssign( alphaShade.x );
    diffuseColor.rgb.mulAssign( alphaShade.y );

    if ( this.vertexColors === true && builder.geometry.hasAttribute( 'instanceColorStart' ) ) {

      const instanceColorStart = attribute( 'instanceColorStart' );
      const instanceColorEnd = attribute( 'instanceColorEnd' );

      const instanceColor = positionGeometry.y.lessThan( 0.5 ).select( instanceColorStart, instanceColorEnd );

      diffuseColor.rgb.mulAssign( instanceColor );

    }

  }

  setupModelViewProjection( /*builder*/ ) {

    return mvpLine;

  }

  get worldUnits() {

    return this._useWorldUnits;

  }

  set worldUnits( value ) {

    if ( this._useWorldUnits !== value ) {

      this._useWorldUnits = value;
      this.needsUpdate = true;

    }

  }

  get dashed() {

    return this._useDash;

  }

  set dashed( value ) {

    if ( this._useDash !== value ) {

      this._useDash = value;
      this.needsUpdate = true;

    }

  }

  get alphaToCoverage() {

    return this._useAlphaToCoverage;

  }

  set alphaToCoverage( value ) {

    if ( this._useAlphaToCoverage !== value ) {

      this._useAlphaToCoverage = value;
      this.needsUpdate = true;

    }

  }

  copy( source ) {

    super.copy( source );

    this.resolution.copy( source.resolution );
    this._useDash = source._useDash;
    this._useAlphaToCoverage = source._useAlphaToCoverage;
    this._useWorldUnits = source._useWorldUnits;

    return this;

  }

}

export { LineMaterial };
