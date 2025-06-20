import { normalizeImageName, getColorFromFilename } from '../utility/normalizeImageName.js';
const SHARED_SETTINGS = {};

// ------- Color maps for objects -------------------------------------

SHARED_SETTINGS.OBJECT_COLORS = {
  "lh.pial" : {
    single : "#FFFFFF",
    discrete: "default",
    continuous: "BlueRed",
  },
  "rh.pial" : {
    single : "#FFFFFF",
    discrete: "default",
    continuous: "BlueRed",
  }
};


function ensureObjectColorSettings( filename, {
  defaultSingle = undefined,
  defaultDiscrete = 'default',
  defaultContinuous = 'rainbow'
} = {} ) {
  const colorMap = SHARED_SETTINGS.OBJECT_COLORS;
  // assuming filename has been normalized
  const prefix = normalizeImageName( filename );
  if( !colorMap[ prefix ] ) {
    let singleColor = getColorFromFilename( prefix );
    if( defaultSingle ) {
      if( typeof defaultSingle === 'string' ) {
        singleColor = getColorFromFilename( defaultSingle );
      } else if ( typeof defaultSingle === "object" && defaultSingle.isColor ) {
        singleColor = '#' + defaultSingle.getHexString();
      }
    }

    if( singleColor === '#000000' || singleColor === '#000' ) {
      singleColor = getColorFromFilename( prefix );
    }

    colorMap[ prefix ] = {
      single: singleColor,
      discrete: defaultDiscrete,
      continuous: defaultContinuous,
    }
  }
  return colorMap[ prefix ];
}


export { SHARED_SETTINGS, ensureObjectColorSettings };
