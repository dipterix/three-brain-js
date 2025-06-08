import { Vector3, Matrix4, Color } from 'three';
import { readTRK } from './streamlineIO.js';


class TrkTract {
  constructor ( data ) {
    this.isInvalid = true;
    this.isStreamline = true;
    this.isTrkTract = true;

    if(!data) { return; }
    // parse TT
    const parsed = readTRK(data);

    this.points = parsed.pts;
    this.pointOffset = parsed.offsetPt0;
    this.lengthPerStreamline = parsed.lps;
    this.dataPerStreamline = parsed.dps;
    this.dataPerVertex = parsed.dpv;
    this.isInvalid = false;
  }

  dispose () {
    this.points = undefined;
    this.pointOffset = undefined;
    this.lengthPerStreamline = undefined;
    this.dataPerStreamline = undefined;
    this.dataPerVertex = true;
    this.isInvalid = false;
  }

  copy( el ) {
    this.isInvalid = el.isInvalid;
    if(this.isInvalid) { return this; }

    this.points = el.points;
    this.pointOffset = el.pointOffset;
    this.lengthPerStreamline = el.lengthPerStreamline;
    this.dataPerStreamline = el.dataPerStreamline;
    this.dataPerVertex = el.dataPerVertex;

    this.isStreamline = true;
    this.isTrkTract = true;

    return this;
  }

}

export { TrkTract }
