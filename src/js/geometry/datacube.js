import { AbstractThreeBrainObject, getThreeBrainInstance } from './abstract.js';
import { CONSTANTS } from '../core/constants.js';
import { to_array, get_or_default } from '../utils.js';
import { GLSL3, Object3D, LineBasicMaterial, BufferGeometry, Data3DTexture, RedFormat,
         LinearFilter, NearestFilter, SpriteMaterial, Matrix4, Quaternion,
         UnsignedByteType, RawShaderMaterial, Vector3, DoubleSide, UniformsUtils,
         PlaneGeometry, Mesh, LineSegments, FloatType, Color } from 'three';
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
      const niftiMask = canvas.get_data("volume_mask", g.name, g.group.group_name);

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
        this.cubeData = niftiData.getNormalizedImage();
        dataTextureType = FloatType;
      }
      if( niftiMask && niftiMask.image.length === this.cubeData.length ) {
        this.maskData = new Uint8Array( niftiMask.image );
      } else {
        this.maskData = null;
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
      this.maskData = null;
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

    if( this.maskData ) {
      this.maskTexture = new Data3DTexture(
        this.maskData, this.cubeShape.x, this.cubeShape.y, this.cubeShape.z
      );
      this.maskTexture.minFilter = NearestFilter;
      this.maskTexture.magFilter = NearestFilter;
      this.maskTexture.format = RedFormat;
      this.maskTexture.type = UnsignedByteType;
      this.maskTexture.unpackAlignment = 1;
      this.maskTexture.needsUpdate = true;
      this._uniforms.mapMask.value = this.maskTexture;
    } else {
      this.maskTexture = null;
    }

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
    sliceGeometryXY.computeVertexNormals();
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
    sliceGeometryXZ.computeVertexNormals();
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
    sliceGeometryYZ.computeVertexNormals();
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
      if( this.maskTexture ) { this.maskTexture.dispose(); }
    };
    sliceMeshXY.userData.instance = this;
    this.sliceXY = sliceMeshXY;

    sliceMeshXZ.userData.dispose = () => {
  	  sliceMaterial.dispose();
  	  sliceGeometryXZ.dispose();
      this.dataTexture.dispose();
      if( this.maskTexture ) { this.maskTexture.dispose(); }
    };
    sliceMeshXZ.userData.instance = this;
    this.sliceXZ = sliceMeshXZ;

    sliceMeshYZ.userData.dispose = () => {
  	  sliceMaterial.dispose();
  	  sliceGeometryYZ.dispose();
      this.dataTexture.dispose();
      if( this.maskTexture ) { this.maskTexture.dispose(); }
    };
    sliceMeshYZ.userData.instance = this;
    this.sliceYZ = sliceMeshYZ;

  }

  _setOverlayColorChangeHandler = ( event ) => {
    if( !this._overlay ) { return; }
    if( this._overlay.name !== event.instanceName ) { return; }
    this.setOverlay( this._overlay );
  };

  removeOverlay = () => {
    let needsUpdate = false;
    const thisMaterialDefines = this.sliceMaterial.defines;
    this._uniforms.overlayMap.value = null;

    if( thisMaterialDefines.HAS_OVERLAY !== undefined ) {
      delete thisMaterialDefines.HAS_OVERLAY;
      needsUpdate = true;
    }
    if( thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS !== undefined ) {
      delete thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS;
      needsUpdate = true;
    }

    if( this._overlay ) {
      try {
        this._overlay.removeEventListener(
          CONSTANTS.EVENTS.onDataCube2ColorUpdated,
          this._setOverlayColorChangeHandler
        );
        this._overlay.removeEventListener(
          CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
          this.removeOverlay
        );
      } catch (e) {
        console.warn(e);
      }
      needsUpdate = true;
    }
    if( needsUpdate ) {
      this.sliceMaterial.needsUpdate = true;
    }
  }

  setOverlay( x ) {

    const inst = getThreeBrainInstance( x );
    if( !inst || !( inst.isDataCube2 || inst.isDataCube ) ) {
      this.removeOverlay();
      return;
    }

    if( this._overlay !== inst ) {
      this.removeOverlay();
      this._overlay = inst;
    }

    const thisMaterialDefines = this.sliceMaterial.defines;

    let materialNeedsUpdate = false;

    if( typeof thisMaterialDefines.HAS_OVERLAY !== "string" ) {
      thisMaterialDefines.HAS_OVERLAY = "";
      materialNeedsUpdate = true;
    }


    if( inst.isDataCube2 ) {

      if ( inst.isDataContinuous ) {

        const nColors = inst.object.material.defines.N_SINGLE_CHANNEL_COLORS;
        const thatUniforms = inst.object.material.uniforms;

        const thisColors = this._uniforms.overlayColorsWhenSingleChannel.value;
        const thatColors = thatUniforms.colorsWhenSingleChannel.value;
        for( let i = 0; i < nColors; i++ ) {
          if( !thisColors[ i ] ) {
            thisColors[ i ] = new Color();
          }
          const thatC = thatColors[ i ];
          if( thatC ) {
            thisColors[ i ].copy( thatC );
          }
        }

        this._uniforms.overlayValueLB.value = thatUniforms.singleChannelColorRangeLB.value;
        this._uniforms.overlayValueUB.value = thatUniforms.singleChannelColorRangeUB.value;

        if( nColors !== thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS ) {
          thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS = nColors;
          materialNeedsUpdate = true;
        }

      } else if( thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS !== undefined ) {
        delete thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS;
        materialNeedsUpdate = true;
      }

      this._uniforms.overlayMap.value = inst.colorTexture;
      this._uniforms.overlayShape.value.copy( inst.modelShape );

      // inst._transform is model to world
      this._uniforms.overlay2IJK.value.copy( inst._transform ).invert()
        .premultiply( inst.model2vox );

    } else if( inst.isDataCube ) {

      if( thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS !== undefined ) {
        delete thisMaterialDefines.OVERLAY_N_SINGLE_CHANNEL_COLORS;
        materialNeedsUpdate = true;
      }

      this._uniforms.overlayMap.value = inst._uniforms.map.value;
      this._uniforms.overlayShape.value.copy( inst._uniforms.mapShape );
      this._uniforms.overlay2IJK.value.copy( inst._uniforms.world2IJK.value );

    }

    if( materialNeedsUpdate ) {
      this.sliceMaterial.needsUpdate = true;
    }

    if(
      !inst.hasEventListener(
        CONSTANTS.EVENTS.onDataCube2ColorUpdated,
        this._setOverlayColorChangeHandler
      )
    ) {
      inst.addEventListener(
        CONSTANTS.EVENTS.onDataCube2ColorUpdated,
        this._setOverlayColorChangeHandler
      );
    }

    if(
      !inst.hasEventListener(
        CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
        this.removeOverlay
      )
    ) {
      inst.addEventListener(
        CONSTANTS.EVENTS.onThreeBrainObjectDisposeStart,
        this.removeOverlay
      );
    }

  }

  disposeGPU() {
    super.disposeGPU();
    this.sliceMaterial.dispose();
    this.dataTexture.dispose();
    if( this.maskTexture ) { this.maskTexture.dispose(); }
  }

  dispose(){
    super.dispose();
    this.sliceMaterial.dispose();
    this.sliceGeometryXY.dispose();
    this.sliceGeometryXZ.dispose();
  	this.sliceGeometryYZ.dispose();
    this.dataTexture.dispose();
    if( this.maskTexture ) { this.maskTexture.dispose(); }

    this._canvas.removeClickable( '_coronal_' + this.name );
    this._canvas.removeClickable( '_axial_' + this.name );
    this._canvas.removeClickable( '_sagittal_' + this.name );
  }

  get_track_data( track_name, reset_material ){}

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){

    const sliceMode = this._canvas.get_state("sideCameraTrackMainCamera", "canonical");
    const crosshairQuaternion = this._canvas.crosshairGroup.quaternion;
    let megFilter = NearestFilter;
    if( crosshairQuaternion.w === 1 ) {
      megFilter = LinearFilter;
    }

    if( this.dataTexture.magFilter !== megFilter ) {
      this.dataTexture.magFilter = megFilter;
      this.dataTexture.needsUpdate = true;
    }

    /*
    if( sliceMode !== "canonical" ) {
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
    */

    const displayOverlay = this._canvas.get_state("voxelDisplay", "hidden");
    let useOverlay = false;
    if( target === CONSTANTS.RENDER_CANVAS.main ) {
      this._uniforms.threshold.value = 0.0;
      this._uniforms.allowDiscard.value = 1.0;
      this.sliceMaterial.depthWrite = true;
      useOverlay =
            displayOverlay === "normal" ||
            displayOverlay === "main camera" ||
            displayOverlay === "anat. slices";
    } else {
      this._uniforms.threshold.value = -1.0;
      this._uniforms.allowDiscard.value = 0.0;
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

    const brightness = this._canvas.get_state("sliceBrightness", 0.0);
    this._uniforms.brightness.value = brightness;

    const contrast = this._canvas.get_state("sliceContrast", 0.0);
    this._uniforms.contrast.value = contrast;

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
      this._canvas.makeClickable( '_coronal_' + this.name, this.sliceXZ );
      this._canvas.makeClickable( '_axial_' + this.name, this.sliceXY );
      this._canvas.makeClickable( '_sagittal_' + this.name, this.sliceYZ );
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

      this.setLayers( [], plane );

      gp.add( plane );
      plane.userData.construct_params = this._params;
      plane.updateMatrixWorld();
    });

    this.registerToMap( ['slices'] );

  }

}


function gen_datacube(g, canvas){
  return( new DataCube(g, canvas) );
}

export { gen_datacube };
