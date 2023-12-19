import { AbstractThreeBrainObject } from './abstract.js';
import { remove_comments } from '../utils.js';
import {
  Vector3, Sprite, Texture, SpriteMaterial, TextureLoader,
  CylinderGeometry, MeshBasicMaterial, Mesh, RawShaderMaterial
} from 'three';

class ImageSprite extends AbstractThreeBrainObject {
  constructor (g, canvas) {
    super( g, canvas );
    this.type = 'ImageSprite';
    this.isSprite = true;

    const radius = this._params.aspect_ratio / 2;
    const geometry = new CylinderGeometry( radius, radius, 1, 32 );

    this.texture = new TextureLoader().load( this._params.image_uri );
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;

    const material = new MeshBasicMaterial( {
      color: 0xeeeeee,
      map : this.texture,
      transparent : true
    });
    this.object = new Mesh( geometry, material );

  }
}

function gen_imagesprite ( g, canvas ) {
  const subject_code = g.subject_code;

  if( subject_code ){
    // make sure subject group exists
    if( g.group && g.group.group_name ){
      const group_name = g.group.group_name;

      if( !canvas.group.has(group_name) ){
        canvas.add_group( {
          name : group_name, layer : 0, position : [0,0,0],
          disable_trans_mat: true, group_data: null,
          parent_group: null, subject_code: subject_code,
          trans_mat: null
        });
      }
    }
  }

  const el = new ImageSprite(g, canvas);

  if( subject_code ){
    // make sure subject array exists
    canvas.init_subject( subject_code );
  }
  return( el );
}

export { gen_imagesprite };
