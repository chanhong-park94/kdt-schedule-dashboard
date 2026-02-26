import { describe, expect, it } from "vitest";

import {
  createDefaultScheduleTemplates,
  findScheduleTemplate,
  mergeScheduleTemplates,
  upsertScheduleTemplate
} from "../src/core/scheduleTemplates";
import { TemplateRowState } from "../src/core/state";

const customRows: TemplateRowState[] = [
  { weekday: 1, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" },
  { weekday: 2, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" }
];

describe("schedule templates", () => {
  it("템플릿 저장/병합/조회가 정상 동작한다", () => {
    const defaults = createDefaultScheduleTemplates();
    const saved = upsertScheduleTemplate(defaults, "운영매니저 테스트", customRows);
    const merged = mergeScheduleTemplates(saved as unknown);
    const found = findScheduleTemplate(merged, "운영매니저 테스트");

    expect(found).toBeDefined();
    expect(found?.rows.length).toBe(2);
    expect(found?.builtIn).toBe(false);
    expect(findScheduleTemplate(merged, "재직자 기본")?.builtIn).toBe(true);
  });
});
