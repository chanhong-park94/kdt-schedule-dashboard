/**
 * KPI PDF 리포트 생성 모듈
 *
 * 모두의연구소 공식 브랜딩이 적용된 리포트를 생성합니다.
 * window.print()를 사용하여 별도 의존성 없이 PDF 저장을 지원합니다.
 */
import type { KpiAllData } from "./kpiTypes";

// 모두의연구소 로고 SVG (빨간색 텍스트)
const MODURES_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 40" width="260" height="40">
  <text x="0" y="32" font-family="'Noto Sans KR', sans-serif" font-size="28" font-weight="700" fill="#E53935">모두의연구소</text>
</svg>`;

function formatDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * PDF 리포트 인쇄/다운로드
 * 새 창에 리포트 HTML을 렌더링한 뒤 window.print()를 호출합니다.
 */
export function printKpiReport(data: KpiAllData, course = "all", cohort = "all"): void {
  // 필터링
  let ach = data.achievement;
  let frm = data.formative;
  let fa = data.fieldApp;

  if (course !== "all") {
    ach = ach.filter(r => r.course === course);
    frm = frm.filter(r => r.course === course);
    fa = fa.filter(r => r.course === course);
  }
  if (cohort !== "all") {
    ach = ach.filter(r => r.cohort === cohort);
    frm = frm.filter(r => r.cohort === cohort);
    fa = fa.filter(r => r.cohort === cohort);
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

    /* ── 등급 분포 ── */
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

  <!-- 헤더 -->
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

  <!-- 인증 배지 -->
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

  <!-- 등급 분포 -->
  <div class="section">
    <h2>등급 분포 비교</h2>
    <div class="grade-row">
      <div class="grade-box">
        <h3>사전 평가</h3>
        <div class="grade-bar-container">
          ${["A", "B", "C", "D", "E"].map(g => {
            const count = preGrades[g];
            const height = total > 0 ? Math.max((count / total) * 50, 4) : 4;
            const colors: Record<string, string> = { A: "#6366f1", B: "#3b82f6", C: "#f59e0b", D: "#ef4444", E: "#9ca3af" };
            return `<div class="grade-bar">
              <div class="grade-bar-count">${count}</div>
              <div class="grade-bar-fill" style="height:${height}px;background:${colors[g]}"></div>
              <div class="grade-bar-label">${g}</div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="grade-box">
        <h3>사후 평가</h3>
        <div class="grade-bar-container">
          ${["A", "B", "C", "D", "E"].map(g => {
            const count = postGrades[g];
            const height = total > 0 ? Math.max((count / total) * 50, 4) : 4;
            const colors: Record<string, string> = { A: "#6366f1", B: "#3b82f6", C: "#f59e0b", D: "#ef4444", E: "#9ca3af" };
            return `<div class="grade-bar">
              <div class="grade-bar-count">${count}</div>
              <div class="grade-bar-fill" style="height:${height}px;background:${colors[g]}"></div>
              <div class="grade-bar-label">${g}</div>
            </div>`;
          }).join("")}
        </div>
      </div>
    </div>
  </div>

  <!-- 성취평가 상세 -->
  <div class="section">
    <h2>성취평가 상세 결과</h2>
    <table>
      <thead><tr>
        <th>No</th><th>이름</th><th>과정</th><th>기수</th>
        <th>사전총점</th><th>사전등급</th><th>사후총점</th><th>사후등급</th>
        <th>향상도</th><th>등급변화</th>
      </tr></thead>
      <tbody>
        ${ach.map(r => `<tr>
          <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
          <td>${r.preTotal}</td><td class="grade-${r.preGrade}">${r.preGrade}</td>
          <td><strong>${r.postTotal}</strong></td><td class="grade-${r.postGrade}">${r.postGrade}</td>
          <td class="improve">+${r.improvement}</td><td>${r.gradeChange}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- 형성평가 상세 -->
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
        ${frm.map(r => `<tr>
          <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
          ${r.phase1Scores.map(s => `<td>${s}</td>`).join("")}
          <td><strong>${r.phase1Avg.toFixed(1)}</strong></td>
          ${r.phase2Scores.map(s => `<td>${s}</td>`).join("")}
          <td><strong>${r.phase2Avg.toFixed(1)}</strong></td>
          <td><strong>${r.overallAvg.toFixed(2)}</strong></td>
          <td>${r.status}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- 현업적용평가 상세 -->
  <div class="section">
    <h2>현업적용평가 상세 결과</h2>
    <table>
      <thead><tr>
        <th>No</th><th>이름</th><th>과정</th><th>기수</th>
        <th>업무이해</th><th>적용계획</th><th>도구활용</th><th>성과기대</th><th>장애요인</th><th>지속의지</th>
        <th>평균</th><th>등급</th>
      </tr></thead>
      <tbody>
        ${fa.map(r => `<tr>
          <td>${r.no}</td><td>${r.name}</td><td>${r.course}</td><td>${r.cohort}</td>
          ${r.scores.map(s => `<td>${s}</td>`).join("")}
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
