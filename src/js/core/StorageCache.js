import { Cache } from 'three';

// FIXME: remove this class
class StorageCache {
  constructor(){
    this._d = new Map();
  }

  check_item( path ){
    return( this._d.has( path ) || this._d.get( path ) !== undefined );
  }

  get_item( path , ifnotfound = '' ){
    const re = this._d.get( path );
    if( re !== undefined ){
      return( re );
    }else{
      return( ifnotfound );
    }
  }

  set_item( path, obj ){
    this._d.set( path , obj );
  }

  get_hash( path ){
    var hash = 0;
    var s = this.get_item( path );
    var i, chr;
    if (s.length === 0) return hash;
    for (i = 0; i < s.length; i++) {
      chr   = s.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash;
  }

  clear_items( paths ){
    if( paths === undefined ){
      // Remove all
      this._d.clear();
    }else{
      paths.forEach((p) => {
        this._d.delete( p );
      });
    }
  }

}

Cache.maxFiles = 20;
Cache.keys = [];
Cache.add = function ( key, file ) {

	if ( this.enabled === false ) return;
	if( typeof key !== "string" ) return;

	const item = this.files[ key ];
	if( item ) {
    item.file = file;
  } else {
		this.files[ key ] = {
		  hit: 0,
		  file: file
		};
  }
	this.purge( key );
};
Cache.get = function ( key ) {

	if ( this.enabled === false ) return;
	if( typeof key !== "string" ) return;

  const item = this.files[ key ];
  if( item ) {
    item.hit++;
    return item.file;
  }
	return;

};
Cache.remove = function ( key ) {

  if( typeof key !== "string" ) return;

  const item = this.files[ key ];

  if( item ) {
    delete item.files;
  }

};
Cache.purge = function( excludeKey ) {
  let n = this.maxFiles >= 1 ? this.maxFiles : 0;

  const keys = [];
  for(let k in this.files) {
    if( k !== excludeKey ) {
	    const item = this.files[ k ];
	    if( item.file ) {
  	    keys.push({
  	      hit: item.hit,
  	      key: k,
  	    });
	    }
    }
  }
  if( excludeKey ) {
    n--;
  }

  if( keys.length <= n ) {
    return;
  }

  keys.sort((a, b) => {
    return b.hit - a.hit;
  });

  n = n - keys.length;

  for(let i = 0; i < n; i++) {
    const item2 = this.files[ keys[ i ].key ];
    delete item2.file;
  }

};

/*
const Cache = {

	enabled: false,

	maxFiles: 20,

	files: {},

  keys: [],

	add: function ( key, file ) {

		if ( this.enabled === false ) return;

		const item = this.files[ key ];
		if( item ) {
      item.file = file;
    } else {
  		this.files[ key ] = {
  		  hit: 0,
  		  file: file
  		};
    }
		this.purge( key );
	},

	get: function ( key ) {

		if ( this.enabled === false ) return;

    const item = this.files[ key ];
    if( item ) {
      item.hit++;
      return item.file;
    }
		return;

	},

	remove: function ( key ) {

    if(!key) { return; }

    const item = this.files[ key ];

    if( item ) {
      delete item.files;
    }

	},

	clear: function () {

		this.files = {};

	},

	purge: function( excludeKey ) {
	  let n = this.maxFiles >= 1 ? this.maxFiles : 0;

	  const keys = [];
	  for(let k in this.files) {
	    if( k !== excludeKey ) {
  	    const item = this.files[ k ];
  	    if( item.file ) {
    	    keys.push({
    	      hit: item.hit,
    	      key: key,
    	    });
  	    }
	    }
	  }
	  if( excludeKey ) {
	    n--;
	  }

	  if( keys.length <= n ) {
	    return;
	  }

	  keys.sort((a, b) => {
	    return b.hit - a.hit;
	  });

	  n = n - keys.length;

	  for(let i = 0; i < n; i++) {
	    const item2 = this.files[ keys[ i ].key ];
      delete item2.file;
	  }

	}

};

*/
export { StorageCache, Cache };
