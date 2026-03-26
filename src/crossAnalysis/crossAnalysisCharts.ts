/**
 * 교차분석 차트 렌더링 모듈
 *
 * 출결↔학업성취도↔만족도 상관관계를 시각화합니다.
 * - Scatter: 출결률 vs 성취도 점수
 * - Heatmap: 출결구간 × 신호등 매트릭스
 * - Radar: 기수별 종합 비교
 */
import { Chart, type ChartConfiguration } from "chart.js/auto";
import type { StudentCrossData, CohortCrossData, HeatmapCell } from "./crossAnalysisTypes";

// ─── Color constants ────────────────────────────────────────
const COLOR_GREEN = "#10b981";
const COLOR_YELLOW = "#f59e0b";
const COLOR_RED = "#ef4444";

const RADAR_PALETTE = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

const FONT_FAMILY = "Pretendard, Inter, sans-serif";

// ─── Helpers ────────────────────────────────────────────────

/** 신호등 값에 대응하는 색상 반환 */
function signalColor(signal: string): string {
  if (signal === "green") return COLOR_GREEN;
  if (signal === "yellow") return COLOR_YELLOW;
  return COLOR_RED;
}

/** hex → rgba 변환 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── 1. Scatter Chart: 출결률 vs 성취도 ────────────────────

/**
 * 출결률(X축)과 성취도 점수(Y축)의 산점도를 렌더링합니다.
 * 신호등(green/yellow/red) 별로 데이터셋을 분리하여 범례 표시.
 */
export function renderScatterChart(canvas: HTMLCanvasElement, students: StudentCrossData[]): Chart {
  // 신호등별 분류 + 원본 학생 참조 보존
  const greenStudents: StudentCrossData[] = [];
  const yellowStudents: StudentCrossData[] = [];
  const redStudents: StudentCrossData[] = [];

  for (const s of students) {
    if (s.신호등 === "green") greenStudents.push(s);
    else if (s.신호등 === "yellow") yellowStudents.push(s);
    else redStudents.push(s);
  }

  // 데이터셋 인덱스(1,2,3) → 학생 배열 매핑 (0번은 기준선)
  const studentsByDataset: StudentCrossData[][] = [[], greenStudents, yellowStudents, redStudents];

  const toPoints = (arr: StudentCrossData[]) => arr.map((s) => ({ x: s.attendanceRate, y: s.compositeScore }));

  // 대각선 기준선 (y = x) — 별도 line 데이터셋으로 표현
  const refLine = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ];

  const config: ChartConfiguration<"scatter"> = {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "기준선 (y=x)",
          data: refLine as never,
          type: "line" as never,
          borderColor: "rgba(156,163,175,0.4)",
          borderDash: [6, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          order: 10, // 뒤에 렌더
        },
        {
          label: "우수 (Green)",
          data: toPoints(greenStudents),
          backgroundColor: COLOR_GREEN,
          pointRadius: 6,
          pointHoverRadius: 8,
        },
        {
          label: "주의 (Yellow)",
          data: toPoints(yellowStudents),
          backgroundColor: COLOR_YELLOW,
          pointRadius: 6,
          pointHoverRadius: 8,
        },
        {
          label: "위험 (Red)",
          data: toPoints(redStudents),
          backgroundColor: COLOR_RED,
          pointRadius: 6,
          pointHoverRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 100,
          title: { display: true, text: "출결률 (%)", font: { family: FONT_FAMILY } },
          ticks: { font: { family: FONT_FAMILY } },
        },
        y: {
          min: 0,
          max: 100,
          title: { display: true, text: "성취도 점수", font: { family: FONT_FAMILY } },
          ticks: { font: { family: FONT_FAMILY } },
        },
      },
      plugins: {
        legend: {
          labels: {
            font: { family: FONT_FAMILY },
            // 기준선은 범례에서 숨김
            filter(item) {
              return item.text !== "기준선 (y=x)";
            },
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const dsIdx = ctx.datasetIndex;
              const ptIdx = ctx.dataIndex;
              const student = studentsByDataset[dsIdx]?.[ptIdx];
              if (!student) return "";
              return `${student.이름} (${student.기수}) - 출결 ${student.attendanceRate.toFixed(1)}%, 성취 ${student.compositeScore.toFixed(1)}`;
            },
          },
        },
      },
    },
  };

  return new Chart(canvas, config as ChartConfiguration);
}

// ─── 2. Heatmap Table: 출결구간 × 신호등 매트릭스 ──────────

/** 출결 구간 라벨 (행) */
const ATTENDANCE_ROWS = ["90%+", "80~90%", "70~80%", "70%미만"] as const;

/** 신호등 컬럼 */
const SIGNAL_COLS = ["green", "yellow", "red"] as const;
const SIGNAL_HEADERS = ["🟢 Green", "🟡 Yellow", "🔴 Red"];

/**
 * DOM 기반 히트맵 테이블을 렌더링합니다.
 * 셀 배경 투명도가 인원수에 비례하며, 클릭 시 상세 조회 콜백을 호출합니다.
 */
export function renderHeatmapTable(
  container: HTMLElement,
  cells: HeatmapCell[],
  onCellClick: (cell: HeatmapCell) => void,
): void {
  container.innerHTML = "";

  // 셀을 (attendanceRange, signal) 키로 빠르게 조회
  const cellMap = new Map<string, HeatmapCell>();
  let maxCount = 0;
  for (const c of cells) {
    cellMap.set(`${c.attendanceBracket}|${c.signal}`, c);
    if (c.count > maxCount) maxCount = c.count;
  }

  const table = document.createElement("table");
  table.className = "cross-heatmap";

  // thead
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.appendChild(document.createElement("th")); // 빈 코너 셀
  for (const h of SIGNAL_HEADERS) {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // tbody — 출결 구간별 행
  const tbody = document.createElement("tbody");
  for (const rowLabel of ATTENDANCE_ROWS) {
    const tr = document.createElement("tr");

    const labelTd = document.createElement("td");
    labelTd.className = "cross-heatmap-label";
    labelTd.textContent = rowLabel;
    tr.appendChild(labelTd);

    for (const sig of SIGNAL_COLS) {
      const cell = cellMap.get(`${rowLabel}|${sig}`);
      const count = cell?.count ?? 0;

      const td = document.createElement("td");
      td.className = "cross-heatmap-cell";
      td.dataset.count = String(count);
      td.textContent = count > 0 ? `${count}명` : "-";

      // 배경색 — 3단계 색상 강도: 저(1~5명), 중(6~15명), 고(16명+)
      if (count > 0) {
        const alpha = count <= 5 ? 0.25 : count <= 15 ? 0.55 : 0.85;
        td.style.background = hexToRgba(signalColor(sig), alpha);
        td.style.fontSize = count <= 5 ? "13px" : count <= 15 ? "15px" : "17px";
        td.style.fontWeight = count > 15 ? "700" : count > 5 ? "600" : "400";
        td.style.cursor = "pointer";

        // 클릭 핸들러
        if (cell) {
          td.addEventListener("click", () => onCellClick(cell));
        }
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

// ─── 3. Radar Chart: 기수별 종합 비교 ──────────────────────

/**
 * 기수별 출결률·성취도(greenRate)·NPS를 레이더 차트로 비교합니다.
 * 종합점수 상위 5개 기수만 표시합니다.
 */
export function renderRadarChart(canvas: HTMLCanvasElement, cohorts: CohortCrossData[]): Chart {
  // 종합점수 상위 5개 기수 선택
  const top5 = [...cohorts].sort((a, b) => b.종합점수 - a.종합점수).slice(0, 5);

  const datasets = top5.map((cohort, i) => {
    const color = RADAR_PALETTE[i % RADAR_PALETTE.length];
    // NPS 정규화: NPS 범위 -100~+100 → 0~100
    const normalizedNPS = (cohort.NPS + 100) / 2;
    return {
      label: `${cohort.과정명} ${cohort.기수}`,
      data: [cohort.avgAttendanceRate, cohort.greenRate, normalizedNPS],
      backgroundColor: hexToRgba(color, 0.2),
      borderColor: color,
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: color,
    };
  });

  const config: ChartConfiguration<"radar"> = {
    type: "radar",
    data: {
      labels: ["출결률", "성취도", "NPS"],
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 20,
            font: { family: FONT_FAMILY },
          },
          pointLabels: {
            font: { family: FONT_FAMILY, size: 13 },
          },
        },
      },
      plugins: {
        legend: {
          labels: { font: { family: FONT_FAMILY } },
        },
      },
    },
  };

  return new Chart(canvas, config);
}

// ─── 4. Chart cleanup helper ────────────────────────────────

/** Chart.js 인스턴스를 안전하게 정리합니다 */
export function destroyChart(chart: Chart | null): void {
  if (chart) {
    chart.destroy();
  }
}

// ─── 5. Histogram Chart: 출결률 분포 ────────────────────────

/** 출결률 분포 히스토그램 */
export function renderHistogramChart(
  canvas: HTMLCanvasElement,
  data: { label: string; count: number }[],
): Chart {
  const colors = data.map((_, i) => {
    const ratio = i / (data.length - 1);
    if (ratio < 0.3) return "#ef4444";
    if (ratio < 0.5) return "#f97316";
    if (ratio < 0.7) return "#f59e0b";
    return "#10b981";
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return null as unknown as Chart;
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => d.label),
      datasets: [{ label: "학생 수", data: data.map((d) => d.count), backgroundColor: colors, borderRadius: 4 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#6b7280", font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#6b7280", stepSize: 1 }, grid: { color: "rgba(0,0,0,0.06)" } },
      },
    },
  });
}

// ─── 6. Risk Donut Chart: 위험등급 분포 ─────────────────────

/** 위험등급 도넛 차트 */
export function renderRiskDonutChart(
  canvas: HTMLCanvasElement,
  data: { level: string; count: number; color: string }[],
): Chart {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null as unknown as Chart;
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: data.map((d) => `${d.level} (${d.count}명)`),
      datasets: [{ data: data.map((d) => d.count), backgroundColor: data.map((d) => d.color), borderWidth: 2, borderColor: "#ffffff" }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "60%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#6b7280", padding: 10, usePointStyle: true, font: { size: 11 } } },
      },
    },
  });
}

// ─── 7. Gender Comparison Chart ──────────────────────────────

/** 성별 대조 가로 막대 차트 */
export function renderGenderComparisonChart(
  canvas: HTMLCanvasElement,
  data: { gender: string; avgAttendance: number; avgScore: number; greenRate: number; dangerRate: number }[],
): Chart {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null as unknown as Chart;
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => d.gender + "성"),
      datasets: [
        { label: "출결률", data: data.map((d) => d.avgAttendance), backgroundColor: "#6366f199", borderColor: "#6366f1", borderWidth: 1, borderRadius: 4 },
        { label: "성취도", data: data.map((d) => d.avgScore), backgroundColor: "#10b98199", borderColor: "#10b981", borderWidth: 1, borderRadius: 4 },
        { label: "Green%", data: data.map((d) => d.greenRate), backgroundColor: "#22c55e99", borderColor: "#22c55e", borderWidth: 1, borderRadius: 4 },
        { label: "위험군%", data: data.map((d) => d.dangerRate), backgroundColor: "#ef444499", borderColor: "#ef4444", borderWidth: 1, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: {
        x: { min: 0, max: 100, ticks: { color: "#6b7280", callback: (v) => v + "%" }, grid: { color: "rgba(0,0,0,0.06)" } },
        y: { ticks: { color: "#6b7280", font: { size: 13, weight: "bold" as const } }, grid: { display: false } },
      },
      plugins: { legend: { position: "bottom", labels: { color: "#6b7280", usePointStyle: true, font: { size: 11 } } } },
    },
  });
}

// ─── 8. Age Group Chart ─────────────────────────────────────

/** 연령대별 대조 막대 차트 */
export function renderAgeGroupChart(
  canvas: HTMLCanvasElement,
  data: { ageGroup: string; count: number; avgAttendance: number; avgScore: number; dangerRate: number }[],
): Chart {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null as unknown as Chart;
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => `${d.ageGroup} (${d.count}명)`),
      datasets: [
        { label: "출결률", data: data.map((d) => d.avgAttendance), backgroundColor: "#6366f1cc", borderRadius: 4 },
        { label: "성취도", data: data.map((d) => d.avgScore), backgroundColor: "#10b981cc", borderRadius: 4 },
        { label: "위험군%", data: data.map((d) => d.dangerRate), backgroundColor: "#ef4444cc", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#6b7280", font: { size: 11 } }, grid: { display: false } },
        y: { min: 0, max: 100, ticks: { color: "#6b7280", callback: (v) => v + "%" }, grid: { color: "rgba(0,0,0,0.06)" } },
      },
      plugins: { legend: { position: "bottom", labels: { color: "#6b7280", usePointStyle: true, font: { size: 11 } } } },
    },
  });
}

// ─── 9. Absent-Dropout Bar+Line Chart ────────────────────────

/** 결석일수별 하차 확률 막대+라인 복합 차트 */
export function renderAbsentDropoutChart(
  canvas: HTMLCanvasElement,
  data: { bracket: string; totalCount: number; dropoutCount: number; dropoutRate: number }[],
): Chart {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null as unknown as Chart;
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => d.bracket),
      datasets: [
        {
          label: "전체 인원",
          data: data.map((d) => d.totalCount),
          backgroundColor: "#6366f166",
          borderColor: "#6366f1",
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          label: "이탈 인원",
          data: data.map((d) => d.dropoutCount),
          backgroundColor: "#ef444466",
          borderColor: "#ef4444",
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          label: "이탈률(%)",
          data: data.map((d) => d.dropoutRate),
          type: "line" as const,
          borderColor: "#f97316",
          backgroundColor: "#f9731633",
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: "#f97316",
          fill: true,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#6b7280" }, grid: { display: false } },
        y: {
          position: "left",
          beginAtZero: true,
          ticks: { color: "#6b7280" },
          grid: { color: "rgba(0,0,0,0.06)" },
          title: { display: true, text: "인원", color: "#6b7280" },
        },
        y1: {
          position: "right",
          beginAtZero: true,
          max: 100,
          ticks: { color: "#f97316", callback: (v) => v + "%" },
          grid: { display: false },
          title: { display: true, text: "이탈률", color: "#f97316" },
        },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: "#6b7280", usePointStyle: true, font: { size: 11 } } },
      },
    },
  });
}

// ─── 10. Risk Factors Horizontal Bar ─────────────────────────

/** 이탈 위험 요인 순위 수평 막대 (이탈자 vs 재적자 비율 비교) */
export function renderRiskFactorsChart(
  canvas: HTMLCanvasElement,
  data: { factor: string; riskRate: number; safeRate: number; impactScore: number }[],
): Chart {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null as unknown as Chart;
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => `${d.factor} (×${d.impactScore})`),
      datasets: [
        { label: "이탈자 비율", data: data.map((d) => d.riskRate), backgroundColor: "#ef4444cc", borderRadius: 4 },
        { label: "재적자 비율", data: data.map((d) => d.safeRate), backgroundColor: "#10b981cc", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: { color: "#6b7280", callback: (v) => v + "%" },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        y: { ticks: { color: "#6b7280", font: { size: 11 } }, grid: { display: false } },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: "#6b7280", usePointStyle: true, font: { size: 11 } } },
      },
    },
  });
}

// ─── 11. Bubble Chart: 방어율 vs NPS ─────────────────────────

/** 기수별 방어율 vs NPS 버블차트 */
export function renderBubbleChart(
  canvas: HTMLCanvasElement,
  cohorts: { 과정명: string; 기수: string; NPS: number; defenseRate: number; 인원: number }[],
): Chart {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null as unknown as Chart;
  const colors = ["#a855f7", "#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#f97316", "#ef4444", "#ec4899"];
  const datasets = cohorts.map((c, i) => ({
    label: `${c.과정명} ${c.기수}`,
    data: [{ x: c.NPS, y: c.defenseRate, r: Math.max(5, Math.min(20, c.인원 / 3)) }],
    backgroundColor: colors[i % colors.length] + "99",
    borderColor: colors[i % colors.length],
    borderWidth: 1,
  }));
  return new Chart(ctx, {
    type: "bubble",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: "NPS", color: "#6b7280" }, ticks: { color: "#6b7280" }, grid: { color: "rgba(0,0,0,0.06)" } },
        y: { title: { display: true, text: "방어율 (%)", color: "#6b7280" }, min: 50, max: 105, ticks: { color: "#6b7280" }, grid: { color: "rgba(0,0,0,0.06)" } },
      },
      plugins: { legend: { display: true, position: "bottom", labels: { color: "#6b7280", usePointStyle: true, font: { size: 10 } } } },
    },
  });
}
