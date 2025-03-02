import { CONSTANTS } from '../core/constants.js';
import { CCanvasRecorder } from '../capture/CCanvasRecorder.js';
import { PDFContext } from '../core/context.js';
import { exportScene } from '../formats/exportScene.js'
import { SVGRenderer } from '../jsm/renderers/SVGRenderer.js';


// 2. Record Videos

function registerPresetRecorder( ViewerControlCenter ){

  window.SVGRenderer = SVGRenderer;

  ViewerControlCenter.prototype.addPreset_recorder = function(){
    const folder_name = CONSTANTS.FOLDERS[ 'video-recorder' ];
    this.gui.addController('Record', false, {folder_name: folder_name })
      .onChange((v) =>{

        if(v){
          // create capture object
          if( this.canvas.capturer ){
            this.canvas.capturer.dispose();
          }

          const videoFormats = {};
          videoFormats[ "video/mp4" ] = "mp4";   // safari
          videoFormats[ "video/webm;codecs=vp8" ] = "webm"; // firefox
          videoFormats[ "video/webm" ] = "webm";  // default
          let format, mimeType;
          for( mimeType in videoFormats ) {
            format = videoFormats[ mimeType ];
            if( MediaRecorder.isTypeSupported( mimeType ) ) {
              break;
            }
          }


          this.canvas.capturer = new CCanvasRecorder({
            canvas: this.canvas.domElement,
            // FPS = 25
            framerate: 60,
            // Capture as webm
            format: format,
            mimeType: mimeType,
            // workersPath: 'lib/',
            // verbose results?
            verbose: true,
            autoSaveTime : 0,
            main_width: this.canvas.domElement.width,
            main_height: this.canvas.domElement.height,
            sidebar_width: 300,
            pixel_ratio : this.canvas.pixel_ratio[0]
          });

          this.canvas.capturer.baseFilename = this.canvas.capturer.filename = new Date().toGMTString();
          this.canvas.capturer.start();
          this.canvas.capturer_recording = true;
          // Force render a frame
          // Canvas might not render
          // this.canvas.start_animation(0);
        }else{
          this.canvas.capturer_recording = false;
          if(this.canvas.capturer){
            this.canvas.capturer.stop();
            this.canvas.capturer.save();
            // this.canvas.capturer.incoming = false;
          }
        }


      });

    this.gui.addController('Screenshot', () => {

      const _d = new Date().toJSON();
      // const doc = this.canvas.mapToPDF();

      const glCanvas = this.canvas.main_renderer.domElement,
            pixelRatio = this.canvas.main_renderer.getPixelRatio();
      let totalHeight = glCanvas.height,
          sideWidth = this.canvas.sideCanvasEnabled ? Math.floor( this.canvas.side_width * pixelRatio ) : 0,
          sideHeight = sideWidth - pixelRatio,
          totalWidth = glCanvas.width + sideWidth,
          mainWidth = totalWidth - sideWidth;
      const pdf_wrapper = new PDFContext( totalWidth, totalHeight );

      pdf_wrapper.set_font_color( this.canvas.foreground_color );

      // Clear the whole canvas
      // copy the main_renderer context
      pdf_wrapper.background_color = this.canvas.background_color;

      this.canvas.main_renderer.clear();
      this.canvas.main_renderer.render( this.canvas.scene, this.canvas.mainCamera );
      pdf_wrapper.draw_image( glCanvas, sideWidth, 0, mainWidth, totalHeight );

      // draw side panels
      if( this.canvas.sideCanvasEnabled ) {
        this.canvas.sideCanvasList.axial.render();
        pdf_wrapper.draw_image(
          this.canvas.sideCanvasList.axial.renderer.domElement,
          0, 0, sideWidth, sideWidth
        );

        this.canvas.sideCanvasList.sagittal.render();
        pdf_wrapper.draw_image(
          this.canvas.sideCanvasList.sagittal.renderer.domElement,
          0, sideHeight, sideWidth, sideWidth
        );

        this.canvas.sideCanvasList.coronal.render();
        pdf_wrapper.draw_image(
          this.canvas.sideCanvasList.coronal.renderer.domElement,
          0, sideHeight * 2, sideWidth, sideWidth
        );

        const titleLineHeight = Math.round( 15 * pixelRatio );
        pdf_wrapper.set_font_color( "#e2e2e2" );
        pdf_wrapper.set_font( titleLineHeight );
        pdf_wrapper.fill_text(
          this.canvas.sideCanvasList.axial._headerText,
          titleLineHeight, 0 + titleLineHeight
        );
        pdf_wrapper.fill_text(
          this.canvas.sideCanvasList.sagittal._headerText,
          titleLineHeight, sideHeight + titleLineHeight
        );
        pdf_wrapper.fill_text(
          this.canvas.sideCanvasList.coronal._headerText,
          titleLineHeight, sideHeight * 2 + titleLineHeight
        );


      }

      // rendering title, legend, ...
      this.canvas.renderTitle( 0, 0, totalWidth, totalHeight, pdf_wrapper );
      this.canvas.renderTimestamp( 0, 0, totalWidth, totalHeight, pdf_wrapper );
      this.canvas.renderLegend( 0, 0, totalWidth, totalHeight, pdf_wrapper );
      this.canvas.renderSelectedObjectInfo( 0, 0, totalWidth, totalHeight, pdf_wrapper );


      // Draw legend on the right side
      // this.canvas._draw_legend( results, 0, 0, _width, _height, pdf_wrapper );

      // try {
      //   this.canvas._draw_video( results, _width, _height, pdf_wrapper );
      // } catch (e) {}


      pdf_wrapper.renderTarget.save(`[threeBrain] ${_d}.pdf`);
    }, {folder_name: folder_name });

    this.gui.addController('Download GLTF', async () => {
      const scene = this.canvas.cloneForExporter();
      exportScene(
        scene,
        "GLB",
        {
          maxTextureSize: this.canvas.main_renderer.capabilities.maxTextureSize,
        }
      );
    });

  };

  return( ViewerControlCenter );

}

export { registerPresetRecorder };
