import { Vector3, Matrix4, Color } from 'three';
import { readTT } from './streamlineIO.js';

class TTTract {
  constructor ( data ) {
    this.isInvalid = true;
    this.isStreamline = true;
    this.isTTTract = true;

    if(!data) { return; }
    // parse TT
    const parsed = readTT(data);

    this.shape = parsed.shape;

    this.points = parsed.points;
    this.pointOffset = parsed.cutoff;
    if(this.pointOffset[0] !== 0) {
      this.pointOffset.unshift(0);
    }

    const lps = [];
    const segStart = new Vector3(),
          segEnd = new Vector3();
    let len = 0;
    for(let i = 0; i < this.pointOffset.length - 1; i++) {
      const iStart = this.pointOffset[i],
            iEnd = this.pointOffset[i + 1];
      len = 0;
      for(let j = iStart; j < iEnd - 1; j++) {
        segStart.fromArray(this.points, j * 3);
        segEnd.fromArray(this.points, j * 3 + 3);
        len += segEnd.distanceTo( segStart );
      }
      lps.push( len );
    }
    this.lengthPerStreamline = lps;
    // this.dataPerStreamline = parsed.dps;
    // this.dataPerVertex = parsed.dpv;

    this.color = new Color().set(parsed.color);


    this.isInvalid = false;

  }

  dispose () {
    this.shape = undefined;
    this.points = undefined;
    this.pointOffset = undefined;
    this.lengthPerStreamline = undefined;
    this.color = undefined;
    this.isInvalid = true;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    if(this.isInvalid) { return this; }

    this.shape = el.shape;
    this.points = el.points;
    this.pointOffset = el.pointOffset;
    this.lengthPerStreamline = el.lengthPerStreamline;
    this.color = new Color().copy( el.color );

    this.isStreamline = true;
    this.isTTTract = true;

    return this;
  }

}

export { TTTract }
