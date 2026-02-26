import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import employedSample from "../src/public/samples/state_employed_demo_v2.json";
import unemployedSample from "../src/public/samples/state_unemployed_demo_v2.json";
import { detectConflicts } from "../src/core/conflicts";
import { exportHrdCsvForCohort } from "../src/core/export";
import { HEADER_MAPPINGS } from "../src/core/exportMapping";
import { type InternalV7ERecord } from "../src/core/schema";
import { migrateState, type AppStateVCurrent } from "../src/core/state";
import { exportV7eStrictCsv } from "../src/core/staffing";
import { HRD_EXPORT_COLUMNS } from "../src/core/types";

function buildStrictRecords(state: AppStateVCurrent): InternalV7ERecord[] {
  return state.generatedCohortRanges.map((range) => {
    const byPhase = new Map<string, { assignee: string; startDate: string; endDate: string }>();

    for (const cell of state.staffingCells) {
      if (cell.cohort !== range.cohort) {
        continue;
      }
      byPhase.set(cell.phase, {
        assignee: cell.assignee,
        startDate: cell.startDate,
        endDate: cell.endDate
      });
    }

    const p1 = byPhase.get("P1");
    const p2 = byPhase.get("P2");
    const p365 = byPhase.get("365");

    return {
      cohort: range.cohort,
      startDate: range.startDate,
      endDate: range.endDate,
      p1Assignee: p1?.assignee ?? "",
      p1Range: p1 ? `${p1.startDate}~${p1.endDate}` : "",
      p2Assignee: p2?.assignee ?? "",
      p2Range: p2 ? `${p2.startDate}~${p2.endDate}` : "",
      p365Assignee: p365?.assignee ?? "",
      p365Range: p365 ? `${p365.startDate}~${p365.endDate}` : ""
    };
  });
}

function exportConflictCsv(state: AppStateVCurrent): string {
  const header = ["기준", "일자", "키", "과정A", "A시간", "A교과목", "과정B", "B시간", "B교과목"];
  const conflicts = detectConflicts(state.sessions, { resourceTypes: ["INSTRUCTOR"] });
  const lines = [header.join(",")];

  for (const conflict of conflicts) {
    lines.push(
      [
        conflict.기준,
        conflict.일자,
        conflict.키,
        conflict.과정A,
        conflict.A시간,
        conflict.A교과목,
        conflict.과정B,
        conflict.B시간,
        conflict.B교과목
      ].join(",")
    );
  }

  return lines.join("\n");
}

describe("e2e samples", () => {
  const samples = [
    ["unemployed", unemployedSample],
    ["employed", employedSample]
  ] as const;

  for (const [name, sample] of samples) {
    it(`${name} 샘플에서 핵심 산출물 3종이 생성된다`, () => {
      const migrated = migrateState(sample).state;
      const targetCohort = migrated.generatedCohortRanges[0]?.cohort ?? migrated.sessions[0]?.과정기수 ?? "";

      const hrdCsv = exportHrdCsvForCohort(migrated.sessions, targetCohort);
      expect(hrdCsv.length).toBeGreaterThan(0);
      expect(hrdCsv.startsWith(HRD_EXPORT_COLUMNS.join(","))).toBe(true);

      const strictCsv = exportV7eStrictCsv(buildStrictRecords(migrated));
      expect(strictCsv.length).toBeGreaterThan(0);
      expect(strictCsv.startsWith(HEADER_MAPPINGS.v7e_strict.header.join(","))).toBe(true);

      const conflictCsv = exportConflictCsv(migrated);
      expect(conflictCsv.length).toBeGreaterThan(0);
      expect(conflictCsv.startsWith("기준,일자,키,과정A,A시간,A교과목,과정B,B시간,B교과목")).toBe(true);
    });
  }

  it("기본 모드에서는 고급 섹션 제거 경로가 main.ts에 존재한다", () => {
    const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(source.includes("removeBasicModeSections(document)")).toBe(true);
  });
});
