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

      // 배경색 — 인원수 비례 투명도
      if (count > 0 && maxCount > 0) {
        const alpha = Math.max(0.1, count / maxCount);
        td.style.background = hexToRgba(signalColor(sig), alpha);
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
