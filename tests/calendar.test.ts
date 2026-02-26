import { describe, expect, it } from "vitest";

import { generateSchedule } from "../src/core/calendar";
import { DayTimeTemplate } from "../src/core/types";

const BASE_TEMPLATES: DayTimeTemplate[] = [
  { weekday: 2, blocks: [{ startHHMM: "2000", endHHMM: "2230" }] },
  { weekday: 3, blocks: [{ startHHMM: "2000", endHHMM: "2230" }] },
  { weekday: 4, blocks: [{ startHHMM: "2000", endHHMM: "2230" }] },
  { weekday: 5, blocks: [{ startHHMM: "2000", endHHMM: "2230" }] },
  {
    weekday: 6,
    blocks: [{ startHHMM: "1000", endHHMM: "1800" }],
    breaks: [{ startHHMM: "1300", endHHMM: "1400" }]
  }
];

const BASE_WEEKDAYS = [2, 3, 4, 5, 6];

describe("generateSchedule", () => {
  it("요일별 템플릿(화~금 2.5h, 토 7h net)을 반영한다", () => {
    const result = generateSchedule({
      startDate: "2026-04-14",
      totalHours: 17,
      weekdays: BASE_WEEKDAYS,
      holidays: [],
      customBreaks: [],
      dayTemplates: BASE_TEMPLATES
    });

    const tuesday = result.days.find((day) => day.date === "2026-04-14");
    const saturday = result.days.find((day) => day.date === "2026-04-18");

    expect(tuesday?.netMinutes).toBe(150);
    expect(saturday?.netMinutes).toBe(420);
  });

  it("일 단위 운영으로 totalHours를 넘겨 채우더라도 해당 날짜를 종강일로 잡는다", () => {
    const result = generateSchedule({
      startDate: "2026-04-14",
      totalHours: 17.5,
      weekdays: BASE_WEEKDAYS,
      holidays: [],
      customBreaks: [],
      dayTemplates: BASE_TEMPLATES
    });

    expect(result.endDate).toBe("2026-04-21");
    expect(result.totalHoursPlanned).toBe(19.5);
    expect(
      result.skipped.some((item) => item.date === "2026-04-19" && item.reason === "weekday_excluded")
    ).toBe(true);
    expect(
      result.skipped.some((item) => item.date === "2026-04-20" && item.reason === "weekday_excluded")
    ).toBe(true);
  });

  it("dateOverrides가 있으면 해당 날짜 템플릿을 우선 적용한다", () => {
    const result = generateSchedule({
      startDate: "2026-04-14",
      totalHours: 13,
      weekdays: BASE_WEEKDAYS,
      holidays: [],
      customBreaks: [],
      dayTemplates: BASE_TEMPLATES,
      dateOverrides: {
        "2026-04-18": {
          weekday: 6,
          blocks: [{ startHHMM: "1000", endHHMM: "1300" }],
          breaks: []
        }
      }
    });

    const saturday = result.days.find((day) => day.date === "2026-04-18");
    expect(saturday?.netMinutes).toBe(180);
  });

  it("요일은 포함되지만 템플릿이 누락된 경우 에러를 던진다", () => {
    expect(() =>
      generateSchedule({
        startDate: "2026-04-14",
        totalHours: 10,
        weekdays: [1, 2],
        holidays: [],
        customBreaks: [],
        dayTemplates: [{ weekday: 2, blocks: [{ startHHMM: "2000", endHHMM: "2230" }] }]
      })
    ).toThrow();
  });
});
