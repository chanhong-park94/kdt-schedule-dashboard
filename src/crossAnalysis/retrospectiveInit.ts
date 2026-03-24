/**
 * 회고 리포트 렌더링 및 PDF 내보내기
 *
 * 종강 후 기수별 운영 회고 리포트를 생성합니다.
 * 출결·성취도·만족도·문의응대·하차방어 5개 섹션 + 종합 요약.
 * lazy-load 진입점: tabRegistry.ts에서 호출됨.
 */

import { Chart, registerables, type ChartConfiguration } from "chart.js";
import { loadHrdConfig } from "../hrd/hrdConfig";
import { collectRetrospectiveData, generateRetrospectiveInsights } from "./retrospectiveData";
import type {
  RetrospectiveFilter,
  RetrospectiveReportData,
  AttendanceSectionData,
  AchievementSectionData,
  SatisfactionSectionData,
  InquirySectionData,
  DropoutSectionData,
  SectionInsight,
} from "./retrospectiveTypes";

Chart.register(...registerables);

// ── DOM helpers ──────────────────────────────────────────────

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** XSS 방지: HTML 특수문자 이스케이프 */
function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Chart management ─────────────────────────────────────────

const chartInstances: Chart[] = [];

function destroyAllCharts(): void {
  for (const c of chartInstances) {
    try {
      c.destroy();
    } catch {
      /* already destroyed */
    }
  }
  chartInstances.length = 0;
}

function renderChartInCanvas(canvasId: string, config: ChartConfiguration): Chart | null {
  const canvas = $(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const chart = new Chart(ctx, config);
  chartInstances.push(chart);
  return chart;
}

// ── Colors ───────────────────────────────────────────────────

const COLORS = {
  primary: "#7c5cfc",
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
  gray: "#64748b",
  safe: "#22c55e",
  caution: "#f59e0b",
  warning: "#f97316",
  danger: "#ef4444",
};

// ── State ────────────────────────────────────────────────────

let lastReportData: RetrospectiveReportData | null = null;
let lastInsights: SectionInsight[] = [];

// ── Init ─────────────────────────────────────────────────────

export function initRetrospective(): void {
  const config = loadHrdConfig();
  const courses = config.courses;

  // Populate course dropdown
  const courseSelect = $("retroFilterCourse") as HTMLSelectElement | null;
  if (courseSelect) {
    courseSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "과정 선택";
    courseSelect.appendChild(defaultOpt);
    for (const c of courses) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      courseSelect.appendChild(opt);
    }

    // On course change → populate degr checkboxes
    courseSelect.addEventListener("change", () => {
      const selected = courses.find((c) => c.name === courseSelect.value);
      renderDegrCheckboxes(selected?.degrs ?? []);
    });
  }

  // Bind generate button
  const genBtn = $("retroGenerateBtn");
  if (genBtn) {
    genBtn.addEventListener("click", () => void generateReport());
  }

  // Bind PDF button
  const pdfBtn = $("retroPdfBtn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => void exportPdf());
  }
}

// ── Degr Checkboxes ──────────────────────────────────────────

function renderDegrCheckboxes(degrs: string[]): void {
  const container = $("retroDegrCheckboxes");
  if (!container) return;

  if (degrs.length === 0) {
    container.innerHTML = '<span style="color:#9ca3af;font-size:13px">과정을 먼저 선택하세요</span>';
    return;
  }

  let html = '<label style="font-weight:600"><input type="checkbox" value="all" checked><span>전체</span></label>';
  for (const d of degrs) {
    html += `<label><input type="checkbox" value="${esc(d)}" checked><span>${esc(d)}기</span></label>`;
  }
  container.innerHTML = html;

  // "전체" toggle logic
  const allCb = container.querySelector<HTMLInputElement>('input[value="all"]');
  const degrCbs = container.querySelectorAll<HTMLInputElement>('input:not([value="all"])');

  const degrCbArr = Array.from(degrCbs);

  if (allCb) {
    allCb.addEventListener("change", () => {
      for (const cb of degrCbArr) {
        cb.checked = allCb.checked;
      }
    });
  }

  // Individual checkbox → update "전체"
  for (const cb of degrCbArr) {
    cb.addEventListener("change", () => {
      if (allCb) {
        allCb.checked = degrCbArr.every((c) => c.checked);
      }
    });
  }
}

// ── Generate Report ──────────────────────────────────────────

async function generateReport(): Promise<void> {
  const courseSelect = $("retroFilterCourse") as HTMLSelectElement | null;
  const courseName = courseSelect?.value ?? "";

  if (!courseName) {
    const statusEl = $("retroStatus");
    if (statusEl) statusEl.textContent = "과정을 선택하세요.";
    return;
  }

  // Read checked degrs
  const container = $("retroDegrCheckboxes");
  const degrCbs = container?.querySelectorAll<HTMLInputElement>('input:not([value="all"]):checked') ?? [];
  const selectedDegrs = Array.from(degrCbs).map((cb) => cb.value);

  if (selectedDegrs.length === 0) {
    const statusEl = $("retroStatus");
    if (statusEl) statusEl.textContent = "기수를 하나 이상 선택하세요.";
    return;
  }

  // Find trainPrId from config
  const config = loadHrdConfig();
  const course = config.courses.find((c) => c.name === courseName);
  const trainPrId = course?.trainPrId ?? "";

  const filter: RetrospectiveFilter = { courseName, trainPrId, selectedDegrs };

  // Show status
  const statusEl = $("retroStatus");
  if (statusEl) statusEl.textContent = "리포트 생성 중...";

  // Hide report container while generating
  const reportContainer = $("retroReportContainer");
  if (reportContainer) reportContainer.style.display = "none";

  const pdfBtn = $("retroPdfBtn");
  if (pdfBtn) pdfBtn.style.display = "none";

  // Destroy previous charts
  destroyAllCharts();

  try {
    const data = await collectRetrospectiveData(filter);
    const insights = generateRetrospectiveInsights(data);

    lastReportData = data;
    lastInsights = insights;

    // Show container
    if (reportContainer) reportContainer.style.display = "";

    // Title
    const titleEl = $("retroTitle");
    if (titleEl) {
      const degrLabel =
        selectedDegrs.length === 1
          ? `${selectedDegrs[0]}기`
          : `${selectedDegrs[0]}~${selectedDegrs[selectedDegrs.length - 1]}기`;
      titleEl.textContent = `${courseName} ${degrLabel} 운영 회고 리포트`;
    }

    // Subtitle
    const subtitleEl = $("retroSubtitle");
    if (subtitleEl) {
      const dateStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
      const studentCount = data.attendance?.totalStudents ?? data.achievement?.totalMatched ?? 0;
      subtitleEl.textContent = `생성일: ${dateStr} | 대상 인원: ${studentCount}명`;
    }

    // Render sections
    if (data.attendance) {
      renderAttendanceSection(data.attendance);
      renderSectionInsights("attendance", insights);
    } else {
      renderEmptySection("retroAttendanceSection");
    }

    if (data.achievement) {
      renderAchievementSection(data.achievement);
      renderSectionInsights("achievement", insights);
    } else {
      renderEmptySection("retroAchievementSection");
    }

    if (data.satisfaction) {
      renderSatisfactionSection(data.satisfaction);
      renderSectionInsights("satisfaction", insights);
    } else {
      renderEmptySection("retroSatisfactionSection");
    }

    if (data.inquiry) {
      renderInquirySection(data.inquiry);
      renderSectionInsights("inquiry", insights);
    } else {
      renderEmptySection("retroInquirySection");
    }

    if (data.dropout) {
      renderDropoutSection(data.dropout);
      renderSectionInsights("dropout", insights);
    } else {
      renderEmptySection("retroDropoutSection");
    }

    renderSummarySection(data, insights);

    // Show PDF button
    if (pdfBtn) pdfBtn.style.display = "";

    // Status
    const availCount = Object.values(data.availability).filter(Boolean).length;
    if (statusEl) statusEl.textContent = `리포트 생성 완료 (${availCount}/5개 섹션 분석)`;
  } catch (err) {
    if (statusEl) statusEl.textContent = `오류 발생: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Section Renderers ────────────────────────────────────────

function renderAttendanceSection(data: AttendanceSectionData): void {
  const section = $("retroAttendanceSection");
  if (section) section.removeAttribute("data-empty");

  // KPI cards
  const statsEl = $("retroAttendanceStats");
  if (statsEl) {
    const riskTotal = data.riskCounts.danger + data.riskCounts.warning;
    const top1 = data.absentTop3[0];
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">평균출결률</div><div class="stat-value">${data.avgRate}%</div></div>
      <div class="stat-card"><div class="stat-label">하차방어율</div><div class="stat-value">${data.defenseRate}%</div></div>
      <div class="stat-card"><div class="stat-label">위험군</div><div class="stat-value">${riskTotal}명</div></div>
      <div class="stat-card"><div class="stat-label">결석Top1</div><div class="stat-value">${top1 ? esc(top1.name) + " (" + top1.absentDays + "일)" : "-"}</div></div>
    `;
  }

  // Bar chart: 출결률 분포
  renderChartInCanvas("retroAttDistChart", {
    type: "bar",
    data: {
      labels: data.rateDistribution.map((d) => d.label),
      datasets: [
        {
          label: "인원수",
          data: data.rateDistribution.map((d) => d.count),
          backgroundColor: [COLORS.green, COLORS.primary, COLORS.yellow, COLORS.red],
          borderRadius: 4,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "출결률 분포", font: { size: 13 } },
        legend: { display: false },
      },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });

  // Donut chart: 위험도 분포
  renderChartInCanvas("retroRiskDonut", {
    type: "doughnut",
    data: {
      labels: ["위험", "경고", "주의", "안전"],
      datasets: [
        {
          data: [data.riskCounts.danger, data.riskCounts.warning, data.riskCounts.caution, data.riskCounts.safe],
          backgroundColor: [COLORS.danger, COLORS.warning, COLORS.caution, COLORS.safe],
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "위험도 분포", font: { size: 13 } },
        legend: { position: "bottom" },
      },
    },
  });
}

function renderAchievementSection(data: AchievementSectionData): void {
  const section = $("retroAchievementSection");
  if (section) section.removeAttribute("data-empty");

  const statsEl = $("retroAchievementStats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">Green%</div><div class="stat-value">${data.greenRate}%</div></div>
      <div class="stat-card"><div class="stat-label">노드제출률</div><div class="stat-value">${data.avgNodeRate}%</div></div>
      <div class="stat-card"><div class="stat-label">퀘스트패스률</div><div class="stat-value">${data.avgQuestRate}%</div></div>
      <div class="stat-card"><div class="stat-label">Red%</div><div class="stat-value">${data.redRate}%</div></div>
    `;
  }

  // Donut: 신호등 분포
  renderChartInCanvas("retroSignalDonut", {
    type: "doughnut",
    data: {
      labels: ["Green", "Yellow", "Red"],
      datasets: [
        {
          data: data.signalDistribution.map((d) => d.count),
          backgroundColor: [COLORS.green, COLORS.yellow, COLORS.red],
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "신호등 분포", font: { size: 13 } },
        legend: { position: "bottom" },
      },
    },
  });

  // Bar: 노드 vs 퀘스트
  renderChartInCanvas("retroNodeQuestBar", {
    type: "bar",
    data: {
      labels: ["노드 완료율", "퀘스트 패스율"],
      datasets: [
        {
          label: "비율 (%)",
          data: [data.avgNodeRate, data.avgQuestRate],
          backgroundColor: [COLORS.primary, COLORS.green],
          borderRadius: 4,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "노드 vs 퀘스트 비율", font: { size: 13 } },
        legend: { display: false },
      },
      scales: { y: { beginAtZero: true, max: 100 } },
    },
  });
}

function renderSatisfactionSection(data: SatisfactionSectionData): void {
  const section = $("retroSatisfactionSection");
  if (section) section.removeAttribute("data-empty");

  const statsEl = $("retroSatisfactionStats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">NPS</div><div class="stat-value">${data.NPS}</div></div>
      <div class="stat-card"><div class="stat-label">강사만족도</div><div class="stat-value">${data.강사만족도}</div></div>
      <div class="stat-card"><div class="stat-label">HRD만족도</div><div class="stat-value">${data.HRD만족도}</div></div>
      <div class="stat-card"><div class="stat-label">추천의향</div><div class="stat-value">${data.추천의향}</div></div>
    `;
  }

  // Bar: 항목별 점수 비교
  renderChartInCanvas("retroNpsBar", {
    type: "bar",
    data: {
      labels: data.itemScores.map((d) => d.label),
      datasets: [
        {
          label: "점수",
          data: data.itemScores.map((d) => d.score),
          backgroundColor: [COLORS.primary, COLORS.green, COLORS.yellow, COLORS.gray],
          borderRadius: 4,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "항목별 점수 비교", font: { size: 13 } },
        legend: { display: false },
      },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function renderInquirySection(data: InquirySectionData): void {
  const section = $("retroInquirySection");
  if (section) section.removeAttribute("data-empty");

  const statsEl = $("retroInquiryStats");
  if (statsEl) {
    const topChannel = data.channelBreakdown.length > 0 ? data.channelBreakdown[0].channel : "-";
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">총건수</div><div class="stat-value">${data.totalCount}건</div></div>
      <div class="stat-card"><div class="stat-label">주요채널</div><div class="stat-value">${esc(topChannel)}</div></div>
      <div class="stat-card"><div class="stat-label">주요유형</div><div class="stat-value">${esc(data.topCategory)}</div></div>
    `;
  }

  // Donut: 채널별 분포
  const channelColors = [COLORS.primary, COLORS.green, COLORS.yellow, COLORS.red, COLORS.gray];
  renderChartInCanvas("retroChannelDonut", {
    type: "doughnut",
    data: {
      labels: data.channelBreakdown.map((d) => d.channel),
      datasets: [
        {
          data: data.channelBreakdown.map((d) => d.count),
          backgroundColor: data.channelBreakdown.map((_, i) => channelColors[i % channelColors.length]),
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "채널별 문의 분포", font: { size: 13 } },
        legend: { position: "bottom" },
      },
    },
  });
}

function renderDropoutSection(data: DropoutSectionData): void {
  const section = $("retroDropoutSection");
  if (section) section.removeAttribute("data-empty");

  const statsEl = $("retroDropoutStats");
  if (statsEl) {
    const diff = data.finalDefenseRate - data.targetRate;
    const diffLabel = diff >= 0 ? `+${diff.toFixed(1)}%p` : `${diff.toFixed(1)}%p`;
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">최종방어율</div><div class="stat-value">${data.finalDefenseRate}%</div></div>
      <div class="stat-card"><div class="stat-label">하차인원</div><div class="stat-value">${data.dropoutCount}명</div></div>
      <div class="stat-card"><div class="stat-label">목표대비</div><div class="stat-value">${esc(diffLabel)}</div></div>
    `;
  }
}

function renderSummarySection(data: RetrospectiveReportData, insights: SectionInsight[]): void {
  const section = $("retroSummarySection");
  if (section) section.removeAttribute("data-empty");

  // Normalize values to 0-100 for radar
  const attRate = data.attendance?.avgRate ?? 0;
  const greenRate = data.achievement?.greenRate ?? 0;
  const nps = data.satisfaction ? Math.max(0, Math.min(100, ((data.satisfaction.NPS + 100) / 200) * 100)) : 0;
  const defenseRate = data.dropout?.finalDefenseRate ?? 0;
  // 응대건수: normalize with max 200 as reference
  const inquiryNorm = data.inquiry ? Math.min(100, (data.inquiry.totalCount / 200) * 100) : 0;

  renderChartInCanvas("retroSummaryRadar", {
    type: "radar",
    data: {
      labels: ["출결률", "Green%", "NPS", "방어율", "응대건수"],
      datasets: [
        {
          label: "종합 지표",
          data: [attRate, greenRate, nps, defenseRate, inquiryNorm],
          backgroundColor: "rgba(124, 92, 252, 0.2)",
          borderColor: COLORS.primary,
          pointBackgroundColor: COLORS.primary,
          pointRadius: 4,
        },
      ],
    },
    options: {
      scales: {
        r: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } },
      },
      plugins: {
        title: { display: true, text: "종합 운영 지표 (5축)", font: { size: 13 } },
        legend: { display: false },
      },
    },
  });

  // Insights list
  const listEl = $("retroInsightsList");
  if (listEl) {
    if (insights.length === 0) {
      listEl.innerHTML = '<div style="color:#9ca3af;padding:12px">분석 가능한 인사이트가 없습니다.</div>';
      return;
    }
    listEl.innerHTML = insights
      .map(
        (ins) =>
          `<div class="retro-insight-card" data-level="${esc(ins.level)}">
            <span class="retro-insight-emoji">${ins.emoji}</span>
            <span class="retro-insight-text">${esc(ins.text)}</span>
          </div>`,
      )
      .join("");
  }
}

// ── Empty Section ────────────────────────────────────────────

function renderEmptySection(sectionId: string): void {
  const section = $(sectionId);
  if (!section) return;
  section.setAttribute("data-empty", "true");

  const insightEl = section.querySelector(".retro-insight");
  if (insightEl) {
    insightEl.innerHTML =
      '<div style="color:#9ca3af;padding:16px;text-align:center">데이터가 부족하여 분석을 생략합니다</div>';
  }
}

// ── Section Insights ─────────────────────────────────────────

function renderSectionInsights(sectionKey: string, insights: SectionInsight[]): void {
  const sectionMap: Record<string, string> = {
    attendance: "retroAttendanceSection",
    achievement: "retroAchievementSection",
    satisfaction: "retroSatisfactionSection",
    inquiry: "retroInquirySection",
    dropout: "retroDropoutSection",
  };

  const sectionId = sectionMap[sectionKey];
  if (!sectionId) return;

  const section = $(sectionId);
  if (!section) return;

  const insightEl = section.querySelector(".retro-insight");
  if (!insightEl) return;

  const sectionInsights = insights.filter((i) => i.section === sectionKey);
  if (sectionInsights.length === 0) {
    insightEl.innerHTML = "";
    return;
  }

  insightEl.innerHTML = sectionInsights
    .map(
      (ins) =>
        `<div class="retro-insight-card" data-level="${esc(ins.level)}">
          <span class="retro-insight-emoji">${ins.emoji}</span>
          <span class="retro-insight-text">${esc(ins.text)}</span>
        </div>`,
    )
    .join("");
}

// ── PDF Export ────────────────────────────────────────────────

/** Offscreen canvas for PDF chart rendering */
function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.style.position = "fixed";
  canvas.style.left = "-9999px";
  document.body.appendChild(canvas);
  return canvas;
}

/** Render chart to base64 image on offscreen canvas */
function chartToBase64(canvas: HTMLCanvasElement, config: ChartConfiguration): string {
  const ctx = canvas.getContext("2d")!;
  const chart = new Chart(ctx, { ...config, options: { ...config.options, animation: false, responsive: false } });
  const img = chart.toBase64Image("image/png", 1);
  chart.destroy();
  document.body.removeChild(canvas);
  return img;
}

interface PdfChartImages {
  attDist: string;
  riskDonut: string;
  signalDonut: string;
  nodeQuestBar: string;
  npsBar: string;
  channelDonut: string;
  summaryRadar: string;
}

function generatePdfChartImages(data: RetrospectiveReportData): PdfChartImages {
  // Attendance distribution
  const attDist = data.attendance
    ? chartToBase64(createOffscreenCanvas(500, 280), {
        type: "bar",
        data: {
          labels: data.attendance.rateDistribution.map((d) => d.label),
          datasets: [
            {
              label: "인원수",
              data: data.attendance.rateDistribution.map((d) => d.count),
              backgroundColor: [COLORS.green, COLORS.primary, COLORS.yellow, COLORS.red],
              borderRadius: 4,
            },
          ],
        },
        options: {
          plugins: { title: { display: true, text: "출결률 분포", font: { size: 13 } }, legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
      })
    : "";

  // Risk donut
  const riskDonut = data.attendance
    ? chartToBase64(createOffscreenCanvas(300, 300), {
        type: "doughnut",
        data: {
          labels: ["위험", "경고", "주의", "안전"],
          datasets: [
            {
              data: [
                data.attendance.riskCounts.danger,
                data.attendance.riskCounts.warning,
                data.attendance.riskCounts.caution,
                data.attendance.riskCounts.safe,
              ],
              backgroundColor: [COLORS.danger, COLORS.warning, COLORS.caution, COLORS.safe],
            },
          ],
        },
        options: {
          plugins: { title: { display: true, text: "위험도 분포", font: { size: 13 } }, legend: { position: "bottom" } },
        },
      })
    : "";

  // Signal donut
  const signalDonut = data.achievement
    ? chartToBase64(createOffscreenCanvas(300, 300), {
        type: "doughnut",
        data: {
          labels: ["Green", "Yellow", "Red"],
          datasets: [
            {
              data: data.achievement.signalDistribution.map((d) => d.count),
              backgroundColor: [COLORS.green, COLORS.yellow, COLORS.red],
            },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "신호등 분포", font: { size: 13 } },
            legend: { position: "bottom" },
          },
        },
      })
    : "";

  // Node vs Quest bar
  const nodeQuestBar = data.achievement
    ? chartToBase64(createOffscreenCanvas(500, 280), {
        type: "bar",
        data: {
          labels: ["노드 완료율", "퀘스트 패스율"],
          datasets: [
            {
              label: "비율 (%)",
              data: [data.achievement.avgNodeRate, data.achievement.avgQuestRate],
              backgroundColor: [COLORS.primary, COLORS.green],
              borderRadius: 4,
            },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "노드 vs 퀘스트 비율", font: { size: 13 } },
            legend: { display: false },
          },
          scales: { y: { beginAtZero: true, max: 100 } },
        },
      })
    : "";

  // NPS bar
  const npsBar = data.satisfaction
    ? chartToBase64(createOffscreenCanvas(500, 280), {
        type: "bar",
        data: {
          labels: data.satisfaction.itemScores.map((d) => d.label),
          datasets: [
            {
              label: "점수",
              data: data.satisfaction.itemScores.map((d) => d.score),
              backgroundColor: [COLORS.primary, COLORS.green, COLORS.yellow, COLORS.gray],
              borderRadius: 4,
            },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "항목별 점수 비교", font: { size: 13 } },
            legend: { display: false },
          },
          scales: { y: { beginAtZero: true } },
        },
      })
    : "";

  // Channel donut
  const channelColors = [COLORS.primary, COLORS.green, COLORS.yellow, COLORS.red, COLORS.gray];
  const channelDonut = data.inquiry
    ? chartToBase64(createOffscreenCanvas(300, 300), {
        type: "doughnut",
        data: {
          labels: data.inquiry.channelBreakdown.map((d) => d.channel),
          datasets: [
            {
              data: data.inquiry.channelBreakdown.map((d) => d.count),
              backgroundColor: data.inquiry.channelBreakdown.map((_, i) => channelColors[i % channelColors.length]),
            },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "채널별 문의 분포", font: { size: 13 } },
            legend: { position: "bottom" },
          },
        },
      })
    : "";

  // Summary radar
  const attRate = data.attendance?.avgRate ?? 0;
  const greenRate = data.achievement?.greenRate ?? 0;
  const nps = data.satisfaction ? Math.max(0, Math.min(100, ((data.satisfaction.NPS + 100) / 200) * 100)) : 0;
  const defenseRate = data.dropout?.finalDefenseRate ?? 0;
  const inquiryNorm = data.inquiry ? Math.min(100, (data.inquiry.totalCount / 200) * 100) : 0;

  const summaryRadar = chartToBase64(createOffscreenCanvas(400, 400), {
    type: "radar",
    data: {
      labels: ["출결률", "Green%", "NPS", "방어율", "응대건수"],
      datasets: [
        {
          label: "종합 지표",
          data: [attRate, greenRate, nps, defenseRate, inquiryNorm],
          backgroundColor: "rgba(124, 92, 252, 0.2)",
          borderColor: COLORS.primary,
          pointBackgroundColor: COLORS.primary,
          pointRadius: 4,
        },
      ],
    },
    options: {
      scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } } },
      plugins: {
        title: { display: true, text: "종합 운영 지표 (5축)", font: { size: 13 } },
        legend: { display: false },
      },
    },
  });

  return { attDist, riskDonut, signalDonut, nodeQuestBar, npsBar, channelDonut, summaryRadar };
}

function exportPdf(): void {
  if (!lastReportData) return;

  const data = lastReportData;
  const insights = lastInsights;
  const filter = data.filter;

  const degrLabel =
    filter.selectedDegrs.length === 1
      ? `${filter.selectedDegrs[0]}기`
      : `${filter.selectedDegrs[0]}~${filter.selectedDegrs[filter.selectedDegrs.length - 1]}기`;

  const dateStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  // Generate chart images
  const charts = generatePdfChartImages(data);

  // Build insight HTML helper
  const insightHtml = (sectionKey: string) => {
    const items = insights.filter((i) => i.section === sectionKey);
    if (items.length === 0) return "";
    return items
      .map((i) => {
        const bg =
          i.level === "positive" ? "#ecfdf5" : i.level === "negative" ? "#fef2f2" : "#f8fafc";
        const border =
          i.level === "positive" ? "#86efac" : i.level === "negative" ? "#fca5a5" : "#e2e8f0";
        return `<div style="background:${bg};border:1px solid ${border};border-radius:6px;padding:8px 12px;margin:4px 0;font-size:10pt">${i.emoji} ${i.text}</div>`;
      })
      .join("");
  };

  const emptyMsg = '<div style="color:#9ca3af;text-align:center;padding:20px;font-size:10pt">데이터 없음</div>';

  // ── Attendance section HTML
  const attSection = data.attendance
    ? `
    <div class="kpi-cards-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-card"><div class="kpi-card-label">평균출결률</div><div class="kpi-card-value">${data.attendance.avgRate}%</div></div>
      <div class="kpi-card"><div class="kpi-card-label">하차방어율</div><div class="kpi-card-value">${data.attendance.defenseRate}%</div></div>
      <div class="kpi-card"><div class="kpi-card-label">위험군</div><div class="kpi-card-value">${data.attendance.riskCounts.danger + data.attendance.riskCounts.warning}명</div></div>
      <div class="kpi-card"><div class="kpi-card-label">결석Top1</div><div class="kpi-card-value">${data.attendance.absentTop3[0] ? data.attendance.absentTop3[0].name + " (" + data.attendance.absentTop3[0].absentDays + "일)" : "-"}</div></div>
    </div>
    <div class="chart-row">
      <div class="chart-half"><img src="${charts.attDist}" alt="출결률 분포" /></div>
      <div class="chart-half"><img src="${charts.riskDonut}" alt="위험도 분포" /></div>
    </div>
    ${insightHtml("attendance")}
    `
    : emptyMsg;

  // ── Achievement section HTML
  const achSection = data.achievement
    ? `
    <div class="kpi-cards-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-card"><div class="kpi-card-label">Green%</div><div class="kpi-card-value">${data.achievement.greenRate}%</div></div>
      <div class="kpi-card"><div class="kpi-card-label">노드제출률</div><div class="kpi-card-value">${data.achievement.avgNodeRate}%</div></div>
      <div class="kpi-card"><div class="kpi-card-label">퀘스트패스률</div><div class="kpi-card-value">${data.achievement.avgQuestRate}%</div></div>
      <div class="kpi-card"><div class="kpi-card-label">Red%</div><div class="kpi-card-value">${data.achievement.redRate}%</div></div>
    </div>
    <div class="chart-row">
      <div class="chart-half"><img src="${charts.signalDonut}" alt="신호등 분포" /></div>
      <div class="chart-half"><img src="${charts.nodeQuestBar}" alt="노드 vs 퀘스트" /></div>
    </div>
    ${insightHtml("achievement")}
    `
    : emptyMsg;

  // ── Satisfaction section HTML
  const satSection = data.satisfaction
    ? `
    <div class="kpi-cards-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-card"><div class="kpi-card-label">NPS</div><div class="kpi-card-value">${data.satisfaction.NPS}</div></div>
      <div class="kpi-card"><div class="kpi-card-label">강사만족도</div><div class="kpi-card-value">${data.satisfaction.강사만족도}</div></div>
      <div class="kpi-card"><div class="kpi-card-label">HRD만족도</div><div class="kpi-card-value">${data.satisfaction.HRD만족도}</div></div>
      <div class="kpi-card"><div class="kpi-card-label">추천의향</div><div class="kpi-card-value">${data.satisfaction.추천의향}</div></div>
    </div>
    <div class="chart-single"><img src="${charts.npsBar}" alt="항목별 점수 비교" /></div>
    ${insightHtml("satisfaction")}
    `
    : emptyMsg;

  // ── Inquiry section HTML
  const inqSection = data.inquiry
    ? `
    <div class="kpi-cards-row" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi-card"><div class="kpi-card-label">총건수</div><div class="kpi-card-value">${data.inquiry.totalCount}건</div></div>
      <div class="kpi-card"><div class="kpi-card-label">주요채널</div><div class="kpi-card-value">${data.inquiry.channelBreakdown.length > 0 ? data.inquiry.channelBreakdown[0].channel : "-"}</div></div>
      <div class="kpi-card"><div class="kpi-card-label">주요유형</div><div class="kpi-card-value">${data.inquiry.topCategory}</div></div>
    </div>
    <div class="chart-single"><img src="${charts.channelDonut}" alt="채널별 분포" style="max-width:50%" /></div>
    ${insightHtml("inquiry")}
    `
    : emptyMsg;

  // ── Dropout section HTML
  const drSection = data.dropout
    ? (() => {
        const diff = data.dropout.finalDefenseRate - data.dropout.targetRate;
        const diffLabel = diff >= 0 ? `+${diff.toFixed(1)}%p` : `${diff.toFixed(1)}%p`;
        return `
    <div class="kpi-cards-row" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi-card"><div class="kpi-card-label">최종방어율</div><div class="kpi-card-value">${data.dropout.finalDefenseRate}%</div></div>
      <div class="kpi-card"><div class="kpi-card-label">하차인원</div><div class="kpi-card-value">${data.dropout.dropoutCount}명</div></div>
      <div class="kpi-card"><div class="kpi-card-label">목표대비</div><div class="kpi-card-value">${diffLabel}</div></div>
    </div>
    ${insightHtml("dropout")}
    `;
      })()
    : emptyMsg;

  // ── Summary section HTML
  const summarySection = `
    <div class="chart-single"><img src="${charts.summaryRadar}" alt="종합 운영 지표" style="max-width:60%" /></div>
    <div style="margin-top:16px">
      ${insights
        .map((i) => {
          const bg =
            i.level === "positive" ? "#ecfdf5" : i.level === "negative" ? "#fef2f2" : "#f8fafc";
          const border =
            i.level === "positive" ? "#86efac" : i.level === "negative" ? "#fca5a5" : "#e2e8f0";
          return `<div style="background:${bg};border:1px solid ${border};border-radius:6px;padding:8px 12px;margin:4px 0;font-size:10pt">${i.emoji} ${i.text}</div>`;
        })
        .join("")}
    </div>
  `;

  const studentCount = data.attendance?.totalStudents ?? data.achievement?.totalMatched ?? 0;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>${filter.courseName} ${degrLabel} 운영 회고 리포트</title>
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

    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #7c5cfc;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .report-header-left h1 {
      font-size: 20pt;
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 4px;
    }
    .report-header-left .subtitle {
      font-size: 10pt;
      color: #6b7280;
    }
    .report-header-right {
      text-align: right;
    }
    .report-logo {
      font-size: 20pt;
      font-weight: 700;
      color: #7c5cfc;
      letter-spacing: -1px;
    }
    .report-meta {
      font-size: 9pt;
      color: #9ca3af;
      margin-top: 6px;
    }

    .section {
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    .section h2 {
      font-size: 13pt;
      font-weight: 600;
      color: #1f2937;
      border-left: 4px solid #7c5cfc;
      padding-left: 10px;
      margin-bottom: 12px;
    }

    .kpi-cards-row {
      display: grid;
      gap: 10px;
      margin-bottom: 16px;
    }
    .kpi-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .kpi-card-label { font-size: 9pt; color: #6b7280; margin-bottom: 2px; }
    .kpi-card-value { font-size: 16pt; font-weight: 700; color: #1f2937; }

    .chart-row {
      display: flex;
      gap: 16px;
      justify-content: center;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .chart-row img { max-width: 48%; height: auto; }
    .chart-half { text-align: center; }
    .chart-half img { max-width: 100%; height: auto; }
    .chart-single { text-align: center; margin-bottom: 16px; }
    .chart-single img { max-width: 80%; height: auto; }

    .report-footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 2px solid #7c5cfc;
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      color: #9ca3af;
    }
    .report-footer-logo { color: #7c5cfc; font-weight: 600; }

    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 24px;
      background: #7c5cfc;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
    }
    .print-btn:hover { background: #6344e0; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">PDF 저장 / 인쇄</button>

  <!-- Header -->
  <div class="report-header">
    <div class="report-header-left">
      <h1>${esc(filter.courseName)} ${esc(degrLabel)} 운영 회고 리포트</h1>
      <div class="subtitle">생성일: ${dateStr} | 대상 인원: ${studentCount}명</div>
    </div>
    <div class="report-header-right">
      <div class="report-logo">모두의연구소</div>
      <div class="report-meta">HRD 운영팀<br />문서번호: RETRO-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}</div>
    </div>
  </div>

  <!-- 1. 출결 섹션 -->
  <div class="section">
    <h2>1. 출결 현황</h2>
    ${attSection}
  </div>

  <!-- 2. 학업성취도 섹션 -->
  <div class="section">
    <h2>2. 학업성취도</h2>
    ${achSection}
  </div>

  <div class="page-break"></div>

  <!-- 3. 만족도 섹션 -->
  <div class="section">
    <h2>3. 만족도</h2>
    ${satSection}
  </div>

  <!-- 4. 문의응대 섹션 -->
  <div class="section">
    <h2>4. 문의응대</h2>
    ${inqSection}
  </div>

  <!-- 5. 하차방어 섹션 -->
  <div class="section">
    <h2>5. 하차방어</h2>
    ${drSection}
  </div>

  <div class="page-break"></div>

  <!-- 6. 종합 요약 -->
  <div class="section">
    <h2>6. 종합 요약</h2>
    ${summarySection}
  </div>

  <!-- Footer -->
  <div class="report-footer">
    <div>
      <span class="report-footer-logo">모두의연구소</span> | HRD 운영팀 · 운영 회고 리포트
    </div>
    <div>
      발행일: ${dateStr} | ${esc(filter.courseName)} · ${esc(degrLabel)}
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
