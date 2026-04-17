/**
 * 매출상세표 양식 (엑셀 통합템플릿 대응)
 *
 * 01_매출관리 (회계월 요약 + 시나리오 예측 100/80/75/70%)
 * 02_매출상세 (일별 예상/실일매출/차액)
 *
 * - 요일별 훈련시간 설정 (월~토 개별 체크 + 시간)
 * - 공휴일 자동 제외
 * - 예상일매출/실일매출 모두 수기 수정 가능
 */
import { escapeHtml } from "../core/escape";

const STORAGE_KEY = "kdt_revenue_template_config_v2";
const STORAGE_KEY_V1 = "kdt_revenue_template_config_v1";

// ─── 요일별 설정 (0=일, 1=월, ..., 6=토) ─────────────────────

interface DowConfig {
  enabled: boolean;
  hours: number;
}

interface TemplateConfig {
  courseName: string;
  courseCode: string;
  fiscalMonth: number | null;
  startDate: string;
  endDate: string;
  hourlyFee: number;
  // 요일별 훈련 활성화 + 시간 (dow 1~6, 일요일은 항상 비활성)
  dowSettings: Record<string, DowConfig>; // "1"~"6"
  activeCount: number;
  dropoutCount: number;
  writer: string;
  dailyActuals: Record<string, number>; // date → 실일매출
  dailyExpectedOverrides: Record<string, number>; // date → 예상일매출 수동 덮어쓰기
}

const DEFAULT_DOW: Record<string, DowConfig> = {
  "1": { enabled: true, hours: 2.5 },
  "2": { enabled: true, hours: 2.5 },
  "3": { enabled: true, hours: 2.5 },
  "4": { enabled: true, hours: 2.5 },
  "5": { enabled: true, hours: 2.5 },
  "6": { enabled: true, hours: 7 },
};

const DEFAULT_CONFIG: TemplateConfig = {
  courseName: "",
  courseCode: "",
  fiscalMonth: null,
  startDate: "",
  endDate: "",
  hourlyFee: 18150,
  dowSettings: { ...DEFAULT_DOW },
  activeCount: 0,
  dropoutCount: 0,
  writer: "",
  dailyActuals: {},
  dailyExpectedOverrides: {},
};

let config: TemplateConfig = { ...DEFAULT_CONFIG };
let initialized = false;

// ─── 저장/복원 ───────────────────────────────────────────────

function loadConfig(): TemplateConfig {
  try {
    // v2 먼저 시도
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // v1 마이그레이션
      raw = localStorage.getItem(STORAGE_KEY_V1);
      if (raw) {
        const v1 = JSON.parse(raw) as Record<string, unknown>;
        const wh = typeof v1.weekdayHours === "number" ? v1.weekdayHours : 2.5;
        const sh = typeof v1.saturdayHours === "number" ? v1.saturdayHours : 7;
        const migrated: TemplateConfig = {
          ...DEFAULT_CONFIG,
          courseName: (v1.courseName as string) || "",
          courseCode: (v1.courseCode as string) || "",
          fiscalMonth: (v1.fiscalMonth as number | null) ?? null,
          startDate: (v1.startDate as string) || "",
          endDate: (v1.endDate as string) || "",
          hourlyFee: (v1.hourlyFee as number) || 18150,
          dowSettings: {
            "1": { enabled: true, hours: wh },
            "2": { enabled: true, hours: wh },
            "3": { enabled: true, hours: wh },
            "4": { enabled: true, hours: wh },
            "5": { enabled: true, hours: wh },
            "6": { enabled: true, hours: sh },
          },
          activeCount: (v1.activeCount as number) || 0,
          dropoutCount: (v1.dropoutCount as number) || 0,
          writer: (v1.writer as string) || "",
          dailyActuals: (v1.dailyActuals as Record<string, number>) || {},
          dailyExpectedOverrides: {},
        };
        return migrated;
      }
      return { ...DEFAULT_CONFIG, dowSettings: JSON.parse(JSON.stringify(DEFAULT_DOW)) };
    }
    const parsed = JSON.parse(raw) as Partial<TemplateConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      dowSettings: parsed.dowSettings || JSON.parse(JSON.stringify(DEFAULT_DOW)),
      dailyActuals: parsed.dailyActuals || {},
      dailyExpectedOverrides: parsed.dailyExpectedOverrides || {},
    };
  } catch {
    return { ...DEFAULT_CONFIG, dowSettings: JSON.parse(JSON.stringify(DEFAULT_DOW)) };
  }
}

function saveConfig(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn("[RevenueTemplate] 저장 실패:", e);
  }
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

  // 양력 고정 공휴일
  add(1, 1);   // 신정
  add(3, 1);   // 삼일절
  add(5, 5);   // 어린이날
  add(6, 6);   // 현충일
  add(8, 15);  // 광복절
  add(10, 3);  // 개천절
  add(10, 9);  // 한글날
  add(12, 25); // 크리스마스

  // 음력 공휴일 (2025~2027 하드코딩 — 정확도 보장)
  const lunarHolidays: Record<number, string[]> = {
    2025: [
      "2025-01-28", "2025-01-29", "2025-01-30", // 설날 연휴
      "2025-05-05", // 석가탄신일 (어린이날과 겹침)
      "2025-10-05", "2025-10-06", "2025-10-07", // 추석 연휴
    ],
    2026: [
      "2026-02-16", "2026-02-17", "2026-02-18", // 설날 연휴
      "2026-05-24", // 석가탄신일
      "2026-09-24", "2026-09-25", "2026-09-26", // 추석 연휴
    ],
    2027: [
      "2027-02-06", "2027-02-07", "2027-02-08", // 설날 연휴
      "2027-05-13", // 석가탄신일
      "2027-10-14", "2027-10-15", "2027-10-16", // 추석 연휴
    ],
  };

  if (lunarHolidays[year]) {
    for (const d of lunarHolidays[year]) holidays.add(d);
  }

  return holidays;
}

let _holidayCache: { year: number; set: Set<string> } | null = null;
function isHoliday(d: Date): boolean {
  const y = d.getFullYear();
  if (!_holidayCache || _holidayCache.year !== y) {
    _holidayCache = { year: y, set: getKoreanHolidays(y) };
  }
  return _holidayCache.set.has(fmtDate(d));
}

// ─── 계산 ────────────────────────────────────────────────────

interface FiscalRange {
  start: Date;
  end: Date;
}

function calcFiscalRange(): FiscalRange | null {
  if (!config.fiscalMonth) return null;
  const s = parseDate(config.startDate);
  const e = parseDate(config.endDate);
  if (!s || !e) return null;

  const year =
    config.fiscalMonth >= s.getMonth() + 1
      ? s.getFullYear()
      : s.getFullYear() + (config.fiscalMonth < s.getMonth() + 1 ? 1 : 0);

  const monthStart = new Date(year, config.fiscalMonth - 1, 1);
  const monthEnd = new Date(year, config.fiscalMonth, 0);

  const rangeStart = monthStart < s ? s : monthStart;
  const rangeEnd = monthEnd > e ? e : monthEnd;

  if (rangeStart > rangeEnd) return null;
  return { start: rangeStart, end: rangeEnd };
}

/** 훈련일 목록: 활성화된 요일만 + 공휴일 제외 */
function listTrainingDays(range: FiscalRange): Date[] {
  const days: Date[] = [];
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    const dow = cursor.getDay();
    const dowCfg = config.dowSettings[String(dow)];
    if (dowCfg?.enabled && !isHoliday(cursor)) {
      days.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function dowUnitPrice(dow: number): number {
  const cfg = config.dowSettings[String(dow)];
  if (!cfg?.enabled) return 0;
  return Math.round(config.hourlyFee * cfg.hours);
}

function dailyExpectedCalc(d: Date): number {
  return dowUnitPrice(d.getDay()) * Math.max(0, config.activeCount);
}

/** 예상일매출: 수동 덮어쓰기 있으면 그 값, 없으면 자동 계산 */
function dailyExpected(d: Date): number {
  const override = config.dailyExpectedOverrides[fmtDate(d)];
  if (typeof override === "number" && Number.isFinite(override)) return override;
  return dailyExpectedCalc(d);
}

// ─── 렌더링 ──────────────────────────────────────────────────

function renderMetaSummary(range: FiscalRange | null, days: Date[]): void {
  const weekdayEl = $("revTplWeekdayUnit");
  const saturdayEl = $("revTplSaturdayUnit");
  const daysEl = $("revTplTrainingDays");
  const satEl = $("revTplSaturdayCount");

  // 평일 대표 단가 = 월요일 기준
  if (weekdayEl) weekdayEl.textContent = fmtWon(dowUnitPrice(1));
  if (saturdayEl) saturdayEl.textContent = fmtWon(dowUnitPrice(6));
  if (daysEl) daysEl.textContent = range ? `${days.length}일` : "-";
  if (satEl) {
    const satCount = days.filter((d) => d.getDay() === 6).length;
    satEl.textContent = range ? `${satCount}일` : "-";
  }
}

function renderMonthlyRow(days: Date[], totalExpected: number, totalActual: number): void {
  const monthEl = $("revTplCellMonth");
  const daysEl = $("revTplCellDays");
  const activeEl = $("revTplCellActive");
  const dropoutEl = $("revTplCellDropout");
  const cell100 = $("revTplCell100");
  const cell80 = $("revTplCell80");
  const cell75 = $("revTplCell75");
  const cell70 = $("revTplCell70");
  const cellActual = $("revTplCellActual");

  if (monthEl) monthEl.textContent = config.fiscalMonth ? `${config.fiscalMonth}월` : "-";
  if (daysEl) daysEl.textContent = days.length > 0 ? `${days.length}일` : "-";
  if (activeEl) activeEl.textContent = config.activeCount > 0 ? `${config.activeCount}명` : "-";
  if (dropoutEl) dropoutEl.textContent = config.dropoutCount >= 0 ? `${config.dropoutCount}명` : "-";

  if (cell100) cell100.textContent = totalExpected > 0 ? fmtWon(totalExpected) : "-";
  if (cell80) cell80.textContent = totalExpected > 0 ? fmtWon(totalExpected * 0.8) : "-";
  if (cell75) cell75.textContent = totalExpected > 0 ? fmtWon(totalExpected * 0.75) : "-";
  if (cell70) cell70.textContent = totalExpected > 0 ? fmtWon(totalExpected * 0.7) : "-";
  if (cellActual) cellActual.textContent = totalActual > 0 ? fmtWon(totalActual) : "-";
}

function renderDailyTable(days: Date[]): { totalExpected: number; totalActual: number } {
  const body = $("revTplDailyBody");
  const foot = $("revTplDailyFoot");
  if (!body) return { totalExpected: 0, totalActual: 0 };

  if (days.length === 0) {
    body.innerHTML = `<tr>
      <td colspan="7" class="u-text-muted u-text-center u-py-8">
        상단 기본 정보를 입력하면 회계월 범위의 일별 예상매출이 자동 생성됩니다.
      </td>
    </tr>`;
    if (foot) foot.innerHTML = "";
    return { totalExpected: 0, totalActual: 0 };
  }

  let totalExpected = 0;
  let totalActual = 0;

  const rows = days.map((d) => {
    const dateStr = fmtDate(d);
    const dow = d.getDay();
    const expected = dailyExpected(d);
    const hasExpectedOverride = dateStr in config.dailyExpectedOverrides;
    const actualRaw = config.dailyActuals[dateStr];
    const actual = typeof actualRaw === "number" && Number.isFinite(actualRaw) ? actualRaw : null;
    const diff = actual !== null ? actual - expected : null;
    totalExpected += expected;
    if (actual !== null) totalActual += actual;

    const dowLabel = DOW_LABEL[dow];
    const isWeekend = dow === 6 ? " rev-template-row-saturday" : "";
    const diffClass = diff === null ? "" : diff < 0 ? "rev-template-diff-neg" : diff > 0 ? "rev-template-diff-pos" : "";
    const overrideClass = hasExpectedOverride ? " rev-template-override" : "";

    return `<tr class="rev-template-daily-row${isWeekend}" data-date="${dateStr}">
      <td>${dateStr}</td>
      <td>${dowLabel}</td>
      <td class="rev-template-amt${overrideClass}">
        <input type="number" class="rev-template-expected-input" data-date="${dateStr}"
          value="${expected}" placeholder="0" aria-label="${dateStr} 예상일매출" />
      </td>
      <td class="rev-template-amt">
        <input type="number" class="rev-template-actual-input" data-date="${dateStr}"
          value="${actual !== null ? actual : ""}" placeholder="0" aria-label="${dateStr} 실일매출" />
      </td>
      <td class="rev-template-amt ${diffClass}">${diff === null ? "-" : fmtWon(diff)}</td>
      <td>${config.activeCount || "-"}</td>
      <td>${config.writer ? escapeHtml(config.writer) : "-"}</td>
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

  // 예상일매출 input 바인딩
  body.querySelectorAll<HTMLInputElement>(".rev-template-expected-input").forEach((input) => {
    input.addEventListener("change", () => {
      const date = input.dataset.date || "";
      if (!date) return;
      const v = parseFloat(input.value);
      const autoVal = dailyExpectedCalc(new Date(date));
      if (Number.isFinite(v) && Math.round(v) !== Math.round(autoVal)) {
        config.dailyExpectedOverrides[date] = v;
      } else {
        delete config.dailyExpectedOverrides[date];
      }
      saveConfig();
      rerender();
    });
  });

  // 실일매출 input 바인딩
  body.querySelectorAll<HTMLInputElement>(".rev-template-actual-input").forEach((input) => {
    input.addEventListener("change", () => {
      const date = input.dataset.date || "";
      const v = parseFloat(input.value);
      if (!date) return;
      if (Number.isFinite(v) && v > 0) {
        config.dailyActuals[date] = v;
      } else {
        delete config.dailyActuals[date];
      }
      saveConfig();
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

interface FieldBinding {
  id: string;
  key: keyof TemplateConfig;
  type: "string" | "number" | "int";
}

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

// 요일별 체크박스/시간 ID 매핑
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
    const v = config[b.key];
    el.value = v === null || v === undefined ? "" : String(v);
  }

  // 요일별 체크박스/시간
  for (const d of DOW_IDS) {
    const check = $(d.checkId) as HTMLInputElement | null;
    const hours = $(d.hoursId) as HTMLInputElement | null;
    const cfg = config.dowSettings[d.dow] || DEFAULT_DOW[d.dow];
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
        (config[b.key] as unknown as string) = raw;
      } else if (b.type === "number") {
        const n = parseFloat(raw);
        (config[b.key] as unknown as number) = Number.isFinite(n) ? n : 0;
      } else {
        const n = parseInt(raw, 10);
        if (b.key === "fiscalMonth") {
          (config[b.key] as unknown as number | null) = Number.isFinite(n) ? n : null;
        } else {
          (config[b.key] as unknown as number) = Number.isFinite(n) ? n : 0;
        }
      }
      saveConfig();
      rerender();
    });
  }

  // 요일별 체크/시간 바인딩
  for (const d of DOW_IDS) {
    const check = $(d.checkId) as HTMLInputElement | null;
    const hours = $(d.hoursId) as HTMLInputElement | null;

    if (check) {
      check.addEventListener("change", () => {
        if (!config.dowSettings[d.dow]) config.dowSettings[d.dow] = { ...DEFAULT_DOW[d.dow] };
        config.dowSettings[d.dow].enabled = check.checked;
        saveConfig();
        rerender();
      });
    }
    if (hours) {
      hours.addEventListener("input", () => {
        if (!config.dowSettings[d.dow]) config.dowSettings[d.dow] = { ...DEFAULT_DOW[d.dow] };
        const v = parseFloat(hours.value);
        config.dowSettings[d.dow].hours = Number.isFinite(v) ? v : 0;
        saveConfig();
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

  config = loadConfig();
  applyConfigToInputs();
  bindInputs();

  $("revTplRegenBtn")?.addEventListener("click", () => rerender());

  rerender();
}
