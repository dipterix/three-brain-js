import { Vector2, LineBasicMaterial } from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, float, vec2, vec3, vec4, uniform, attribute, select, max,
  smoothstep, fwidth, positionGeometry, modelViewMatrix, cameraProjectionMatrix,
  varyingProperty, diffuseColor, materialLineWidth, materialReference
} from 'three/tsl';

/**
 * Streamlines (tractography), as a node (TSL) material for `Line2` with a
 * `StreamlineGeometry` (`geometry/streamline.js`).
 *
 * Each segment is a quad expanded in view space. Its width is `linewidth`
 * divided by the camera zoom, so tracts keep their on-screen thickness while
 * zooming, in every view. Segments with a negative `instanceWeight` (filtered
 * out, or the gap between two tracts) are not drawn.
 *
 * The color is shaded darker towards the edges, like a tube, unless the line
 * is only a pixel or two wide. With `distanceThreshold`, segments at least that
 * far from the targets (`distanceToTargets` attribute) are drawn `fadedWidth`
 * times as wide, at half brightness.
 */

const _defaultValues = /*@__PURE__*/ new LineBasicMaterial();

// camera-space varyings, written in the vertex stage
const segmentStart = varyingProperty( 'vec3', 'streamlineStart' );
const segmentEnd = varyingProperty( 'vec3', 'streamlineEnd' );
const quadPosition = varyingProperty( 'vec4', 'streamlinePosition' );
const segmentWidth = varyingProperty( 'float', 'streamlineWidth' );
const segmentWeight = varyingProperty( 'float', 'streamlineWeight' );
const segmentDistance = varyingProperty( 'float', 'streamlineDistance' );

// Uniforms of the material being drawn. three shares one shader between
// streamline materials whose cache keys match (for example every bundle), so
// the shader must not read the uniform nodes of the material it was built for.
const distanceThreshold = materialReference( '_distanceThreshold.value', 'float' );
const fadedWidth = materialReference( '_fadedWidth.value', 'float' );
const shadowStrength = materialReference( '_shadowStrength.value', 'float' );

// Whether a segment is far enough from the targets to be faded
const isFaded = ( distance ) => distanceThreshold.greaterThan( 0.0 )
  .and( distanceThreshold.lessThanEqual( distance ) );

const mvpStreamline = Fn( ( { material } ) => {

  const start = modelViewMatrix.mul( vec4( attribute( 'instanceStart', 'vec3' ), 1.0 ) ).toVar( 'start' );
  const end = modelViewMatrix.mul( vec4( attribute( 'instanceEnd', 'vec3' ), 1.0 ) ).toVar( 'end' );

  segmentStart.assign( start.xyz );
  segmentEnd.assign( end.xyz );

  const lineDir = end.xyz.sub( start.xyz ).normalize();
  const lineUp = vec3( lineDir.y.negate(), lineDir.x, 0.0 ).normalize();

  // An orthographic camera's `projectionMatrix[0][0]` is 2 * zoom / (right -
  // left); the main camera keeps right - left at 300, so this is the zoom.
  // The side views zoom through `setViewOffset`, which this also accounts for.
  const zoomScale = max( cameraProjectionMatrix.element( 0 ).element( 0 ).mul( 150.0 ), 1e-6 );
  const lineWidth = materialLineWidth.div( zoomScale );
  segmentWidth.assign( lineWidth );

  const halfWidth = lineWidth.mul( 0.5 ).toVar( 'halfWidth' );

  if ( material._useDistanceThreshold ) {

    const distance = attribute( 'distanceToTargets', 'float' );
    segmentDistance.assign( distance );
    If( isFaded( distance ), () => {

      halfWidth.mulAssign( fadedWidth );

    } );

  }

  // the quad: x is -1 / 1 across the line, y is -1 at the start and 2 at the end
  const across = positionGeometry.x.lessThan( 0.0 ).select( lineUp.mul( halfWidth ), lineUp.mul( halfWidth ).negate() );
  const along = positionGeometry.y.lessThan( 0.5 ).select( lineDir.mul( halfWidth ).negate(), lineDir.mul( halfWidth ) );
  const center = positionGeometry.y.lessThan( 0.5 ).select( start, end );
  const position = vec4( center.xyz.add( across ).add( along ), center.w );
  quadPosition.assign( position );

  const weight = attribute( 'instanceWeight', 'float' );
  segmentWeight.assign( weight );

  // outside the clip volume when not drawn
  return select( weight.lessThan( 0.0 ).or( halfWidth.lessThanEqual( 0.0 ) ),
    vec4( 2.0, 2.0, 2.0, 1.0 ), cameraProjectionMatrix.mul( position ) );

} )();

// How much to darken this fragment: 1 on the axis, less towards the edges
const streamlineShade = Fn( ( { material } ) => {

  // distance from the axis, in line widths (0 to 0.5), in the view plane
  const lineDir = segmentEnd.sub( segmentStart ).normalize();
  const onAxis = segmentStart.add( lineDir.mul( quadPosition.xyz.sub( segmentStart ).dot( lineDir ) ) );
  const delta = quadPosition.xyz.sub( onAxis );
  const norm = vec2( delta.x, delta.y ).length().div( segmentWidth ).toVar( 'norm' );

  const interpMax = select( shadowStrength.lessThan( 0.2 ), float( 1.2 ).sub( shadowStrength ), float( 1.2 ) );

  // `norm` changes by about 1 / width-in-pixels per pixel. Once a line is a
  // pixel or two wide, no bright core is left to see and the edge ramp would
  // just darken the whole line, so fade the shading out. (`fwidth` is |dFdx| +
  // |dFdy|, under-reporting diagonal lines by up to sqrt(2); the band was
  // chosen against measured widths.) Derivatives need uniform control flow, so
  // this stays outside any branch.
  const pixelWidth = float( 1.0 ).div( max( fwidth( norm ), 1e-5 ) );
  const shadeAmount = smoothstep( 1.5, 4.5, pixelWidth );
  const shade = smoothstep( 0.0, interpMax, norm ).mul( shadeAmount ).oneMinus();

  if ( material._useDistanceThreshold ) {

    return select( isFaded( segmentDistance ), float( 0.5 ), shade );

  }

  return shade;

} )();

class StreamlineMaterial extends NodeMaterial {

  static get type() {

    return 'StreamLineMaterial';

  }

  constructor( parameters = {} ) {

    super();

    this.isStreamLineMaterial = true;

    this.setDefaultValues( _defaultValues );

    this.lights = false;

    // for `Line2.raycast`, which measures screen-space widths against it;
    // `streamline.js` sets it to the main canvas size
    this.resolution = new Vector2( 1, 1 );

    this._shadowStrength = uniform( 0.0 );
    this._distanceThreshold = uniform( 0.0 );
    this._fadedWidth = uniform( 0.005 );
    this._useDistanceThreshold = false;

    this.setValues( parameters );

  }

  // `needsUpdate` only rebuilds the shader when this key changes; see
  // `SurfaceMaterial.customProgramCacheKey()`
  customProgramCacheKey() {

    return `${ super.customProgramCacheKey() },streamline:${ this._useDistanceThreshold }`;

  }

  setupDiffuseColor( builder ) {

    // the gap between two tracts, or filtered out
    segmentWeight.lessThan( 0.0 ).discard();

    super.setupDiffuseColor( builder );

    diffuseColor.rgb.mulAssign( streamlineShade );

  }

  setupModelViewProjection( /*builder*/ ) {

    return mvpStreamline;

  }

  // sets the opacity, and makes the material transparent
  set lineOpacity( value ) {

    if ( typeof value !== 'number' ) {

      value = 1.0;

    }
    this.transparent = true;
    this.opacity = value;

  }

  get lineOpacity() {

    return this.opacity;

  }

  get shadowStrengh() {

    return this._shadowStrength.value;

  }

  set shadowStrengh( value ) {

    this._shadowStrength.value = value;

  }

  // Infinity when off
  get distanceThreshold() {

    return this._useDistanceThreshold ? this._distanceThreshold.value : Infinity;

  }

  set distanceThreshold( value ) {

    const enabled = value > 0 && isFinite( value );
    this._distanceThreshold.value = enabled ? value : 0;
    if ( this._useDistanceThreshold !== enabled ) {

      this._useDistanceThreshold = enabled;
      this.needsUpdate = true;

    }

  }

  get fadedWidth() {

    return this._fadedWidth.value;

  }

  set fadedWidth( value ) {

    this._fadedWidth.value = ( value <= 0 || ! isFinite( value ) ) ? 0 : value;

  }

  copy( source ) {

    super.copy( source );

    this.resolution.copy( source.resolution );
    this._shadowStrength.value = source._shadowStrength.value;
    this._distanceThreshold.value = source._distanceThreshold.value;
    this._fadedWidth.value = source._fadedWidth.value;
    this._useDistanceThreshold = source._useDistanceThreshold;

    return this;

  }

}

export { StreamlineMaterial };
