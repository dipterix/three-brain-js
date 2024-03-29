import { AbstractThreeBrainObject } from './abstract.js';
import { DoubleSide, FrontSide, BufferAttribute, DataTexture, NearestFilter,
         LinearFilter, RGBAFormat, UnsignedByteType, Vector3, Matrix4,
         MeshPhysicalMaterial, MeshLambertMaterial, BufferGeometry, Mesh,
         Data3DTexture, Color, Vector4 } from 'three';
import { CONSTANTS } from '../core/constants.js';
import { to_array, min2, sub2 } from '../utils.js';
import { compile_free_material } from '../shaders/SurfaceShader.js';

const MATERIAL_PARAMS_BASIC = {
  'transparent' : true,
  'side': DoubleSide,
  'wireframeLinewidth' : 0.1,
  'vertexColors' : true,
  'forceSinglePass' : false,
  'reflectivity' : 0,
  'flatShading' : false
};

const MATERIAL_PARAMS_MORE = {
  ...MATERIAL_PARAMS_BASIC,
  'roughness' : 0.3,
  'ior' : 1.6,
  'clearcoat' : 0,
  'clearcoatRoughness' : 1,
  'specularIntensity' : 1
}

const PLANE_NORMAL_BASIS = {
  'axial'     : new Vector3().set(0, 0, 1),
  'sagittal'  : new Vector3().set(1, 0, 0),
  'coronal'   : new Vector3().set(0, 1, 0),
}
// freemesh
// CONSTANTS.DEFAULT_COLOR = 0;
// CONSTANTS.VERTEX_COLOR = 1;
// CONSTANTS.VOXEL_COLOR = 2;
// CONSTANTS.ELECTRODE_COLOR = 3;

class FreeMesh extends AbstractThreeBrainObject {

  _ensure_track_color(){
    if( !this._track_color ){
      const track_color = new Uint8Array( this.__nvertices * 3 ).fill(255);
      this._track_color = track_color;
      this._geometry.setAttribute( 'track_color', new BufferAttribute( track_color, 3, true ) );
    }
  }

  _link_userData(){
    // register for compatibility
    this._mesh.userData.dispose = () => { this.dispose(); };
  }

  // internally used
  _set_track( skip_frame ){
    // prepare
    if( skip_frame !== undefined && skip_frame >= 0 ){
      this.__skip_frame = skip_frame;
    }
    const value = this._params.value;
    if( !value ){ return; }


    const skip_items = this.__nvertices * this.__skip_frame;
    if( skip_items > value.length ){ return; }

    if( !this.__initialized ) {
      value.forEach((v, ii) => {
        value[ ii ] = Math.floor( v );
      });
    }
    this._ensure_track_color();

    // start settings track values
    const lut = this._canvas.global_data('__global_data__.SurfaceColorLUT'),
          lutMap = lut.map,
          tcol = this._track_color;

    // only set RGB, ignore A
    let c, jj = skip_items;
    for( let ii = 0; ii < this.__nvertices; ii++, jj++ ){
      if( jj >= value.length ){
        tcol[ ii * 3 ] = 0;
        tcol[ ii * 3 + 1 ] = 0;
        tcol[ ii * 3 + 2 ] = 0;
        // tcol[ ii * 4 + 3 ] = 0;
      } else {
        c = lutMap[ value[ jj ] ];
        if( c ){
          tcol[ ii * 3 ] = c.R;
          tcol[ ii * 3 + 1 ] = c.G;
          tcol[ ii * 3 + 2 ] = c.B;
          // tcol[ ii * 4 + 3 ] = 255;
        } else {
          tcol[ ii * 3 ] = 0;
          tcol[ ii * 3 + 1 ] = 0;
          tcol[ ii * 3 + 2 ] = 0;
          // tcol[ ii * 4 + 3 ] = 0;
        }
      }
    }
    // this._mesh.material.needsUpdate = true;
    this._geometry.attributes.track_color.needsUpdate = true;

  }

  // Primary color (Curv, sulc...)
  _set_primary_color( color_name, update_color = false ){
    if( update_color ) {
      this.object.geometry.attributes.color.needsUpdate = true
    }

    let cname = color_name || this._vertex_cname;

    // color data is lazy-loaded
    const color_data = this._canvas.get_data(cname, this.misc_name, this.misc_group_name);
    const g = this._params;
    const nvertices = this._mesh.geometry.attributes.position.count;
    let valueRange = [-1, 1];
    let valueData;

    if( (color_data && Array.isArray(color_data.value)) ){

      if( !Array.isArray(color_data.range) || color_data.range.length < 2 ){
        color_data.range = [-1, 1];
      } else {
        valueRange = color_data.range;
      }

      valueData = color_data.value;


    } else {

      // directly set by lh_primary_vertex_color
      const prefix = this.hemisphere.toLocaleLowerCase()[0];
      const vertexValues = this._canvas.get_data(`${ prefix }h_primary_vertex_color`, this.name, this.group_name);

      if( vertexValues && vertexValues.isFreeSurferNodeValues ) {

        valueRange = [ vertexValues.min , vertexValues.max ];
        valueData = vertexValues._frameData;

      } else {
        return;
      }
    }


    let scale = Math.max(valueRange[1], -valueRange[0]);

    // generate color for each vertices
    let _transform = ( v ) => { return v };
    if( cname.endsWith("sulc") ) {
      _transform = (v) => {
        // let s = Math.floor( 153.9 / ( 1.0 + Math.exp(b * v)) ) + 100;
        // return( s / 255 );
        return 0.7 / ( Math.exp( v * 10.0 / scale ) + 1.0 ) + 0.3;
      };
    }

    valueData.forEach((v, ii) => {
      if( ii >= nvertices ){ return; }
      // Make it lighter using sigmoid function
      let col = _transform(v);
      this._vertex_color[ ii * 4 ] = col;
      this._vertex_color[ ii * 4 + 1 ] = col;
      this._vertex_color[ ii * 4 + 2 ] = col;
      this._vertex_color[ ii * 4 + 3 ] = 1;
    });

  }

  _check_material( update_canvas = false ){
    const _mty = this._canvas.get_state('surface_material_type') || this._material_type;
    if( !this._mesh.material['is' + _mty] ){
      this.switch_material( _mty, update_canvas );
    }
  }

  setMappingType( type ) {
    let changed = false;
    for ( let materialType in this._materials ) {
      const material = this._materials[ materialType ];
      changed = material.setMappingType( type ) || changed;
    }
    return changed;
  }
  getMappingType() {
    return this._materials.MeshPhysicalMaterial.getMappingType();
  }

  _set_color_from_datacube2( m, bias = 3.0 ){
    // console.debug("Generating surface colors from volume data...");

    if( !m || !m.isDataCube2 ){
      this.setMappingType( CONSTANTS.DEFAULT_COLOR );
      return;
    }

    if( this.getMappingType() === CONSTANTS.DEFAULT_COLOR ) {
      return;
    }

    if(
      typeof this.surface_type !== "string" ||
      ['pial', 'white', 'smoothwm'].indexOf( this.surface_type ) === -1
    ) {
      this.setMappingType( CONSTANTS.DEFAULT_COLOR );
      return;
    }

    this._volume_texture.image = m.colorTexture.image;
    this._volume_texture.format = m.colorTexture.format;

    // world to IJK
    // this._material_options.volumeMatrixInverse.value.copy(
    //   m._originalData.ijk2tkrRAS
    // ).invert();

    this._material_options.volumeMatrixInverse.value
      .set( 1, 0, 0, m.modelShape.x / -2,
            0, 1, 0, m.modelShape.y / -2,
            0, 0, 1, m.modelShape.z / -2,
            0, 0, 0, 1 )
      .premultiply( m.object.matrixWorld )
      .invert();

    this._material_options.scale_inv.value.set(
      1 / m.modelShape.x,
      1 / m.modelShape.y,
      1 / m.modelShape.z
    );

    /**
     * We want to enable USE_COLOR_ALPHA so that vColor is vec4,
     * This requires vertexAlphas to be true
     * https://github.com/mrdoob/three.js/blob/be137e6da5fd682555cdcf5c8002717e4528f879/src/renderers/WebGLRenderer.js#L1442
    */
    this._mesh.material.vertexColors = true;
    // this._material_options.sampler_bias.value = bias;
    // this._material_options.sampler_step.value = bias / 2;
    this._volume_texture.needsUpdate = true;

  }

  switch_material( material_type, update_canvas = false ){

    if( material_type in this._materials ){
      const vertexColors = this.object.material.vertexColors;
      const opacity = this.object.material.opacity;
      const _m = this._materials[ material_type ];
      let _o;

      /*
      if( this.hemisphere.toLocaleLowerCase().startsWith("r") ) {
        _o = this._canvas.get_state("surface_opacity_right") || 0;
      } else {
        _o = this._canvas.get_state("surface_opacity_left") || 0;
      }
      */

      this._material_type = material_type;
      this.object.material = _m;
      this.object.material.vertexColors = vertexColors;
      this._mesh.material.opacity = opacity;
      this.object.material.needsUpdate = true;
      if( update_canvas ){
        this._canvas.needsUpdate = true;
      }
    }
  }

  _link_electrodes(){

    if( !Array.isArray( this._linked_electrodes ) ){
      this._linked_electrodes = [];
      this._canvas.electrodes.forEach((v) => {
        for( let k in v ){
          this._linked_electrodes.push( v[ k ] );
        }
      });

      // this._linked_electrodes to shaders
      const elec_size = this._linked_electrodes.length;
      if( elec_size == 0 ){ return; }
      const elec_locs = new Uint8Array( elec_size * 4 );
      const locs_texture = new DataTexture( elec_locs, elec_size, 1 );

      locs_texture.minFilter = NearestFilter;
      locs_texture.magFilter = NearestFilter;
      locs_texture.format = RGBAFormat;
      locs_texture.type = UnsignedByteType;
      locs_texture.unpackAlignment = 1;
      locs_texture.needsUpdate = true;
      this._material_options.elec_locs.value = locs_texture;

      const elec_cols = new Uint8Array( elec_size * 4 );
      const cols_texture = new DataTexture( elec_cols, elec_size, 1 );

      cols_texture.minFilter = NearestFilter;
      cols_texture.magFilter = NearestFilter;
      cols_texture.format = RGBAFormat;
      cols_texture.type = UnsignedByteType;
      cols_texture.unpackAlignment = 1;
      cols_texture.needsUpdate = true;
      this._material_options.elec_cols.value = cols_texture;

      this._material_options.elec_size.value = elec_size;
      this._material_options.elec_active_size.value = elec_size;
    }

    const e_size = this._linked_electrodes.length;
    if( !e_size ){ return; }

    const e_locs = this._material_options.elec_locs.value.image.data;
    const e_cols = this._material_options.elec_cols.value.image.data;

    const p = new Vector3();
    let ii = 0;
    this._linked_electrodes.forEach((el) => {
      if( el.material.isMeshBasicMaterial ){
        el.getWorldPosition( p );
        p.addScalar( 128 );
        e_locs[ ii * 4 ] = Math.round( p.x );
        e_locs[ ii * 4 + 1 ] = Math.round( p.y );
        e_locs[ ii * 4 + 2 ] = Math.round( p.z );
        e_cols[ ii * 4 ] = Math.floor( el.material.color.r * 255 );
        e_cols[ ii * 4 + 1 ] = Math.floor( el.material.color.g * 255 );
        e_cols[ ii * 4 + 2 ] = Math.floor( el.material.color.b * 255 );
        ii++;
      }
    });
    this._material_options.elec_locs.value.needsUpdate = true;
    this._material_options.elec_cols.value.needsUpdate = true;
    this._material_options.elec_active_size.value = ii;

  }

  finish_init(){

    super.finish_init();

    // Need to registr surface
    // instead of using surface name, use
    this.register_object( ['surfaces'] );

    this._material_options.shift.value.copy( this._mesh.parent.position );

    this._set_primary_color(this._vertex_cname, true);
    this._set_track( 0 );


    /*this._canvas.bind( this.name + "_link_electrodes", "canvas.finish_init", () => {
      let nm, el;
      this._canvas.electrodes.forEach((v) => {
        for(nm in v){
          el = v[ nm ];
        }
      });
    }, this._canvas.el );*/


    this.__initialized = true;
  }

  dispose(){
    try {
      this.object.removeFromParent();
    } catch (e) {}

    try {
      this.object.material.dispose();
      this.object.geometry.dispose();
      this._volume_texture.dispose();
    } catch (e) {}
  }

  pre_render({ mainCameraPositionNormalized, target = CONSTANTS.RENDER_CANVAS.main } = {}){
    // check material
    super.pre_render({ target : target });

    if( target !== CONSTANTS.RENDER_CANVAS.main ) { return; }

    // If not showing this subject, hide
    const sub = this._canvas.get_state("target_subject", "none");
    if( sub !== this.subject_code ) {
      this.object.visible = false;
      return;
    }

    if( this.forceVisible ) {
      this.object.visible = true;
    } else if( this.forceVisible === false ){
      this.object.visible = false;
      return;
    } else {
      this.object.visible = false;

      const surfaceType = this._canvas.get_state("surface_type", "none");
      if( this.isSubcortical ) {
        const subcorticalDisplay = this._canvas.get_state("subcortical_display");
        if( subcorticalDisplay === "both" || subcorticalDisplay === this.hemisphere ) {
          this.object.visible = true;
          this.object.material.opacity = this._canvas.get_state(`subcortical_opacity_${ this.hemisphere }`, 1.0);
        }
      } else if( this.surface_type === surfaceType ) {
        const materialType = this._canvas.get_state(`material_type_${ this.hemisphere }`, null);
        if( materialType !== "hidden" ) {
          this.object.visible = true;
          this.set_display_mode( materialType );
          // this.set_visibility( materialType !== 'hidden' );
          this.object.material.wireframe = materialType === 'wireframe';
          this.object.material.opacity = this._canvas.get_state(`surface_opacity_${ this.hemisphere }`, 1.0);

          let threshold = 1.0;
          if( this.hemisphere === "left" ) {
            threshold = this._canvas.get_state( "surface_mesh_clipping_left", 1.0 );
          } else if ( this.hemisphere === "right" ) {
            threshold = this._canvas.get_state( "surface_mesh_clipping_right", 1.0 );
          }
          this._material_options.mask_threshold.value = threshold;
        }
      }

      if( !this.object.visible ) { return; }
    }

    this._check_material( false );

    // compute render order
    if( !this.isROI && this.object.material.transparent && this.object.material.opacity < 0.5 ) {
      this.object.material.depthWrite = false;
      this.object.renderOrder = -1000;
      // this.object.material.side = FrontSide;
    } else {
      this.object.renderOrder = this._geometry.boundingSphere.center.dot( mainCameraPositionNormalized ) + this._geometry.boundingSphere.radius / 2.0;
      this.object.material.depthWrite = true;
      // this.object.material.side = DoubleSide;
    }



    // need to get current active datacube2
    const atlas_type = this._canvas.get_state("atlas_type", "none"),
          inst = this._canvas.threebrain_instances.get(`Atlas - ${atlas_type} (${sub})`),
          ctype = this._canvas.get_state("surface_color_type", "vertices"),
          sigma = this._canvas.get_state("surface_color_sigma", 3.0),
          blend = this._canvas.get_state("surface_color_blend", 0.4),
          decay = this._canvas.get_state("surface_color_decay", 0.15),
          radius = this._canvas.get_state("surface_color_radius", 10.0),
          refresh_flag = this._canvas.get_state("surface_color_refresh", undefined);

    let col_code, material_needs_update = false;

    this._mesh.material.transparent = this._mesh.material.opacity < 0.99;
    switch (ctype) {
      case 'vertices':
        col_code = CONSTANTS.VERTEX_COLOR;
        break;

      case 'sync from voxels':
        col_code = CONSTANTS.VOXEL_COLOR;
        this._mesh.material.transparent = true;

        // get current frame
        if( this.time_stamp.length ){
          let skip_frame = 0;

          const currentTime = this._canvas.animParameters.time;

          this.time_stamp.forEach((v, ii) => {
            if( v <= currentTime ){
              skip_frame = ii - 1;
            }
          });
          if( skip_frame < 0 ){ skip_frame = 0; }

          if( this.__skip_frame !== skip_frame){
            this._set_track( skip_frame );
          }
        }
        break;

      case 'sync from electrodes':
        col_code = CONSTANTS.ELECTRODE_COLOR;
        this._link_electrodes();
        break;

      default:
        col_code = CONSTANTS.DEFAULT_COLOR;
    };

    material_needs_update = this.setMappingType( col_code );
    if( this._material_options.blend_factor.value !== blend ){
      this._material_options.blend_factor.value = blend;
      material_needs_update = true;
    }
    if( this._material_options.elec_decay.value !== decay ){
      this._material_options.elec_decay.value = decay;
      material_needs_update = true;
    }
    if( this._material_options.elec_radius.value !== radius ){
      this._material_options.elec_radius.value = radius;
      material_needs_update = true;
    }
    if( this._blend_sigma !== sigma ){
      this._blend_sigma = sigma;
      material_needs_update = true;
    }
    if( this._refresh_flag !== refresh_flag ){
      this._refresh_flag = refresh_flag;
      material_needs_update = true;
    }

    // This step is slow
    if( material_needs_update && col_code === CONSTANTS.VOXEL_COLOR ){
      // need to get current active datacube2
      this._set_color_from_datacube2(inst, this._blend_sigma);
    }

    // set bias
    const bias = this._canvas.get_state("sliceIntensityBias", 0.0);
    this._material_options.gamma.value = bias;

    const clippingPlaneName = this._canvas.get_state( "surfaceClippingPlane", "disabled" );
    if(
      this.surface_type === "pial" ||
      this.surface_type === "white" ||
      this.surface_type === "smoothwm"
    ) {
      const datacube = this._canvas.get_state("activeSliceInstance");
      const normal = PLANE_NORMAL_BASIS[ clippingPlaneName ];
      if( datacube && normal ) {
        const slicerState = this._canvas.get_state("sideCameraTrackMainCamera", "canonical");
        switch (slicerState) {
          case 'snap-to-electrode':
            this._tmpVec3.copy( normal )
              .applyQuaternion( this._canvas.crosshairGroup.quaternion );
            break;

          case 'line-of-sight':
            this._tmpVec3.copy( this._canvas.mainCamera.position );
            break;

          default:
            this._tmpVec3.copy( normal );
        }
        this.object.material.setClippingPlaneFromDataCube( datacube, this._tmpVec3 );
      } else {
        this.object.material.setClippingPlaneFromDataCube( null );
      }
    }

  }

  constructor(g, canvas){

    super( g, canvas );
    // this._params is g
    // this.name = this._params.name;
    // this.group_name = this._params.group.group_name;

    this.type = 'FreeMesh';
    this.isFreeMesh = true;

    this._tmpVec3 = new Vector3();
    this._tmpVec3A = new Vector3();

    // STEP 1: initial settings
    // when subject brain is messing, subject_code will be template subject such as N27,
    // and display_code will be the missing subject
    // actuall subject
    this.subject_code = this._params.subject_code;
    // display subject
    this.display_code = g.display_code ?? (
      canvas.get_data('subject_code', this._params.name, this.group_name) || this.subject_code
    );
    this.hemisphere = this._params.hemisphere || 'left';
    this.surface_type = this._params.surface_type;
    this.misc_name = '_misc_' + this.subject_code;
    this.misc_group_name = '_internal_group_data_' + this.subject_code;
    this._vertex_cname = this._canvas.get_data(
      `default_vertex_${ this.hemisphere[0] }h_${ this.surface_type }`, this.name, this.group_name) || "sulc";

    // STEP 2: data settings
    this._geometry = new BufferGeometry();

    const loaderData = g.meshObject ?? this._canvas.get_data('free_vertices_'+this.name, this.name, this.group_name);
    if( loaderData.isSurfaceMesh ) {

      this.__nvertices = loaderData.nVertices;
      this._geometry.setIndex( new BufferAttribute(loaderData.index, 1, false) );
      this._geometry.setAttribute( 'position', new BufferAttribute(loaderData.position, 3) );

    } else {
      const vertices = loaderData;
      const faces = this._canvas.get_data('free_faces_'+g.name, this.name, this.group_name);
      // Make sure face index starts from 0
      const _face_min = min2(faces, 0);
      if(_face_min !== 0) {
        sub2(faces, _face_min);
      }

      // construct geometry
      this.__nvertices = vertices.length;
      const vertex_positions = new Float32Array( this.__nvertices * 3 ),
            face_orders = new Uint32Array( faces.length * 3 );

      vertices.forEach((v, ii) => {
        vertex_positions[ ii * 3 ] = v[0];
        vertex_positions[ ii * 3 + 1 ] = v[1];
        vertex_positions[ ii * 3 + 2 ] = v[2];
      });
      faces.forEach((v, ii) => {
        face_orders[ ii * 3 ] = v[0];
        face_orders[ ii * 3 + 1 ] = v[1];
        face_orders[ ii * 3 + 2 ] = v[2];
      });

      this._geometry.setIndex( new BufferAttribute(face_orders, 1, false) );
      this._geometry.setAttribute( 'position', new BufferAttribute(vertex_positions, 3) );
    }

    this._vertex_color = new Float32Array( this.__nvertices * 4 ).fill(1);
    this._geometry.setAttribute( 'color', new BufferAttribute( this._vertex_color, 4, true ) );

    // gb.setAttribute( 'color', new Float32BufferAttribute( vertex_colors, 3 ) );
    // gb.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );

    // register sphere positions
    this.isROI = true;
    if( this.surface_type === "pial" ) {
      this.isROI = false;
      const hemAsTitle = this.hemisphere[0].toUpperCase() + this.hemisphere.substring(1);
      const sphereName = `FreeSurfer ${ hemAsTitle } Hemisphere - sphere (${this.subject_code})`;
      const sphereGroupName = `Surface - sphere (${this.subject_code})`;
      const sphereData = this._canvas.get_data(
        'free_vertices_' + sphereName,
        sphereName, sphereGroupName);
      if ( sphereData ) {
        if( sphereData.isSurfaceMesh ) {
          if( this.__nvertices === sphereData.nVertices ) {
            this._geometry.setAttribute( 'spherePosition', new BufferAttribute(sphereData.position, 3) );
          }
        } else {
          if( this.__nvertices === sphereData.length ) {

            const sphereVertices = new Float32Array( this.__nvertices * 3 );
            sphereData.forEach((v, ii) => {
              sphereVertices[ ii * 3 ] = v[0];
              sphereVertices[ ii * 3 + 1 ] = v[1];
              sphereVertices[ ii * 3 + 2 ] = v[2];
            });
            this._geometry.setAttribute( 'spherePosition', new BufferAttribute(sphereVertices, 3) );

          }
        }
      }
    } else if (this.surface_type === "white" || this.surface_type === "smoothwm") {
      this.isROI = false;
    }

    this._geometry.computeVertexNormals();
    this._geometry.computeBoundingBox();
    this._geometry.computeBoundingSphere();

    if( g.subcortical_info ) {
      this.isSubcortical = true;
      this.subcorticalInfo = g.subcortical_info;
      this._materialColor = new Color().set( this.subcorticalInfo.Color );
      this._materialColor.r = this._materialColor.r * 0.8 + 0.2;
      this._materialColor.g = this._materialColor.g * 0.8 + 0.2;
      this._materialColor.b = this._materialColor.b * 0.8 + 0.2;
    } else {
      this.isSubcortical = false;
      this._materialColor = new Color().set( "#ffffff" );
    }


    // STEP 3: mesh settings
    // For volume colors
    this._volume_margin_size = 128;
    this._volume_array = new Uint8Array( 32 );
    // fake texture, will update later
    this._volume_texture = new Data3DTexture(
      this._volume_array, 2, 2, 2
    );
    this._volume_texture.minFilter = NearestFilter;
    this._volume_texture.magFilter = NearestFilter;
    this._volume_texture.format = RGBAFormat;
    this._volume_texture.type = UnsignedByteType;
    this._volume_texture.unpackAlignment = 1;


    this._material_options = {
      // 'mapping_type'      : { value : CONSTANTS.DEFAULT_COLOR },
      'volume_map'        : { value : this._volume_texture },
      'volumeMatrixInverse':{ value : new Matrix4() },
      'scale_inv'         : {
        value : new Vector3(
          1 / this._volume_margin_size, 1 / this._volume_margin_size,
          1 / this._volume_margin_size
        )
      },
      'shift'             : { value : new Vector3() },
      // 'sampler_bias'      : { value : 3.0 },
      // 'sampler_step'      : { value : 1.5 },
      'elec_cols'         : { value : null },
      'elec_locs'         : { value : null },
      'elec_size'         : { value : 0 },
      'elec_active_size'  : { value : 0 },
      'elec_radius'       : { value: 10.0 },
      'elec_decay'        : { value : 0.15 },
      'blend_factor'      : { value : 0.4 },
      'mask_threshold'    : { value : 0.0 },

      'clippingNormal'    : { value : new Vector3() },
      'clippingThrough'   : { value : this._canvas.crosshairGroup.position },
      'clippingMap'       : { value : null },
      'clippingMapMatrixWorldInverse' : { value : new Matrix4() },
      'gamma'             : { value : 0.0 },

    };

    this._materials = {
      'MeshPhysicalMaterial' : compile_free_material(
        new MeshPhysicalMaterial( MATERIAL_PARAMS_MORE ),
        this._material_options
      ),
      'MeshLambertMaterial': compile_free_material(
        new MeshLambertMaterial( MATERIAL_PARAMS_BASIC ),
        this._material_options
      )
    };
    this._materials.MeshPhysicalMaterial.color = this._materialColor;
    this._materials.MeshLambertMaterial.color = this._materialColor;

    //gb.faces = faces;

    this._geometry.name = 'geom_free_' + g.name;

    this._material_type = g.material_type || 'MeshPhysicalMaterial';
    this._mesh = new Mesh(this._geometry, this._materials[this._material_type]);
    this._mesh.name = 'mesh_free_' + g.name;

    this._mesh.position.fromArray(g.position);

    // calculate timestamps
    this.time_stamp = to_array( this._params.time_stamp );
    if(this.time_stamp.length > 0){

      let min, max;
      this.time_stamp.forEach((v) => {
        if( min === undefined || min > v ){ min = v; }
        if( max === undefined || max < v){ max = v; }
      });
      if( min !== undefined ){
        let min_t = this._canvas.get_state( 'time_range_min0' );
        if( min_t === undefined || min < min_t ){
          this._canvas.set_state( 'time_range_min0', min );
        }
      }
      if( max !== undefined ){
        let max_t = this._canvas.get_state( 'time_range_max0' );
        if( max_t === undefined || max < max_t ){
          this._canvas.set_state( 'time_range_max0', max );
        }
      }

    }

    // register userData to comply with main framework
    this._mesh.userData.construct_params = g;

    // animation data (for backward-compatibility)
    this._mesh.userData.ani_name = 'default';
    this._mesh.userData.ani_all_names = Object.keys( g.keyframes );
    this._mesh.userData.ani_exists = false;

    // register object
    this.object = this._mesh;

    this._link_userData();
  }

}


function gen_free(g, canvas){
  if( g.isSurfaceMesh ) {
    const subjectCode = canvas.get_state("target_subject");
    const surfaceType = g.fileName ?? "Custom";
    let hemisphere = g.hemisphere;

    if( typeof hemisphere !== "string" || hemisphere.length === 0 || ["r", "l", "R", "L"].indexOf( hemisphere[0] ) === -1) {
      const positionArray = g.position;
      const nItems = positionArray.length / 3;
      let rAxis = 0;
      for(let i = 0; i < nItems; i++ ) {
        rAxis += positionArray[ i * 3 ] / nItems;
      }
      if( rAxis > 0 ) {
        hemisphere = "right";
      } else {
        hemisphere = "left";
      }
    }
    const hemi = hemisphere.toLocaleLowerCase()[0];
    if( hemi === "l" ) {
      hemisphere = "Left";
    } else {
      hemisphere = "Right";
    }

    // get surface space
    // https://bids-specification.readthedocs.io/en/stable/appendices/coordinate-systems.html#image-based-coordinate-systems
    const transform = new Matrix4();
    try {
      let space = "";
      const spaceParsed = surfaceType.toLocaleLowerCase().match(/[_]{0,1}space-([a-z0-9]+)([_\.]|$)/g);
      if( Array.isArray( spaceParsed ) && spaceParsed.length > 0 ) {
        space = spaceParsed[0].split("-")[1];
      }
      /*
      // MNI305
      fsaverage*, fsaverageSym*, MNI305
      // MNI152
      fsLR, MNI152*
      // T1
      scanner

       canvas.getTransforms("mni152_b")
          MNI305_tkrRAS: Object { elements: (16) […] }
          Norig: Object { elements: (16) […] }
          Torig: Object { elements: (16) […] }
          tkrRAS_MNI305: Object { elements: (16) […] }
          tkrRAS_Scanner: Object { elements: (16) […] }
          xfm: Object { elements: (16) […] }
      */
      const subjectMatrices = canvas.getTransforms( subjectCode );
      if( space.startsWith("scan") ) {
        // Surface is in ScannerRAS, needs to be in tkrRAS
        transform.copy( subjectMatrices.tkrRAS_Scanner ).invert();
      } else if ( space.startsWith("fsaverage") || space.startsWith("mni305") ) {
        // Surface is in MNI305, needs to be in tkrRAS
        transform.copy( subjectMatrices.MNI305_tkrRAS );
      } else if ( space.startsWith("fsl") || space.startsWith("mni152") ) {
        // Surface is in MNI152, needs to be in tkrRAS (152 -> 305 -> tkr)
        transform.copy( CONSTANTS.MNI305_to_MNI152 ).invert()
          .premultiply( subjectMatrices.MNI305_tkrRAS );
      }
    } catch (e) {
      console.warn(e);
    }


    const param = {
      "name"    : `FreeSurfer ${ hemisphere } Hemisphere - ${ surfaceType } (${ subjectCode })`,
      "type"    : "free",
      "render_order"  : 1,
      "time_stamp"    : [],
      "position": [0,0,0],
      "trans_mat"     : transform,
      "disable_trans_mat" :false,
      "value"   : null,
      "clickable"     : false,
      "layer"   : CONSTANTS.LAYER_SYS_MAIN_CAMERA_8,
      "group"   : {
        "group_name": `Surface - Custom (${ subjectCode })`,
        "group_layer"   : 0,
        "group_position": [0,0,0]
      },
      "use_cache"     : false,
      "custom_info"   : "",
      "subject_code"  : subjectCode,
      "display_code"  : subjectCode,
      "keyframes"     : [],
      "hemisphere"    : hemisphere.toLocaleLowerCase(),
      "surface_type"  : surfaceType,
      "meshObject"    : g
    };

    const inst = new FreeMesh(param, canvas);
    // make sure subject array exists
    canvas.init_subject( inst.subject_code );
    inst.finish_init();
    return( inst );
  }
  return( new FreeMesh(g, canvas) );
}

export { gen_free };
