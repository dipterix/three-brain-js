/**
 * Where the 3D view and the three slice panels go, for each view layout.
 *
 * `3dview` is the classic arrangement: the 3D view fills the viewer and the
 * slice panels float over its left edge. The `sliceview-*` layouts tile the
 * view instead. Slice panels are always square, because the side cameras see
 * a fixed +-128 mm at aspect 1. The 3D panel is landscape or square, because a
 * tall 3D canvas overflows its text and lets the legend cover the objects;
 * the one exception is the stacked featured layout, where a full-height 3D
 * panel is worth it (it is never narrower than 2:3).
 *
 * Kept free of three.js so it can be checked in node.
 */

const VIEW_LAYOUTS = [
  "3dview",
  "sliceview-flat",
  "sliceview-axial",
  "sliceview-coronal",
  "sliceview-sagittal",
  "sliceview-twobytwo",
];

// the order the small panels of a featured layout are stacked in
const SLICE_ORDER = [ "axial", "sagittal", "coronal" ];

function square( left, top, size ) {
  return { left: left, top: top, size: size };
}

function layout3D( width, height ) {
  return {
    mode   : "3dview",
    main   : { left: 0, top: 0, width: width, height: height },
    slices : null,
  };
}

// one row: axial, coronal, sagittal, then the 3D view in the leftover width
function layoutFlat( width, height ) {
  const s = Math.floor( Math.min( width / 4, height ) ),
        top = Math.floor( ( height - s ) / 2 );
  return {
    mode   : "sliceview-flat",
    main   : { left: 3 * s, top: top, width: width - 3 * s, height: s },
    slices : {
      axial    : square( 0, top, s ),
      coronal  : square( s, top, s ),
      sagittal : square( 2 * s, top, s ),
    },
  };
}

// axial and sagittal on top, coronal below axial, the 3D view below sagittal
function layoutTwoByTwo( width, height ) {
  const s = Math.floor( Math.min( width / 2, height / 2 ) ),
        left = Math.floor( ( width - 2 * s ) / 2 ),
        top = Math.floor( ( height - 2 * s ) / 2 );
  return {
    mode   : "sliceview-twobytwo",
    main   : {
      left   : left + s,
      top    : top + s,
      width  : Math.min( width - left - s, Math.floor( 1.5 * s ) ),
      height : s,
    },
    slices : {
      axial    : square( left, top, s ),
      sagittal : square( left + s, top, s ),
      coronal  : square( left, top + s, s ),
    },
  };
}

// One slice featured at twice the size of the other two, and the 3D view in
// the leftover width, at full height:
//   - at 5:2 or wider ("row"), the other two are stacked in the first column
//     and the featured one fills the height next to them;
//   - down to 4:3 ("stacked"), the other two sit side by side on top of the
//     featured one, which takes two thirds of the height;
//   - narrower than that there is no room left for the 3D view, and the
//     two-by-two layout is used instead.
function layoutFeatured( featured, width, height ) {
  const [ first, second ] = SLICE_ORDER.filter( ( type ) => type !== featured );
  if( 2 * width >= 5 * height ) {
    const n = Math.floor( height / 2 );
    return {
      mode   : `sliceview-${ featured }`,
      main   : { left: 3 * n, top: 0, width: width - 3 * n, height: height },
      slices : {
        [ first ]    : square( 0, 0, n ),
        [ second ]   : square( 0, n, n ),
        [ featured ] : square( n, 0, 2 * n ),
      },
    };
  }
  if( 3 * width >= 4 * height ) {
    const s = Math.floor( height / 3 );
    return {
      mode   : `sliceview-${ featured }`,
      main   : { left: 2 * s, top: 0, width: width - 2 * s, height: height },
      slices : {
        [ first ]    : square( 0, 0, s ),
        [ second ]   : square( s, 0, s ),
        [ featured ] : square( 0, s, 2 * s ),
      },
    };
  }
  return layoutTwoByTwo( width, height );
}

/**
 * @param {string} mode   one of `VIEW_LAYOUTS`; anything else is `3dview`
 * @param {number} width  width of the view area in CSS pixels
 * @param {number} height height of the view area in CSS pixels
 * @returns {{ mode: string, view: { width: number, height: number },
 *   main: { left: number, top: number, width: number, height: number },
 *   slices: null | Object<string, { left: number, top: number, size: number }> }}
 *   `mode` is the layout actually used: a featured layout narrower than 4:3
 *   falls back to `sliceview-twobytwo`. `slices` is `null` in `3dview`, where
 *   the panels keep their floating positions. `view` is the size the layout
 *   was computed for.
 */
function computeViewLayout( mode, width, height ) {
  width = Math.floor( width );
  height = Math.floor( height );
  let layout;
  switch ( mode ) {
    case "sliceview-flat":
      layout = layoutFlat( width, height );
      break;
    case "sliceview-axial":
      layout = layoutFeatured( "axial", width, height );
      break;
    case "sliceview-coronal":
      layout = layoutFeatured( "coronal", width, height );
      break;
    case "sliceview-sagittal":
      layout = layoutFeatured( "sagittal", width, height );
      break;
    case "sliceview-twobytwo":
      layout = layoutTwoByTwo( width, height );
      break;
    default:
      layout = layout3D( width, height );
  }
  layout.view = { width: width, height: height };
  return layout;
}

export { VIEW_LAYOUTS, computeViewLayout };
