import { Vector3, Matrix4, Color } from 'three';
import { readTT } from './streamlineIO.js';


class TTTract {
  constructor ( data ) {
    this.isInvalid = true;
    this.isTractography = true;
    this.isTTTract = true;

    if(!data) { return; }
    // parse TT
    const parsed = readTT(data);

    this.shape = parsed.shape;

    this.points = parsed.points;
    this.cutoff = parsed.cutoff;
    this.color = new Color().set(parsed.color);


    this.isInvalid = false;

  }

  dispose () {
    this.shape = undefined;
    this.points = undefined;
    this.cutoff = undefined;
    this.color = undefined;
    this.isInvalid = true;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    if(this.isInvalid) { return this; }

    this.shape = el.shape;
    this.points = el.points;
    this.cutoff = el.cutoff;
    this.color = new Color().copy( el.color );

    this.isFiberTract = true;
    this.isTTTract = true;

    return this;
  }

}

export { TTTract }
