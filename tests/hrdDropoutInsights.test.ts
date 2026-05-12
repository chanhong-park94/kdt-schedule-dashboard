// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyCohort,
  computeImpactMetrics,
  computeLeadingMetrics,
  computeMonthlyTrend,
  buildDiagnostics,
  loadInsightsConfig,
  saveInsightsConfig,
  INSIGHTS_CONFIG_KEY,
  DEFAULT_CUTOFF,
} from "../src/hrd/hrdDropoutInsights";
import type { DropoutRosterEntry } from "../src/hrd/hrdTypes";
import type { TraineeAnalysis } from "../src/hrd/hrdAnalyticsTypes";
import type { SatisfactionRecord } from "../src/hrd/hrdSatisfactionTypes";

// localStorage 폴리필 (다른 테스트와 동일 패턴 — hrdConfig.ensureCourseAndDegr.test.ts 참조)
function setupLocalStorage(): void {
  if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.removeItem !== "function") {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        key: (i: number) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; },
      },
      writable: true, configurable: true,
    });
  }
}
setupLocalStorage();

// ─── Helpers ─────────────────────────────────────────────────

function makeDropout(overrides: Partial<DropoutRosterEntry> = {}): DropoutRosterEntry {
  return {
    courseName: "재직자 LLM",
    trainPrId: "T001",
    degr: "5",
    category: "재직자",
    total: 10,
    dropout: 1,
    active: 9,
    defenseRate: 90,
    startDate: "2026-03-01",
    ...overrides,
  };
}

function makeTrainee(overrides: Partial<TraineeAnalysis> = {}): TraineeAnalysis {
  return {
    name: "학생A", birth: "20000101", age: 26,
    courseName: "재직자 LLM", trainPrId: "T001", category: "재직자", degr: "5",
    attendanceRate: 95, absentDays: 1, lateDays: 0, earlyLeaveDays: 0, excusedDays: 0,
    attendedDays: 95, totalDays: 100, maxAbsent: 20, remainingAbsent: 19,
    riskLevel: "safe", dropout: false, hasAttendanceData: true,
    absentByWeekday: [0, 0, 0, 0, 0, 0, 0], absentByMonth: [1],
    maxConsecutiveAbsent: 1, currentConsecutiveAbsent: 0,
    lateByHour: [0, 0, 0, 0, 0, 0],
    weeklyAttendanceRates: [95], dropoutWeekIdx: -1, alertReasons: [],
    courseStatus: "진행중", completionStatus: "훈련중",
    courseProgressRate: 50, courseStartDate: "2026-03-01",
    gender: "",
    ...overrides,
  };
}

function makeSat(overrides: Partial<SatisfactionRecord> = {}): SatisfactionRecord {
  return {
    과정명: "재직자 LLM",
    기수: "5기",
    모듈명: "기본",
    NPS: 50,
    강사만족도: 4.5,
    중간만족도: 4.0,
    최종만족도: 4.2,
    ...overrides,
  };
}

// ─── Config Storage ──────────────────────────────────────────

describe("Insights Config 저장/로드", () => {
  beforeEach(() => {
    localStorage.removeItem(INSIGHTS_CONFIG_KEY);
  });

  it("미저장 시 DEFAULT_CUTOFF 반환", () => {
    expect(loadInsightsConfig().cutoffDate).toBe(DEFAULT_CUTOFF);
  });

  it("save → load 라운드트립", () => {
    saveInsightsConfig({ cutoffDate: "2026-01-15" });
    expect(loadInsightsConfig().cutoffDate).toBe("2026-01-15");
  });

  it("손상된 JSON은 default 폴백", () => {
    localStorage.setItem(INSIGHTS_CONFIG_KEY, "{invalid");
    expect(loadInsightsConfig().cutoffDate).toBe(DEFAULT_CUTOFF);
  });

  it("빈 cutoffDate 저장 거부 → default 유지", () => {
    saveInsightsConfig({ cutoffDate: "" });
    expect(loadInsightsConfig().cutoffDate).toBe(DEFAULT_CUTOFF);
  });
});

// ─── classifyCohort ──────────────────────────────────────────

describe("classifyCohort", () => {
  it("startDate < cutoff → 'before'", () => {
    expect(classifyCohort({ startDate: "2026-02-01" }, "2026-03-01")).toBe("before");
  });

  it("startDate >= cutoff → 'after'", () => {
    expect(classifyCohort({ startDate: "2026-03-01" }, "2026-03-01")).toBe("after");
    expect(classifyCohort({ startDate: "2026-04-01" }, "2026-03-01")).toBe("after");
  });

  it("startDate 미설정/잘못된 → 'unknown'", () => {
    expect(classifyCohort({ startDate: "" }, "2026-03-01")).toBe("unknown");
    expect(classifyCohort({ startDate: "invalid" }, "2026-03-01")).toBe("unknown");
  });

  it("cutoff 미설정 → 'unknown' (잘못된 입력 보호)", () => {
    expect(classifyCohort({ startDate: "2026-03-01" }, "")).toBe("unknown");
  });
});

// ─── computeImpactMetrics ────────────────────────────────────

describe("computeImpactMetrics", () => {
  const cutoff = "2026-03-01";

  it("도입 전/후 평균 방어율 + delta 계산", () => {
    const entries: DropoutRosterEntry[] = [
      makeDropout({ degr: "1", startDate: "2026-01-01", defenseRate: 70, total: 10, dropout: 3 }),
      makeDropout({ degr: "2", startDate: "2026-02-01", defenseRate: 80, total: 10, dropout: 2 }),
      makeDropout({ degr: "3", startDate: "2026-03-15", defenseRate: 90, total: 10, dropout: 1 }),
      makeDropout({ degr: "4", startDate: "2026-04-15", defenseRate: 100, total: 10, dropout: 0 }),
    ];
    const m = computeImpactMetrics(entries, cutoff);
    expect(m.beforeN).toBe(2);
    expect(m.afterN).toBe(2);
    expect(m.beforeAvgRate).toBe(75); // (70+80)/2
    expect(m.afterAvgRate).toBe(95); // (90+100)/2
    expect(m.deltaPp).toBe(20);
    expect(m.beforeTotalStudents).toBe(20);
    expect(m.afterTotalStudents).toBe(20);
    // estimatedSavedHeadcount = (deltaPp/100) * afterTotalStudents = 0.2 * 20 = 4
    expect(m.estimatedSavedHeadcount).toBe(4);
  });

  it("표본 부족: before 0이면 모든 평균 0, delta 0", () => {
    const entries = [
      makeDropout({ degr: "3", startDate: "2026-03-15", defenseRate: 90, total: 10, dropout: 1 }),
    ];
    const m = computeImpactMetrics(entries, cutoff);
    expect(m.beforeN).toBe(0);
    expect(m.afterN).toBe(1);
    expect(m.beforeAvgRate).toBe(0);
    expect(m.deltaPp).toBe(0); // before가 없어서 delta 산출 불가
    expect(m.estimatedSavedHeadcount).toBe(0);
  });

  it("unknown 분류는 통계에 미포함", () => {
    const entries = [
      makeDropout({ degr: "1", startDate: "2026-01-01", defenseRate: 70, total: 10 }),
      makeDropout({ degr: "?", startDate: "", defenseRate: 50, total: 10 }), // unknown
      makeDropout({ degr: "3", startDate: "2026-04-01", defenseRate: 100, total: 10 }),
    ];
    const m = computeImpactMetrics(entries, cutoff);
    expect(m.beforeN).toBe(1);
    expect(m.afterN).toBe(1);
    expect(m.beforeAvgRate).toBe(70);
    expect(m.afterAvgRate).toBe(100);
  });

  it("개선이 없거나 악화된 경우 deltaPp 음수 가능, savedHeadcount는 0 클램프", () => {
    const entries = [
      makeDropout({ degr: "1", startDate: "2026-01-01", defenseRate: 90, total: 10, dropout: 1 }),
      makeDropout({ degr: "3", startDate: "2026-04-01", defenseRate: 80, total: 10, dropout: 2 }),
    ];
    const m = computeImpactMetrics(entries, cutoff);
    expect(m.deltaPp).toBe(-10);
    expect(m.estimatedSavedHeadcount).toBe(0); // 음수 delta는 0으로 클램프 (회의용 보수적 표현)
  });

  it("빈 배열 입력 → 모든 0", () => {
    const m = computeImpactMetrics([], cutoff);
    expect(m.beforeN).toBe(0);
    expect(m.afterN).toBe(0);
    expect(m.deltaPp).toBe(0);
  });
});

// ─── computeLeadingMetrics ───────────────────────────────────

describe("computeLeadingMetrics", () => {
  const cutoff = "2026-03-01";

  function makeEntriesAndAnalysis(spec: {
    cohort: { startDate: string; degr: string; courseName?: string };
    students: { maxConsec: number; dropout: boolean; risk?: TraineeAnalysis["riskLevel"] }[];
  }[]) {
    const entries: DropoutRosterEntry[] = spec.map((s) => ({
      courseName: s.cohort.courseName ?? "재직자 LLM",
      trainPrId: "T001",
      degr: s.cohort.degr,
      category: "재직자",
      total: s.students.length,
      dropout: s.students.filter((x) => x.dropout).length,
      active: s.students.filter((x) => !x.dropout).length,
      defenseRate: s.students.length > 0
        ? Math.round((s.students.filter((x) => !x.dropout).length / s.students.length) * 100)
        : 0,
      startDate: s.cohort.startDate,
    }));

    const analysis: TraineeAnalysis[] = spec.flatMap((s) =>
      s.students.map((stu, i) =>
        makeTrainee({
          name: `${s.cohort.degr}기-${i}`,
          courseName: s.cohort.courseName ?? "재직자 LLM",
          degr: s.cohort.degr,
          maxConsecutiveAbsent: stu.maxConsec,
          dropout: stu.dropout,
          riskLevel: stu.risk ?? (stu.maxConsec >= 3 ? "warning" : "safe"),
          courseStartDate: s.cohort.startDate,
        }),
      ),
    );

    return { entries, analysis };
  }

  it("위험군 회복률: maxConsec≥3 학생 중 비하차 비율을 cohort 단위로 평균", () => {
    const { entries, analysis } = makeEntriesAndAnalysis([
      // 도입 전 cohort: 4명 중 위험2명, 그중 회복1, 하차1 → 50%
      { cohort: { startDate: "2026-02-01", degr: "1" }, students: [
        { maxConsec: 5, dropout: false }, { maxConsec: 3, dropout: true },
        { maxConsec: 1, dropout: false }, { maxConsec: 0, dropout: false },
      ]},
      // 도입 후 cohort: 4명 중 위험2명, 둘 다 회복 → 100%
      { cohort: { startDate: "2026-03-15", degr: "5" }, students: [
        { maxConsec: 4, dropout: false }, { maxConsec: 3, dropout: false },
        { maxConsec: 0, dropout: false }, { maxConsec: 0, dropout: false },
      ]},
    ]);

    const m = computeLeadingMetrics(entries, analysis, [], cutoff);
    expect(m.riskRecovery.beforeValue).toBe(50);
    expect(m.riskRecovery.afterValue).toBe(100);
    expect(m.riskRecovery.delta).toBe(50);
    expect(m.riskRecovery.betterDirection).toBe("up");
  });

  it("신규 위험군 발생률: 전체 대비 위험(maxConsec≥3) 학생 비율을 cohort 단위로 평균", () => {
    const { entries, analysis } = makeEntriesAndAnalysis([
      { cohort: { startDate: "2026-02-01", degr: "1" }, students: [
        { maxConsec: 5, dropout: false }, { maxConsec: 3, dropout: false },
        { maxConsec: 0, dropout: false }, { maxConsec: 0, dropout: false },
      ]}, // 50%
      { cohort: { startDate: "2026-03-15", degr: "5" }, students: [
        { maxConsec: 3, dropout: false }, { maxConsec: 0, dropout: false },
        { maxConsec: 0, dropout: false }, { maxConsec: 0, dropout: false },
      ]}, // 25%
    ]);
    const m = computeLeadingMetrics(entries, analysis, [], cutoff);
    expect(m.riskOccurrence.beforeValue).toBe(50);
    expect(m.riskOccurrence.afterValue).toBe(25);
    expect(m.riskOccurrence.delta).toBe(-25);
    expect(m.riskOccurrence.betterDirection).toBe("down");
  });

  it("연속결석 끊기 성공률: maxConsec≥5 학생 중 비하차 비율", () => {
    const { entries, analysis } = makeEntriesAndAnalysis([
      { cohort: { startDate: "2026-02-01", degr: "1" }, students: [
        { maxConsec: 6, dropout: true }, { maxConsec: 5, dropout: false },
      ]}, // 1/2 = 50%
      { cohort: { startDate: "2026-03-15", degr: "5" }, students: [
        { maxConsec: 7, dropout: false }, { maxConsec: 5, dropout: false },
      ]}, // 2/2 = 100%
    ]);
    const m = computeLeadingMetrics(entries, analysis, [], cutoff);
    expect(m.consecAbsentBreak.beforeValue).toBe(50);
    expect(m.consecAbsentBreak.afterValue).toBe(100);
    expect(m.consecAbsentBreak.betterDirection).toBe("up");
  });

  it("NPS 변화: 만족도 시트와 cohort 매칭 → 평균", () => {
    const { entries, analysis } = makeEntriesAndAnalysis([
      { cohort: { startDate: "2026-02-01", degr: "1", courseName: "재직자 LLM" }, students: [
        { maxConsec: 0, dropout: false },
      ]},
      { cohort: { startDate: "2026-03-15", degr: "5", courseName: "재직자 LLM" }, students: [
        { maxConsec: 0, dropout: false },
      ]},
    ]);
    const sat: SatisfactionRecord[] = [
      makeSat({ 과정명: "재직자 LLM", 기수: "1기", NPS: 30 }),
      makeSat({ 과정명: "재직자 LLM", 기수: "5기", NPS: 60 }),
    ];
    const m = computeLeadingMetrics(entries, analysis, sat, cutoff);
    expect(m.npsChange.beforeValue).toBe(30);
    expect(m.npsChange.afterValue).toBe(60);
    expect(m.npsChange.delta).toBe(30);
  });

  it("위험군 0명인 cohort는 평균 산식에서 제외 (0으로 묻히지 않음)", () => {
    const { entries, analysis } = makeEntriesAndAnalysis([
      { cohort: { startDate: "2026-02-01", degr: "1" }, students: [
        { maxConsec: 0, dropout: false },
      ]}, // 위험 0명 → 회복률 산정 불가, 제외
      { cohort: { startDate: "2026-02-15", degr: "2" }, students: [
        { maxConsec: 5, dropout: false },
      ]}, // 회복률 100%
    ]);
    const m = computeLeadingMetrics(entries, analysis, [], cutoff);
    // cohort 1은 위험 0이라 제외됨 → cohort 2만으로 100%
    expect(m.riskRecovery.beforeValue).toBe(100);
  });
});

// ─── computeMonthlyTrend ─────────────────────────────────────

describe("computeMonthlyTrend (Phase 2 시계열 기반)", () => {
  it("startDate 월별로 그룹핑하고 평균 방어율 계산", () => {
    const entries = [
      makeDropout({ degr: "1", startDate: "2026-01-15", defenseRate: 80 }),
      makeDropout({ degr: "2", startDate: "2026-01-25", defenseRate: 90 }),
      makeDropout({ degr: "3", startDate: "2026-03-10", defenseRate: 100 }),
    ];
    const trend = computeMonthlyTrend(entries);
    expect(trend).toHaveLength(2);
    const jan = trend.find((t) => t.month === "2026-01");
    expect(jan?.defenseRate).toBe(85);
    expect(jan?.cohortCount).toBe(2);
    const mar = trend.find((t) => t.month === "2026-03");
    expect(mar?.defenseRate).toBe(100);
    expect(mar?.cohortCount).toBe(1);
  });

  it("startDate 미설정은 제외, 월 오름차순 정렬", () => {
    const entries = [
      makeDropout({ degr: "1", startDate: "2026-03-10", defenseRate: 100 }),
      makeDropout({ degr: "?", startDate: "", defenseRate: 50 }),
      makeDropout({ degr: "2", startDate: "2026-01-15", defenseRate: 80 }),
    ];
    const trend = computeMonthlyTrend(entries);
    expect(trend).toHaveLength(2);
    expect(trend[0].month).toBe("2026-01");
    expect(trend[1].month).toBe("2026-03");
  });

  it("빈 배열 → 빈 결과", () => {
    expect(computeMonthlyTrend([])).toEqual([]);
  });
});

// ─── buildDiagnostics ────────────────────────────────────────

describe("buildDiagnostics", () => {
  const cutoff = "2026-03-01";

  it("before/after cohort 라벨 + 만족도 누락 + 표본부족 경고", () => {
    const entries = [
      makeDropout({ courseName: "재직자 LLM", degr: "1", startDate: "2026-02-01" }),
      makeDropout({ courseName: "재직자 LLM", degr: "5", startDate: "2026-03-15" }),
    ];
    const sat: SatisfactionRecord[] = [
      makeSat({ 과정명: "재직자 LLM", 기수: "5기", NPS: 30 }),
      // 1기 만족도 없음 → missing
    ];
    const d = buildDiagnostics(entries, sat, cutoff);
    expect(d.beforeCohorts).toContain("재직자 LLM 1기");
    expect(d.afterCohorts).toContain("재직자 LLM 5기");
    expect(d.missingNpsCohorts).toContain("재직자 LLM 1기");
    expect(d.insufficientSample).toBe(true); // before<2 또는 after<2
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("표본 충분 시 insufficientSample false", () => {
    const entries = [
      makeDropout({ degr: "1", startDate: "2026-01-01" }),
      makeDropout({ degr: "2", startDate: "2026-02-01" }),
      makeDropout({ degr: "5", startDate: "2026-03-15" }),
      makeDropout({ degr: "6", startDate: "2026-04-15" }),
    ];
    const d = buildDiagnostics(entries, [], cutoff);
    expect(d.insufficientSample).toBe(false);
  });
});
