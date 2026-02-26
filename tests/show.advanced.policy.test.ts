import { describe, expect, it } from "vitest";

import { resolveShowAdvancedPolicy } from "../src/core/showAdvancedPolicy";

describe("showAdvanced policy", () => {
  it("production에서는 저장값과 무관하게 false를 강제한다", () => {
    expect(
      resolveShowAdvancedPolicy({
        savedShowAdvanced: true,
        search: "?showAdvanced=1",
        isDev: false,
        isProd: true
      })
    ).toBe(false);
  });

  it("development에서는 showAdvanced 쿼리 파라미터를 허용한다", () => {
    expect(
      resolveShowAdvancedPolicy({
        savedShowAdvanced: false,
        search: "?showAdvanced=1",
        isDev: true,
        isProd: false
      })
    ).toBe(true);
  });
});
