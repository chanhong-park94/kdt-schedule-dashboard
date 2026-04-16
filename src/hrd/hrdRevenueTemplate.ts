/**
 * 매출상세표 양식 (엑셀 통합템플릿 대응)
 *
 * 01_매출관리 (회계월 요약 + 시나리오 예측 100/80/75/70%)
 * 02_매출상세 (일별 예상/실일매출/차액)
 *
 * - 기본 정보는 수기 입력 → localStorage 저장
 * - 일별 예상매출 = 평일 일단가(= 시간당훈련비 × 평일시간) × 액티브인원
 * - 토요일 일단가 = 시간당훈련비 × 토요일시간 × 인원
 * - 실일매출은 수기 입력 가능 (추후 HRD-Net 자동 연동 예정)
 */

const STORAGE_KEY = "kdt_revenue_template_config_v1";

interface DailyRow {
  date: string; // YYYY-MM-DD
  expected: number;
  actual: number | null;
}

interface TemplateConfig {
  courseName: string;
  courseCode: string;
  fiscalMonth: number | null;
  startDate: string;
  endDate: string;
  hourlyFee: number;
  weekdayHours: number;
  saturdayHours: number;
  activeCount: number;
  dropoutCount: number;
  writer: string;
  dailyActuals: Record<string, number>; // date → actual
}

const DEFAULT_CONFIG: TemplateConfig = {
  courseName: "",
  courseCode: "",
  fiscalMonth: null,
  startDate: "",
  endDate: "",
  hourlyFee: 18150,
  weekdayHours: 2.5,
  saturdayHours: 7,
  activeCount: 0,
  dropoutCount: 0,
  writer: "",
  dailyActuals: {},
};

let config: TemplateConfig = { ...DEFAULT_CONFIG };
let initialized = false;

// ─── 저장/복원 ───────────────────────────────────────────────

function loadConfig(): TemplateConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<TemplateConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      dailyActuals: parsed.dailyActuals || {},
    };
  } catch {
    return { ...DEFAULT_CONFIG };
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

function fmtWonOrDash(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return fmtWon(n);
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

// ─── 계산 ────────────────────────────────────────────────────

interface FiscalRange {
  start: Date;
  end: Date;
}

/** 회계월 범위: 훈련기간 ∩ 해당 월 전체 */
function calcFiscalRange(): FiscalRange | null {
  if (!config.fiscalMonth) return null;
  const s = parseDate(config.startDate);
  const e = parseDate(config.endDate);
  if (!s || !e) return null;

  // 회계월 탐색: 훈련기간과 교집합이 있는 연도/월
  // 단순 처리: 훈련 시작연도 기준 해당 월
  const year =
    config.fiscalMonth >= s.getMonth() + 1
      ? s.getFullYear()
      : s.getFullYear() + (config.fiscalMonth < s.getMonth() + 1 ? 1 : 0);

  const monthStart = new Date(year, config.fiscalMonth - 1, 1);
  const monthEnd = new Date(year, config.fiscalMonth, 0); // 해당 월 말일

  const rangeStart = monthStart < s ? s : monthStart;
  const rangeEnd = monthEnd > e ? e : monthEnd;

  if (rangeStart > rangeEnd) return null;
  return { start: rangeStart, end: rangeEnd };
}

/** 회계월 내 훈련일 목록 (일요일 제외 — 엑셀 기준: 월~토) */
function listTrainingDays(range: FiscalRange): Date[] {
  const days: Date[] = [];
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    const dow = cursor.getDay();
    if (dow !== 0) {
      // 일요일 제외
      days.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function weekdayUnitPrice(): number {
  return Math.round(config.hourlyFee * config.weekdayHours);
}

function saturdayUnitPrice(): number {
  return Math.round(config.hourlyFee * config.saturdayHours);
}

function dailyExpected(d: Date): number {
  const dow = d.getDay();
  const unit = dow === 6 ? saturdayUnitPrice() : weekdayUnitPrice();
  return unit * Math.max(0, config.activeCount);
}

// ─── 렌더링 ──────────────────────────────────────────────────

function renderMetaSummary(range: FiscalRange | null, days: Date[]): void {
  const weekdayEl = $("revTplWeekdayUnit");
  const saturdayEl = $("revTplSaturdayUnit");
  const daysEl = $("revTplTrainingDays");
  const satEl = $("revTplSaturdayCount");

  if (weekdayEl) weekdayEl.textContent = fmtWon(weekdayUnitPrice());
  if (saturdayEl) saturdayEl.textContent = fmtWon(saturdayUnitPrice());
  if (daysEl) daysEl.textContent = range ? `${days.length}일` : "-";
  if (satEl) {
    const satCount = days.filter((d) => d.getDay() === 6).length;
    satEl.textContent = range ? `${satCount}일` : "-";
  }
}

function renderMonthlyRow(days: Date[], totalActual: number): void {
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

  const expected100 = days.reduce((s, d) => s + dailyExpected(d), 0);

  if (cell100) cell100.textContent = expected100 > 0 ? fmtWon(expected100) : "-";
  if (cell80) cell80.textContent = expected100 > 0 ? fmtWon(expected100 * 0.8) : "-";
  if (cell75) cell75.textContent = expected100 > 0 ? fmtWon(expected100 * 0.75) : "-";
  if (cell70) cell70.textContent = expected100 > 0 ? fmtWon(expected100 * 0.7) : "-";
  if (cellActual) cellActual.textContent = totalActual > 0 ? fmtWon(totalActual) : "-";
}

function renderDailyTable(days: Date[]): number {
  const body = $("revTplDailyBody");
  const foot = $("revTplDailyFoot");
  if (!body) return 0;

  if (days.length === 0) {
    body.innerHTML = `<tr>
      <td colspan="7" class="u-text-muted u-text-center u-py-8">
        상단 기본 정보를 입력하면 회계월 범위의 일별 예상매출이 자동 생성됩니다.
      </td>
    </tr>`;
    if (foot) foot.innerHTML = "";
    return 0;
  }

  let totalExpected = 0;
  let totalActual = 0;

  const rows = days.map((d) => {
    const dateStr = fmtDate(d);
    const dow = d.getDay();
    const expected = dailyExpected(d);
    const actualRaw = config.dailyActuals[dateStr];
    const actual = typeof actualRaw === "number" && Number.isFinite(actualRaw) ? actualRaw : null;
    const diff = actual !== null ? actual - expected : null;
    totalExpected += expected;
    if (actual !== null) totalActual += actual;

    const dowLabel = DOW_LABEL[dow];
    const isWeekend = dow === 6 ? " rev-template-row-saturday" : "";
    const diffClass = diff === null ? "" : diff < 0 ? "rev-template-diff-neg" : diff > 0 ? "rev-template-diff-pos" : "";

    return `<tr class="rev-template-daily-row${isWeekend}" data-date="${dateStr}">
      <td>${dateStr}</td>
      <td>${dowLabel}</td>
      <td class="rev-template-amt">${fmtWon(expected)}</td>
      <td class="rev-template-amt">
        <input
          type="number"
          class="rev-template-actual-input"
          data-date="${dateStr}"
          value="${actual !== null ? actual : ""}"
          placeholder="0"
          aria-label="${dateStr} 실일매출"
        />
      </td>
      <td class="rev-template-amt ${diffClass}">${diff === null ? "-" : fmtWon(diff)}</td>
      <td>${config.activeCount || "-"}</td>
      <td>${config.writer || "-"}</td>
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

  // 실일매출 input 이벤트 바인딩
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

  return totalActual;
}

// ─── 통합 렌더 ───────────────────────────────────────────────

function rerender(): void {
  const range = calcFiscalRange();
  const days = range ? listTrainingDays(range) : [];
  renderMetaSummary(range, days);
  const totalActual = renderDailyTable(days);
  renderMonthlyRow(days, totalActual);
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
  { id: "revTplWeekdayHours", key: "weekdayHours", type: "number" },
  { id: "revTplSaturdayHours", key: "saturdayHours", type: "number" },
  { id: "revTplActiveCount", key: "activeCount", type: "int" },
  { id: "revTplDropoutCount", key: "dropoutCount", type: "int" },
  { id: "revTplWriter", key: "writer", type: "string" },
];

function applyConfigToInputs(): void {
  for (const b of FIELD_BINDINGS) {
    const el = $(b.id) as HTMLInputElement | null;
    if (!el) continue;
    const v = config[b.key];
    if (v === null || v === undefined) {
      el.value = "";
    } else {
      el.value = String(v);
    }
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
  $("revTplClearActualBtn")?.addEventListener("click", () => {
    if (!confirm("모든 실일매출 입력값을 초기화합니다. 진행할까요?")) return;
    config.dailyActuals = {};
    saveConfig();
    rerender();
  });

  rerender();
}
