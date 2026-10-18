import {
  OrthographicCamera, RenderTarget, DepthTexture, Vector2,
  HalfFloatType, FloatType, RGBAFormat, NearestFilter
} from 'three';
import { CONSTANTS } from './constants.js';

const _size = new Vector2();

/**
 * Draws the ray-marched volumes (`DataCube2`) of the main view into a target of
 * their own, without multisampling, before the main view's pass; each volume's
 * composite mesh then copies its pixels into the main pass
 * (`VolumeCompositeMaterial`, `shaders/VolumeShader.js`).
 *
 * The main view draws into a 4x multisampled target. Safari 27's WebGPU shades
 * fragments on such a target about once per sample, which made the ray march
 * about 4.4x as expensive: 26.5 ms per frame against 5.0 ms in Chrome on the
 * same Mac. The march decides on its own which voxel each pixel shows, so
 * multisampling never smoothed anything for it; in a target of its own it runs
 * once per pixel in every browser. The composite reads two texels, which costs
 * little however often it is shaded.
 *
 * The volumes are on `LAYER_SYS_VOLUME_PASS_12`, which only `volumeCamera`
 * sees. That camera follows the main camera, but is a camera of its own: the
 * viewer keeps a lights node per camera (`ViewLighting`), so the main camera's
 * render objects never see the volume pass's light set and are not rebuilt.
 */
class VolumePass {

  constructor({ rendererInterface }) {
    this.rendererInterface = rendererInterface;

    // set by a volume's `pre_render()` when the main view is to show it, and
    // cleared by `ViewerCanvas.render()` at the start of every frame
    this.requested = false;

    this.volumeCamera = new OrthographicCamera();
    this.volumeCamera.layers.set( CONSTANTS.LAYER_SYS_VOLUME_PASS_12 );

    // color: the march's output as it is (working color space, alpha), for the
    // composite to blend; depth: the depth of the first voxel hit. Read texel by
    // texel, so both are nearest-filtered.
    this.target = new RenderTarget( 1, 1, {
      type : HalfFloatType,
      format : RGBAFormat,
      minFilter : NearestFilter,
      magFilter : NearestFilter,
      generateMipmaps : false,
      depthBuffer : true,
      samples : 0,
    });
    this.target.texture.name = 'VolumePass.color';
    const depthTexture = new DepthTexture( 1, 1, FloatType );
    depthTexture.minFilter = NearestFilter;
    depthTexture.magFilter = NearestFilter;
    depthTexture.name = 'VolumePass.depth';
    this.target.depthTexture = depthTexture;
  }

  // the textures stay the same objects for the life of the pass; resizing
  // reallocates them in place
  get colorTexture() {
    return this.target.texture;
  }

  get depthTexture() {
    return this.target.depthTexture;
  }

  /**
   * Draws the volumes the main view shows into `target`, if any asked to be
   * drawn this frame. Call right before the main view's pass, after the
   * `pre_render()` calls of that frame.
   */
  render( scene, camera ) {
    if( !this.requested ) { return; }

    // the main view's drawing buffer, so a pixel here is a pixel there
    this.rendererInterface.target.getDrawingBufferSize( _size );
    const width = Math.max( 1, _size.x ), height = Math.max( 1, _size.y );
    if( this.target.width !== width || this.target.height !== height ) {
      this.target.setSize( width, height );
    }

    // not recursive: the main camera carries its own light
    const volumeCamera = this.volumeCamera;
    volumeCamera.copy( camera, false );
    volumeCamera.layers.set( CONSTANTS.LAYER_SYS_VOLUME_PASS_12 );

    // the scene's background would otherwise fill the target, which must stay
    // transparent where no voxel is hit (as `SideCanvas.render()` does)
    const background = scene.background;
    scene.background = null;
    try {
      this.rendererInterface.renderToTarget( scene, volumeCamera, this.target );
    } finally {
      scene.background = background;
    }
  }

  dispose() {
    this.target.depthTexture.dispose();
    this.target.dispose();
  }

}

export { VolumePass };
