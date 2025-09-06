import { Vector3, Matrix4, Color } from 'three';
import { readTCK } from './streamlineIO.js';

class TckTract {
  constructor ( data ) {
    this.isInvalid = true;
    this.isStreamline = true;
    this.isTckTract = true;

    if(!data) { return; }
    // parse TT
    const parsed = readTCK(data);

    this.points = parsed.pts;
    this.pointOffset = parsed.offsetPt0;
    if(this.pointOffset[0] !== 0) {
      // This should not happen
      // this.pointOffset.unshift(0);
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

    // this.color = new Color();


    this.isInvalid = false;

  }

  dispose () {
    this.points = undefined;
    this.pointOffset = undefined;
    this.lengthPerStreamline = undefined;
    // this.color = undefined;
    this.isInvalid = true;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    if(this.isInvalid) { return this; }

    this.points = el.points;
    this.pointOffset = el.pointOffset;
    this.lengthPerStreamline = el.lengthPerStreamline;
    // this.color = new Color().copy( el.color );

    this.isStreamline = true;
    this.isTckTract = true;

    return this;
  }

}

export { TckTract }
