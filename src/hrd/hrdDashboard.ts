/** HRD 대시보드 홈 — 핵심 KPI 요약, 관리대상 목록, 과정별 비교 */
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
  if (!course.startDate || !course.totalDays) return true; // 설정 미완료면 진행중 취급
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

          // 출결 데이터 수집 (최근 3개월)
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

            // 이 훈련생의 출결 레코드
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

  // === Card 1: 하차방어율 ===
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

  // === Card 2: 관리 인사이트 ===
  const activeTrainees = trainees.filter((t) => !t.isDropout);
  const dangerCount = activeTrainees.filter((t) => t.riskLevel === "danger").length;
  const warningCount = activeTrainees.filter((t) => t.riskLevel === "warning").length;
  const cautionCount = activeTrainees.filter((t) => t.riskLevel === "caution").length;
  const totalDropout = dropoutAll;

  // === Card 3: 관리대상 현황 ===
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
    <div class="dash-panel">
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
    </div>
  `;

  // 이름 클릭 이벤트
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

// ─── Compare Charts ─────────────────────────────────────
function renderCompareCharts(courseData: DashCourseData[], trainees: DashTrainee[]): void {
  const container = $("dashboardCompareCharts");
  if (!container) return;

  destroyCharts();

  // 과정별 집계
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
  const riskRates = courseNames.map((n) => {
    const d = courseMap.get(n)!;
    return d.activeCount > 0 ? (d.riskCount / d.activeCount) * 100 : 0;
  });

  container.innerHTML = `
    <div class="dash-chart-grid">
      <div class="dash-panel">
        <div class="dash-panel-header">
          <h3 class="dash-panel-title">과정별 하차방어율</h3>
        </div>
        <div class="dash-chart-canvas-wrap"><canvas id="dashChartDefense"></canvas></div>
      </div>
      <div class="dash-panel">
        <div class="dash-panel-header">
          <h3 class="dash-panel-title">과정별 위험학생 비율</h3>
        </div>
        <div class="dash-chart-canvas-wrap"><canvas id="dashChartRisk"></canvas></div>
      </div>
    </div>
  `;

  // 하차방어율 차트
  const ctx1 = (document.getElementById("dashChartDefense") as HTMLCanvasElement)?.getContext("2d");
  if (ctx1) {
    const chart1 = new Chart(ctx1, {
      type: "bar",
      data: {
        labels: courseNames.map((n) => n.length > 10 ? n.slice(0, 10) + "..." : n),
        datasets: [
          {
            label: "방어율 (%)",
            data: defenseRates,
            backgroundColor: defenseRates.map((r, i) => (r >= targetRates[i] ? "#10b981" : r >= targetRates[i] - 5 ? "#f59e0b" : "#ef4444")),
            borderRadius: 6,
          },
          {
            label: "목표",
            data: targetRates,
            type: "line" as const,
            borderColor: "#6366f1",
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
          x: { min: 0, max: 100, title: { display: true, text: "%", color: "#a1a1a9" }, ticks: { color: "#a1a1a9" }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "#a1a1a9" }, grid: { display: false } },
        },
        plugins: { legend: { display: true, position: "bottom", labels: { color: "#a1a1a9", padding: 16, usePointStyle: true } } },
      },
    });
    chartInstances.push(chart1);
  }

  // 위험학생 비율 차트
  const ctx2 = (document.getElementById("dashChartRisk") as HTMLCanvasElement)?.getContext("2d");
  if (ctx2) {
    const chart2 = new Chart(ctx2, {
      type: "bar",
      data: {
        labels: courseNames.map((n) => n.length > 10 ? n.slice(0, 10) + "..." : n),
        datasets: [{
          label: "위험학생 비율 (%)",
          data: riskRates,
          backgroundColor: riskRates.map((r) => (r > 20 ? "#ef4444" : r > 10 ? "#f59e0b" : "#10b981")),
          borderRadius: 6,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { min: 0, title: { display: true, text: "%", color: "#a1a1a9" }, ticks: { color: "#a1a1a9" }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "#a1a1a9" }, grid: { display: false } },
        },
        plugins: { legend: { display: false } },
      },
    });
    chartInstances.push(chart2);
  }
}

// ─── Navigation to Trainee History ──────────────────────
export function navigateToTraineeHistory(name: string, courseName: string, trainPrId: string, degr: string): void {
  // 훈련생 이력 탭으로 이동
  const navButton = document.querySelector<HTMLButtonElement>('[data-nav-key="traineeHistory"]');
  if (navButton) navButton.click();

  // 커스텀 이벤트로 훈련생 정보 전달
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

    renderKpiCards(courseData, trainees);
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
