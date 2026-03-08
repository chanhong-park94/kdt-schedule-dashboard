export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseCompactDate(value: string): Date | null {
  if (!/^\d{8}$/.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10);
  const day = Number.parseInt(value.slice(6, 8), 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return validDate ? date : null;
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return validDate ? date : null;
}

export function addDaysToIso(value: string, amount: number): string {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    throw new Error(`날짜 형식이 올바르지 않습니다: ${value}`);
  }
  const next = new Date(parsed.getTime() + amount * DAY_MS);
  return formatDate(next);
}

export function formatCompactDate(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toCompactDateFromIso(value: string): string {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return value;
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function getTodayCompactDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDateInsideRange(date: string, start: string, end: string): boolean {
  if (!parseIsoDate(date) || !parseIsoDate(start) || !parseIsoDate(end)) {
    return false;
  }
  return date >= start && date <= end;
}

export function dedupeAndSortDates(values: string[]): string[] {
  const normalized = new Set<string>();

  for (const value of values) {
    const parsed = parseIsoDate(value);
    if (!parsed) {
      continue;
    }
    normalized.add(formatDate(parsed));
  }

  return Array.from(normalized).sort((a, b) => a.localeCompare(b));
}

export function formatShortDateFromCompact(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(4, 6)}/${value.slice(6, 8)}`;
}

export function formatShortDateFromIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return `${value.slice(5, 7)}/${value.slice(8, 10)}`;
}
