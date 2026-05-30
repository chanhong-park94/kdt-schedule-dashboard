/**
 * 디스코드 강의질의응답 sub-tab — 수집·분류·분석 UI
 */
import { escapeHtml } from "../core/escape";
import { formatCacheAge } from "./hrdCacheUtils";
import {
  fetchDiscordMessages,
  getDiscordCacheTimestamp,
  isDiscordConfigured,
  loadDiscordCache,
  loadDiscordConfig,
} from "./hrdDiscord";
import { computeStats, deriveFaq, enrichMessages } from "./hrdDiscordClassify";
import {
  CATEGORY_TO_GUIDELINE,
  DISCORD_CATEGORY_COLORS,
  type DiscordConfig,
  type DiscordMessage,
} from "./hrdDiscordTypes";

const $ = (id: string) => document.getElementById(id);

// 카테고리 → 운영지침 대표 항목 id (해당 섹션 첫 카드)
const CATEGORY_GUIDELINE_ITEM: Record<string, string> = {
  attendance: "attendance.basic",
  trainee: "trainee.autonomous",
  regulationNbc: "regNbc.scope",
  reporting: "reporting.result",
  payment: "payment.monthly",
  execution: "execution.notify",
};

let viewState: {
  container: HTMLElement | null;
  messages: DiscordMessage[];
  filterCohort: string;
  filterCategory: string;
  unansweredOnly: boolean;
} = {
  container: null,
  messages: [],
  filterCohort: "",
  filterCategory: "",
  unansweredOnly: false,
};

function setStatus(msg: string, type: "success" | "error" | "loading" = "loading"): void {
  const el = $("discordStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `ana-status ${type}`;
}

// ─── 렌더 ───────────────────────────────────────────────────
export function renderDiscordPage(container: HTMLElement): void {
  viewState.container = container;
  const config = loadDiscordConfig();

  if (!isDiscordConfigured(config)) {
    container.innerHTML = renderNotConfigured();
    return;
  }

  // 캐시된 원본 → enrich
  const cached = loadDiscordCache();
  if (cached) {
    viewState.messages = enrichMessages(cached, config);
  }

  container.innerHTML = renderShell(config);
  bindHandlers(container, config);
  renderBody();
}

function renderNotConfigured(): string {
  return `<div class="discord-empty">
    <p class="discord-empty-title">🎮 디스코드 연동이 설정되지 않았습니다.</p>
    <p class="discord-empty-desc">설정 → API 연동 → 디스코드에서 GAS URL·채널·운영자 ID를 등록하세요.</p>
    <p class="discord-empty-desc">배포 가이드: <code>docs/apps-script/discord-proxy.gs</code></p>
  </div>`;
}

function renderShell(config: DiscordConfig): string {
  const ts = getDiscordCacheTimestamp();
  const age = ts ? formatCacheAge(ts) : "동기화 이력 없음";
  return `
    <header class="discord-header">
      <div>
        <h3 class="discord-title">🎮 디스코드 강의질의응답</h3>
        <p class="discord-subtitle">채널 ${config.channels.length}개 · ${age}</p>
      </div>
      <button type="button" class="discord-sync-btn" id="discordSyncBtn">🔄 메시지 동기화</button>
    </header>
    <div id="discordStatus" class="ana-status"></div>
    <div id="discordBody"></div>
  `;
}

function renderBody(): void {
  const body = $("discordBody");
  if (!body) return;

  if (viewState.messages.length === 0) {
    body.innerHTML = `<p class="discord-empty-desc">표시할 메시지가 없습니다. '메시지 동기화'를 눌러 가져오세요.</p>`;
    return;
  }

  const stats = computeStats(viewState.messages);
  const faq = deriveFaq(viewState.messages, 5);
  const filtered = applyFilters(viewState.messages);

  body.innerHTML = `
    ${renderStatCards(stats)}
    ${renderCategoryChart(stats)}
    ${renderFaq(faq)}
    ${renderFilters(stats)}
    ${renderTable(filtered)}
  `;
  bindBodyHandlers();
}

function renderStatCards(stats: ReturnType<typeof computeStats>): string {
  const answerRate = stats.학생질문 > 0 ? Math.round((stats.응답완료 / stats.학생질문) * 100) : 0;
  return `<div class="discord-stat-row">
    <div class="discord-stat-card"><div class="discord-stat-label">총 메시지</div><div class="discord-stat-value">${stats.총메시지}</div></div>
    <div class="discord-stat-card"><div class="discord-stat-label">학생 질문</div><div class="discord-stat-value">${stats.학생질문}</div></div>
    <div class="discord-stat-card ${stats.미응답 > 0 ? "is-warn" : ""}"><div class="discord-stat-label">미응답</div><div class="discord-stat-value">${stats.미응답}</div></div>
    <div class="discord-stat-card"><div class="discord-stat-label">응답률 · 최다</div><div class="discord-stat-value">${answerRate}% · ${escapeHtml(stats.최다카테고리)}</div></div>
  </div>`;
}

function renderCategoryChart(stats: ReturnType<typeof computeStats>): string {
  const entries = Object.entries(stats.카테고리별).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  const max = Math.max(...entries.map((e) => e[1]), 1);
  const bars = entries
    .map(([cat, n]) => {
      const pct = Math.round((n / max) * 100);
      const color = DISCORD_CATEGORY_COLORS[cat] ?? DISCORD_CATEGORY_COLORS["기타"];
      const guidelineCat = CATEGORY_TO_GUIDELINE[cat];
      const link = guidelineCat
        ? `<button type="button" class="discord-guide-link" data-guideline="${escapeHtml(guidelineCat)}">📖 가이드</button>`
        : "";
      return `<div class="discord-bar-row">
        <span class="discord-bar-label" style="${color}">${escapeHtml(cat)}</span>
        <span class="discord-bar-track"><span class="discord-bar-fill" style="width:${pct}%"></span></span>
        <span class="discord-bar-count">${n}</span>
        ${link}
      </div>`;
    })
    .join("");
  return `<section class="discord-section">
    <h4 class="discord-section-title">📊 카테고리 분포 (학생 질문 기준)</h4>
    <div class="discord-bars">${bars}</div>
  </section>`;
}

function renderFaq(faq: ReturnType<typeof deriveFaq>): string {
  if (faq.length === 0) return "";
  const items = faq
    .map((f) => {
      const guidelineCat = CATEGORY_TO_GUIDELINE[f.category];
      const link = guidelineCat
        ? `<button type="button" class="discord-guide-link" data-guideline="${escapeHtml(guidelineCat)}">📖 운영지침</button>`
        : "";
      const samples = f.samples.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
      return `<div class="discord-faq-item">
        <div class="discord-faq-head">
          <span class="discord-faq-cat" style="${DISCORD_CATEGORY_COLORS[f.category] ?? ""}">${escapeHtml(f.category)}</span>
          <span class="discord-faq-count">${f.count}건</span>
          ${link}
        </div>
        <ul class="discord-faq-samples">${samples}</ul>
      </div>`;
    })
    .join("");
  return `<section class="discord-section">
    <h4 class="discord-section-title">❓ 자주 묻는 문의 Top ${faq.length}</h4>
    <div class="discord-faq-list">${items}</div>
  </section>`;
}

function renderFilters(stats: ReturnType<typeof computeStats>): string {
  const cohorts = Object.keys(stats.기수별);
  const cats = Object.keys(stats.카테고리별);
  const cohortOpts = ['<option value="">전체 기수</option>']
    .concat(cohorts.map((c) => `<option value="${escapeHtml(c)}"${viewState.filterCohort === c ? " selected" : ""}>${escapeHtml(c)}</option>`))
    .join("");
  const catOpts = ['<option value="">전체 카테고리</option>']
    .concat(cats.map((c) => `<option value="${escapeHtml(c)}"${viewState.filterCategory === c ? " selected" : ""}>${escapeHtml(c)}</option>`))
    .join("");
  return `<div class="discord-filter-row">
    <select id="discordFilterCohort" class="hrd-input">${cohortOpts}</select>
    <select id="discordFilterCategory" class="hrd-input">${catOpts}</select>
    <label class="discord-check"><input type="checkbox" id="discordUnanswered" ${viewState.unansweredOnly ? "checked" : ""}/> 미응답만</label>
  </div>`;
}

function renderTable(rows: DiscordMessage[]): string {
  if (rows.length === 0) {
    return `<p class="discord-empty-desc">필터 조건에 해당하는 메시지가 없습니다.</p>`;
  }
  const body = rows
    .slice(0, 300)
    .map((m) => {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
      const catColor = DISCORD_CATEGORY_COLORS[m.category] ?? DISCORD_CATEGORY_COLORS["기타"];
      const qBadge = m.isStaff ? '<span class="discord-tag staff">운영자</span>' : m.isQuestion ? '<span class="discord-tag q">질문</span>' : '<span class="discord-tag">일반</span>';
      const ansBadge = m.isQuestion ? (m.answered ? '<span class="discord-tag ans">응답</span>' : '<span class="discord-tag noans">미응답</span>') : "-";
      return `<tr>
        <td class="discord-td-time">${escapeHtml(time)}</td>
        <td>${escapeHtml(m.cohortLabel)}</td>
        <td>${escapeHtml(m.authorName)}</td>
        <td class="discord-td-content">${escapeHtml(m.content.slice(0, 140))}</td>
        <td><span class="discord-tag" style="${catColor}">${escapeHtml(m.category)}</span></td>
        <td>${qBadge}</td>
        <td>${ansBadge}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-responsive discord-table-wrap">
    <table class="table discord-table">
      <thead><tr><th>시각</th><th>기수</th><th>작성자</th><th>내용</th><th>카테고리</th><th>구분</th><th>응답</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function applyFilters(messages: DiscordMessage[]): DiscordMessage[] {
  return messages.filter((m) => {
    if (viewState.filterCohort && m.cohortLabel !== viewState.filterCohort) return false;
    if (viewState.filterCategory && m.category !== viewState.filterCategory) return false;
    if (viewState.unansweredOnly && !(m.isQuestion && !m.answered)) return false;
    return true;
  });
}

// ─── 이벤트 ─────────────────────────────────────────────────
function bindHandlers(container: HTMLElement, config: DiscordConfig): void {
  $("discordSyncBtn")?.addEventListener("click", async () => {
    const btn = $("discordSyncBtn") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    setStatus("디스코드 메시지 동기화 중...", "loading");
    try {
      const raws = await fetchDiscordMessages(config);
      viewState.messages = enrichMessages(raws, config);
      setStatus(`✓ ${raws.length}건 동기화 완료`, "success");
      // 헤더의 동기화 시점 갱신 위해 전체 재렌더
      renderDiscordPage(container);
    } catch (e) {
      setStatus(`동기화 실패: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function bindBodyHandlers(): void {
  $("discordFilterCohort")?.addEventListener("change", (e) => {
    viewState.filterCohort = (e.target as HTMLSelectElement).value;
    renderBody();
  });
  $("discordFilterCategory")?.addEventListener("change", (e) => {
    viewState.filterCategory = (e.target as HTMLSelectElement).value;
    renderBody();
  });
  $("discordUnanswered")?.addEventListener("change", (e) => {
    viewState.unansweredOnly = (e.target as HTMLInputElement).checked;
    renderBody();
  });
  // 운영지침 가이드 점프
  viewState.container?.querySelectorAll<HTMLButtonElement>("[data-guideline]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const guidelineCat = btn.dataset.guideline;
      if (!guidelineCat) return;
      void jumpToGuideline(guidelineCat);
    });
  });
}

async function jumpToGuideline(guidelineCat: string): Promise<void> {
  const itemId = CATEGORY_GUIDELINE_ITEM[guidelineCat];
  if (!itemId) return;
  try {
    const [{ activatePrimarySidebarPage }, { initGuideline, focusGuidelineItem }] = await Promise.all([
      import("../ui/features/navigation"),
      import("../guideline/guidelineInit"),
    ]);
    activatePrimarySidebarPage("guideline");
    await initGuideline();
    focusGuidelineItem(itemId);
  } catch (e) {
    console.warn("[discord] guideline jump failed", e);
  }
}
