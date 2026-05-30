import { describe, expect, it } from "vitest";

import {
  classifyCategory,
  computeStats,
  enrichMessages,
  isQuestionMessage,
} from "../src/hrd/hrdDiscordClassify";
import type { DiscordConfig, DiscordRawMessage } from "../src/hrd/hrdDiscordTypes";

const config: DiscordConfig = {
  gasUrl: "https://x",
  channels: [
    { id: "C1", label: "데싸 6기" },
    { id: "C2", label: "프데분 5기" },
  ],
  staffAuthorIds: ["STAFF1"],
};

function raw(p: Partial<DiscordRawMessage>): DiscordRawMessage {
  return {
    channelId: "C1",
    id: "m" + Math.random().toString(36).slice(2),
    authorId: "S100",
    authorName: "학생",
    authorBot: false,
    content: "",
    timestamp: "2026-05-29T00:00:00.000Z",
    ...p,
  };
}

describe("classifyCategory", () => {
  it("출결 키워드 분류", () => {
    expect(classifyCategory("공결 신청 어떻게 하나요?")).toBe("출결");
    expect(classifyCategory("출석 처리가 안 됐어요")).toBe("출결");
  });
  it("훈련장려금 분류", () => {
    expect(classifyCategory("훈련장려금 언제 지급되나요")).toBe("훈련장려금");
  });
  it("내배카 분류", () => {
    expect(classifyCategory("내일배움카드 잔액 부족 문의")).toBe("내배카");
  });
  it("매칭 없으면 기타", () => {
    expect(classifyCategory("안녕하세요 반갑습니다")).toBe("기타");
  });
});

describe("isQuestionMessage", () => {
  it("물음표 포함 학생 메시지는 질문", () => {
    expect(isQuestionMessage(raw({ content: "이거 맞나요?" }), false)).toBe(true);
  });
  it("의문사 포함 학생 메시지는 질문", () => {
    expect(isQuestionMessage(raw({ content: "출결 어떻게 처리하면 되나요" }), false)).toBe(true);
  });
  it("운영자 메시지는 질문 아님", () => {
    expect(isQuestionMessage(raw({ content: "처리됐습니다?" }), true)).toBe(false);
  });
  it("봇 메시지는 질문 아님", () => {
    expect(isQuestionMessage(raw({ content: "공지입니다?", authorBot: true }), false)).toBe(false);
  });
  it("평서문은 질문 아님", () => {
    expect(isQuestionMessage(raw({ content: "감사합니다" }), false)).toBe(false);
  });
});

describe("enrichMessages — answered 판정", () => {
  it("질문 이후 운영자 답변이 있으면 answered=true", () => {
    const raws = [
      raw({ id: "q", authorId: "S100", content: "공결 어떻게 신청하나요?", timestamp: "2026-05-29T01:00:00.000Z" }),
      raw({ id: "a", authorId: "STAFF1", content: "별지서식으로 신청하세요", timestamp: "2026-05-29T02:00:00.000Z" }),
    ];
    const enriched = enrichMessages(raws, config);
    const q = enriched.find((m) => m.id === "q")!;
    expect(q.isQuestion).toBe(true);
    expect(q.answered).toBe(true);
    expect(q.category).toBe("출결");
  });

  it("질문 이후 운영자 답변이 없으면 answered=false (미응답)", () => {
    const raws = [
      raw({ id: "q", authorId: "S100", content: "장려금 언제 나오나요?", timestamp: "2026-05-29T03:00:00.000Z" }),
    ];
    const enriched = enrichMessages(raws, config);
    const q = enriched.find((m) => m.id === "q")!;
    expect(q.answered).toBe(false);
  });

  it("채널 라벨 매핑", () => {
    const raws = [raw({ channelId: "C2", content: "질문 있나요?" })];
    const enriched = enrichMessages(raws, config);
    expect(enriched[0].cohortLabel).toBe("프데분 5기");
  });
});

describe("computeStats", () => {
  it("미응답/응답완료 집계", () => {
    const raws = [
      raw({ id: "q1", authorId: "S1", content: "출석 어떻게 하나요?", timestamp: "2026-05-29T01:00:00.000Z" }),
      raw({ id: "a1", authorId: "STAFF1", content: "처리했어요", timestamp: "2026-05-29T01:30:00.000Z" }),
      raw({ id: "q2", authorId: "S2", content: "수료 기준이 뭔가요?", timestamp: "2026-05-29T02:00:00.000Z" }),
    ];
    const enriched = enrichMessages(raws, config);
    const stats = computeStats(enriched);
    expect(stats.학생질문).toBe(2);
    expect(stats.응답완료).toBe(1);
    expect(stats.미응답).toBe(1);
  });
});
