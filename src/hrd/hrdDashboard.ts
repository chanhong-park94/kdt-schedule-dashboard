/** HRD 대시보드 홈 — 핵심 KPI 요약, 관리대상 목록, 과정별 비교, 트렌드, 도넛 */
import { Chart, registerables } from "chart.js";
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import { loadHrdConfig } from "./hrdConfig";
import { isDropout } from "./hrdDropout";
import { isAbsentStatus, isAttendedStatus, isExcusedStatus } from "./hrdTypes";
import type { HrdConfig, HrdRawAttendance, CourseCategory } from "./hrdTypes";

Chart.register(...registerables);

// ─── Types ──────────────────────────────────────────────
interface DashCourseData {
  courseName: string;
  trainPrId: string;
  degr: string;
  category: CourseCategory;
  total: number;
  dropout: number;
  active: number;
  defenseRate: number;
}

interface DashTrainee {
  name: string;
  courseName: string;
  trainPrId: string;
  degr: string;
  category: CourseCategory;
  status: string;
  isDropout: boolean;
  attendanceRate: number;
  absentDays: number;
  totalDays: number;
  maxAbsent: number;
  remainingAbsent: number;
  riskLevel: "safe" | "caution" | "warning" | "danger";
}

interface HrdCourse {
  name: string;
  trainPrId: string;
  degrs: string[];
  category?: CourseCategory;
  startDate?: string;
  totalDays?: number;
}

// ─── Light Theme Chart Colors ───────────────────────────
const CHART_COLORS = {
  text: "#6b7280",
  textStrong: "#1e1e2e",
  grid: "rgba(0,0,0,0.06)",
  primary: "#6366f1",
  orange: "#f97316",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  donut: ["#a855f7", "#6366f1", "#f87171", "#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#14b8a6"],
};

// ─── KPI Targets ─────────────────────────────────────────
const KPI_TARGET = { employed: 75, unemployed: 85 } as const;

// ─── State ──────────────────────────────────────────────
let chartInstances: Chart[] = [];

function destroyCharts(): void {
  chartInstances.forEach((c) => { try { c.destroy(); } catch { /* */ } });
  chartInstances = [];
}

const $ = (id: string) => document.getElementById(id);

// ─── Helpers ────────────────────────────────────────────
function isActiveCourse(course: HrdCourse): boolean {
  if (!course.startDate || !course.totalDays) return true;
  const end = new Date(course.startDate);
  end.setDate(end.getDate() + Math.ceil((course.totalDays / 5) * 7));
  return end >= new Date();
}

function getTargetRate(cat: CourseCategory): number {
  return cat === "재직자" ? KPI_TARGET.employed : KPI_TARGET.unemployed;
}

function getRiskLevel(remaining: number, total: number): "safe" | "caution" | "warning" | "danger" {
  if (total === 0) return "safe";
  if (remaining <= 0) return "danger";
  if (remaining <= 2) return "warning";
  if (remaining <= 5) return "caution";
  return "safe";
}

function riskOrder(level: string): number {
  return level === "danger" ? 0 : level === "warning" ? 1 : level === "caution" ? 2 : 3;
}

function resolveStatusStr(raw: HrdRawAttendance): string {
  return (raw.atendSttusNm || raw.atendSttusCd || "").toString().trim();
}

// ─── Data Fetch ─────────────────────────────────────────
async function fetchDashboardData(config: HrdConfig, onProgress?: (msg: string) => void): Promise<{
  courseData: DashCourseData[];
  trainees: DashTrainee[];
}> {
  const courseData: DashCourseData[] = [];
  const trainees: DashTrainee[] = [];

  const activeCourses = config.courses.filter(isActiveCourse);
  const totalDegrs = activeCourses.reduce((s, c) => s + c.degrs.length, 0);
  let done = 0;

  for (const course of activeCourses) {
    const BATCH = 3;
    for (let i = 0; i < course.degrs.length; i += BATCH) {
      const batch = course.degrs.slice(i, i + BATCH);
      const promises = batch.map(async (degr) => {
        try {
          const roster = await fetchRoster(config, course.trainPrId, degr);
          const dropoutCount = roster.filter(isDropout).length;
          const totalCount = roster.length;

          courseData.push({
            courseName: course.name,
            trainPrId: course.trainPrId,
            degr,
            category: course.category || "실업자",
            total: totalCount,
            dropout: dropoutCount,
            active: totalCount - dropoutCount,
            defenseRate: totalCount > 0 ? ((totalCount - dropoutCount) / totalCount) * 100 : 0,
          });

          const now = new Date();
          const months: string[] = [];
          for (let m = 2; m >= 0; m--) {
            const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
            months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
          }

          const allAttendance: HrdRawAttendance[] = [];
          for (const month of months) {
            try {
              const records = await fetchDailyAttendance(config, course.trainPrId, degr, month);
              allAttendance.push(...records);
            } catch (err) { console.warn(`[Dashboard] ${month} 출결 조회 실패:`, err); }
          }

          for (const raw of roster) {
            const name = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").toString().trim();
            const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
            const dropout = isDropout(raw);

            const nameKey = name.replace(/\s+/g, "");
            const myRecords = allAttendance.filter((r) => {
              const rName = (r.cstmrNm || r.trneeCstmrNm || r.trneNm || "").toString().replace(/\s+/g, "");
              return rName === nameKey;
            });

            const statuses = myRecords.map(resolveStatusStr);
            const attendedDays = statuses.filter(isAttendedStatus).length;
            const absentDays = statuses.filter(isAbsentStatus).length;
            const excusedDays = statuses.filter(isExcusedStatus).length;
            const td = course.totalDays || 0;
            const effectiveDays = td > 0 ? td - excusedDays : myRecords.length || 1;
            const attendanceRate = myRecords.length === 0 ? -1 : effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : 100;
            const maxAbsent = Math.floor(td * 0.2);
            const remainingAbsent = maxAbsent - absentDays;

            trainees.push({
              name,
              courseName: course.name,
              trainPrId: course.trainPrId,
              degr,
              category: course.category || "실업자",
              status: stNm.trim() || "훈련중",
              isDropout: dropout,
              attendanceRate,
              absentDays,
              totalDays: td,
              maxAbsent,
              remainingAbsent,
              riskLevel: getRiskLevel(remainingAbsent, td),
            });
          }
        } catch (err) { console.warn("[Dashboard] 과정 데이터 조회 실패:", err); }

        done++;
        onProgress?.(`${done}/${totalDegrs} 조회 중...`);
      });
      await Promise.all(promises);
    }
  }

  return { courseData, trainees };
}

// ─── KPI Cards ──────────────────────────────────────────
function renderKpiCards(courseData: DashCourseData[], trainees: DashTrainee[]): void {
  const container = $("dashboardKpiCards");
  if (!container) return;

  const totalAll = courseData.reduce((s, c) => s + c.total, 0);
  const dropoutAll = courseData.reduce((s, c) => s + c.dropout, 0);
  const defenseAll = totalAll > 0 ? ((totalAll - dropoutAll) / totalAll) * 100 : 0;

  const empEntries = courseData.filter((c) => c.category === "재직자");
  const unempEntries = courseData.filter((c) => c.category === "실업자");
  const empTotal = empEntries.reduce((s, c) => s + c.total, 0);
  const empDropout = empEntries.reduce((s, c) => s + c.dropout, 0);
  const empRate = empTotal > 0 ? ((empTotal - empDropout) / empTotal) * 100 : 0;
  const unempTotal = unempEntries.reduce((s, c) => s + c.total, 0);
  const unempDropout = unempEntries.reduce((s, c) => s + c.dropout, 0);
  const unempRate = unempTotal > 0 ? ((unempTotal - unempDropout) / unempTotal) * 100 : 0;

  const activeTrainees = trainees.filter((t) => !t.isDropout);
  const dangerCount = activeTrainees.filter((t) => t.riskLevel === "danger").length;
  const warningCount = activeTrainees.filter((t) => t.riskLevel === "warning").length;
  const cautionCount = activeTrainees.filter((t) => t.riskLevel === "caution").length;
  const totalDropout = dropoutAll;
  const riskTotal = dangerCount + warningCount + cautionCount;
  const activeCount = totalAll - totalDropout;

  container.innerHTML = `
    <div class="dash-kpi-card dash-kpi-gradient-1">
      <div class="dash-kpi-icon">📊</div>
      <div class="dash-kpi-body">
        <div class="dash-kpi-label">하차방어율</div>
        <div class="dash-kpi-value">${defenseAll.toFixed(1)}%</div>
      </div>
      <div class="dash-kpi-footer">
        <span>재직자 ${empRate.toFixed(1)}%</span>
        <span>실업자 ${unempRate.toFixed(1)}%</span>
      </div>
    </div>
    <div class="dash-kpi-card dash-kpi-gradient-2">
      <div class="dash-kpi-icon">👥</div>
      <div class="dash-kpi-body">
        <div class="dash-kpi-label">재적 현황</div>
        <div class="dash-kpi-value">${activeCount}명 <small class="dash-kpi-total">/ ${totalAll}</small></div>
      </div>
      <div class="dash-kpi-footer">
        <span>이탈 ${totalDropout}명</span>
        <span>재적률 ${totalAll > 0 ? ((activeCount / totalAll) * 100).toFixed(0) : 0}%</span>
      </div>
    </div>
    <div class="dash-kpi-card dash-kpi-gradient-3">
      <div class="dash-kpi-icon">⚠️</div>
      <div class="dash-kpi-body">
        <div class="dash-kpi-label">관리대상</div>
        <div class="dash-kpi-value">${riskTotal}명</div>
      </div>
      <div class="dash-kpi-footer">
        <span class="dash-kpi-risk-tag risk-danger">제적위험 ${dangerCount}</span>
        <span class="dash-kpi-risk-tag risk-warning">경고 ${warningCount}</span>
        <span class="dash-kpi-risk-tag risk-caution">주의 ${cautionCount}</span>
      </div>
    </div>
  `;
}

// ─── Donut Chart (과정별 재적 비율) ─────────────────────
function renderDonutChart(courseData: DashCourseData[]): void {
  const container = $("dashboardDonutChart");
  if (!container) return;

  const courseMap = new Map<string, number>();
  for (const c of courseData) {
    courseMap.set(c.courseName, (courseMap.get(c.courseName) || 0) + c.active);
  }

  const labels = [...courseMap.keys()].map((n) => n.length > 8 ? n.slice(0, 8) + ".." : n);
  const data = [...courseMap.values()];

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">과정별 재적 비율</h3>
    </div>
    <div style="padding:16px 20px;display:flex;align-items:center;justify-content:center;">
      <canvas id="dashChartDonut" style="max-height:200px;"></canvas>
    </div>
  `;

  const ctx = (document.getElementById("dashChartDonut") as HTMLCanvasElement)?.getContext("2d");
  if (ctx) {
    const chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: CHART_COLORS.donut.slice(0, data.length),
          borderWidth: 2,
          borderColor: "#ffffff",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "55%",
        plugins: {
          legend: { position: "bottom", labels: { color: CHART_COLORS.text, padding: 12, usePointStyle: true, font: { size: 11 } } },
        },
      },
    });
    chartInstances.push(chart);
  }
}

// ─── Stats Panel (핵심 수치 요약) ───────────────────────
function renderStatsPanel(courseData: DashCourseData[], trainees: DashTrainee[]): void {
  const container = $("dashboardStats");
  if (!container) return;

  const totalAll = courseData.reduce((s, c) => s + c.total, 0);
  const dropoutAll = courseData.reduce((s, c) => s + c.dropout, 0);
  const activeAll = totalAll - dropoutAll;
  const activeTrainees = trainees.filter((t) => !t.isDropout && t.attendanceRate >= 0);
  const avgAttendance = activeTrainees.length > 0
    ? activeTrainees.reduce((s, t) => s + t.attendanceRate, 0) / activeTrainees.length
    : 0;
  const courseCount = new Set(courseData.map((c) => c.courseName)).size;

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">운영 현황 요약</h3>
    </div>
    <div style="padding:4px 20px 16px;">
      <div class="dash-stat-big">${activeAll}<span style="font-size:14px;font-weight:500;color:var(--text-secondary);margin-left:4px;">명 재적</span></div>
      <div class="dash-stat-bar"><div class="dash-stat-bar-fill" style="width:${totalAll > 0 ? (activeAll / totalAll * 100) : 0}%"></div></div>
      <div style="margin-top:16px;display:flex;flex-direction:column;gap:0;">
        <div class="dash-stat-row"><span class="dash-stat-label">운영 과정</span><span class="dash-stat-value">${courseCount}개</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">전체 등록</span><span class="dash-stat-value">${totalAll}명</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">이탈 인원</span><span class="dash-stat-value">${dropoutAll}명</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">평균 출석률</span><span class="dash-stat-value">${avgAttendance.toFixed(1)}%</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">하차방어율</span><span class="dash-stat-value">${totalAll > 0 ? ((activeAll / totalAll) * 100).toFixed(1) : 0}%</span></div>
      </div>
    </div>
  `;
}

// ─── Trend Chart (주간 출석률 라인) ─────────────────────
function renderTrendChart(trainees: DashTrainee[]): void {
  const container = $("dashboardTrendChart");
  if (!container) return;

  // 과정별 출석률을 간단 집계 (데이터가 제한적이므로 과정별 바 형태로)
  const activeTrainees = trainees.filter((t) => !t.isDropout && t.attendanceRate >= 0);
  const courseMap = new Map<string, { sum: number; count: number }>();
  for (const t of activeTrainees) {
    const entry = courseMap.get(t.courseName) || { sum: 0, count: 0 };
    entry.sum += t.attendanceRate;
    entry.count++;
    courseMap.set(t.courseName, entry);
  }

  const labels = [...courseMap.keys()].map((n) => n.length > 12 ? n.slice(0, 12) + ".." : n);
  const rates = [...courseMap.values()].map((v) => v.count > 0 ? v.sum / v.count : 0);

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">과정별 평균 출석률</h3>
    </div>
    <div class="dash-chart-canvas-wrap"><canvas id="dashChartTrend"></canvas></div>
  `;

  const ctx = (document.getElementById("dashChartTrend") as HTMLCanvasElement)?.getContext("2d");
  if (ctx) {
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "출석률 (%)",
          data: rates,
          borderColor: CHART_COLORS.orange,
          backgroundColor: "rgba(249, 115, 22, 0.08)",
          borderWidth: 3,
          tension: 0.4,
          fill: true,
          pointBackgroundColor: CHART_COLORS.orange,
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid } },
          y: { min: 0, max: 100, ticks: { color: CHART_COLORS.text, callback: (v) => v + "%" }, grid: { color: CHART_COLORS.grid } },
        },
        plugins: { legend: { display: false } },
      },
    });
    chartInstances.push(chart);
  }
}

// ─── Risk Student List ──────────────────────────────────
function renderRiskStudentList(trainees: DashTrainee[]): void {
  const container = $("dashboardRiskList");
  if (!container) return;

  const riskStudents = trainees
    .filter((t) => !t.isDropout && t.riskLevel !== "safe")
    .sort((a, b) => riskOrder(a.riskLevel) - riskOrder(b.riskLevel) || a.remainingAbsent - b.remainingAbsent);

  if (riskStudents.length === 0) {
    container.innerHTML = `<div class="dash-empty">관리대상 학생이 없습니다.</div>`;
    return;
  }

  const badgeClass = (level: string) =>
    level === "danger" ? "badge-danger" : level === "warning" ? "badge-warning" : "badge-caution";
  const badgeLabel = (level: string) =>
    level === "danger" ? "제적위험" : level === "warning" ? "경고" : "주의";

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">관리대상 학생</h3>
      <span class="dash-panel-count">${riskStudents.length}명</span>
    </div>
    <div class="dash-risk-list">
      ${riskStudents
        .map(
          (s) => `
        <div class="dash-risk-row">
          <div class="dash-risk-indicator ${s.riskLevel}"></div>
          <div class="dash-risk-info">
            <span class="dash-risk-name" data-name="${s.name}" data-course="${s.courseName}" data-tpid="${s.trainPrId}" data-degr="${s.degr}">${s.name}</span>
            <span class="dash-risk-course">${s.courseName} · ${s.degr}기</span>
          </div>
          <div class="dash-risk-stats">
            <span class="dash-risk-stat">출석 ${s.attendanceRate >= 0 ? s.attendanceRate.toFixed(1) + "%" : "-"}</span>
            <span class="dash-risk-stat">결석 ${s.absentDays}/${s.maxAbsent}</span>
          </div>
          <span class="dash-risk-badge ${badgeClass(s.riskLevel)}">${badgeLabel(s.riskLevel)}</span>
        </div>`,
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll<HTMLElement>(".dash-risk-name").forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.name || "";
      const courseName = el.dataset.course || "";
      const degr = el.dataset.degr || "";
      const tpid = el.dataset.tpid || "";
      navigateToTraineeHistory(name, courseName, tpid, degr);
    });
  });
}

// ─── Compare Charts (하차방어율) ────────────────────────
function renderCompareCharts(courseData: DashCourseData[], trainees: DashTrainee[]): void {
  const container = $("dashboardCompareCharts");
  if (!container) return;

  const courseMap = new Map<string, { total: number; dropout: number; category: CourseCategory; riskCount: number; activeCount: number }>();
  for (const c of courseData) {
    const key = c.courseName;
    const existing = courseMap.get(key) || { total: 0, dropout: 0, category: c.category, riskCount: 0, activeCount: 0 };
    existing.total += c.total;
    existing.dropout += c.dropout;
    courseMap.set(key, existing);
  }
  for (const t of trainees) {
    if (t.isDropout) continue;
    const existing = courseMap.get(t.courseName);
    if (!existing) continue;
    existing.activeCount++;
    if (t.riskLevel !== "safe") existing.riskCount++;
  }

  const courseNames = [...courseMap.keys()];
  const defenseRates = courseNames.map((n) => {
    const d = courseMap.get(n)!;
    return d.total > 0 ? ((d.total - d.dropout) / d.total) * 100 : 0;
  });
  const targetRates = courseNames.map((n) => getTargetRate(courseMap.get(n)!.category));

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">하차방어율</h3>
    </div>
    <div class="dash-chart-canvas-wrap" style="min-height:180px;"><canvas id="dashChartDefense"></canvas></div>
  `;

  const ctx1 = (document.getElementById("dashChartDefense") as HTMLCanvasElement)?.getContext("2d");
  if (ctx1) {
    const chart1 = new Chart(ctx1, {
      type: "bar",
      data: {
        labels: courseNames.map((n) => n.length > 8 ? n.slice(0, 8) + ".." : n),
        datasets: [
          {
            label: "방어율 (%)",
            data: defenseRates,
            backgroundColor: defenseRates.map((r, i) =>
              r >= targetRates[i] ? CHART_COLORS.green : r >= targetRates[i] - 5 ? CHART_COLORS.amber : CHART_COLORS.red
            ),
            borderRadius: 6,
          },
          {
            label: "목표",
            data: targetRates,
            type: "line" as const,
            borderColor: CHART_COLORS.primary,
            borderDash: [5, 5],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { min: 0, max: 100, ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid } },
          y: { ticks: { color: CHART_COLORS.text, font: { size: 11 } }, grid: { display: false } },
        },
        plugins: { legend: { display: true, position: "bottom", labels: { color: CHART_COLORS.text, padding: 12, usePointStyle: true, font: { size: 11 } } } },
      },
    });
    chartInstances.push(chart1);
  }
}

// ─── Navigation to Trainee History ──────────────────────
export function navigateToTraineeHistory(name: string, courseName: string, trainPrId: string, degr: string): void {
  const navButton = document.querySelector<HTMLButtonElement>('[data-nav-key="traineeHistory"]');
  if (navButton) navButton.click();

  setTimeout(() => {
    window.dispatchEvent(new CustomEvent("openTraineeDetail", {
      detail: { name, courseName, trainPrId, degr },
    }));
  }, 300);
}

// ─── Init ───────────────────────────────────────────────
export async function initDashboard(): Promise<void> {
  const loading = $("dashboardLoading");
  const loadingMsg = $("dashboardLoadingMsg");

  if (loading) loading.style.display = "block";

  try {
    const config = loadHrdConfig();
    const { courseData, trainees } = await fetchDashboardData(config, (msg) => {
      if (loadingMsg) loadingMsg.textContent = msg;
    });

    destroyCharts();
    renderKpiCards(courseData, trainees);
    renderDonutChart(courseData);
    renderStatsPanel(courseData, trainees);
    renderTrendChart(trainees);
    renderRiskStudentList(trainees);
    renderCompareCharts(courseData, trainees);
  } catch (e) {
    const container = $("dashboardKpiCards");
    if (container) container.innerHTML = `<div class="dash-empty">데이터를 불러올 수 없습니다. 설정을 확인해주세요.</div>`;
    console.warn("[Dashboard] Error:", e);
  } finally {
    if (loading) loading.style.display = "none";
  }
}
