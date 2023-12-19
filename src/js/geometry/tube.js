import { AbstractThreeBrainObject } from './abstract.js';
import { to_array, min2, sub2 } from '../utils.js';
import {
  Curve, Vector2, Vector3, Vector4,
  MeshLambertMaterial, Mesh, BufferGeometry,
  Float32BufferAttribute, TextureLoader, ClampToEdgeWrapping,
  NearestFilter
} from 'three';

class TubeGeometry2 extends BufferGeometry {

	constructor( path, radialSegments = 8, radiusScale = 1 ) {

		super();

		this.type = 'TubeGeometry2';

		this.parameters = {
			path: path,
			radialSegments: radialSegments,
			radiusScale : radiusScale
		};

		const frames = path.computeFrenetFrames( path._t.length, false );

		// expose internals

		this.tangents = frames.tangents;
		this.normals = frames.normals;
		this.binormals = frames.binormals;

		// helper variables

		const vertex = new Vector3();
		const normal = new Vector3();
		const uv = new Vector2();
		let P = new Vector4();

		// buffer

		const vertices = [];
		const normals = [];
		const uvs = [];
		const indices = [];

		// create buffer data

		generateBufferData();

		// build geometry

		this.setIndex( indices );
		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		this.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );

		// functions

		function generateBufferData() {

			for ( let i = 0; i < path._t.length; i ++ ) {

				generateSegment( i );

			}

			// uvs are generated in a separate function.
			// this makes it easy compute correct values for closed geometries
			generateUVs();

			// finally create faces

			generateIndices();

		}

		function generateSegment( i ) {

			// we use getPointAt to sample evenly distributed points from the given path

      if( i === 0 || i == path._t.length - 1 ) {
        P.copy( path._pts[i] );
        P.w = 0;
      } else {
        let t = path._t[ i ];
        if( t <= 0 ) {
          t = 1e-6;
        }
        P = path.getPoint( t, P );
      }

			// retrieve corresponding normal and binormal

			const N = frames.normals[ i ];
			const B = frames.binormals[ i ];

			// generate normals and vertices for the current segment

			for ( let j = 0; j <= radialSegments; j ++ ) {

				const v = j / radialSegments * Math.PI * 2;

				const sin = Math.sin( v );
				const cos = - Math.cos( v );

				// normal

				normal.x = ( cos * N.x + sin * B.x );
				normal.y = ( cos * N.y + sin * B.y );
				normal.z = ( cos * N.z + sin * B.z );
				normal.normalize();

				normals.push( normal.x, normal.y, normal.z );

				// vertex

				vertex.x = P.x + P.w * normal.x * radiusScale;
				vertex.y = P.y + P.w * normal.y * radiusScale;
				vertex.z = P.z + P.w * normal.z * radiusScale;

				vertices.push( vertex.x, vertex.y, vertex.z );

			}

		}

		function generateIndices() {

			for ( let j = 1; j < path._t.length; j ++ ) {

				for ( let i = 1; i <= radialSegments; i ++ ) {

					const a = ( radialSegments + 1 ) * ( j - 1 ) + ( i - 1 );
					const b = ( radialSegments + 1 ) * j + ( i - 1 );
					const c = ( radialSegments + 1 ) * j + i;
					const d = ( radialSegments + 1 ) * ( j - 1 ) + i;

					// faces

					indices.push( a, b, d );
					indices.push( b, c, d );

				}

			}

		}

		function generateUVs() {

			for ( let i = 0; i < path._t.length; i ++ ) {

				for ( let j = 0; j <= radialSegments; j ++ ) {

					uv.y = path._t[ i ];
					uv.x = j / radialSegments;

					uvs.push( uv.x, uv.y );

				}

			}

		}

	}

	copy( source ) {

		super.copy( source );

		this.parameters = Object.assign( {}, source.parameters );

		return this;

	}

}



// construct curve
class CustomCurve extends Curve {

	constructor( controlData ) {
		super();
		// Assuming controlData is sorted
		this.nPoints = controlData.length / 5;
		this._t = [0];
		this._radius = [0];
		this._pts = [];
		for( let ii = 0; ii < this.nPoints; ii++ ) {
		  const p = new Vector3().set(
		    controlData[ 5 * ii ],
		    controlData[ 5 * ii + 1 ],
		    controlData[ 5 * ii + 2 ]
		  );
		  if( ii === 0 || ii == (this.nPoints - 1) ) {
		    this._pts.push( p );
		  }
		  this._pts.push( p );
		  this._t.push( controlData[ 5 * ii + 3 ] );
		  this._radius.push( controlData[ 5 * ii + 4 ] );
		}
		this._t.push( 1 );
		this._radius.push( 0 );
	}

	getPoint( t, optionalTarget = new Vector3() ) {
	  if( t < 0 ) { t = 0; } else if ( t > 1 ) { t = 1; }

	  let idx = 0;
	  for(; idx < this._t.length - 1; idx++ ) {
	    if( this._t[idx] <= t && this._t[idx + 1] >= t) {
	      break;
	    }
	  }

    const a = t - this._t[idx];
	  const b = this._t[idx + 1] - t;
	  const pa = this._pts[ idx ];
	  if( idx >= this._t.length - 1 || a == 0 || (a + b) == 0 ) {
	    optionalTarget.x = pa.x;
	    optionalTarget.y = pa.y;
	    optionalTarget.z = pa.z;
	    if( optionalTarget.isVector4 ) {
	      optionalTarget.w = this._radius[ idx ];
	    }
	  } else {
	    const pb = this._pts[ idx + 1 ];
	    optionalTarget.x = ( pa.x * b + pb.x * a ) / ( a + b );
	    optionalTarget.y = ( pa.y * b + pb.y * a ) / ( a + b );
	    optionalTarget.z = ( pa.z * b + pb.z * a ) / ( a + b );
	    if( optionalTarget.isVector4 ) {
	      optionalTarget.w = ( this._radius[ idx ] * b + this._radius[ idx + 1 ] * a ) / (a + b);
  	  }
	  }
		return optionalTarget;
	}

}


class Tube extends AbstractThreeBrainObject {

  constructor(g, canvas){

    super( g, canvas );
    // this._params is g
    // this.name = this._params.name;
    // this.group_name = this._params.group.group_name;

    this.type = 'Tube';
    this.isTube = true;

    this.tubularSegments = g.tubular_segments;
    this.radialSegments = g.radial_segments || 10;

    this.path = new CustomCurve( g.control_data );

    this.geometry = new TubeGeometry2( this.path, this.radialSegments );

    if ( g.image_uri ) {
      this.texture = new TextureLoader().load( g.image_uri );
      this.texture.wrapS = ClampToEdgeWrapping;
      this.texture.wrapT = ClampToEdgeWrapping;
      this.texture.magFilter = NearestFilter;
      this.texture.minFilter = NearestFilter;
    } else {
      this.texture = null
    }
    this.material = new MeshLambertMaterial( { color : 0xffffff, map : this.texture } );
    this.object = new Mesh( this.geometry, this.material );

  }


  finish_init(){
    super.finish_init();
  }

  dispose(){
    this.object.material.dispose();
    this.object.geometry.dispose();
  }


  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){
    return;
    if( this.object ){
      this._targets.forEach( (v, ii) => {
        if( v._last_rendered !== results.elapsed_time ){
          v.get_world_position();
        }
      } );

      // update positions
      this._geometry.generateBufferData( true, false, false, true );
    }
  }


}


function gen_tube(g, canvas){
  return( new Tube(g, canvas) );
}


export { gen_tube };


