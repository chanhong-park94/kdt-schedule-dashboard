import { describe, expect, it } from "vitest";

import {
  rankAtRiskStudents,
  rankUnderperformingCohorts,
  rankEarlyWarningStudents,
  rankFormativeDeclineCourses,
  rankLowResponseCourses,
  rankLowFieldAppCourses,
  buildPage3Data,
  buildPage4Data,
  buildPage5Data,
  generatePage3Comments,
  generatePage4Comments,
  generatePage5Comments,
} from "../src/reports/weeklyOpsReportSelectors";
import { buildWeeklyOpsReportHtml } from "../src/reports/weeklyOpsReportPrint";
import { getWeekLabel } from "../src/reports/weeklyOpsReport";
import type { AttendanceStudent, DropoutRosterEntry, HrdConfig } from "../src/hrd/hrdTypes";
import type { TraineeAnalysis } from "../src/hrd/hrdAnalyticsTypes";
import type { KpiAllData, FormativeSummary, AchievementSummary, FieldAppSummary } from "../src/kpi/kpiTypes";

// ─── Helpers ─────────────────────────────────────────────────

function makeStudent(overrides: Partial<AttendanceStudent> = {}): AttendanceStudent {
  return {
    name: "학생A", birth: "20000101", status: "출석",
    inTime: "09:00", outTime: "18:00", dropout: false,
    riskLevel: "safe", totalDays: 100, attendedDays: 90, absentDays: 10,
    excusedDays: 0, maxAbsent: 20, remainingAbsent: 10,
    attendanceRate: 90, missingCheckout: false,
    ...overrides,
  };
}

function makeDropoutEntry(overrides: Partial<DropoutRosterEntry> = {}): DropoutRosterEntry {
  return {
    courseName: "과정A", trainPrId: "T001", degr: "1",
    category: "실업자", total: 20, dropout: 2, active: 18,
    defenseRate: 90, startDate: "2026-01-05",
    ...overrides,
  };
}

function makeTraineeAnalysis(overrides: Partial<TraineeAnalysis> = {}): TraineeAnalysis {
  return {
    name: "학생A", birth: "20000101", age: 26,
    courseName: "과정A", trainPrId: "T001", category: "실업자", degr: "1",
    attendanceRate: 95, absentDays: 3, lateDays: 1, excusedDays: 0,
    attendedDays: 90, totalDays: 100, dropout: false,
    hasAttendanceData: true, absentByWeekday: [0,0,0,0,0,0,0],
    absentByMonth: [1,1,1], maxConsecutiveAbsent: 1, currentConsecutiveAbsent: 0,
    lateByHour: [0,0,0,0,0,0], weeklyAttendanceRates: [95,90,92],
    dropoutWeekIdx: -1, alertReasons: [], courseStatus: "진행중",
    completionStatus: "훈련중", courseProgressRate: 50, courseStartDate: "2025-01-06",
    ...overrides,
  };
}

function makeHrdConfig(): HrdConfig {
  return {
    courses: [{ name: "과정A", degrs: ["1"], trainPrId: "T001", category: "실업자", startDate: "2026-01-05", totalDays: 100, endTime: "18:00" }],
    authKey: "", proxy: "",
  } as HrdConfig;
}

// ─── Tests ───────────────────────────────────────────────────

describe("rankAtRiskStudents", () => {
  it("출석률 오름차순 정렬, limit 적용", () => {
    const students = [
      makeStudent({ name: "A", attendanceRate: 70, riskLevel: "danger", remainingAbsent: 0 }),
      makeStudent({ name: "B", attendanceRate: 60, riskLevel: "warning", remainingAbsent: 1 }),
      makeStudent({ name: "C", attendanceRate: 95, riskLevel: "safe" }),
      makeStudent({ name: "D", attendanceRate: 50, riskLevel: "danger", remainingAbsent: 0 }),
    ];
    const result = rankAtRiskStudents(students, makeHrdConfig(), 2);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("D"); // 50%
    expect(result[1].name).toBe("B"); // 60%
  });

  it("safe 학생은 제외", () => {
    const students = [makeStudent({ riskLevel: "safe" })];
    expect(rankAtRiskStudents(students, makeHrdConfig(), 10)).toHaveLength(0);
  });
});

describe("rankUnderperformingCohorts", () => {
  it("목표 미달 과정만 필터, gap 오름차순", () => {
    const entries = [
      makeDropoutEntry({ courseName: "A", category: "실업자", defenseRate: 90 }), // target 85, gap +5 → pass
      makeDropoutEntry({ courseName: "B", category: "실업자", defenseRate: 70 }), // target 85, gap -15
      makeDropoutEntry({ courseName: "C", category: "재직자", defenseRate: 55 }), // target 75, gap -20
      makeDropoutEntry({ courseName: "D", category: "재직자", defenseRate: 70 }), // target 75, gap -5
    ];
    const result = rankUnderperformingCohorts(entries);
    expect(result).toHaveLength(3);
    expect(result[0].gap).toBeLessThan(result[1].gap); // worst first
    expect(result.every((c) => c.gap < 0)).toBe(true);
  });

  it("모든 과정이 목표 충족이면 빈 배열", () => {
    const entries = [makeDropoutEntry({ defenseRate: 90, category: "실업자" })];
    expect(rankUnderperformingCohorts(entries)).toHaveLength(0);
  });
});

describe("rankEarlyWarningStudents", () => {
  it("조기경보 조건 필터 + 중복제거", () => {
    const data = [
      makeTraineeAnalysis({ name: "A", attendanceRate: 75, currentConsecutiveAbsent: 0 }), // 출석률 < 80 → 경보
      makeTraineeAnalysis({ name: "B", attendanceRate: 90, currentConsecutiveAbsent: 4 }), // 연속결석 >= 3 → 경보
      makeTraineeAnalysis({ name: "C", attendanceRate: 95, currentConsecutiveAbsent: 0, alertReasons: ["상습지각"] }), // alertReasons → 경보
      makeTraineeAnalysis({ name: "D", attendanceRate: 95, currentConsecutiveAbsent: 0 }), // 정상 → 제외
      makeTraineeAnalysis({ name: "E", dropout: true, attendanceRate: 50 }), // 탈락 → 제외
      // duplicate of A
      makeTraineeAnalysis({ name: "A", attendanceRate: 75, currentConsecutiveAbsent: 0 }),
    ];
    const result = rankEarlyWarningStudents(data);
    expect(result).toHaveLength(3);
    expect(result.find((s) => s.name === "D")).toBeUndefined();
    expect(result.find((s) => s.name === "E")).toBeUndefined();
    // A should appear only once
    expect(result.filter((s) => s.name === "A")).toHaveLength(1);
  });

  it("출석률 오름차순 정렬", () => {
    const data = [
      makeTraineeAnalysis({ name: "X", attendanceRate: 79 }),
      makeTraineeAnalysis({ name: "Y", attendanceRate: 60 }),
    ];
    const result = rankEarlyWarningStudents(data);
    expect(result[0].name).toBe("Y");
    expect(result[1].name).toBe("X");
  });
});

describe("rankFormativeDeclineCourses", () => {
  it("하락 과정만 필터, 하락폭 순 정렬", () => {
    const summaries: FormativeSummary[] = [
      { course: "A", cohort: "1기", studentCount: 10, phase1Avg: 4.0, phase2Avg: 3.0, overallAvg: 3.5 },
      { course: "B", cohort: "2기", studentCount: 10, phase1Avg: 3.0, phase2Avg: 3.5, overallAvg: 3.25 }, // 상승 → 제외
      { course: "C", cohort: "1기", studentCount: 10, phase1Avg: 4.5, phase2Avg: 2.5, overallAvg: 3.5 },
    ];
    const result = rankFormativeDeclineCourses(summaries);
    expect(result).toHaveLength(2);
    expect(result[0].course).toBe("C"); // -2.0 worst
    expect(result[1].course).toBe("A"); // -1.0
  });
});

describe("rankLowResponseCourses", () => {
  it("응답률 100% 미만만 필터, 오름차순", () => {
    const summaries: AchievementSummary[] = [
      { course: "A", cohort: "1기", studentCount: 10, preAvg: 70, postAvg: 80, improvement: 10, preGradeA: 2, postGradeA: 5, completed: 10, responseRate: 100 },
      { course: "B", cohort: "2기", studentCount: 10, preAvg: 60, postAvg: 70, improvement: 10, preGradeA: 1, postGradeA: 4, completed: 8, responseRate: 60 },
      { course: "C", cohort: "1기", studentCount: 10, preAvg: 50, postAvg: 60, improvement: 10, preGradeA: 0, postGradeA: 3, completed: 5, responseRate: 40 },
    ];
    const result = rankLowResponseCourses(summaries);
    expect(result).toHaveLength(2);
    expect(result[0].course).toBe("C"); // 40%
    expect(result[1].course).toBe("B"); // 60%
  });
});

describe("buildPage3Data — 빈 데이터 fallback", () => {
  it("빈 학생 배열이면 기본 구조 반환", () => {
    const result = buildPage3Data([], new Map(), makeHrdConfig());
    expect(result.metrics.totalStudents).toBe(0);
    expect(result.autoComments.length).toBeGreaterThan(0);
    expect(result.atRiskTop10).toHaveLength(0);
  });
});

describe("buildPage4Data — 빈 데이터 fallback", () => {
  it("빈 배열이면 기본 구조 반환", () => {
    const result = buildPage4Data([], []);
    expect(result.overallDefenseRate).toBe(0);
    expect(result.autoComments.length).toBeGreaterThan(0);
    expect(result.earlyWarningTop10).toHaveLength(0);
  });
});

describe("buildPage5Data — KPI null fallback", () => {
  it("null이면 hasData=false + 안내 코멘트", () => {
    const result = buildPage5Data(null);
    expect(result.hasData).toBe(false);
    expect(result.autoComments[0]).toContain("KPI");
  });

  it("빈 achievement도 hasData=false", () => {
    const kpi = {
      courses: [], grades: [], achievement: [], formative: [], fieldApp: [],
      achievementSummary: [], formativeSummary: [], fieldAppSummary: [],
    } as KpiAllData;
    const result = buildPage5Data(kpi);
    expect(result.hasData).toBe(false);
  });
});

describe("generatePage3Comments", () => {
  it("위험군 있으면 긴급 면담 코멘트 생성", () => {
    const data = buildPage3Data(
      [
        makeStudent({ name: "A", riskLevel: "danger", attendanceRate: 50, remainingAbsent: 0 }),
        makeStudent({ name: "B", riskLevel: "warning", attendanceRate: 65, remainingAbsent: 1 }),
        makeStudent({ name: "C", riskLevel: "safe", attendanceRate: 95 }),
      ],
      new Map(),
      makeHrdConfig(),
    );
    const comments = data.autoComments;
    expect(comments.some((c) => c.includes("위험군") && c.includes("면담"))).toBe(true);
  });
});

describe("generatePage4Comments", () => {
  it("목표 미달 시 미달 코멘트 생성", () => {
    const data = buildPage4Data(
      [makeDropoutEntry({ category: "실업자", defenseRate: 70, total: 20, dropout: 6, active: 14 })],
      [],
    );
    const comments = data.autoComments;
    expect(comments.some((c) => c.includes("미달"))).toBe(true);
  });
});

describe("generatePage5Comments", () => {
  it("향상도가 양수면 향상 코멘트 생성", () => {
    const kpi: KpiAllData = {
      courses: [], grades: [],
      achievement: [{ no: 1, studentId: "S1", name: "A", course: "X", cohort: "1기", preScores: [70], preTotal: 70, preGrade: "B", postScores: [85], postTotal: 85, postGrade: "A", improvement: 15, gradeChange: "B→A", status: "" }],
      formative: [{ no: 1, studentId: "S1", name: "A", course: "X", cohort: "1기", phase1Scores: [4], phase1Avg: 4, phase2Scores: [4.5], phase2Avg: 4.5, overallAvg: 4.25, status: "" }],
      fieldApp: [{ no: 1, studentId: "S1", name: "A", course: "X", cohort: "1기", scores: [4], avgScore: 4, grade: "A", status: "" }],
      achievementSummary: [{ course: "X", cohort: "1기", studentCount: 1, preAvg: 70, postAvg: 85, improvement: 15, preGradeA: 0, postGradeA: 1, completed: 1, responseRate: 100 }],
      formativeSummary: [{ course: "X", cohort: "1기", studentCount: 1, phase1Avg: 4, phase2Avg: 4.5, overallAvg: 4.25 }],
      fieldAppSummary: [{ course: "X", cohort: "1기", studentCount: 1, avgScore: 4, completed: 1, responseRate: 100 }],
    };
    const result = buildPage5Data(kpi);
    expect(result.autoComments.some((c) => c.includes("향상도"))).toBe(true);
  });
});

describe("buildWeeklyOpsReportHtml", () => {
  it("Page 3/4/5 헤더 포함 여부", () => {
    const html = buildWeeklyOpsReportHtml({
      config: { includePage3: true, includePage4: true, includePage5: true, reportDate: "2026-03-11", reportWeekLabel: "2026년 제11주차" },
      diagnostics: { hasAttendance: true, hasDropout: true, hasAnalytics: true, hasKpi: false },
      page3: buildPage3Data([], new Map(), makeHrdConfig()),
      page4: buildPage4Data([], []),
      page5: buildPage5Data(null),
    });
    expect(html).toContain("Page 3");
    expect(html).toContain("Page 4");
    expect(html).toContain("Page 5");
  });

  it("특정 페이지만 선택하면 해당 페이지만 포함", () => {
    const html = buildWeeklyOpsReportHtml({
      config: { includePage3: true, includePage4: false, includePage5: false, reportDate: "2026-03-11", reportWeekLabel: "2026년 제11주차" },
      diagnostics: { hasAttendance: true, hasDropout: false, hasAnalytics: false, hasKpi: false },
      page3: buildPage3Data([], new Map(), makeHrdConfig()),
    });
    expect(html).toContain("Page 3");
    expect(html).not.toContain("Page 4");
    expect(html).not.toContain("Page 5");
  });
});

describe("getWeekLabel", () => {
  it("2026-03-11 (수) → 제11주차", () => {
    const label = getWeekLabel(new Date(2026, 2, 11));
    expect(label).toContain("2026년");
    expect(label).toMatch(/제\d+주차/);
    expect(label).toContain("3/9"); // Monday of that week
    expect(label).toContain("3/13"); // Friday
  });

  it("연초 날짜", () => {
    const label = getWeekLabel(new Date(2026, 0, 5)); // Monday Jan 5
    expect(label).toContain("2026년");
    expect(label).toMatch(/제\d+주차/);
  });
});
