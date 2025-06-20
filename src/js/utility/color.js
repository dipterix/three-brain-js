import { Color } from 'three';

const _color = new Color();

function asColor( hex, c ) {

  if( !c || (typeof c !== 'object') || !c.isColor ) {
    throw TypeError('asColor: c must be a THREE.Color');
  }

  if( typeof hex === 'object' && hex ) {

    // assume hex = { r: ?, g: ?, b: ? }
    return c.copy( hex );

  }

  if( typeof hex === 'number' ) {

    // e.g.: hex = 0xccff99
    return c.set( hex );

  }

  if( typeof hex === 'string' ) {
    if ( hex.indexOf('#') !== 0 ) {
        hex = "#" + hex;
    }
    if ( hex.length > 7 ) {
      hex = hex.slice( 0 , 7 );
    }
    return c.setStyle( hex );
  }

  if( Array.isArray( hex ) ) {
    c.fromArray( hex );
    if ( hex.some( v => { return v > 1 ; }) ) {
      c.multiplyScalar( 1/ 255 );
    }
    return c;
  }

  throw TypeError('asColor: unknown input type.');
}


function invertColor ( c ) {

  c.r = 1 - c.r;
  c.g = 1 - c.g;
  c.b = 1 - c.b;

  return c;

};

// returns 0 for darkest dark and 1 for whitest white
function colorLuma ( c ) {
  // per ITU-R BT.709 ( if color luma < 0.4, then it's too dark?)

  // https://contrastchecker.online/color-relative-luminance-calculator
  const r = c.r <= 0.03928 ? c.r / 12.92 : ((c.r+0.055)/1.055) ^ 2.4;
  const g = c.g <= 0.03928 ? c.g / 12.92 : ((c.g+0.055)/1.055) ^ 2.4;
  const b = c.b <= 0.03928 ? c.b / 12.92 : ((c.b+0.055)/1.055) ^ 2.4;

  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}


function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;

  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(color * 255);
  };
  return [f(0), f(8), f(4)];
}

function randomColor( seedString ) {
  if( typeof seedString === 'string' ) {
    const seedstr = seedString
      .toLowerCase()
      .replace(/\bleft\b/g, 'lh')    // replace whole word "left"
      .replace(/\bright\b/g, 'lh')  // replace whole word "right"
      .replace(/[r]/g, 'l');
    const seed = hashString( seedstr );
    const rand = seededRandom(seed);
    const h = rand();     // Hue: 0-1
    const s = rand() + 0.6; // Saturation: 60–100%
    const l = rand() * 0.3 + 0.4; // Lightness: 40–70%
    return '#' + _color.setHSL(h, s, l).getHexString();
  }
  let color = Math.floor(Math.random()*16777215).toString(16);
  color = `#${ "0".repeat( 6 - color.length ) }${ color }`;
  return color;
}

function testColorString( s, randIfFail = false ) {
  let test = true;
  if( typeof s === "string" && s.length == 7 ) {
    for( let j = 1; j < 7; j++ ) {
      const c = s[ j ].toLowerCase();
      if( !"0123456789abcdef".includes(c) ) {
        test = false;
        break;
      }
    }
  } else {
    test = false;
  }

  if( test ) { return s; }

  if( randIfFail ) {
    if( typeof randIfFail === 'string' ) {
      return randomColor( randIfFail );
    }
    return randomColor();
  }
  return;
}

export { asColor , invertColor, colorLuma, randomColor, testColorString };
