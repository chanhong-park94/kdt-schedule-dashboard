import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/core/instructorSync";

describe("withRetry", () => {
  it("첫 시도에 성공하면 1번만 호출된다", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("2번 실패 후 3번째 성공하면 결과를 반환한다", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("네트워크 오류"))
      .mockRejectedValueOnce(new Error("네트워크 오류"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("maxAttempts 초과 시 마지막 오류를 던진다", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("영구 오류"));
    await expect(withRetry(fn, 3, 0)).rejects.toThrow("영구 오류");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("baseDelayMs=0이면 딜레이 없이 즉시 재시도한다", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("일시 오류")).mockResolvedValue("fast");
    const start = Date.now();
    const result = await withRetry(fn, 3, 0);
    expect(Date.now() - start).toBeLessThan(100);
    expect(result).toBe("fast");
  });

  it("maxAttempts=1이면 재시도 없이 즉시 오류를 던진다", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("단발 오류"));
    await expect(withRetry(fn, 1, 0)).rejects.toThrow("단발 오류");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("maxAttempts=0이면 RangeError를 던진다", async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, 0, 0)).rejects.toThrow(RangeError);
    expect(fn).toHaveBeenCalledTimes(0);
  });
});
