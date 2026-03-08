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

    // 20260314에서 KDT-B vs KDT-C, 20260315에서 KDT-A vs KDT-Z
    expect(conflicts).toHaveLength(2);

    // 일자 기준: 20260314 이 20260315보다 먼저
    expect(conflicts[0].일자).toBe("20260314");
    expect(conflicts[1].일자).toBe("20260315");

    // 과정A는 버킷 내 startMin 기준 첫 번째 세션: 20260314→KDT-B(0900), 20260315→KDT-Z(1000)
    expect(conflicts[0].과정A).toBe("KDT-B");
    expect(conflicts[1].과정A).toBe("KDT-Z");
  });

  it("강사코드가 비어 있는 세션은 충돌 판정 대상에서 제외된다", () => {
    // 빈 기준키 세션끼리는 "같은 빈 강사" 버킷으로 묶이면 안 된다
    const sessions: Session[] = [
      makeSession({ 과정기수: "KDT-A", 훈련강사코드: "", startMin: 540, endMin: 660 }),
      makeSession({ 과정기수: "KDT-B", 훈련강사코드: "", startMin: 540, endMin: 660 })
    ];

    const conflicts = detectConflicts(sessions, { resourceTypes: ["INSTRUCTOR"] });

    expect(conflicts).toHaveLength(0);
  });

  it("강의실코드가 비어 있는 세션은 충돌 판정 대상에서 제외된다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "KDT-A", "교육장소(강의실)코드": "", startMin: 540, endMin: 660 }),
      makeSession({ 과정기수: "KDT-B", "교육장소(강의실)코드": "", startMin: 540, endMin: 660 })
    ];

    const conflicts = detectConflicts(sessions, { resourceTypes: ["OPERATION"] });

    expect(conflicts).toHaveLength(0);
  });

  it("같은 일자·키에서 과정A 알파벳 순으로 정렬된다", () => {
    // 같은 날, 같은 강사, 서로 다른 세 과정이 각각 충돌
    const sessions: Session[] = [
      makeSession({ 과정기수: "ZZZ-과정", 훈련강사코드: "TCH-X", startMin: 540, endMin: 660 }),
      makeSession({ 과정기수: "AAA-과정", 훈련강사코드: "TCH-X", startMin: 600, endMin: 720 }),
      makeSession({ 과정기수: "MMM-과정", 훈련강사코드: "TCH-X", startMin: 570, endMin: 690 })
    ];

    const conflicts = detectConflicts(sessions, { resourceTypes: ["INSTRUCTOR"] });

    expect(conflicts.length).toBeGreaterThan(0);
    // 과정A 오름차순 정렬 확인
    for (let i = 1; i < conflicts.length; i++) {
      expect(conflicts[i - 1].과정A.localeCompare(conflicts[i].과정A)).toBeLessThanOrEqual(0);
    }
  });
});
