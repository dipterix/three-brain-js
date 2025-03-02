import { FileDataHandler } from './FileDataHandler.js';
import { ensureObjectColorSettings } from '../core/SharedSettings.js';
import { normalizeImageName } from '../utility/normalizeImageName.js';

class DragNDropColorMapHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( !Array.isArray(data) || data.length === 0 ) {
      throw new Error("DragNDropColorMapHandler: empty value table");
    }
    const sample = data[ 0 ];
    if( !sample || typeof sample !== "object" ) {
      throw new Error("DragNDropColorMapHandler: unknown electrode value format");
    }

    if( sample['Filename'] === undefined || sample['Color'] === undefined ) {
      throw new Error("DragNDropColorMapHandler: Drag & Drop color table must have `Filename` and `Color` columns");
    }
  }

  handleData( data, app, filename ) {
    super.handleData( data, app, filename );

    data.forEach(el => {
      if(!el) { return; }
      const color = el["Color"];
      if ( typeof color === "string" && color.length === 7 ) {
        const fname = normalizeImageName( el["Filename"] );
        ensureObjectColorSettings( fname ).single = color;
      }
    });
    this._updateColorMap( app );
  }

}

export { DragNDropColorMapHandler };




