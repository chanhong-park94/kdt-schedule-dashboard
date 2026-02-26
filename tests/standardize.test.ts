import { describe, expect, it } from "vitest";

import {
  normalizeClassroomCode,
  normalizeInstructorCode,
  normalizeSubjectCode
} from "../src/core/standardize";

describe("standardize", () => {
  it("trim + 연속 공백 축소를 적용한다", () => {
    expect(normalizeInstructorCode("  TCH   1001  ")).toBe("TCH_1001");
  });

  it("제어문자를 제거한다", () => {
    expect(normalizeClassroomCode("ROOM\u0000\n01")).toBe("ROOM_01");
  });

  it("괄호/대시/슬래시 구분자를 단일 언더스코어로 통일한다", () => {
    expect(normalizeSubjectCode("SUBJ-(AI)/01")).toBe("SUBJ_AI_01");
  });

  it("이름_숫자코드 패턴에서 이름/코드 사이 공백을 제거한다", () => {
    expect(normalizeInstructorCode("홍길동 - 1001")).toBe("홍길동_1001");
  });

  it("빈 입력은 빈 문자열로 반환한다", () => {
    expect(normalizeClassroomCode("   ")).toBe("");
  });
});
