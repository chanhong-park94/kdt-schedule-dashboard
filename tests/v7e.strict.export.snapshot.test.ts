import { describe, expect, it } from "vitest";

import { HEADER_MAPPINGS, exportWithMapping } from "../src/core/exportMapping";
import { InternalV7ERecord } from "../src/core/schema";
import { exportV7eStrictCsv } from "../src/core/staffing";

describe("v7e strict export snapshot", () => {
  it("v7e_strict 헤더 문자열/컬럼 순서를 고정한다", () => {
    const samplePresetState = {
      cohorts: [
        {
          cohort: "EMP-A",
          startDate: "2026-06-10",
          endDate: "2026-08-15",
          p1: { assignee: "INST_A", startDate: "2026-06-10", endDate: "2026-07-21" },
          p2: { assignee: "INST_B", startDate: "2026-07-22", endDate: "2026-08-15" },
          d365: { assignee: "OPS_A", startDate: "2026-08-15", endDate: "2026-09-11" }
        },
        {
          cohort: "EMP-B",
          startDate: "2026-06-12",
          endDate: "2026-08-20",
          p1: { assignee: "INST_C", startDate: "2026-06-12", endDate: "2026-07-23" },
          p2: { assignee: "INST_D", startDate: "2026-07-24", endDate: "2026-08-20" },
          d365: { assignee: "OPS_B", startDate: "2026-08-20", endDate: "2026-09-16" }
        }
      ]
    };

    const rows: InternalV7ERecord[] = samplePresetState.cohorts.map((item) => ({
      cohort: item.cohort,
      startDate: item.startDate,
      endDate: item.endDate,
      p1Assignee: item.p1.assignee,
      p1Range: `${item.p1.startDate}~${item.p1.endDate}`,
      p2Assignee: item.p2.assignee,
      p2Range: `${item.p2.startDate}~${item.p2.endDate}`,
      p365Assignee: item.d365.assignee,
      p365Range: `${item.d365.startDate}~${item.d365.endDate}`
    }));

    const csv = exportV7eStrictCsv(rows);
    const [headerLine] = csv.split(/\r?\n/);

    expect(headerLine).toBe(HEADER_MAPPINGS.v7e_strict.header.join(","));
    expect(csv).toMatchInlineSnapshot(`
      "과정,개강,종강,P1담당자,P1기간,P2담당자,P2기간,365담당자,365기간
      EMP-A,2026-06-10,2026-08-15,INST_A,2026-06-10~2026-07-21,INST_B,2026-07-22~2026-08-15,OPS_A,2026-08-15~2026-09-11
      EMP-B,2026-06-12,2026-08-20,INST_C,2026-06-12~2026-07-23,INST_D,2026-07-24~2026-08-20,OPS_B,2026-08-20~2026-09-16"
    `);
  });

  it("다른 포맷 매핑 추가/사용이 v7e_strict 결과에 영향을 주지 않는다", () => {
    const rows: InternalV7ERecord[] = [
      {
        cohort: "EMP-X",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        p1Assignee: "INST_X",
        p1Range: "2026-01-01~2026-01-10",
        p2Assignee: "INST_Y",
        p2Range: "2026-01-11~2026-01-20",
        p365Assignee: "OPS_Z",
        p365Range: "2026-02-01~2026-02-28"
      }
    ];

    const strictCsv = exportV7eStrictCsv(rows);
    const legacyCsv = exportWithMapping("v7e_legacy", rows);

    expect(strictCsv.split(/\r?\n/)[0]).toBe(HEADER_MAPPINGS.v7e_strict.header.join(","));
    expect(legacyCsv.split(/\r?\n/)[0]).toBe(HEADER_MAPPINGS.v7e_legacy.header.join(","));
    expect(strictCsv).not.toBe(legacyCsv);
  });
});
