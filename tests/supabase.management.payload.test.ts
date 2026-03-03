import { describe, expect, it } from "vitest";
import { isValidSaveCourseTemplateInput } from "../src/core/supabaseManagement";

describe("supabase management payload validation", () => {
  it("saveCourseTemplate payload shape를 검증한다", () => {
    expect(
      isValidSaveCourseTemplateInput({
        courseId: "EDATA",
        templateName: "운영표준",
        templateJson: { weekdays: [1, 2, 3] }
      })
    ).toBe(true);

    expect(
      isValidSaveCourseTemplateInput({
        courseId: "",
        templateName: "",
        templateJson: null
      })
    ).toBe(false);
  });
});
