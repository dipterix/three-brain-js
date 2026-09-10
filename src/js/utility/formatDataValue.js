/**
 * Format a data value for the info panel.
 *
 * `toPrecision` alone would print `-0.83` as `-0.8300`; round-tripping through
 * `Number` drops the padding while keeping the significant digits, so short
 * values stay short and long ones do not run off the panel.
 *
 * Non-numeric input (annotation labels, for instance) is returned as-is.
 *
 * @param {number|string} value
 * @param {number} [precision=4] significant digits
 * @returns {string}
 */
function formatDataValue( value, precision = 4 ) {
  if( typeof value !== "number" ) {
    return `${ value }`;
  }
  if( !isFinite( value ) ) {
    return `${ value }`;
  }
  if( Number.isInteger( value ) ) {
    return `${ value }`;
  }
  return `${ Number( value.toPrecision( precision ) ) }`;
}

export { formatDataValue };
