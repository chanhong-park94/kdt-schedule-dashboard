import { describe, expect, it } from "vitest";

import { applyCourseTemplateToState } from "../src/core/courseTemplateApply";

describe("course template apply", () => {
  it("템플릿 적용 시 dayTemplates/subjectList/매핑이 반영된다", () => {
    const result = applyCourseTemplateToState({
      subjectDirectory: [],
      subjectInstructorMappings: [],
      template: {
        courseId: "EDATA",
        dayTemplates: [{ weekday: 1, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" }],
        holidays: ["2026-03-01"],
        customBreaks: ["2026-03-02"],
        subjectList: [{ subjectCode: "SUBJ_01", subjectName: "기초", memo: "" }],
        subjectInstructorMapping: [{ key: "EDATA|||SUBJ_01", instructorCode: "TCH-1001" }]
      }
    });

    expect(result.dayTemplates).toHaveLength(1);
    expect(result.holidays).toEqual(["2026-03-01"]);
    expect(result.customBreaks).toEqual(["2026-03-02"]);
    expect(result.subjectDirectory).toEqual([
      { courseId: "EDATA", subjectCode: "SUBJ_01", subjectName: "기초", memo: "" }
    ]);
    expect(result.subjectInstructorMappings).toEqual([{ key: "EDATA|||SUBJ_01", instructorCode: "TCH_1001" }]);
  });

  it("overwrite 정책: 대상 과정 데이터만 교체하고 타 과정은 유지한다", () => {
    const result = applyCourseTemplateToState({
      subjectDirectory: [
        { courseId: "EDATA", subjectCode: "SUBJ_01", subjectName: "기존", memo: "old" },
        { courseId: "KDTAI", subjectCode: "SUBJ_01", subjectName: "타과정", memo: "keep" }
      ],
      subjectInstructorMappings: [
        { key: "EDATA|||SUBJ_01", instructorCode: "TCH_OLD" },
        { key: "KDTAI|||SUBJ_01", instructorCode: "TCH_KEEP" }
      ],
      template: {
        courseId: "EDATA",
        dayTemplates: [],
        holidays: [],
        customBreaks: [],
        subjectList: [{ subjectCode: "SUBJ_02", subjectName: "신규", memo: "new" }],
        subjectInstructorMapping: [{ key: "EDATA|||SUBJ_02", instructorCode: "TCH_NEW" }]
      }
    });

    expect(result.subjectDirectory).toEqual([
      { courseId: "KDTAI", subjectCode: "SUBJ_01", subjectName: "타과정", memo: "keep" },
      { courseId: "EDATA", subjectCode: "SUBJ_02", subjectName: "신규", memo: "new" }
    ]);
    expect(result.subjectInstructorMappings).toEqual([
      { key: "KDTAI|||SUBJ_01", instructorCode: "TCH_KEEP" },
      { key: "EDATA|||SUBJ_02", instructorCode: "TCH_NEW" }
    ]);
    expect(result.overwrite.subjectEntriesReplaced).toBe(1);
    expect(result.overwrite.mappingEntriesReplaced).toBe(1);
  });
});
