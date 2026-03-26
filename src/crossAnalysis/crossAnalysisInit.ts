/**
 * 교차분석 탭 초기화
 *
 * 출결 × 학업성취도 × 만족도 데이터를 교차 분석합니다.
 * lazy-load 진입점: tabRegistry.ts에서 호출됨.
 */

import type { Chart } from "chart.js/auto";
import type { AttendanceStudent } from "../hrd/hrdTypes";
import {
  loadCachedAchievementRecords,
  loadCachedSatisfactionRecords,
  matchStudentData,
  matchCohortData,
  buildHeatmap,
  calcStudentStats,
  calcCohortStats,
  generateInsights,
  describeCorrelation,
  buildAttendanceDistribution,
  buildRiskDistribution,
  buildQuadrantAnalysis,
  buildGenderAnalysis,
  buildAgeGroupAnalysis,
  generateDemographicInsights,
} from "./crossAnalysisData";
import {
  renderScatterChart,
  renderHeatmapTable,
  renderRadarChart,
  destroyChart,
  renderHistogramChart,
  renderRiskDonutChart,
  renderBubbleChart,
  renderGenderComparisonChart,
  renderAgeGroupChart,
} from "./crossAnalysisCharts";
import type { StudentCrossData, CohortCrossData, HeatmapCell } from "./crossAnalysisTypes";

// ── DOM refs ───────────────────────────────────────────────

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** XSS 방지: HTML 특수문자 이스케이프 */
function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── State ──────────────────────────────────────────────────

let scatterChart: Chart | null = null;
let radarChart: Chart | null = null;
let histogramChart: Chart | null = null;
let riskDonutChart: Chart | null = null;
let bubbleChart: Chart | null = null;
let genderChart: Chart | null = null;
let ageGroupChart: Chart | null = null;
let currentStudentData: StudentCrossData[] = [];
let currentCohortData: CohortCrossData[] = [];

// ── 출결 데이터 조회 ──────────────────────────────────────

/** 캐시된 출결 데이터 반환 (이미 로드된 경우) */
async function loadAttendanceStudents(): Promise<AttendanceStudent[]> {
  try {
    const mod = await import("../hrd/hrdAttendance");
    if (typeof mod.getCachedAttendanceStudents === "function") {
      return mod.getCachedAttendanceStudents();
    }
  } catch {
    /* hrdAttendance 미로드 시 무시 */
  }
  return [];
}

/** 전체 과정/기수 출결 데이터를 HRD API에서 직접 조회 */
async function fetchAllAttendanceAndAnalyze(): Promise<void> {
  const statusEl = $("crossAnalysisStatus");
  const fetchBtn = $("crossFetchAllBtn") as HTMLButtonElement | null;

  if (fetchBtn) fetchBtn.disabled = true;
  if (statusEl) statusEl.textContent = "📊 전체 출결 데이터 조회 중...";

  try {
    const mod = await import("../hrd/hrdAttendance");
    if (typeof mod.fetchAllAttendanceData !== "function") {
      if (statusEl) statusEl.textContent = "⚠️ 전체 조회 기능을 사용할 수 없습니다.";
      return;
    }

    await mod.fetchAllAttendanceData((msg: string) => {
      if (statusEl) statusEl.textContent = `📊 ${msg}`;
    });

    // 조회 완료 → 분석 실행
    await runAnalysis();
  } catch (e) {
    if (statusEl) statusEl.textContent = `⚠️ 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (fetchBtn) fetchBtn.disabled = false;
  }
}

// ── 서브탭 전환 ───────────────────────────────────────────

function setupSubTabs(): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>("[data-cross-tab]");
  let retroInitialized = false;

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.crossTab;
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const studentPanel = $("crossPanelStudent");
      const cohortPanel = $("crossPanelCohort");
      const retroPanel = $("crossPanelRetrospective");
      if (studentPanel) studentPanel.style.display = target === "student" ? "" : "none";
      if (cohortPanel) cohortPanel.style.display = target === "cohort" ? "" : "none";
      if (retroPanel) retroPanel.style.display = target === "retrospective" ? "" : "none";

      // lazy init: 처음 열 때만 초기화
      if (target === "retrospective" && !retroInitialized) {
        retroInitialized = true;
        const { initRetrospective } = await import("./retrospectiveInit");
        initRetrospective();
      }
    });
  });
}

// ── 필터 채우기 ───────────────────────────────────────────

function fillSelect(select: HTMLSelectElement, placeholder: string, items: string[]): void {
  const prev = select.value;
  select.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = placeholder;
  select.appendChild(def);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  }
  // 이전 선택 복원
  if (prev && items.includes(prev)) select.value = prev;
}

function populateFilters(students: StudentCrossData[]): void {
  const courses = [...new Set(students.map((s) => s.과정))].sort();
  const cohorts = [...new Set(students.map((s) => s.기수))].sort();

  const courseSelect = $("crossFilterCourse") as HTMLSelectElement | null;
  const cohortSelect = $("crossFilterCohort") as HTMLSelectElement | null;
  const cohortCourseSelect = $("crossCohortFilterCourse") as HTMLSelectElement | null;

  if (courseSelect) fillSelect(courseSelect, "전체 과정", courses);
  if (cohortSelect) fillSelect(cohortSelect, "전체 기수", cohorts);
  if (cohortCourseSelect) fillSelect(cohortCourseSelect, "전체 과정", courses);
}

// ── 학생 교차분석 렌더링 ──────────────────────────────────

function renderStudentAnalysis(students: StudentCrossData[]): void {
  const stats = calcStudentStats(students);

  // 통계 카드 업데이트
  const elMatched = $("crossStatMatched");
  const elCorr = $("crossStatCorrelation");
  const elRisk = $("crossStatHighRisk");
  const elExcellent = $("crossStatExcellent");
  if (elMatched) elMatched.textContent = `${stats.matchedStudents}명`;
  if (elCorr) {
    const r = stats.correlationR;
    const rText = r >= 0 ? `+${r.toFixed(3)}` : r.toFixed(3);
    elCorr.innerHTML = `${rText}<br><span style="font-size:11px;color:var(--text-secondary)">${describeCorrelation(r)}</span>`;
  }
  if (elRisk) elRisk.textContent = `${stats.highRiskCount}명`;
  if (elExcellent) elExcellent.textContent = `${stats.excellentCount}명`;

  // 매칭 카운트 배지
  const badge = $("crossMatchCount");
  if (badge) badge.textContent = `${students.length}명 매칭`;

  // 산점도
  destroyChart(scatterChart);
  const scatterCanvas = $("crossScatterCanvas") as HTMLCanvasElement | null;
  if (scatterCanvas) {
    scatterChart = renderScatterChart(scatterCanvas, students);
  }

  // 히트맵
  const heatmapContainer = $("crossHeatmapContainer");
  if (heatmapContainer) {
    const cells = buildHeatmap(students);
    renderHeatmapTable(heatmapContainer, cells, onHeatmapCellClick);
  }

  // 평균 통계
  const avgAtt = students.length > 0 ? students.reduce((s, st) => s + st.attendanceRate, 0) / students.length : 0;
  const avgScore = students.length > 0 ? students.reduce((s, st) => s + st.compositeScore, 0) / students.length : 0;
  const elAvgAtt = $("crossStatAvgAtt");
  const elAvgScore = $("crossStatAvgScore");
  if (elAvgAtt) elAvgAtt.textContent = `${avgAtt.toFixed(1)}%`;
  if (elAvgScore) elAvgScore.textContent = `${avgScore.toFixed(1)}점`;

  // 출결률 분포 히스토그램
  destroyChart(histogramChart);
  const histCanvas = $("crossHistogramCanvas") as HTMLCanvasElement | null;
  if (histCanvas) {
    const distData = buildAttendanceDistribution(students);
    histogramChart = renderHistogramChart(histCanvas, distData);
  }

  // 위험등급 분포 도넛
  destroyChart(riskDonutChart);
  const riskCanvas = $("crossRiskDonutCanvas") as HTMLCanvasElement | null;
  if (riskCanvas) {
    const riskData = buildRiskDistribution(students);
    riskDonutChart = renderRiskDonutChart(riskCanvas, riskData);
  }

  // 사분면 분석
  const quadrant = buildQuadrantAnalysis(students);
  const quadrantEl = $("crossQuadrantInfo");
  if (quadrantEl) {
    quadrantEl.innerHTML = quadrant.quadrants
      .map((q) => `<div class="cx-quadrant-item"><span class="cx-quadrant-emoji">${q.emoji}</span><div><div class="cx-quadrant-label">${q.label}</div><div class="cx-quadrant-count">${q.count}명</div></div></div>`)
      .join("");
  }
  const medianEl = $("crossMedianInfo");
  if (medianEl) {
    medianEl.textContent = `중앙값 — 출결 ${quadrant.medianAttendance}% · 성취 ${quadrant.medianScore}점`;
  }

  // 성별 대조분석
  destroyChart(genderChart);
  const genderCanvas = $("crossGenderCanvas") as HTMLCanvasElement | null;
  const genderData = buildGenderAnalysis(students);
  if (genderCanvas && genderData.length > 0) {
    genderChart = renderGenderComparisonChart(genderCanvas, genderData);
  }
  const genderTableEl = $("crossGenderTable");
  if (genderTableEl && genderData.length > 0) {
    genderTableEl.innerHTML = genderData
      .map(
        (g) =>
          `<tr><td><strong>${g.gender}성</strong></td><td>${g.count}명</td><td>${g.avgAttendance}%</td><td>${g.avgScore}점</td><td>${g.greenRate}%</td><td>${g.dangerRate}%</td></tr>`,
      )
      .join("");
  } else if (genderTableEl) {
    genderTableEl.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">성별 데이터 없음 (설정 → 훈련생 성별 지정 필요)</td></tr>';
  }

  // 연령대 대조분석
  destroyChart(ageGroupChart);
  const ageCanvas = $("crossAgeCanvas") as HTMLCanvasElement | null;
  const ageData = buildAgeGroupAnalysis(students);
  if (ageCanvas && ageData.length > 0) {
    ageGroupChart = renderAgeGroupChart(ageCanvas, ageData);
  }
  const ageTableEl = $("crossAgeTable");
  if (ageTableEl && ageData.length > 0) {
    ageTableEl.innerHTML = ageData
      .map(
        (a) =>
          `<tr><td><strong>${a.ageGroup}</strong></td><td>${a.count}명</td><td>${a.avgAttendance}%</td><td>${a.avgScore}점</td><td>${a.greenRate}%</td><td>${a.dangerRate}%</td></tr>`,
      )
      .join("");
  } else if (ageTableEl) {
    ageTableEl.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">연령 데이터 없음</td></tr>';
  }

  // 인구통계 인사이트
  const demoInsights = generateDemographicInsights(genderData, ageData, students);
  const demoInsightEl = $("crossDemoInsights");
  if (demoInsightEl) {
    demoInsightEl.innerHTML =
      demoInsights.length > 0
        ? demoInsights.map((t) => `<li>📊 ${esc(t)}</li>`).join("")
        : '<li style="color:var(--text-muted)">인구통계 데이터가 부족하여 인사이트를 생성할 수 없습니다.</li>';
  }
}

// ── 기수 교차분석 렌더링 ──────────────────────────────────

function renderCohortAnalysis(cohorts: CohortCrossData[], students: StudentCrossData[]): void {
  const stats = calcCohortStats(cohorts);

  // 통계 카드
  const elCohorts = $("crossStatCohorts");
  const elBest = $("crossStatBestCohort");
  const elImprove = $("crossStatNeedsImprovement");
  if (elCohorts) elCohorts.textContent = `${stats.matchedCohorts}개`;
  if (elBest) elBest.textContent = stats.bestCohort;
  if (elImprove) {
    if (stats.needsImprovement.length > 0) {
      elImprove.innerHTML = `${stats.needsImprovement.length}개<br><span style="font-size:11px;color:var(--text-secondary)">${stats.needsImprovement.map(esc).join(", ")}</span>`;
    } else {
      elImprove.textContent = "-";
    }
  }

  // 레이더 차트
  destroyChart(radarChart);
  const radarCanvas = $("crossRadarCanvas") as HTMLCanvasElement | null;
  if (radarCanvas && cohorts.length > 0) {
    radarChart = renderRadarChart(radarCanvas, cohorts);
  }

  // 비교 테이블
  const tbody = $("crossCohortTableBody");
  if (tbody) {
    tbody.innerHTML = cohorts
      .map(
        (c) => `<tr>
          <td>${esc(c.과정명)}</td>
          <td>${esc(c.기수)}</td>
          <td>${c.인원}명</td>
          <td>${c.avgAttendanceRate.toFixed(1)}%</td>
          <td>${c.greenRate.toFixed(1)}%</td>
          <td>${c.NPS}</td>
          <td>${c.강사만족도.toFixed(1)}</td>
          <td><strong>${c.종합점수.toFixed(1)}</strong></td>
        </tr>`,
      )
      .join("");
  }

  // 버블차트 (방어율 vs NPS)
  destroyChart(bubbleChart);
  const bubbleCanvas = $("crossBubbleCanvas") as HTMLCanvasElement | null;
  if (bubbleCanvas && cohorts.length > 0) {
    const bubbleData = cohorts.map((c) => ({
      과정명: c.과정명,
      기수: c.기수,
      NPS: c.NPS,
      defenseRate: c.인원 > 0 ? c.avgAttendanceRate : 0,
      인원: c.인원,
    }));
    bubbleChart = renderBubbleChart(bubbleCanvas, bubbleData);
  }

  // 인사이트
  const studentStats = calcStudentStats(students);
  const insights = generateInsights(students, cohorts, studentStats);
  const insightsList = $("crossInsightsList");
  if (insightsList) {
    insightsList.innerHTML = insights.map((text) => `<li>💡 ${esc(text)}</li>`).join("");
  }
}

// ── 히트맵 셀 클릭 → 학생 목록 ──────────────────────────

function onHeatmapCellClick(cell: HeatmapCell): void {
  const card = $("crossStudentListCard");
  const title = $("crossStudentListTitle");
  const tbody = $("crossStudentTableBody");

  if (!card || !tbody) return;

  card.style.display = "";
  if (title) title.textContent = `학생 목록: ${cell.attendanceBracket} × ${cell.signal} (${cell.count}명)`;

  const signalBadge = (s: string) => {
    const colors: Record<string, string> = { green: "#ecfdf5;color:#065f46", yellow: "#fefce8;color:#854d0e", red: "#fef2f2;color:#991b1b" };
    return `<span style="background:${colors[s] ?? ""};padding:2px 8px;border-radius:4px;font-size:12px">${s}</span>`;
  };
  const riskBadge = (r: string) => {
    const colors: Record<string, string> = { safe: "#ecfdf5", caution: "#fefce8", warning: "#fff7ed", danger: "#fef2f2" };
    return `<span style="background:${colors[r] ?? ""};padding:2px 8px;border-radius:4px;font-size:12px">${r}</span>`;
  };

  tbody.innerHTML = cell.students
    .map(
      (s) => `<tr>
        <td>${esc(s.이름)}</td>
        <td>${esc(s.기수)}</td>
        <td>${s.attendanceRate.toFixed(1)}%</td>
        <td>${s.compositeScore.toFixed(1)}</td>
        <td>${signalBadge(s.신호등)}</td>
        <td>${riskBadge(s.riskLevel)}</td>
      </tr>`,
    )
    .join("");
}

// ── 분석 실행 ─────────────────────────────────────────────

async function runAnalysis(): Promise<void> {
  const statusEl = $("crossAnalysisStatus");
  if (statusEl) statusEl.textContent = "데이터 로딩 중...";

  // 데이터 로드
  const attendanceStudents = await loadAttendanceStudents();
  const achievementRecords = loadCachedAchievementRecords();
  const satisfactionRecords = loadCachedSatisfactionRecords();

  // 데이터 존재 여부 체크
  const missing: string[] = [];
  if (attendanceStudents.length === 0) missing.push("출결");
  if (achievementRecords.length === 0) missing.push("학업성취도");
  if (satisfactionRecords.length === 0) missing.push("만족도");

  if (missing.length === 3) {
    if (statusEl) statusEl.textContent = "⚠️ 데이터가 없습니다. 먼저 출결현황, 학업성취도, 만족도 탭에서 데이터를 조회해주세요.";
    return;
  }

  // 필터 적용
  const courseFilter = ($("crossFilterCourse") as HTMLSelectElement | null)?.value ?? "";
  const cohortFilter = ($("crossFilterCohort") as HTMLSelectElement | null)?.value ?? "";

  // 학생 매칭 (전체, cohortHint로 동명이인 구분)
  const allStudentData = matchStudentData(attendanceStudents, achievementRecords, cohortFilter || undefined);

  // 필터 채우기 (전체 데이터 기준 — 필터 적용 전)
  populateFilters(allStudentData);

  // 필터 적용
  let studentData = allStudentData;
  if (courseFilter) studentData = studentData.filter((s) => s.과정 === courseFilter);
  if (cohortFilter) studentData = studentData.filter((s) => s.기수 === cohortFilter);
  currentStudentData = studentData;

  // 기수 매칭
  const cohortCourseFilter = ($("crossCohortFilterCourse") as HTMLSelectElement | null)?.value ?? "";
  let cohortData = matchCohortData(studentData, satisfactionRecords);
  if (cohortCourseFilter) cohortData = cohortData.filter((c) => c.과정명 === cohortCourseFilter);
  currentCohortData = cohortData;

  // 렌더링
  renderStudentAnalysis(studentData);
  renderCohortAnalysis(cohortData, studentData);

  // 상태 메시지
  if (missing.length > 0) {
    if (statusEl) statusEl.textContent = `⚠️ ${missing.join(", ")} 데이터 미로드. 일부 분석만 표시됩니다.`;
  } else {
    if (statusEl) statusEl.textContent = `✅ 분석 완료 (${studentData.length}명 매칭)`;
  }
}

// ── 이벤트 바인딩 ─────────────────────────────────────────

function setupEvents(): void {
  // 전체 조회 버튼 (HRD API 직접 조회)
  const fetchAllBtn = $("crossFetchAllBtn");
  if (fetchAllBtn) {
    fetchAllBtn.addEventListener("click", () => void fetchAllAttendanceAndAnalyze());
  }

  // 분석 실행 버튼 (캐시된 데이터로 재분석)
  const analyzeBtn = $("crossAnalyzeBtn");
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => void runAnalysis());
  }

  // 학생 필터 변경 → 재분석
  const courseFilter = $("crossFilterCourse");
  const cohortFilter = $("crossFilterCohort");
  if (courseFilter) courseFilter.addEventListener("change", () => void runAnalysis());
  if (cohortFilter) cohortFilter.addEventListener("change", () => void runAnalysis());

  // 기수 필터 변경 → 기수 분석만 재실행
  const cohortCourseFilter = $("crossCohortFilterCourse");
  if (cohortCourseFilter) {
    cohortCourseFilter.addEventListener("change", () => {
      const filter = (cohortCourseFilter as HTMLSelectElement).value;
      const filtered = filter ? currentCohortData.filter((c) => c.과정명 === filter) : currentCohortData;
      renderCohortAnalysis(filtered, currentStudentData);
    });
  }
}

// ── Public init ────────────────────────────────────────────

export function initCrossAnalysis(): void {
  setupSubTabs();
  setupEvents();
  // 자동 분석 시도 (캐시된 데이터가 있으면 바로 표시)
  void runAnalysis();
}
