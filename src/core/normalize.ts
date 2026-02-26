const NA_PATTERN = /^(na|n\/a|null|-)$/i;

function sanitize(value: string): string {
  return value.trim();
}

function isMissingValue(value: string): boolean {
  const trimmed = sanitize(value);
  return trimmed.length === 0 || NA_PATTERN.test(trimmed);
}

export function normalizeDateYYYYMMDD(value: string): string | null {
  if (isMissingValue(value)) {
    return null;
  }

  const trimmed = sanitize(value);
  if (!/^\d{8}$/.test(trimmed)) {
    return null;
  }

  const year = Number.parseInt(trimmed.slice(0, 4), 10);
  const month = Number.parseInt(trimmed.slice(4, 6), 10);
  const day = Number.parseInt(trimmed.slice(6, 8), 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!validDate) {
    return null;
  }

  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
}

export function normalizeHHMM(value: string): string | null {
  if (isMissingValue(value)) {
    return null;
  }

  const trimmed = sanitize(value);
  if (!/^\d{1,4}$/.test(trimmed)) {
    return null;
  }

  const padded = trimmed.padStart(4, "0");
  const hh = Number.parseInt(padded.slice(0, 2), 10);
  const mm = Number.parseInt(padded.slice(2, 4), 10);

  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }

  return padded;
}

export function hhmmToMinutes(value: string): number | null {
  const normalized = normalizeHHMM(value);
  if (!normalized) {
    return null;
  }

  const hh = Number.parseInt(normalized.slice(0, 2), 10);
  const mm = Number.parseInt(normalized.slice(2, 4), 10);

  return hh * 60 + mm;
}
