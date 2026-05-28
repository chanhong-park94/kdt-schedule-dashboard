import type { GuidelineCategory } from "./guidelineData";

const FAV_KEY = "kdt_guideline_favorites_v1";
const NOTES_KEY = "kdt_guideline_notes_v1";
const FILTER_KEY = "kdt_guideline_source_filter_v1";

export type GuidelineSource = "manual" | "nbc" | "voc";

export const SOURCE_OF_CATEGORY: Record<GuidelineCategory, GuidelineSource> = {
  overview: "manual",
  selection: "manual",
  contract: "manual",
  contractChange: "manual",
  trainee: "manual",
  execution: "manual",
  attendance: "manual",
  payment: "manual",
  reporting: "manual",
  supervision: "manual",
  shortTerm: "manual",
  annex: "manual",
  regulationNbc: "nbc",
  regulationVoc: "voc",
};

export const SOURCE_LABELS: Record<GuidelineSource, { icon: string; label: string }> = {
  manual: { icon: "📕", label: "운영지침" },
  nbc: { icon: "⚖️", label: "내배카 규정" },
  voc: { icon: "📜", label: "직능 규정" },
};

export function getSourceOfCategory(cat: GuidelineCategory): GuidelineSource {
  return SOURCE_OF_CATEGORY[cat];
}

// ─── 즐겨찾기 ──────────────────────────────────────
export function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(set: Set<string>): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch (e) {
    console.warn("[guideline] favorites save failed", e);
  }
}

export function toggleFavorite(id: string): boolean {
  const set = loadFavorites();
  let now = false;
  if (set.has(id)) {
    set.delete(id);
    now = false;
  } else {
    set.add(id);
    now = true;
  }
  saveFavorites(set);
  return now;
}

// ─── 메모 ──────────────────────────────────────
export function loadAllNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      // 유효 키만
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof k === "string" && typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

export function loadNote(id: string): string {
  return loadAllNotes()[id] ?? "";
}

export function saveNote(id: string, text: string): void {
  const notes = loadAllNotes();
  if (text.trim().length === 0) {
    delete notes[id];
  } else {
    notes[id] = text;
  }
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch (e) {
    console.warn("[guideline] note save failed", e);
  }
}

// ─── 출처 필터 ──────────────────────────────────────
export function loadSourceFilter(): Record<GuidelineSource, boolean> {
  const defaults: Record<GuidelineSource, boolean> = { manual: true, nbc: true, voc: true };
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return defaults;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      return {
        manual: typeof obj.manual === "boolean" ? obj.manual : true,
        nbc: typeof obj.nbc === "boolean" ? obj.nbc : true,
        voc: typeof obj.voc === "boolean" ? obj.voc : true,
      };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveSourceFilter(filter: Record<GuidelineSource, boolean>): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch (e) {
    console.warn("[guideline] source filter save failed", e);
  }
}
