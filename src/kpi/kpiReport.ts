/**
 * KPI 리포트 렌더링 모듈
 * — 카드, 차트(Chart.js), 테이블을 그립니다.
 */
import type { KpiAllData, AchievementRecord, FormativeRecord, FieldAppRecord } from "./kpiTypes";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

// ── 차트 인스턴스 관리 ───────────────────────────────────
const chartInstances: Record<string, Chart> = {};

function destroyChart(id: string): void {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function getCtx(id: string): CanvasRenderingContext2D | null {
  const el = document.getElementById(id) as HTMLCanvasElement | null;
  return el?.getContext("2d") ?? null;
}

// ── 필터링 유틸 ──────────────────────────────────────────
function filterByCourse<T extends { course: string; cohort: string }>(
  records: T[],
  course: string,
  cohort: string,
): T[] {
  let result = records;
  if (course !== "all") result = result.filter((r) => r.course === course);
  if (cohort !== "all") result = result.filter((r) => r.cohort === cohort);
  return result;
}

// ── 메인 렌더 ────────────────────────────────────────────
export function renderKpiDashboard(data: KpiAllData, course = "all", cohort = "all"): void {
  const ach = filterByCourse(data.achievement, course, cohort);
  const frm = filterByCourse(data.formative, course, cohort);
  const fa = filterByCourse(data.fieldApp, course, cohort);

  renderCards(ach, frm, fa);
  renderCharts(ach, frm, fa, data);
  renderTables(ach, frm, fa, data, course, cohort);

  // 대시보드 표시
  const empty = document.getElementById("kpiEmptyState");
  const content = document.getElementById("kpiDashboardContent");
  if (empty) empty.style.display = "none";
  if (content) content.style.display = "block";
}

// ── 필터 드롭다운 채우기 ─────────────────────────────────
export function populateFilters(data: KpiAllData): void {
  const courseSelect = document.getElementById("kpiFilterCourse") as HTMLSelectElement | null;
  const cohortSelect = document.getElementById("kpiFilterCohort") as HTMLSelectElement | null;
  if (!courseSelect || !cohortSelect) return;

  // 과정
  const courses = [...new Set(data.achievement.map((r) => r.course))];
  courseSelect.innerHTML = '<option value="all">전체 과정</option>';
  for (const c of courses) {
    courseSelect.innerHTML += `<option value="${c}">${c}</option>`;
  }

  // 기수
  const cohorts = [...new Set(data.achievement.map((r) => r.cohort))];
  cohortSelect.innerHTML = '<option value="all">전체 기수</option>';
  for (const c of cohorts) {
    cohortSelect.innerHTML += `<option value="${c}">${c}</option>`;
  }
}

// ── KPI 카드 ─────────────────────────────────────────────
function renderCards(ach: AchievementRecord[], frm: FormativeRecord[], fa: FieldAppRecord[]): void {
  const totalStudents = ach.length;
  const preAvg = totalStudents > 0 ? ach.reduce((s, r) => s + r.preTotal, 0) / totalStudents : 0;
  const postAvg = totalStudents > 0 ? ach.reduce((s, r) => s + r.postTotal, 0) / totalStudents : 0;
  const improvementAvg = totalStudents > 0 ? ach.reduce((s, r) => s + r.improvement, 0) / totalStudents : 0;
  const formativeAvg = frm.length > 0 ? frm.reduce((s, r) => s + r.overallAvg, 0) / frm.length : 0;
  const fieldAppAvg = fa.length > 0 ? fa.reduce((s, r) => s + r.avgScore, 0) / fa.length : 0;

  setText("kpiTotalStudents", String(totalStudents));
  setText("kpiPreAvg", preAvg.toFixed(1));
  setText("kpiPostAvg", postAvg.toFixed(1));
  setText("kpiImprovement", `+${improvementAvg.toFixed(1)}`);
  setText("kpiFormativeAvg", formativeAvg.toFixed(2));
  setText("kpiFieldAppAvg", fieldAppAvg.toFixed(2));
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── 차트 ─────────────────────────────────────────────────
const COLORS = {
  pre: "rgba(156, 163, 175, 0.7)",
  post: "rgba(99, 102, 241, 0.8)",
  accent: "rgba(16, 185, 129, 0.8)",
  grades: ["#6366f1", "#3b82f6", "#f59e0b", "#ef4444", "#9ca3af"],
  radar: "rgba(99, 102, 241, 0.3)",
  radarBorder: "rgba(99, 102, 241, 1)",
  phase1: "rgba(156, 163, 175, 0.7)",
  phase2: "rgba(99, 102, 241, 0.8)",
};

function renderCharts(ach: AchievementRecord[], frm: FormativeRecord[], fa: FieldAppRecord[], data: KpiAllData): void {
  renderAchievementChart(ach);
  renderGradeDistribution(
    "kpiChartGradePre",
    ach.map((r) => r.preGrade),
    "사전 등급 분포",
  );
  renderGradeDistribution(
    "kpiChartGradePost",
    ach.map((r) => r.postGrade),
    "사후 등급 분포",
  );
  renderFormativeChart(frm);
  renderRadarChart(fa);
  renderResponseChart(ach, frm, fa);
}

function renderAchievementChart(ach: AchievementRecord[]): void {
  const id = "kpiChartAchievement";
  destroyChart(id);
  const ctx = getCtx(id);
  if (!ctx) return;

  // 과정별 그룹핑
  const courseMap = new Map<string, { pre: number[]; post: number[] }>();
  for (const r of ach) {
    if (!courseMap.has(r.course)) courseMap.set(r.course, { pre: [], post: [] });
    const g = courseMap.get(r.course)!;
    g.pre.push(r.preTotal);
    g.post.push(r.postTotal);
  }

  const labels = [...courseMap.keys()];
  const preAvgs = labels.map((k) => {
    const arr = courseMap.get(k)!.pre;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  });
  const postAvgs = labels.map((k) => {
    const arr = courseMap.get(k)!.post;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  });

  chartInstances[id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "사전 평균", data: preAvgs, backgroundColor: COLORS.pre, borderRadius: 4 },
        { label: "사후 평균", data: postAvgs, backgroundColor: COLORS.post, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 30 } },
      plugins: { legend: { position: "top" } },
    },
  });
}

function renderGradeDistribution(canvasId: string, grades: string[], title: string): void {
  destroyChart(canvasId);
  const ctx = getCtx(canvasId);
  if (!ctx) return;

  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const g of grades) {
    if (g in counts) counts[g]++;
  }

  chartInstances[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [
        {
          data: Object.values(counts),
          backgroundColor: COLORS.grades,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, title: { display: false } },
    },
  });
}

function renderFormativeChart(frm: FormativeRecord[]): void {
  const id = "kpiChartFormative";
  destroyChart(id);
  const ctx = getCtx(id);
  if (!ctx) return;

  // 과정별 주차별 평균
  const courseMap = new Map<string, number[][]>();
  for (const r of frm) {
    if (!courseMap.has(r.course)) courseMap.set(r.course, []);
    courseMap.get(r.course)!.push([...r.phase1Scores, ...r.phase2Scores]);
  }

  const labels = ["1주차", "2주차", "3주차", "4주차", "5주차", "6주차", "7주차", "8주차"];
  const datasets = [...courseMap.entries()].map(([course, allScores], idx) => {
    const weekAvgs = labels.map((_, wi) => {
      const vals = allScores.map((s) => s[wi]).filter((v) => v > 0);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    const colors = ["rgba(99, 102, 241, 0.8)", "rgba(16, 185, 129, 0.8)", "rgba(245, 158, 11, 0.8)"];
    return {
      label: course,
      data: weekAvgs,
      borderColor: colors[idx % colors.length],
      backgroundColor: "transparent",
      tension: 0.3,
      pointRadius: 4,
    };
  });

  chartInstances[id] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: false, min: 1, max: 5 } },
      plugins: { legend: { position: "top" } },
    },
  });
}

function renderRadarChart(fa: FieldAppRecord[]): void {
  const id = "kpiChartRadar";
  destroyChart(id);
  const ctx = getCtx(id);
  if (!ctx) return;

  const radarLabels = ["업무이해", "적용계획", "도구활용", "성과기대", "장애요인", "지속의지"];
  const avgScores = radarLabels.map((_, qi) => {
    const vals = fa.map((r) => r.scores[qi]).filter((v) => v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  chartInstances[id] = new Chart(ctx, {
    type: "radar",
    data: {
      labels: radarLabels,
      datasets: [
        {
          label: "현업적용 평균",
          data: avgScores,
          backgroundColor: COLORS.radar,
          borderColor: COLORS.radarBorder,
          pointBackgroundColor: COLORS.radarBorder,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { r: { beginAtZero: true, max: 5, ticks: { stepSize: 1 } } },
    },
  });
}

function renderResponseChart(ach: AchievementRecord[], frm: FormativeRecord[], fa: FieldAppRecord[]): void {
  const id = "kpiChartResponse";
  destroyChart(id);
  const ctx = getCtx(id);
  if (!ctx) return;

  const achCompleted = ach.filter((r) => r.status.includes("완료")).length;
  const frmCompleted = frm.filter((r) => r.status.includes("양호") || r.status.includes("우수")).length;
  const faCompleted = fa.filter((r) => r.status.includes("완료")).length;

  const total = Math.max(ach.length, 1);
  const achRate = (achCompleted / total) * 100;
  const frmRate = (frmCompleted / Math.max(frm.length, 1)) * 100;
  const faRate = (faCompleted / Math.max(fa.length, 1)) * 100;

  chartInstances[id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["성취평가", "형성평가", "현업적용"],
      datasets: [
        {
          label: "응답/완료율 (%)",
          data: [achRate, frmRate, faRate],
          backgroundColor: [COLORS.post, COLORS.accent, "rgba(245, 158, 11, 0.8)"],
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: { x: { beginAtZero: true, max: 100 } },
      plugins: { legend: { display: false } },
    },
  });
}

// ── 테이블 ───────────────────────────────────────────────
function renderTables(
  ach: AchievementRecord[],
  frm: FormativeRecord[],
  fa: FieldAppRecord[],
  data: KpiAllData,
  course: string,
  cohort: string,
): void {
  renderSummaryTable(data, course, cohort);
  renderAchievementTable(ach);
  renderFormativeTable(frm);
  renderFieldAppTable(fa);
}

function gradeClass(grade: string): string {
  return `kpi-grade kpi-grade-${grade}`;
}

function renderSummaryTable(data: KpiAllData, course: string, cohort: string): void {
  const el = document.getElementById("kpiTableSummary");
  if (!el) return;

  let achRows = data.achievementSummary;
  let frmRows = data.formativeSummary;
  let faRows = data.fieldAppSummary;

  if (course !== "all") {
    achRows = achRows.filter((r) => r.course === course || r.course === "전체");
    frmRows = frmRows.filter((r) => r.course === course || r.course === "전체");
    faRows = faRows.filter((r) => r.course === course || r.course === "전체");
  }

  el.innerHTML = `
    <h4 class="kpi-table-title">성취평가 집계</h4>
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead><tr>
          <th>과정</th><th>기수</th><th>학습자</th>
          <th>사전평균</th><th>사후평균</th><th>향상도</th>
          <th>A등급(사전)</th><th>A등급(사후)</th><th>응답률</th>
        </tr></thead>
        <tbody>
          ${achRows
            .map(
              (r) => `<tr>
            <td>${r.course}</td><td>${r.cohort}</td><td>${r.studentCount}</td>
            <td>${r.preAvg.toFixed(1)}</td><td><strong>${r.postAvg.toFixed(1)}</strong></td>
            <td class="kpi-improvement">+${r.improvement.toFixed(1)}</td>
            <td>${r.preGradeA}</td><td><strong>${r.postGradeA}</strong></td>
            <td>${(r.responseRate * 100).toFixed(0)}%</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <h4 class="kpi-table-title">형성평가 집계</h4>
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead><tr>
          <th>과정</th><th>기수</th><th>학습자</th>
          <th>1차 평균</th><th>2차 평균</th><th>종합 평균</th>
        </tr></thead>
        <tbody>
          ${frmRows
            .map(
              (r) => `<tr>
            <td>${r.course}</td><td>${r.cohort}</td><td>${r.studentCount}</td>
            <td>${r.phase1Avg.toFixed(2)}</td><td>${r.phase2Avg.toFixed(2)}</td>
            <td><strong>${r.overallAvg.toFixed(2)}</strong></td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <h4 class="kpi-table-title">현업적용평가 집계</h4>
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead><tr>
          <th>과정</th><th>기수</th><th>학습자</th>
          <th>평균점수</th><th>응답완료</th><th>응답률</th>
        </tr></thead>
        <tbody>
          ${faRows
            .map(
              (r) => `<tr>
            <td>${r.course}</td><td>${r.cohort}</td><td>${r.studentCount}</td>
            <td><strong>${r.avgScore.toFixed(2)}</strong></td>
            <td>${r.completed}</td>
            <td>${(r.responseRate * 100).toFixed(0)}%</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAchievementTable(ach: AchievementRecord[]): void {
  const el = document.getElementById("kpiTableAchievement");
  if (!el) return;

  el.innerHTML = `
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead><tr>
          <th>No</th><th>이름</th><th>과정</th><th>기수</th>
          <th>사전총점</th><th>사전등급</th><th>사후총점</th><th>사후등급</th>
          <th>향상도</th><th>등급변화</th>
        </tr></thead>
        <tbody>
          ${ach
            .map(
              (r) => `<tr>
            <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
            <td>${r.preTotal}</td><td><span class="${gradeClass(r.preGrade)}">${r.preGrade}</span></td>
            <td><strong>${r.postTotal}</strong></td><td><span class="${gradeClass(r.postGrade)}">${r.postGrade}</span></td>
            <td class="kpi-improvement">+${r.improvement}</td>
            <td>${r.gradeChange}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFormativeTable(frm: FormativeRecord[]): void {
  const el = document.getElementById("kpiTableFormative");
  if (!el) return;

  el.innerHTML = `
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead><tr>
          <th>No</th><th>이름</th><th>과정</th><th>기수</th>
          <th>1주</th><th>2주</th><th>3주</th><th>4주</th><th>1차평균</th>
          <th>5주</th><th>6주</th><th>7주</th><th>8주</th><th>2차평균</th>
          <th>종합</th><th>상태</th>
        </tr></thead>
        <tbody>
          ${frm
            .map(
              (r) => `<tr>
            <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
            ${r.phase1Scores.map((s) => `<td>${s}</td>`).join("")}
            <td><strong>${r.phase1Avg.toFixed(1)}</strong></td>
            ${r.phase2Scores.map((s) => `<td>${s}</td>`).join("")}
            <td><strong>${r.phase2Avg.toFixed(1)}</strong></td>
            <td><strong>${r.overallAvg.toFixed(2)}</strong></td>
            <td>${r.status}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFieldAppTable(fa: FieldAppRecord[]): void {
  const el = document.getElementById("kpiTableFieldApp");
  if (!el) return;

  const labels = ["업무이해", "적용계획", "도구활용", "성과기대", "장애요인", "지속의지"];

  el.innerHTML = `
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead><tr>
          <th>No</th><th>이름</th><th>과정</th><th>기수</th>
          ${labels.map((l) => `<th>${l}</th>`).join("")}
          <th>평균</th><th>등급</th>
        </tr></thead>
        <tbody>
          ${fa
            .map(
              (r) => `<tr>
            <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
            ${r.scores.map((s) => `<td>${s}</td>`).join("")}
            <td><strong>${r.avgScore.toFixed(2)}</strong></td>
            <td><span class="${gradeClass(r.grade)}">${r.grade}</span></td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ── 탭 전환 ──────────────────────────────────────────────
export function initKpiTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-kpi-tab]");
  const panels = document.querySelectorAll<HTMLElement>("[data-kpi-panel]");

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.kpiTab ?? "";
      for (const t of tabs) t.classList.toggle("is-active", t === tab);
      for (const p of panels) {
        p.classList.toggle("u-hidden", p.dataset.kpiPanel !== target);
      }
    });
  }
}

// ── 초기화 (빈 상태로 되돌리기) ──────────────────────────
export function resetKpiDashboard(): void {
  // 차트 파기
  for (const id of Object.keys(chartInstances)) {
    destroyChart(id);
  }

  // 카드 초기화
  for (const cardId of [
    "kpiTotalStudents",
    "kpiPreAvg",
    "kpiPostAvg",
    "kpiImprovement",
    "kpiFormativeAvg",
    "kpiFieldAppAvg",
  ]) {
    setText(cardId, "-");
  }

  // 테이블 비우기
  for (const tblId of ["kpiTableSummary", "kpiTableAchievement", "kpiTableFormative", "kpiTableFieldApp"]) {
    const el = document.getElementById(tblId);
    if (el) el.innerHTML = "";
  }

  // empty state로 복원
  const empty = document.getElementById("kpiEmptyState");
  const content = document.getElementById("kpiDashboardContent");
  if (empty) empty.style.display = "block";
  if (content) content.style.display = "none";
}
