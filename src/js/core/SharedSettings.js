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


function ensureObjectColorSettings( filename ) {
  const colorMap = SHARED_SETTINGS.OBJECT_COLORS;
  // assuming filename has been normalized
  const prefix = normalizeImageName( filename );
  if( !colorMap[ prefix ] ) {
    colorMap[ prefix ] = {
      single: getColorFromFilename( prefix ),
      discrete: "default",
      continuous: "rainbow",
    }
  }
  return colorMap[ prefix ];
}


export { SHARED_SETTINGS, ensureObjectColorSettings };
