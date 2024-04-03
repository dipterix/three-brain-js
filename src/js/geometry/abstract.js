import { get_element_size, get_or_default } from '../utils.js';
import { asArray } from '../utility/asArray.js';
import { registerRigidPoints } from '../Math/svd.js';
import { CONSTANTS } from '../core/constants.js';
import {
  Vector3, Matrix4, BufferGeometry, DataTexture, RGBAFormat, UVMapping,
  UnsignedByteType, ClampToEdgeWrapping, NearestFilter,
  BufferAttribute, Float32BufferAttribute,
  PlaneGeometry, SphereGeometry, BoxGeometry, EventDispatcher
} from 'three';

const tmpVec3 = new Vector3();

class AbstractThreeBrainObject extends EventDispatcher {
  constructor(g, canvas){

    super();

    this._params = g;
    this._canvas = canvas;
    this._display_mode = "normal";
    this._visible = true;
    this.type = 'AbstractThreeBrainObject';
    this.isThreeBrainObject = true;
    this.name = g.name;
    if( g.group && typeof g.group === 'object' ){
      this.group_name = g.group.group_name;
    }
    this.subject_code = g.subject_code || '';
    if( canvas.threebrain_instances.has(this.name) ) {
      const currentInstance = canvas.threebrain_instances.get( this.name );
      if( currentInstance !== this ) {
        try {
          currentInstance.dispose();
        } catch (e) {}
      }
    }
    canvas.threebrain_instances.set( this.name, this );
    this.clickable = g.clickable === true;
    this.world_position = new Vector3();
  }

  set_layer( addition = [], object = null ){
    let obj = object || this.object;
    if( obj ){
      let layers = asArray( this._params.layer );
      let more_layers = asArray(addition);
      // set clickable layer
      if( this._params.clickable === true ){
        layers.push( CONSTANTS.LAYER_SYS_RAYCASTER_14 );
      }
      layers.concat( more_layers );

      // Normal 3D object
      obj.layers.set( 31 );
      if( layers.length > 1 ){
        layers.forEach((ii) => {
          obj.layers.enable(ii);
          // console.debug( this.name + ' is enabled layer ' + ii );
        });
      }else if(layers.length === 0 || layers[0] > 20){
        // if(this.debug){
        //   console.debug( this.name + ' is set invisible.' );
        // }
        obj.layers.set( CONSTANTS.LAYER_USER_ALL_CAMERA_1 );
        obj.visible = false;
      }else{
        obj.layers.set( layers[0] );
      }
    }
  }

  warn( s ){
    console.warn(this._name + ' ' + s);
  }

  get_world_position(){
    const animParameters = this._canvas.animParameters;
    if( this._last_rendered === animParameters.trackPosition ) {
      return( this.world_position );
    }
    if( this.object ){
      this.object.getWorldPosition( this.world_position );
    }
    this._last_rendered = animParameters.trackPosition;
    return( this.world_position );
  }

  disposeGPU() {
    this.dispatchEvent({
      type: CONSTANTS.EVENTS.onThreeBrainObjectDisposeGPUStart,
      instanceName: this.name
    });
  }

  dispose() {
    this.dispatchEvent({
      type: CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
      instanceName: this.name
    });
    this._canvas.removeClickable( this.name );
    this._canvas.threebrain_instances.delete( this.name );
  }

  get_track_data( track_name, reset_material ){
    this.warn('method get_track_data(track_name, reset_material) not implemented...');
  }

  // Logics, invariant to renderers, unified across main/side canvas
  update() {}

  // handle differences of the renderers
  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){
    if( target === CONSTANTS.RENDER_CANVAS.main ) {
      this.get_world_position();
      if( this.object && this.object.isMesh ){
        if( this._visible && this._display_mode !== "hidden" ) {
          this.object.visible = true;
        } else {
          this.object.visible = false;
        }
      }
    }
  }

  add_track_data( track_name, data_type, value, time_stamp = 0 ){

  }

  getGroupObject3D(){
    return(this._canvas.group.get( this.group_name ));
  }
  getGroupData() {
    const groupObject = this.getGroupObject3D();
    if( !groupObject || !groupObject.isObject3D ) { return; }
    const groupData = groupObject.userData.group_data;
    if( !groupData || typeof groupData !== "object" ) { return; }
    return groupData;
  }

  registerToMap( names ){
    const mapNames = asArray(names);
    const subjectCode = this.subject_code;
    const registeredAsName = this.name;
    mapNames.forEach((nm) => {
      get_or_default( this._canvas[ nm ], subjectCode, {} )[ registeredAsName ] = this.object;
    });
    this.addEventListener(
      CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
      () => {
        mapNames.forEach((nm) => {
          try {
            const map = this._canvas[ nm ];
            if( map && map.has( subjectCode ) ) {
              const subjectMap = map.get( subjectCode );
              if( subjectMap && typeof subjectMap === "object" && subjectMap[ registeredAsName ] ) {
                delete subjectMap[ registeredAsName ];
              }
            }
          } catch (e) {
            console.warn(e);
          }
        });
      }
    );
  }

  debugVerbose = ( message ) => {
    if( this.debug ) {
      console.debug(`[${ this.constructor.name }]: ${message}`);
    }
  };

  finish_init(){
    if( this.object ){
      // console.debug(`Finalizing ${ this.name }`);
      this.set_layer();
      this.object.userData.construct_params = this._params;

      this._canvas.mesh.set( this.name, this.object );
      if( this.clickable ){
        this._canvas.makeClickable( this.name, this.object );
      }

      if( this.group_name ){
        this.getGroupObject3D().add( this.root_object || this.object );
      } else {
        this._canvas.add_to_scene( this.root_object || this.object );
      }

      if( this.object.isObject3D ){
        this.object.userData.instance = this;
        this.object.userData.dispose = () => { this.dispose(); };
        this.object.renderOrder = CONSTANTS.RENDER_ORDER[ this.type ] || 0;
      }

      if( this.object.isMesh || this.object.isSprite ){
        if( this._params.trans_mat ) {
          let trans = new Matrix4();

          if( Array.isArray(this._params.trans_mat) && this._params.trans_mat.length === 16 ) {
            trans.set(...this._params.trans_mat);
          } else if ( typeof this._params.trans_mat === "object" && this._params.trans_mat.isMatrix4 ) {
            trans.copy( this._params.trans_mat );
          }
          this.object.userData.trans_mat = trans;
          if( !this._params.disable_trans_mat ) {
            this.object.applyMatrix4(trans);
          }
        }

        this.object.updateMatrixWorld();
      }

    }
  }


  set_display_mode( mode ){
    // hidden will set visible to false
    if( typeof mode === "string" ){
      this._display_mode = mode;
    }
  }

  set_visibility( visible ){
    this._visible = visible;
  }

  useMatrix4( m44, { applyScale = true } = {} ) {

    if(!m44 || typeof m44 !== "object" || !m44.isMatrix4 ) { return; }
    if( this.object && this.object.isObject3D ){
      if( applyScale ) {
        m44.decompose( this.object.position, this.object.quaternion,
                        this.object.scale );
      } else {
        m44.decompose( this.object.position, this.object.quaternion,
                       tmpVec3 );
      }

		  this.object.updateMatrix();
		  this._canvas.needsUpdate = true;
    }
  }
}

function createBuiltinGeometry (type, {
	  position, index, uv,
	  normal = undefined, channel_map = undefined,
	  texture_size = [1, 1], transform = undefined,
	  radius = 1, fix_outline = true,
	  contact_center = null, channel_numbers = null, contact_sizes = null,
	  model_control_points = null, world_control_points = null,
	  model_direction = null, model_up = null
	} = {} ) {

  let geom, useTexture = true;
  let textureWidth = texture_size[0], textureHeight = texture_size[1];
  const m44 = new Matrix4();
  const controlPoints = {
    model : [],
    world : []
  };
  const contactCenter = [new Vector3()];
  const modelDirection = new Vector3();
  const modelUp = new Vector3();

  switch (type) {
    case 'CustomGeometry':
      geom = new BufferGeometry();
      geom.parameters = {
        size: 1,
        fixedClearCoat : fix_outline
      };
      geom.setIndex( index );

      let pos = new Float32BufferAttribute( new Float32Array( position ), 3 );

      const mcpArray = model_control_points;
      if( Array.isArray(mcpArray) && mcpArray.length >= 9 ) {
        const mcp = controlPoints.model;
        for( let i = 0; i < mcpArray.length / 3; i++ ) {
          mcp.push( new Vector3().fromArray( mcpArray, i * 3 ) );
        }
      }
      const tcpArray = world_control_points;
      if( Array.isArray(tcpArray) && tcpArray.length >= 9 ) {
        const tcp = controlPoints.world;
        for( let i = 0; i < tcpArray.length / 3; i++ ) {
          tcp.push( new Vector3().fromArray( tcpArray, i * 3 ) );
        }
      }

      if( transform ) {
        transform = asArray(transform);
        m44.set(...transform);
        geom.parameters.hasTransform = true;
      } else if( controlPoints.model.length >= 3 && controlPoints.world.length >= 3 ) {
        try {
          const m44_1 = registerRigidPoints( controlPoints.model , controlPoints.world );
          m44.copy( m44_1 );
          geom.parameters.hasTransform = true;
        } catch (e) {
          console.warn( e );
        }
      }

      geom.setAttribute( 'position', pos );
      if( uv ) {
        geom.setAttribute( 'uv', new Float32BufferAttribute( new Float32Array( uv ), 2 ) );
      }

      if( normal ) {
        geom.setAttribute( 'normal', new Float32BufferAttribute( new Float32Array( normal ), 3 ) );
      }

      if( channel_map ) {
        geom.setAttribute( 'channelMap', new BufferAttribute( new Uint8Array( channel_map ), 4 ) );
        geom.parameters.useChannelMap = true;
      }

      const cc = contact_center;
      const cn = Array.isArray( channel_numbers ) ? channel_numbers : [];
      if( Array.isArray(cc) && cc.length >= 3 ) {
        contactCenter.length = 0;
        const cs = Array.isArray( contact_sizes ) ? contact_sizes : [];

        for(let i = 0; i < cc.length/3; i++ ) {
          const cPos = new Vector3().fromArray( cc, i * 3 );
          cPos.chanNum = cn[ i ] ?? (i + 1);
          cPos.radius = typeof cs[ i ] === "number" ? cs[ i ] : 0.05;
          contactCenter.push( cPos );
        }
      }

      const md = model_direction;
      if( Array.isArray(md) && md.length === 3 ) {
        modelDirection.fromArray(md).normalize();
        if( isNaN( modelDirection.lengthSq() ) ) {
          modelDirection.set(0, 0, 0);
        }
      }
      const mu = model_up;
      if( Array.isArray(mu) && mu.length === 3 ) {
        modelUp.fromArray(mu).normalize();
        if( isNaN( modelUp.lengthSq() ) ) {
          modelUp.set(0, 0, 0);
        }
      }

      break;

    default: {
      type = "SphereGeometry";
      geom = new SphereGeometry( radius, 10, 6 );
      geom.parameters.size = geom.parameters.radius;
      // remove UV
      if( geom.hasAttribute( "uv" ) ) {
        geom.deleteAttribute( "uv" );
      }
    }
  }

  // construct vertex colors
  let dataTexture = null;
  if( useTexture && textureWidth * textureHeight > 1 ) {
    const width = textureWidth;
    const height = textureHeight;

    // DataTexture( data, width, height, format, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, colorSpace )
    dataTexture = new DataTexture(
      new Uint8Array( 4 * width * height ), width, height,
      RGBAFormat, UnsignedByteType, UVMapping,
      ClampToEdgeWrapping, ClampToEdgeWrapping,
      NearestFilter, NearestFilter
    );
    dataTexture.unpackAlignment = 1;
    dataTexture.generateMipmaps = false;
    dataTexture._width = width;
    dataTexture._height = height;
  } else {
    useTexture = false;
  }

  geom.parameters.textureWidth = textureWidth;
  geom.parameters.textureHeight = textureHeight;
  geom.parameters.useDataTexture = useTexture;
  geom.parameters.transform = m44;
  geom.parameters.controlPoints = controlPoints;
  geom.parameters.contactCenter = contactCenter;
  geom.parameters.modelDirection = modelDirection;
  geom.parameters.modelUp = modelUp;


  return {
    type      : type,
    parameters: geom.parameters,
    index     : geom.index,
    position  : geom.getAttribute("position"),
    normal    : geom.getAttribute("normal"),
    uv        : geom.getAttribute("uv"),
    channelMap: geom.getAttribute("channelMap"),
    dataTexture: dataTexture,
  };
}

const GEOMETRY_CREATORS = {
  SphereGeometry  : createBuiltinGeometry,
  CustomGeometry   : createBuiltinGeometry,
};


class ElasticGeometry extends BufferGeometry {

	constructor( type, parameters ) {

		super();

		let factory = GEOMETRY_CREATORS[ type ] ?? createBuiltinGeometry;
		const factoryParams = factory( type, parameters );

		this.type = 'ElasticGeometry';
		this.subType = factoryParams.type;

		this.parameters = factoryParams.parameters;
		this.dataTexture = factoryParams.dataTexture;

    // build geometry
		this.setIndex( factoryParams.index );
		this.setAttribute( 'position', factoryParams.position );
		if( factoryParams.normal ) {
		  this.setAttribute( 'normal', factoryParams.normal );
		}
		if( factoryParams.uv ) {
		  this.setAttribute( 'uv', factoryParams.uv );
		}
		if( factoryParams.channelMap ) {
		  this.setAttribute( 'channelMap', factoryParams.channelMap );
		}

	}

	copy( source ) {

		super.copy( source );

		this.subType = source.subType;
		this.parameters = Object.assign( {}, source.parameters );

		return this;

	}

	disposeGPU() {
	  if( this.dataTexture ) {
	    this.dataTexture.dispose();
	  }
	}


	dispose () {
	  super.dispose();
	  if( this.dataTexture ) {
	    this.dataTexture.dispose();
	  }
	}

}

function getThreeBrainInstance( object ) {
  if( !object ) { return; }
  if( typeof object !== "object" ) { return; }
  if( object.isThreeBrainObject ){ return object; }
  if( object.isObject3D ) {
    const inst = object.userData.instance;
    if( inst && inst.isThreeBrainObject ) {
      return inst;
    }
    return;
  }
  return;
}

export { AbstractThreeBrainObject, ElasticGeometry, getThreeBrainInstance };
