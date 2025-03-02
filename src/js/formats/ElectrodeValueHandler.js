import { FileDataHandler } from './FileDataHandler.js';

class ElectrodeValueHandler extends FileDataHandler {

  assertData( data, filename ) {

    if( !Array.isArray(data) || data.length === 0 ) {
      throw new Error("ElectrodeValueHandler: empty value table");
    }
    const sample = data[ 0 ];
    if( !sample || typeof sample !== "object" ) {
      throw new Error("ElectrodeValueHandler: unknown electrode value format");
    }

    if( sample['Electrode'] === undefined ) {
      throw new Error("ElectrodeValueHandler: electrode value must have `Electrode` channel as column name");
    }

  }

  handleData( data, app, filename ) {
    super.handleData( data, app, filename );
    app.updateElectrodeData({ data : data });
  }

}

export { ElectrodeValueHandler };
