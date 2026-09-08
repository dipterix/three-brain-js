import { decompressSync } from 'fflate';

/**
 * Reader for AFNI/SUMA NIML surface datasets (`.niml.dset`).
 *
 * Ported from the `ieegio` R package (https://github.com/dipterix/ieegio):
 * `R/niml.R` for the container, `as_ieegio_surface.ieegio_niml` in
 * `R/as_ieegio_surface.R` for the surface mapping. All NIML storage forms are
 * handled -- plain text, `binary.lsbfirst`, `binary.msbfirst`, `base64.*` --
 * and the file itself may be gzip compressed.
 *
 * The parsed object mimics `FreeSurferNodeValues` (continuous data) or
 * `FreeSurferAnnot` (labeled data) so `SurfaceMeasurementHandler` and
 * `SurfaceAnnotationHandler` pick it up without any changes.
 */

// ---------- type table -------------------------------------------------------

// `size` is the number of bytes one value occupies in binary/base64 form;
// `nToken` is the number of whitespace-separated tokens one value occupies in
// text form. String/Line have no fixed binary width (AFNI forces text mode
// whenever an element carries one), hence `size = NaN`.
const NIML_DATATYPES = {
  byte    : { what : "integer",   size : 1,   signed : false, nToken : 1 },
  short   : { what : "integer",   size : 2,   signed : true,  nToken : 1 },
  int     : { what : "integer",   size : 4,   signed : true,  nToken : 1 },
  float   : { what : "double",    size : 4,   signed : true,  nToken : 1 },
  double  : { what : "double",    size : 8,   signed : true,  nToken : 1 },
  complex : { what : "complex",   size : 8,   signed : true,  nToken : 2 },
  rgb     : { what : "rgb",       size : 3,   signed : false, nToken : 3 },
  rgba    : { what : "rgb",       size : 4,   signed : false, nToken : 4 },
  string  : { what : "character", size : NaN, signed : null,  nToken : 1 },
  line    : { what : "character", size : NaN, signed : null,  nToken : 1 },
};

// Single-letter aliases are case-sensitive: `s` is short but `S` is String,
// `r` is rgb but `R` is RGBA.
const NIML_DATATYPE_ALIAS = {
  b : "byte", s : "short", i : "int", f : "float", d : "double",
  c : "complex", r : "rgb", R : "rgba", S : "string", L : "line",
};

function nimlTypeName( t ) {
  if( typeof t !== "string" || !t.length ) {
    throw new Error("NIMLDset: NIML data type must be a non-empty string");
  }
  const name = ( t.length === 1 ) ? NIML_DATATYPE_ALIAS[ t ] : t.toLowerCase();
  if( name === undefined || NIML_DATATYPES[ name ] === undefined ) {
    throw new Error(`NIMLDset: unsupported NIML data type: ${ t }`);
  }
  return name;
}

// "3*float" -> ["float","float","float"];  "int,float" -> ["int","float"]
function nimlTypeNames( s ) {
  const parts = s.replace(/\s/g, "").split(/[,.]/).filter( p => p.length > 0 );
  const out = [];
  for( const p of parts ) {
    const m = /^([0-9]+)\*?(.+)$/.exec( p );
    if( m ) {
      const name = nimlTypeName( m[ 2 ] );
      const rep = parseInt( m[ 1 ] );
      for( let i = 0; i < rep; i++ ) { out.push( name ); }
    } else {
      out.push( nimlTypeName( p ) );
    }
  }
  return out;
}

// `ni_dimen` may be comma-separated ("144,2"); the row count is the product.
function nimlDimen( s ) {
  if( typeof s !== "string" ) { return NaN; }
  let n = 1;
  for( const p of s.split(",") ) {
    const v = parseFloat( p );
    if( isNaN( v ) ) { return NaN; }
    n *= v;
  }
  return n;
}

// ---------- base64 -----------------------------------------------------------

// NIML base64 payloads use the standard alphabet and are wrapped at 72
// columns, so anything outside the alphabet is skipped rather than decoded.
const B64_LOOKUP = new Uint8Array( 256 ).fill( 255 );
{
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for( let i = 0; i < chars.length; i++ ) {
    B64_LOOKUP[ chars.charCodeAt( i ) ] = i;
  }
}

function nimlBase64Decode( bytes ) {
  const n = bytes.length;
  const vals = new Uint8Array( n );
  let k = 0;
  for( let i = 0; i < n; i++ ) {
    const v = B64_LOOKUP[ bytes[ i ] ];
    if( v !== 255 ) { vals[ k++ ] = v; }
  }
  const outLength = Math.floor( k * 3 / 4 );
  const out = new Uint8Array( outLength );
  let o = 0;
  for( let i = 0; i + 1 < k; i += 4 ) {
    const b0 = vals[ i ], b1 = vals[ i + 1 ], b2 = vals[ i + 2 ], b3 = vals[ i + 3 ];
    if( o < outLength ) { out[ o++ ] = ( ( b0 << 2 ) | ( b1 >> 4 ) ) & 255; }
    if( i + 2 < k && o < outLength ) { out[ o++ ] = ( ( b1 << 4 ) | ( b2 >> 2 ) ) & 255; }
    if( i + 3 < k && o < outLength ) { out[ o++ ] = ( ( b2 << 6 ) | b3 ) & 255; }
  }
  return out;
}

// ---------- header parsing ---------------------------------------------------

const textDecoder = new TextDecoder();

function decodeRange( buf, from, toExclusive ) {
  if( toExclusive <= from ) { return ""; }
  return textDecoder.decode( buf.subarray( from, toExclusive ) );
}

const NIML_ATTR_PATTERN = /([A-Za-z_][A-Za-z0-9_.\-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

function nimlAttrs( hdr ) {
  const out = {};
  NIML_ATTR_PATTERN.lastIndex = 0;
  let m;
  while( ( m = NIML_ATTR_PATTERN.exec( hdr ) ) !== null ) {
    // keep the first occurrence, matching the reference implementation
    if( out[ m[ 1 ] ] !== undefined ) { continue; }
    out[ m[ 1 ] ] = m[ 2 ].replace(/^["']/, "").replace(/["']$/, "");
  }
  return out;
}

// Unescape the five XML entities NIML uses. `&amp;` must come last, otherwise
// a literal "&amp;lt;" would decode twice.
function nimlUnescape( s ) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Locate the "</" that closes a text/base64 element, skipping any that falls
// inside a quoted string value: a closing tag is only real when an even number
// of double quotes precedes it. Returns the index of the last payload byte.
function nimlTextEnd( buf, start ) {
  const n = buf.length;
  let quotes = 0;
  for( let i = start; i + 1 < n; i++ ) {
    const b = buf[ i ];
    if( b === 34 ) { quotes++; continue; }         // '"'
    if( b === 60 && buf[ i + 1 ] === 47 && ( quotes % 2 ) === 0 ) {   // "</"
      return i - 1;
    }
  }
  return n - 1;
}

function findByte( buf, byte, from ) {
  for( let i = from; i < buf.length; i++ ) {
    if( buf[ i ] === byte ) { return i; }
  }
  return -1;
}

// ---------- element walk -----------------------------------------------------

// Walk the file and return the element tree, preserving `ni_group` nesting.
// Nesting matters: an AFNI_labeltable group carries its own SPARSE_DATA and
// AFNI_atr elements that must not be confused with the dataset's own.
function nimlElements( buf ) {
  const n = buf.length;
  let pos = 0;

  const root = { name : "", attributes : {}, isGroup : true, children : [] };
  const stack = [ root ];

  while( pos < n ) {
    const lt = findByte( buf, 60, pos );      // '<'
    if( lt < 0 ) { break; }

    // "</..." closing tag. Only pop when the name matches the innermost open
    // group: data elements such as </SPARSE_DATA> also land here, and popping
    // on those would close the enclosing group far too early.
    if( lt + 1 < n && buf[ lt + 1 ] === 47 ) {
      const gt = findByte( buf, 62, lt );
      if( gt < 0 ) { break; }
      const closeName = decodeRange( buf, lt + 2, gt ).replace(/\s/g, "");
      const depth = stack.length;
      if( depth > 1 && closeName === stack[ depth - 1 ].name ) {
        const closed = stack.pop();
        stack[ stack.length - 1 ].children.push( closed );
      }
      pos = gt + 1;
      continue;
    }

    // find the header's ">", skipping any that sits inside a quoted value
    let i = lt + 1;
    let quote = 0;
    while( i < n ) {
      const b = buf[ i ];
      if( quote !== 0 ) {
        if( b === quote ) { quote = 0; }
      } else if( b === 34 || b === 39 ) {
        quote = b;
      } else if( b === 62 ) {
        break;
      }
      i++;
    }
    if( i >= n ) { break; }

    const hdr = decodeRange( buf, lt, i + 1 );
    const nameMatch = /^<([A-Za-z][A-Za-z0-9_.\-]*)/.exec( hdr );
    const name = nameMatch ? nameMatch[ 1 ] : "";
    const attributes = nimlAttrs( hdr );
    pos = i + 1;

    const form = ( attributes.ni_form === undefined ) ? "text" : attributes.ni_form;

    if( /\/>$/.test( hdr ) ) {
      // empty element: no payload, and it never opens a group
      stack[ stack.length - 1 ].children.push({
        name : name, attributes : attributes, isGroup : false,
        form : form, start : -1, end : -2
      });
      continue;
    }
    if( form === "ni_group" ) {
      // group open: becomes the parent for everything until its closing tag
      stack.push({ name : name, attributes : attributes, isGroup : true, children : [] });
      continue;
    }
    if( attributes.ni_type === undefined ) { continue; }

    const start = i + 1;
    let end;

    if( /^binary/.test( form ) ) {
      // length is known, so it is computed rather than scanned for
      if( attributes.ni_dimen === undefined ) {
        throw new Error(
          `NIMLDset: element <${ name }> is binary but has no 'ni_dimen'; its length cannot be determined.`
        );
      }
      const nrows = nimlDimen( attributes.ni_dimen );
      const sizes = nimlTypeNames( attributes.ni_type ).map( t => NIML_DATATYPES[ t ].size );
      if( sizes.some( s => !isFinite( s ) ) ) {
        throw new Error(
          `NIMLDset: element <${ name }> declares String/Line data in '${ form }' form, which has no fixed byte width.`
        );
      }
      const rowSize = sizes.reduce( ( x, y ) => x + y, 0 );
      end = start + nrows * rowSize - 1;
    } else {
      end = nimlTextEnd( buf, start );
    }

    end = Math.min( end, n - 1 );
    stack[ stack.length - 1 ].children.push({
      name : name, attributes : attributes, isGroup : false,
      form : form, start : start, end : end
    });
    pos = end + 1;
  }

  // anything still open at EOF is closed implicitly
  while( stack.length > 1 ) {
    const closed = stack.pop();
    stack[ stack.length - 1 ].children.push( closed );
  }

  return root.children;
}

// ---------- turn one element into values -------------------------------------

// Text payloads are whitespace-separated, with String values optionally
// wrapped in single or double quotes.
const NIML_TOKEN_PATTERN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g;

function nimlTokenize( txt ) {
  return txt.match( NIML_TOKEN_PATTERN ) || [];
}

function nimlStripQuotes( x ) {
  if( ( x.startsWith('"') && x.endsWith('"') ) ||
      ( x.startsWith("'") && x.endsWith("'") ) ) {
    if( x.length >= 2 ) { return x.substring( 1, x.length - 1 ); }
  }
  return x;
}

function toHexColor( r, g, b, a ) {
  const hex = ( v ) => {
    const i = Math.max( 0, Math.min( 255, Math.round( v ) ) );
    return i.toString( 16 ).padStart( 2, "0" );
  };
  const base = `#${ hex( r ) }${ hex( g ) }${ hex( b ) }`;
  return ( a === undefined ) ? base.toUpperCase() : `${ base }${ hex( a ) }`.toUpperCase();
}

function nimlColumnNames( element, ncol ) {
  const names = [];
  for( let i = 0; i < ncol; i++ ) { names.push( `V${ i + 1 }` ); }
  const labs = element.attributes.COLMS_LABS;
  if( labs !== undefined ) {
    const parsed = nimlUnescape( labs ).split(";").map( s => s.trim() );
    // only trust the labels when they line up with the actual column count
    if( parsed.length === ncol && parsed.every( s => s.length > 0 ) ) {
      return parsed;
    }
  }
  return names;
}

function emptyColumn( type ) {
  switch ( NIML_DATATYPES[ type ].what ) {
    case "integer" : return new Int32Array( 0 );
    case "double"  : return new Float64Array( 0 );
    default        : return [];
  }
}

function nimlValues( element, buf ) {
  const types = nimlTypeNames( element.attributes.ni_type );
  const ncol = types.length;
  const info = types.map( t => NIML_DATATYPES[ t ] );
  const perColumn = info.map( k => k.nToken );
  const form = element.form;
  const isBinary = /^binary/.test( form );
  const isBase64 = /^base64/.test( form );

  let nrow = NaN;
  if( element.attributes.ni_dimen !== undefined ) {
    nrow = nimlDimen( element.attributes.ni_dimen );
  }

  if( element.start < 0 || element.end < element.start ) {
    return {
      names : nimlColumnNames( element, ncol ),
      columns : types.map( emptyColumn ),
      nrow : 0
    };
  }

  // ---- text -----------------------------------------------------------------
  if( !isBinary && !isBase64 ) {
    const txt = decodeRange( buf, element.start, element.end + 1 );
    const hasTextColumn = types.some( t => t === "string" || t === "line" );
    const totalPerRow = perColumn.reduce( ( x, y ) => x + y, 0 );

    let tokens;
    if( hasTextColumn ) {
      tokens = nimlTokenize( txt );
      if( ncol === 1 && nrow === 1 && tokens.length > totalPerRow ) {
        // an unquoted multi-word string: the whole payload is one value
        tokens = [ nimlUnescape( nimlStripQuotes( txt.trim() ) ) ];
      }
    } else {
      tokens = txt.split(/\s+/).filter( s => s.length > 0 );
    }

    if( isNaN( nrow ) ) {
      nrow = Math.floor( tokens.length / totalPerRow );
    }
    if( tokens.length < nrow * totalPerRow ) {
      throw new Error(
        `NIMLDset: element <${ element.name }> declares ${ nrow } rows but only ` +
        `${ Math.floor( tokens.length / totalPerRow ) } could be parsed.`
      );
    }

    // tokens are laid out row by row, each row holding every column in order
    const offsets = [ 0 ];
    for( let j = 0; j < ncol; j++ ) { offsets.push( offsets[ j ] + perColumn[ j ] ); }

    const columns = types.map( ( type, j ) => {
      const at = ( r, s ) => tokens[ r * totalPerRow + offsets[ j ] + s ];
      switch ( type ) {
        case "string" :
        case "line" : {
          const out = new Array( nrow );
          for( let r = 0; r < nrow; r++ ) {
            out[ r ] = nimlUnescape( nimlStripQuotes( at( r, 0 ) ) );
          }
          return out;
        }
        case "rgb" : {
          const out = new Array( nrow );
          for( let r = 0; r < nrow; r++ ) {
            out[ r ] = toHexColor( +at( r, 0 ), +at( r, 1 ), +at( r, 2 ) );
          }
          return out;
        }
        case "rgba" : {
          const out = new Array( nrow );
          for( let r = 0; r < nrow; r++ ) {
            out[ r ] = toHexColor( +at( r, 0 ), +at( r, 1 ), +at( r, 2 ), +at( r, 3 ) );
          }
          return out;
        }
        case "complex" : {
          const out = new Array( nrow );
          for( let r = 0; r < nrow; r++ ) {
            out[ r ] = { re : +at( r, 0 ), im : +at( r, 1 ) };
          }
          return out;
        }
        default : {
          const isInteger = info[ j ].what === "integer";
          const out = isInteger ? new Int32Array( nrow ) : new Float64Array( nrow );
          for( let r = 0; r < nrow; r++ ) {
            const v = Number( at( r, 0 ) );
            out[ r ] = isInteger ? ( isNaN( v ) ? 0 : Math.trunc( v ) ) : v;
          }
          return out;
        }
      }
    });

    return { names : nimlColumnNames( element, ncol ), columns : columns, nrow : nrow };
  }

  // ---- binary / base64 ------------------------------------------------------
  if( isNaN( nrow ) ) {
    throw new Error(
      `NIMLDset: element <${ element.name }> is '${ form }' but has no 'ni_dimen'; ` +
      `its length cannot be determined.`
    );
  }

  let bytes = buf.subarray( element.start, element.end + 1 );
  if( isBase64 ) {
    bytes = nimlBase64Decode( bytes );
  }

  // NIML swaps only when the declared order differs from the writer's native
  // order; with no suffix at all, native order (little endian) is implied.
  const littleEndian = !/msbfirst/.test( form );

  const sizes = info.map( k => k.size );
  const rowSize = sizes.reduce( ( x, y ) => x + y, 0 );
  const offsets = [ 0 ];
  for( let j = 0; j < ncol; j++ ) { offsets.push( offsets[ j ] + sizes[ j ] ); }

  const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
  const available = Math.floor( bytes.byteLength / rowSize );
  const rows = Math.min( nrow, available );

  // binary payloads are row-interleaved: every row holds all columns in order
  const readValue = ( type, offset ) => {
    switch ( type ) {
      case "byte"   : return view.getUint8( offset );
      case "short"  : return view.getInt16( offset, littleEndian );
      case "int"    : return view.getInt32( offset, littleEndian );
      case "float"  : return view.getFloat32( offset, littleEndian );
      case "double" : return view.getFloat64( offset, littleEndian );
      default       : return NaN;
    }
  };

  const columns = types.map( ( type, j ) => {
    const base = offsets[ j ];
    switch ( type ) {
      case "rgb" : {
        const out = new Array( nrow );
        for( let r = 0; r < rows; r++ ) {
          const o = base + r * rowSize;
          out[ r ] = toHexColor( view.getUint8( o ), view.getUint8( o + 1 ), view.getUint8( o + 2 ) );
        }
        return out;
      }
      case "rgba" : {
        const out = new Array( nrow );
        for( let r = 0; r < rows; r++ ) {
          const o = base + r * rowSize;
          out[ r ] = toHexColor(
            view.getUint8( o ), view.getUint8( o + 1 ),
            view.getUint8( o + 2 ), view.getUint8( o + 3 )
          );
        }
        return out;
      }
      case "complex" : {
        const out = new Array( nrow );
        for( let r = 0; r < rows; r++ ) {
          const o = base + r * rowSize;
          out[ r ] = {
            re : view.getFloat32( o, littleEndian ),
            im : view.getFloat32( o + 4, littleEndian )
          };
        }
        return out;
      }
      case "string" :
      case "line" :
        throw new Error(
          `NIMLDset: element <${ element.name }> declares String/Line data in '${ form }' form.`
        );
      default : {
        const isInteger = info[ j ].what === "integer";
        const out = isInteger ? new Int32Array( nrow ) : new Float64Array( nrow );
        for( let r = 0; r < rows; r++ ) {
          out[ r ] = readValue( type, base + r * rowSize );
        }
        return out;
      }
    }
  });

  return { names : nimlColumnNames( element, ncol ), columns : columns, nrow : nrow };
}

// ---------- tree accessors ---------------------------------------------------

// Depth-first search for elements by name. `recursive = false` restricts the
// search to the immediate children, which is how the dataset's own SPARSE_DATA
// is told apart from the one inside an AFNI_labeltable group.
function nimlFind( x, names, recursive = true, groups = false ) {
  const nodes = ( x && !Array.isArray( x ) && x.children ) ? x.children : x;
  const out = [];
  if( !nodes ) { return out; }
  for( const node of nodes ) {
    if( node.isGroup ) {
      if( groups && names.includes( node.name ) ) { out.push( node ); }
      if( recursive ) {
        out.push( ...nimlFind( node.children, names, true, groups ) );
      }
    } else if( !groups && names.includes( node.name ) ) {
      out.push( node );
    }
  }
  return out;
}

// AFNI stores an element's column labels in a *sibling* `AFNI_atr` named
// COLMS_LABS rather than on the element itself.
function nimlSiblingLabs( group, ncol ) {
  for( const a of nimlFind( group, [ "AFNI_atr" ], false ) ) {
    if( a.attributes.atr_name !== "COLMS_LABS" ) { continue; }
    if( !a.value || !a.value.columns.length ) { continue; }
    const raw = a.value.columns[ 0 ][ 0 ];
    if( typeof raw !== "string" ) { continue; }
    const labs = raw.split(";").map( s => s.trim() ).filter( s => s.length > 0 );
    if( labs.length === ncol ) { return labs; }
  }
  return null;
}

// Locate the dataset group; a NIML file may or may not wrap its elements in an
// outer AFNI_dataset group.
function nimlDatasetRoot( nodes ) {
  for( const node of nodes ) {
    if( node.isGroup && nimlFind( node, [ "SPARSE_DATA", "DATA" ], false ).length ) {
      return node;
    }
  }
  return { name : "", attributes : {}, isGroup : true, children : nodes };
}

// ---------- label table ------------------------------------------------------

// SUMA additionally wraps label strings in escaped single quotes, so a decoded
// value can arrive as 'Unknown'. Strip only a symmetric pair.
function stripLabelQuotes( x ) {
  if( typeof x === "string" && x.length >= 2 && x.startsWith("'") && x.endsWith("'") ) {
    return x.substring( 1, x.length - 1 );
  }
  return x;
}

// Build the colour look-up from an AFNI_labeltable group. Its SPARSE_DATA holds
// "R;G;B;A;key;name" with R/G/B/A as floating point values in [0, 1].
function nimlLabelTable( group ) {
  const els = nimlFind( group, [ "SPARSE_DATA", "DATA" ], false );
  if( !els.length ) { return null; }

  const table = els[ 0 ].value;
  const ncol = table.columns.length;
  const labs = nimlSiblingLabs( group, ncol );
  const names = labs ? labs : table.names;

  const pick = ( name, index ) => {
    const at = names.indexOf( name );
    if( at >= 0 ) { return table.columns[ at ]; }
    if( ncol > index ) { return table.columns[ index ]; }
    return null;
  };

  const key = pick( "key", 4 );
  const label = pick( "name", 5 );
  if( key === null || label === null ) { return null; }

  const red = pick( "R", 0 );
  const green = pick( "G", 1 );
  const blue = pick( "B", 2 );
  const alpha = pick( "A", 3 );

  // AFNI pads label tables with repeated placeholder rows; keep the first row
  // per key so downstream look-ups stay unambiguous.
  const lut = new Map();
  const clamp01 = ( v ) => Math.max( 0, Math.min( 1, ( typeof v === "number" && !isNaN( v ) ) ? v : 0 ) );
  for( let i = 0; i < table.nrow; i++ ) {
    const k = Math.trunc( Number( key[ i ] ) );
    if( lut.has( k ) ) { continue; }
    lut.set( k, {
      label : stripLabelQuotes( String( label[ i ] ) ),
      r : Math.round( clamp01( red ? Number( red[ i ] ) : 0 ) * 255 ),
      g : Math.round( clamp01( green ? Number( green[ i ] ) : 0 ) * 255 ),
      b : Math.round( clamp01( blue ? Number( blue[ i ] ) : 0 ) * 255 ),
      a : Math.round( clamp01( alpha ? Number( alpha[ i ] ) : 1 ) * 255 ),
    });
  }
  return lut.size ? lut : null;
}

// ---------- the data class ---------------------------------------------------

class NIMLDset {

  constructor( data ) {
    this.isInvalid = true;
    this.isNIMLDset = true;
    if( !data ) { return; }

    let bytes = ( data instanceof Uint8Array ) ? data : new Uint8Array( data );
    if( bytes.length < 2 ) {
      throw new Error("NIMLDset: a NIML dataset cannot be less than 2 bytes.");
    }

    // the file may be gzip compressed
    if( bytes[ 0 ] === 31 && bytes[ 1 ] === 139 ) {
      bytes = decompressSync( bytes );
    }

    const nodes = nimlElements( bytes );
    for( const node of nodes ) { decodeNode( node, bytes ); }

    const dataset = nimlDatasetRoot( nodes );
    const elements = nimlFind( dataset, [ "SPARSE_DATA", "DATA" ], false );
    if( !elements.length ) {
      throw new Error("NIMLDset: file contains no SPARSE_DATA or DATA element.");
    }
    const table = elements[ 0 ].value;
    if( !table.columns.length || !table.nrow ) {
      throw new Error("NIMLDset: the dataset is empty.");
    }

    // node indices are 0-based in NIML; when present, the dataset is sparse
    let nodeIndex = null;
    const indexElements = nimlFind( dataset, [ "INDEX_LIST" ], false );
    if( indexElements.length && indexElements[ 0 ].value.nrow ) {
      nodeIndex = indexElements[ 0 ].value.columns[ 0 ];
    }

    const labelGroups = nimlFind( dataset, [ "AFNI_labeltable" ], true, true );
    const labelTable = labelGroups.length ? nimlLabelTable( labelGroups[ 0 ] ) : null;

    // Resolve the data type from the object, not from the values: `dset_type`
    // first, then whether the file carries a label table.
    const datasetType = dataset.attributes.dset_type;
    const isAnnotation =
      ( typeof datasetType === "string" && /label|roi/i.test( datasetType ) ) ||
      labelTable !== null;

    // how many vertices the dataset covers
    let nVertices = table.nrow;
    if( nodeIndex ) {
      let maxIndex = -1;
      for( let i = 0; i < nodeIndex.length; i++ ) {
        if( nodeIndex[ i ] > maxIndex ) { maxIndex = nodeIndex[ i ]; }
      }
      nVertices = maxIndex + 1;
    }
    if( nVertices <= 0 ) {
      throw new Error("NIMLDset: the dataset covers no vertices.");
    }

    this.nVertices = nVertices;
    this.dataNames = table.names;

    if( isAnnotation ) {
      this._initializeAnnotation( table, nodeIndex, labelTable );
    } else {
      this._initializeMeasurement( table, nodeIndex );
    }

    this.isInvalid = false;
  }

  // continuous data: mimics FreeSurferNodeValues so SurfaceMeasurementHandler
  // and free.js `setColors` can consume it unchanged
  _initializeMeasurement( table, nodeIndex ) {
    const nVertices = this.nVertices;
    const nFrames = table.columns.length;

    const vertexData = new Float32Array( nFrames * nVertices );
    let min = Infinity, max = -Infinity;

    for( let f = 0; f < nFrames; f++ ) {
      const column = table.columns[ f ];
      const offset = f * nVertices;
      for( let r = 0; r < table.nrow; r++ ) {
        const target = nodeIndex ? nodeIndex[ r ] : r;
        if( target < 0 || target >= nVertices ) { continue; }
        const v = Number( column[ r ] );
        vertexData[ offset + target ] = v;
        // sparse datasets leave gaps at zero; the range must reflect the data
        if( v < min ) { min = v; }
        if( v > max ) { max = v; }
      }
    }

    if( !isFinite( min ) || !isFinite( max ) ) { min = 0; max = 0; }

    this.nFrames = nFrames;
    this.vertexData = vertexData;
    this._frameData = new Float32Array( nVertices );
    this.min = min;
    this.max = max;
    this.isSurfaceMeasurement = true;

    if( nFrames > 0 ) { this.setFrame( 0 ); }
  }

  // labeled data: mimics FreeSurferAnnot, i.e. RGBA bytes per vertex
  _initializeAnnotation( table, nodeIndex, labelTable ) {
    const nVertices = this.nVertices;
    const keys = table.columns[ 0 ];

    const vertexColor = new Uint8Array( nVertices * 4 );
    const vertexKeys = new Int32Array( nVertices );
    const labels = new Map();

    for( let r = 0; r < table.nrow; r++ ) {
      const target = nodeIndex ? nodeIndex[ r ] : r;
      if( target < 0 || target >= nVertices ) { continue; }
      const key = Math.trunc( Number( keys[ r ] ) );
      const entry = labelTable ? labelTable.get( key ) : undefined;
      const at = target * 4;
      vertexKeys[ target ] = key;
      if( entry ) {
        vertexColor[ at ] = entry.r;
        vertexColor[ at + 1 ] = entry.g;
        vertexColor[ at + 2 ] = entry.b;
        vertexColor[ at + 3 ] = entry.a;
        if( !labels.has( key ) ) { labels.set( key, entry.label ); }
      } else {
        // an annotation without a table entry: black, so the node stays visible
        vertexColor[ at + 3 ] = 255;
        if( !labels.has( key ) ) { labels.set( key, String( key ) ); }
      }
    }

    this.vertexColor = vertexColor;
    this.vertexKeys = vertexKeys;
    this.labels = labels;
    this.isSurfaceAnnotation = true;
  }

  setFrame( frame ) {
    frame = parseInt( frame );
    if( isNaN( frame ) || frame < 0 || frame >= this.nFrames ) {
      throw 'NIMLDset: Invalid frame';
    }
    const offset = frame * this.nVertices;
    for( let i = 0; i < this.nVertices; i++ ) {
      this._frameData[ i ] = this.vertexData[ offset + i ];
    }
    return this._frameData;
  }

  dispose() {
    this.vertexData = NaN;
    this._frameData = NaN;
    this.vertexColor = NaN;
    this.vertexKeys = NaN;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    this.isNIMLDset = true;
    this.nVertices = el.nVertices;
    this.dataNames = el.dataNames;

    if( el.isSurfaceAnnotation ) {
      this.vertexColor = el.vertexColor;
      this.vertexKeys = el.vertexKeys;
      this.labels = el.labels;
      this.isSurfaceAnnotation = true;
    } else {
      this.nFrames = el.nFrames;
      this.vertexData = el.vertexData;
      this._frameData = el._frameData;
      this.min = el.min;
      this.max = el.max;
      this.isSurfaceMeasurement = true;
    }
    return this;
  }

}

// decode every element's payload in place, depth first
function decodeNode( node, buf ) {
  if( node.isGroup ) {
    for( const child of node.children ) { decodeNode( child, buf ); }
    return;
  }
  node.value = nimlValues( node, buf );
  delete node.start;
  delete node.end;
}

export { NIMLDset, nimlElements, nimlValues, nimlFind };
