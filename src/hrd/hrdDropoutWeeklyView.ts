/**
 * 하차방어율 — 운영 중 기수 주차별 트래커 (DOM 렌더링)
 *
 * 구성:
 *  - 입력 폼 (접이식): 기수·주차·방어율·위험모듈·신호·액션 → addOrUpdateWeeklyEntry
 *  - 신호등 표: 입력값이 1건 이상인 기수만 행으로 표시 (행 클릭 → 차트 갱신)
 *  - 라인차트: 선택된 기수의 주차별 방어율 + 목표선 + 액션 마커
 *  - 액션 카드: 각 기수의 최신 주차 액션/계획
 */

import { Chart, registerables } from "chart.js";
import { escapeHtml } from "../core/escape";
import {
  addOrUpdateWeeklyEntry,
  computeActiveCohortStatuses,
  deleteWeeklyEntry,
  getAllCohortOptions,
  getWeeklySeries,
  parseAlias,
  type CohortMatch,
  type CohortStatus,
  type RiskSignal,
  type SignalLight,
} from "./hrdDropoutWeekly";
import { runSeedIfNeeded, SEED_VERSION } from "./hrdDropoutWeeklySeed";

Chart.register(...registerables);

let chart: Chart | null = null;
let selectedAlias: string | null = null;
/** 최근 자동 시드 결과 — 1회만 안내 표시 후 dismiss */
let pendingSeedToast: { added: number; updated: number } | null = null;

// ─── 진입점 ─────────────────────────────────────────────────

export function renderDropoutWeekly(): void {
  const root = document.getElementById("sectionDropoutWeekly");
  if (!root) return;

  // 첫 렌더 시 (또는 SEED_VERSION 변경 시) 엑셀 데이터 자동 임포트
  const seed = runSeedIfNeeded();
  if (seed.ran) {
    pendingSeedToast = { added: seed.added, updated: seed.updated };
  }

  const statuses = computeActiveCohortStatuses();
  const allOptions = getAllCohortOptions();

  // 선택된 기수가 사라졌으면 첫번째로 폴백
  if (selectedAlias && !statuses.find((s) => s.match.alias === selectedAlias)) {
    selectedAlias = null;
  }
  if (!selectedAlias && statuses.length > 0) {
    selectedAlias = statuses[0].match.alias;
  }

  root.innerHTML = `
    ${renderHeader(statuses.length)}
    ${renderSeedToast()}
    ${renderInputForm(allOptions)}
    ${renderSignalTable(statuses)}
    ${renderChartSection()}
    ${renderActionCards(statuses)}
  `;

  bindFormToggle();
  bindFormSubmit();
  bindRowClick();
  bindDeleteButtons();
  bindSeedToastDismiss();

  if (selectedAlias) renderLineChart(selectedAlias);
}

function renderSeedToast(): string {
  if (!pendingSeedToast) return "";
  const { added, updated } = pendingSeedToast;
  if (added === 0 && updated === 0) return "";
  const parts: string[] = [];
  if (added > 0) parts.push(`신규 <strong>${added}</strong>건`);
  if (updated > 0) parts.push(`기존 <strong>${updated}</strong>건 갱신`);
  return `
    <div class="dw-toast" id="dwSeedToast">
      <span class="dw-toast-icon">📥</span>
      <span class="dw-toast-msg">
        그룹회의 스프레드시트(${escapeHtml(SEED_VERSION)} 스냅샷)에서 ${parts.join(", ")} 자동 임포트 완료.
        위험 모듈/액션 등 직접 입력하신 메타 데이터는 그대로 유지됐습니다.
      </span>
      <button class="dw-toast-close" id="dwSeedToastClose" type="button" aria-label="닫기">✕</button>
    </div>`;
}

function bindSeedToastDismiss(): void {
  const btn = document.getElementById("dwSeedToastClose");
  if (!btn) return;
  btn.addEventListener("click", () => {
    pendingSeedToast = null;
    const el = document.getElementById("dwSeedToast");
    if (el) el.remove();
  });
}

// ─── Sub-render ─────────────────────────────────────────────

function renderHeader(activeCount: number): string {
  return `
    <div class="dw-header">
      <div class="dw-header-title">
        📊 운영 중 기수 주차별 트래커
        <span class="dw-header-sub">(그룹회의 스프레드시트 R9 수기 입력)</span>
      </div>
      <div class="dw-header-meta">
        입력된 기수: <strong>${activeCount}</strong>개
      </div>
    </div>`;
}

function renderInputForm(options: CohortMatch[]): string {
  const optionGroups = groupByCategory(options);
  const groupHtml = Object.entries(optionGroups)
    .map(
      ([cat, list]) => `
      <optgroup label="${escapeHtml(cat)} (목표 ${list[0]?.target ?? "-"}%)">
        ${list
          .map(
            (o) =>
              `<option value="${escapeHtml(o.alias)}">${escapeHtml(o.alias)} — ${escapeHtml(o.courseName)} ${escapeHtml(o.degr)}기</option>`,
          )
          .join("")}
      </optgroup>`,
    )
    .join("");

  return `
    <div class="dw-form-wrap">
      <button type="button" class="dw-form-toggle" id="dwFormToggleBtn" aria-expanded="false">
        ▶ 주차 데이터 입력 / 수정
      </button>
      <form class="dw-form" id="dwForm" style="display:none">
        <div class="dw-form-row">
          <label class="dw-field">
            <span class="dw-field-label">기수 *</span>
            <select name="alias" required class="dw-input">
              <option value="">선택…</option>
              ${groupHtml}
            </select>
          </label>
          <label class="dw-field dw-field-small">
            <span class="dw-field-label">주차 *</span>
            <input name="weekNum" type="number" min="1" max="30" required class="dw-input" placeholder="1~26" />
          </label>
          <label class="dw-field dw-field-small">
            <span class="dw-field-label">하차방어율 (%) *</span>
            <input name="defenseRate" type="number" min="0" max="100" step="0.01" required class="dw-input" placeholder="예: 70.97" />
          </label>
        </div>
        <div class="dw-form-row">
          <label class="dw-field dw-field-small">
            <span class="dw-field-label">위험 모듈</span>
            <input name="riskModule" type="text" class="dw-input" placeholder="예: 모듈5" />
          </label>
          <label class="dw-field dw-field-small">
            <span class="dw-field-label">위험 신호</span>
            <select name="riskSignal" class="dw-input">
              <option value="">-</option>
              <option value="출결">출결</option>
              <option value="성취도">성취도</option>
              <option value="만족도">만족도</option>
              <option value="복합">복합</option>
            </select>
          </label>
          <label class="dw-field">
            <span class="dw-field-label">이번 주 액션</span>
            <input name="actionTaken" type="text" class="dw-input" placeholder="예: 모듈5 강사 1:1 피드백" />
          </label>
        </div>
        <div class="dw-form-row">
          <label class="dw-field dw-field-wide">
            <span class="dw-field-label">다음 주 계획</span>
            <input name="actionPlanned" type="text" class="dw-input" placeholder="예: 위험군 5명 1:1 인터뷰" />
          </label>
          <label class="dw-field dw-field-wide">
            <span class="dw-field-label">메모</span>
            <input name="note" type="text" class="dw-input" placeholder="자유 메모" />
          </label>
        </div>
        <div class="dw-form-actions">
          <button type="submit" class="dw-btn dw-btn-primary">저장</button>
          <span class="dw-form-hint">같은 기수·주차에 다시 입력하면 덮어씁니다.</span>
        </div>
      </form>
    </div>`;
}

function renderSignalTable(statuses: CohortStatus[]): string {
  if (statuses.length === 0) {
    return `
      <div class="dw-empty">
        <div class="dw-empty-icon">📥</div>
        <div class="dw-empty-title">입력된 주차 데이터가 없습니다</div>
        <div class="dw-empty-desc">위 <strong>주차 데이터 입력</strong>을 펼쳐 스프레드시트 R9 값을 입력하면, 신호등 / 추세 / 차트가 자동 생성됩니다.</div>
      </div>`;
  }

  const rows = statuses
    .map((s) => renderSignalRow(s))
    .join("");

  return `
    <div class="dw-table-wrap">
      <table class="dw-table">
        <thead>
          <tr>
            <th>신호</th>
            <th>기수</th>
            <th>최근 주차</th>
            <th>현재율 / 목표</th>
            <th>Δ 직전</th>
            <th>위험 모듈</th>
            <th>이번 주 액션</th>
            <th>입력 수</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="dw-table-hint">행을 클릭하면 아래 차트에 해당 기수의 추이가 표시됩니다.</div>
    </div>`;
}

function renderSignalRow(s: CohortStatus): string {
  const isSelected = s.match.alias === selectedAlias;
  const dotClass = `dw-dot dw-dot-${s.signal}`;
  const latest = s.latest;
  const rate = latest ? `${latest.defenseRate.toFixed(2)}%` : "-";
  const target = `${s.match.target}%`;
  const rateClass = latest && latest.defenseRate < s.match.target ? "dw-rate-below" : "";
  const deltaStr = s.delta3w === null ? "-" : `${s.delta3w > 0 ? "+" : ""}${s.delta3w}pp`;
  const deltaClass = s.delta3w === null ? "" : s.delta3w < 0 ? "dw-delta-down" : s.delta3w > 0 ? "dw-delta-up" : "";

  return `
    <tr class="dw-row ${isSelected ? "dw-row-selected" : ""}" data-alias="${escapeHtml(s.match.alias)}">
      <td><span class="${dotClass}" title="${labelForSignal(s.signal)}"></span></td>
      <td>
        <div class="dw-cell-alias">${escapeHtml(s.match.alias)}</div>
        <div class="dw-cell-course">${escapeHtml(s.match.courseName)} ${escapeHtml(s.match.degr)}기</div>
      </td>
      <td>${latest ? `${latest.weekNum}주` : "-"}</td>
      <td class="${rateClass}"><strong>${rate}</strong> <span class="dw-target">/ ${target}</span></td>
      <td class="${deltaClass}">${deltaStr}</td>
      <td>${escapeHtml(latest?.riskModule || "-")}</td>
      <td>${escapeHtml(latest?.actionTaken || "-")}</td>
      <td>${s.entryCount}건</td>
    </tr>`;
}

function renderChartSection(): string {
  if (!selectedAlias) {
    return `
      <div class="dw-chart-wrap">
        <div class="dw-chart-empty">기수를 선택하면 주차별 추이가 표시됩니다.</div>
      </div>`;
  }
  return `
    <div class="dw-chart-wrap">
      <div class="dw-chart-title">
        📈 <strong>${escapeHtml(selectedAlias)}</strong> 주차별 하차방어율 추이
      </div>
      <div class="dw-chart-canvas"><canvas id="dwChartCanvas"></canvas></div>
      <div class="dw-chart-legend">
        <span class="dw-legend-item"><span class="dw-legend-line"></span> 방어율(%)</span>
        <span class="dw-legend-item"><span class="dw-legend-target"></span> 목표선</span>
        <span class="dw-legend-item">📌 액션 입력 주차</span>
      </div>
      ${renderActionTimeline(selectedAlias)}
    </div>`;
}

function renderActionTimeline(alias: string): string {
  const series = getWeeklySeries(alias);
  const withActions = series.filter((e) => e.actionTaken || e.actionPlanned || e.riskModule);
  if (withActions.length === 0) return "";
  const items = withActions
    .map((e) => {
      const tags = [
        e.riskModule ? `<span class="dw-tag dw-tag-module">${escapeHtml(e.riskModule)}</span>` : "",
        e.riskSignal ? `<span class="dw-tag dw-tag-signal">${escapeHtml(e.riskSignal)}</span>` : "",
      ].join("");
      const action = e.actionTaken
        ? `<div class="dw-tl-action"><strong>이번주:</strong> ${escapeHtml(e.actionTaken)}</div>`
        : "";
      const plan = e.actionPlanned
        ? `<div class="dw-tl-plan"><strong>다음주:</strong> ${escapeHtml(e.actionPlanned)}</div>`
        : "";
      return `
        <li class="dw-tl-item">
          <div class="dw-tl-head">
            <span class="dw-tl-week">${e.weekNum}주</span>
            <span class="dw-tl-rate">${e.defenseRate.toFixed(2)}%</span>
            ${tags}
            <button class="dw-tl-del" data-id="${escapeHtml(e.id)}" title="이 입력값 삭제" type="button">✕</button>
          </div>
          ${action}${plan}
          ${e.note ? `<div class="dw-tl-note">📝 ${escapeHtml(e.note)}</div>` : ""}
        </li>`;
    })
    .join("");
  return `<ul class="dw-timeline">${items}</ul>`;
}

function renderActionCards(statuses: CohortStatus[]): string {
  const withLatest = statuses.filter((s) => s.latest && (s.latest.actionTaken || s.latest.actionPlanned));
  if (withLatest.length === 0) return "";

  const cards = withLatest
    .map((s) => {
      const l = s.latest!;
      const dotClass = `dw-dot dw-dot-${s.signal}`;
      return `
        <div class="dw-action-card">
          <div class="dw-action-head">
            <span class="${dotClass}"></span>
            <span class="dw-action-alias">${escapeHtml(s.match.alias)}</span>
            <span class="dw-action-week">${l.weekNum}주차</span>
            <span class="dw-action-rate">${l.defenseRate.toFixed(2)}%</span>
          </div>
          ${l.actionTaken ? `<div class="dw-action-line"><span class="dw-action-tag-done">이번주</span> ${escapeHtml(l.actionTaken)}</div>` : ""}
          ${l.actionPlanned ? `<div class="dw-action-line"><span class="dw-action-tag-plan">다음주</span> ${escapeHtml(l.actionPlanned)}</div>` : ""}
        </div>`;
    })
    .join("");

  return `
    <div class="dw-actions-wrap">
      <div class="dw-actions-title">📋 이번 주 액션 & 다음 주 계획</div>
      <div class="dw-actions-grid">${cards}</div>
    </div>`;
}

// ─── Chart.js 렌더 ──────────────────────────────────────────

function renderLineChart(alias: string): void {
  const canvas = document.getElementById("dwChartCanvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  if (chart) {
    chart.destroy();
    chart = null;
  }

  const series = getWeeklySeries(alias);
  if (series.length === 0) return;
  const match = parseAlias(alias);
  const target = match?.target ?? 80;

  // x축 라벨: 1주 ~ 최대 주차 (입력 누락 주차도 비워두기 위해)
  const maxWeek = series[series.length - 1].weekNum;
  const labels = Array.from({ length: maxWeek }, (_, i) => `${i + 1}주`);
  const rateData: (number | null)[] = labels.map(() => null);
  const actionPoints: number[] = []; // x index 위치
  for (const e of series) {
    const idx = e.weekNum - 1;
    if (idx >= 0 && idx < rateData.length) {
      rateData[idx] = e.defenseRate;
      if (e.actionTaken) actionPoints.push(idx);
    }
  }

  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "하차방어율 (%)",
          data: rateData,
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.12)",
          fill: true,
          tension: 0.25,
          spanGaps: true,
          pointRadius: rateData.map((_, i) => (actionPoints.includes(i) ? 7 : 4)),
          pointBackgroundColor: rateData.map((_, i) =>
            actionPoints.includes(i) ? "#f97316" : "#6366f1",
          ),
          pointBorderColor: rateData.map((_, i) =>
            actionPoints.includes(i) ? "#c2410c" : "#4338ca",
          ),
          pointBorderWidth: 2,
        },
        {
          label: `목표 ${target}%`,
          data: labels.map(() => target),
          borderColor: "#16a34a",
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          beginAtZero: false,
          suggestedMin: 40,
          suggestedMax: 100,
          ticks: { callback: (v) => `${v}%` },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => {
              if (ctx.datasetIndex !== 0) return "";
              const e = series.find((s) => s.weekNum === ctx.dataIndex + 1);
              if (!e) return "";
              const parts: string[] = [];
              if (e.riskModule) parts.push(`위험 모듈: ${e.riskModule}`);
              if (e.actionTaken) parts.push(`액션: ${e.actionTaken}`);
              return parts.length > 0 ? parts.join("\n") : "";
            },
          },
        },
      },
    },
  });
}

// ─── 이벤트 ─────────────────────────────────────────────────

function bindFormToggle(): void {
  const btn = document.getElementById("dwFormToggleBtn");
  const form = document.getElementById("dwForm");
  if (!btn || !form) return;
  btn.addEventListener("click", () => {
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    form.style.display = expanded ? "none" : "block";
    btn.innerHTML = `${expanded ? "▶" : "▼"} 주차 데이터 입력 / 수정`;
  });
}

function bindFormSubmit(): void {
  const form = document.getElementById("dwForm") as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const alias = String(data.get("alias") || "").trim();
    const weekNum = Number(data.get("weekNum"));
    const defenseRate = Number(data.get("defenseRate"));
    if (!alias) {
      alert("기수를 선택해주세요.");
      return;
    }
    if (!Number.isFinite(weekNum) || weekNum < 1 || weekNum > 30) {
      alert("주차는 1~30 사이의 숫자로 입력해주세요.");
      return;
    }
    if (!Number.isFinite(defenseRate) || defenseRate < 0 || defenseRate > 100) {
      alert("하차방어율은 0~100 사이의 숫자로 입력해주세요.");
      return;
    }
    const match = parseAlias(alias);
    if (!match) {
      alert(`매칭되지 않는 기수 코드입니다: ${alias}`);
      return;
    }
    addOrUpdateWeeklyEntry({
      alias,
      trainPrId: match.trainPrId,
      degr: match.degr,
      weekNum,
      defenseRate,
      riskModule: String(data.get("riskModule") || "").trim(),
      riskSignal: (String(data.get("riskSignal") || "") as RiskSignal) || "",
      actionTaken: String(data.get("actionTaken") || "").trim(),
      actionPlanned: String(data.get("actionPlanned") || "").trim(),
      note: String(data.get("note") || "").trim(),
    });
    selectedAlias = alias; // 방금 입력한 기수 자동 선택
    renderDropoutWeekly();
  });
}

function bindRowClick(): void {
  const rows = document.querySelectorAll<HTMLElement>(".dw-row");
  rows.forEach((row) => {
    row.addEventListener("click", () => {
      const alias = row.dataset.alias;
      if (!alias) return;
      selectedAlias = alias;
      renderDropoutWeekly();
    });
  });
}

function bindDeleteButtons(): void {
  const btns = document.querySelectorAll<HTMLElement>(".dw-tl-del");
  btns.forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      if (!confirm("이 주차 입력값을 삭제하시겠습니까?")) return;
      deleteWeeklyEntry(id);
      renderDropoutWeekly();
    });
  });
}

// ─── 헬퍼 ───────────────────────────────────────────────────

function groupByCategory(options: CohortMatch[]): Record<string, CohortMatch[]> {
  const groups: Record<string, CohortMatch[]> = {};
  for (const o of options) {
    if (!groups[o.category]) groups[o.category] = [];
    groups[o.category].push(o);
  }
  return groups;
}

function labelForSignal(s: SignalLight): string {
  switch (s) {
    case "green": return "양호 (목표 +5pp 이상)";
    case "yellow": return "경계 (목표 근접 또는 약한 하락)";
    case "red": return "위험 (목표 미달 또는 -5pp 이상 급락)";
    case "gray": return "데이터 없음";
  }
}

/** 외부에서 강제 재렌더 — 데이터 마이그레이션 후 호출 등 */
export function refreshDropoutWeekly(): void {
  renderDropoutWeekly();
}
