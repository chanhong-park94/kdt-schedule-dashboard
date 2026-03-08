import { describe, expect, it } from "vitest";

import { buildHrdRowsForCohort, checkHrdRowLimit, HRD_MAX_ROWS_WARNING } from "../src/core/hrdRows";
import { ScheduleDay, Session } from "../src/core/types";

function makeSession(overrides: Partial<Session>): Session {
  return {
    훈련일자: "20260311",
    훈련시작시간: "1000",
    훈련종료시간: "1800",
    "방학/원격여부": "",
    시작시간: "1000",
    시간구분: "1",
    훈련강사코드: "TCH_1001",
    "교육장소(강의실)코드": "ROOM_01",
    "교과목(및 능력단위)코드": "SUBJ_01",
    과정기수: "리서처15기",
    normalizedDate: "2026-03-11",
    startMin: 600,
    endMin: 1080,
    ...overrides
  };
}

describe("hrd rows builder", () => {
  it("10:00~18:00 + 13:00~14:00 break를 리서처15기 형식으로 확장한다", () => {
    const sessions: Session[] = [makeSession({})];
    const generatedDays: ScheduleDay[] = [
      {
        date: "2026-03-11",
        blocks: [{ startHHMM: "1000", endHHMM: "1800" }],
        breaks: [{ startHHMM: "1300", endHHMM: "1400" }],
        netMinutes: 420
      }
    ];

    const rows = buildHrdRowsForCohort({
      sessions,
      cohort: "리서처15기",
      generatedDays
    });

    expect(rows.map((row) => `${row.시작시간}:${row.시간구분}`)).toEqual([
      "1000:1",
      "1100:1",
      "1200:1",
      "1300:2",
      "1400:1",
      "1500:1",
      "1600:1",
      "1700:1"
    ]);

    for (const row of rows) {
      expect(row.훈련시작시간).toBe("1000");
      expect(row.훈련종료시간).toBe("1800");
    }

    const breakRow = rows.find((row) => row.시작시간 === "1300" && row.시간구분 === "2");
    expect(breakRow).toBeDefined();
    expect(breakRow?.훈련강사코드).toBe("");
    expect(breakRow?.["교육장소(강의실)코드"]).toBe("");
    expect(breakRow?.교과목코드).toBe("");
  });
});

describe("checkHrdRowLimit", () => {
  it("행 수가 10,000 미만이면 null을 반환한다", () => {
    const rows = Array.from({ length: 9999 }, (_, i) => ({
      훈련일자: "20260101",
      훈련시작시간: "0900",
      훈련종료시간: "1800",
      "방학/원격여부": "",
      시작시간: String(i).padStart(4, "0"),
      시간구분: "1" as const,
      훈련강사코드: "TCH_001",
      "교육장소(강의실)코드": "ROOM_01",
      교과목코드: "SUBJ_01"
    }));
    expect(checkHrdRowLimit(rows)).toBeNull();
  });

  it("행 수가 10,000 이상이면 경고 문자열을 반환한다", () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      훈련일자: "20260101",
      훈련시작시간: "0900",
      훈련종료시간: "1800",
      "방학/원격여부": "",
      시작시간: String(i).padStart(4, "0"),
      시간구분: "1" as const,
      훈련강사코드: "TCH_001",
      "교육장소(강의실)코드": "ROOM_01",
      교과목코드: "SUBJ_01"
    }));
    const warning = checkHrdRowLimit(rows);
    expect(warning).not.toBeNull();
    expect(warning).toContain("10,000");
    expect(warning).toContain("Excel에서 열기 어려울 수 있습니다");
  });

  it("HRD_MAX_ROWS_WARNING 상수는 10000이다", () => {
    expect(HRD_MAX_ROWS_WARNING).toBe(10000);
  });
});
