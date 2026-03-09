/**
 * Google Sheets 데이터 연동 모듈
 *
 * 두 가지 방식을 지원합니다:
 * 1. Apps Script Web App URL → JSON 직접 fetch
 * 2. 스프레드시트 "웹에 게시" → CORS 프록시 + gviz CSV
 */
import type {
  KpiAllData,
  KpiConfig,
  CourseInfo,
  GradeEntry,
  AchievementRecord,
  FormativeRecord,
  FieldAppRecord,
  AchievementSummary,
  FormativeSummary,
  FieldAppSummary,
  KPI_CONFIG_KEY as _,
} from "./kpiTypes";
import { KPI_CONFIG_KEY } from "./kpiTypes";

// ── CORS 프록시 체인 (hrdApi.ts와 동일 구조) ────────────────
interface ProxyEntry {
  prefix: string;
  encode: boolean;
}
const CORS_PROXIES: ProxyEntry[] = [
  { prefix: "https://cors.eu.org/", encode: false },
  { prefix: "https://corsproxy.io/?url=", encode: true },
  { prefix: "https://api.allorigins.win/raw?url=", encode: true },
];

async function corsFetch(rawUrl: string): Promise<string> {
  for (const proxy of CORS_PROXIES) {
    try {
      const url = proxy.encode
        ? proxy.prefix + encodeURIComponent(rawUrl)
        : proxy.prefix + rawUrl;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      console.warn(`[KPI] Proxy failed:`, (e as Error).message);
    }
  }
  throw new Error("모든 CORS 프록시 실패");
}

// ── CSV 파싱 ──────────────────────────────────────────────────
function parseCsvRows(text: string): string[][] {
  const normalized = text.replace(/\r/g, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) { row.push(cell); cell = ""; continue; }
    if (ch === "\n" && !inQuotes) { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter(r => r.some(v => v.trim().length > 0));
}

function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ── 설정 시트 파싱 ──────────────────────────────────────────
function parseSettings(csv: string): { courses: CourseInfo[]; grades: GradeEntry[] } {
  const rows = parseCsvRows(csv);
  const courses: CourseInfo[] = [];
  const grades: GradeEntry[] = [];
  let section: "courses" | "grades" | "eval" | "" = "";

  for (const row of rows) {
    const first = row[0]?.trim() || "";

    // 섹션 감지
    if (first.includes("과정 정보 설정") || first.includes("과정코드")) {
      section = "courses";
      continue;
    }
    if (first.includes("등급 기준표") || first === "등급") {
      section = "grades";
      continue;
    }
    if (first.includes("자율성과지표 평가 구조") || first === "평가 유형") {
      section = "eval";
      continue;
    }
    // 타이틀/빈 행 스킵
    if (first.startsWith("🎓") || first.startsWith("[") || !first) continue;

    if (section === "courses" && row.length >= 6) {
      courses.push({
        code: row[0]?.trim() || "",
        name: row[1]?.trim() || "",
        cohort: row[2]?.trim() || "",
        startDate: row[3]?.trim() || "",
        endDate: row[4]?.trim() || "",
        totalWeeks: num(row[5]),
        targetStudents: num(row[6]),
        status: row[7]?.trim() || "",
      });
    }
    if (section === "grades" && row.length >= 3 && /^[A-E]$/.test(first)) {
      grades.push({
        grade: first,
        scoreRange: row[1]?.trim() || "",
        description: row[2]?.trim() || "",
        note: row[3]?.trim() || "",
      });
    }
  }
  return { courses, grades };
}

// ── 성취평가 시트 파싱 ──────────────────────────────────────
function parseAchievement(csv: string): AchievementRecord[] {
  const rows = parseCsvRows(csv);
  const records: AchievementRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]?.trim() || isNaN(parseInt(r[0]))) continue;

    records.push({
      no: num(r[0]),
      studentId: r[1]?.trim() || "",
      name: r[2]?.trim() || "",
      course: r[3]?.trim() || "",
      cohort: r[4]?.trim() || "",
      preScores: [num(r[5]), num(r[6]), num(r[7]), num(r[8]), num(r[9]), num(r[10])],
      preTotal: num(r[11]),
      preGrade: r[12]?.trim() || "",
      postScores: [num(r[13]), num(r[14]), num(r[15]), num(r[16]), num(r[17]), num(r[18])],
      postTotal: num(r[19]),
      postGrade: r[20]?.trim() || "",
      improvement: num(r[21]),
      gradeChange: r[22]?.trim() || "",
      status: r[23]?.trim() || "",
    });
  }
  return records;
}

// ── 형성평가 시트 파싱 ──────────────────────────────────────
function parseFormative(csv: string): FormativeRecord[] {
  const rows = parseCsvRows(csv);
  const records: FormativeRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]?.trim() || isNaN(parseInt(r[0]))) continue;

    records.push({
      no: num(r[0]),
      studentId: r[1]?.trim() || "",
      name: r[2]?.trim() || "",
      course: r[3]?.trim() || "",
      cohort: r[4]?.trim() || "",
      phase1Scores: [num(r[5]), num(r[6]), num(r[7]), num(r[8])],
      phase1Avg: num(r[9]),
      phase2Scores: [num(r[10]), num(r[11]), num(r[12]), num(r[13])],
      phase2Avg: num(r[14]),
      overallAvg: num(r[15]),
      status: r[16]?.trim() || "",
    });
  }
  return records;
}

// ── 현업적용평가 시트 파싱 ──────────────────────────────────
function parseFieldApp(csv: string): FieldAppRecord[] {
  const rows = parseCsvRows(csv);
  const records: FieldAppRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]?.trim() || isNaN(parseInt(r[0]))) continue;

    records.push({
      no: num(r[0]),
      studentId: r[1]?.trim() || "",
      name: r[2]?.trim() || "",
      course: r[3]?.trim() || "",
      cohort: r[4]?.trim() || "",
      scores: [num(r[5]), num(r[6]), num(r[7]), num(r[8]), num(r[9]), num(r[10])],
      avgScore: num(r[11]),
      grade: r[12]?.trim() || "",
      status: r[13]?.trim() || "",
    });
  }
  return records;
}

// ── 과정별 집계 시트 파싱 ──────────────────────────────────
function parseSummary(csv: string): {
  achievementSummary: AchievementSummary[];
  formativeSummary: FormativeSummary[];
  fieldAppSummary: FieldAppSummary[];
} {
  const rows = parseCsvRows(csv);
  const achSummary: AchievementSummary[] = [];
  const frmSummary: FormativeSummary[] = [];
  const faSummary: FieldAppSummary[] = [];
  let section: "ach" | "frm" | "fa" | "" = "";

  for (const row of rows) {
    const first = row[0]?.trim() || "";

    if (first.includes("성취평가 집계")) { section = "ach"; continue; }
    if (first.includes("형성평가 집계")) { section = "frm"; continue; }
    if (first.includes("현업적용평가 집계")) { section = "fa"; continue; }
    if (first === "과정" || first === "전체") {
      // "전체" row = 합산 행
      if (first === "과정") continue; // 헤더 스킵
    }

    if (section === "ach" && row.length >= 8 && first) {
      achSummary.push({
        course: first,
        cohort: row[1]?.trim() || "",
        studentCount: num(row[2]),
        preAvg: num(row[3]),
        postAvg: num(row[4]),
        improvement: num(row[5]),
        preGradeA: num(row[6]),
        postGradeA: num(row[7]),
        completed: num(row[8]),
        responseRate: num(row[9]),
      });
    }

    if (section === "frm" && row.length >= 5 && first) {
      frmSummary.push({
        course: first,
        cohort: row[1]?.trim() || "",
        studentCount: num(row[2]),
        phase1Avg: num(row[3]),
        phase2Avg: num(row[4]),
        overallAvg: num(row[5]),
      });
    }

    if (section === "fa" && row.length >= 5 && first) {
      faSummary.push({
        course: first,
        cohort: row[1]?.trim() || "",
        studentCount: num(row[2]),
        avgScore: num(row[3]),
        completed: num(row[4]),
        responseRate: num(row[5]),
      });
    }
  }

  return {
    achievementSummary: achSummary,
    formativeSummary: frmSummary,
    fieldAppSummary: faSummary,
  };
}

// ── 설정 저장/불러오기 ─────────────────────────────────────
export function loadKpiConfig(): KpiConfig {
  try {
    const raw = localStorage.getItem(KPI_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as KpiConfig;
  } catch { /* ignore */ }
  return { webAppUrl: "", spreadsheetId: "" };
}

export function saveKpiConfig(config: KpiConfig): void {
  localStorage.setItem(KPI_CONFIG_KEY, JSON.stringify(config));
}

// ── 메인 데이터 Fetch ─────────────────────────────────────
const SHEET_NAMES = ["설정", "성취평가", "형성평가", "현업적용평가", "과정별_집계"] as const;

/**
 * Apps Script Web App 또는 Published CSV를 통해 전체 KPI 데이터를 가져옵니다.
 */
export async function fetchKpiData(config: KpiConfig): Promise<KpiAllData> {
  // 방법 1: Apps Script Web App URL
  if (config.webAppUrl) {
    return fetchViaAppsScript(config.webAppUrl);
  }

  // 방법 2: 스프레드시트 ID → gviz CSV (publish to web 필요)
  if (config.spreadsheetId) {
    return fetchViaCsv(config.spreadsheetId);
  }

  throw new Error("Google Sheets 연결 정보가 없습니다. 설정에서 URL을 입력하세요.");
}

async function fetchViaAppsScript(webAppUrl: string): Promise<KpiAllData> {
  const url = webAppUrl.includes("?") ? `${webAppUrl}&action=all` : `${webAppUrl}?action=all`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Apps Script 응답 오류: HTTP ${r.status}`);
  const json = await r.json();

  // Apps Script는 2D 배열 형태로 반환 → CSV 문자열로 변환 후 파싱
  const toCsv = (rows: string[][]): string =>
    rows.map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

  const settingsCsv = toCsv(json.settings || []);
  const achievementCsv = toCsv(json.achievement || []);
  const formativeCsv = toCsv(json.formative || []);
  const fieldAppCsv = toCsv(json.fieldApplication || []);
  const summaryCsv = toCsv(json.summary || []);

  const { courses, grades } = parseSettings(settingsCsv);
  const achievement = parseAchievement(achievementCsv);
  const formative = parseFormative(formativeCsv);
  const fieldApp = parseFieldApp(fieldAppCsv);
  const { achievementSummary, formativeSummary, fieldAppSummary } = parseSummary(summaryCsv);

  return { courses, grades, achievement, formative, fieldApp, achievementSummary, formativeSummary, fieldAppSummary };
}

async function fetchViaCsv(spreadsheetId: string): Promise<KpiAllData> {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
  const csvs = await Promise.all(
    SHEET_NAMES.map(name => corsFetch(`${base}&sheet=${encodeURIComponent(name)}`))
  );

  const [settingsCsv, achievementCsv, formativeCsv, fieldAppCsv, summaryCsv] = csvs;

  const { courses, grades } = parseSettings(settingsCsv);
  const achievement = parseAchievement(achievementCsv);
  const formative = parseFormative(formativeCsv);
  const fieldApp = parseFieldApp(fieldAppCsv);
  const { achievementSummary, formativeSummary, fieldAppSummary } = parseSummary(summaryCsv);

  return { courses, grades, achievement, formative, fieldApp, achievementSummary, formativeSummary, fieldAppSummary };
}

/**
 * 연결 테스트 — 첫 시트(설정)만 가져와 봄
 */
export async function testKpiConnection(config: KpiConfig): Promise<{ ok: boolean; message: string; courseCount?: number }> {
  try {
    if (config.webAppUrl) {
      const url = config.webAppUrl.includes("?")
        ? `${config.webAppUrl}&action=settings`
        : `${config.webAppUrl}?action=settings`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      const rows = json.settings || [];
      return { ok: true, message: `연결 성공! (${rows.length}행 로드)`, courseCount: rows.length };
    }
    if (config.spreadsheetId) {
      const base = `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/gviz/tq?tqx=out:csv`;
      const csv = await corsFetch(`${base}&sheet=${encodeURIComponent("설정")}`);
      const { courses } = parseSettings(csv);
      return { ok: true, message: `연결 성공! (${courses.length}개 과정 확인)`, courseCount: courses.length };
    }
    return { ok: false, message: "URL 또는 스프레드시트 ID를 입력하세요." };
  } catch (e) {
    return { ok: false, message: `연결 실패: ${(e as Error).message}` };
  }
}
