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
