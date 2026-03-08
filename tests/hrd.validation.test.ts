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

  it("holidayNameByDate가 있으면 공휴일 이름이 경고에 포함된다", () => {
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

    const holidayNameByDate = new Map([["2026-03-01", "삼일절"]]);
    const result = validateHrdExportForCohortDetailed(sessions, "KDT-A", ["2026-03-01"], holidayNameByDate);
    expect(result.warnings.some((w) => w.includes("삼일절"))).toBe(true);
  });

  it("동일 날짜/교과목 중복 세션은 중복 경고를 생성한다", () => {
    const base = {
      훈련일자: "20260310",
      훈련시작시간: "0900",
      훈련종료시간: "1100",
      "방학/원격여부": "",
      시간구분: "1",
      훈련강사코드: "TCH_1001",
      "교육장소(강의실)코드": "ROOM_01",
      과정기수: "KDT-A",
      normalizedDate: "2026-03-10",
      startMin: 540,
      endMin: 660
    };
    const sessions: Session[] = [
      { ...base, 시작시간: "0900", "교과목(및 능력단위)코드": "SUBJ_01" },
      { ...base, 시작시간: "1000", "교과목(및 능력단위)코드": "SUBJ_01" }
    ];

    const result = validateHrdExportForCohortDetailed(sessions, "KDT-A", []);
    expect(result.warnings.some((w) => w.includes("중복"))).toBe(true);
  });

  it("subjectDirectoryCodes에 없는 교과목은 미등록 경고를 생성한다", () => {
    const sessions: Session[] = [
      {
        훈련일자: "20260310",
        훈련시작시간: "0900",
        훈련종료시간: "1100",
        "방학/원격여부": "",
        시작시간: "0900",
        시간구분: "1",
        훈련강사코드: "TCH_1001",
        "교육장소(강의실)코드": "ROOM_01",
        "교과목(및 능력단위)코드": "UNKNOWN_SUBJ",
        과정기수: "KDT-A",
        normalizedDate: "2026-03-10",
        startMin: 540,
        endMin: 660
      }
    ];

    const knownSubjects = new Set(["KNOWN_SUBJ_01", "KNOWN_SUBJ_02"]);
    const result = validateHrdExportForCohortDetailed(sessions, "KDT-A", [], undefined, knownSubjects);
    expect(result.warnings.some((w) => w.includes("미등록"))).toBe(true);
  });

  it("시작시간과 종료시간이 동일한 세션은 경고를 생성한다", () => {
    const sessions: Session[] = [
      {
        훈련일자: "20260310",
        훈련시작시간: "0900",
        훈련종료시간: "0900",
        "방학/원격여부": "",
        시작시간: "0900",
        시간구분: "1",
        훈련강사코드: "TCH_1001",
        "교육장소(강의실)코드": "ROOM_01",
        "교과목(및 능력단위)코드": "SUBJ_01",
        과정기수: "KDT-A",
        normalizedDate: "2026-03-10",
        startMin: 540,
        endMin: 540
      }
    ];

    const result = validateHrdExportForCohortDetailed(sessions, "KDT-A", []);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("동일"))).toBe(true);
  });

  it("종료시간이 시작시간보다 빠른 세션은 경고를 생성한다", () => {
    const sessions: Session[] = [
      {
        훈련일자: "20260310",
        훈련시작시간: "1100",
        훈련종료시간: "0900",
        "방학/원격여부": "",
        시작시간: "1100",
        시간구분: "1",
        훈련강사코드: "TCH_1001",
        "교육장소(강의실)코드": "ROOM_01",
        "교과목(및 능력단위)코드": "SUBJ_01",
        과정기수: "KDT-A",
        normalizedDate: "2026-03-10",
        startMin: 660,
        endMin: 540
      }
    ];

    const result = validateHrdExportForCohortDetailed(sessions, "KDT-A", []);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("빠른"))).toBe(true);
  });
});
