import { Color } from 'three';
import { FileDataHandler } from './FileDataHandler.js';
import { ensureObjectColorSettings } from '../core/SharedSettings.js';
import { normalizeImageName } from '../utility/normalizeImageName.js';

/**
 *
 * data[0] -> {"VarName" : "col1", (optional) "" : 0.1 } // normalizedValue is optional
 */

class ElectrodeColorMapHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( !filename.toLowerCase().match(/colormap(\.csv|\.tsv)?$/g) ) {
      throw new Error("ElectrodeColorMapHandler: file name must end with `colormap`, `colormap.csv`, or `colormap.tsv`");
    }

    if( !Array.isArray(data) || data.length === 0 ) {
      throw new Error("ElectrodeColorMapHandler: empty color table");
    }
    const sample = data[ 0 ];
    if( !sample || typeof sample !== "object" ) {
      throw new Error("ElectrodeColorMapHandler: unknown electrode color settings");
    }

  }

  handleData( data, app, filename ) {
    super.handleData( data, app, filename );

    const palettes = {};
    const tmpColor = new Color();

    window.dddd = data;

    data.forEach(row => {
      if( !row ) { return; }

      for( let name in row ) {
        name = name.trim();
        if(name === "[none]" || name === "") { continue; }

        // Make sure if the color is invalid, skip
        let str = row[ name ];
        if( typeof str !== "string" ) { continue; }
        str = str.trim();
        switch(str.toLowerCase()) {
          case "":
          case "n/a":
          case "na":
          case "null":
          case "nan":
          case "undefined":
            continue;
        }
        tmpColor.set( NaN, NaN, NaN ).set( str );
        if( isNaN( tmpColor.r ) ) { continue; }

        // Add key palette
        if(!Array.isArray(palettes[ name ])) {
          palettes[ name ] = [];
        }
        const pal = palettes[ name ];
        pal.push( tmpColor.getHex() );
      }
    });

    for(let name in palettes) {
      const pal = palettes[ name ];
      if( pal.length === 0 ) { continue; }
      app.canvas.setColorMapControlColors(pal, name);
    }
    // this._updateColorMap( app );
  }

}

export { ElectrodeColorMapHandler };




