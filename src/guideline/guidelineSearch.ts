import { escapeHtml } from "../core/escape";
import type { GuidelineItem, GuidelineSection } from "./guidelineData";

export interface SearchResult {
  sections: GuidelineSection[];
  totalMatches: number;
  tokens: string[];
}

function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(item: GuidelineItem, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${item.title} ${item.body} ${(item.tags ?? []).join(" ")}`.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

export function searchGuideline(query: string, sections: GuidelineSection[]): SearchResult {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    const total = sections.reduce((n, s) => n + s.items.length, 0);
    return { sections, totalMatches: total, tokens };
  }
  const filtered = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => matches(item, tokens)),
    }))
    .filter((section) => section.items.length > 0);
  const total = filtered.reduce((n, s) => n + s.items.length, 0);
  return { sections: filtered, totalMatches: total, tokens };
}

/**
 * 이스케이프 + **bold** 마크다운 → <strong> 변환 + 검색어 <mark> 강조.
 * 안전한 HTML 문자열 반환. 원문 매칭은 대소문자 무시.
 */
export function highlight(text: string, tokens: string[]): string {
  const escaped = escapeHtml(text);
  // 마크다운 bold: **텍스트** → <strong>텍스트</strong> (개행 없는 텍스트만 한정)
  const bolded = escaped.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  if (tokens.length === 0) return bolded;
  const escapedTokens = tokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  if (escapedTokens.length === 0) return bolded;
  const pattern = new RegExp(`(${escapedTokens.join("|")})`, "gi");
  return bolded.replace(pattern, '<mark class="guideline-mark">$1</mark>');
}

export function findItemById(
  sections: GuidelineSection[],
  itemId: string,
): { section: GuidelineSection; item: GuidelineItem } | null {
  for (const section of sections) {
    const item = section.items.find((i) => i.id === itemId);
    if (item) return { section, item };
  }
  return null;
}
