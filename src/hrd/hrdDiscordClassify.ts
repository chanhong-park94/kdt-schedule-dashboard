/**
 * 디스코드 메시지 분류·분석 (키워드 규칙 기반, 무료·클라이언트)
 */
import { INQUIRY_CATEGORIES } from "./hrdInquiryTypes";
import type {
  DiscordChannelMap,
  DiscordConfig,
  DiscordMessage,
  DiscordRawMessage,
  DiscordStats,
} from "./hrdDiscordTypes";

// 의문 휴리스틱 — 물음표 또는 의문 표현
const QUESTION_RE = /[?？]|(어떻게|언제|어디|무엇|뭐|되나요|되요|되죠|인가요|일까요|있나요|없나요|문의|가능한가요|가능할까요|해야|하나요|할까요|하면\s*되|되는지|인지|건가요|드릴까요)/;

/** 본문 내용으로 KDT 카테고리 분류. 매칭 없으면 "기타". 다중 매칭 시 최다 키워드. */
export function classifyCategory(content: string): string {
  const text = (content || "").toLowerCase();
  let best = "기타";
  let bestHits = 0;
  for (const [cat, keywords] of Object.entries(INQUIRY_CATEGORIES)) {
    let hits = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = cat;
    }
  }
  return best;
}

/** 학생 질문 여부 — 비스태프 + 의문 표현 + 봇 아님 + 내용 있음 */
export function isQuestionMessage(raw: DiscordRawMessage, isStaff: boolean): boolean {
  if (isStaff || raw.authorBot) return false;
  const content = (raw.content || "").trim();
  if (content.length < 2) return false;
  return QUESTION_RE.test(content);
}

function channelLabel(channels: DiscordChannelMap[], channelId: string): string {
  return channels.find((c) => c.id === channelId)?.label ?? channelId;
}

/**
 * 원본 메시지 배열 → 분석 파생 필드까지 채운 DiscordMessage 배열.
 * answered 판정: 같은 채널에서 질문 timestamp 이후 가장 가까운 스태프 메시지 존재 여부.
 */
export function enrichMessages(raws: DiscordRawMessage[], config: DiscordConfig): DiscordMessage[] {
  const staffSet = new Set(config.staffAuthorIds.map((s) => s.trim()).filter(Boolean));

  // 채널별 정렬 (timestamp 오름차순) — answered 판정용
  const byChannel = new Map<string, DiscordRawMessage[]>();
  for (const r of raws) {
    if (!byChannel.has(r.channelId)) byChannel.set(r.channelId, []);
    byChannel.get(r.channelId)!.push(r);
  }
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // 채널별 스태프 메시지 timestamp 목록 (이분 비교 대신 단순 선형 — 데이터 규모 작음)
  const staffTimesByChannel = new Map<string, string[]>();
  for (const [channelId, list] of byChannel) {
    staffTimesByChannel.set(
      channelId,
      list.filter((m) => staffSet.has(m.authorId) && !m.authorBot).map((m) => m.timestamp),
    );
  }

  const result: DiscordMessage[] = [];
  for (const r of raws) {
    const isStaff = staffSet.has(r.authorId) && !r.authorBot;
    const isQuestion = isQuestionMessage(r, isStaff);
    let answered = false;
    if (isQuestion) {
      const staffTimes = staffTimesByChannel.get(r.channelId) ?? [];
      answered = staffTimes.some((t) => t > r.timestamp);
    }
    result.push({
      ...r,
      cohortLabel: channelLabel(config.channels, r.channelId),
      isStaff,
      category: classifyCategory(r.content),
      isQuestion,
      answered,
    });
  }
  // 최신순 정렬 (표시용)
  result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return result;
}

/** 분석 통계 계산 (학생 질문 기준 집계) */
export function computeStats(messages: DiscordMessage[]): DiscordStats {
  const questions = messages.filter((m) => m.isQuestion);
  const 카테고리별: Record<string, number> = {};
  const 기수별: Record<string, number> = {};
  let 미응답 = 0;
  let 응답완료 = 0;

  for (const q of questions) {
    카테고리별[q.category] = (카테고리별[q.category] ?? 0) + 1;
    기수별[q.cohortLabel] = (기수별[q.cohortLabel] ?? 0) + 1;
    if (q.answered) 응답완료++;
    else 미응답++;
  }

  let 최다카테고리 = "-";
  let max = 0;
  for (const [cat, n] of Object.entries(카테고리별)) {
    if (n > max) {
      max = n;
      최다카테고리 = cat;
    }
  }

  return {
    총메시지: messages.length,
    학생질문: questions.length,
    미응답,
    응답완료,
    카테고리별,
    기수별,
    최다카테고리,
  };
}

/** FAQ 도출 — 카테고리별 학생 질문 빈도 Top N */
export function deriveFaq(
  messages: DiscordMessage[],
  topN = 5,
): Array<{ category: string; count: number; samples: string[] }> {
  const byCat = new Map<string, DiscordMessage[]>();
  for (const m of messages) {
    if (!m.isQuestion) continue;
    if (!byCat.has(m.category)) byCat.set(m.category, []);
    byCat.get(m.category)!.push(m);
  }
  const out = [...byCat.entries()].map(([category, list]) => ({
    category,
    count: list.length,
    samples: list.slice(0, 3).map((m) => m.content.replace(/\s+/g, " ").slice(0, 60)),
  }));
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, topN);
}
