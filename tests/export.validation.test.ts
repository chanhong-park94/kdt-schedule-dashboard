import { describe, expect, it } from "vitest";

import { validateRecordsForFormat } from "../src/core/exportValidation";
import { InternalV7ERecord } from "../src/core/schema";

describe("export validation", () => {
  it("v7e_strict에서 필수값 누락 시 오류를 반환한다", () => {
    const records: InternalV7ERecord[] = [
      {
        cohort: "",
        startDate: "2026-03-01",
        endDate: ""
      }
    ];

    const result = validateRecordsForFormat("v7e_strict", records);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("v7e_strict에서 날짜 포맷이 잘못되면 오류를 반환한다", () => {
    const records: InternalV7ERecord[] = [
      {
        cohort: "A",
        startDate: "2026/03/01",
        endDate: "2026-03-31",
        p1Assignee: "담당",
        p1Range: "2026-03-01~2026-03-10"
      }
    ];

    const result = validateRecordsForFormat("v7e_strict", records);
    expect(result.errors.some((item) => item.includes("날짜 형식"))).toBe(true);
  });

  it("v7e_strict에서 phase 일부 비어 있으면 경고를 반환한다", () => {
    const records: InternalV7ERecord[] = [
      {
        cohort: "A",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        p1Assignee: "담당",
        p1Range: "2026-03-01~2026-03-10"
      }
    ];

    const result = validateRecordsForFormat("v7e_strict", records);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("modules_generic에서 moduleKey/start/end 누락 시 오류를 반환한다", () => {
    const records: InternalV7ERecord[] = [
      {
        cohort: "A",
        startDate: "2026-03-01",
        endDate: "2026-03-31"
      }
    ];

    const result = validateRecordsForFormat("modules_generic", records);
    expect(result.errors.some((item) => item.includes("moduleKey"))).toBe(true);
  });
});
