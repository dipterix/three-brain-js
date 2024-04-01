import { AbstractThreeBrainObject } from './abstract.js';
import { Vector3, Matrix4, Data3DTexture, NearestFilter, FloatType,
         RGBAFormat, RedFormat, UnsignedByteType, LinearFilter, Mesh,
         BoxGeometry } from 'three';
import { CONSTANTS } from '../core/constants.js';
import { get_or_default } from '../utils.js';
import { RayMarchingMaterial } from '../shaders/VolumeShader.js';
import { Lut } from '../jsm/math/Lut2.js'

const tmpVec3 = new Vector3();
const tmpMat4 = new Matrix4();


class DataCube2 extends AbstractThreeBrainObject {

  _filterDataContinuous( dataLB, dataUB, timeSlice ) {
    if( dataLB < this.__dataLB ) {
      dataLB = this.__dataLB;
    }
    if( dataUB > this.__dataUB ) {
      dataUB = this.__dataUB;
    }

    this._selectedDataValues.length = 2;
    this._selectedDataValues[ 0 ] = dataLB;
    this._selectedDataValues[ 1 ] = dataUB;

    // calculate voxelData -> colorKey transform
    let data2ColorKeySlope = 1, data2ColorKeyIntercept = 0;
    // if( this.lutAutoRescale ) {
    data2ColorKeySlope = (this.lutMaxColorID - this.lutMinColorID) / (this.__dataUB - this.__dataLB);
    data2ColorKeyIntercept = (this.lutMinColorID + this.lutMaxColorID - data2ColorKeySlope * (this.__dataLB + this.__dataUB)) / 2.0;
    // }

    if( typeof(timeSlice) === "number" ){
      this._timeSlice = Math.floor( timeSlice );
    }

    const mapAlpha = this.lut.mapAlpha;
    const voxelData = this.voxelData;
    const lutMap = this.lutMap;
    const singleChannel = this.colorFormat === RedFormat;
    const voxelColor = this.voxelColor;

    const voxelIndexOffset = this._timeSlice * this.nVoxels;
    let voxelIndex = 0,
        boundingMinX = Infinity, boundingMinY = Infinity, boundingMinZ = Infinity,
        boundingMaxX = -Infinity, boundingMaxY = -Infinity, boundingMaxZ = -Infinity;
    let withinFilters, voxelValue, voxelColorKey;

    if( singleChannel ) {

      // voxel alpha value
      let voxelA;

      for ( let z = 0; z < this.modelShape.z; z++ ) {
        for ( let y = 0; y < this.modelShape.y; y++ ) {
          for ( let x = 0; x < this.modelShape.x; x++, voxelIndex++ ) {
            // no need to round up as this has been done in the constructor
            voxelValue = voxelData[ voxelIndex + voxelIndexOffset ];
            if( voxelValue < dataLB || voxelValue > dataUB) {
              // hide this voxel as it's beyong threshold
              voxelColor[ voxelIndex ] = 0;
            } else {
              voxelColorKey = Math.floor(voxelValue * data2ColorKeySlope + data2ColorKeyIntercept);
              voxelA = lutMap[ voxelColorKey ];

              // NOTICE: we expect consecutive integer color keys!
              if( voxelA === undefined ) {
                // This shouldn't happen if color keys are consecutive
                voxelColor[ voxelIndex ] = 0;
              } else {

                voxelColor[ voxelIndex ] = voxelA.R;

                // set bounding box
                if( boundingMinX > x ) { boundingMinX = x; }
                if( boundingMinY > y ) { boundingMinY = y; }
                if( boundingMinZ > z ) { boundingMinZ = z; }
                if( boundingMaxX < x ) { boundingMaxX = x; }
                if( boundingMaxY < y ) { boundingMaxY = y; }
                if( boundingMaxZ < z ) { boundingMaxZ = z; }

              }
            }
          }
        }
      }

      /*
      if( this.lutAutoRescale ) {
        this.object.material.uniforms.singleChannelColorRangeLB.value =
          (dataLB - this.__dataLB) * data2ColorKeySlope / (this.lutMaxColorID - this.lutMinColorID);

        this.object.material.uniforms.singleChannelColorRangeUB.value =
          (dataUB - this.__dataLB) * data2ColorKeySlope / (this.lutMaxColorID - this.lutMinColorID);
      }
      */
    } else {

      // voxel RGBA value
      let voxelRGBA;
      for ( let z = 0; z < this.modelShape.z; z++ ) {
        for ( let y = 0; y < this.modelShape.y; y++ ) {
          for ( let x = 0; x < this.modelShape.x; x++, voxelIndex++ ) {

            // no need to round up as this has been done in the constructor
            voxelValue = voxelData[ voxelIndex + voxelIndexOffset ];
            if( voxelValue < dataLB || voxelValue > dataUB) {
              // hide this voxel as it's beyong threshold
              voxelColor[ voxelIndex * 4 + 3 ] = 0;
            } else {
              voxelColorKey = Math.round(voxelValue * data2ColorKeySlope + data2ColorKeyIntercept);
              voxelRGBA = lutMap[ voxelColorKey ];

              // NOTICE: we expect consecutive integer color keys!
              if( voxelRGBA === undefined ) {
                // This shouldn't happen if color keys are consecutive
                voxelColor[ voxelIndex * 4 + 3 ] = 0;
              } else {

                voxelColor[ voxelIndex * 4 ] = voxelRGBA.R;
                voxelColor[ voxelIndex * 4 + 1 ] = voxelRGBA.G;
                voxelColor[ voxelIndex * 4 + 2 ] = voxelRGBA.B;

                if( mapAlpha ) {
                  voxelColor[ voxelIndex * 4 + 3 ] = voxelRGBA.A;
                } else {
                  voxelColor[ voxelIndex * 4 + 3 ] = 255;
                }

                // set bounding box
                if( boundingMinX > x ) { boundingMinX = x; }
                if( boundingMinY > y ) { boundingMinY = y; }
                if( boundingMinZ > z ) { boundingMinZ = z; }
                if( boundingMaxX < x ) { boundingMaxX = x; }
                if( boundingMaxY < y ) { boundingMaxY = y; }
                if( boundingMaxZ < z ) { boundingMaxZ = z; }

              }
            }

          }
        }
      }

    }

    this.object.material.uniforms.bounding.value = Math.min(
      Math.max(
        boundingMaxX / this.modelShape.x - 0.5,
        boundingMaxY / this.modelShape.y - 0.5,
        boundingMaxZ / this.modelShape.z - 0.5,
        0.5 - boundingMinX / this.modelShape.x,
        0.5 - boundingMinY / this.modelShape.y,
        0.5 - boundingMinZ / this.modelShape.z,
        0.0
      ),
      0.5
    );

    this.object.material.uniformsNeedUpdate = true;

    this.colorTexture.needsUpdate = true;
  }
  _filterDataDiscrete( selectedDataValues, timeSlice ) {

    if( Array.isArray( selectedDataValues ) ){

      // discrete color keys
      this._selectedDataValues.length = 0;
      let dataValue;

      for( let jj = 0; jj < selectedDataValues.length; jj++ ) {
        dataValue = selectedDataValues[ jj ];
        if( dataValue <= this.lutMinColorID ) {
          this._selectedDataValues.length = 0;
          break;
        }
        this._selectedDataValues[ dataValue ] = true;
      }
      if( this._selectedDataValues.length === 0 ) {
        for( dataValue = this.lutMinColorID + 1;
              dataValue < this.lutMaxColorID; dataValue++ ) {
          this._selectedDataValues[ dataValue ] = true;
        }
      }
    }

    if( typeof(timeSlice) === "number" ){
      this._timeSlice = Math.floor( timeSlice );
    }

    const mapAlpha = this.lut.mapAlpha;
    const voxelData = this.voxelData;
    const lutMap = this.lutMap;
    const singleChannel = this.colorFormat === RedFormat;
    const voxelColor = this.voxelColor;

    const voxelIndexOffset = this._timeSlice * this.nVoxels;
    let voxelIndex = 0,
        boundingMinX = Infinity, boundingMinY = Infinity, boundingMinZ = Infinity,
        boundingMaxX = -Infinity, boundingMaxY = -Infinity, boundingMaxZ = -Infinity;
    let withinFilters, voxelValue;

    if( singleChannel ) {

      // voxel alpha value
      let voxelA;

      for ( let z = 0; z < this.modelShape.z; z++ ) {
        for ( let y = 0; y < this.modelShape.y; y++ ) {
          for ( let x = 0; x < this.modelShape.x; x++, voxelIndex++ ) {

            // no need to round up as this has been done in the constructor
            voxelValue = voxelData[ voxelIndex + voxelIndexOffset ];
            if( voxelValue <= this.lutMinColorID ) {
              // special: always hide this voxel
              voxelColor[ voxelIndex ] = 0;
            } else {

              voxelA = lutMap[ voxelValue ];
              withinFilters = this._selectedDataValues[ voxelValue ];

              if( voxelA !== undefined && withinFilters ) {
                // this voxel should be displayed
                voxelColor[ voxelIndex ] = voxelA.R;

                // set bounding box
                if( boundingMinX > x ) { boundingMinX = x; }
                if( boundingMinY > y ) { boundingMinY = y; }
                if( boundingMinZ > z ) { boundingMinZ = z; }
                if( boundingMaxX < x ) { boundingMaxX = x; }
                if( boundingMaxY < y ) { boundingMaxY = y; }
                if( boundingMaxZ < z ) { boundingMaxZ = z; }
              } else {
                voxelColor[ voxelIndex ] = 0;
              }

            }

          }
        }
      }
    } else {

      // voxel RGBA value
      let voxelRGBA;
      for ( let z = 0; z < this.modelShape.z; z++ ) {
        for ( let y = 0; y < this.modelShape.y; y++ ) {
          for ( let x = 0; x < this.modelShape.x; x++, voxelIndex++ ) {

            // no need to round up as this has been done in the constructor
            voxelValue = voxelData[ voxelIndex + voxelIndexOffset ];
            if( voxelValue <= this.lutMinColorID ) {
              // special: always hide this voxel
              voxelColor[ voxelIndex * 4 + 3 ] = 0;
            } else {

              voxelRGBA = lutMap[ voxelValue ];
              withinFilters = this._selectedDataValues[ voxelValue ];

              if( voxelRGBA !== undefined && withinFilters ) {
                // this voxel should be displayed
                voxelColor[ voxelIndex * 4 ] = voxelRGBA.R;
                voxelColor[ voxelIndex * 4 + 1 ] = voxelRGBA.G;
                voxelColor[ voxelIndex * 4 + 2 ] = voxelRGBA.B;

                if( mapAlpha ) {
                  voxelColor[ voxelIndex * 4 + 3 ] = voxelRGBA.A;
                } else {
                  voxelColor[ voxelIndex * 4 + 3 ] = 255;
                }
                // set bounding box
                if( boundingMinX > x ) { boundingMinX = x; }
                if( boundingMinY > y ) { boundingMinY = y; }
                if( boundingMinZ > z ) { boundingMinZ = z; }
                if( boundingMaxX < x ) { boundingMaxX = x; }
                if( boundingMaxY < y ) { boundingMaxY = y; }
                if( boundingMaxZ < z ) { boundingMaxZ = z; }
              } else {
                voxelColor[ voxelIndex * 4 + 3 ] = 0;
              }

            }

          }
        }
      }

    }

    this.object.material.uniforms.bounding.value = Math.min(
      Math.max(
        boundingMaxX / this.modelShape.x - 0.5,
        boundingMaxY / this.modelShape.y - 0.5,
        boundingMaxZ / this.modelShape.z - 0.5,
        0.5 - boundingMinX / this.modelShape.x,
        0.5 - boundingMinY / this.modelShape.y,
        0.5 - boundingMinZ / this.modelShape.z,
        0.0
      ),
      0.5
    );
    this.object.material.uniformsNeedUpdate = true;
    this.colorTexture.needsUpdate = true;

  }

  _onSetVoxelRenderDistance = (event) => {
    let dist = 1000.0;
    if( typeof event.detail.distance === "object" ) {
      dist = event.detail.distance.near;
      if( dist < 0 ) {
        dist = -dist;
      }
    }
    // FIXME
    // this.object.material.uniforms.maxRenderDistance.value = dist;
  }

  async updatePalette( selectedDataValues, timeSlice ){
    if( !this._canvas.has_webgl2 ){ return; }

    if( this.isDataContinuous ) {

      if( !Array.isArray( selectedDataValues ) ) {
        selectedDataValues = this._selectedDataValues;
      }
      let lb, ub;
      if( selectedDataValues.length >= 2 ) {
        /*lb = selectedDataValues[ 0 ];
        ub = selectedDataValues[ 1 ];*/
        lb = Math.min(...selectedDataValues);
        ub = Math.max(...selectedDataValues);
      } else {
        lb = this.lutMinColorID;
        ub = this.lutMaxColorID;
      }
      this._filterDataContinuous( lb, ub, timeSlice );

    } else {

      if( !Array.isArray( selectedDataValues ) ) {
        selectedDataValues = this._selectedDataValues;
      }
      this._filterDataDiscrete( selectedDataValues, timeSlice );

    }
  }

  constructor(g, canvas){


    super( g, canvas );

    if( !canvas.has_webgl2 ){
      throw 'DataCube2, i.e. voxel cube must need WebGL2 support';
    }

    // this._params is g
    // this.name = this._params.name;
    // this.group_name = this._params.group.group_name;

    this.type = 'DataCube2';
    this.isDataCube2 = true;
    this._display_mode = "hidden";
    this._selectedDataValues = [];
    this._timeSlice = 0;
    // transform before applying trans_mat specified by `g`
    // only useful for VolumeCube2
    this._transform = new Matrix4().set(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1);

    /**
     * historical issue:
     * threeBrain uses tkrRAS as world coordinate
     * Default: `this._transform`: model -> tkrRAS
     * Alternative: `this._transform`: scannerRAS -> tkrRAS
     */
    let transformSpaceFrom = g.trans_space_from || "model";
    if( Array.isArray(g.trans_mat) && g.trans_mat.length === 16 ) {
      this._transform.set(...g.trans_mat);
    } else {
      this._transform.set(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1);
    }

    let mesh;

    // Need to check if this is VolumeCube2
    if( g.isVolumeCube2 ) {
      const niftiData = g.imageObject ?? canvas.get_data("volume_data", g.name, g.group.group_name);
      this.voxelData = niftiData.image;
      // width, height, depth of the model (not in world)
      this.modelShape = new Vector3().copy( niftiData.shape );
      this.model2vox = niftiData.model2vox;

      // Make sure to register the initial transform matrix (from IJK to RAS)
      // original g.trans_mat is nifti RAS to tkrRAS
      // this._transform = g.trans_mat * niftiData.model2RAS
      //   -> new transform from model center to tkrRAS

      if( transformSpaceFrom === "model" ) {
        // Ignore this comment
        // special:: this is MGH data and transfor is embedded
        // if niftiData.model2tkrRAS && niftiData.model2tkrRAS.isMatrix4
        // this._transform.copy( niftiData.model2tkrRAS );

        // model -> scanner RAS -> tkr ras
        const subjectData = this._canvas.shared_data.get( this.subject_code );
        const ras2tkr = subjectData.matrices.tkrRAS_Scanner.clone().invert()
        this._transform.multiply( niftiData.model2RAS )
          .premultiply(ras2tkr);

      } else {
        // transformSpaceFrom is scannerRAS
        this._transform.multiply( niftiData.model2RAS );
      }
      this._originalData = niftiData;

    } else {
      // g.trans_mat is from model to tkrRAS
      this.voxelData = this._canvas.get_data('datacube_value_'+g.name, g.name, g.group.group_name);
      // width, height, depth of the model (not in world)
      this.modelShape = new Vector3().fromArray(
        this._canvas.get_data('datacube_dim_'+g.name, g.name, g.group.group_name)
      );
      this.model2vox = new Matrix4().setPosition(
        ( this.modelShape.x - 1.0 ) / 2.0,
        ( this.modelShape.y - 1.0 ) / 2.0,
        ( this.modelShape.z - 1.0 ) / 2.0
      )

      let minV = maxV = this.voxelData[0];
      this.voxelData.forEach((vd) => {
        if( minV > vd ) {
          minV = vd;
        } else if ( maxV < vd ){
          maxV = vd;
        }
      });

      this._originalData = {
        slope : 1,
        intercept : 0,
        calMin : minV,
        calMax : maxV,
      };
    }
    this.nVoxels = this.modelShape.x * this.modelShape.y * this.modelShape.z;
    // The color map might be specified separately
    if( g.color_map ) {
      this.lut = g.color_map;
    } else {
      if( g.color_format === "RedFormat" ) {
        this.lut = canvas.global_data('__global_data__.SurfaceColorLUT');
      } else {
        this.lut = canvas.global_data('__global_data__.VolumeColorLUT');
      }
    }
    this.lutMap = this.lut.map;
    this.lutMaxColorID = this.lut.mapMaxColorID;
    this.lutMinColorID = this.lut.mapMinColorID;
    this.lutAutoRescale = this.lut.colorIDAutoRescale === true;
    this.isDataContinuous = this.lut.mapDataType === "continuous";
    this.__dataLB = this.lutMinColorID;
    this.__dataUB = this.lutMaxColorID;

    // Generate 3D texture, to do so, we need to customize shaders
    if( g.color_format === "RedFormat" ) {
      this.colorFormat = RedFormat;
      this.nColorChannels = 1;
      this.voxelColor = new Uint8Array( this.nVoxels * 4 );
    } else {
      this.colorFormat = RGBAFormat;
      this.nColorChannels = 4;
      this.voxelColor = new Uint8Array( this.nVoxels * 4 );
    }

    // Change voxelData so all elements are integers (non-negative)
    if( this.isDataContinuous ) {
      // grayscale = ( slope x data + intercept - calMin ) / (calMax - calMin) * 255; also
      // grayscale = ( data - this.__dataLB ) / ( this.__dataUB - this.__dataLB ) * 255

      this.__dataLB = ( this._originalData.calMin - this._originalData.intercept ) / this._originalData.slope;
      this.__dataUB = ( this._originalData.calMax - this._originalData.intercept ) / this._originalData.slope + 1;

      this._selectedDataValues.length = 2;
      this._selectedDataValues[ 0 ] = this.__dataLB;
      this._selectedDataValues[ 1 ] = this.__dataUB;
    } else {

      this.voxelData.forEach((vd, ii) => {
        if( vd < this.lutMinColorID || vd > this.lutMaxColorID ) {
          this.voxelData[ ii ] = this.lutMinColorID;
        } else if( !Number.isInteger(vd) ) {
          this.voxelData[ ii ] =  Math.round( vd );
        }
      })
    }

    // Color texture - used to render colors
    this.colorTexture = new Data3DTexture(
      this.voxelColor, this.modelShape.x, this.modelShape.y, this.modelShape.z
    );

    this.colorTexture.minFilter = NearestFilter;
    this.colorTexture.magFilter = NearestFilter;
    this.colorTexture.format = this.colorFormat;
    this.colorTexture.type = UnsignedByteType;
    this.colorTexture.unpackAlignment = 1;

    this.colorTexture.needsUpdate = true;


    // const uniforms = UniformsUtils.clone( shader.uniforms );
    // this._uniforms = uniforms;
    // uniforms.map.value = data_texture;
    // uniforms.cmap.value = this.colorTexture;
    // uniforms.colorChannels.value = this.nColorChannels;
    // uniforms.alpha.value = -1.0;
    // uniforms.scale_inv.value.set(1 / this.modelShape.x, 1 / this.modelShape.y, 1 / this.modelShape.z);
    // uniforms.bounding.value = 0.5;

    // Material
    let material = new RayMarchingMaterial( {
      cmap          : this.colorTexture,
      cmapShape     : this.modelShape,
      colorChannels : this.nColorChannels,
      nColors       : this.nColorChannels > 1 ? 4 : 128
    });

    const geometry = new BoxGeometry(
      this.modelShape.x,
      this.modelShape.y,
      this.modelShape.z
    );

    mesh = new Mesh( geometry, material );
    mesh.name = 'mesh_datacube_' + g.name;

    mesh.position.fromArray( g.position );

    mesh.userData.dispose = () => { this.dispose(); };

    this._mesh = mesh;
    this.object = mesh;

    // initialize voxelColor
    this.updatePalette();

    // register listeners
    this._canvas.$el.addEventListener(
      "viewerApp.canvas.setVoxelRenderDistance",
      this._onSetVoxelRenderDistance );
  }

  disposeGPU () {
    super.disposeGPU();
    if( this.colorTexture ) {
      try {
        this.colorTexture.dispose();
      } catch ( e ) {}
    }
  }

  dispose(){
    super.dispose();
    try {
      this.object.removeFromParent();
    } catch (e) {}

    try {
      if( this.object ){
        this.object.material.dispose();
        this.object.geometry.dispose();
        // this._data_texture.dispose();
        this.colorTexture.dispose();

        // this._map_data = undefined;
        // this.voxelData = undefined;
      }
    } catch (e) {}
    try {
      this._canvas.$el.removeEventListener(
        "viewerApp.canvas.setVoxelRenderDistance",
        this._onSetVoxelRenderDistance );
    } catch (e) {}
  }

  get_track_data( track_name, reset_material ){}

  finish_init(){
    // this.object

    const transformDisabled = this._params.disable_trans_mat;

    // temporarily disable transform matrix
    this._params.disable_trans_mat = true;

    // Finalize setups
    super.finish_init();

    // override transform
    this._params.disable_trans_mat = transformDisabled;
    this.object.userData.trans_mat = this._transform;

    if( !transformDisabled ) {

      this.object.applyMatrix4( this._transform );
      this.object.updateMatrixWorld();

    }

    // data cube 2 must have groups and group parent is scene
    // let gp = this.getGroupObject3D();
    // Move gp to global scene as its center is always 0,0,0
    // this._canvas.origin.remove( gp );
    // this._canvas.scene.add( gp );

    this.register_object( ['atlases'] );

  }

  set_display_mode( mode ) {

    super.set_display_mode( mode );

    switch (mode) {
      case 'main camera':
        this.object.layers.enable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
        this.object.layers.disable( CONSTANTS.LAYER_SYS_ALL_SIDE_CAMERAS_13 );
        break;
      case 'side camera':
      case 'anat. slices':
        this.object.layers.disable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
        this.object.layers.enable( CONSTANTS.LAYER_SYS_ALL_SIDE_CAMERAS_13 );
        break;
      default:
        this.object.layers.enable( CONSTANTS.LAYER_SYS_MAIN_CAMERA_8 );
        this.object.layers.enable( CONSTANTS.LAYER_SYS_ALL_SIDE_CAMERAS_13 );
    }
  }

  pre_render({ target = CONSTANTS.RENDER_CANVAS.main } = {}) {
    super.pre_render({ target : target });
    if( this.forceVisible === true ) {
      this.object.visible = true;
    } else if( this.forceVisible === false ){
      this.object.visible = false;
      return;
    }
    if( target === CONSTANTS.RENDER_CANVAS.side ) {
      // sliceInstance.sliceMaterial.depthWrite = false;
      // if( renderCube && datacubeInstance.object.material.uniforms.alpha.value > 0 ) {
      this.object.material.depthWrite = false;
      this.object.material.depthTest = false;
      this.object.material.uniforms.dithering.value = 0.0;
    } else {
      this.object.material.depthWrite = true;
      this.object.material.depthTest = true;
      this.object.material.uniforms.dithering.value = this._dithering ?? 1.0;
    }
  }

  getCrosshairValue({ x, y, z }) {
    let crosshairText = "";
    tmpMat4.copy( this.object.matrixWorld ).invert();
    tmpVec3.set( x, y, z ).applyMatrix4( tmpMat4 );
    tmpVec3.x += (this.modelShape.x -1) / 2;
    tmpVec3.y += (this.modelShape.y-1) / 2;
    tmpVec3.z += (this.modelShape.z-1) / 2;

    const idx = Math.floor(
      Math.round(tmpVec3.x) +
      this.modelShape.x * (
        Math.round(tmpVec3.y) + Math.round(tmpVec3.z) * this.modelShape.y
      )
    );

    if( idx >= 0 && idx < this.voxelData.length ) {
      const voxelValue = this.voxelData[ idx ];

      if( typeof voxelValue === "number" ) {
        if( this.lut.mapDataType === "discrete" ) {
          const cinfo = this.lut.map[ voxelValue ];
          if( typeof cinfo === "object" ) {
            crosshairText = `[${voxelValue}] ${cinfo.Label}`;
          } else {
            crosshairText = "";
          }
        } else {
          crosshairText = voxelValue.toFixed(1);
        }
      }
    }

    return crosshairText;

  }

  useColorLookupTable( lut, paletteName = "viridis" ) {

    // Make sure the colormap is compatible
    const wasContinuous = this.isDataContinuous;
    const uniforms = this.object.material.uniforms;

    if(
      lut && this.lut !== lut && lut.map && lut.mapDataType &&
      lut.mapMaxColorID !== undefined && lut.mapMinColorID !== undefined
    ) {
      const isDataContinuous = lut.mapDataType === "continuous";
      const nColors = isDataContinuous ? 128 : 1;
      this.lut = lut;
      this.lutMap = this.lut.map;
      this.lutMaxColorID = this.lut.mapMaxColorID;
      this.lutMinColorID = this.lut.mapMinColorID;
      this.lutAutoRescale = this.lut.colorIDAutoRescale === true;
      // this.__dataLB = this.lutMinColorID;
      // this.__dataUB = this.lutMaxColorID;
      this.isDataContinuous = this.lut.mapDataType === "continuous";

      if(wasContinuous === undefined || wasContinuous ^ this.isDataContinuous) {
        if( this.isDataContinuous ) {
          this.colorFormat = RedFormat;
          this.nColorChannels = 1;

          this.object.material.useSingleChannel = true;

        } else {
          this.colorFormat = RGBAFormat;
          this.nColorChannels = 4;

          this.object.material.useSingleChannel = false;
        }

        this.colorTexture.minFilter = NearestFilter;
        this.colorTexture.magFilter = NearestFilter;
        this.colorTexture.format = this.colorFormat;
        this.colorTexture.type = UnsignedByteType;
        this.colorTexture.unpackAlignment = 1;
        this.colorTexture.needsUpdate = true;

        uniforms.cmap.value = this.colorTexture;
        uniforms.colorChannels.value = this.nColorChannels;

        this.object.material.defines.N_SINGLE_CHANNEL_COLORS = nColors;
      }

      if( this.isDataContinuous ) {
        this.__dataLB = ( this._originalData.calMin - this._originalData.intercept ) / this._originalData.slope;
        this.__dataUB = ( this._originalData.calMax - this._originalData.intercept ) / this._originalData.slope + 1;

        this._selectedDataValues.length = 2;
        this._selectedDataValues[ 0 ] = this.__dataLB;
        this._selectedDataValues[ 1 ] = this.__dataUB;
      } else {
        this._selectedDataValues.length = 0;
      }

      this.updatePalette();
    }

    this.object.material.changePalette( paletteName );
    this.object.material.uniformsNeedUpdate = true;

    this.dispatchEvent( {
      type: CONSTANTS.EVENTS.onDataCube2ColorUpdated,
      instanceName: this.name
    } );

    this._canvas.needsUpdate = true;
  }

}


function gen_datacube2(g, canvas){
  if( g && (g.isNiftiImage || g.isMGHImage) ) {
    if( g.isInvalid ) { return; }
    const subjectCode = canvas.get_state("target_subject");
    const fileName = g.fileName ?? "Custom";
    const name = `Atlas - ${ fileName } (${subjectCode})`;

    let colorFormat = g.colorFormat;
    if( !colorFormat ) {
      /**
       * determine the color format from fileName
       * If the file name contains:
       *   dseg, mask (BIDS)
       *   aparc, aseg (FreeSurfer)
       *   discrete (others)
       */
      if( fileName.match(/(dseg|mask|aseg|aparc|discrete|atlas|parcel)/gi) ) {
        colorFormat = "RGBAFormat";
      } else {
        colorFormat = "RedFormat";
      }
    }

    let colorMap = g.color_map;
    if( !colorMap ) {
      if( colorFormat === "RedFormat" ) {
        // Make sure the color rescales
        colorMap = {...canvas.global_data('__global_data__.SurfaceColorLUT')};
        colorMap.colorIDAutoRescale = true;
      } else {
        colorMap = canvas.global_data('__global_data__.VolumeColorLUT');
      }
    }

    g = {
      clickable: false,
      color_format: colorFormat,
      custom_info: "",
      disable_trans_mat: false,
      group: { group_name: `Atlas - Custom (${subjectCode})`, group_layer: 0, group_position: [0, 0, 0] },
      isDataCube2: true,
      isVolumeCube2: true,
      keyframes: [],
      layer: CONSTANTS.LAYER_SYS_MAIN_CAMERA_8,
      name: name,
      position: [0, 0, 0],
      render_order: 1,
      subject_code: subjectCode,
      threshold : 0.4,
      time_stamp: [],
      trans_mat : null,
      trans_space_from: "model",
      type: "datacube2",
      use_cache: false,
      value: null,
      color_map: colorMap,
      imageObject: g,
    }

    const inst = new DataCube2(g, canvas);
    // make sure subject array exists
    canvas.init_subject( inst.subject_code );
    inst.finish_init();
    return( inst );
  }

  return( new DataCube2(g, canvas) );
}

export { gen_datacube2 };

