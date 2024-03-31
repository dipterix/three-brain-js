import { AbstractThreeBrainObject, getThreeBrainInstance } from './abstract.js';
import { CONSTANTS } from '../core/constants.js';
import { to_array, get_or_default } from '../utils.js';
import { GLSL3, Object3D, LineBasicMaterial, BufferGeometry, Data3DTexture, RedFormat,
         LinearFilter, NearestFilter, SpriteMaterial, Matrix4, Quaternion,
         UnsignedByteType, RawShaderMaterial, Vector3, DoubleSide, UniformsUtils,
         PlaneGeometry, Mesh, LineSegments, FloatType } from 'three';
import { SliceShader } from '../shaders/SliceShader.js';


/* WebGL doesn't take transparency into consideration when calculating depth
https://stackoverflow.com/questions/11165345/three-js-webgl-transparent-planes-hiding-other-planes-behind-them

The hack is to rewrite shader, force transparent fragments to have depth of 1, which means transparent parts
always hide behind other objects.

However, is we set brain mesh to be transparent, the volume is still hidden behind the mesh and invisible.
This is because when the renderer calculate depth first, and the mesh is in the front, then volume gets
not rendered.
What we need to do is to set render order to be -1, which means always render volume first, then the opaque
parts will show.

*/

const tmpVec3 = new Vector3();
const tmpNormal = new Vector3();
const tmpMat4 = new Matrix4();
const tmpQuaternion = new Quaternion();

class DataCube extends AbstractThreeBrainObject {

  constructor(g, canvas){
    super(g, canvas);

    this.type = 'DataCube';
    this.isDataCube = true;
    this.mainCanvasActive = false;
    this._uniforms = UniformsUtils.clone( SliceShader.uniforms );

    const subjectData = this._canvas.shared_data.get( this.subject_code );

    // Shader will take care of it
    g.disable_trans_mat = true;
    let dataTextureType = UnsignedByteType;

    // get cube (volume) data
    if( g.isVolumeCube ) {
      const niftiData = canvas.get_data("volume_data", g.name, g.group.group_name);

      if( niftiData.imageDataType === undefined ) {
        // float64 array, not supported
        let imageMin = Infinity, imageMax = -Infinity;
        niftiData.image.forEach(( v ) => {
          if( imageMin > v ){ imageMin = v; }
          if( imageMax < v ){ imageMax = v; }
        })
        this.cubeData = new Uint8Array( niftiData.image.length );
        const slope = 255 / (imageMax - imageMin),
              intercept = 255 - imageMax * slope,
              threshold = g.threshold || 0;
        niftiData.image.forEach(( v, ii ) => {
          const d = v * slope + intercept;
          if( d > threshold ) {
            this.cubeData[ ii ] = d;
          } else {
            this.cubeData[ ii ] = 0;
          }
        })
      } else {
        niftiData.normalize();
        this.cubeData = niftiData.image;
        dataTextureType = niftiData.imageDataType;
      }
      this.cubeShape = new Vector3().copy( niftiData.shape );
      const affine = niftiData.affine.clone();
      if( subjectData && typeof subjectData === "object" && subjectData.matrices ) {
        affine.copy( subjectData.matrices.Torig )
          .multiply( subjectData.matrices.Norig.clone().invert() )
          .multiply( niftiData.affine );
      }
      this._uniforms.world2IJK.value.copy( affine ).invert();
    } else {
      this.cubeData = new Uint8Array(canvas.get_data('datacube_value_'+g.name, g.name, g.group.group_name));
      this.cubeShape = new Vector3().fromArray( canvas.get_data('datacube_dim_'+g.name, g.name, g.group.group_name) );
      this._uniforms.world2IJK.value.set(1,0,0,128, 0,1,0,128, 0,0,1,128, 0,0,0,1);
    }
    this.dataTexture = new Data3DTexture(
      this.cubeData, this.cubeShape.x, this.cubeShape.y, this.cubeShape.z
    );
    this.dataTexture.minFilter = NearestFilter;
    this.dataTexture.magFilter = NearestFilter;
    this.dataTexture.format = RedFormat;
    this.dataTexture.type = dataTextureType;
    this.dataTexture.unpackAlignment = 1;
    this.dataTexture.needsUpdate = true;

    // Generate shader
    this._uniforms.map.value = this.dataTexture;
    this._uniforms.mapShape.value.copy( this.cubeShape );

    const sliceMaterial = new RawShaderMaterial( {
      glslVersion: GLSL3,
      uniforms: this._uniforms,
      vertexShader: SliceShader.vertexShader,
      fragmentShader: SliceShader.fragmentShader,
      side: DoubleSide,
      transparent : false,
      depthWrite: true
    } );
    this.sliceMaterial = sliceMaterial;
    const sliceGeometryXY = new PlaneGeometry( 512, 512 );
    this.sliceGeometryXY = sliceGeometryXY;
    const sliceMeshXY = new Mesh( sliceGeometryXY, sliceMaterial );
    sliceMeshXY.renderOrder = -1;
    sliceMeshXY.position.copy( CONSTANTS.VEC_ORIGIN );
    sliceMeshXY.name = 'mesh_datacube__axial_' + g.name;


    const sliceGeometryXZ = new PlaneGeometry( 512, 512 );
    /*
    sliceGeometryXZ.applyMatrix4(new Matrix4(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, -1, 0, 0,
      0, 0, 0, 1
    ));
    */
    sliceGeometryXZ.attributes.position.array = new Float32Array([
      -256, 0, -256,
      256, 0, -256,
      -256, 0, 256,
      256, 0, 256
    ]);
    this.sliceGeometryXZ = sliceGeometryXZ;
    const sliceMeshXZ = new Mesh( sliceGeometryXZ, sliceMaterial );
    sliceMeshXZ.renderOrder = -1;
    sliceMeshXZ.position.copy( CONSTANTS.VEC_ORIGIN );
    sliceMeshXZ.name = 'mesh_datacube__coronal_' + g.name;

    const sliceGeometryYZ = new PlaneGeometry( 512, 512 );
    sliceGeometryYZ.attributes.position.array = new Float32Array([
      0, -256, -256,
      0, 256, -256,
      0, -256, 256,
      0, 256, 256
    ]);
    this.sliceGeometryYZ = sliceGeometryYZ;
    const sliceMeshYZ = new Mesh( sliceGeometryYZ, sliceMaterial );
    // sliceMeshYZ.rotateY( Math.PI / 2 ).rotateZ( Math.PI / 2 );
    sliceMeshYZ.renderOrder = -1;
    sliceMeshYZ.position.copy( CONSTANTS.VEC_ORIGIN );
    sliceMeshYZ.name = 'mesh_datacube__sagittal_' + g.name;


  	this.object = [ sliceMeshXZ, sliceMeshXY, sliceMeshYZ ];

    sliceMeshXY.userData.dispose = () => {
  	  sliceMaterial.dispose();
  	  sliceGeometryXY.dispose();
      this.dataTexture.dispose();
    };
    sliceMeshXY.userData.instance = this;
    this.sliceXY = sliceMeshXY;

    sliceMeshXZ.userData.dispose = () => {
  	  sliceMaterial.dispose();
  	  sliceGeometryXZ.dispose();
      this.dataTexture.dispose();
    };
    sliceMeshXZ.userData.instance = this;
    this.sliceXZ = sliceMeshXZ;

    sliceMeshYZ.userData.dispose = () => {
  	  sliceMaterial.dispose();
  	  sliceGeometryYZ.dispose();
      this.dataTexture.dispose();
    };
    sliceMeshYZ.userData.instance = this;
    this.sliceYZ = sliceMeshYZ;

  }

  setOverlay( x ) {
    if( !x ) {
      this._uniforms.overlayMap.value = null;
      delete this.sliceMaterial.defines.HAS_OVERLAY;
      this.sliceMaterial.needsUpdate = true;
      return;
    }
    const inst = getThreeBrainInstance( x );
    if( !inst || !( inst.isDataCube2 || inst.isDataCube ) ) {
      delete this.sliceMaterial.defines.HAS_OVERLAY;
      this.sliceMaterial.needsUpdate = true;
      return;
    }

    if( typeof this.sliceMaterial.defines.HAS_OVERLAY !== "string" ) {
      this.sliceMaterial.defines.HAS_OVERLAY = "";
      this.sliceMaterial.needsUpdate = true;
    }


    if( inst.isDataCube2 ) {
      this._uniforms.overlayMap.value = inst.colorTexture;
      this._uniforms.overlayShape.value.copy( inst.modelShape );

      // inst._transform is model to world
      this._uniforms.overlay2IJK.value.copy( inst._transform ).invert()
        .premultiply( inst.model2vox );
      return;
    }

    if( inst.isDataCube ) {
      this._uniforms.overlayMap.value = inst._uniforms.map.value;
      this._uniforms.overlayShape.value.copy( inst._uniforms.mapShape );
      this._uniforms.overlay2IJK.value.copy( inst._uniforms.world2IJK.value );
      return;
    }
  }

  disposeGPU() {
    super.disposeGPU();
    this.sliceMaterial.dispose();
    this.dataTexture.dispose();
  }

  dispose(){
    super.dispose();
    this.sliceMaterial.dispose();
    this.sliceGeometryXY.dispose();
    this.sliceGeometryXZ.dispose();
  	this.sliceGeometryYZ.dispose();
    this.dataTexture.dispose();
  }

  get_track_data( track_name, reset_material ){}

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){

    if( this._canvas.get_state("sideCameraTrackMainCamera", "canonical") !== "canonical" ) {
      if( this.dataTexture.magFilter !== LinearFilter ) {
        this.dataTexture.magFilter = LinearFilter;
        this.dataTexture.needsUpdate = true;
      }
    } else {
      if( this.dataTexture.magFilter !== NearestFilter ) {
        this.dataTexture.magFilter = NearestFilter;
        this.dataTexture.needsUpdate = true;
      }
    }

    const displayOverlay = this._canvas.get_state("voxelDisplay", "hidden");
    let useOverlay = false;
    if( target === CONSTANTS.RENDER_CANVAS.main ) {
      this._uniforms.threshold.value = 0.0;
      this.sliceMaterial.depthWrite = true;
      useOverlay =
            displayOverlay === "normal" ||
            displayOverlay === "main camera" ||
            displayOverlay === "anat. slices";
    } else {
      this._uniforms.threshold.value = -1.0;
      this.sliceMaterial.depthWrite = false;
      useOverlay = displayOverlay === "normal" ||
            displayOverlay === "side camera" ||
            displayOverlay === "anat. slices";
    }

    if( useOverlay ) {
      if( typeof this.sliceMaterial.defines.USE_OVERLAY !== "string" ) {
        this.sliceMaterial.defines.USE_OVERLAY = "";
        this.sliceMaterial.needsUpdate = true;
      }
    } else {
      if( typeof this.sliceMaterial.defines.USE_OVERLAY === "string" ) {
        delete this.sliceMaterial.defines.USE_OVERLAY;
        this.sliceMaterial.needsUpdate = true;
      }
    }

    const bias = this._canvas.get_state("sliceIntensityBias", 0.0);
    this._uniforms.gamma.value = bias;

    const overlayAlpha = this._canvas.get_state("overlayAlpha", 0.0);
    this._uniforms.overlayAlpha.value = overlayAlpha;

  }

  showSlices( which ) {
    const planType = to_array( which );
    if( planType.length === 0 ) { return; }
    if( planType.includes( 'coronal' ) ) {
      this.sliceXZ.layers.enable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this._canvas.set_state( 'coronal_overlay', true );
      this.coronalActive = true;
    }
    if( planType.includes( 'sagittal' ) ) {
      this.sliceYZ.layers.enable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this._canvas.set_state( 'sagittal_overlay', true );
      this.sagittalActive = true;
    }
    if( planType.includes( 'axial' ) ) {
      this.sliceXY.layers.enable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this._canvas.set_state( 'axial_overlay', true );
      this.axialActive = true;
    }
    this._canvas.needsUpdate = true;
  }

  hideSlices( which ) {
    const planType = to_array( which );
    if( planType.length === 0 ) { return; }
    if( planType.includes( 'coronal' ) ) {
      this.sliceXZ.layers.disable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this._canvas.set_state( 'coronal_overlay', false );
      this.coronalActive = false;
    }
    if( planType.includes( 'sagittal' ) ) {
      this.sliceYZ.layers.disable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this._canvas.set_state( 'sagittal_overlay', false );
      this.sagittalActive = false;
    }
    if( planType.includes( 'axial' ) ) {
      this.sliceXY.layers.disable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
      this._canvas.set_state( 'axial_overlay', false );
      this.axialActive = false;
    }
    this._canvas.needsUpdate = true;
  }

  finish_init(){
    // Special, as m is a array of three planes
    // this.object = mesh = [ mesh_xz, sliceMeshXY, mesh_yz ];

    this._canvas.mesh.set( '_coronal_' + this.name, this.sliceXZ );
    this._canvas.mesh.set( '_axial_' + this.name, this.sliceXY );
    this._canvas.mesh.set( '_sagittal_' + this.name, this.sliceYZ );

    if( this.clickable ){
      this._canvas.add_clickable( '_coronal_' + this.name, this.sliceXZ );
      this._canvas.add_clickable( '_axial_' + this.name, this.sliceXY );
      this._canvas.add_clickable( '_sagittal_' + this.name, this.sliceYZ );
    }
    this.sliceXY.layers.set( CONSTANTS.LAYER_SYS_AXIAL_10 );
    this.sliceXZ.layers.set( CONSTANTS.LAYER_SYS_CORONAL_9 );
    this.sliceYZ.layers.set( CONSTANTS.LAYER_SYS_SAGITTAL_11 );

    // data cube must have groups. The group is directly added to scene,
    // regardlessly
    let gp = this.getGroupObject3D();
    this.groupObject = gp;

    // Move gp to global scene as its center is always 0,0,0
    this._canvas.origin.remove( gp );

    this._canvas.crosshairGroup.add( gp );

    // set layer, add tp group
    this.object.forEach((plane) => {

      this.set_layer( [], plane );

      gp.add( plane );
      plane.userData.construct_params = this._params;
      plane.updateMatrixWorld();
    });

    this.register_object( ['slices'] );

  }

}


function gen_datacube(g, canvas){
  return( new DataCube(g, canvas) );
}

export { gen_datacube };
