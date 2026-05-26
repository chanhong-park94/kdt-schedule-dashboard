import { escapeHtml } from "../core/escape";
import {
  GUIDELINE_META,
  GUIDELINE_QUICK_SUGGESTIONS,
  GUIDELINE_SECTIONS,
  type GuidelineCategory,
  type GuidelineItem,
  type GuidelineSection,
} from "./guidelineData";
import { findItemById, highlight, searchGuideline } from "./guidelineSearch";

let viewState: {
  container: HTMLElement | null;
  query: string;
  activeCategory: GuidelineCategory | null;
  expanded: Set<string>;
} = {
  container: null,
  query: "",
  activeCategory: null,
  expanded: new Set(),
};

let debounceTimer: number | null = null;

function renderCategoryNav(sections: GuidelineSection[]): string {
  const items = sections
    .map((section, idx) => {
      const activeClass = viewState.activeCategory === section.id ? " active" : "";
      const count = section.items.length;
      return `<li>
        <button type="button" class="guideline-nav-item${activeClass}" data-category="${escapeHtml(section.id)}">
          <span class="guideline-nav-icon" aria-hidden="true">${escapeHtml(section.icon)}</span>
          <span class="guideline-nav-text">
            <span class="guideline-nav-num">${idx + 1}.</span>
            ${escapeHtml(section.title)}
          </span>
          <span class="guideline-nav-count">${count}</span>
        </button>
      </li>`;
    })
    .join("");
  return `<nav class="guideline-nav" aria-label="운영지침 카테고리">
    <ul>${items}</ul>
  </nav>`;
}

function renderItem(item: GuidelineItem, tokens: string[]): string {
  const isExpanded = viewState.expanded.has(item.id);
  const highlightClass = item.highlight === "critical" ? " is-critical" : item.highlight === "info" ? " is-info" : "";
  const titleHtml = highlight(item.title, tokens);
  const bodyHtml = highlight(item.body, tokens).replace(/\n/g, "<br/>");
  const tagsHtml = (item.tags ?? [])
    .map((t) => `<span class="guideline-tag">${escapeHtml(t)}</span>`)
    .join("");
  const refsHtml = (item.refs ?? [])
    .map((r) => `<span class="guideline-ref">${escapeHtml(r)}</span>`)
    .join("");
  return `<article class="guideline-card${highlightClass}${isExpanded ? " is-expanded" : ""}" data-item-id="${escapeHtml(item.id)}">
    <header class="guideline-card-header" tabindex="0" role="button" aria-expanded="${isExpanded}">
      <h4 class="guideline-card-title">${titleHtml}</h4>
      <div class="guideline-card-meta">
        ${refsHtml}
        <span class="guideline-card-chev" aria-hidden="true">${isExpanded ? "▾" : "▸"}</span>
      </div>
    </header>
    <div class="guideline-card-body"${isExpanded ? "" : " hidden"}>
      <div class="guideline-card-text">${bodyHtml}</div>
      ${tagsHtml ? `<div class="guideline-card-tags">${tagsHtml}</div>` : ""}
    </div>
  </article>`;
}

function renderSection(section: GuidelineSection, tokens: string[]): string {
  const itemsHtml = section.items.map((it) => renderItem(it, tokens)).join("");
  return `<section class="guideline-section" id="guideline-section-${escapeHtml(section.id)}" data-category="${escapeHtml(section.id)}">
    <header class="guideline-section-header">
      <h3>
        <span class="guideline-section-icon" aria-hidden="true">${escapeHtml(section.icon)}</span>
        ${escapeHtml(section.title)}
      </h3>
      ${section.summary ? `<p class="guideline-section-summary">${escapeHtml(section.summary)}</p>` : ""}
    </header>
    <div class="guideline-section-items">${itemsHtml}</div>
  </section>`;
}

function renderEmpty(): string {
  const suggestions = GUIDELINE_QUICK_SUGGESTIONS
    .map(
      (s) =>
        `<button type="button" class="guideline-suggestion" data-suggestion="${escapeHtml(s)}">${escapeHtml(s)}</button>`,
    )
    .join("");
  return `<div class="guideline-empty">
    <p class="guideline-empty-title">관련 지침을 찾지 못했습니다.</p>
    <p class="guideline-empty-desc">추천 검색어를 눌러보세요.</p>
    <div class="guideline-empty-suggestions">${suggestions}</div>
  </div>`;
}

function renderHeader(totalMatches: number, query: string): string {
  const countBadge =
    query.trim().length > 0
      ? `<span class="guideline-count-badge">검색 결과 ${totalMatches}건</span>`
      : `<span class="guideline-count-badge guideline-count-muted">총 ${totalMatches}개 항목</span>`;
  const suggestions = GUIDELINE_QUICK_SUGGESTIONS
    .map(
      (s) =>
        `<button type="button" class="guideline-suggestion" data-suggestion="${escapeHtml(s)}">${escapeHtml(s)}</button>`,
    )
    .join("");
  return `<header class="guideline-page-header">
    <div class="guideline-title-row">
      <div>
        <h2 class="guideline-page-title">📋 ${escapeHtml(GUIDELINE_META.title)}</h2>
        <p class="guideline-page-subtitle">시행일 ${escapeHtml(GUIDELINE_META.effectiveDate)} · 출처 ${escapeHtml(GUIDELINE_META.source)} · ${GUIDELINE_META.totalPages}p</p>
      </div>
    </div>
    <div class="guideline-search-row">
      <div class="guideline-search-input-wrap">
        <span class="guideline-search-icon" aria-hidden="true">🔍</span>
        <input
          type="search"
          id="guidelineSearchInput"
          class="guideline-search-input"
          placeholder="검색어 입력 (예: 출석률, 재해보험, 제적, 자부담)"
          value="${escapeHtml(query)}"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="button" class="guideline-search-clear" id="guidelineSearchClear" aria-label="검색어 지우기" ${query ? "" : "hidden"}>✕</button>
      </div>
      ${countBadge}
    </div>
    <div class="guideline-quick-suggestions" aria-label="빠른 검색어">
      <span class="guideline-quick-label">빠른 검색:</span>
      ${suggestions}
    </div>
  </header>`;
}

export function renderGuidelinePage(container: HTMLElement): void {
  viewState.container = container;
  const result = searchGuideline(viewState.query, GUIDELINE_SECTIONS);
  const headerHtml = renderHeader(result.totalMatches, viewState.query);
  const navHtml = renderCategoryNav(GUIDELINE_SECTIONS);
  let mainHtml = "";
  if (result.totalMatches === 0) {
    mainHtml = renderEmpty();
  } else {
    mainHtml = result.sections.map((s) => renderSection(s, result.tokens)).join("");
  }
  container.innerHTML = `
    ${headerHtml}
    <div class="guideline-body">
      <aside class="guideline-sidebar">${navHtml}</aside>
      <main class="guideline-main">${mainHtml}</main>
    </div>
  `;
  attachHandlers(container);
}

function attachHandlers(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>("#guidelineSearchInput");
  const clearBtn = container.querySelector<HTMLButtonElement>("#guidelineSearchClear");

  input?.addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value;
    viewState.query = value;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const caretPos = input.selectionStart;
      renderGuidelinePage(container);
      const newInput = container.querySelector<HTMLInputElement>("#guidelineSearchInput");
      if (newInput) {
        newInput.focus();
        if (caretPos !== null) newInput.setSelectionRange(caretPos, caretPos);
      }
    }, 200);
  });

  clearBtn?.addEventListener("click", () => {
    viewState.query = "";
    renderGuidelinePage(container);
    container.querySelector<HTMLInputElement>("#guidelineSearchInput")?.focus();
  });

  // 카테고리 네비 클릭 → 해당 섹션 스크롤
  container.querySelectorAll<HTMLButtonElement>(".guideline-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.category as GuidelineCategory | undefined;
      if (!cat) return;
      viewState.activeCategory = cat;
      const target = container.querySelector(`#guideline-section-${cat}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      container.querySelectorAll(".guideline-nav-item").forEach((n) => n.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // 추천 검색어 클릭
  container.querySelectorAll<HTMLButtonElement>(".guideline-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = btn.dataset.suggestion ?? "";
      viewState.query = s;
      renderGuidelinePage(container);
      const newInput = container.querySelector<HTMLInputElement>("#guidelineSearchInput");
      newInput?.focus();
    });
  });

  // 카드 펼치기/접기
  container.querySelectorAll<HTMLElement>(".guideline-card").forEach((card) => {
    const header = card.querySelector<HTMLElement>(".guideline-card-header");
    if (!header) return;
    const toggle = () => {
      const id = card.dataset.itemId;
      if (!id) return;
      if (viewState.expanded.has(id)) viewState.expanded.delete(id);
      else viewState.expanded.add(id);
      renderGuidelinePage(container);
    };
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
}

/**
 * 외부(단축키 모달 등)에서 특정 항목으로 점프할 때 호출
 */
export function focusGuidelineItem(itemId: string): void {
  const container = viewState.container;
  if (!container) return;
  const found = findItemById(GUIDELINE_SECTIONS, itemId);
  if (!found) return;
  viewState.expanded.add(itemId);
  viewState.activeCategory = found.section.id;
  viewState.query = "";
  renderGuidelinePage(container);
  // DOM 갱신 후 스크롤
  window.requestAnimationFrame(() => {
    const target = container.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      (target as HTMLElement).classList.add("is-focused");
      window.setTimeout(() => (target as HTMLElement).classList.remove("is-focused"), 2000);
    }
  });
}

export function getGuidelineSections(): GuidelineSection[] {
  return GUIDELINE_SECTIONS;
}
