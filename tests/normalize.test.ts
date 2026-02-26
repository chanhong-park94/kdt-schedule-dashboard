import { describe, expect, it } from "vitest";

import { hhmmToMinutes, normalizeHHMM } from "../src/core/normalize";

describe("normalize", () => {
  it("normalizeHHMM('900')는 0900으로 정규화된다", () => {
    expect(normalizeHHMM("900")).toBe("0900");
  });

  it("hhmmToMinutes는 HHMM을 분으로 변환한다", () => {
    expect(hhmmToMinutes("0900")).toBe(540);
    expect(hhmmToMinutes("2359")).toBe(1439);
  });

  it("hhmmToMinutes는 잘못된 입력에 null을 반환한다", () => {
    expect(hhmmToMinutes("99AA")).toBeNull();
  });
});
