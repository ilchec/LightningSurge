import {
  buildAutoMapping,
  buildCsvTemplate,
  buildResultsCsv,
  buildRowsCsv,
  coerceCsvValue,
  escapeCsvField,
  mapCsvRowToValues,
  parseClipboardData,
  parseCsv
} from 'c/graphqlMultiRecordEntryCsvUtils';

describe('parseCsv', () => {
  it('parses a simple semicolon-delimited file with a header row', () => {
    const { headers, rows } = parseCsv('Name;Email\r\nAcme;a@b.com\r\n');
    expect(headers).toEqual(['Name', 'Email']);
    expect(rows).toEqual([['Acme', 'a@b.com']]);
  });

  it('handles quoted fields containing the delimiter', () => {
    const { rows } = parseCsv('Name;Note\n"Acme; Inc";"Hello"\n');
    expect(rows).toEqual([['Acme; Inc', 'Hello']]);
  });

  it('handles escaped double quotes inside a quoted field', () => {
    const { rows } = parseCsv('Name\n"Say ""Hi"""\n');
    expect(rows).toEqual([['Say "Hi"']]);
  });

  it('handles a quoted field containing a newline', () => {
    const { rows } = parseCsv('Name;Note\nAcme;"line1\nline2"\n');
    expect(rows).toEqual([['Acme', 'line1\nline2']]);
  });

  it('accepts LF-only line endings, not just CRLF', () => {
    const { headers, rows } = parseCsv('A;B\n1;2\n3;4\n');
    expect(headers).toEqual(['A', 'B']);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ]);
  });

  it('drops fully blank trailing rows', () => {
    const { rows } = parseCsv('A;B\n1;2\n;\n');
    expect(rows).toEqual([['1', '2']]);
  });

  it('trims header whitespace', () => {
    const { headers } = parseCsv(' A ; B \n1;2\n');
    expect(headers).toEqual(['A', 'B']);
  });

  it('returns no rows for header-only input', () => {
    const { headers, rows } = parseCsv('A;B\n');
    expect(headers).toEqual(['A', 'B']);
    expect(rows).toEqual([]);
  });

  it('uses a custom delimiter when given one', () => {
    const { headers, rows } = parseCsv('A,B\n1,2\n', ',');
    expect(headers).toEqual(['A', 'B']);
    expect(rows).toEqual([['1', '2']]);
  });
});

describe('parseClipboardData', () => {
  it('parses tab-separated data as pasted from a spreadsheet', () => {
    const text = 'Name\tEmail\nAcme\ta@b.com\n';
    const { headers, rows } = parseClipboardData(text);
    expect(headers).toEqual(['Name', 'Email']);
    expect(rows).toEqual([['Acme', 'a@b.com']]);
  });
});

describe('buildAutoMapping', () => {
  const columns = [{ apiName: 'Name' }, { apiName: 'Email' }, { apiName: 'Phone' }];

  it('maps columns whose apiName exactly matches a header', () => {
    const mapping = buildAutoMapping(['Name', 'Email', 'Unrelated'], columns);
    expect(mapping).toEqual({ Name: 'Name', Email: 'Email', Phone: null });
  });

  it('does not let a second column with the same apiName reuse an already-matched header', () => {
    const dupColumns = [{ apiName: 'Name' }, { apiName: 'Name' }];
    const mapping = buildAutoMapping(['Name'], dupColumns);
    // The second column's lookup is blocked by usedHeaders and falls back to null,
    // which is what ends up on the shared "Name" key (it's written after the first column's match).
    expect(mapping).toEqual({ Name: null });
  });
});

describe('coerceCsvValue', () => {
  it('returns null for a blank cell', () => {
    expect(coerceCsvValue({ type: 'text' }, '  ')).toBeNull();
    expect(coerceCsvValue({ type: 'text' }, undefined)).toBeNull();
  });

  it('coerces truthy checkbox strings to true', () => {
    ['true', '1', 'yes', 'y', 'TRUE', 'Y'].forEach((value) => {
      expect(coerceCsvValue({ type: 'checkbox' }, value)).toBe(true);
    });
  });

  it('coerces other checkbox strings to false', () => {
    expect(coerceCsvValue({ type: 'checkbox' }, 'no')).toBe(false);
    expect(coerceCsvValue({ type: 'checkbox' }, '0')).toBe(false);
  });

  it('converts a parseable datetime-local value to an ISO string', () => {
    const result = coerceCsvValue({ type: 'datetime-local' }, '2024-01-15T10:30:00Z');
    expect(result).toBe(new Date('2024-01-15T10:30:00Z').toISOString());
  });

  it('leaves an unparseable datetime-local value untouched rather than throwing', () => {
    expect(coerceCsvValue({ type: 'datetime-local' }, 'not-a-date')).toBe('not-a-date');
  });

  it('trims plain text values', () => {
    expect(coerceCsvValue({ type: 'text' }, '  hello  ')).toBe('hello');
  });

  it('parses a numeric column value into a real number', () => {
    expect(coerceCsvValue({ type: 'number' }, '42')).toBe(42);
    expect(coerceCsvValue({ type: 'number' }, '19.5')).toBe(19.5);
  });

  it('treats an unparseable numeric column value as blank rather than passing it through', () => {
    expect(coerceCsvValue({ type: 'number' }, '$1,200')).toBeNull();
    expect(coerceCsvValue({ type: 'number' }, 'not a number')).toBeNull();
  });
});

describe('mapCsvRowToValues', () => {
  const headers = ['Company Name', 'Email Address'];
  const columns = [
    { apiName: 'Name', type: 'text' },
    { apiName: 'Email', type: 'text' }
  ];
  const mapping = { Name: 'Company Name', Email: 'Email Address' };

  it('maps a row using the given header->column mapping', () => {
    const values = mapCsvRowToValues(['Acme', 'a@b.com'], headers, mapping, columns);
    expect(values).toEqual({ Name: 'Acme', Email: 'a@b.com' });
  });

  it('skips fields left unmapped (null header)', () => {
    const values = mapCsvRowToValues(['Acme', 'a@b.com'], headers, { Name: 'Company Name', Email: null }, columns);
    expect(values).toEqual({ Name: 'Acme' });
  });
});

describe('escapeCsvField', () => {
  it('leaves a plain value untouched', () => {
    expect(escapeCsvField('Acme')).toBe('Acme');
  });

  it('quotes and escapes a value containing the delimiter', () => {
    expect(escapeCsvField('Acme;Inc')).toBe('"Acme;Inc"');
  });

  it('quotes and doubles internal quotes', () => {
    expect(escapeCsvField('Say "Hi"')).toBe('"Say ""Hi"""');
  });

  it('quotes a value containing a newline', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsvTemplate', () => {
  it('builds a semicolon-delimited header row from column apiNames', () => {
    const csv = buildCsvTemplate([{ apiName: 'Name' }, { apiName: 'Email' }]);
    expect(csv).toBe('Name;Email\r\n');
  });
});

describe('buildResultsCsv', () => {
  it('builds a header row of column apiNames plus Status and Detail', () => {
    const csv = buildResultsCsv([{ apiName: 'Name' }], []);
    expect(csv.split('\r\n')[0]).toBe('Name;Status;Detail');
  });

  it('builds one data row per result, with values/status/detail', () => {
    const csv = buildResultsCsv(
      [{ apiName: 'Name' }, { apiName: 'Email' }],
      [{ values: { Name: 'Acme', Email: 'a@b.com' }, status: 'Success', detail: '001xx0000000001' }]
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('Acme;a@b.com;Success;001xx0000000001');
  });

  it('escapes values that contain the delimiter', () => {
    const csv = buildResultsCsv([{ apiName: 'Name' }], [{ values: { Name: 'Acme;Inc' }, status: 'Failed', detail: 'REQUIRED_FIELD_MISSING' }]);
    expect(csv.trim().split('\r\n')[1]).toBe('"Acme;Inc";Failed;REQUIRED_FIELD_MISSING');
  });

  it('renders a missing value as an empty cell rather than "null"/"undefined"', () => {
    const csv = buildResultsCsv([{ apiName: 'Name' }], [{ values: {}, status: 'Failed', detail: 'Some error' }]);
    expect(csv.trim().split('\r\n')[1]).toBe(';Failed;Some error');
  });
});

describe('buildRowsCsv', () => {
  it('builds a header row of just the column apiNames, no Status/Detail', () => {
    const csv = buildRowsCsv([{ apiName: 'Name' }, { apiName: 'Email' }], []);
    expect(csv.split('\r\n')[0]).toBe('Name;Email');
  });

  it('builds one data row per given row, using its current values', () => {
    const csv = buildRowsCsv(
      [{ apiName: 'Name' }, { apiName: 'Email' }],
      [{ values: { Name: 'Acme', Email: 'a@b.com' } }, { values: { Name: 'Globex', Email: 'b@c.com' } }]
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('Acme;a@b.com');
    expect(lines[2]).toBe('Globex;b@c.com');
  });

  it('escapes values that contain the delimiter and renders a missing value as an empty cell', () => {
    const csv = buildRowsCsv([{ apiName: 'Name' }, { apiName: 'Email' }], [{ values: { Name: 'Acme;Inc' } }]);
    expect(csv.trim().split('\r\n')[1]).toBe('"Acme;Inc";');
  });
});
