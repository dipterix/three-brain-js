import { randomColor, testColorString } from './color.js';

function normalizeImageName( fileName ) {
  return fileName.toLowerCase()
    .replaceAll(/\.(nii|nii\.gz|mgz|mgh)$/g, "")
    .replaceAll(/[ \(\)+\-\:]+/g, "_")
    .replaceAll(/[_]+$/g, "");
}


function getColorFromFilename( filename ) {

  if( typeof filename === "string" ) {
    filename = normalizeImageName( filename );
    if( filename.length >= 6 ) {
      const s = "#" + filename.substring(filename.length - 6);
      return testColorString( s, true );
    }
  }
  return randomColor();
}

export { normalizeImageName, getColorFromFilename }
