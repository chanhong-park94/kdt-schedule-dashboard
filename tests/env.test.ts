import { describe, expect, it, vi } from "vitest";
import { assertClientEnv, readClientEnv } from "../src/core/env";

describe("assertClientEnv", () => {
  it("환경변수가 있으면 값을 반환한다", () => {
    vi.stubEnv("TEST_KEY_ASSERT_ENV", "hello");
    expect(assertClientEnv(["TEST_KEY_ASSERT_ENV"])).toBe("hello");
    vi.unstubAllEnvs();
  });

  it("모든 키가 없으면 에러를 던진다", () => {
    expect(() => assertClientEnv(["__MISSING_KEY_A__", "__MISSING_KEY_B__"])).toThrow(
      "__MISSING_KEY_A__"
    );
  });

  it("에러 메시지에 모든 키 이름이 포함된다", () => {
    const run = () => assertClientEnv(["__KEY_X__", "__KEY_Y__"]);
    expect(run).toThrow("__KEY_X__");
    expect(run).toThrow("__KEY_Y__");
  });

  it("빈 배열을 전달하면 RangeError를 던진다", () => {
    expect(() => assertClientEnv([])).toThrow(RangeError);
  });

  it("여러 키 중 첫 번째로 값이 있는 키를 반환한다", () => {
    vi.stubEnv("__FALLBACK_KEY__", "world");
    expect(assertClientEnv(["__MISSING_FIRST__", "__FALLBACK_KEY__"])).toBe("world");
    vi.unstubAllEnvs();
  });
});

describe("readClientEnv", () => {
  it("환경변수가 없으면 빈 문자열을 반환한다 (기존 동작 보존)", () => {
    expect(readClientEnv(["__DEFINITELY_MISSING__"])).toBe("");
  });
});
