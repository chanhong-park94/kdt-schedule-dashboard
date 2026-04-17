/**
 * 매출상세표 양식 (엑셀 통합템플릿 대응)
 *
 * - 엑셀 업로드: 02_매출상세 시트에서 일별 매출 자동 파싱
 * - 과정/기수별 저장 + 드롭다운 전환
 * - 월별 요약 + 시나리오(100/80/75/70%)는 대시보드가 자동 계산
 * - 요일별 훈련시간, 공휴일 제외, 예상/실 수정 가능
 */
import { escapeHtml } from "../core/escape";
import * as XLSX from "xlsx";

// ─── 저장소 키 ───────────────────────────────────────────────

const COHORTS_KEY = "kdt_revenue_cohorts_v1";
const ACTIVE_KEY = "kdt_revenue_active_cohort";
const CONFIG_KEY_V2 = "kdt_revenue_template_config_v2";
const CONFIG_KEY_V1 = "kdt_revenue_template_config_v1";

// ─── 타입 ────────────────────────────────────────────────────

interface DowConfig {
  enabled: boolean;
  hours: number;
}

interface CohortData {
  id: string; // 고유키: `${courseCode}_${cohort}`
  courseName: string;
  courseCode: string;
  cohort: string; // 기수
  fiscalMonth: number | null;
  startDate: string;
  endDate: string;
  hourlyFee: number;
  dowSettings: Record<string, DowConfig>;
  activeCount: number;
  dropoutCount: number;
  writer: string;
  dailyActuals: Record<string, number>;
  dailyExpectedOverrides: Record<string, number>;
}

const DEFAULT_DOW: Record<string, DowConfig> = {
  "1": { enabled: true, hours: 2.5 },
  "2": { enabled: true, hours: 2.5 },
  "3": { enabled: true, hours: 2.5 },
  "4": { enabled: true, hours: 2.5 },
  "5": { enabled: true, hours: 2.5 },
  "6": { enabled: true, hours: 7 },
};

function newCohort(overrides?: Partial<CohortData>): CohortData {
  return {
    id: "__new__",
    courseName: "",
    courseCode: "",
    cohort: "",
    fiscalMonth: null,
    startDate: "",
    endDate: "",
    hourlyFee: 18150,
    dowSettings: JSON.parse(JSON.stringify(DEFAULT_DOW)),
    activeCount: 0,
    dropoutCount: 0,
    writer: "",
    dailyActuals: {},
    dailyExpectedOverrides: {},
    ...overrides,
  };
}

// ─── 상태 ────────────────────────────────────────────────────

let cohorts: CohortData[] = [];
let activeCohortId: string = "__new__";
let current: CohortData = newCohort();
let initialized = false;

// ─── 저장/복원 ───────────────────────────────────────────────

function loadCohorts(): CohortData[] {
  try {
    const raw = localStorage.getItem(COHORTS_KEY);
    if (raw) return JSON.parse(raw) as CohortData[];
  } catch { /* ignore */ }

  // v2 마이그레이션
  try {
    const raw = localStorage.getItem(CONFIG_KEY_V2) || localStorage.getItem(CONFIG_KEY_V1);
    if (raw) {
      const old = JSON.parse(raw) as Record<string, unknown>;
      if (old.courseName || old.courseCode) {
        const migrated = newCohort({
          id: `${old.courseCode || "manual"}_${old.cohort || "1"}`,
          courseName: (old.courseName as string) || "",
          courseCode: (old.courseCode as string) || "",
          cohort: (old.cohort as string) || "1",
          fiscalMonth: (old.fiscalMonth as number | null) ?? null,
          startDate: (old.startDate as string) || "",
          endDate: (old.endDate as string) || "",
          hourlyFee: (old.hourlyFee as number) || 18150,
          activeCount: (old.activeCount as number) || 0,
          dropoutCount: (old.dropoutCount as number) || 0,
          writer: (old.writer as string) || "",
          dailyActuals: (old.dailyActuals as Record<string, number>) || {},
          dailyExpectedOverrides: (old.dailyExpectedOverrides as Record<string, number>) || {},
        });
        // dowSettings 마이그레이션
        if (old.dowSettings) {
          migrated.dowSettings = old.dowSettings as Record<string, DowConfig>;
        } else if (typeof old.weekdayHours === "number") {
          const wh = old.weekdayHours as number;
          const sh = (old.saturdayHours as number) || 7;
          for (let d = 1; d <= 5; d++) migrated.dowSettings[String(d)] = { enabled: true, hours: wh };
          migrated.dowSettings["6"] = { enabled: true, hours: sh };
        }
        return [migrated];
      }
    }
  } catch { /* ignore */ }

  return [];
}

function saveCohorts(): void {
  try {
    localStorage.setItem(COHORTS_KEY, JSON.stringify(cohorts));
    localStorage.setItem(ACTIVE_KEY, activeCohortId);
  } catch (e) {
    console.warn("[RevenueTemplate] 저장 실패:", e);
  }
}

function loadActiveCohortId(): string {
  return localStorage.getItem(ACTIVE_KEY) || "__new__";
}

// ─── 유틸 ────────────────────────────────────────────────────

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function fmtWon(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₩0";
  const sign = n < 0 ? "-" : "";
  return `${sign}₩${Math.abs(Math.round(n)).toLocaleString()}`;
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

// ─── 한국 공휴일 ────────────────────────────────────────────

function getKoreanHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => holidays.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  add(1, 1); add(3, 1); add(5, 5); add(6, 6); add(8, 15); add(10, 3); add(10, 9); add(12, 25);
  const lunar: Record<number, string[]> = {
    2025: ["2025-01-28","2025-01-29","2025-01-30","2025-05-05","2025-10-05","2025-10-06","2025-10-07"],
    2026: ["2026-02-16","2026-02-17","2026-02-18","2026-05-24","2026-09-24","2026-09-25","2026-09-26"],
    2027: ["2027-02-06","2027-02-07","2027-02-08","2027-05-13","2027-10-14","2027-10-15","2027-10-16"],
  };
  if (lunar[year]) for (const d of lunar[year]) holidays.add(d);
  return holidays;
}

let _holidayCache: { year: number; set: Set<string> } | null = null;
function isHoliday(d: Date): boolean {
  const y = d.getFullYear();
  if (!_holidayCache || _holidayCache.year !== y) _holidayCache = { year: y, set: getKoreanHolidays(y) };
  return _holidayCache.set.has(fmtDate(d));
}

// ─── 계산 ────────────────────────────────────────────────────

interface FiscalRange { start: Date; end: Date; }

function calcFiscalRange(): FiscalRange | null {
  if (!current.fiscalMonth) return null;
  const s = parseDate(current.startDate);
  const e = parseDate(current.endDate);
  if (!s || !e) return null;
  const year = current.fiscalMonth >= s.getMonth() + 1
    ? s.getFullYear()
    : s.getFullYear() + (current.fiscalMonth < s.getMonth() + 1 ? 1 : 0);
  const monthStart = new Date(year, current.fiscalMonth - 1, 1);
  const monthEnd = new Date(year, current.fiscalMonth, 0);
  const rangeStart = monthStart < s ? s : monthStart;
  const rangeEnd = monthEnd > e ? e : monthEnd;
  if (rangeStart > rangeEnd) return null;
  return { start: rangeStart, end: rangeEnd };
}

function listTrainingDays(range: FiscalRange): Date[] {
  const days: Date[] = [];
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    const dow = cursor.getDay();
    const cfg = current.dowSettings[String(dow)];
    if (cfg?.enabled && !isHoliday(cursor)) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function dowUnitPrice(dow: number): number {
  const cfg = current.dowSettings[String(dow)];
  return cfg?.enabled ? Math.round(current.hourlyFee * cfg.hours) : 0;
}

function dailyExpectedCalc(d: Date): number {
  return dowUnitPrice(d.getDay()) * Math.max(0, current.activeCount);
}

function dailyExpected(d: Date): number {
  const override = current.dailyExpectedOverrides[fmtDate(d)];
  if (typeof override === "number" && Number.isFinite(override)) return override;
  return dailyExpectedCalc(d);
}

// ─── 엑셀 파싱 ──────────────────────────────────────────────

function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial) - 25569;
  return new Date(utcDays * 86400 * 1000);
}

function parseExcel(buf: ArrayBuffer): CohortData[] {
  const wb = XLSX.read(buf, { type: "array" });
  const results: CohortData[] = [];

  // 00_개요에서 과정 메타 추출
  let courseName = "";
  let courseCode = "";
  let cohortStr = "";
  let hourlyFee = 18150;

  const overviewSheet = wb.Sheets["00_개요"];
  if (overviewSheet) {
    const aoa = XLSX.utils.sheet_to_json(overviewSheet, { header: 1, raw: false, defval: "" }) as string[][];
    courseName = aoa[3]?.[1] || "";
    courseCode = aoa[4]?.[1] || "";
    cohortStr = (aoa[5]?.[1] || "").replace(/[^0-9]/g, "") || "1";
    const feeStr = (aoa[11]?.[1] || "").replace(/[^0-9]/g, "");
    if (feeStr) hourlyFee = parseInt(feeStr, 10);
  }

  // 02_ 시트들에서 일별 데이터 추출
  const dailySheets = wb.SheetNames.filter((s) => s.startsWith("02"));

  for (const sheetName of dailySheets) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][];

    // R2 메타: [시간당 훈련비, 18150, 액티브인원, 56, 회계월, 4, ...]
    const metaRow = aoa[1] || [];
    const sheetActiveCount = typeof metaRow[3] === "number" ? metaRow[3] : 0;
    const sheetFiscalMonth = typeof metaRow[5] === "number" ? metaRow[5] : null;
    const sheetHourlyFee = typeof metaRow[1] === "number" ? metaRow[1] : hourlyFee;

    // 단위기간 번호 추출 (시트명에서)
    const periodMatch = sheetName.match(/(\d+)단위기간/);
    const periodNum = periodMatch ? periodMatch[1] : "1";

    const dailyActuals: Record<string, number> = {};
    const dailyExpectedOverrides: Record<string, number> = {};

    // R4~ 데이터 행 (일자, 예상, 실, 차액, 인원, 작성자)
    let writer = "";
    for (let i = 3; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row || !row[0]) continue;
      const dateVal = row[0];
      if (typeof dateVal !== "number" || dateVal < 40000) continue; // 유효한 Excel serial date만

      const d = excelSerialToDate(dateVal);
      const dateStr = fmtDate(d);
      const expectedVal = typeof row[1] === "number" ? row[1] : 0;
      const actualVal = typeof row[2] === "number" ? row[2] : 0;

      if (expectedVal > 0) dailyExpectedOverrides[dateStr] = expectedVal;
      if (actualVal > 0) dailyActuals[dateStr] = actualVal;
      if (!writer && typeof row[5] === "string" && row[5].trim()) writer = row[5].trim();
    }

    const id = `${courseCode || "upload"}_${cohortStr}_P${periodNum}`;
    const label = periodNum === "1" ? "" : ` (${periodNum}단위기간)`;

    results.push(newCohort({
      id,
      courseName: courseName + label,
      courseCode,
      cohort: cohortStr,
      fiscalMonth: sheetFiscalMonth,
      hourlyFee: sheetHourlyFee,
      activeCount: sheetActiveCount as number,
      writer,
      dailyActuals,
      dailyExpectedOverrides,
    }));
  }

  return results;
}

// ─── 드롭다운 관리 ──────────────────────────────────────────

function renderCohortDropdown(): void {
  const select = $("revTplCohortSelect") as HTMLSelectElement | null;
  const deleteBtn = $("revTplDeleteCohortBtn");
  if (!select) return;

  select.innerHTML = `<option value="__new__">+ 새 과정/기수 (수기 입력)</option>`;
  for (const c of cohorts) {
    const label = `${c.courseName || c.courseCode || "미명"} ${c.cohort ? c.cohort + "기" : ""}`.trim();
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = activeCohortId;

  if (deleteBtn) deleteBtn.style.display = activeCohortId !== "__new__" ? "" : "none";
}

function switchCohort(id: string): void {
  activeCohortId = id;
  if (id === "__new__") {
    current = newCohort();
  } else {
    const found = cohorts.find((c) => c.id === id);
    current = found ? { ...found } : newCohort();
  }
  applyConfigToInputs();
  saveCohorts();
  rerender();
  renderCohortDropdown();
}

function saveCurrent(): void {
  if (activeCohortId !== "__new__") {
    const idx = cohorts.findIndex((c) => c.id === activeCohortId);
    if (idx >= 0) cohorts[idx] = { ...current };
  }
  saveCohorts();
}

// ─── 렌더링 ──────────────────────────────────────────────────

function renderMetaSummary(range: FiscalRange | null, days: Date[]): void {
  const weekdayEl = $("revTplWeekdayUnit");
  const saturdayEl = $("revTplSaturdayUnit");
  const daysEl = $("revTplTrainingDays");
  const satEl = $("revTplSaturdayCount");
  if (weekdayEl) weekdayEl.textContent = fmtWon(dowUnitPrice(1));
  if (saturdayEl) saturdayEl.textContent = fmtWon(dowUnitPrice(6));
  if (daysEl) daysEl.textContent = range ? `${days.length}일` : "-";
  if (satEl) {
    const satCount = days.filter((d) => d.getDay() === 6).length;
    satEl.textContent = range ? `${satCount}일` : "-";
  }
}

function renderMonthlyRow(days: Date[], totalExpected: number, totalActual: number): void {
  const set = (id: string, txt: string) => { const el = $(id); if (el) el.textContent = txt; };
  set("revTplCellMonth", current.fiscalMonth ? `${current.fiscalMonth}월` : "-");
  set("revTplCellDays", days.length > 0 ? `${days.length}일` : "-");
  set("revTplCellActive", current.activeCount > 0 ? `${current.activeCount}명` : "-");
  set("revTplCellDropout", current.dropoutCount >= 0 ? `${current.dropoutCount}명` : "-");
  set("revTplCell100", totalExpected > 0 ? fmtWon(totalExpected) : "-");
  set("revTplCell80", totalExpected > 0 ? fmtWon(totalExpected * 0.8) : "-");
  set("revTplCell75", totalExpected > 0 ? fmtWon(totalExpected * 0.75) : "-");
  set("revTplCell70", totalExpected > 0 ? fmtWon(totalExpected * 0.7) : "-");
  set("revTplCellActual", totalActual > 0 ? fmtWon(totalActual) : "-");
}

function renderDailyTable(days: Date[]): { totalExpected: number; totalActual: number } {
  const body = $("revTplDailyBody");
  const foot = $("revTplDailyFoot");
  if (!body) return { totalExpected: 0, totalActual: 0 };

  // 날짜가 없는 경우: dailyActuals/dailyExpectedOverrides에서 날짜 추출
  let renderDays = days;
  if (days.length === 0 && (Object.keys(current.dailyActuals).length > 0 || Object.keys(current.dailyExpectedOverrides).length > 0)) {
    const allDates = new Set([...Object.keys(current.dailyActuals), ...Object.keys(current.dailyExpectedOverrides)]);
    renderDays = [...allDates].sort().map((d) => new Date(d));
  }

  if (renderDays.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="u-text-muted u-text-center u-py-8">
      상단 기본 정보를 입력하거나 엑셀을 업로드하면 일별 매출이 표시됩니다.
    </td></tr>`;
    if (foot) foot.innerHTML = "";
    return { totalExpected: 0, totalActual: 0 };
  }

  let totalExpected = 0;
  let totalActual = 0;

  const rows = renderDays.map((d) => {
    const dateStr = fmtDate(d);
    const dow = d.getDay();
    const expected = dailyExpected(d);
    const hasOverride = dateStr in current.dailyExpectedOverrides;
    const actualRaw = current.dailyActuals[dateStr];
    const actual = typeof actualRaw === "number" && Number.isFinite(actualRaw) ? actualRaw : null;
    const diff = actual !== null ? actual - expected : null;
    totalExpected += expected;
    if (actual !== null) totalActual += actual;

    const dowLabel = DOW_LABEL[dow] || "?";
    const isWeekend = dow === 6 ? " rev-template-row-saturday" : "";
    const diffClass = diff === null ? "" : diff < 0 ? "rev-template-diff-neg" : diff > 0 ? "rev-template-diff-pos" : "";
    const overrideClass = hasOverride ? " rev-template-override" : "";

    return `<tr class="rev-template-daily-row${isWeekend}" data-date="${dateStr}">
      <td>${dateStr}</td>
      <td>${dowLabel}</td>
      <td class="rev-template-amt${overrideClass}">
        <input type="number" class="rev-template-expected-input" data-date="${dateStr}" value="${expected}" placeholder="0" />
      </td>
      <td class="rev-template-amt">
        <input type="number" class="rev-template-actual-input" data-date="${dateStr}" value="${actual !== null ? actual : ""}" placeholder="0" />
      </td>
      <td class="rev-template-amt ${diffClass}">${diff === null ? "-" : fmtWon(diff)}</td>
      <td>${current.activeCount || "-"}</td>
      <td>${current.writer ? escapeHtml(current.writer) : "-"}</td>
    </tr>`;
  });

  body.innerHTML = rows.join("");

  if (foot) {
    const totalDiff = totalActual - totalExpected;
    const diffClass = totalDiff < 0 ? "rev-template-diff-neg" : totalDiff > 0 ? "rev-template-diff-pos" : "";
    foot.innerHTML = `<tr class="rev-template-daily-total">
      <td colspan="2">합계</td>
      <td class="rev-template-amt">${fmtWon(totalExpected)}</td>
      <td class="rev-template-amt">${fmtWon(totalActual)}</td>
      <td class="rev-template-amt ${diffClass}">${fmtWon(totalDiff)}</td>
      <td colspan="2"></td>
    </tr>`;
  }

  // 예상일매출 input
  body.querySelectorAll<HTMLInputElement>(".rev-template-expected-input").forEach((input) => {
    input.addEventListener("change", () => {
      const date = input.dataset.date || "";
      if (!date) return;
      const v = parseFloat(input.value);
      const autoVal = dailyExpectedCalc(new Date(date));
      if (Number.isFinite(v) && Math.round(v) !== Math.round(autoVal)) {
        current.dailyExpectedOverrides[date] = v;
      } else {
        delete current.dailyExpectedOverrides[date];
      }
      saveCurrent();
      rerender();
    });
  });

  // 실일매출 input
  body.querySelectorAll<HTMLInputElement>(".rev-template-actual-input").forEach((input) => {
    input.addEventListener("change", () => {
      const date = input.dataset.date || "";
      const v = parseFloat(input.value);
      if (!date) return;
      if (Number.isFinite(v) && v > 0) {
        current.dailyActuals[date] = v;
      } else {
        delete current.dailyActuals[date];
      }
      saveCurrent();
      rerender();
    });
  });

  return { totalExpected, totalActual };
}

// ─── 통합 렌더 ───────────────────────────────────────────────

function rerender(): void {
  const range = calcFiscalRange();
  const days = range ? listTrainingDays(range) : [];
  renderMetaSummary(range, days);
  const { totalExpected, totalActual } = renderDailyTable(days);
  renderMonthlyRow(days, totalExpected, totalActual);
}

// ─── 수기 입력 바인딩 ────────────────────────────────────────

interface FieldBinding { id: string; key: keyof CohortData; type: "string" | "number" | "int"; }

const FIELD_BINDINGS: FieldBinding[] = [
  { id: "revTplCourseName", key: "courseName", type: "string" },
  { id: "revTplCourseCode", key: "courseCode", type: "string" },
  { id: "revTplFiscalMonth", key: "fiscalMonth", type: "int" },
  { id: "revTplStartDate", key: "startDate", type: "string" },
  { id: "revTplEndDate", key: "endDate", type: "string" },
  { id: "revTplHourlyFee", key: "hourlyFee", type: "number" },
  { id: "revTplActiveCount", key: "activeCount", type: "int" },
  { id: "revTplDropoutCount", key: "dropoutCount", type: "int" },
  { id: "revTplWriter", key: "writer", type: "string" },
];

const DOW_IDS: { dow: string; checkId: string; hoursId: string }[] = [
  { dow: "1", checkId: "revTplDowMon", hoursId: "revTplHoursMon" },
  { dow: "2", checkId: "revTplDowTue", hoursId: "revTplHoursTue" },
  { dow: "3", checkId: "revTplDowWed", hoursId: "revTplHoursWed" },
  { dow: "4", checkId: "revTplDowThu", hoursId: "revTplHoursThu" },
  { dow: "5", checkId: "revTplDowFri", hoursId: "revTplHoursFri" },
  { dow: "6", checkId: "revTplDowSat", hoursId: "revTplHoursSat" },
];

function applyConfigToInputs(): void {
  for (const b of FIELD_BINDINGS) {
    const el = $(b.id) as HTMLInputElement | null;
    if (!el) continue;
    const v = current[b.key];
    el.value = v === null || v === undefined ? "" : String(v);
  }
  for (const d of DOW_IDS) {
    const check = $(d.checkId) as HTMLInputElement | null;
    const hours = $(d.hoursId) as HTMLInputElement | null;
    const cfg = current.dowSettings[d.dow] || DEFAULT_DOW[d.dow];
    if (check) check.checked = cfg.enabled;
    if (hours) hours.value = String(cfg.hours);
  }
}

function bindInputs(): void {
  for (const b of FIELD_BINDINGS) {
    const el = $(b.id) as HTMLInputElement | null;
    if (!el) continue;
    el.addEventListener("input", () => {
      const raw = el.value.trim();
      if (b.type === "string") {
        (current[b.key] as unknown as string) = raw;
      } else if (b.type === "number") {
        const n = parseFloat(raw);
        (current[b.key] as unknown as number) = Number.isFinite(n) ? n : 0;
      } else {
        const n = parseInt(raw, 10);
        if (b.key === "fiscalMonth") {
          (current[b.key] as unknown as number | null) = Number.isFinite(n) ? n : null;
        } else {
          (current[b.key] as unknown as number) = Number.isFinite(n) ? n : 0;
        }
      }
      saveCurrent();
      rerender();
    });
  }

  for (const d of DOW_IDS) {
    const check = $(d.checkId) as HTMLInputElement | null;
    const hours = $(d.hoursId) as HTMLInputElement | null;
    if (check) {
      check.addEventListener("change", () => {
        if (!current.dowSettings[d.dow]) current.dowSettings[d.dow] = { ...DEFAULT_DOW[d.dow] };
        current.dowSettings[d.dow].enabled = check.checked;
        saveCurrent();
        rerender();
      });
    }
    if (hours) {
      hours.addEventListener("input", () => {
        if (!current.dowSettings[d.dow]) current.dowSettings[d.dow] = { ...DEFAULT_DOW[d.dow] };
        const v = parseFloat(hours.value);
        current.dowSettings[d.dow].hours = Number.isFinite(v) ? v : 0;
        saveCurrent();
        rerender();
      });
    }
  }
}

// ─── 초기화 ──────────────────────────────────────────────────

export function initRevenueTemplate(): void {
  if (initialized) return;
  const sectionEl = $("revTemplateSection");
  if (!sectionEl) return;
  initialized = true;

  cohorts = loadCohorts();
  activeCohortId = loadActiveCohortId();

  // 활성 과정 로드
  if (activeCohortId !== "__new__") {
    const found = cohorts.find((c) => c.id === activeCohortId);
    if (found) current = { ...found };
  }

  renderCohortDropdown();
  applyConfigToInputs();
  bindInputs();

  // 드롭다운 전환
  ($("revTplCohortSelect") as HTMLSelectElement)?.addEventListener("change", (e) => {
    const id = (e.target as HTMLSelectElement).value;
    switchCohort(id);
  });

  // 엑셀 업로드
  ($("revTplUploadInput") as HTMLInputElement)?.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const parsed = parseExcel(buf);
      if (parsed.length === 0) {
        alert("엑셀에서 매출 데이터를 찾을 수 없습니다.\n02_매출상세 시트가 있는지 확인해주세요.");
        return;
      }

      // 기존 과정과 같은 id가 있으면 덮어쓰기
      for (const p of parsed) {
        const existingIdx = cohorts.findIndex((c) => c.id === p.id);
        if (existingIdx >= 0) {
          cohorts[existingIdx] = p;
        } else {
          cohorts.push(p);
        }
      }

      // 첫 번째 파싱 결과를 활성으로
      activeCohortId = parsed[0].id;
      current = { ...parsed[0] };

      saveCohorts();
      renderCohortDropdown();
      applyConfigToInputs();
      rerender();

      const names = parsed.map((p) => p.courseName || p.id).join(", ");
      alert(`✅ ${parsed.length}개 시트 업로드 완료\n${names}`);
    } catch (err) {
      console.error("[RevenueTemplate] 엑셀 파싱 실패:", err);
      alert("엑셀 파싱에 실패했습니다. 파일 형식을 확인해주세요.");
    }

    // input 초기화 (같은 파일 재업로드 가능하게)
    (e.target as HTMLInputElement).value = "";
  });

  // 삭제
  $("revTplDeleteCohortBtn")?.addEventListener("click", () => {
    if (activeCohortId === "__new__") return;
    const found = cohorts.find((c) => c.id === activeCohortId);
    const label = found ? `${found.courseName} ${found.cohort}기` : activeCohortId;
    if (!confirm(`"${label}" 매출 데이터를 삭제할까요?`)) return;
    cohorts = cohorts.filter((c) => c.id !== activeCohortId);
    switchCohort("__new__");
  });

  // 재생성
  $("revTplRegenBtn")?.addEventListener("click", () => rerender());

  rerender();
}
