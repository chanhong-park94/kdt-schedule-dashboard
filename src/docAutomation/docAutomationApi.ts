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

// ── 장려금 확인서 ─────────────────────────────
const INCENTIVE_RECORDS_KEY = "kdt_doc_incentive_records_v1";
const INCENTIVE_CONFIG_KEY = "kdt_doc_incentive_config_v1";

export interface IncentiveRecord {
  id: string;
  name: string;
  birthDate: string;
  nationalJobSeeking: string;
  employed: string;
  unemploymentBenefit: string;
  youthAllowance: string;
  businessRegistered: string;
  incentiveAmount: number;
  signature: string;
  note: string;
}

export interface IncentiveConfig {
  courseName: string;
  trainingPeriod: string;
  unitPeriod: string;
  docDate: string;
}

export function loadIncentiveRecords(): IncentiveRecord[] {
  try {
    const raw = localStorage.getItem(INCENTIVE_RECORDS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as IncentiveRecord[];
  } catch { return []; }
}

export function saveIncentiveRecords(records: IncentiveRecord[]): void {
  localStorage.setItem(INCENTIVE_RECORDS_KEY, JSON.stringify(records));
}

export function deleteIncentiveRecord(id: string): void {
  const records = loadIncentiveRecords().filter((r) => r.id !== id);
  saveIncentiveRecords(records);
}

export function updateIncentiveRecord(id: string, updates: Partial<IncentiveRecord>): void {
  const records = loadIncentiveRecords();
  const idx = records.findIndex((r) => r.id === id);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...updates };
    saveIncentiveRecords(records);
  }
}

export function loadIncentiveConfig(): IncentiveConfig {
  try {
    const raw = localStorage.getItem(INCENTIVE_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as IncentiveConfig;
  } catch { /* */ }
  return { courseName: "", trainingPeriod: "", unitPeriod: "", docDate: new Date().toISOString().slice(0, 10) };
}

export function saveIncentiveConfig(config: IncentiveConfig): void {
  localStorage.setItem(INCENTIVE_CONFIG_KEY, JSON.stringify(config));
}

/** HRD 장려금 지급내역 엑셀 파싱 */
export async function parseIncentiveExcel(file: File): Promise<IncentiveRecord[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];

  // row[0]: 헤더, row[1]: 서브헤더, row[2]: 합계, row[3+]: 데이터
  const records: IncentiveRecord[] = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[1]) continue; // 이름 없으면 스킵
    const name = String(row[1] ?? "").trim();
    if (!name) continue;

    // 주민번호 앞 7자리 (YYMMDD-N)
    const rawSsn = String(row[2] ?? "");
    const birthDate = rawSsn.length >= 8 ? rawSsn.slice(0, 8) : rawSsn;

    // 신청액-훈련장려금 (col index 17)
    const amount = Number(row[17]) || 0;

    // 취업여부 등은 엑셀 col 기반 (Y/N → O/-)
    const mapYN = (val: unknown): string => String(val ?? "").trim().toUpperCase() === "Y" ? "O" : "-";

    records.push({
      id: crypto.randomUUID(),
      name,
      birthDate,
      nationalJobSeeking: "-",
      employed: mapYN(row[24]), // 취/창업 col
      unemploymentBenefit: mapYN(row[27]), // 구직급여 col
      youthAllowance: "-",
      businessRegistered: mapYN(row[25]), // 사업자등록 col
      incentiveAmount: amount,
      signature: "비대면훈련",
      note: "",
    });
  }
  return records;
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
