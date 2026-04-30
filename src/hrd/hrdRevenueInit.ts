/**
 * 매출 탭 초기화 (lazy-load 진입점)
 *
 * 출결 데이터를 기반으로 과정/기수별 훈련비 매출을 산정하고
 * KPI 카드, 과정별 테이블, 트렌드 차트를 렌더링합니다.
 */
import { Chart, registerables } from "chart.js";
import { loadHrdConfig } from "./hrdConfig";
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import { isAttendedStatus, isExcusedStatus } from "./hrdTypes";
import type { AttendanceDayRecord, AttendanceStudent, HrdCourse } from "./hrdTypes";
import type { CohortRevenue } from "./hrdRevenueTypes";
import {
  COST_PER_PERSON_HOUR,
  calcCohortRevenue,
  resolveDowHours,
  formatRevenue,
  type ClassDayContext,
} from "./hrdRevenue";
import { fetchPublicHolidaysKR } from "../core/holidays";
import { initRevenueTemplate } from "./hrdRevenueTemplate";

Chart.register(...registerables);

const $ = (id: string) => document.getElementById(id);
let chartInstance: Chart | null = null;
let initialized = false;

// ─── 출결 데이터 정규화 ──────────────────────────────────────

function resolveStatus(raw: { atendSttusNm?: string; atendSttusCd?: string }): string {
  return (raw.atendSttusNm || "").trim() || "-";
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "");
}

function buildDailyRecords(
  dailyData: Array<{
    atendDe?: string;
    atendSttusNm?: string;
    atendSttusCd?: string;
    cstmrNm?: string;
    trneeCstmrNm?: string;
    trneNm?: string;
  }>,
): Map<string, AttendanceDayRecord[]> {
  const map = new Map<string, AttendanceDayRecord[]>();
  for (const raw of dailyData) {
    const nm = normalizeName((raw.cstmrNm || raw.trneeCstmrNm || raw.trneNm || "").toString());
    if (!nm) continue;
    const dateRaw = (raw.atendDe || "").toString().replace(/[^0-9]/g, "");
    if (dateRaw.length < 8) continue;
    const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    const status = resolveStatus(raw);
    if (!map.has(nm)) map.set(nm, []);
    map.get(nm)!.push({ date, dayOfWeek: "", status, inTime: "", outTime: "" });
  }
  for (const [, records] of map) {
    records.sort((a, b) => a.date.localeCompare(b.date));
  }
  return map;
}

/** 모든 학생 출결 기록의 union 일자 set — HRD SSOT */
function unionAttendanceDates(map: Map<string, AttendanceDayRecord[]>): Set<string> {
  const set = new Set<string>();
  for (const [, records] of map) {
    for (const r of records) set.add(r.date);
  }
  return set;
}

// ─── 공휴일 캐시 (5월 매출 시점에 공휴일 API가 안 잡히면 빈 set 폴백) ──
async function loadHolidaysForRange(startDate: string, endDate: string): Promise<Set<string>> {
  const set = new Set<string>();
  if (!startDate) return set;
  const startY = new Date(startDate).getFullYear();
  const endY = new Date(endDate).getFullYear();
  if (!Number.isFinite(startY) || !Number.isFinite(endY)) return set;
  const years = new Set<number>();
  for (let y = startY; y <= endY; y++) years.add(y);
  await Promise.all(
    [...years].map(async (y) => {
      try {
        const list = await fetchPublicHolidaysKR(y);
        for (const h of list) set.add(h.date);
      } catch {
        // 네트워크 실패 — 폴백: 빈 set (요일만으로 판정)
      }
    }),
  );
  return set;
}

// ─── 초기화 ──────────────────────────────────────────────────

export function initRevenue(): void {
  if (initialized) return;
  initialized = true;

  const queryBtn = $("revQueryBtn");
  queryBtn?.addEventListener("click", () => void loadRevenueData());

  // 매출상세표 양식 초기화 (엑셀 통합템플릿 대응)
  initRevenueTemplate();
}

/** AttendanceStudent 최소 셋 — 매출 엔진에 필요한 필드만 */
function buildStudentsForRevenue(
  roster: Array<Record<string, unknown>>,
  dailyRecords: Map<string, AttendanceDayRecord[]>,
): AttendanceStudent[] {
  return roster.map((raw) => {
    const nm = normalizeName(
      ((raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm) ?? "").toString(),
    );
    const stNm = ((raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm) ?? "").toString();
    const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기");
    const records = dailyRecords.get(nm) || [];
    const attended = records.filter((r) => isAttendedStatus(r.status) || isExcusedStatus(r.status)).length;
    const rate = records.length > 0 ? (attended / records.length) * 100 : 0;
    return {
      name: nm,
      birth: "",
      status: "-",
      inTime: "",
      outTime: "",
      dropout,
      traineeStatus: "훈련중",
      hrdStatusRaw: stNm,
      riskLevel: "safe",
      totalDays: 0,
      attendedDays: attended,
      absentDays: 0,
      excusedDays: 0,
      maxAbsent: 0,
      remainingAbsent: 0,
      attendanceRate: rate,
      missingCheckout: false,
      gender: "",
    } as unknown as AttendanceStudent;
  });
}

async function loadRevenueData(): Promise<void> {
  const statusEl = $("revLoadingStatus");
  const queryBtn = $("revQueryBtn");
  if (queryBtn) queryBtn.setAttribute("disabled", "true");

  const config = loadHrdConfig();
  if (!config.courses.length) {
    if (statusEl) statusEl.textContent = "❌ 등록된 과정이 없습니다.";
    if (queryBtn) queryBtn.removeAttribute("disabled");
    return;
  }

  const coursesWithStart = config.courses.filter((c) => c.startDate);
  if (coursesWithStart.length === 0) {
    if (statusEl) statusEl.textContent = "⚠️ 개강일이 설정된 과정이 없습니다. 설정 탭에서 개강일을 입력해주세요.";
    if (queryBtn) queryBtn.removeAttribute("disabled");
    return;
  }

  const cohorts: CohortRevenue[] = [];
  const totalJobs = coursesWithStart.reduce((sum, c) => sum + c.degrs.length, 0);
  let done = 0;
  let dailyRevenue = 0;
  const today = fmtDate(new Date());

  for (const course of coursesWithStart) {
    for (const degr of course.degrs) {
      done++;
      if (statusEl) statusEl.textContent = `${done}/${totalJobs} 조회 중... (${course.name} ${degr}기)`;

      try {
        const [roster, daily] = await Promise.all([
          fetchRoster(config, course.trainPrId, degr),
          fetchAllMonthsAttendance(config, course, degr),
        ]);

        if (roster.length === 0) continue;

        const dailyRecords = buildDailyRecords(daily as Array<Record<string, unknown>>);
        const dowHours = resolveDowHours(course, degr);

        // 공휴일 set — 개강~오늘+여유기간
        const periodEnd = course.totalDays
          ? addDaysFromStart(course.startDate, Math.ceil(course.totalDays / 5) * 7)
          : today;
        const holidays = await loadHolidaysForRange(course.startDate, periodEnd);

        const ctx: ClassDayContext = {
          hrdAttendanceDates: unionAttendanceDates(dailyRecords),
          holidays,
          today: new Date(today),
        };

        const students = buildStudentsForRevenue(roster as Array<Record<string, unknown>>, dailyRecords);
        const cohortRevenue = calcCohortRevenue(course, degr, students, dailyRecords, ctx);
        cohorts.push(cohortRevenue);

        // 일매출: 오늘 출석/공결한 학생 수 × 오늘 요일 시간 × 단가
        const todayDow = new Date(today).getDay();
        const todayHours = (dowHours[String(todayDow) as "0" | "1" | "2" | "3" | "4" | "5" | "6"] ?? 0);
        for (const s of students) {
          if (s.dropout) continue;
          const records = dailyRecords.get(s.name) || [];
          const todayRec = records.find((r) => r.date === today);
          if (todayRec && (isAttendedStatus(todayRec.status) || isExcusedStatus(todayRec.status))) {
            dailyRevenue += todayHours * COST_PER_PERSON_HOUR;
          }
        }
      } catch (e) {
        console.warn(`[Revenue] ${course.name} ${degr}기 실패:`, e);
      }
    }
  }

  const summary = {
    totalRevenue: cohorts.reduce((s, c) => s + c.totalRevenue, 0),
    dailyRevenue,
    totalLost: cohorts.reduce((s, c) => s + c.lostRevenue, 0),
    dropoutLoss: cohorts.reduce((s, c) => s + c.dropoutLoss, 0),
    maxRevenue: cohorts.reduce((s, c) => s + c.maxRevenue, 0),
    cohorts,
  };

  if (statusEl) statusEl.textContent = "";
  renderKpiCards(summary);
  renderCohortTable(summary.cohorts);
  renderTrendChart(summary.cohorts);
  if (queryBtn) queryBtn.removeAttribute("disabled");

  const scopeEl = $("revDataScope");
  if (scopeEl) scopeEl.textContent = `(${cohorts.length}개 과정/기수)`;
}

// ─── 전체 월 출결 데이터 가져오기 (degr별) ────────────────────

async function fetchAllMonthsAttendance(
  config: ReturnType<typeof loadHrdConfig>,
  course: HrdCourse,
  degr: string,
): Promise<Array<Record<string, unknown>>> {
  if (!course.startDate) return [];
  const start = new Date(course.startDate);
  const now = new Date();
  const allData: Array<Record<string, unknown>> = [];

  const cursor = new Date(start);
  while (cursor <= now) {
    const month = `${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    try {
      const data = await fetchDailyAttendance(config, course.trainPrId, degr, month);
      allData.push(...(data as Array<Record<string, unknown>>));
    } catch {
      // 월 데이터 없으면 스킵
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return allData;
}

function addDaysFromStart(startDateStr: string, days: number): string {
  const d = new Date(startDateStr);
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

// ─── KPI 카드 렌더링 ─────────────────────────────────────────

function renderKpiCards(summary: {
  totalRevenue: number;
  dailyRevenue: number;
  totalLost: number;
  dropoutLoss: number;
  maxRevenue: number;
}): void {
  const container = $("revKpiCards");
  if (!container) return;
  container.style.display = "";

  const revenueRate =
    summary.maxRevenue > 0 ? ((summary.totalRevenue / summary.maxRevenue) * 100).toFixed(1) : "0";

  container.innerHTML = `
    <div class="rev-kpi-card">
      <div class="rev-kpi-label">총 매출</div>
      <div class="rev-kpi-value" style="color:var(--primary)">${formatRevenue(summary.totalRevenue)}</div>
      <div class="rev-kpi-sub">달성률 ${revenueRate}%</div>
    </div>
    <div class="rev-kpi-card">
      <div class="rev-kpi-label">일매출 (오늘)</div>
      <div class="rev-kpi-value">${formatRevenue(summary.dailyRevenue)}</div>
      <div class="rev-kpi-sub">${summary.dailyRevenue === 0 ? "오늘 출결 데이터 없음" : ""}</div>
    </div>
    <div class="rev-kpi-card">
      <div class="rev-kpi-label">손실 매출</div>
      <div class="rev-kpi-value" style="color:var(--danger)">${formatRevenue(summary.totalLost)}</div>
      <div class="rev-kpi-sub">결석/미달로 인한 손실</div>
    </div>
    <div class="rev-kpi-card">
      <div class="rev-kpi-label">하차 손실</div>
      <div class="rev-kpi-value" style="color:var(--danger)">${formatRevenue(summary.dropoutLoss)}</div>
      <div class="rev-kpi-sub">탈락자 잔여기간 손실</div>
    </div>
  `;
}

// ─── 과정별 테이블 ───────────────────────────────────────────

function renderCohortTable(cohorts: CohortRevenue[]): void {
  const section = $("revCohortSection");
  const tbody = $("revCohortBody");
  const tfoot = $("revCohortFoot");
  if (!section || !tbody) return;
  section.style.display = "";

  tbody.innerHTML = cohorts
    .map(
      (c) => `<tr>
    <td>${c.courseName.length > 15 ? c.courseName.slice(0, 15) + "…" : c.courseName}</td>
    <td>${c.degr}기</td>
    <td><span class="course-tag ${c.category === "재직자" ? "course-tag-employed" : "course-tag-unemployed"}">${c.category}</span></td>
    <td>${c.activeTrainees}명 ${c.dropoutCount > 0 ? `<span style="color:var(--danger)">(하차 ${c.dropoutCount})</span>` : ""}</td>
    <td>${
      c.periods.length > 0
        ? (
            (c.periods.reduce((s, p) => s + p.trainees.reduce((ss, t) => ss + t.attendanceRatio, 0), 0) /
              Math.max(1, c.periods.reduce((s, p) => s + p.trainees.length, 0))) *
              100
          ).toFixed(1) + "%"
        : "-"
    }</td>
    <td style="font-weight:600">${formatRevenue(c.totalRevenue)}</td>
    <td style="color:var(--danger)">${c.lostRevenue > 0 ? formatRevenue(c.lostRevenue) : "-"}</td>
    <td style="color:var(--danger)">${c.dropoutLoss > 0 ? formatRevenue(c.dropoutLoss) : "-"}</td>
  </tr>`,
    )
    .join("");

  if (tfoot) {
    const totalRev = cohorts.reduce((s, c) => s + c.totalRevenue, 0);
    const totalLost = cohorts.reduce((s, c) => s + c.lostRevenue, 0);
    const totalDropout = cohorts.reduce((s, c) => s + c.dropoutLoss, 0);
    tfoot.innerHTML = `<tr style="font-weight:700;background:var(--surface-hover)">
      <td colspan="5">합계</td>
      <td>${formatRevenue(totalRev)}</td>
      <td style="color:var(--danger)">${totalLost > 0 ? formatRevenue(totalLost) : "-"}</td>
      <td style="color:var(--danger)">${totalDropout > 0 ? formatRevenue(totalDropout) : "-"}</td>
    </tr>`;
  }
}

// ─── 트렌드 차트 ─────────────────────────────────────────────

function renderTrendChart(cohorts: CohortRevenue[]): void {
  const section = $("revChartSection");
  const canvas = $("revTrendCanvas") as HTMLCanvasElement | null;
  if (!section || !canvas) return;
  section.style.display = "";

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // 모든 기간을 합산
  const periodMap = new Map<string, { revenue: number; lost: number }>();
  for (const cohort of cohorts) {
    for (const pr of cohort.periods) {
      const label = `${pr.period.startDate.slice(0, 7)}`;
      const existing = periodMap.get(label) || { revenue: 0, lost: 0 };
      existing.revenue += pr.totalRevenue;
      existing.lost += pr.lostRevenue;
      periodMap.set(label, existing);
    }
  }

  const labels = [...periodMap.keys()].sort();
  const revenues = labels.map((l) => periodMap.get(l)!.revenue);
  const losses = labels.map((l) => periodMap.get(l)!.lost);

  chartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels.map((l) => l.replace("-", "년 ") + "월"),
      datasets: [
        {
          label: "실매출",
          data: revenues,
          backgroundColor: "rgba(99, 102, 241, 0.7)",
          borderRadius: 4,
        },
        {
          label: "손실 매출",
          data: losses,
          backgroundColor: "rgba(239, 68, 68, 0.4)",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatRevenue(Number(ctx.parsed.y ?? 0))}`,
          },
        },
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: {
            callback: (v) => formatRevenue(Number(v)),
          },
        },
      },
    },
  });
}

// ─── 유틸 ────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
