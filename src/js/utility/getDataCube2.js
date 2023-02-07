function getDataCube2 ( canvas, cubeType, subject ) {
  if( typeof subject !== "string" ) {
    subject = canvas.get_state("target_subject");
  }
  const inst = canvas.threebrain_instances.get(`Atlas - ${ cubeType } (${ subject })`);
  if( inst && typeof inst === "object" && inst.isDataCube2 ) {
    return inst;
  }
  return;
}

export { getDataCube2 }
