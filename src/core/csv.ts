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

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return [];
  }

  const header = rows[0].map((column) => column.replace(/^\uFEFF/, "").trim());
  const dataRows = rows.slice(1);

  return dataRows.map((columns) => {
    const record: Record<string, string> = {};

    header.forEach((column, index) => {
      record[column] = (columns[index] ?? "").trim();
    });

    return record;
  });
}
