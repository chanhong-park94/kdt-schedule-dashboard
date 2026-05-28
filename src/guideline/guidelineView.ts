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
import {
  getSourceOfCategory,
  loadAllNotes,
  loadFavorites,
  loadSourceFilter,
  saveNote,
  saveSourceFilter,
  SOURCE_LABELS,
  toggleFavorite,
  type GuidelineSource,
} from "./guidelineStorage";

// 가상 카테고리 ID — 즐겨찾기 (실제 GuidelineCategory에는 없음)
type ActiveCategory = GuidelineCategory | "favorites";

let viewState: {
  container: HTMLElement | null;
  query: string;
  activeCategory: ActiveCategory;
  expanded: Set<string>;
  favorites: Set<string>;
  notes: Record<string, string>;
  sourceFilter: Record<GuidelineSource, boolean>;
} = {
  container: null,
  query: "",
  activeCategory: GUIDELINE_SECTIONS[0]?.id ?? "overview",
  expanded: new Set(),
  favorites: new Set(),
  notes: {},
  sourceFilter: { manual: true, nbc: true, voc: true },
};

let searchDebounce: number | null = null;
const noteDebounce = new Map<string, number>();

// ─── 데이터 변형 (필터·즐겨찾기) ──────────────────────────

function sectionsByFilter(): GuidelineSection[] {
  return GUIDELINE_SECTIONS.filter((s) => viewState.sourceFilter[getSourceOfCategory(s.id)]);
}

function favoritesAsSection(): GuidelineSection {
  // 즐겨찾기 가상 섹션 — 전 카테고리 가로질러 favorites set의 아이템 수집
  const items: GuidelineItem[] = [];
  for (const section of GUIDELINE_SECTIONS) {
    if (!viewState.sourceFilter[getSourceOfCategory(section.id)]) continue;
    for (const item of section.items) {
      if (viewState.favorites.has(item.id)) items.push(item);
    }
  }
  return {
    id: "favorites" as GuidelineCategory, // 렌더링 ID로만 사용
    title: "내 즐겨찾기",
    icon: "⭐",
    summary:
      items.length > 0
        ? `자주 보는 항목 ${items.length}건`
        : "카드 우상단 ⭐ 아이콘으로 자주 보는 항목을 추가하세요.",
    items,
  };
}

// ─── 카테고리 사이드 ──────────────────────────────────────

function renderCategoryNav(): string {
  const favCount = viewState.favorites.size;
  const favActive = viewState.activeCategory === "favorites" ? " active" : "";
  const favItem = `<li>
    <button type="button" class="guideline-nav-item guideline-nav-favorites${favActive}" data-category="favorites">
      <span class="guideline-nav-icon" aria-hidden="true">⭐</span>
      <span class="guideline-nav-text">내 즐겨찾기</span>
      <span class="guideline-nav-count">${favCount}</span>
    </button>
  </li>
  <li class="guideline-nav-divider" aria-hidden="true"></li>`;

  const filteredSections = sectionsByFilter();
  const items = filteredSections
    .map((section, idx) => {
      const activeClass = viewState.activeCategory === section.id ? " active" : "";
      const count = section.items.length;
      const sourceKey = getSourceOfCategory(section.id);
      return `<li>
        <button type="button" class="guideline-nav-item${activeClass}" data-category="${escapeHtml(section.id)}" data-source="${sourceKey}">
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
    <ul>${favItem}${items}</ul>
  </nav>`;
}

// ─── 카드 ──────────────────────────────────────

function renderItem(item: GuidelineItem, tokens: string[]): string {
  const isExpanded = viewState.expanded.has(item.id);
  const isFav = viewState.favorites.has(item.id);
  const highlightClass =
    item.highlight === "critical" ? " is-critical" : item.highlight === "info" ? " is-info" : "";
  const titleHtml = highlight(item.title, tokens);
  const bodyHtml = highlight(item.body, tokens).replace(/\n/g, "<br/>");
  const tagsHtml = (item.tags ?? [])
    .map((t) => `<span class="guideline-tag">${escapeHtml(t)}</span>`)
    .join("");
  const refsHtml = (item.refs ?? [])
    .map((r) => `<span class="guideline-ref">${escapeHtml(r)}</span>`)
    .join("");
  const noteText = viewState.notes[item.id] ?? "";
  const noteSaved = noteText.trim().length > 0;
  return `<article class="guideline-card${highlightClass}${isExpanded ? " is-expanded" : ""}" data-item-id="${escapeHtml(item.id)}">
    <header class="guideline-card-header">
      <button type="button"
        class="guideline-fav-btn${isFav ? " is-on" : ""}"
        data-fav-toggle="${escapeHtml(item.id)}"
        aria-label="${isFav ? "즐겨찾기 해제" : "즐겨찾기 추가"}"
        title="${isFav ? "즐겨찾기 해제" : "즐겨찾기 추가"}">${isFav ? "★" : "☆"}</button>
      <div class="guideline-card-title-wrap" tabindex="0" role="button" aria-expanded="${isExpanded}" data-card-toggle="${escapeHtml(item.id)}">
        <h4 class="guideline-card-title">${titleHtml}</h4>
        <div class="guideline-card-meta">
          ${refsHtml}
          <span class="guideline-card-chev" aria-hidden="true">${isExpanded ? "▾" : "▸"}</span>
        </div>
      </div>
    </header>
    <div class="guideline-card-body"${isExpanded ? "" : " hidden"}>
      <div class="guideline-card-text">${bodyHtml}</div>
      ${tagsHtml ? `<div class="guideline-card-tags">${tagsHtml}</div>` : ""}
      <div class="guideline-note">
        <label class="guideline-note-label" for="note-${escapeHtml(item.id)}">📝 내 메모</label>
        <textarea
          id="note-${escapeHtml(item.id)}"
          class="guideline-note-area"
          data-note-id="${escapeHtml(item.id)}"
          placeholder="이 항목에 대한 메모를 입력하면 자동으로 저장됩니다 (개인 기기에만 보관)"
          rows="2">${escapeHtml(noteText)}</textarea>
        <span class="guideline-note-saved${noteSaved ? "" : " is-empty"}" data-note-saved="${escapeHtml(item.id)}">
          ${noteSaved ? "✓ 저장됨" : "메모 없음"}
        </span>
      </div>
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

// ─── 헤더 (검색·출처필터·추천) ──────────────────────────────────────

function renderSourceChips(): string {
  return (["manual", "nbc", "voc"] as GuidelineSource[])
    .map((src) => {
      const meta = SOURCE_LABELS[src];
      const isOn = viewState.sourceFilter[src];
      return `<button type="button"
        class="guideline-source-chip${isOn ? " is-on" : ""}"
        data-source-toggle="${src}"
        aria-pressed="${isOn}">
        <span aria-hidden="true">${meta.icon}</span> ${escapeHtml(meta.label)}
      </button>`;
    })
    .join("");
}

function renderHeader(totalMatches: number, query: string): string {
  const countBadge =
    query.trim().length > 0
      ? `<span class="guideline-count-badge">검색 결과 ${totalMatches}건</span>`
      : `<span class="guideline-count-badge guideline-count-muted">현재 카테고리 ${totalMatches}개 항목</span>`;
  const suggestions = GUIDELINE_QUICK_SUGGESTIONS.map(
    (s) =>
      `<button type="button" class="guideline-suggestion" data-suggestion="${escapeHtml(s)}">${escapeHtml(s)}</button>`,
  ).join("");
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
    <div class="guideline-source-row" aria-label="출처 필터">
      <span class="guideline-source-label">출처:</span>
      ${renderSourceChips()}
    </div>
  </header>`;
}

// ─── 메인 렌더 ──────────────────────────────────────

function renderEmpty(message: string, showSuggestions: boolean): string {
  const suggestions = showSuggestions
    ? GUIDELINE_QUICK_SUGGESTIONS.map(
        (s) =>
          `<button type="button" class="guideline-suggestion" data-suggestion="${escapeHtml(s)}">${escapeHtml(s)}</button>`,
      ).join("")
    : "";
  return `<div class="guideline-empty">
    <p class="guideline-empty-title">${escapeHtml(message)}</p>
    ${suggestions ? `<p class="guideline-empty-desc">추천 검색어를 눌러보세요.</p><div class="guideline-empty-suggestions">${suggestions}</div>` : ""}
  </div>`;
}

export function renderGuidelinePage(container: HTMLElement): void {
  viewState.container = container;

  // 최신 storage 동기화
  viewState.favorites = loadFavorites();
  viewState.notes = loadAllNotes();
  viewState.sourceFilter = loadSourceFilter();

  const trimmedQuery = viewState.query.trim();
  const filtered = sectionsByFilter();

  let mainHtml = "";
  let totalForBadge = 0;

  if (trimmedQuery.length > 0) {
    // 검색 모드 — 출처 필터 통과한 전 카테고리에서 검색
    const result = searchGuideline(viewState.query, filtered);
    totalForBadge = result.totalMatches;
    if (result.totalMatches === 0) {
      mainHtml = renderEmpty("관련 지침을 찾지 못했습니다.", true);
    } else {
      mainHtml = result.sections.map((s) => renderSection(s, result.tokens)).join("");
    }
  } else if (viewState.activeCategory === "favorites") {
    // 즐겨찾기 모드
    const favSection = favoritesAsSection();
    totalForBadge = favSection.items.length;
    if (favSection.items.length === 0) {
      mainHtml = renderEmpty(
        "즐겨찾기에 추가된 항목이 없습니다. 각 카드 우상단의 ⭐ 아이콘으로 추가하세요.",
        false,
      );
    } else {
      mainHtml = renderSection(favSection, []);
    }
  } else {
    // 일반 모드 — 활성 카테고리 한 개만 렌더
    let active = filtered.find((s) => s.id === viewState.activeCategory);
    if (!active && filtered.length > 0) {
      // 출처 필터 변경으로 활성 카테고리가 사라진 경우 첫 번째로 fallback
      active = filtered[0];
      viewState.activeCategory = active.id;
    }
    if (!active) {
      mainHtml = renderEmpty("선택한 출처가 모두 꺼져 있습니다. 위의 출처 칩을 활성화하세요.", false);
      totalForBadge = 0;
    } else {
      totalForBadge = active.items.length;
      mainHtml = renderSection(active, []);
    }
  }

  const headerHtml = renderHeader(totalForBadge, viewState.query);
  const navHtml = renderCategoryNav();

  container.innerHTML = `
    ${headerHtml}
    <div class="guideline-body">
      <aside class="guideline-sidebar">${navHtml}</aside>
      <main class="guideline-main">${mainHtml}</main>
    </div>
  `;
  attachHandlers(container);
}

// ─── 이벤트 핸들러 ──────────────────────────────────────

function attachHandlers(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>("#guidelineSearchInput");
  const clearBtn = container.querySelector<HTMLButtonElement>("#guidelineSearchClear");

  // 검색 (debounce)
  input?.addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value;
    viewState.query = value;
    if (searchDebounce !== null) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
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

  // 카테고리 네비
  container.querySelectorAll<HTMLButtonElement>(".guideline-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.category as ActiveCategory | undefined;
      if (!cat) return;
      viewState.activeCategory = cat;
      // 검색 중에 카테고리 클릭 시 검색어 유지 (옵션) — 여기서는 클릭 시 검색어 제거하여 카테고리 뷰로 진입
      viewState.query = "";
      renderGuidelinePage(container);
      // 페이지 상단으로
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // 추천 검색어
  container.querySelectorAll<HTMLButtonElement>(".guideline-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = btn.dataset.suggestion ?? "";
      viewState.query = s;
      renderGuidelinePage(container);
      const newInput = container.querySelector<HTMLInputElement>("#guidelineSearchInput");
      newInput?.focus();
    });
  });

  // 출처 필터 칩
  container.querySelectorAll<HTMLButtonElement>("[data-source-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = btn.dataset.sourceToggle as GuidelineSource | undefined;
      if (!src) return;
      viewState.sourceFilter[src] = !viewState.sourceFilter[src];
      // 모두 OFF는 막지 않음 (UX 안내로 처리)
      saveSourceFilter(viewState.sourceFilter);
      renderGuidelinePage(container);
    });
  });

  // 즐겨찾기 토글
  container.querySelectorAll<HTMLButtonElement>("[data-fav-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.favToggle;
      if (!id) return;
      toggleFavorite(id);
      renderGuidelinePage(container);
    });
  });

  // 카드 펼치기 — 제목 영역 클릭만 (즐겨찾기 버튼 충돌 방지)
  container.querySelectorAll<HTMLElement>("[data-card-toggle]").forEach((el) => {
    const toggle = () => {
      const id = el.dataset.cardToggle;
      if (!id) return;
      if (viewState.expanded.has(id)) viewState.expanded.delete(id);
      else viewState.expanded.add(id);
      renderGuidelinePage(container);
    };
    el.addEventListener("click", toggle);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });

  // 메모 textarea — debounce 500ms 자동저장
  container.querySelectorAll<HTMLTextAreaElement>("[data-note-id]").forEach((ta) => {
    ta.addEventListener("input", () => {
      const id = ta.dataset.noteId;
      if (!id) return;
      if (noteDebounce.has(id)) window.clearTimeout(noteDebounce.get(id)!);
      const handle = window.setTimeout(() => {
        saveNote(id, ta.value);
        viewState.notes = loadAllNotes();
        const saved = container.querySelector<HTMLElement>(`[data-note-saved="${CSS.escape(id)}"]`);
        if (saved) {
          const hasText = ta.value.trim().length > 0;
          saved.textContent = hasText ? "✓ 저장됨" : "메모 없음";
          saved.classList.toggle("is-empty", !hasText);
          // 짧게 살짝 강조
          saved.classList.add("is-flash");
          window.setTimeout(() => saved.classList.remove("is-flash"), 1200);
        }
      }, 500);
      noteDebounce.set(id, handle);
    });
    // 즐겨찾기·카드 토글로의 이벤트 버블 방지
    ta.addEventListener("click", (e) => e.stopPropagation());
    ta.addEventListener("keydown", (e) => e.stopPropagation());
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
  // 해당 카테고리의 출처를 강제로 ON
  const src = getSourceOfCategory(found.section.id);
  if (!viewState.sourceFilter[src]) {
    viewState.sourceFilter[src] = true;
    saveSourceFilter(viewState.sourceFilter);
  }
  viewState.expanded.add(itemId);
  viewState.activeCategory = found.section.id;
  viewState.query = "";
  renderGuidelinePage(container);
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
