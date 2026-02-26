import { describe, expect, it } from "vitest";

import { applyCourseSubjectInstructorMappingsToCohortSessions } from "../src/core/subjectMapping";
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
    과정기수: "EDATA 7기",
    normalizedDate: "2026-03-11",
    startMin: 540,
    endMin: 660,
    ...overrides
  };
}

describe("course subject mapping apply", () => {
  it("과정-교과목-강사 매핑이 선택 기수 세션에 반영된다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "EDATA 7기", "교과목(및 능력단위)코드": "SUBJ_01" }),
      makeSession({ 과정기수: "EDATA 8기", "교과목(및 능력단위)코드": "SUBJ_01" })
    ];

    const result = applyCourseSubjectInstructorMappingsToCohortSessions(
      sessions,
      "EDATA 7기",
      [{ courseId: "EDATA", subjectCode: "SUBJ_01", instructorCode: "TCH-9001" }],
      new Set(["SUBJ_01"])
    );

    expect(result.updatedRows).toBe(1);
    expect(result.sessions[0]?.훈련강사코드).toBe("TCH_9001");
    expect(result.sessions[1]?.훈련강사코드).toBe("");
  });

  it("서로 다른 courseId가 동일 subjectCode를 가져도 충돌하지 않는다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "EDATA 7기", "교과목(및 능력단위)코드": "SUBJ_01" }),
      makeSession({ 과정기수: "KDTAI 3기", "교과목(및 능력단위)코드": "SUBJ_01" })
    ];

    const result = applyCourseSubjectInstructorMappingsToCohortSessions(
      sessions,
      "EDATA 7기",
      [
        { courseId: "EDATA", subjectCode: "SUBJ_01", instructorCode: "TCH-1001" },
        { courseId: "KDTAI", subjectCode: "SUBJ_01", instructorCode: "TCH-2001" }
      ],
      new Set(["SUBJ_01"])
    );

    expect(result.updatedRows).toBe(1);
    expect(result.sessions[0]?.훈련강사코드).toBe("TCH_1001");
    expect(result.sessions[1]?.훈련강사코드).toBe("");
  });

  it("cohort를 바꿔 적용해도 이전 기수에 매핑이 누수되지 않는다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "EDATA 7기", "교과목(및 능력단위)코드": "SUBJ_01" }),
      makeSession({ 과정기수: "EDATA 8기", "교과목(및 능력단위)코드": "SUBJ_01" })
    ];

    const first = applyCourseSubjectInstructorMappingsToCohortSessions(
      sessions,
      "EDATA 7기",
      [{ courseId: "EDATA", subjectCode: "SUBJ_01", instructorCode: "TCH-7001" }],
      new Set(["SUBJ_01"])
    );
    const second = applyCourseSubjectInstructorMappingsToCohortSessions(
      first.sessions,
      "EDATA 8기",
      [{ courseId: "EDATA", subjectCode: "SUBJ_01", instructorCode: "TCH-8001" }],
      new Set(["SUBJ_01"])
    );

    expect(second.sessions[0]?.훈련강사코드).toBe("TCH_7001");
    expect(second.sessions[1]?.훈련강사코드).toBe("TCH_8001");
  });
});
