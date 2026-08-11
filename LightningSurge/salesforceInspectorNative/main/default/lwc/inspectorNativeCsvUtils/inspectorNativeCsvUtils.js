const TRUTHY_STRINGS = new Set(['true', '1', 'yes', 'y']);

/**
 * Parses RFC4180-ish delimited text (quoted fields, escaped "" quotes, delimiters/newlines inside
 * quotes, CRLF or LF line endings) into a header row and the remaining data rows. Fully blank
 * trailing rows are dropped.
 * @param {string} text - The raw delimited text.
 * @param {string} [delimiter] - Field separator. Defaults to ";" (values commonly contain commas -
 * addresses, formatted numbers - but rarely semicolons); pass "\t" for pasted Excel/clipboard data.
 */
export function parseCsv(text, delimiter = ';') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);

  const [headers, ...dataRows] = rows;
  return {
    headers: (headers || []).map((header) => header.trim()),
    rows: dataRows.filter((dataRow) => dataRow.some((value) => value.trim() !== ''))
  };
}

/**
 * Parses tab-separated data as pasted from Excel/Google Sheets/clipboard (the format browsers
 * receive on a paste event from a spreadsheet selection) using the same quoted-field handling as
 * parseCsv, so a pasted block of cells can be imported through the exact same mapping flow as a
 * CSV file.
 */
export function parseClipboardData(text) {
  return parseCsv(text, '\t');
}

/**
 * Builds an initial field-to-CSV-column mapping by matching a column's API name (developer
 * name) exactly against a CSV header. Only unambiguous, unique matches are pre-filled; fields
 * without a matching header are left unmapped for the user to assign manually.
 */
export function buildAutoMapping(csvHeaders, columns) {
  const mapping = {};
  const usedHeaders = new Set();
  columns.forEach((column) => {
    const match = csvHeaders.find((header) => header === column.apiName && !usedHeaders.has(header));
    mapping[column.apiName] = match || null;
    if (match) usedHeaders.add(match);
  });
  return mapping;
}

/**
 * Converts a raw CSV cell into the JS value type inspectorNativeFormField expects for the column.
 */
export function coerceCsvValue(column, rawValue) {
  const trimmed = (rawValue ?? '').trim();
  if (trimmed === '') return null;
  if (column?.type === 'checkbox') return TRUTHY_STRINGS.has(trimmed.toLowerCase());
  if (column?.type === 'datetime-local') {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
  }
  if (column?.type === 'number') {
    const parsed = Number(trimmed);
    // Treated the same as a blank cell rather than passing an unparseable string through - it
    // would otherwise reach serializeGqlValue as NaN, which corrupts the outgoing GraphQL
    // mutation for the whole batch, not just this row.
    return Number.isNaN(parsed) ? null : parsed;
  }
  return trimmed;
}

/**
 * Maps one CSV data row into a { apiName: value } object using the current field mapping.
 */
export function mapCsvRowToValues(csvRow, headers, mapping, columns) {
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const columnsByApiName = new Map(columns.map((column) => [column.apiName, column]));
  const values = {};
  Object.entries(mapping).forEach(([apiName, header]) => {
    if (!header || !headerIndex.has(header)) return;
    values[apiName] = coerceCsvValue(columnsByApiName.get(apiName), csvRow[headerIndex.get(header)]);
  });
  return values;
}

export function escapeCsvField(value) {
  return /[";\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Builds a header-only CSV template (no data rows) using each column's API name, so a file
 * downloaded from here re-uploads with every column auto-mapped by buildAutoMapping.
 */
export function buildCsvTemplate(columns) {
  return `${columns.map((column) => escapeCsvField(column.apiName)).join(';')}\r\n`;
}

/**
 * Builds a CSV report of a save attempt: one row per submitted record, with the same field
 * columns as the grid that was saved, plus Status ("Success"/"Failed"), Name (the record's own
 * name field(s), e.g. Account.Name or Contact's FirstName+LastName - same value shown in the
 * results table's Name column), and Detail (the created/updated record Id, or the failure reason)
 * columns.
 * @param {Array} columns - The grid's column models, [{ apiName, ... }].
 * @param {Array} resultRows - [{ values: {apiName: value}, status, name, detail }] per submitted row.
 */
export function buildResultsCsv(columns, resultRows) {
  const headers = [...columns.map((column) => column.apiName), 'Status', 'Name', 'Detail'];
  const lines = [headers.map(escapeCsvField).join(';')];
  resultRows.forEach((row) => {
    const cells = [
      ...columns.map((column) => escapeCsvField(String(row.values[column.apiName] ?? ''))),
      escapeCsvField(row.status),
      escapeCsvField(String(row.name ?? '')),
      escapeCsvField(String(row.detail ?? ''))
    ];
    lines.push(cells.join(';'));
  });
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Builds a plain CSV export of the grid's current rows as-is (whatever is currently in memory,
 * including unsaved edits) - one row per record, same field columns as the grid, no Status/Detail
 * columns (unlike buildResultsCsv, this isn't reporting a save attempt).
 * @param {Array} columns - The grid's column models, [{ apiName, ... }].
 * @param {Array} rows - The grid's current rows, [{ values: {apiName: value} }].
 */
export function buildRowsCsv(columns, rows) {
  const headers = columns.map((column) => column.apiName);
  const lines = [headers.map(escapeCsvField).join(';')];
  rows.forEach((row) => {
    const cells = columns.map((column) => escapeCsvField(String(row.values[column.apiName] ?? '')));
    lines.push(cells.join(';'));
  });
  return `${lines.join('\r\n')}\r\n`;
}