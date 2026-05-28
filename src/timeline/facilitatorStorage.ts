const LAST_CHECK_KEY = "kdt_facilitator_last_check_v1";
const LAST_DIFF_KEY = "kdt_facilitator_last_diff_v1";

export interface LastCheckResult {
  checkedAt: string; // ISO datetime
  status: "ok" | "diff" | "error";
  message: string;
  added?: number;
  changed?: number;
  removed?: number;
}

export function loadLastCheck(): LastCheckResult | null {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveLastCheck(r: LastCheckResult): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(r));
  } catch (e) {
    console.warn("[facilitator] last check save failed", e);
  }
}

export function loadLastDiff(): unknown | null {
  try {
    const raw = localStorage.getItem(LAST_DIFF_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveLastDiff(d: unknown): void {
  try {
    localStorage.setItem(LAST_DIFF_KEY, JSON.stringify(d));
  } catch (e) {
    console.warn("[facilitator] last diff save failed", e);
  }
}
