import { describe, expect, it } from "vitest";

import { migrateState } from "../src/core/state";

describe("course template state", () => {
  it("과정 템플릿 저장 구조가 마이그레이션 후 유지된다", () => {
    const migrated = migrateState({
      schemaVersion: 2,
      savedAt: "2026-02-25T00:00:00.000Z",
      sessions: [],
      courseTemplates: [
        {
          name: "EDATA 표준",
          version: "v1",
          courseId: "EDATA",
          dayTemplates: [
            { weekday: 1, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" }
          ],
          holidays: ["2026-03-01"],
          customBreaks: ["2026-03-02"],
          subjectList: [{ subjectCode: "SUBJ_01", subjectName: "기초", memo: "" }],
          subjectInstructorMapping: [{ key: "EDATA|||SUBJ_01", instructorCode: "TCH_1001" }]
        }
      ]
    });

    expect(migrated.state.courseTemplates).toHaveLength(1);
    expect(migrated.state.courseTemplates[0]?.courseId).toBe("EDATA");
    expect(migrated.state.courseTemplates[0]?.subjectList[0]?.subjectCode).toBe("SUBJ_01");
  });
});
