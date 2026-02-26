import { describe, expect, it } from "vitest";

import { validateHrdExportForCohort, validateHrdExportForCohortDetailed } from "../src/core/hrdValidation";
import { Session } from "../src/core/types";

describe("hrd validation", () => {
  it("공휴일 세션은 warning 처리되어 다운로드 차단 사유가 아니다", () => {
    const sessions: Session[] = [
      {
        훈련일자: "20260301",
        훈련시작시간: "0900",
        훈련종료시간: "1100",
        "방학/원격여부": "",
        시작시간: "0900",
        시간구분: "1",
        훈련강사코드: "TCH_1001",
        "교육장소(강의실)코드": "ROOM_01",
        "교과목(및 능력단위)코드": "SUBJ_01",
        과정기수: "KDT-A",
        normalizedDate: "2026-03-01",
        startMin: 540,
        endMin: 660
      }
    ];

    const result = validateHrdExportForCohortDetailed(sessions, "KDT-A", ["2026-03-01"]);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((item) => item.includes("공휴일"))).toBe(true);
  });

  it("날짜/시간 형식 오류는 다운로드를 차단한다", () => {
    const sessions: Session[] = [
      {
        훈련일자: "20261340",
        훈련시작시간: "0900",
        훈련종료시간: "1100",
        "방학/원격여부": "",
        시작시간: "0900",
        시간구분: "1",
        훈련강사코드: "TCH_1001",
        "교육장소(강의실)코드": "ROOM_01",
        "교과목(및 능력단위)코드": "SUBJ_01",
        과정기수: "KDT-A",
        normalizedDate: null,
        startMin: null,
        endMin: 660
      }
    ];

    const errors = validateHrdExportForCohort(sessions, "KDT-A", []);
    expect(errors.some((item) => item.includes("날짜 형식"))).toBe(true);
    expect(errors.some((item) => item.includes("시간 형식"))).toBe(true);
  });

  it("강사/교과목 누락은 경고로 처리되어 다운로드 차단 사유가 아니다", () => {
    const sessions: Session[] = [
      {
        훈련일자: "20260301",
        훈련시작시간: "0900",
        훈련종료시간: "1100",
        "방학/원격여부": "",
        시작시간: "0900",
        시간구분: "1",
        훈련강사코드: "",
        "교육장소(강의실)코드": "ROOM_01",
        "교과목(및 능력단위)코드": "",
        과정기수: "KDT-A",
        normalizedDate: "2026-03-02",
        startMin: 540,
        endMin: 660
      }
    ];

    const result = validateHrdExportForCohortDetailed(sessions, "KDT-A", []);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((item) => item.includes("강사코드"))).toBe(true);
    expect(result.warnings.some((item) => item.includes("교과목 코드"))).toBe(true);
  });
});
