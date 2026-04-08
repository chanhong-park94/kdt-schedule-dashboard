/**
 * 문서자동화 Supabase 데이터 레이어
 * 출석입력요청대장 공결 기록 CRUD + 과정 설정 관리
 */

// localStorage fallback — Supabase 미연결 시에도 동작
const RECORDS_KEY = "kdt_doc_excuse_records_v1";
const CONFIG_KEY = "kdt_doc_automation_config_v1";

export interface ExcuseRecord {
  id: string;
  courseName: string;
  cohort: string;
  occurrenceDate: string; // MM-DD
  applicationDate: string; // MM-DD
  traineeName: string;
  reason: string; // 질병/입원, 휴가, 카드분실, 정전, 단말기고장, 카드발급지연, 기타
  checkinTime: string; // HH:MM or "-"
  checkoutTime: string; // HH:MM or "-"
  createdAt: string;
}

export interface DocConfig {
  courseName: string;
  cohort: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  timeStart: string; // HH:MM
  timeEnd: string;
  managerName: string;
  signatureData: string; // base64 PNG
}

// ── 공결 기록 CRUD (localStorage) ──────────────────
export function loadExcuseRecords(): ExcuseRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ExcuseRecord[];
  } catch {
    return [];
  }
}

export function saveExcuseRecords(records: ExcuseRecord[]): void {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function addExcuseRecord(record: Omit<ExcuseRecord, "id" | "createdAt">): ExcuseRecord {
  const records = loadExcuseRecords();
  const newRecord: ExcuseRecord = {
    ...record,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  records.push(newRecord);
  saveExcuseRecords(records);
  return newRecord;
}

export function deleteExcuseRecord(id: string): void {
  const records = loadExcuseRecords().filter((r) => r.id !== id);
  saveExcuseRecords(records);
}

export function updateExcuseRecord(id: string, updates: Partial<ExcuseRecord>): void {
  const records = loadExcuseRecords();
  const idx = records.findIndex((r) => r.id === id);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...updates };
    saveExcuseRecords(records);
  }
}

// ── 과정 설정 ─────────────────────────────────────
export function loadDocConfig(): DocConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return JSON.parse(raw) as DocConfig;
  } catch {
    /* ignore */
  }
  return {
    courseName: "",
    cohort: "",
    periodStart: "",
    periodEnd: "",
    timeStart: "10:00",
    timeEnd: "18:00",
    managerName: "",
    signatureData: "",
  };
}

export function saveDocConfig(config: DocConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ── 공결 신청 조회 설정 ──────────────────────────────
const EXCUSE_API_CONFIG_KEY = "kdt_doc_excuse_api_config_v1";

export interface ExcuseApiConfig {
  applicationUrl: string; // 공가 신청서 Apps Script URL
  evidenceUrl: string; // 증빙자료 Apps Script URL
}

export interface ExcuseApplication {
  timestamp: string;
  courseName: string;
  traineeName: string;
  birthDate: string;
  reason: string;
  requestDates: string; // "2026-03-24, 2026-03-25" (multiple possible)
  source: "application";
}

export interface EvidenceSubmission {
  timestamp: string;
  courseName: string;
  traineeName: string;
  evidenceUrls: string;
  source: "evidence";
}

export type ExcuseEntry = ExcuseApplication | EvidenceSubmission;

export function loadExcuseApiConfig(): ExcuseApiConfig {
  try {
    const raw = localStorage.getItem(EXCUSE_API_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as ExcuseApiConfig;
  } catch {
    /* */
  }
  return { applicationUrl: "", evidenceUrl: "" };
}

export function saveExcuseApiConfig(config: ExcuseApiConfig): void {
  localStorage.setItem(EXCUSE_API_CONFIG_KEY, JSON.stringify(config));
}

/** Test patterns for filtering out test data */
const TEST_PATTERNS = /테스트|test/i;

function isTestEntry(name: string): boolean {
  return TEST_PATTERNS.test(name);
}

/** 생년월일 마스킹 — 940402 → 94**** (PII 보호) */
function maskBirthDate(birth: string): string {
  if (!birth || birth.length < 4) return birth;
  return birth.slice(0, 2) + "****";
}

/** Fetch excuse applications from Apps Script */
export async function fetchExcuseApplications(url: string): Promise<ExcuseApplication[]> {
  if (!url) return [];
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}action=all`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { headers: string[]; rows: unknown[][] };

  return json.rows
    .map((row) => ({
      timestamp: String(row[0] ?? ""),
      courseName: String(row[2] ?? ""),
      traineeName: String(row[3] ?? ""),
      birthDate: maskBirthDate(String(row[4] ?? "")),
      reason: String(row[5] ?? ""),
      requestDates: String(row[6] ?? ""),
      source: "application" as const,
    }))
    .filter((r) => r.traineeName && !isTestEntry(r.traineeName));
}

/** Fetch evidence submissions from Apps Script */
export async function fetchEvidenceSubmissions(url: string): Promise<EvidenceSubmission[]> {
  if (!url) return [];
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}action=all`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { headers: string[]; rows: unknown[][] };

  return json.rows
    .map((row) => ({
      timestamp: String(row[0] ?? ""),
      courseName: String(row[2] ?? ""),
      traineeName: String(row[3] ?? ""),
      evidenceUrls: String(row[4] ?? ""),
      source: "evidence" as const,
    }))
    .filter((r) => r.traineeName && !isTestEntry(r.traineeName));
}
