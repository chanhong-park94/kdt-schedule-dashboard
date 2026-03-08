import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, migrateState } from "../src/core/state";

describe("state migration", () => {
  it("schemaVersion 없는 JSON은 v1로 간주되어 정상 로드된다", () => {
    const migrated = migrateState({
      savedAt: "2026-02-24T10:00:00.000Z",
      sessions: []
    });

    expect(migrated.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.warnings.length).toBeGreaterThan(0);
    expect(migrated.state.courseRegistry).toEqual([]);
    expect(migrated.state.subjectRegistryByCourse).toEqual([]);
    expect(migrated.state.instructorRegistry).toEqual([]);
    expect(migrated.state.courseSubjectInstructorMapping).toEqual([]);
    expect(migrated.state.courseTemplates).toEqual([]);
    expect(migrated.state.ui.showAdvanced).toBe(false);
  });

  it("schemaVersion=1은 v2로 마이그레이션되어 정상 로드된다", () => {
    const migrated = migrateState({
      schemaVersion: 1,
      savedAt: "2026-02-24T10:00:00.000Z",
      sessions: []
    });

    expect(migrated.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.warnings.some((item) => item.includes("v1"))).toBe(true);
    expect(migrated.state.courseRegistry).toEqual([]);
    expect(migrated.state.subjectRegistryByCourse).toEqual([]);
    expect(migrated.state.instructorRegistry).toEqual([]);
    expect(migrated.state.courseSubjectInstructorMapping).toEqual([]);
    expect(migrated.state.courseTemplates).toEqual([]);
    expect(migrated.state.ui.showAdvanced).toBe(false);
  });

  it("알 수 없는 schemaVersion은 사용자 친화적 에러를 던진다", () => {
    expect(() => migrateState({ schemaVersion: 999 })).toThrow(/지원하지 않는 schemaVersion/);
  });

  it("v2 상태에서 courseRegistry가 없어도 기본값으로 채워진다", () => {
    const migrated = migrateState({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: "2026-02-24T10:00:00.000Z",
      sessions: [],
      subjectRegistryByCourse: [{ courseId: "EDATA", subjectCode: "SUBJ_01", subjectName: "기초", memo: "" }],
      courseTemplates: [
        {
          name: "EDATA v1",
          version: "v1",
          courseId: "EDATA",
          dayTemplates: [],
          holidays: [],
          customBreaks: [],
          subjectList: [],
          subjectInstructorMapping: []
        }
      ]
    });

    expect(migrated.state.courseRegistry).toEqual([]);
    expect(migrated.state.subjectRegistryByCourse).toHaveLength(1);
    expect(migrated.state.courseTemplates).toHaveLength(1);
  });

  it("v2 상태에서 subjectRegistryByCourse가 없어도 기본값으로 채워진다", () => {
    const migrated = migrateState({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: "2026-02-24T10:00:00.000Z",
      sessions: [],
      courseRegistry: [{ courseId: "EDATA", courseName: "EDATA", memo: "" }],
      courseTemplates: []
    });

    expect(migrated.state.courseRegistry).toHaveLength(1);
    expect(migrated.state.subjectRegistryByCourse).toEqual([]);
    expect(migrated.state.courseTemplates).toEqual([]);
  });

  it("v2 상태에서 courseTemplates가 없어도 기본값으로 채워진다", () => {
    const migrated = migrateState({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: "2026-02-24T10:00:00.000Z",
      sessions: [],
      courseRegistry: [{ courseId: "EDATA", courseName: "EDATA", memo: "" }],
      subjectRegistryByCourse: [{ courseId: "EDATA", subjectCode: "SUBJ_01", subjectName: "기초", memo: "" }]
    });

    expect(migrated.state.courseRegistry).toHaveLength(1);
    expect(migrated.state.subjectRegistryByCourse).toHaveLength(1);
    expect(migrated.state.courseTemplates).toEqual([]);
  });

  it("showAdvanced가 누락되어도 기본값 false로 채워진다", () => {
    const migrated = migrateState({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: "2026-02-24T10:00:00.000Z",
      sessions: [],
      ui: {
        viewMode: "full",
        timelineViewType: "COHORT_TIMELINE"
      }
    });

    expect(migrated.state.ui.showAdvanced).toBe(false);
  });

  it("showAdvanced=true가 저장되어 있으면 상태에는 true로 로드된다", () => {
    const migrated = migrateState({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: "2026-02-24T10:00:00.000Z",
      sessions: [],
      ui: {
        showAdvanced: true
      }
    });

    expect(migrated.state.ui.showAdvanced).toBe(true);
  });

  it("세션이 5,000개인 대용량 상태도 오류 없이 마이그레이션된다", () => {
    const sessions = Array.from({ length: 5000 }, (_, i) => ({
      훈련일자: "20260101",
      훈련시작시간: "0900",
      훈련종료시간: "1800",
      "방학/원격여부": "",
      시작시간: String(i % 24).padStart(2, "0") + "00",
      시간구분: "1",
      훈련강사코드: `tch-${i % 100}`,
      "교육장소(강의실)코드": `room-${i % 10}`,
      "교과목(및 능력단위)코드": `subj-${i % 20}`,
      과정기수: `cohort-${i % 5}`,
      normalizedDate: "2026-01-01",
      startMin: 540,
      endMin: 1080
    }));

    const migrated = migrateState({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      sessions
    });

    expect(migrated.state.sessions).toHaveLength(5000);
    expect(Array.isArray(migrated.state.courseRegistry)).toBe(true);
  });
});
