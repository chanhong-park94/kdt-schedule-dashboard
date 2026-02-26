import { describe, expect, it } from "vitest";

import { exportHrdCsvForCohort } from "../src/core/export";
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

describe("hrd export snapshot", () => {
  it("헤더 순서/컬럼 수/포맷을 고정 유지한다", () => {
    const sessions: Session[] = [
      makeSession({
        훈련강사코드: " 홍길동 - 1001 ",
        "교육장소(강의실)코드": "ROOM ( 01 )",
        "교과목(및 능력단위)코드": "AI-기초/01"
      }),
      makeSession({
        훈련일자: "20260312",
        훈련시작시간: "1300",
        훈련종료시간: "1500",
        시작시간: "1300",
        시간구분: "2",
        훈련강사코드: "홍길동_1001",
        "교육장소(강의실)코드": "ROOM_02",
        "교과목(및 능력단위)코드": "AI_심화_02"
      })
    ];

    const csv = exportHrdCsvForCohort(sessions, "KDT-A");
    const lines = csv.split(/\r?\n/);
    const columnCounts = lines.map((line) => line.split(",").length);

    expect(columnCounts.every((count) => count === 9)).toBe(true);
    expect(csv).toMatchInlineSnapshot(`
      "훈련일자,훈련시작시간,훈련종료시간,방학/원격여부,시작시간,시간구분,훈련강사코드,교육장소(강의실)코드,교과목(및 능력단위)코드
      20260311,0900,1100,,0900,1,홍길동_1001,ROOM_01,AI_기초_01
      20260312,1300,1500,,1300,2,홍길동_1001,ROOM_02,AI_심화_02"
    `);
  });
});
