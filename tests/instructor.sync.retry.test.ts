import { describe, expect, it, vi } from "vitest";
import { withRetry, paginateAll } from "../src/core/instructorSync";

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

describe("paginateAll", () => {
  it("페이지 1개로 끝나면 1번 호출된다", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ instructor_code: "A", name: "김A", memo: "" }]);
    const result = await paginateAll(fetcher, 1000);
    expect(result).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(0, 999);
  });

  it("정확히 PAGE_SIZE개면 다음 페이지를 시도한다", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      instructor_code: `TCH_${i}`,
      name: null,
      memo: null
    }));
    const fetcher = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce([]);
    const result = await paginateAll(fetcher, 1000);
    expect(result).toHaveLength(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("2페이지에 걸친 결과를 합산한다", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ instructor_code: `A${i}`, name: null, memo: null }));
    const page2 = Array.from({ length: 5 }, (_, i) => ({ instructor_code: `B${i}`, name: null, memo: null }));
    const fetcher = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const result = await paginateAll(fetcher, 1000);
    expect(result).toHaveLength(1005);
  });

  it("pageSize=0이면 무한루프 없이 RangeError를 던진다", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    // pageSize=0 would cause infinite loop; guard should prevent it
    // If no guard exists, this test documents the expected behavior
    await expect(paginateAll(fetcher, 0)).rejects.toThrow(RangeError);
  });
});
