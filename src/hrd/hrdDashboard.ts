/** HRD 대시보드 홈 — 핵심 KPI 요약, 관리대상 목록, 과정별 비교, 트렌드, 도넛 */
import { Chart, registerables } from "chart.js";
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import { loadHrdConfig } from "./hrdConfig";
import { isDropout } from "./hrdDropout";
import { loadSatisfactionCache, summarizeByCohort } from "./hrdSatisfactionApi";
import { isAbsentStatus, isAttendedStatus, isExcusedStatus, calcAbsentDays } from "./hrdTypes";
import type { HrdConfig, HrdRawAttendance, CourseCategory } from "./hrdTypes";
import { loadCachedAchievementRecords, loadCachedSatisfactionRecords } from "../crossAnalysis/crossAnalysisData";
import { summarizeByTrainee } from "./hrdAchievementApi";
import { summarizeByCohort as satSummarizeByCohort } from "./hrdSatisfactionApi";

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
  progress: number; // 과정 진행률 (%)
  isCompleted: boolean; // 종강 여부
  actualDays: number; // 실제 출결 기록 고유 날짜 수
  configTotalDays: number; // config에 설정된 totalDays
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
let currentYearFilter: string = "training"; // "training" | "all" | "2024" | "2025" | "2026"

function destroyCharts(): void {
  chartInstances.forEach((c) => {
    try {
      c.destroy();
    } catch {
      /* */
    }
  });
  chartInstances = [];
}

const $ = (id: string) => document.getElementById(id);

// ─── Helpers ────────────────────────────────────────────
/** 훈련중인 과정 필터 — 종강 확인된 과정만 제외, 날짜 미설정은 포함 */
function isTrainingCourse(course: HrdCourse): boolean {
  // startDate나 totalDays가 없으면 종강 여부 판단 불가 → 포함
  if (!course.startDate || !course.totalDays) return true;
  const now = new Date();
  const end = new Date(course.startDate);
  end.setDate(end.getDate() + Math.ceil((course.totalDays / 5) * 7));
  // 종강일이 지난 과정만 제외
  return end >= now;
}

function getTargetRate(cat: CourseCategory): number {
  return cat === "재직자" ? KPI_TARGET.employed : KPI_TARGET.unemployed;
}

function getRiskLevel(remaining: number, total: number): "safe" | "caution" | "warning" | "danger" {
  if (total === 0) return "safe";
  const maxAbsent = Math.floor(total * 0.2);
  if (maxAbsent === 0) return "safe";
  const remainRate = remaining / maxAbsent;
  if (remainRate <= 0.15) return "danger";
  if (remainRate <= 0.30) return "warning";
  if (remainRate <= 0.60) return "caution";
  return "safe";
}

function riskOrder(level: string): number {
  return level === "danger" ? 0 : level === "warning" ? 1 : level === "caution" ? 2 : 3;
}

function resolveStatusStr(raw: HrdRawAttendance): string {
  return (raw.atendSttusNm || raw.atendSttusCd || "").toString().trim();
}

// ─── Data Fetch ─────────────────────────────────────────

/** 명단 훈련상태로 "훈련중" 기수인지 판별 */
function isDegrTraining(roster: { trneeSttusNm?: string; atendSttsNm?: string; stttsCdNm?: string; [key: string]: unknown }[]): boolean {
  if (roster.length === 0) return false;
  return roster.some((r) => {
    const st = (r.trneeSttusNm || r.atendSttsNm || r.stttsCdNm || "").toString().trim();
    return st === "" || st.includes("훈련중") || st.includes("참여중");
  });
}

/** 년도 필터에 따라 과정 필터링 */
function filterCoursesByYear(courses: HrdCourse[], yearFilter: string): HrdCourse[] {
  if (yearFilter === "training") return courses.filter(isTrainingCourse);
  if (yearFilter === "all") return courses;
  // 특정 년도: startDate 기준 필터
  const year = parseInt(yearFilter, 10);
  return courses.filter((c) => {
    if (!c.startDate) return false;
    return new Date(c.startDate).getFullYear() === year;
  });
}

/** 년도 필터에 따라 훈련중 기수만 표시할지 결정 */
function shouldFilterTrainingOnly(): boolean {
  return currentYearFilter === "training";
}

async function fetchDashboardData(
  config: HrdConfig,
  onProgress?: (msg: string) => void,
): Promise<{
  courseData: DashCourseData[];
  trainees: DashTrainee[];
}> {
  const courseData: DashCourseData[] = [];
  const trainees: DashTrainee[] = [];

  const activeCourses = filterCoursesByYear(config.courses, currentYearFilter);
  const totalDegrs = activeCourses.reduce((s, c) => s + c.degrs.length, 0);
  let done = 0;

  for (const course of activeCourses) {
    const BATCH = 3;
    for (let i = 0; i < course.degrs.length; i += BATCH) {
      const batch = course.degrs.slice(i, i + BATCH);
      const promises = batch.map(async (degr) => {
        try {
          const roster = await fetchRoster(config, course.trainPrId, degr);

          const isTraining = isDegrTraining(roster);

          // ★ "훈련중" 필터일 때만 HRD 명단 훈련상태로 기수 필터링
          if (shouldFilterTrainingOnly() && !isTraining) {
            done++;
            onProgress?.(`${done}/${totalDegrs} 조회 중...`);
            return; // 종강/수료 기수는 건너뜀
          }

          const dropoutCount = roster.filter(isDropout).length;
          const totalCount = roster.length;
          const now = new Date();

          // 출결 데이터 조회 (진행률 계산에도 사용)
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
            } catch (err) {
              console.warn(`[Dashboard] ${month} 출결 조회 실패:`, err);
            }
          }

          // 당일 출결 데이터 제외 — 퇴실체크 전 결석 오표기 방지
          const todayStr = now.toISOString().slice(0, 10).replace(/-/g, "");
          const confirmedAttendance = allAttendance.filter((r) => {
            const dateStr = (r.atendDe || "").toString().replace(/-/g, "").trim();
            return dateStr < todayStr;
          });

          // 과정 진행률 계산 — 출결 기록 일수 기반
          let progress = 0;
          const td = course.totalDays || 0;
          const uniqueDates = new Set(
            confirmedAttendance.map((r) => (r.atendDe || "").toString().replace(/-/g, "").trim()).filter(Boolean),
          );
          const actualDays = uniqueDates.size;
          if (td > 0) {
            progress = Math.min(100, Math.round((actualDays / td) * 100 * 10) / 10);
          }

          courseData.push({
            courseName: course.name,
            trainPrId: course.trainPrId,
            degr,
            category: course.category || "실업자",
            total: totalCount,
            dropout: dropoutCount,
            active: totalCount - dropoutCount,
            defenseRate: totalCount > 0 ? ((totalCount - dropoutCount) / totalCount) * 100 : 0,
            progress,
            isCompleted: !isTraining,
            actualDays,
            configTotalDays: td,
          });

          for (const raw of roster) {
            const name = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").toString().trim();
            const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
            const dropout = isDropout(raw);
            // 수료/조기취업 학생도 비활동 처리 (관리대상에서 제외)
            const graduated =
              stNm.includes("80%이상수료") || stNm.includes("정상수료") || stNm.includes("수료후취업") || stNm.includes("조기취업");

            const nameKey = name.replace(/\s+/g, "");
            const myRecords = confirmedAttendance.filter((r) => {
              const rName = (r.cstmrNm || r.trneeCstmrNm || r.trneNm || "").toString().replace(/\s+/g, "");
              return rName === nameKey;
            });

            const statuses = myRecords.map(resolveStatusStr);
            const attendedDays = statuses.filter(isAttendedStatus).length;
            // HRD-Net 기준: 순수결석 + 지각3회=1결석 + 조퇴3회=1결석
            const absentDays = calcAbsentDays(statuses.map((s) => ({ status: s })));
            const excusedDays = statuses.filter(isExcusedStatus).length;
            const td = course.totalDays || 0;
            const effectiveDays = td > 0 ? td - excusedDays : myRecords.length || 1;
            const attendanceRate =
              myRecords.length === 0 ? -1 : effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : 100;
            const maxAbsent = Math.floor(td * 0.2);
            const remainingAbsent = maxAbsent - absentDays;

            trainees.push({
              name,
              courseName: course.name,
              trainPrId: course.trainPrId,
              degr,
              category: course.category || "실업자",
              status: stNm.trim() || "훈련중",
              isDropout: dropout || graduated,
              attendanceRate,
              absentDays,
              totalDays: td,
              maxAbsent,
              remainingAbsent,
              riskLevel: (dropout || graduated) ? "safe" as const : getRiskLevel(remainingAbsent, td),
            });
          }
        } catch (err) {
          console.warn("[Dashboard] 과정 데이터 조회 실패:", err);
        }

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
        <div class="dash-kpi-label">관리대상 <span class="dash-kpi-help" title="총 훈련일수의 20%가 최대 허용 결석일수입니다.&#10;&#10;🔴 제적위험: 잔여 허용 결석 15% 이하&#10;🟠 경고: 잔여 허용 결석 30% 이하&#10;🟡 주의: 잔여 허용 결석 60% 이하&#10;&#10;※ 전일자까지의 확정 출결 데이터 기준">ⓘ</span></div>
        <div class="dash-kpi-value">${riskTotal}명</div>
      </div>
      <div class="dash-kpi-footer">
        <span class="dash-kpi-risk-tag risk-danger">🔴 제적위험 ${dangerCount}</span>
        <span class="dash-kpi-risk-tag risk-warning">🟠 경고 ${warningCount}</span>
        <span class="dash-kpi-risk-tag risk-caution">🟡 주의 ${cautionCount}</span>
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

  const labels = [...courseMap.keys()].map((n) => (n.length > 8 ? n.slice(0, 8) + ".." : n));
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
        datasets: [
          {
            data,
            backgroundColor: CHART_COLORS.donut.slice(0, data.length),
            borderWidth: 2,
            borderColor: "#ffffff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "55%",
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: CHART_COLORS.text, padding: 12, usePointStyle: true, font: { size: 11 } },
          },
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
  const avgAttendance =
    activeTrainees.length > 0 ? activeTrainees.reduce((s, t) => s + t.attendanceRate, 0) / activeTrainees.length : 0;
  const courseCount = new Set(courseData.map((c) => c.courseName)).size;
  const degrCount = courseData.length;

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">운영 현황 요약</h3>
    </div>
    <div style="padding:4px 20px 16px;">
      <div class="dash-stat-big">${activeAll}<span style="font-size:14px;font-weight:500;color:var(--text-secondary);margin-left:4px;">명 재적</span></div>
      <div class="dash-stat-bar"><div class="dash-stat-bar-fill" style="width:${totalAll > 0 ? (activeAll / totalAll) * 100 : 0}%"></div></div>
      <div style="margin-top:16px;display:flex;flex-direction:column;gap:0;">
        <div class="dash-stat-row"><span class="dash-stat-label">운영 과정</span><span class="dash-stat-value">${courseCount}개 · ${degrCount}기수</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">전체 등록</span><span class="dash-stat-value">${totalAll}명</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">이탈 인원</span><span class="dash-stat-value">${dropoutAll}명</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">평균 출석률</span><span class="dash-stat-value">${avgAttendance.toFixed(1)}%</span></div>
        <div class="dash-stat-row"><span class="dash-stat-label">하차방어율</span><span class="dash-stat-value">${totalAll > 0 ? ((activeAll / totalAll) * 100).toFixed(1) : 0}%</span></div>
      </div>
    </div>
  `;
}

// ─── Data Integrity Warnings ─────────────────────────────
/** totalDays vs 실제 출결일수 정합성 검증 경고 */
function renderIntegrityWarnings(courseData: DashCourseData[]): void {
  // 기존 경고 제거
  document.getElementById("dashIntegrityWarnings")?.remove();

  const warnings: string[] = [];

  for (const c of courseData) {
    if (c.configTotalDays === 0) continue; // 미설정 과정은 스킵
    if (c.isCompleted) {
      // 종강 과정: 실제 출결일이 설정값보다 크면 totalDays 설정 오류 가능
      if (c.actualDays > c.configTotalDays) {
        warnings.push(
          `<strong>${c.courseName} ${c.degr}기</strong>: 실제 출결일(${c.actualDays}일) > 설정 훈련일(${c.configTotalDays}일) — totalDays 확인 필요`,
        );
      }
    } else {
      // 훈련중 과정: 실제 출결일이 설정값의 진행률 대비 크게 초과하면 경고
      if (c.actualDays > c.configTotalDays) {
        warnings.push(
          `<strong>${c.courseName} ${c.degr}기</strong>: 실제 출결일(${c.actualDays}일)이 설정 훈련일(${c.configTotalDays}일)을 초과 — 결석허용일수(${Math.floor(c.configTotalDays * 0.2)}일) 부정확 가능`,
        );
      }
    }
  }

  if (warnings.length === 0) return;

  const section = document.getElementById("sectionDashboard");
  if (!section) return;

  const el = document.createElement("div");
  el.id = "dashIntegrityWarnings";
  el.className = "dash-integrity-warn";
  el.innerHTML = `
    <div class="dash-integrity-header">⚠️ 데이터 정합성 경고 (${warnings.length}건)</div>
    <ul class="dash-integrity-list">${warnings.map((w) => `<li>${w}</li>`).join("")}</ul>
    <p class="dash-integrity-note">설정 → 과정 관리에서 totalDays를 확인해주세요.</p>
  `;

  // KPI 카드 아래에 삽입
  const kpiCards = document.getElementById("dashboardKpiCards");
  if (kpiCards?.parentElement) {
    kpiCards.parentElement.insertBefore(el, kpiCards.nextSibling);
  }
}

// ─── Progress Chart (기수별 진행률 세로형 막대그래프) ────────────────
function renderProgressChart(courseData: DashCourseData[], courses: HrdCourse[]): void {
  const container = $("dashboardTrendChart");
  if (!container) return;

  const activeCourses = courses.filter(isTrainingCourse);

  // 기수 단위 라벨 + 진행률 — 진행률순 내림차순 정렬
  const entries = courseData
    .filter((c) => {
      const course = activeCourses.find((ac) => ac.name === c.courseName);
      return !!course;
    })
    .sort((a, b) => b.progress - a.progress);

  if (entries.length === 0) {
    container.innerHTML = `<div class="dash-empty">운영 중인 과정이 없습니다.</div>`;
    return;
  }

  const labels = entries.map((e) => {
    const shortName = e.courseName.length > 8 ? e.courseName.slice(0, 8) + ".." : e.courseName;
    return `${shortName} ${e.degr}기`;
  });
  const progressData = entries.map((e) => e.progress);

  // 진행률 구간별 색상
  const barColors = progressData.map((p) =>
    p >= 80 ? CHART_COLORS.primary : p >= 50 ? CHART_COLORS.green : p >= 20 ? CHART_COLORS.amber : CHART_COLORS.orange,
  );

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">운영 과정 · 기수별 진행률</h3>
      <span class="dash-panel-count">${entries.length}개 기수</span>
    </div>
    <div class="dash-chart-canvas-wrap"><canvas id="dashChartProgress"></canvas></div>
  `;

  const ctx = (document.getElementById("dashChartProgress") as HTMLCanvasElement)?.getContext("2d");
  if (ctx) {
    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "진행률 (%)",
            data: progressData,
            backgroundColor: barColors,
            borderRadius: 6,
            barPercentage: 0.7,
            categoryPercentage: 0.8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "x",
        scales: {
          x: {
            ticks: { color: CHART_COLORS.text, font: { size: 10 }, maxRotation: 45, minRotation: 0 },
            grid: { display: false },
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: CHART_COLORS.text, callback: (v) => v + "%" },
            grid: { color: CHART_COLORS.grid },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                if (items.length > 0) {
                  const idx = items[0].dataIndex;
                  const e = entries[idx];
                  return `${e.courseName} ${e.degr}기`;
                }
                return "";
              },
              afterBody: (items) => {
                if (items.length > 0) {
                  const idx = items[0].dataIndex;
                  const e = entries[idx];
                  const course = activeCourses.find((ac) => ac.name === e.courseName);
                  const lines: string[] = [];
                  lines.push(`재적 ${e.active}명 / 이탈 ${e.dropout}명`);
                  if (course?.startDate && course?.totalDays) {
                    const end = new Date(course.startDate);
                    end.setDate(end.getDate() + Math.ceil((course.totalDays / 5) * 7));
                    lines.push(`종강 예정: ${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`);
                  }
                  return lines.join("\n");
                }
                return "";
              },
            },
          },
        },
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
  const badgeLabel = (level: string) => (level === "danger" ? "제적위험" : level === "warning" ? "경고" : "주의");

  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">관리대상 학생</h3>
      <span class="dash-panel-count">${riskStudents.length}명</span>
    </div>
    <div class="dash-risk-guide">
      <span class="dash-risk-guide-item">🔴 제적위험 <small>잔여 ≤15%</small></span>
      <span class="dash-risk-guide-item">🟠 경고 <small>잔여 ≤30%</small></span>
      <span class="dash-risk-guide-item">🟡 주의 <small>잔여 ≤60%</small></span>
      <span class="dash-risk-guide-note">※ 허용 결석일수(훈련일의 20%) 대비 잔여 비율 기준 · 전일자 확정 데이터</span>
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

  const courseMap = new Map<
    string,
    { total: number; dropout: number; category: CourseCategory; riskCount: number; activeCount: number }
  >();
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
        labels: courseNames.map((n) => (n.length > 8 ? n.slice(0, 8) + ".." : n)),
        datasets: [
          {
            label: "방어율 (%)",
            data: defenseRates,
            backgroundColor: defenseRates.map((r, i) =>
              r >= targetRates[i]
                ? CHART_COLORS.green
                : r >= targetRates[i] - 5
                  ? CHART_COLORS.amber
                  : CHART_COLORS.red,
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
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: CHART_COLORS.text, padding: 12, usePointStyle: true, font: { size: 11 } },
          },
        },
      },
    });
    chartInstances.push(chart1);
  }
}

// ─── Completed Course Results ────────────────────────────
/** 종강 과정 운영 결과 지표 렌더링 */
function renderCompletedCourseResults(courseData: DashCourseData[]): void {
  const container = $("dashboardCompleted");
  if (!container) return;

  const completed = courseData.filter((c) => c.isCompleted);
  if (completed.length === 0) {
    container.style.display = "none";
    return;
  }

  // 만족도 캐시 로드 + 기수별 집계
  const satRecords = loadSatisfactionCache() ?? [];
  const satSummaries = summarizeByCohort(satRecords, "", "");
  const satMap = new Map<string, { NPS: number; 강사만족도: number; 중간만족도: number; 최종만족도: number }>();
  for (const s of satSummaries) {
    satMap.set(`${s.과정명}|${s.기수}`, {
      NPS: s.NPS평균,
      강사만족도: s.강사만족도평균,
      중간만족도: s.중간만족도평균,
      최종만족도: s.최종만족도평균,
    });
  }

  const rows = completed
    .sort((a, b) => b.defenseRate - a.defenseRate)
    .map((c) => {
      const completionRate = c.total > 0 ? ((c.active / c.total) * 100).toFixed(1) : "-";
      const sat = satMap.get(`${c.courseName}|${c.degr}`);
      const nps = sat ? String(sat.NPS) : "-";
      const instrSat = sat ? sat.강사만족도.toFixed(1) : "-";
      const finalSat = sat ? (sat.최종만족도 > 0 ? sat.최종만족도.toFixed(1) : sat.중간만족도 > 0 ? sat.중간만족도.toFixed(1) : "-") : "-";

      // 수료율 색상
      const rateNum = parseFloat(completionRate);
      const rateClass = isNaN(rateNum) ? "" : rateNum >= 85 ? "dash-result-good" : rateNum >= 75 ? "dash-result-ok" : "dash-result-low";

      return `<tr>
        <td><strong>${c.courseName}</strong> ${c.degr}기</td>
        <td>${c.total}명</td>
        <td class="${rateClass}">${completionRate}%</td>
        <td>${nps}</td>
        <td>${instrSat}</td>
        <td>${finalSat}</td>
      </tr>`;
    })
    .join("");

  container.style.display = "";
  container.innerHTML = `
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">종강 과정 운영 결과</h3>
      <span class="dash-panel-count">${completed.length}개 기수</span>
    </div>
    <div style="overflow-x:auto;">
      <table class="dash-result-table">
        <thead>
          <tr>
            <th>과정·기수</th>
            <th>등록</th>
            <th>수료율</th>
            <th>NPS</th>
            <th>강사만족도</th>
            <th>HRD만족도</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${satRecords.length === 0 ? '<p class="muted" style="margin:8px 0 0;font-size:12px;">※ 만족도 데이터가 없습니다. 만족도 탭에서 먼저 조회해주세요.</p>' : ""}
  `;
}

// ─── Navigation to Trainee History ──────────────────────
export function navigateToTraineeHistory(name: string, courseName: string, trainPrId: string, degr: string): void {
  const navButton = document.querySelector<HTMLButtonElement>('[data-nav-key="traineeHistory"]');
  if (navButton) navButton.click();

  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("openTraineeDetail", {
        detail: { name, courseName, trainPrId, degr },
      }),
    );
  }, 300);
}

// ─── Init ───────────────────────────────────────────────

async function loadAndRender(): Promise<void> {
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
    renderHealthScorePanel(courseData, trainees);
    renderDonutChart(courseData);
    renderStatsPanel(courseData, trainees);
    renderProgressChart(courseData, filterCoursesByYear(config.courses, currentYearFilter));
    renderRiskStudentList(trainees);
    renderCompletedCourseResults(courseData);
    renderCompareCharts(courseData, trainees);
    renderIntegrityWarnings(courseData);

    // 필터 설명 업데이트
    const descEl = $("dashFilterDesc");
    if (descEl) {
      const labels: Record<string, string> = {
        training: "훈련 중인 과정의 핵심 KPI를 한눈에 확인합니다.",
        all: "전체 과정(종강 포함)의 KPI를 한눈에 확인합니다.",
      };
      descEl.textContent =
        labels[currentYearFilter] ?? `${currentYearFilter}년 개강 과정의 KPI를 한눈에 확인합니다.`;
    }
  } catch (e) {
    const container = $("dashboardKpiCards");
    if (container)
      container.innerHTML = `<div class="dash-empty">데이터를 불러올 수 없습니다. 설정을 확인해주세요.</div>`;
    console.warn("[Dashboard] Error:", e);
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function setupYearFilter(): void {
  const btns = document.querySelectorAll<HTMLButtonElement>("[data-dash-year]");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const year = btn.dataset.dashYear ?? "training";
      if (year === currentYearFilter) return;

      currentYearFilter = year;
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      void loadAndRender();
    });
  });
}

// ─── Course Health Score ───────────────────────────────────

interface CourseHealthScore {
  courseName: string;
  degr: string;
  category: string;
  score: number;
  defenseRate: number;
  avgAttendance: number;
  greenRate: number;
  nps: number;
  safeRate: number;
  level: "excellent" | "good" | "caution" | "danger";
  missing: string[];
}

function getHealthLevel(score: number): "excellent" | "good" | "caution" | "danger" {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "caution";
  return "danger";
}

function getHealthEmoji(level: string): string {
  switch (level) {
    case "excellent": return "🟢";
    case "good": return "🟡";
    case "caution": return "🟠";
    case "danger": return "🔴";
    default: return "⚪";
  }
}

function getHealthLabel(level: string): string {
  switch (level) {
    case "excellent": return "우수";
    case "good": return "양호";
    case "caution": return "주의";
    case "danger": return "위험";
    default: return "-";
  }
}

function calcCourseHealthScores(courseData: DashCourseData[], trainees: DashTrainee[]): CourseHealthScore[] {
  // 성취도 데이터
  const achievementRecords = loadCachedAchievementRecords();
  const achievementByTrainee = achievementRecords.length > 0 ? summarizeByTrainee(achievementRecords) : [];

  // 만족도 데이터
  const satisfactionRecords = loadCachedSatisfactionRecords();
  const satSummaries = satisfactionRecords.length > 0 ? satSummarizeByCohort(satisfactionRecords, "", "") : [];

  const scores: CourseHealthScore[] = [];

  for (const course of courseData) {
    if (course.isCompleted) continue; // 종강 과정 제외

    const courseTrainees = trainees.filter(
      (t) => t.courseName === course.courseName && t.degr === course.degr && !t.isDropout,
    );
    if (courseTrainees.length === 0) continue;

    // 1. 하차방어율 (0~100)
    const defenseRate = course.defenseRate;

    // 2. 평균 출석률 (0~100)
    const validAtt = courseTrainees.filter((t) => t.attendanceRate >= 0);
    const avgAttendance = validAtt.length > 0
      ? validAtt.reduce((s, t) => s + t.attendanceRate, 0) / validAtt.length
      : 0;

    // 3. 성취도 Green 비율
    let greenRate = -1; // -1 = 데이터 없음
    if (achievementByTrainee.length > 0) {
      const names = new Set(courseTrainees.map((t) => t.name.replace(/\s+/g, "")));
      const matched = achievementByTrainee.filter((a) => names.has(a.이름.replace(/\s+/g, "")));
      if (matched.length > 0) {
        const greenCount = matched.filter((a) => a.신호등 === "green").length;
        greenRate = (greenCount / matched.length) * 100;
      }
    }

    // 4. NPS 정규화 (0~100)
    let nps = -1;
    const satMatch = satSummaries.find(
      (s) => s.과정명 === course.courseName && s.기수 === course.degr,
    );
    if (satMatch && satMatch.NPS평균 !== 0) {
      nps = (satMatch.NPS평균 + 100) / 2; // -100~100 → 0~100
    }

    // 5. 안전학생 비율
    const safeCount = courseTrainees.filter((t) => t.riskLevel === "safe").length;
    const safeRate = courseTrainees.length > 0 ? (safeCount / courseTrainees.length) * 100 : 100;

    // 가중 평균 (데이터 없는 지표 제외 후 재분배)
    const weights: { value: number; weight: number }[] = [];
    const missing: string[] = [];

    weights.push({ value: defenseRate, weight: 30 });
    weights.push({ value: avgAttendance, weight: 25 });

    if (greenRate >= 0) {
      weights.push({ value: greenRate, weight: 20 });
    } else {
      missing.push("성취도");
    }

    if (nps >= 0) {
      weights.push({ value: nps, weight: 15 });
    } else {
      missing.push("NPS");
    }

    weights.push({ value: safeRate, weight: 10 });

    const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
    const score = totalWeight > 0
      ? Math.round(weights.reduce((s, w) => s + w.value * (w.weight / totalWeight), 0) * 10) / 10
      : 0;

    scores.push({
      courseName: course.courseName,
      degr: course.degr,
      category: course.category,
      score,
      defenseRate: Math.round(defenseRate * 10) / 10,
      avgAttendance: Math.round(avgAttendance * 10) / 10,
      greenRate: greenRate >= 0 ? Math.round(greenRate * 10) / 10 : -1,
      nps: nps >= 0 ? Math.round(nps * 10) / 10 : -1,
      safeRate: Math.round(safeRate * 10) / 10,
      level: getHealthLevel(score),
      missing,
    });
  }

  return scores.sort((a, b) => a.score - b.score); // 낮은 점수(위험)가 위로
}

function renderHealthScorePanel(courseData: DashCourseData[], trainees: DashTrainee[]): void {
  const container = $("dashboardHealthScore");
  if (!container) return;

  const scores = calcCourseHealthScores(courseData, trainees);
  if (scores.length === 0) {
    container.style.display = "none";
    return;
  }
  container.style.display = "";

  // 전체 평균
  const avgScore = Math.round(scores.reduce((s, h) => s + h.score, 0) / scores.length * 10) / 10;
  const avgLevel = getHealthLevel(avgScore);

  // 미니 프로그레스 바 헬퍼
  const miniBar = (value: number, max: number = 100) => {
    if (value < 0) return '<span style="color:var(--text-muted);font-size:11px">-</span>';
    const pct = Math.min(value / max * 100, 100);
    const color = pct >= 80 ? "var(--success)" : pct >= 60 ? "#f59e0b" : pct >= 40 ? "#f97316" : "var(--danger)";
    return `<div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:12px;font-weight:600;min-width:38px">${value.toFixed(0)}${max === 100 ? "%" : ""}</span>
      <div class="health-bar-bg"><div class="health-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  };

  // 자동 인사이트
  const insights: string[] = [];
  const worst = scores[0];
  const best = scores[scores.length - 1];
  if (worst && worst.level === "danger") {
    insights.push(`🔴 즉시 개입: ${worst.courseName} ${worst.degr}기 — 건강도 ${worst.score}점`);
  } else if (worst && worst.level === "caution") {
    insights.push(`🟠 관찰 필요: ${worst.courseName} ${worst.degr}기 — 건강도 ${worst.score}점`);
  }
  if (best && best.level === "excellent") {
    insights.push(`🟢 우수 운영: ${best.courseName} ${best.degr}기 — 건강도 ${best.score}점`);
  }

  const rows = scores.map((h) => `
    <tr>
      <td style="font-weight:600">${h.courseName.length > 12 ? h.courseName.slice(0, 12) + "…" : h.courseName}</td>
      <td>${h.degr}기</td>
      <td><span class="health-badge health-${h.level}">${getHealthEmoji(h.level)} ${h.score}</span></td>
      <td>${miniBar(h.defenseRate)}</td>
      <td>${miniBar(h.avgAttendance)}</td>
      <td>${miniBar(h.greenRate)}</td>
      <td>${miniBar(h.nps)}</td>
      <td>${miniBar(h.safeRate)}</td>
    </tr>
  `).join("");

  container.innerHTML = `
    <div class="health-header">
      <div class="health-header-left">
        <h3 class="dash-panel-title">과정 건강도</h3>
        <span style="font-size:12px;color:var(--text-secondary)">${scores.length}개 과정/기수</span>
      </div>
      <div class="health-gauge-wrap">
        <span class="health-gauge health-${avgLevel}">${avgScore}</span>
        <span class="health-gauge-label">${getHealthLabel(avgLevel)}</span>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table class="health-table">
        <thead>
          <tr>
            <th>과정</th><th>기수</th><th>건강도</th>
            <th>방어율</th><th>출석률</th><th>성취도</th><th>NPS</th><th>안전비율</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${insights.length > 0 ? `<div class="health-insights">${insights.map((i) => `<div class="health-insight-item">${i}</div>`).join("")}</div>` : ""}
  `;
}

export async function initDashboard(): Promise<void> {
  setupYearFilter();
  await loadAndRender();
}
