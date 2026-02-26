import { describe, expect, it } from "vitest";

import { applyCohortSubjectInstructorMappingsToSessions } from "../src/core/subjectMapping";
import { Session } from "../src/core/types";

function makeSession(overrides: Partial<Session>): Session {
  return {
    훈련일자: "20260311",
    훈련시작시간: "0900",
    훈련종료시간: "1100",
    "방학/원격여부": "",
    시작시간: "0900",
    시간구분: "1",
    훈련강사코드: "",
    "교육장소(강의실)코드": "ROOM_01",
    "교과목(및 능력단위)코드": "subj-01",
    과정기수: "KDT-A",
    normalizedDate: "2026-03-11",
    startMin: 540,
    endMin: 660,
    ...overrides
  };
}

describe("subject mapping apply", () => {
  it("subjectDirectory + 매핑 기준으로 세션에 강사코드가 반영된다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "KDT-A", "교과목(및 능력단위)코드": "subj-01" }),
      makeSession({ 과정기수: "KDT-B", "교과목(및 능력단위)코드": "subj-01" })
    ];

    const subjectDirectoryCodes = new Set(["SUBJ_01"]);
    const result = applyCohortSubjectInstructorMappingsToSessions(
      sessions,
      [{ cohort: "KDT-A", subjectCode: "SUBJ_01", instructorCode: "TCH-9001" }],
      subjectDirectoryCodes
    );

    expect(result.updatedRows).toBe(1);
    expect(result.sessions[0]?.훈련강사코드).toBe("TCH_9001");
    expect(result.sessions[0]?.["교과목(및 능력단위)코드"]).toBe("SUBJ_01");
    expect(result.sessions[1]?.훈련강사코드).toBe("");
  });
});
