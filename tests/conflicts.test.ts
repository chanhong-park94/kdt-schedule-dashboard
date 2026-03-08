import { describe, expect, it } from "vitest";

import { detectConflicts } from "../src/core/conflicts";
import { Session } from "../src/core/types";

function makeSession(overrides: Partial<Session>): Session {
  return {
    훈련일자: "20260314",
    훈련시작시간: "0900",
    훈련종료시간: "1000",
    "방학/원격여부": "",
    시작시간: "0900",
    시간구분: "정규",
    훈련강사코드: "TCH-1001",
    "교육장소(강의실)코드": "ROOM-01",
    "교과목(및 능력단위)코드": "SUBJ-01",
    과정기수: "KDT-1기",
    normalizedDate: "2026-03-14",
    startMin: 540,
    endMin: 600,
    ...overrides
  };
}

describe("detectConflicts", () => {
  it("같은 일자 + 같은 강의실에서 시간 겹침을 충돌로 판정한다", () => {
    const sessions: Session[] = [
      makeSession({
        과정기수: "KDT-A",
        훈련시작시간: "2000",
        훈련종료시간: "2200",
        startMin: 1200,
        endMin: 1320,
        훈련강사코드: "TCH-A"
      }),
      makeSession({
        과정기수: "KDT-B",
        훈련시작시간: "2100",
        훈련종료시간: "2300",
        startMin: 1260,
        endMin: 1380,
        훈련강사코드: "TCH-B"
      })
    ];

    const conflicts = detectConflicts(sessions);

    expect(conflicts.some((item) => item.기준 === "강의실")).toBe(true);
  });

  it("서로 다른 과정기수일 때만 충돌로 기록한다", () => {
    const sessions: Session[] = [
      makeSession({
        과정기수: "KDT-A",
        훈련시작시간: "2000",
        훈련종료시간: "2200",
        startMin: 1200,
        endMin: 1320,
        훈련강사코드: "TCH-A"
      }),
      makeSession({
        과정기수: "KDT-A",
        훈련시작시간: "2100",
        훈련종료시간: "2300",
        startMin: 1260,
        endMin: 1380,
        훈련강사코드: "TCH-B"
      })
    ];

    const conflicts = detectConflicts(sessions);

    expect(conflicts).toHaveLength(0);
  });

  it("INSTRUCTOR 필터를 사용하면 강사 충돌만 계산한다", () => {
    const sessions: Session[] = [
      makeSession({
        과정기수: "KDT-A",
        훈련시작시간: "2000",
        훈련종료시간: "2200",
        startMin: 1200,
        endMin: 1320,
        훈련강사코드: "TCH-SAME"
      }),
      makeSession({
        과정기수: "KDT-B",
        훈련시작시간: "2100",
        훈련종료시간: "2300",
        startMin: 1260,
        endMin: 1380,
        훈련강사코드: "TCH-SAME"
      })
    ];

    const instructorConflicts = detectConflicts(sessions, { resourceTypes: ["INSTRUCTOR"] });

    expect(instructorConflicts.length).toBeGreaterThan(0);
    expect(instructorConflicts.every((item) => item.resourceType === "INSTRUCTOR")).toBe(true);
    expect(instructorConflicts.some((item) => item.기준 === "강의실")).toBe(false);
  });

  it("충돌 결과는 (일자, 키, 과정A) 순으로 정렬된다", () => {
    const sessions: Session[] = [
      // Day 20260315: two cohorts sharing same instructor (TCH-SAME)
      makeSession({
        과정기수: "KDT-Z",
        훈련일자: "20260315",
        훈련시작시간: "1000",
        훈련종료시간: "1200",
        startMin: 600,
        endMin: 720,
        훈련강사코드: "TCH-SAME",
        "교육장소(강의실)코드": "ROOM-99"
      }),
      makeSession({
        과정기수: "KDT-A",
        훈련일자: "20260315",
        훈련시작시간: "1100",
        훈련종료시간: "1300",
        startMin: 660,
        endMin: 780,
        훈련강사코드: "TCH-SAME",
        "교육장소(강의실)코드": "ROOM-99"
      }),
      // Day 20260314: two cohorts sharing same instructor (TCH-SAME)
      makeSession({
        과정기수: "KDT-B",
        훈련일자: "20260314",
        훈련시작시간: "0900",
        훈련종료시간: "1100",
        startMin: 540,
        endMin: 660,
        훈련강사코드: "TCH-SAME",
        "교육장소(강의실)코드": "ROOM-99"
      }),
      makeSession({
        과정기수: "KDT-C",
        훈련일자: "20260314",
        훈련시작시간: "1000",
        훈련종료시간: "1200",
        startMin: 600,
        endMin: 720,
        훈련강사코드: "TCH-SAME",
        "교육장소(강의실)코드": "ROOM-99"
      })
    ];

    const conflicts = detectConflicts(sessions, { resourceTypes: ["INSTRUCTOR"] });

    expect(conflicts.length).toBeGreaterThanOrEqual(2);

    // Verify output is sorted by 일자 ascending
    for (let i = 1; i < conflicts.length; i++) {
      const prev = conflicts[i - 1];
      const curr = conflicts[i];
      const cmp = prev.일자.localeCompare(curr.일자);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });
});
