/**
 * Files embedded in the page itself, rather than fetched.
 *
 * `save_brain()` writes one self-contained HTML: every data file, and the web
 * worker, are base64'd into `<script type='text/plain' data-for='#<key>'>`
 * blocks, split into partitions so no single text node gets unwieldy. A page
 * like that is usually opened from disk, where its origin is opaque and nothing
 * can be fetched — so `#`-prefixed "URLs" are read from the document instead.
 *
 * Nothing here assumes a document: both bundles import this module, and the
 * worker bundle has no DOM.
 */

function embeddedBlockElements( key ) {
  if( typeof document === "undefined" || !document ) { return []; }
  return document.querySelectorAll(`script[data-for='${ key }']`);
}

function hasEmbeddedBlock( key ) {
  return embeddedBlockElements( key ).length > 0;
}

/**
 * Whether the payload should be handed over as text rather than bytes. Text is
 * re-encoded as UTF-8 by `Blob`, which is right for JSON and CSV and wrong for
 * anything binary, so callers that know better pass `binary`.
 */
function isPlainTextPayload( key, mimeType ) {
  if( !mimeType || mimeType.length === 0 ) { return false; }
  const type = mimeType.toLowerCase();
  const name = key.toLowerCase();
  return type.endsWith("json") || type.endsWith("csv") || type.endsWith("txt") ||
         type.endsWith("text") || type.endsWith("plain") || type.endsWith("tsv") ||
         name.endsWith("json") || name.endsWith("csv") ||
         name.endsWith("tsv") || name.endsWith("txt");
}

/**
 * Reads an embedded block back into a `Blob`, or returns `null` when the page
 * carries no such block.
 *
 * @param key - the `data-for` attribute, including its leading `#`
 * @param mimeType - overrides the block's own `data-type`
 * @param binary - forces the byte-exact path, whatever the MIME type says
 */
function decodeEmbeddedBlob( key, { mimeType, binary = false } = {} ) {
  const elements = embeddedBlockElements( key );
  if( elements.length === 0 ) { return null; }

  const blockType = elements[0].getAttribute("data-type");
  const type = mimeType ?? blockType;
  const plainText = binary ? false : isPlainTextPayload( key, blockType );

  const dataArrays = [];
  elements.forEach( el => {
    const currentPartition = parseInt( el.getAttribute("data-partition") );
    const parsedBase64 = atob( el.innerHTML.trim() );
    if( plainText ) {
      dataArrays[ currentPartition ] = parsedBase64;
    } else {
      // `atob` gives one character per byte; copy them out as bytes so nothing
      // is re-encoded on the way into the Blob
      const partitionSize = parseInt( el.getAttribute("data-parition-size") );
      const byteArray = new Uint8Array( partitionSize );
      for( let index = 0; index < partitionSize; index++ ) {
        byteArray[ index ] = parsedBase64.charCodeAt( index );
      }
      dataArrays[ currentPartition ] = byteArray;
    }
  });

  return new Blob( dataArrays, { type : type } );
}

export { hasEmbeddedBlock, decodeEmbeddedBlob };
