import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/core/csv";
import { validateHrdExportForCohortDetailed } from "../src/core/hrdValidation";
import { buildHrdRowsForCohort } from "../src/core/hrdRows";
import { Session } from "../src/core/types";

/**
 * CSV 문자열 → Session 배열로 변환하는 헬퍼 (실제 앱 파이프라인 모방)
 */
function csvToSessions(csv: string): Session[] {
  const records = parseCsv(csv);
  return records.map((row) => ({
    훈련일자: row["훈련일자"] ?? "",
    훈련시작시간: row["훈련시작시간"] ?? "",
    훈련종료시간: row["훈련종료시간"] ?? "",
    "방학/원격여부": row["방학/원격여부"] ?? "",
    시작시간: row["시작시간"] ?? "",
    시간구분: row["시간구분"] ?? "1",
    훈련강사코드: row["훈련강사코드"] ?? "",
    "교육장소(강의실)코드": row["교육장소(강의실)코드"] ?? "",
    "교과목(및 능력단위)코드": row["교과목(및 능력단위)코드"] ?? "",
    과정기수: row["과정기수"] ?? "",
    normalizedDate: row["normalizedDate"] || null,
    startMin: row["startMin"] ? Number(row["startMin"]) : null,
    endMin: row["endMin"] ? Number(row["endMin"]) : null
  }));
}

describe("HRD 파이프라인 통합 테스트", () => {
  it("정상 CSV → 검증 통과 → HRD 행 생성까지 오류 없이 완료된다", () => {
    const csv = [
      "훈련일자,훈련시작시간,훈련종료시간,방학/원격여부,시작시간,시간구분,훈련강사코드,교육장소(강의실)코드,교과목(및 능력단위)코드,과정기수,normalizedDate,startMin,endMin",
      "20260310,0900,1800,,0900,1,TCH_1001,ROOM_01,SUBJ_01,KDT-A,2026-03-10,540,1080"
    ].join("\n");

    const sessions = csvToSessions(csv);
    expect(sessions).toHaveLength(1);

    const validationResult = validateHrdExportForCohortDetailed(sessions, "KDT-A", []);
    expect(validationResult.errors).toHaveLength(0);

    const rows = buildHrdRowsForCohort({
      sessions,
      cohort: "KDT-A",
      generatedDays: [
        {
          date: "2026-03-10",
          blocks: [{ startHHMM: "0900", endHHMM: "1800" }],
          breaks: [{ startHHMM: "1300", endHHMM: "1400" }],
          netMinutes: 480
        }
      ]
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.훈련일자 === "20260310")).toBe(true);
  });

  it("강사코드/교과목 누락 CSV는 경고는 있지만 HRD 행 생성은 성공한다", () => {
    const csv = [
      "훈련일자,훈련시작시간,훈련종료시간,방학/원격여부,시작시간,시간구분,훈련강사코드,교육장소(강의실)코드,교과목(및 능력단위)코드,과정기수,normalizedDate,startMin,endMin",
      "20260310,0900,1800,,0900,1,,,  ,KDT-A,2026-03-10,540,1080"
    ].join("\n");

    const sessions = csvToSessions(csv);
    const validationResult = validateHrdExportForCohortDetailed(sessions, "KDT-A", []);

    expect(validationResult.errors).toHaveLength(0);
    expect(validationResult.warnings.length).toBeGreaterThan(0);

    const rows = buildHrdRowsForCohort({
      sessions,
      cohort: "KDT-A",
      generatedDays: [
        {
          date: "2026-03-10",
          blocks: [{ startHHMM: "0900", endHHMM: "1800" }],
          breaks: [],
          netMinutes: 540
        }
      ]
    });

    expect(rows.length).toBeGreaterThan(0);
  });

  it("날짜 형식 오류 CSV는 검증에서 error가 반환된다", () => {
    const csv = [
      "훈련일자,훈련시작시간,훈련종료시간,방학/원격여부,시작시간,시간구분,훈련강사코드,교육장소(강의실)코드,교과목(및 능력단위)코드,과정기수,normalizedDate,startMin,endMin",
      "20261399,0900,1800,,0900,1,TCH_1001,ROOM_01,SUBJ_01,KDT-A,,540,1080"
    ].join("\n");

    const sessions = csvToSessions(csv);
    const validationResult = validateHrdExportForCohortDetailed(sessions, "KDT-A", []);

    expect(validationResult.errors.some((e) => e.includes("날짜 형식"))).toBe(true);
  });
});
