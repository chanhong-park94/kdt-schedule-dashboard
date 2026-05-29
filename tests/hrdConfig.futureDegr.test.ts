/**
 * 회귀 방지 — 미래 기수 필터링 (v3.10.2 fix)
 *
 * 발견 배경: "데이터 기반 의사결정" 7기(개강일 2026-07-07)가 개강 전임에도
 * 출결관리 리포트(주간보고팩 + Slack 자동 알림 등)에 노출됨.
 *
 * 근본 원인: course.degrs 는 전체 기수 union 이지만, 리포트·분석·알림 모듈에서
 * getActiveDegrs() 헬퍼를 호출하지 않고 course.degrs 를 직접 사용.
 *
 * 이 테스트는 DEFAULT_COURSES 데이터 기준 미래 기수 판정 로직이 정확히 동작함을
 * 보장한다. 시작일 데이터 수정 시 본 테스트도 함께 업데이트할 것.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_COURSES, getActiveDegrs, isDegrFuture } from "../src/hrd/hrdConfig";

function findCourse(name: string) {
  const c = DEFAULT_COURSES.find((x) => x.name === name);
  if (!c) throw new Error(`fixture missing: ${name}`);
  return c;
}

describe("isDegrFuture / getActiveDegrs", () => {
  // 사용자가 신고한 정확한 케이스
  it("데이터 기반 의사결정 7기는 2026-05-29 기준 미래 기수다", () => {
    const dataDecision = findCourse("데이터 기반 의사결정");
    const now = new Date("2026-05-29");
    expect(dataDecision.degrStartDates?.["7"]).toBe("2026-07-07");
    expect(isDegrFuture(dataDecision, "7", now)).toBe(true);
  });

  it("데이터 기반 의사결정 6기(2026-04-28)는 2026-05-29 기준 진행중이다", () => {
    const dataDecision = findCourse("데이터 기반 의사결정");
    const now = new Date("2026-05-29");
    expect(isDegrFuture(dataDecision, "6", now)).toBe(false);
  });

  it("getActiveDegrs는 2026-05-29 기준 미래 기수(7기)를 제외한다", () => {
    const dataDecision = findCourse("데이터 기반 의사결정");
    const now = new Date("2026-05-29");
    const active = getActiveDegrs(dataDecision, now);
    expect(active).not.toContain("7");
    // 이미 시작한 기수(4·5·6기) + 시작일 미등록 기수(1·2·3기 — 안전 default 표시) 포함
    expect(active).toContain("6");
    expect(active).toContain("5");
    expect(active).toContain("4");
  });

  it("degrStartDates 미등록 기수는 안전 default로 표시 유지", () => {
    const dataDecision = findCourse("데이터 기반 의사결정");
    const now = new Date("2026-05-29");
    // 1·2·3기는 degrStartDates에 없음 → isDegrFuture=false → getActiveDegrs에 포함
    expect(isDegrFuture(dataDecision, "1", now)).toBe(false);
    expect(getActiveDegrs(dataDecision, now)).toContain("1");
  });

  it("개강일이 정확히 오늘인 기수는 표시 유지 (이미 시작)", () => {
    const dataDecision = findCourse("데이터 기반 의사결정");
    const now = new Date("2026-07-07"); // 7기 개강일
    expect(isDegrFuture(dataDecision, "7", now)).toBe(false);
  });

  it("AI 활용 서비스 7기(2026-07-14)도 2026-05-29 기준 미래", () => {
    const aiService = findCourse("AI 활용 서비스 기획/개발");
    const now = new Date("2026-05-29");
    expect(isDegrFuture(aiService, "7", now)).toBe(true);
    expect(getActiveDegrs(aiService, now)).not.toContain("7");
  });

  it("재직자 LLM 7기(2026-05-26)는 2026-05-29 기준 진행중", () => {
    const llm = findCourse("재직자 LLM");
    const now = new Date("2026-05-29");
    expect(isDegrFuture(llm, "7", now)).toBe(false);
    expect(getActiveDegrs(llm, now)).toContain("7");
  });
});
