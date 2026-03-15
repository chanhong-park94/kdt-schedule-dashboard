/**
 * KPI PDF 리포트 생성 모듈
 *
 * 모두의연구소 공식 브랜딩이 적용된 리포트를 생성합니다.
 * Chart.js 차트를 base64 이미지로 렌더링하여 삽입합니다.
 * window.print()를 사용하여 별도 의존성 없이 PDF 저장을 지원합니다.
 */
import type { KpiAllData, AchievementRecord, FormativeRecord, FieldAppRecord } from "./kpiTypes";
import { Chart, registerables, type ChartConfiguration } from "chart.js";

Chart.register(...registerables);

function formatDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// ── Chart-to-Image 유틸 ────────────────────────────────────

interface ChartImages {
  achievement: string;
  gradePre: string;
  gradePost: string;
  formative: string;
  radar: string;
  response: string;
}

const COLORS = {
  pre: "rgba(156, 163, 175, 0.7)",
  post: "rgba(99, 102, 241, 0.8)",
  accent: "rgba(16, 185, 129, 0.8)",
  grades: ["#6366f1", "#3b82f6", "#f59e0b", "#ef4444", "#9ca3af"],
  radar: "rgba(99, 102, 241, 0.3)",
  radarBorder: "rgba(99, 102, 241, 1)",
};

function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.style.position = "fixed";
  canvas.style.left = "-9999px";
  document.body.appendChild(canvas);
  return canvas;
}

function chartToBase64(canvas: HTMLCanvasElement, config: ChartConfiguration): string {
  const ctx = canvas.getContext("2d")!;
  const chart = new Chart(ctx, { ...config, options: { ...config.options, animation: false, responsive: false } });
  const img = chart.toBase64Image("image/png", 1);
  chart.destroy();
  document.body.removeChild(canvas);
  return img;
}

function generateChartImages(
  ach: AchievementRecord[],
  frm: FormativeRecord[],
  fa: FieldAppRecord[],
): ChartImages {
  // 1) 성취평가 사전/사후 비교 (bar)
  const courseMap = new Map<string, { pre: number[]; post: number[] }>();
  for (const r of ach) {
    if (!courseMap.has(r.course)) courseMap.set(r.course, { pre: [], post: [] });
    const g = courseMap.get(r.course)!;
    g.pre.push(r.preTotal);
    g.post.push(r.postTotal);
  }
  const achLabels = [...courseMap.keys()];
  const preAvgs = achLabels.map((k) => {
    const arr = courseMap.get(k)!.pre;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  });
  const postAvgs = achLabels.map((k) => {
    const arr = courseMap.get(k)!.post;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  });

  const achievement = chartToBase64(createOffscreenCanvas(600, 300), {
    type: "bar",
    data: {
      labels: achLabels,
      datasets: [
        { label: "사전 평균", data: preAvgs, backgroundColor: COLORS.pre, borderRadius: 4 },
        { label: "사후 평균", data: postAvgs, backgroundColor: COLORS.post, borderRadius: 4 },
      ],
    },
    options: {
      scales: { y: { beginAtZero: true, max: 30 } },
      plugins: { legend: { position: "top" }, title: { display: true, text: "과정별 사전/사후 성취평가 비교", font: { size: 13 } } },
    },
  });

  // 2) 등급 분포 도넛 (사전)
  const preGrades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const postGrades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const r of ach) {
    if (r.preGrade in preGrades) preGrades[r.preGrade]++;
    if (r.postGrade in postGrades) postGrades[r.postGrade]++;
  }

  const gradePre = chartToBase64(createOffscreenCanvas(300, 300), {
    type: "doughnut",
    data: {
      labels: Object.keys(preGrades),
      datasets: [{ data: Object.values(preGrades), backgroundColor: COLORS.grades }],
    },
    options: {
      plugins: { legend: { position: "bottom" }, title: { display: true, text: "사전 등급 분포", font: { size: 13 } } },
    },
  });

  const gradePost = chartToBase64(createOffscreenCanvas(300, 300), {
    type: "doughnut",
    data: {
      labels: Object.keys(postGrades),
      datasets: [{ data: Object.values(postGrades), backgroundColor: COLORS.grades }],
    },
    options: {
      plugins: { legend: { position: "bottom" }, title: { display: true, text: "사후 등급 분포", font: { size: 13 } } },
    },
  });

  // 3) 형성평가 주차별 추이 (line)
  const frmCourseMap = new Map<string, number[][]>();
  for (const r of frm) {
    if (!frmCourseMap.has(r.course)) frmCourseMap.set(r.course, []);
    frmCourseMap.get(r.course)!.push([...r.phase1Scores, ...r.phase2Scores]);
  }
  const weekLabels = ["1주차", "2주차", "3주차", "4주차", "5주차", "6주차", "7주차", "8주차"];
  const lineColors = ["rgba(99, 102, 241, 0.8)", "rgba(16, 185, 129, 0.8)", "rgba(245, 158, 11, 0.8)", "rgba(239, 68, 68, 0.8)"];
  const frmDatasets = [...frmCourseMap.entries()].map(([course, allScores], idx) => {
    const weekAvgs = weekLabels.map((_, wi) => {
      const vals = allScores.map((s) => s[wi]).filter((v) => v > 0);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    return {
      label: course,
      data: weekAvgs,
      borderColor: lineColors[idx % lineColors.length],
      backgroundColor: "transparent",
      tension: 0.3,
      pointRadius: 4,
    };
  });

  const formative = chartToBase64(createOffscreenCanvas(600, 300), {
    type: "line",
    data: { labels: weekLabels, datasets: frmDatasets },
    options: {
      scales: { y: { beginAtZero: false, min: 1, max: 5 } },
      plugins: { legend: { position: "top" }, title: { display: true, text: "형성평가 주차별 추이", font: { size: 13 } } },
    },
  });

  // 4) 현업적용 역량 레이더
  const radarLabels = ["업무이해", "적용계획", "도구활용", "성과기대", "장애요인", "지속의지"];
  const avgScores = radarLabels.map((_, qi) => {
    const vals = fa.map((r) => r.scores[qi]).filter((v) => v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  const radar = chartToBase64(createOffscreenCanvas(400, 400), {
    type: "radar",
    data: {
      labels: radarLabels,
      datasets: [{
        label: "현업적용 평균",
        data: avgScores,
        backgroundColor: COLORS.radar,
        borderColor: COLORS.radarBorder,
        pointBackgroundColor: COLORS.radarBorder,
      }],
    },
    options: {
      scales: { r: { beginAtZero: true, max: 5, ticks: { stepSize: 1 } } },
      plugins: { title: { display: true, text: "현업적용 역량 분석", font: { size: 13 } } },
    },
  });

  // 5) 응답률 (horizontal bar)
  const achCompleted = ach.filter((r) => r.status.includes("완료")).length;
  const frmCompleted = frm.filter((r) => r.status.includes("양호") || r.status.includes("우수")).length;
  const faCompleted = fa.filter((r) => r.status.includes("완료")).length;
  const total = Math.max(ach.length, 1);
  const achRate = (achCompleted / total) * 100;
  const frmRate = (frmCompleted / Math.max(frm.length, 1)) * 100;
  const faRate = (faCompleted / Math.max(fa.length, 1)) * 100;

  const response = chartToBase64(createOffscreenCanvas(600, 250), {
    type: "bar",
    data: {
      labels: ["성취평가", "형성평가", "현업적용"],
      datasets: [{
        label: "응답/완료율 (%)",
        data: [achRate, frmRate, faRate],
        backgroundColor: [COLORS.post, COLORS.accent, "rgba(245, 158, 11, 0.8)"],
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y" as const,
      scales: { x: { beginAtZero: true, max: 100 } },
      plugins: { legend: { display: false }, title: { display: true, text: "평가 유형별 응답/완료율", font: { size: 13 } } },
    },
  });

  return { achievement, gradePre, gradePost, formative, radar, response };
}

// ── 메인 함수 ────────────────────────────────────────────────

/**
 * PDF 리포트 인쇄/다운로드
 * Chart.js 차트를 이미지로 변환하여 포함합니다.
 */
export function printKpiReport(data: KpiAllData, course = "all", cohort = "all"): void {
  // 필터링
  let ach = data.achievement;
  let frm = data.formative;
  let fa = data.fieldApp;

  if (course !== "all") {
    ach = ach.filter((r) => r.course === course);
    frm = frm.filter((r) => r.course === course);
    fa = fa.filter((r) => r.course === course);
  }
  if (cohort !== "all") {
    ach = ach.filter((r) => r.cohort === cohort);
    frm = frm.filter((r) => r.cohort === cohort);
    fa = fa.filter((r) => r.cohort === cohort);
  }

  // 통계 계산
  const total = ach.length;
  const preAvg = total > 0 ? ach.reduce((s, r) => s + r.preTotal, 0) / total : 0;
  const postAvg = total > 0 ? ach.reduce((s, r) => s + r.postTotal, 0) / total : 0;
  const impAvg = total > 0 ? ach.reduce((s, r) => s + r.improvement, 0) / total : 0;
  const frmAvg = frm.length > 0 ? frm.reduce((s, r) => s + r.overallAvg, 0) / frm.length : 0;
  const faAvg = fa.length > 0 ? fa.reduce((s, r) => s + r.avgScore, 0) / fa.length : 0;

  const courseLabel = course === "all" ? "전체 과정" : course;
  const cohortLabel = cohort === "all" ? "전체 기수" : cohort;
  const dateStr = formatDate(new Date());

  // 등급 분포
  const preGrades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const postGrades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const r of ach) {
    if (r.preGrade in preGrades) preGrades[r.preGrade]++;
    if (r.postGrade in postGrades) postGrades[r.postGrade]++;
  }

  // 차트 이미지 생성
  const charts = generateChartImages(ach, frm, fa);

  // 과정별 집계 데이터
  let achSummary = data.achievementSummary;
  let frmSummary = data.formativeSummary;
  let faSummary = data.fieldAppSummary;
  if (course !== "all") {
    achSummary = achSummary.filter((r) => r.course === course || r.course === "전체");
    frmSummary = frmSummary.filter((r) => r.course === course || r.course === "전체");
    faSummary = faSummary.filter((r) => r.course === course || r.course === "전체");
  }

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>KDT 자율성과지표 리포트</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Noto Sans KR', sans-serif;
      color: #1f2937;
      background: #fff;
      padding: 40px;
      font-size: 11pt;
      line-height: 1.6;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none !important; }
      @page { margin: 15mm; size: A4; }
      .page-break { page-break-before: always; }
    }

    /* ── 헤더 ── */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #E53935;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .report-header-left h1 {
      font-size: 22pt;
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 4px;
    }
    .report-header-left .subtitle {
      font-size: 11pt;
      color: #6b7280;
    }
    .report-header-right {
      text-align: right;
    }
    .report-logo {
      font-size: 24pt;
      font-weight: 700;
      color: #E53935;
      letter-spacing: -1px;
    }
    .report-meta {
      font-size: 9pt;
      color: #9ca3af;
      margin-top: 6px;
    }

    /* ── 인증 배지 ── */
    .cert-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 9pt;
      color: #dc2626;
      font-weight: 500;
      margin-bottom: 20px;
    }

    /* ── 카드 ── */
    .kpi-cards-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }
    .kpi-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }
    .kpi-card-label { font-size: 9pt; color: #6b7280; margin-bottom: 4px; }
    .kpi-card-value { font-size: 20pt; font-weight: 700; color: #1f2937; }
    .kpi-card-value.accent { color: #6366f1; }
    .kpi-card-value.success { color: #10b981; }
    .kpi-card-unit { font-size: 9pt; color: #9ca3af; }

    /* ── 섹션 ── */
    .section { margin-bottom: 24px; page-break-inside: avoid; }
    .section h2 {
      font-size: 13pt;
      font-weight: 600;
      color: #1f2937;
      border-left: 4px solid #E53935;
      padding-left: 10px;
      margin-bottom: 12px;
    }

    /* ── 차트 영역 ── */
    .chart-section {
      margin-bottom: 28px;
      page-break-inside: avoid;
    }
    .chart-row {
      display: flex;
      gap: 16px;
      justify-content: center;
      align-items: flex-start;
      margin-bottom: 20px;
    }
    .chart-row img {
      max-width: 48%;
      height: auto;
    }
    .chart-single {
      text-align: center;
      margin-bottom: 20px;
    }
    .chart-single img {
      max-width: 80%;
      height: auto;
    }
    .chart-half {
      text-align: center;
    }
    .chart-half img {
      max-width: 100%;
      height: auto;
    }

    /* ── 등급 분포 (CSS 바) ── */
    .grade-row {
      display: flex;
      gap: 24px;
      margin-bottom: 20px;
    }
    .grade-box {
      flex: 1;
    }
    .grade-box h3 {
      font-size: 10pt;
      font-weight: 500;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .grade-bar-container {
      display: flex;
      gap: 4px;
      align-items: flex-end;
      height: 60px;
    }
    .grade-bar {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .grade-bar-fill {
      width: 100%;
      border-radius: 3px 3px 0 0;
      min-height: 4px;
    }
    .grade-bar-label { font-size: 8pt; color: #6b7280; }
    .grade-bar-count { font-size: 9pt; font-weight: 600; }

    /* ── 테이블 ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    th {
      background: #f3f4f6;
      font-weight: 600;
      text-align: center;
      padding: 8px 6px;
      border-bottom: 2px solid #d1d5db;
    }
    td {
      text-align: center;
      padding: 6px;
      border-bottom: 1px solid #e5e7eb;
    }
    tr:nth-child(even) { background: #fafafa; }
    .grade-A { color: #6366f1; font-weight: 600; }
    .grade-B { color: #3b82f6; font-weight: 600; }
    .grade-C { color: #f59e0b; font-weight: 600; }
    .grade-D { color: #ef4444; font-weight: 600; }
    .grade-E { color: #9ca3af; font-weight: 600; }
    .improve { color: #10b981; font-weight: 600; }

    /* ── 집계 테이블 ── */
    .summary-section { margin-bottom: 20px; page-break-inside: avoid; }
    .summary-section h3 {
      font-size: 11pt;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
      padding-left: 8px;
      border-left: 3px solid #6366f1;
    }

    /* ── 푸터 ── */
    .report-footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 2px solid #E53935;
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      color: #9ca3af;
    }
    .report-footer-logo { color: #E53935; font-weight: 600; }

    /* ── 인쇄 버튼 ── */
    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 24px;
      background: #E53935;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
    }
    .print-btn:hover { background: #c62828; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">📄 PDF 저장 / 인쇄</button>

  <!-- ═══════════ PAGE 1: 헤더 + KPI 요약 + 차트 ═══════════ -->
  <div class="report-header">
    <div class="report-header-left">
      <h1>KDT 자율성과지표 결과 리포트</h1>
      <div class="subtitle">${courseLabel} · ${cohortLabel} · 성취평가 / 형성평가 / 현업적용평가 통합 결과</div>
    </div>
    <div class="report-header-right">
      <div class="report-logo">모두의연구소</div>
      <div class="report-meta">발행일: ${dateStr}<br />문서번호: KPI-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}</div>
    </div>
  </div>

  <div class="cert-badge">
    🏛️ 모두의연구소 공식 인증 문서 | KDT(K-Digital Training) 재직자 자율성과지표 분석 리포트
  </div>

  <!-- KPI 카드 -->
  <div class="kpi-cards-row">
    <div class="kpi-card">
      <div class="kpi-card-label">총 학습자</div>
      <div class="kpi-card-value">${total}</div>
      <div class="kpi-card-unit">명</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-label">성취평가 사전</div>
      <div class="kpi-card-value">${preAvg.toFixed(1)}</div>
      <div class="kpi-card-unit">점 / 30</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-label">성취평가 사후</div>
      <div class="kpi-card-value accent">${postAvg.toFixed(1)}</div>
      <div class="kpi-card-unit">점 / 30</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-label">평균 향상도</div>
      <div class="kpi-card-value success">+${impAvg.toFixed(1)}</div>
      <div class="kpi-card-unit">등급</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-label">형성평가 종합</div>
      <div class="kpi-card-value">${frmAvg.toFixed(2)}</div>
      <div class="kpi-card-unit">점 / 5</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-label">현업적용 평균</div>
      <div class="kpi-card-value">${faAvg.toFixed(2)}</div>
      <div class="kpi-card-unit">점 / 5</div>
    </div>
  </div>

  <!-- 성취평가 사전/사후 비교 차트 -->
  <div class="section">
    <h2>성취평가 사전/사후 비교</h2>
    <div class="chart-single">
      <img src="${charts.achievement}" alt="성취평가 사전/사후 비교 차트" />
    </div>
  </div>

  <!-- 등급 분포 비교 (도넛 차트) -->
  <div class="section">
    <h2>등급 분포 비교</h2>
    <div class="chart-row">
      <div class="chart-half"><img src="${charts.gradePre}" alt="사전 등급 분포" /></div>
      <div class="chart-half"><img src="${charts.gradePost}" alt="사후 등급 분포" /></div>
    </div>
  </div>

  <!-- ═══════════ PAGE 2: 형성평가 + 현업적용 차트 ═══════════ -->
  <div class="page-break"></div>

  <!-- 형성평가 주차별 추이 -->
  <div class="section">
    <h2>형성평가 주차별 추이</h2>
    <div class="chart-single">
      <img src="${charts.formative}" alt="형성평가 주차별 추이 차트" />
    </div>
  </div>

  <!-- 현업적용 역량 분석 + 응답률 -->
  <div class="section">
    <h2>현업적용 역량 분석 / 응답률 현황</h2>
    <div class="chart-row">
      <div class="chart-half"><img src="${charts.radar}" alt="현업적용 역량 레이더 차트" /></div>
      <div class="chart-half"><img src="${charts.response}" alt="응답률 현황 차트" /></div>
    </div>
  </div>

  <!-- 과정별 집계 테이블 -->
  <div class="section">
    <h2>과정별 집계 요약</h2>

    <div class="summary-section">
      <h3>성취평가 집계</h3>
      <table>
        <thead><tr>
          <th>과정</th><th>기수</th><th>학습자</th>
          <th>사전평균</th><th>사후평균</th><th>향상도</th>
          <th>A등급(사전)</th><th>A등급(사후)</th><th>응답률</th>
        </tr></thead>
        <tbody>
          ${achSummary.map((r) => `<tr>
            <td>${r.course}</td><td>${r.cohort}</td><td>${r.studentCount}</td>
            <td>${r.preAvg.toFixed(1)}</td><td><strong>${r.postAvg.toFixed(1)}</strong></td>
            <td class="improve">+${r.improvement.toFixed(1)}</td>
            <td>${r.preGradeA}</td><td><strong>${r.postGradeA}</strong></td>
            <td>${(r.responseRate * 100).toFixed(0)}%</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <div class="summary-section">
      <h3>형성평가 집계</h3>
      <table>
        <thead><tr>
          <th>과정</th><th>기수</th><th>학습자</th>
          <th>1차 평균</th><th>2차 평균</th><th>종합 평균</th>
        </tr></thead>
        <tbody>
          ${frmSummary.map((r) => `<tr>
            <td>${r.course}</td><td>${r.cohort}</td><td>${r.studentCount}</td>
            <td>${r.phase1Avg.toFixed(2)}</td><td>${r.phase2Avg.toFixed(2)}</td>
            <td><strong>${r.overallAvg.toFixed(2)}</strong></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <div class="summary-section">
      <h3>현업적용평가 집계</h3>
      <table>
        <thead><tr>
          <th>과정</th><th>기수</th><th>학습자</th>
          <th>평균점수</th><th>응답완료</th><th>응답률</th>
        </tr></thead>
        <tbody>
          ${faSummary.map((r) => `<tr>
            <td>${r.course}</td><td>${r.cohort}</td><td>${r.studentCount}</td>
            <td><strong>${r.avgScore.toFixed(2)}</strong></td>
            <td>${r.completed}</td>
            <td>${(r.responseRate * 100).toFixed(0)}%</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ═══════════ PAGE 3: 성취평가 상세 ═══════════ -->
  <div class="page-break"></div>

  <div class="section">
    <h2>성취평가 상세 결과</h2>
    <table>
      <thead><tr>
        <th>No</th><th>이름</th><th>과정</th><th>기수</th>
        <th>사전총점</th><th>사전등급</th><th>사후총점</th><th>사후등급</th>
        <th>향상도</th><th>등급변화</th>
      </tr></thead>
      <tbody>
        ${ach.map((r) => `<tr>
          <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
          <td>${r.preTotal}</td><td class="grade-${r.preGrade}">${r.preGrade}</td>
          <td><strong>${r.postTotal}</strong></td><td class="grade-${r.postGrade}">${r.postGrade}</td>
          <td class="improve">+${r.improvement}</td><td>${r.gradeChange}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- ═══════════ PAGE 4: 형성평가 + 현업적용 상세 ═══════════ -->
  <div class="page-break"></div>

  <div class="section">
    <h2>형성평가 상세 결과</h2>
    <table>
      <thead><tr>
        <th>No</th><th>이름</th><th>과정</th><th>기수</th>
        <th>1주</th><th>2주</th><th>3주</th><th>4주</th><th>1차평균</th>
        <th>5주</th><th>6주</th><th>7주</th><th>8주</th><th>2차평균</th>
        <th>종합</th><th>상태</th>
      </tr></thead>
      <tbody>
        ${frm.map((r) => `<tr>
          <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
          ${r.phase1Scores.map((s) => `<td>${s}</td>`).join("")}
          <td><strong>${r.phase1Avg.toFixed(1)}</strong></td>
          ${r.phase2Scores.map((s) => `<td>${s}</td>`).join("")}
          <td><strong>${r.phase2Avg.toFixed(1)}</strong></td>
          <td><strong>${r.overallAvg.toFixed(2)}</strong></td>
          <td>${r.status}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>현업적용평가 상세 결과</h2>
    <table>
      <thead><tr>
        <th>No</th><th>이름</th><th>과정</th><th>기수</th>
        <th>업무이해</th><th>적용계획</th><th>도구활용</th><th>성과기대</th><th>장애요인</th><th>지속의지</th>
        <th>평균</th><th>등급</th>
      </tr></thead>
      <tbody>
        ${fa.map((r) => `<tr>
          <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
          ${r.scores.map((s) => `<td>${s}</td>`).join("")}
          <td><strong>${r.avgScore.toFixed(2)}</strong></td>
          <td class="grade-${r.grade}">${r.grade}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- 푸터 -->
  <div class="report-footer">
    <div>
      <span class="report-footer-logo">모두의연구소</span> | KDT 자율성과지표 분석 리포트
    </div>
    <div>
      발행일: ${dateStr} | ${courseLabel} · ${cohortLabel}
    </div>
  </div>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("팝업이 차단되었습니다. 팝업 차단을 해제한 뒤 다시 시도하세요.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}
