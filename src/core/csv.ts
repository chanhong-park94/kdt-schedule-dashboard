function parseCsvRows(text: string): string[][] {
  const normalized = text.replace(/\r/g, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];

    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((line) => line.some((value) => value.trim().length > 0));
}

function extractHeader(headerRow: string[]): string[] {
  return headerRow.map((column) => column.replace(/^\uFEFF/, "").trim());
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return [];
  }

  const header = extractHeader(rows[0]);
  const dataRows = rows.slice(1);

  return dataRows.map((columns) => {
    const record: Record<string, string> = {};

    header.forEach((column, index) => {
      record[column] = (columns[index] ?? "").trim();
    });

    return record;
  });
}

export type CsvParseWarning = {
  row: number;
  columnCount: number;
  expectedCount: number;
  message: string;
};

export type CsvParseResult = {
  records: Record<string, string>[];
  warnings: CsvParseWarning[];
};

export function parseCsvWithDiagnostics(text: string): CsvParseResult {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return { records: [], warnings: [] };
  }

  const header = extractHeader(rows[0]);
  const dataRows = rows.slice(1);
  const expectedCount = header.length;

  const records: Record<string, string>[] = [];
  const warnings: CsvParseWarning[] = [];

  dataRows.forEach((columns, index) => {
    const rowNumber = index + 2; // header is row 1, data starts at row 2
    if (columns.length !== expectedCount) {
      warnings.push({
        row: rowNumber,
        columnCount: columns.length,
        expectedCount,
        message:
          columns.length < expectedCount
            ? `${rowNumber}행: 열이 ${columns.length}개지만 헤더는 ${expectedCount}개입니다. 누락된 열은 빈 문자열로 처리됩니다.`
            : `${rowNumber}행: 열이 ${columns.length}개지만 헤더는 ${expectedCount}개입니다. 초과된 열은 무시됩니다.`,
      });
    }

    const record: Record<string, string> = {};
    header.forEach((column, i) => {
      record[column] = (columns[i] ?? "").trim();
    });
    records.push(record);
  });

  return { records, warnings };
}
