import { escapeHtml } from "../core/escape";
import {
  GUIDELINE_QUICK_SUGGESTIONS,
  GUIDELINE_SECTIONS,
  type GuidelineItem,
  type GuidelineSection,
} from "./guidelineData";
import { highlight, searchGuideline } from "./guidelineSearch";

const MODAL_ID = "guidelineQuickSearchModal";
const MAX_RESULTS = 10;

let onJumpCallback: ((itemId: string) => void) | null = null;

function ensureModal(): HTMLElement {
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.className = "guideline-quick-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "guidelineQuickSearchTitle");
  modal.hidden = true;
  modal.innerHTML = `
    <div class="guideline-quick-backdrop" data-quick-close="true"></div>
    <div class="guideline-quick-dialog" role="document">
      <header class="guideline-quick-header">
        <h3 id="guidelineQuickSearchTitle">📖 운영지침 빠른 검색</h3>
        <button type="button" class="guideline-quick-close" data-quick-close="true" aria-label="닫기">✕</button>
      </header>
      <div class="guideline-quick-input-wrap">
        <span class="guideline-quick-icon" aria-hidden="true">🔍</span>
        <input
          type="search"
          id="guidelineQuickInput"
          class="guideline-quick-input"
          placeholder="검색어 입력 후 Enter — Esc 로 닫기"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div class="guideline-quick-suggestions-row"></div>
      <ul class="guideline-quick-results" id="guidelineQuickResults"></ul>
      <footer class="guideline-quick-footer">
        <span class="guideline-quick-kbd">↑↓</span> 이동
        <span class="guideline-quick-kbd">Enter</span> 매뉴얼로 이동
        <span class="guideline-quick-kbd">Esc</span> 닫기
      </footer>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

interface QuickResultItem {
  item: GuidelineItem;
  section: GuidelineSection;
}

function flattenResults(sections: GuidelineSection[]): QuickResultItem[] {
  const result: QuickResultItem[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      result.push({ section, item });
      if (result.length >= MAX_RESULTS) return result;
    }
  }
  return result;
}

let selectedIndex = 0;

function renderResults(modal: HTMLElement, query: string): QuickResultItem[] {
  const resultsEl = modal.querySelector<HTMLElement>("#guidelineQuickResults");
  if (!resultsEl) return [];
  const { sections, tokens } = searchGuideline(query, GUIDELINE_SECTIONS);
  const flat = flattenResults(sections);
  if (flat.length === 0) {
    resultsEl.innerHTML = `<li class="guideline-quick-empty">관련 지침을 찾지 못했습니다.</li>`;
    return [];
  }
  selectedIndex = Math.min(selectedIndex, flat.length - 1);
  if (selectedIndex < 0) selectedIndex = 0;
  resultsEl.innerHTML = flat
    .map((r, idx) => {
      const isSelected = idx === selectedIndex;
      const titleHtml = highlight(r.item.title, tokens);
      const bodyPreview = r.item.body.slice(0, 90) + (r.item.body.length > 90 ? "…" : "");
      const bodyHtml = highlight(bodyPreview, tokens);
      return `<li class="guideline-quick-result-item${isSelected ? " is-selected" : ""}" data-item-id="${escapeHtml(r.item.id)}" role="option" aria-selected="${isSelected}">
        <div class="guideline-quick-result-section">
          <span class="guideline-quick-result-icon">${escapeHtml(r.section.icon)}</span>
          <span>${escapeHtml(r.section.title)}</span>
        </div>
        <div class="guideline-quick-result-title">${titleHtml}</div>
        <div class="guideline-quick-result-body">${bodyHtml}</div>
      </li>`;
    })
    .join("");
  return flat;
}

function renderSuggestions(modal: HTMLElement): void {
  const row = modal.querySelector<HTMLElement>(".guideline-quick-suggestions-row");
  if (!row) return;
  row.innerHTML = GUIDELINE_QUICK_SUGGESTIONS.map(
    (s) =>
      `<button type="button" class="guideline-quick-chip" data-suggestion="${escapeHtml(s)}">${escapeHtml(s)}</button>`,
  ).join("");
}

function closeQuickSearch(modal: HTMLElement): void {
  modal.hidden = true;
  document.body.classList.remove("guideline-quick-open");
}

function jumpToItem(itemId: string, modal: HTMLElement): void {
  closeQuickSearch(modal);
  if (onJumpCallback) onJumpCallback(itemId);
}

export function openGuidelineQuickSearch(onJump: (itemId: string) => void): void {
  onJumpCallback = onJump;
  const modal = ensureModal();
  if (!modal.dataset.bound) {
    bindModal(modal);
    modal.dataset.bound = "true";
  }
  selectedIndex = 0;
  const input = modal.querySelector<HTMLInputElement>("#guidelineQuickInput");
  if (input) input.value = "";
  renderSuggestions(modal);
  renderResults(modal, "");
  modal.hidden = false;
  document.body.classList.add("guideline-quick-open");
  window.setTimeout(() => input?.focus(), 30);
}

function bindModal(modal: HTMLElement): void {
  const input = modal.querySelector<HTMLInputElement>("#guidelineQuickInput");
  const resultsEl = modal.querySelector<HTMLElement>("#guidelineQuickResults");
  let currentResults: QuickResultItem[] = [];

  modal.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.quickClose === "true") {
      closeQuickSearch(modal);
      return;
    }
    const suggestion = t.closest<HTMLElement>("[data-suggestion]");
    if (suggestion && input) {
      input.value = suggestion.dataset.suggestion ?? "";
      currentResults = renderResults(modal, input.value);
      input.focus();
      return;
    }
    const resultItem = t.closest<HTMLElement>("[data-item-id]");
    if (resultItem) {
      const id = resultItem.dataset.itemId;
      if (id) jumpToItem(id, modal);
    }
  });

  input?.addEventListener("input", () => {
    selectedIndex = 0;
    currentResults = renderResults(modal, input.value);
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeQuickSearch(modal);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (currentResults.length === 0) return;
      selectedIndex = (selectedIndex + 1) % currentResults.length;
      currentResults = renderResults(modal, input.value);
      ensureSelectedVisible(resultsEl);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentResults.length === 0) return;
      selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
      currentResults = renderResults(modal, input.value);
      ensureSelectedVisible(resultsEl);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = currentResults[selectedIndex];
      if (target) jumpToItem(target.item.id, modal);
    }
  });
}

function ensureSelectedVisible(resultsEl: HTMLElement | null): void {
  if (!resultsEl) return;
  const selected = resultsEl.querySelector<HTMLElement>(".guideline-quick-result-item.is-selected");
  selected?.scrollIntoView({ block: "nearest" });
}
