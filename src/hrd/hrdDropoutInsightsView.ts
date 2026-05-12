/**
 * 하차방어율 개선 인사이트 — DOM 렌더링
 *
 * - Hero 카드 (방어율 +Xp + 추정 절감 인원)
 * - Leading 미니 카드 4개 (회복/발생/끊기/NPS)
 * - 진단 줄 (표본 부족 / 만족도 누락 경고)
 * - 시계열 토글 (Phase 2 기반 — Chart.js line)
 * - cutoff 인라인 수정
 */

import { Chart } from "chart.js";
import { escapeHtml } from "../core/escape";
import {
  computeImpactMetrics,
  computeLeadingMetrics,
  computeMonthlyTrend,
  buildDiagnostics,
  loadInsightsConfig,
  saveInsightsConfig,
  DEFAULT_CUTOFF,
} from "./hrdDropoutInsights";
import { getCachedDropoutData } from "./hrdDropout";
import { getCachedAnalysisData } from "./hrdAnalytics";
import { loadCachedSatisfactionRecords } from "../crossAnalysis/crossAnalysisData";
import type {
  ImpactMetrics,
  LeadingMetric,
  LeadingMetrics,
  TrendPoint,
  InsightsDiagnostics,
} from "./hrdDropoutInsights";

// ─── 진입점 ─────────────────────────────────────────────────

let trendChart: Chart | null = null;

/**
 * 인사이트 섹션 전체 렌더 — 하차방어율 데이터 로드 후 호출.
 * 데이터가 0건이면 안내 메시지만 표시.
 */
export function renderDropoutInsights(): void {
  const root = document.getElementById("sectionDropoutInsights");
  if (!root) return;

  const cfg = loadInsightsConfig();
  const cutoff = cfg.cutoffDate || DEFAULT_CUTOFF;

  const dropoutEntries = getCachedDropoutData();
  const analysisData = getCachedAnalysisData();
  const satRecords = loadCachedSatisfactionRecords();

  // 데이터 없음
  if (dropoutEntries.length === 0) {
    root.innerHTML = `
      <div class="di-empty">
        <div class="di-empty-icon">📈</div>
        <div class="di-empty-title">개선 인사이트</div>
        <div class="di-empty-desc">하차방어율 데이터를 먼저 조회하세요. 데이터가 들어오면 도입 전/후 비교가 자동 계산됩니다.</div>
      </div>`;
    return;
  }

  const impact = computeImpactMetrics(dropoutEntries, cutoff);
  const leading = computeLeadingMetrics(dropoutEntries, analysisData, satRecords, cutoff);
  const diag = buildDiagnostics(dropoutEntries, satRecords, cutoff);
  const trend = computeMonthlyTrend(dropoutEntries);

  root.innerHTML = `
    ${renderHeader(cutoff, diag)}
    ${renderHeroCard(impact, leading.npsChange)}
    ${renderMiniCards(leading)}
    ${renderDiagnostics(diag)}
    ${renderTrendSection(trend)}
  `;

  // 이벤트 바인딩
  bindCutoffEdit(cutoff);
  bindTrendToggle(trend);
}

// ─── Sub-render ─────────────────────────────────────────────

function renderHeader(cutoff: string, diag: InsightsDiagnostics): string {
  return `
    <div class="di-header">
      <div class="di-header-title">📈 개선 인사이트 <span class="di-header-sub">(대시보드 도입 효과)</span></div>
      <div class="di-header-meta">
        cutoff:
        <span class="di-cutoff-display" id="diCutoffDisplay">${escapeHtml(cutoff)}</span>
        <button type="button" class="di-cutoff-edit" id="diCutoffEditBtn" title="cutoff 날짜 변경">수정</button>
        <span class="di-header-divider">·</span>
        <span class="di-cohort-count">도입 후 <strong>${diag.afterCohorts.length}</strong>기수 / 전 <strong>${diag.beforeCohorts.length}</strong>기수</span>
      </div>
    </div>`;
}

function renderHeroCard(impact: ImpactMetrics, nps: LeadingMetric): string {
  const deltaSign = impact.deltaPp > 0 ? "+" : "";
  const deltaClass = impact.deltaPp > 0 ? "di-positive" : impact.deltaPp < 0 ? "di-negative" : "di-neutral";

  // 비교 불가 케이스 (before 또는 after 0)
  if (impact.beforeN === 0 || impact.afterN === 0) {
    return `
      <div class="di-hero di-hero-incomplete">
        <div class="di-hero-main">
          <div class="di-hero-label">방어율 변화</div>
          <div class="di-hero-rate">— 비교 불가</div>
          <div class="di-hero-sub">도입 ${impact.beforeN === 0 ? "전" : "후"} 기수 데이터 없음</div>
        </div>
      </div>`;
  }

  const npsDeltaSign = nps.delta > 0 ? "+" : "";
  const npsLine = nps.beforeN > 0 && nps.afterN > 0
    ? `<span class="di-hero-aux">📊 NPS 보조: <strong>${npsDeltaSign}${nps.delta}p</strong> (${nps.beforeValue} → ${nps.afterValue})</span>`
    : `<span class="di-hero-aux di-hero-aux-warn">📊 NPS: 표본 부족</span>`;

  return `
    <div class="di-hero">
      <div class="di-hero-main">
        <div class="di-hero-label">방어율 변화</div>
        <div class="di-hero-rate">
          <span class="di-hero-before">${impact.beforeAvgRate}%</span>
          <span class="di-hero-arrow">→</span>
          <span class="di-hero-after">${impact.afterAvgRate}%</span>
          <span class="di-hero-delta ${deltaClass}">(${deltaSign}${impact.deltaPp}p)</span>
        </div>
        <div class="di-hero-sub">도입 후 평균 vs 도입 전 평균</div>
      </div>
      <div class="di-hero-side">
        <div class="di-hero-saved">💡 추정 절감 하차 인원 <strong>약 ${impact.estimatedSavedHeadcount}명</strong></div>
        ${npsLine}
        <div class="di-hero-sample">⚠️ 표본 N: 도입 후 ${impact.afterN}기수 (${impact.afterTotalStudents}명) / 도입 전 ${impact.beforeN}기수 (${impact.beforeTotalStudents}명)</div>
      </div>
    </div>`;
}

function renderMiniCards(leading: LeadingMetrics): string {
  const cards = [leading.riskRecovery, leading.riskOccurrence, leading.consecAbsentBreak, leading.npsChange];
  return `
    <div class="di-mini-grid">
      ${cards.map(renderMiniCard).join("")}
    </div>`;
}

function renderMiniCard(m: LeadingMetric): string {
  // 표본 0인 경우
  if (m.beforeN === 0 || m.afterN === 0) {
    return `
      <div class="di-mini-card di-mini-empty">
        <div class="di-mini-label">${escapeHtml(m.label)}</div>
        <div class="di-mini-value-empty">데이터 부족</div>
        <div class="di-mini-sub">도입 ${m.beforeN === 0 ? "전" : "후"} 표본 0</div>
      </div>`;
  }

  // 개선 방향에 따른 평가
  const isGood = m.betterDirection === "up" ? m.delta > 0 : m.delta < 0;
  const isBad = m.betterDirection === "up" ? m.delta < 0 : m.delta > 0;
  const evalClass = isGood ? "di-positive" : isBad ? "di-negative" : "di-neutral";
  const arrow = isGood ? "↑" : isBad ? "↓" : "·";
  const sign = m.delta > 0 ? "+" : "";

  const valueStr = m.unit === "p"
    ? `${m.afterValue}`
    : `${m.afterValue}${m.unit}`;
  const beforeStr = m.unit === "p"
    ? `vs ${m.beforeValue}`
    : `vs ${m.beforeValue}${m.unit}`;

  return `
    <div class="di-mini-card">
      <div class="di-mini-label">${escapeHtml(m.label)}</div>
      <div class="di-mini-value">
        ${valueStr} <span class="${evalClass}">${arrow}</span>
      </div>
      <div class="di-mini-delta ${evalClass}">${sign}${m.delta}${m.unit === "%" ? "p" : m.unit}</div>
      <div class="di-mini-sub">${beforeStr}</div>
    </div>`;
}

function renderDiagnostics(diag: InsightsDiagnostics): string {
  if (diag.warnings.length === 0) return "";
  const items = diag.warnings.map((w) => `<div class="di-warn-item">⚠️ ${escapeHtml(w)}</div>`).join("");
  const missing = diag.missingNpsCohorts.length > 0
    ? `<div class="di-warn-detail">만족도 누락: ${diag.missingNpsCohorts.map(escapeHtml).join(", ")}</div>`
    : "";
  return `
    <div class="di-warnings">
      ${items}
      ${missing}
    </div>`;
}

function renderTrendSection(trend: TrendPoint[]): string {
  const hasData = trend.length >= 2;
  return `
    <div class="di-trend-wrap">
      <button type="button" class="di-trend-toggle" id="diTrendToggleBtn" aria-expanded="false">
        ▶ 월별 시계열 추이 보기 ${hasData ? `(${trend.length}개월 누적)` : "(데이터 부족)"}
      </button>
      <div class="di-trend-body" id="diTrendBody" style="display:none">
        ${hasData
          ? `<div class="di-trend-chart"><canvas id="diTrendCanvas"></canvas></div>
             <div class="di-trend-note">표본 누적 시 추이가 명확해집니다 (현재 ${trend.length}개월).</div>`
          : `<div class="di-trend-empty">시계열 비교는 최소 2개월 이상의 cohort 데이터가 필요합니다.</div>`
        }
      </div>
    </div>`;
}

// ─── 이벤트 바인딩 ──────────────────────────────────────────

function bindCutoffEdit(currentCutoff: string): void {
  const btn = document.getElementById("diCutoffEditBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = window.prompt(
      `cutoff 날짜를 입력하세요 (YYYY-MM-DD 형식)\n\n현재: ${currentCutoff}\n\n이 날짜 이후 시작한 기수가 "도입 후"로 분류됩니다.`,
      currentCutoff,
    );
    if (next === null) return; // 취소
    const trimmed = next.trim();
    if (!trimmed) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      alert("YYYY-MM-DD 형식으로 입력해주세요. (예: 2026-03-01)");
      return;
    }
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) {
      alert("유효한 날짜가 아닙니다.");
      return;
    }
    saveInsightsConfig({ cutoffDate: trimmed });
    renderDropoutInsights(); // 재렌더
  });
}

function bindTrendToggle(trend: TrendPoint[]): void {
  const btn = document.getElementById("diTrendToggleBtn");
  const body = document.getElementById("diTrendBody");
  if (!btn || !body) return;
  btn.addEventListener("click", () => {
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    body.style.display = expanded ? "none" : "block";
    btn.innerHTML = `${expanded ? "▶" : "▼"} 월별 시계열 추이 보기 ${trend.length >= 2 ? `(${trend.length}개월 누적)` : "(데이터 부족)"}`;
    if (!expanded && trend.length >= 2) {
      // 펼쳐졌고 데이터 있으면 차트 렌더 (한 번만)
      renderTrendChart(trend);
    }
  });
}

function renderTrendChart(trend: TrendPoint[]): void {
  const canvas = document.getElementById("diTrendCanvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }
  trendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: trend.map((t) => t.month),
      datasets: [{
        label: "월별 평균 방어율 (%)",
        data: trend.map((t) => t.defenseRate),
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: false, suggestedMin: 50, suggestedMax: 100, ticks: { callback: (v) => `${v}%` } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => {
              const t = trend[ctx.dataIndex];
              return `${t.cohortCount}개 기수`;
            },
          },
        },
      },
    },
  });
}
