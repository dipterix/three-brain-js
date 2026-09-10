import { AbstractThreeBrainObject, getThreeBrainInstance } from './abstract.js';
import { CONSTANTS } from '../core/constants.js';
import { to_array, get_or_default } from '../utils.js';
import { GLSL3, Object3D, LineBasicMaterial, BufferGeometry, Data3DTexture, RedFormat,
         LinearFilter, NearestFilter, SpriteMaterial, Matrix4, Quaternion,
         UnsignedByteType, RawShaderMaterial, Vector3, DoubleSide, UniformsUtils,
         PlaneGeometry, Mesh, LineSegments, FloatType, Color } from 'three';
import { SliceShader, SliceMaterial } from '../shaders/SliceShader.js';
import { formatDataValue } from '../utility/formatDataValue.js';


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

    const subjectData = this._canvas.shared_data.get( this.subject_code );
    const world2UnderlayVoxel = new Matrix4().set(1,0,0,128, 0,1,0,128, 0,0,1,128, 0,0,0,1);
    const world2MaskVoxel = new Matrix4().set(1,0,0,128, 0,1,0,128, 0,0,1,128, 0,0,0,1);

    const uniforms = {

      // maskData
      maskMap: { value : null },
      maskShape: { value : new Vector3().set( 256, 256, 256 ) },
      mask2IJK: { value : world2MaskVoxel },
    };


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
      if( niftiMask ) {
        // uniforms.maskMap.value
        const maskTexture = new Data3DTexture(
          new Uint8Array( niftiMask.image ),
          niftiMask.shape.x, niftiMask.shape.y, niftiMask.shape.z
        );
        maskTexture.minFilter = NearestFilter;
        maskTexture.magFilter = NearestFilter;
        maskTexture.format = RedFormat;
        maskTexture.type = UnsignedByteType;
        maskTexture.unpackAlignment = 1;
        maskTexture.needsUpdate = true;

        uniforms.maskMap.value = maskTexture;
        uniforms.maskShape.value.copy( niftiMask.shape );

        world2MaskVoxel.copy( niftiMask.affine ).invert();
      }
      this.cubeShape = new Vector3().copy( niftiData.shape );

      // scanRAS -> IJK
      world2UnderlayVoxel.copy( niftiData.affine ).invert();
      if( subjectData && typeof subjectData === "object" && subjectData.matrices ) {

        // tkrRAS -> SubIJK -> scanRAS
        const tkr2Scan = subjectData.matrices.Torig.clone().invert()
          .premultiply( subjectData.matrices.Norig );

        // tkrRAS -> scanRAS -> IJK
        world2UnderlayVoxel.multiply( tkr2Scan );
        world2MaskVoxel.multiply( tkr2Scan );

      }

    } else {
      this.cubeData = new Uint8Array(canvas.get_data('datacube_value_'+g.name, g.name, g.group.group_name));
      this.cubeShape = new Vector3().fromArray( canvas.get_data('datacube_dim_'+g.name, g.name, g.group.group_name) );
      world2UnderlayVoxel.set(1,0,0,128, 0,1,0,128, 0,0,1,128, 0,0,0,1);
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

    const sliceMaterial = new SliceMaterial( {
      // glslVersion: GLSL3,
      uniforms: uniforms,
      // vertexShader: SliceShader.vertexShader,
      // fragmentShader: SliceShader.fragmentShader,
      // side: DoubleSide,
      // transparent : false,
      // depthWrite: true
    } );

    sliceMaterial.underlayMap = this.dataTexture;
    sliceMaterial.underlayShape.copy( this.cubeShape );
    sliceMaterial.world2UnderlayVoxel.copy( world2UnderlayVoxel );

    // the shader is not the only consumer: focus mode needs the same world->IJK
    // transform on the CPU to read `cubeData` under the cursor
    this.world2UnderlayVoxel = world2UnderlayVoxel;

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

    const inst = getThreeBrainInstance( x );
    this.sliceMaterial.setOverlay( inst );

  }

  disposeGPU() {
    super.disposeGPU();
    this.sliceMaterial.dispose();
    this.dataTexture.dispose();
    if( this.sliceMaterial.uniforms.maskMap.value ) {
      this.sliceMaterial.uniforms.maskMap.value.dispose();
    }
  }

  dispose(){
    super.dispose();
    this.sliceMaterial.dispose();
    this.sliceGeometryXY.dispose();
    this.sliceGeometryXZ.dispose();
  	this.sliceGeometryYZ.dispose();
    this.dataTexture.dispose();
    if( this.sliceMaterial.uniforms.maskMap.value ) {
      this.sliceMaterial.uniforms.maskMap.value.dispose();
    }

    this._canvas.removeClickable( '_coronal_' + this.name );
    this._canvas.removeClickable( '_axial_' + this.name );
    this._canvas.removeClickable( '_sagittal_' + this.name );
  }

  get_track_data( track_name, reset_material ){}

  updateFocusMode({ mode, objectType } = {}) {
    if( mode === "ruler" || objectType === "all" || objectType === "2D slice" ) {
      // `this.object` is the three slice planes, which the base walks for us
      super.updateFocusMode({ mode : mode, objectType : objectType });
    } else {
      this.object.forEach(( item ) => {
        item.layers.disable( CONSTANTS.LAYER_SYS_RAYCASTER_ALL_15 );
      });
    }
  }

  /**
   * Which of the three planes an object is, as a `{ anatomical, crs }` pair.
   * Both names are kept because only one of them is honest at a time -- see
   * `getInfoText`.
   */
  _planeNames( object ) {
    if( object === this.sliceXZ ) { return { anatomical : "coronal",  crs : "row" }; }
    if( object === this.sliceXY ) { return { anatomical : "axial",    crs : "slice" }; }
    if( object === this.sliceYZ ) { return { anatomical : "sagittal", crs : "column" }; }
    return;
  }

  /**
   * Underlay intensity at a world-space point, or undefined when the point
   * falls outside the volume.
   */
  valueAtWorldPosition( position ) {
    if( !position || !this.world2UnderlayVoxel || !this.cubeData ) { return; }

    const ijk = tmpVec3.copy( position ).applyMatrix4( this.world2UnderlayVoxel );
    const i = Math.round( ijk.x ), j = Math.round( ijk.y ), k = Math.round( ijk.z );
    const mx = this.cubeShape.x, my = this.cubeShape.y, mz = this.cubeShape.z;

    if( i < 0 || i >= mx || j < 0 || j >= my || k < 0 || k >= mz ) { return; }

    return this.cubeData[ i + mx * ( j + my * k ) ];
  }

  /**
   * Focus-mode info lines. There is no `index` line: volumes get trimmed on the
   * way in, so a voxel index would not reliably refer to anything the user can
   * look up. The coordinates carry the location instead.
   */
  getInfoText( type, hit ) {
    switch ( type ) {

      case "type": {
        const names = hit ? this._planeNames( hit.object ) : undefined;
        if( !names ) { return `Type:      Volume slice`; }
        // Anatomical names only mean something while the planes are
        // axis-aligned. Under `line-of-sight`, `snap-to-electrode` and
        // `column-row-slice` the crosshair rotates them, so "coronal" would be
        // a lie -- fall back to the axis the plane indexes. This is the same
        // test `pre_render` uses to pick a texture filter.
        const axisAligned = this._canvas.crosshairGroup.quaternion.w === 1;
        return `Type:      Volume slice (${ axisAligned ? names.anatomical : names.crs })`;
      }

      case "display": {
        if( !hit ) { return; }
        const value = this.valueAtWorldPosition( hit.point );
        if( value === undefined ) { return; }
        // `cubeData` is normalised on load, so this is what is drawn rather
        // than the raw scanner intensity
        let text = `Display:   ${ formatDataValue( value ) }`;

        // The active volume is painted onto these planes as an overlay in the
        // modes `pre_render` recorded, and in `anat. slices` that is the only
        // place it is drawn at all -- so the slice reports it. Raw value, not
        // the thresholded colour; see `DataCube2.getValueFromPosition`.
        if( this._useOverlayMain ) {
          const volume = this._canvas.get_state( "activeDataCube2Instance" );
          if( volume && volume.isDataCube2 &&
              typeof volume.getValueFromPosition === "function" ) {
            const overlay = volume.getValueFromPosition( hit.point );
            if( overlay !== undefined ) {
              const atlasType = this._canvas.get_state( "atlas_type" );
              text += `  (${ atlasType ? atlasType + ": " : "" }${ overlay })`;
            }
          }
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

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}){

    const sliceMode = this._canvas.get_state("sideCameraTrackMainCamera", "canonical");
    const crosshairQuaternion = this._canvas.crosshairGroup.quaternion;
    let megFilter = LinearFilter;
    if( crosshairQuaternion.w === 1 ) {
      megFilter = NearestFilter;
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
      this.sliceMaterial.zeroThreshold = this._canvas.get_state("sliceMaskThrehsold", 0.0);
      this.sliceMaterial.depthWrite = true;
      useOverlay =
            displayOverlay === "normal" ||
            displayOverlay === "main camera" ||
            displayOverlay === "anat. slices";
      // remembered for `getInfoText`: the pick ray comes from the main camera,
      // so this is the branch that decides whether the overlay is on screen
      this._useOverlayMain = useOverlay;
    } else {
      this.sliceMaterial.zeroThreshold = -1.0;
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
    this.sliceMaterial.underlayBrightness = brightness;

    const contrast = this._canvas.get_state("sliceContrast", 0.0);
    this.sliceMaterial.underlayContrast = contrast;

    const overlayAlpha = this._canvas.get_state("overlayAlpha", 0.0);
    this.sliceMaterial.overlayAlpha = overlayAlpha;

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
