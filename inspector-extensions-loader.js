// three's Inspector (debug mode) loads its optional extensions, such as the TSL
// graph, with `import( new URL( extension.url, import.meta.url ) )`: a path
// relative to its own file, which doesn't exist once bundled. Swap in static
// imports of the same files. `eager` keeps them in the main bundle rather than in
// a chunk file that the R package would never serve.
module.exports = function( source ) {
  const loadByUrl = /const extUrl = new URL\( extension\.url, import\.meta\.url \)\.href;\s*const module = await import\( extUrl \);/;
  const urls = [ ...source.matchAll( /url: '([^']+)'/g ) ].map( m => m[ 1 ] );
  if( !loadByUrl.test( source ) || urls.length === 0 ) {
    throw new Error( "three's Inspector changed how it loads extensions; update inspector-extensions-loader.js" );
  }
  const imports = urls.map( url =>
    `${ JSON.stringify( url ) }: () => import( /* webpackMode: "eager" */ ${ JSON.stringify( url ) } )` );
  return source.replace( loadByUrl,
    `const module = await ( { ${ imports.join( ', ' ) } } )[ extension.url ]();` );
};
