import { describe, expect, it } from "vitest";

import { buildAssignments, detectStaffOverlaps, summarizeWorkload } from "../src/core/staffing";

describe("staffing policy", () => {
  it("동일 assignment라도 cohort.trackType에 따라 퍼실 업무일수가 달라진다", () => {
    const unemployed = buildAssignments([
      {
        cohort: "A",
        phase: "P1",
        assignee: "홍길동",
        startDate: "2026-05-01",
        endDate: "2026-05-03",
        resourceType: "FACILITATOR",
        trackType: "UNEMPLOYED"
      }
    ]);

    const employed = buildAssignments([
      {
        cohort: "A",
        phase: "P1",
        assignee: "홍길동",
        startDate: "2026-05-01",
        endDate: "2026-05-03",
        resourceType: "FACILITATOR",
        trackType: "EMPLOYED"
      }
    ]);

    expect(unemployed[0]?.includeWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(employed[0]?.includeWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(unemployed[0]?.workDays).toBe(1);
    expect(employed[0]?.workDays).toBe(2);
  });

  it("일 단위 충돌은 resourceType별로 독립 계산한다", () => {
    const assignments = buildAssignments([
      {
        cohort: "A",
        phase: "P1",
        assignee: "홍길동",
        startDate: "2026-05-01",
        endDate: "2026-05-03",
        resourceType: "FACILITATOR",
        trackType: "UNEMPLOYED"
      },
      {
        cohort: "B",
        phase: "P2",
        assignee: "홍길동",
        startDate: "2026-05-01",
        endDate: "2026-05-03",
        resourceType: "OPERATION",
        trackType: "UNEMPLOYED"
      }
    ]);

    const overlaps = detectStaffOverlaps(assignments);
    expect(overlaps).toHaveLength(0);

    const summary = summarizeWorkload(assignments);
    expect(summary).toHaveLength(2);
    expect(summary.every((item) => item.overlapDays === 0)).toBe(true);
  });
});
