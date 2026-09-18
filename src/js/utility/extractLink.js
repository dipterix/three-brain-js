// Anchors are only worth parsing when an `href` is actually present; the
// cheap test keeps plain text off the `HTML` parsing path.
const HREF_PATTERN = /<a\s[^>]*href\s*=/i;

// Info text is redrawn on every frame, so the last conversion is memorized to
// keep the hover path free of repeated `HTML` parsing.
let cached, template;

function extractLink( text ) {

  if( typeof text !== "string" || !HREF_PATTERN.test( text ) ) {
    return { hasLink : false };
  }

  if ( !cached ) {
    cached = {};
    cached.texts = [];
  }

  if ( cached[ text ] ) {
    return( cached[ text ] );
  }

  if ( !template ) {
    // `<template>` content is inert: no script runs and no resource is fetched
    // while the snippet is inspected.
    template = document.createElement( "template" );
  }

  template.innerHTML = text;
  const anchors = template.content.querySelectorAll( "a[href]" );

  const result = { hasLink : false };
  if ( anchors.length !== 0 ) {

    anchors.forEach(anchor => {
      anchor.setAttribute( "target", "_blank" );
      anchor.setAttribute( "rel", "noopener noreferrer" );
    });
    result.html = template.innerHTML;
    result.hasLink = true;
    
  }

  cached[ text ] = result;
  cached.texts.push( text );

  if ( cached.texts.length > 100 ) {
    const oldKey = cached.texts.shift(1);
    delete cached[ oldKey ];
  }

  return result;
}

export { extractLink };
