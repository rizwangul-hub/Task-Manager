/**
 * Utility to generate sanitized, formula-injection-safe CSV output.
 */

/**
 * Sanitize a single CSV cell value against Formula Injection (CSV injection).
 * If a value begins with '=', '+', '-', '@', '\t', or '\r', prepend a single quote (').
 * Wrap cells in quotes if they contain commas, newlines, or quotes.
 */
export const sanitizeCsvCell = (value) => {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = String(value);

  // Strip or normalize carriage returns
  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Prevent CSV Formula Injection
  const formulaTriggers = ['=', '+', '-', '@', '\t', '\n'];
  if (str.length > 0 && formulaTriggers.includes(str[0])) {
    str = `'${str}`;
  }

  // Escape double quotes by doubling them
  const escaped = str.replace(/"/g, '""');

  // Always wrap in quotes for safety and consistency
  return `"${escaped}"`;
};

/**
 * Format an array of objects into a sanitized CSV string.
 * @param {Array<string>} headers - Column headers
 * @param {Array<Array<any>>} rows - Array of row data matching headers
 * @returns {string} Safe CSV string
 */
export const buildCsvString = (headers, rows) => {
  const headerLine = headers.map(sanitizeCsvCell).join(',');
  const rowLines = rows.map((row) => row.map(sanitizeCsvCell).join(','));
  return [headerLine, ...rowLines].join('\r\n');
};
