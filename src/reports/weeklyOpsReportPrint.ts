/** 주간 운영회의 보고팩 — HTML 빌더 */
import type {
  WeeklyOpsReportData,
  WeeklyOpsReportConfig,
  DataDiagnostics,
  Page3AttendanceData,
  Page4DropoutData,
  Page5KpiData,
} from "./weeklyOpsReportTypes";

// ─── Helpers ─────────────────────────────────────────────────

/** 백분율 포맷 (소수점 1자리) */
function fmtRate(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** 숫자 포맷 (소수점 1자리) */
function fmtNum(n: number): string {
  return n.toFixed(1);
}

/** 리스크 수준별 CSS 색상 */
function _riskColor(level: string): string {
  switch (level) {
    case "danger":
      return "#dc2626";
    case "warning":
      return "#f59e0b";
    case "safe":
      return "#16a34a";
    default:
      return "#6b7280";
  }
}

/** 목표 대비 편차 배지 HTML */
function gapBadge(gap: number): string {
  const color = gap >= 0 ? "#16a34a" : "#dc2626";
  const sign = gap >= 0 ? "+" : "";
  return `<span style="color:${color};font-weight:600;">${sign}${gap.toFixed(1)}%p</span>`;
}

/** HTML 이스케이프 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Styles ──────────────────────────────────────────────────

function buildStyles(): string {
  return `
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
  body { padding: 0; }
  .no-print { display: none !important; }
  @page { margin: 15mm; size: A4; }
}

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
  z-index: 1000;
}
.print-btn:hover { background: #c62828; }

/* ── 페이지 구분 ── */
.page-break { page-break-before: always; }

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
.report-header-left .report-week {
  font-size: 10pt;
  color: #374151;
  font-weight: 500;
  margin-top: 4px;
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

/* ── 진단 배지 ── */
.diagnostics-row {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.diag-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 9pt;
  font-weight: 500;
}
.diag-ok {
  background: #f0fdf4;
  border: 1px solid #86efac;
  color: #16a34a;
}
.diag-warn {
  background: #fffbeb;
  border: 1px solid #fcd34d;
  color: #d97706;
}

/* ── 페이지 헤더 ── */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e5e7eb;
}
.page-header h2 {
  font-size: 16pt;
  font-weight: 700;
  color: #1f2937;
}
.page-header .page-num {
  font-size: 10pt;
  color: #9ca3af;
  font-weight: 500;
}
.data-scope {
  font-size: 9pt;
  color: #6b7280;
  margin-bottom: 16px;
  font-style: italic;
}

/* ── 섹션 제목 ── */
.section-title {
  font-size: 12pt;
  font-weight: 600;
  color: #1f2937;
  border-left: 4px solid #E53935;
  padding-left: 10px;
  margin-bottom: 12px;
  margin-top: 20px;
}

/* ── 메트릭 카드 그리드 ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 24px;
  page-break-inside: avoid;
}
.card-grid.cols-5 { grid-template-columns: repeat(5, 1fr); }
.card-grid.cols-6 { grid-template-columns: repeat(6, 1fr); }
.card-grid.cols-7 { grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); }

.metric-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px 10px;
  text-align: center;
}
.metric-card .card-label {
  font-size: 8.5pt;
  color: #6b7280;
  margin-bottom: 4px;
  line-height: 1.3;
}
.metric-card .card-value {
  font-size: 18pt;
  font-weight: 700;
  color: #1f2937;
  line-height: 1.2;
}
.metric-card .card-unit {
  font-size: 8pt;
  color: #9ca3af;
  margin-top: 2px;
}
.metric-card .card-value.accent { color: #6366f1; }
.metric-card .card-value.danger { color: #dc2626; }
.metric-card .card-value.warning { color: #f59e0b; }
.metric-card .card-value.success { color: #16a34a; }

/* ── 데이터 테이블 ── */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
  margin-bottom: 16px;
  page-break-inside: avoid;
}
.data-table th {
  background: #f3f4f6;
  font-weight: 600;
  text-align: center;
  padding: 8px 6px;
  border-bottom: 2px solid #d1d5db;
  white-space: nowrap;
}
.data-table td {
  text-align: center;
  padding: 6px;
  border-bottom: 1px solid #e5e7eb;
}
.data-table tbody tr:nth-child(even) { background: #fafafa; }
.data-table tbody tr:hover { background: #f0f0f0; }
.data-table td.left { text-align: left; }
.data-table td.right { text-align: right; }
.data-table .danger-text { color: #dc2626; font-weight: 600; }
.data-table .warning-text { color: #f59e0b; font-weight: 600; }
.data-table .safe-text { color: #16a34a; font-weight: 600; }

/* ── 코멘트 박스 ── */
.comment-box {
  background: #fefce8;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 14px 16px;
  margin-top: 16px;
  margin-bottom: 8px;
  page-break-inside: avoid;
}
.comment-box .comment-title {
  font-size: 10pt;
  font-weight: 600;
  color: #92400e;
  margin-bottom: 8px;
}
.comment-box ul {
  margin: 0;
  padding-left: 18px;
  font-size: 9pt;
  color: #78350f;
  line-height: 1.7;
}

/* ── 데이터 없음 메시지 ── */
.no-data-msg {
  text-align: center;
  padding: 40px 20px;
  color: #9ca3af;
  font-size: 11pt;
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

/* ── 유틸 ── */
.badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 8pt;
  font-weight: 600;
}
.badge-danger { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
.badge-warning { background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; }
.badge-safe { background: #f0fdf4; color: #16a34a; border: 1px solid #86efac; }
.badge-info { background: #eff6ff; color: #2563eb; border: 1px solid #93c5fd; }
`;
}

// ─── Header / Footer ─────────────────────────────────────────

function buildHeader(config: WeeklyOpsReportConfig, diagnostics: DataDiagnostics): string {
  const includedPages: string[] = [];
  if (config.includePage3) includedPages.push("3장 출결");
  if (config.includePage4) includedPages.push("4장 하차방어");
  if (config.includePage5) includedPages.push("5장 학습성과");

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const diagItems: string[] = [];
  diagItems.push(diagnostics.hasAttendance
    ? '<span class="diag-badge diag-ok">&#9679; 출결 데이터</span>'
    : '<span class="diag-badge diag-warn">&#9675; 출결 데이터 없음</span>');
  diagItems.push(diagnostics.hasDropout
    ? '<span class="diag-badge diag-ok">&#9679; 하차 데이터</span>'
    : '<span class="diag-badge diag-warn">&#9675; 하차 데이터 없음</span>');
  diagItems.push(diagnostics.hasAnalytics
    ? '<span class="diag-badge diag-ok">&#9679; 분석 데이터</span>'
    : '<span class="diag-badge diag-warn">&#9675; 분석 데이터 없음</span>');
  diagItems.push(diagnostics.hasKpi
    ? '<span class="diag-badge diag-ok">&#9679; KPI 데이터</span>'
    : '<span class="diag-badge diag-warn">&#9675; KPI 데이터 없음</span>');

  return `
<div class="report-header">
  <div class="report-header-left">
    <h1>주간 운영회의 보고팩</h1>
    <div class="subtitle">구성: ${includedPages.join(" / ")}</div>
    <div class="report-week">${esc(config.reportWeekLabel)}</div>
  </div>
  <div class="report-header-right">
    <div class="report-logo">모두의연구소</div>
    <div class="report-meta">생성: ${timestamp}<br/>기준일: ${esc(config.reportDate)}</div>
  </div>
</div>
<div class="diagnostics-row">
  ${diagItems.join("\n  ")}
</div>`;
}

function buildFooter(_config: WeeklyOpsReportConfig): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  return `
<div class="report-footer">
  <div>
    <span class="report-footer-logo">모두의연구소</span> | KDT 학사일정 관리 대시보드
  </div>
  <div>생성: ${dateStr}</div>
</div>`;
}

// ─── Page 3: 출결·관리대상 현황 ──────────────────────────────

function buildPage3Html(data: Page3AttendanceData, _config: WeeklyOpsReportConfig): string {
  const m = data.metrics;

  // Metric cards
  const cards = `
<div class="card-grid cols-6">
  <div class="metric-card">
    <div class="card-label">총 학습자</div>
    <div class="card-value">${m.totalStudents}</div>
    <div class="card-unit">명</div>
  </div>
  <div class="metric-card">
    <div class="card-label">평균 출석률</div>
    <div class="card-value${m.avgAttendanceRate < 80 ? ' danger' : m.avgAttendanceRate < 90 ? ' warning' : ' success'}">${fmtRate(m.avgAttendanceRate)}</div>
    <div class="card-unit">&nbsp;</div>
  </div>
  <div class="metric-card">
    <div class="card-label">위험군</div>
    <div class="card-value${m.riskCount > 0 ? ' danger' : ''}">${m.riskCount}</div>
    <div class="card-unit">명</div>
  </div>
  <div class="metric-card">
    <div class="card-label">퇴실 미체크</div>
    <div class="card-value${m.missingCheckoutCount > 0 ? ' warning' : ''}">${m.missingCheckoutCount}</div>
    <div class="card-unit">명</div>
  </div>
  <div class="metric-card">
    <div class="card-label">지각</div>
    <div class="card-value${m.lateCount > 0 ? ' warning' : ''}">${m.lateCount}</div>
    <div class="card-unit">명</div>
  </div>
  <div class="metric-card">
    <div class="card-label">결석</div>
    <div class="card-value${m.absentCount > 0 ? ' danger' : ''}">${m.absentCount}</div>
    <div class="card-unit">명</div>
  </div>
</div>`;

  // No data check
  if (m.totalStudents === 0) {
    return `
<div>
  <div class="page-header">
    <h2>3. 출결·관리대상 현황</h2>
    <span class="page-num">Page 3</span>
  </div>
  <div class="data-scope">${esc(data.dataScope)}</div>
  ${cards}
  <div class="no-data-msg">출결 데이터가 없습니다. 데이터 조회 후 다시 생성해 주세요.</div>
</div>`;
  }

  // Weekly trend table
  let weeklyTrendHtml = "";
  if (data.weeklyTrend.length > 0) {
    const trendRows = data.weeklyTrend
      .map((w) => {
        const rateClass = w.attendanceRate < 80 ? "danger-text" : w.attendanceRate < 90 ? "warning-text" : "safe-text";
        return `<tr><td class="left">${esc(w.weekLabel)}</td><td class="${rateClass}">${fmtRate(w.attendanceRate)}</td></tr>`;
      })
      .join("");
    weeklyTrendHtml = `
<div class="section-title">주간 출석률 추이</div>
<table class="data-table">
  <thead><tr><th style="text-align:left;">주차</th><th>출석률</th></tr></thead>
  <tbody>${trendRows}</tbody>
</table>`;
  }

  // Day pattern table
  let dayPatternHtml = "";
  if (data.dayPattern.length > 0) {
    const dayRows = data.dayPattern
      .map((d) => `<tr>
        <td>${esc(d.day)}</td>
        <td class="${d.absentRate > 5 ? 'danger-text' : ''}">${fmtRate(d.absentRate)}</td>
        <td class="${d.lateRate > 5 ? 'warning-text' : ''}">${fmtRate(d.lateRate)}</td>
        <td>${d.totalRecords}</td>
      </tr>`)
      .join("");
    dayPatternHtml = `
<div class="section-title">요일별 출결 패턴</div>
<table class="data-table">
  <thead><tr><th>요일</th><th>결석률</th><th>지각률</th><th>총 기록</th></tr></thead>
  <tbody>${dayRows}</tbody>
</table>`;
  }

  // Risk course Top 5
  let riskCourseHtml = "";
  if (data.riskCourseTop5.length > 0) {
    const courseRows = data.riskCourseTop5
      .map((c, i) => {
        const rateClass = c.avgAttendanceRate < 80 ? "danger-text" : c.avgAttendanceRate < 90 ? "warning-text" : "safe-text";
        return `<tr>
        <td>${i + 1}</td>
        <td class="left">${esc(c.courseName)}</td>
        <td>${esc(c.degr)}</td>
        <td class="danger-text">${c.riskCount}</td>
        <td class="${rateClass}">${fmtRate(c.avgAttendanceRate)}</td>
      </tr>`;
      })
      .join("");
    riskCourseHtml = `
<div class="section-title">위험군 과정 Top 5</div>
<table class="data-table">
  <thead><tr><th>#</th><th style="text-align:left;">과정명</th><th>기수</th><th>위험 인원</th><th>평균 출석률</th></tr></thead>
  <tbody>${courseRows}</tbody>
</table>`;
  }

  // At-risk Top 10
  let atRiskHtml = "";
  if (data.atRiskTop10.length > 0) {
    const riskRows = data.atRiskTop10
      .map((s, i) => {
        const rateClass = s.attendanceRate < 80 ? "danger-text" : s.attendanceRate < 90 ? "warning-text" : "safe-text";
        return `<tr>
        <td>${i + 1}</td>
        <td>${esc(s.name)}</td>
        <td class="left">${esc(s.courseName)}</td>
        <td>${esc(s.degr)}</td>
        <td class="${rateClass}">${fmtRate(s.attendanceRate)}</td>
        <td class="${s.absentDays >= 3 ? 'danger-text' : ''}">${s.absentDays}</td>
        <td class="left">${esc(s.riskReason)}</td>
        <td>${s.missingCheckout ? '<span class="badge badge-warning">Y</span>' : '-'}</td>
      </tr>`;
      })
      .join("");
    atRiskHtml = `
<div class="section-title">관리대상 학습자 Top 10</div>
<table class="data-table">
  <thead><tr>
    <th>#</th><th>이름</th><th style="text-align:left;">과정명</th><th>기수</th>
    <th>출석률</th><th>결석일</th><th style="text-align:left;">사유</th><th>퇴실미체크</th>
  </tr></thead>
  <tbody>${riskRows}</tbody>
</table>`;
  }

  // Auto-comments
  const commentsHtml = buildCommentsBox(data.autoComments);

  return `
<div>
  <div class="page-header">
    <h2>3. 출결·관리대상 현황</h2>
    <span class="page-num">Page 3</span>
  </div>
  <div class="data-scope">${esc(data.dataScope)}</div>
  ${cards}
  ${weeklyTrendHtml}
  ${dayPatternHtml}
  ${riskCourseHtml}
  ${atRiskHtml}
  ${commentsHtml}
</div>`;
}

// ─── Page 4: 하차방어율·조기경보 ─────────────────────────────

function buildPage4Html(data: Page4DropoutData, _config: WeeklyOpsReportConfig): string {
  // Build metric cards
  const overallClass = data.overallDefenseRate >= 90 ? "success" : data.overallDefenseRate >= 80 ? "warning" : "danger";

  // Category-specific summary cards
  const catCards = data.categorySummaries
    .map((cat) => {
      const valClass = cat.met ? "success" : "danger";
      return `
  <div class="metric-card">
    <div class="card-label">${esc(cat.category)} 방어율</div>
    <div class="card-value ${valClass}">${fmtRate(cat.defenseRate)}</div>
    <div class="card-unit">목표 ${fmtRate(cat.targetRate)} / ${gapBadge(cat.gap)}</div>
  </div>`;
    })
    .join("");

  const cards = `
<div class="card-grid cols-5">
  <div class="metric-card">
    <div class="card-label">전체 방어율</div>
    <div class="card-value ${overallClass}">${fmtRate(data.overallDefenseRate)}</div>
    <div class="card-unit">&nbsp;</div>
  </div>
  ${catCards}
  <div class="metric-card">
    <div class="card-label">미달 과정 수</div>
    <div class="card-value${data.underperformingCount > 0 ? ' danger' : ''}">${data.underperformingCount}</div>
    <div class="card-unit">개</div>
  </div>
  <div class="metric-card">
    <div class="card-label">조기경보 수</div>
    <div class="card-value${data.earlyWarningCount > 0 ? ' warning' : ''}">${data.earlyWarningCount}</div>
    <div class="card-unit">명</div>
  </div>
</div>`;

  // No data check
  if (data.categorySummaries.length === 0 && data.underperformingTop5.length === 0 && data.earlyWarningTop10.length === 0) {
    return `
<div>
  <div class="page-header">
    <h2>4. 하차방어율·조기경보</h2>
    <span class="page-num">Page 4</span>
  </div>
  ${cards}
  <div class="no-data-msg">하차방어 데이터가 없습니다. 데이터 조회 후 다시 생성해 주세요.</div>
</div>`;
  }

  // Category summary table
  let catTableHtml = "";
  if (data.categorySummaries.length > 0) {
    const catRows = data.categorySummaries
      .map((c) => {
        const rateClass = c.met ? "safe-text" : "danger-text";
        return `<tr>
        <td>${esc(c.category)}</td>
        <td>${c.total}</td>
        <td>${c.dropout}</td>
        <td>${c.active}</td>
        <td class="${rateClass}">${fmtRate(c.defenseRate)}</td>
        <td>${fmtRate(c.targetRate)}</td>
        <td>${gapBadge(c.gap)}</td>
        <td>${c.met ? '<span class="badge badge-safe">달성</span>' : '<span class="badge badge-danger">미달</span>'}</td>
      </tr>`;
      })
      .join("");
    catTableHtml = `
<div class="section-title">유형별 하차방어율 요약</div>
<table class="data-table">
  <thead><tr>
    <th>유형</th><th>전체</th><th>탈락</th><th>재학</th>
    <th>방어율</th><th>목표</th><th>편차</th><th>달성</th>
  </tr></thead>
  <tbody>${catRows}</tbody>
</table>`;
  }

  // Underperforming Top 5
  let underHtml = "";
  if (data.underperformingTop5.length > 0) {
    const underRows = data.underperformingTop5
      .map((c, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(c.category)}</td>
        <td class="left">${esc(c.courseName)}</td>
        <td>${esc(c.degr)}</td>
        <td>${c.total}</td>
        <td>${c.dropout}</td>
        <td>${c.active}</td>
        <td class="danger-text">${fmtRate(c.defenseRate)}</td>
        <td>${fmtRate(c.targetRate)}</td>
        <td>${gapBadge(c.gap)}</td>
      </tr>`)
      .join("");
    underHtml = `
<div class="section-title">목표 미달 과정 Top 5</div>
<table class="data-table">
  <thead><tr>
    <th>#</th><th>유형</th><th style="text-align:left;">과정명</th><th>기수</th>
    <th>전체</th><th>탈락</th><th>재학</th><th>방어율</th><th>목표</th><th>편차</th>
  </tr></thead>
  <tbody>${underRows}</tbody>
</table>`;
  }

  // Early warning Top 10
  let earlyHtml = "";
  if (data.earlyWarningTop10.length > 0) {
    const earlyRows = data.earlyWarningTop10
      .map((s, i) => {
        const rateClass = s.attendanceRate < 80 ? "danger-text" : s.attendanceRate < 90 ? "warning-text" : "safe-text";
        const statusBadge = s.status === "탈락"
          ? '<span class="badge badge-danger">탈락</span>'
          : '<span class="badge badge-info">재학</span>';
        return `<tr>
        <td>${i + 1}</td>
        <td>${esc(s.name)}</td>
        <td class="left">${esc(s.courseName)}</td>
        <td>${esc(s.degr)}</td>
        <td class="${rateClass}">${fmtRate(s.attendanceRate)}</td>
        <td class="${s.consecutiveAbsent >= 3 ? 'danger-text' : ''}">${s.consecutiveAbsent}</td>
        <td>${s.absentDays}</td>
        <td class="left">${s.alertReasons.map(r => esc(r)).join(", ")}</td>
        <td>${statusBadge}</td>
      </tr>`;
      })
      .join("");
    earlyHtml = `
<div class="section-title">조기경보 학습자 Top 10</div>
<table class="data-table">
  <thead><tr>
    <th>#</th><th>이름</th><th style="text-align:left;">과정명</th><th>기수</th>
    <th>출석률</th><th>연속결석</th><th>총 결석</th><th style="text-align:left;">경보사유</th><th>상태</th>
  </tr></thead>
  <tbody>${earlyRows}</tbody>
</table>`;
  }

  const commentsHtml = buildCommentsBox(data.autoComments);

  return `
<div>
  <div class="page-header">
    <h2>4. 하차방어율·조기경보</h2>
    <span class="page-num">Page 4</span>
  </div>
  ${cards}
  ${catTableHtml}
  ${underHtml}
  ${earlyHtml}
  ${commentsHtml}
</div>`;
}

// ─── Page 5: 학습 품질·성과 ──────────────────────────────────

function buildPage5Html(data: Page5KpiData, _config: WeeklyOpsReportConfig): string {
  const m = data.metrics;

  const cards = `
<div class="card-grid cols-7">
  <div class="metric-card">
    <div class="card-label">총 학습자</div>
    <div class="card-value">${m.totalStudents}</div>
    <div class="card-unit">명</div>
  </div>
  <div class="metric-card">
    <div class="card-label">사전 평균</div>
    <div class="card-value">${fmtNum(m.preAvg)}</div>
    <div class="card-unit">점</div>
  </div>
  <div class="metric-card">
    <div class="card-label">사후 평균</div>
    <div class="card-value accent">${fmtNum(m.postAvg)}</div>
    <div class="card-unit">점</div>
  </div>
  <div class="metric-card">
    <div class="card-label">향상도</div>
    <div class="card-value success">+${fmtNum(m.improvementAvg)}</div>
    <div class="card-unit">등급</div>
  </div>
  <div class="metric-card">
    <div class="card-label">형성평가 평균</div>
    <div class="card-value">${fmtNum(m.formativeAvg)}</div>
    <div class="card-unit">점 / 5</div>
  </div>
  <div class="metric-card">
    <div class="card-label">현업적용 평균</div>
    <div class="card-value">${fmtNum(m.fieldAppAvg)}</div>
    <div class="card-unit">점 / 5</div>
  </div>
  <div class="metric-card">
    <div class="card-label">응답률</div>
    <div class="card-value${m.responseRate < 50 ? ' danger' : m.responseRate < 70 ? ' warning' : ''}">${fmtRate(m.responseRate)}</div>
    <div class="card-unit">&nbsp;</div>
  </div>
</div>`;

  // No data check
  if (!data.hasData) {
    return `
<div>
  <div class="page-header">
    <h2>5. 학습 품질·성과</h2>
    <span class="page-num">Page 5</span>
  </div>
  ${cards}
  <div class="no-data-msg">KPI 데이터가 없습니다. 자율성과지표 데이터를 업로드한 후 다시 생성해 주세요.</div>
</div>`;
  }

  // Course comparison table
  let courseCompHtml = "";
  if (data.courseComparison.length > 0) {
    const compRows = data.courseComparison
      .map((c) => {
        const impClass = c.improvement > 0 ? "safe-text" : c.improvement < 0 ? "danger-text" : "";
        const impSign = c.improvement > 0 ? "+" : "";
        return `<tr>
        <td class="left">${esc(c.course)}</td>
        <td>${esc(c.cohort)}</td>
        <td>${fmtNum(c.preAvg)}</td>
        <td>${fmtNum(c.postAvg)}</td>
        <td class="${impClass}">${impSign}${fmtNum(c.improvement)}</td>
        <td>${c.studentCount}</td>
      </tr>`;
      })
      .join("");
    courseCompHtml = `
<div class="section-title">과정별 성취평가 비교</div>
<table class="data-table">
  <thead><tr>
    <th style="text-align:left;">과정명</th><th>기수</th><th>사전 평균</th>
    <th>사후 평균</th><th>향상도</th><th>인원</th>
  </tr></thead>
  <tbody>${compRows}</tbody>
</table>`;
  }

  // Formative decline Top 5
  let formDeclineHtml = "";
  if (data.formativeDeclineTop5.length > 0) {
    const fdRows = data.formativeDeclineTop5
      .map((c, i) => `<tr>
        <td>${i + 1}</td>
        <td class="left">${esc(c.course)}</td>
        <td>${esc(c.cohort)}</td>
        <td class="danger-text">${fmtNum(c.value)}</td>
        <td class="left">${esc(c.label)}</td>
      </tr>`)
      .join("");
    formDeclineHtml = `
<div class="section-title">형성평가 하위 Top 5</div>
<table class="data-table">
  <thead><tr><th>#</th><th style="text-align:left;">과정명</th><th>기수</th><th>점수</th><th style="text-align:left;">비고</th></tr></thead>
  <tbody>${fdRows}</tbody>
</table>`;
  }

  // Low response Top 5
  let lowRespHtml = "";
  if (data.lowResponseTop5.length > 0) {
    const lrRows = data.lowResponseTop5
      .map((c, i) => `<tr>
        <td>${i + 1}</td>
        <td class="left">${esc(c.course)}</td>
        <td>${esc(c.cohort)}</td>
        <td class="warning-text">${fmtRate(c.value)}</td>
        <td class="left">${esc(c.label)}</td>
      </tr>`)
      .join("");
    lowRespHtml = `
<div class="section-title">응답률 하위 Top 5</div>
<table class="data-table">
  <thead><tr><th>#</th><th style="text-align:left;">과정명</th><th>기수</th><th>응답률</th><th style="text-align:left;">비고</th></tr></thead>
  <tbody>${lrRows}</tbody>
</table>`;
  }

  // Low field app Top 5
  let lowFieldHtml = "";
  if (data.lowFieldAppTop5.length > 0) {
    const lfRows = data.lowFieldAppTop5
      .map((c, i) => `<tr>
        <td>${i + 1}</td>
        <td class="left">${esc(c.course)}</td>
        <td>${esc(c.cohort)}</td>
        <td class="danger-text">${fmtNum(c.value)}</td>
        <td class="left">${esc(c.label)}</td>
      </tr>`)
      .join("");
    lowFieldHtml = `
<div class="section-title">현업적용평가 하위 Top 5</div>
<table class="data-table">
  <thead><tr><th>#</th><th style="text-align:left;">과정명</th><th>기수</th><th>점수</th><th style="text-align:left;">비고</th></tr></thead>
  <tbody>${lfRows}</tbody>
</table>`;
  }

  const commentsHtml = buildCommentsBox(data.autoComments);

  return `
<div>
  <div class="page-header">
    <h2>5. 학습 품질·성과</h2>
    <span class="page-num">Page 5</span>
  </div>
  ${cards}
  ${courseCompHtml}
  ${formDeclineHtml}
  ${lowRespHtml}
  ${lowFieldHtml}
  ${commentsHtml}
</div>`;
}

// ─── Shared: Auto-comments box ───────────────────────────────

function buildCommentsBox(comments: string[]): string {
  if (comments.length === 0) return "";
  const items = comments.map((c) => `<li>${esc(c)}</li>`).join("\n      ");
  return `
<div class="comment-box">
  <div class="comment-title">자동 코멘트</div>
  <ul>
      ${items}
  </ul>
</div>`;
}

// ─── Main Export ─────────────────────────────────────────────

export function buildWeeklyOpsReportHtml(data: WeeklyOpsReportData): string {
  const pages: string[] = [];
  if (data.page3) pages.push(buildPage3Html(data.page3, data.config));
  if (data.page4) pages.push(buildPage4Html(data.page4, data.config));
  if (data.page5) pages.push(buildPage5Html(data.page5, data.config));

  if (pages.length === 0) return "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<title>주간 운영회의 보고팩</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
${buildStyles()}
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">PDF 저장 / 인쇄</button>
${buildHeader(data.config, data.diagnostics)}
${pages.join('\n<div class="page-break"></div>\n')}
${buildFooter(data.config)}
</body>
</html>`;
}
