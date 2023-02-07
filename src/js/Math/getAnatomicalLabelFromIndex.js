function getAnatomicalLabelFromIndex( canvas, index ) {
  const fslut = canvas.global_data("__global_data__.FSColorLUT");
  try {
    const indexInt = parseInt( index );
    const lbl = fslut.map[ indexInt ].Label;
    if( lbl ){
      return({
        index : indexInt,
        label : lbl
      });
    }
  } catch (e) {
  }
  return;
}

export { getAnatomicalLabelFromIndex };
