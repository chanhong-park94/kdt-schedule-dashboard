import { describe, expect, it } from "vitest";

import { buildCohortInstructorMetaMap, instructorCodeToStableHsl } from "../src/core/instructorTimeline";
import { Session } from "../src/core/types";

function makeSession(overrides: Partial<Session>): Session {
  return {
    훈련일자: "20260311",
    훈련시작시간: "0900",
    훈련종료시간: "1100",
    "방학/원격여부": "",
    시작시간: "0900",
    시간구분: "1",
    훈련강사코드: "TCH_1001",
    "교육장소(강의실)코드": "ROOM_01",
    "교과목(및 능력단위)코드": "SUBJ_01",
    과정기수: "KDT-A",
    normalizedDate: "2026-03-11",
    startMin: 540,
    endMin: 660,
    ...overrides
  };
}

describe("instructor timeline meta", () => {
  it("기수별 대표 강사를 세션 수 기준으로 선택한다", () => {
    const sessions: Session[] = [
      makeSession({ 훈련강사코드: "TCH_A", 과정기수: "KDT-A" }),
      makeSession({ 훈련강사코드: "TCH_A", 과정기수: "KDT-A", 훈련일자: "20260312" }),
      makeSession({ 훈련강사코드: "TCH_B", 과정기수: "KDT-A", 훈련일자: "20260313" }),
      makeSession({ 훈련강사코드: "TCH_C", 과정기수: "KDT-B" })
    ];

    const map = buildCohortInstructorMetaMap(sessions);
    const cohortA = map.get("KDT-A");
    expect(cohortA?.representativeInstructor).toBe("TCH_A");
    expect(cohortA?.instructorLabel).toBe("강사: TCH_A (외 1명)");
    expect(cohortA?.instructorTooltip).toContain("TCH_A (2건)");
    expect(cohortA?.barColor).toBe(instructorCodeToStableHsl("TCH_A"));
  });
});
