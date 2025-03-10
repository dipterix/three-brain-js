import jsPDF from 'jspdf';
// var jsPDF = require('jspdf');
// window.jsPDF = jsPDF;

class PDFContext {
  constructor( width, height ){
    this.width = width,
    this.height = height;

    this.renderTarget = new jsPDF({
      orientation : "landscape",
      unit : "pt",
      compress : true,
      hotfixes: ["px_scaling"],
      format: [this.width, this.height]
    });

    // 'landscape', 'pt', [this.width, this.height], true, false);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.context = this.canvas.getContext('2d');
    this._video_canvas = document.createElement('canvas');
    this._video_context = this._video_canvas.getContext('2d');

    this.background_color = '#ffffff'; // white background
    this.foreground_color = '#000000';

    this.font_style = 'Courier';
  }

  /**
   * parameter type is ignored as only limited fonts are supported
   */
  set_font( size, type, bold = false ){
    // TODO: check font
    // this.font_type = type || this.font_type;
    this.renderTarget.setFontSize( size );
    // this.renderTarget.setFont( this.font_type );
    const font_weight = bold ? "bold" : "normal";
    this.renderTarget.setFont("courier", font_weight)
  }

  set_font_color( color ){
    this.foreground_color = color;
    this.renderTarget.setTextColor( this.foreground_color );
  }

  fill_text( ss, x, y ){
    this.renderTarget.text( ss, x, y );
  }

  fill_rect( color, x, y, w, h ){
    this.renderTarget.setFillColor( color );
    this.renderTarget.rect( x, y, w, h, 'F' );
  }

  draw_image( el, x, y, w, h ){
    this.canvas.width = w;
    this.canvas.height = h;
    this.context.clearRect(0, 0, w, h);
    this.context.drawImage( el, 0, 0, w, h);
    this.renderTarget.addImage( this.canvas, 'PNG', x, y, w, h );
  }

  draw_video( el, x, y, w, h ){
    if( el.currentTime === 0 || el.ended ){ return; }

    this._video_canvas.width = w;
    this._video_canvas.height = h;
    this._video_context.drawImage( el, 0, 0, w, h );

    this.renderTarget.addImage( this._video_canvas, 'PNG', x, y, w, h );
  }

  fill_gradient(  grd, x, y, w, h ){
    this.canvas.width = x + w;
    this.canvas.height = y + h;
    this.context.fillStyle = grd;
    this.context.fillRect( x, y, w, h );

    const newCanvas = document.createElement('canvas');
    // set its dimensions
    newCanvas.width = w;
    newCanvas.height = h;
    newCanvas
      .getContext('2d')
      .drawImage(this.canvas, x, y, w, h, 0, 0, w, h);


    this.renderTarget.addImage( newCanvas, 'PNG', x, y, w, h );
  }

  start_draw_line(){
    // this.renderTarget.beginPath();
  }

  stroke_line(){
    // this.renderTarget.stroke();
  }

  draw_line( paths ){
    this.renderTarget.setDrawColor( this.foreground_color );
    for(let ii = 0; ii < paths.length - 1; ii++ ){
      this.renderTarget.lines(
        [[
          paths[ii+1][0] - paths[ii][0],
          paths[ii+1][1] - paths[ii][1]
        ]], paths[ii][0], paths[ii][1],
        [1,1], 'S', false
      );
    }
  }
}

class CanvasContext2D {
  constructor( canvas, pixel_ratio = 1.0 ){
    this.canvas = canvas;
    this.context = canvas.getContext('2d');

    this.pixel_ratio = pixel_ratio;

    this.background_color = '#ffffff'; // white background
    this.foreground_color = '#000000';
    this.context.fillStyle = this.background_color;
    // Draw messages
    this.font_type = 'Courier New, monospace';
    this._lineHeight_title = Math.round( 25 * this.pixel_ratio );
    this._fontSize_title = Math.round( 20 * this.pixel_ratio );
    this._lineHeight_normal = Math.round( 25 * this.pixel_ratio );
    this._fontSize_normal = Math.round( 15 * this.pixel_ratio );
    this._lineHeight_small = Math.round( 15 * this.pixel_ratio );
    this._fontSize_small = Math.round( 10 * this.pixel_ratio );

  }

  set_font( size, type, bold = false ){
    this.font_type = type || this.font_type;
    if( bold ){
      this.context.font = `bold ${ size }px ${ this.font_type }`;
    } else {
      this.context.font = `${ size }px ${ this.font_type }`;
    }

  }

  set_font_color( color ){
    this.foreground_color = color;
    this.context.fillStyle = this.foreground_color;
  }

  fill_text( ss, x, y ){
    this.context.fillText( ss , x, y );
  }

  fill_rect( color, x, y, w, h ){
    this.context.fillStyle = color;
    this.context.fillRect( x, y, w, h );
  }

  draw_image( el, x, y, w, h ){
    this.context.drawImage( el, x, y, w, h );
  }

  fill_gradient(  grd, x, y, w, h ){
    this.context.fillStyle = grd;
    this.context.fillRect( x, y, w, h );
  }

  start_draw_line(){
    this.context.beginPath();
  }

  stroke_line(){
    this.context.stroke();
  }

  draw_line( paths, start = true, stroke = true ){
    this.context.moveTo( paths[0][0], paths[0][1] );
    for(let ii = 1; ii < paths.length; ii++ ){
      this.context.lineTo( paths[ii][0], paths[ii][1] );
    }
  }

  draw_video( el, x, y, w, h ){
    if( el.currentTime === 0 || el.ended ){ return; }
    this.context.drawImage( el, x, y, w, h );
  }

}

export { CanvasContext2D, PDFContext };
