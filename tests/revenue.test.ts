import { describe, expect, it } from "vitest";

import {
  COST_PER_PERSON_HOUR,
  parseEmployedSubCategoryFromDegr,
  getDefaultDowHours,
  resolveDowHours,
  generateUnitPeriods,
  calcTraineeUnitRevenue,
  calcCohortRevenue,
  type ClassDayContext,
} from "../src/hrd/hrdRevenue";
import type { HrdCourse, AttendanceDayRecord, AttendanceStudent } from "../src/hrd/hrdTypes";

// ─── 테스트 헬퍼 ───────────────────────────────────────────

function mkCourse(overrides: Partial<HrdCourse> = {}): HrdCourse {
  return {
    name: "테스트과정",
    trainPrId: "TRN001",
    degrs: ["1"],
    startDate: "2026-05-01",
    totalDays: 60,
    endTime: "18:00",
    category: "실업자",
    ...overrides,
  };
}

function mkRecord(date: string, status: AttendanceDayRecord["status"] = "출석"): AttendanceDayRecord {
  return { date, dayOfWeek: "", status, inTime: "", outTime: "" };
}

function mkStudent(name: string, dropout = false): AttendanceStudent {
  return {
    name,
    birth: "",
    status: "-",
    inTime: "",
    outTime: "",
    dropout,
    traineeStatus: "훈련중",
    hrdStatusRaw: "",
    riskLevel: "safe",
    totalDays: 60,
    attendedDays: 0,
    absentDays: 0,
    excusedDays: 0,
    maxAbsent: 12,
    remainingAbsent: 12,
    attendanceRate: 0,
    missingCheckout: false,
    gender: "",
  } as AttendanceStudent;
}

/** ClassDayContext 헬퍼 — 모든 일자를 SSOT로 인정하면 자체 휴강은 hrdAttendanceDates에서 제외해 시뮬레이션 */
function ctxFor(
  startDate: string,
  endDate: string,
  todayStr: string,
  hrdAttendanceDates: string[] = [],
  holidays: string[] = [],
): ClassDayContext {
  void startDate;
  void endDate;
  return {
    hrdAttendanceDates: new Set(hrdAttendanceDates),
    holidays: new Set(holidays),
    today: new Date(todayStr),
  };
}

// ─── parseEmployedSubCategoryFromDegr ──────────────────────

describe("parseEmployedSubCategoryFromDegr", () => {
  it("0X → LLM", () => {
    expect(parseEmployedSubCategoryFromDegr("1")).toBe("LLM");
    expect(parseEmployedSubCategoryFromDegr("9")).toBe("LLM");
    expect(parseEmployedSubCategoryFromDegr("01")).toBe("LLM");
  });

  it("1X → 데이터", () => {
    expect(parseEmployedSubCategoryFromDegr("11")).toBe("데이터");
    expect(parseEmployedSubCategoryFromDegr("19")).toBe("데이터");
  });

  it("2X → 기획개발", () => {
    expect(parseEmployedSubCategoryFromDegr("21")).toBe("기획개발");
    expect(parseEmployedSubCategoryFromDegr("29")).toBe("기획개발");
  });

  it("범위 밖은 null", () => {
    expect(parseEmployedSubCategoryFromDegr("99")).toBe(null);
    expect(parseEmployedSubCategoryFromDegr("abc")).toBe(null);
  });
});

// ─── getDefaultDowHours ─────────────────────────────────────

describe("getDefaultDowHours", () => {
  it("실업자: 월~금 7h", () => {
    const h = getDefaultDowHours("실업자", null);
    expect(h["1"]).toBe(7);
    expect(h["5"]).toBe(7);
    expect(h["6"]).toBeUndefined(); // 토요일 수업 없음
    expect(h["0"]).toBeUndefined();
  });

  it("재직자 LLM: 화~금 2.5h, 토 7h", () => {
    const h = getDefaultDowHours("재직자", "LLM");
    expect(h["1"]).toBeUndefined(); // 월요일 수업 없음
    expect(h["2"]).toBe(2.5);
    expect(h["5"]).toBe(2.5);
    expect(h["6"]).toBe(7);
  });

  it("재직자 데이터: 화~금 2.5h, 토 7h", () => {
    const h = getDefaultDowHours("재직자", "데이터");
    expect(h["3"]).toBe(2.5);
    expect(h["6"]).toBe(7);
  });

  it("재직자 기획개발: 화~금 2.0h, 토 7h", () => {
    const h = getDefaultDowHours("재직자", "기획개발");
    expect(h["2"]).toBe(2.0);
    expect(h["5"]).toBe(2.0);
    expect(h["6"]).toBe(7);
  });
});

// ─── resolveDowHours 우선순위 ──────────────────────────────

describe("resolveDowHours", () => {
  it("course.dowHours 가 있으면 그것을 우선", () => {
    const course = mkCourse({ dowHours: { "3": 5 } });
    const h = resolveDowHours(course, "1");
    expect(h["3"]).toBe(5);
    expect(h["1"]).toBeUndefined(); // 명시되지 않은 요일은 0
  });

  it("재직자: degr 코드 → 자동 sub-category 판별", () => {
    // degr=1 (0X) → LLM → 화~금 2.5h
    const course = mkCourse({ category: "재직자", degrs: ["1"] });
    expect(resolveDowHours(course, "1")["2"]).toBe(2.5);

    // degr=21 (2X) → 기획개발 → 화~금 2.0h
    expect(resolveDowHours(course, "21")["2"]).toBe(2.0);
  });

  it("재직자 employedSubCategory 가 명시되면 자동 판별보다 우선", () => {
    const course = mkCourse({
      category: "재직자",
      employedSubCategory: "기획개발",
      degrs: ["1"], // degr=1 이지만 명시값 우선
    });
    expect(resolveDowHours(course, "1")["2"]).toBe(2.0); // 기획개발 시간
  });

  it("실업자는 sub-category 무관", () => {
    expect(resolveDowHours(mkCourse(), "1")["1"]).toBe(7);
    expect(resolveDowHours(mkCourse(), "21")["1"]).toBe(7);
  });
});

// ─── generateUnitPeriods (5월 공휴일 시나리오) ─────────────

describe("generateUnitPeriods — 5월 공휴일", () => {
  it("실업자 5/1 개강 5일 짜리 단위기간 — 어린이날(5/5) 제외 확인", () => {
    // 5/1(금), 5/2(토), 5/3(일), 5/4(월), 5/5(화)=어린이날, 5/6(수), 5/7(목), 5/8(금)
    // 실업자 = 월~금만 수업, 토일 제외
    // 미래 시점(today=2026-04-30)으로 해서 미래 추정 로직 사용
    const dowHours = getDefaultDowHours("실업자", null);
    const ctx: ClassDayContext = {
      hrdAttendanceDates: new Set(),
      holidays: new Set(["2026-05-05"]),
      today: new Date("2026-04-30"),
    };
    const periods = generateUnitPeriods("2026-05-01", 5, dowHours, ctx);
    expect(periods).toHaveLength(1);
    // 5/1, 5/4, 5/6, 5/7, 5/8 = 5일 (5/5 제외)
    expect(periods[0].trainingDays).toBe(5);
    expect(periods[0].startDate).toBe("2026-05-01");
  });

  it("HRD SSOT — 과거 자체 휴강 자동 반영", () => {
    // 4/27~5/1 (월~금) 중 4/29(수)에 자체휴강 → HRD에 그 날 출결 데이터 없음
    // today = 2026-05-10 (모두 과거)
    const dowHours = getDefaultDowHours("실업자", null);
    const ctx: ClassDayContext = {
      hrdAttendanceDates: new Set(["2026-04-27", "2026-04-28", "2026-04-30", "2026-05-01"]),
      // 4/29 빠짐 = 자체 휴강
      holidays: new Set(),
      today: new Date("2026-05-10"),
    };
    const periods = generateUnitPeriods("2026-04-27", 4, dowHours, ctx);
    expect(periods[0].trainingDays).toBe(4); // 4일 (4/29 자체휴강 자동 제외)
  });
});

// ─── 요일별 시간 가중 매출 계산 ─────────────────────────────

describe("calcTraineeUnitRevenue — 요일별 시간 가중", () => {
  it("재직자 LLM 1주: 화~금 4일 × 2.5h + 토 1일 × 7h = 17h", () => {
    // 5/5(화)=공휴일이지만 무시하고 5/12(화) 부터 1주 시뮬레이션
    // 5/12~5/16: 화/수/목/금/토
    const dowHours = getDefaultDowHours("재직자", "LLM");
    const period = {
      index: 0,
      startDate: "2026-05-12",
      endDate: "2026-05-16",
      trainingDays: 5, // 화~토
    };
    const ctx: ClassDayContext = {
      hrdAttendanceDates: new Set(),
      holidays: new Set(),
      today: new Date("2026-05-01"), // 미래 시점 추정
    };
    // 모든 날 출석 가정
    const records: AttendanceDayRecord[] = [
      mkRecord("2026-05-12"),
      mkRecord("2026-05-13"),
      mkRecord("2026-05-14"),
      mkRecord("2026-05-15"),
      mkRecord("2026-05-16"),
    ];
    const result = calcTraineeUnitRevenue("홍길동", records, period, dowHours, ctx);
    // billableHours = 4×2.5 + 1×7 = 17h
    expect(result.revenue).toBe(17 * COST_PER_PERSON_HOUR);
    expect(result.meetsThreshold).toBe(true);
  });

  it("재직자 기획개발 1주: 화~금 4일 × 2.0h + 토 1일 × 7h = 15h", () => {
    const dowHours = getDefaultDowHours("재직자", "기획개발");
    const period = {
      index: 0,
      startDate: "2026-05-12",
      endDate: "2026-05-16",
      trainingDays: 5,
    };
    const ctx: ClassDayContext = {
      hrdAttendanceDates: new Set(),
      holidays: new Set(),
      today: new Date("2026-05-01"),
    };
    const records: AttendanceDayRecord[] = [
      mkRecord("2026-05-12"),
      mkRecord("2026-05-13"),
      mkRecord("2026-05-14"),
      mkRecord("2026-05-15"),
      mkRecord("2026-05-16"),
    ];
    const result = calcTraineeUnitRevenue("김철수", records, period, dowHours, ctx);
    expect(result.revenue).toBe(15 * COST_PER_PERSON_HOUR);
  });

  it("실업자 1주(월~금): 5일 × 7h = 35h", () => {
    const dowHours = getDefaultDowHours("실업자", null);
    const period = {
      index: 0,
      startDate: "2026-05-11",
      endDate: "2026-05-15",
      trainingDays: 5,
    };
    const ctx: ClassDayContext = {
      hrdAttendanceDates: new Set(),
      holidays: new Set(),
      today: new Date("2026-05-01"),
    };
    const records = [
      mkRecord("2026-05-11"),
      mkRecord("2026-05-12"),
      mkRecord("2026-05-13"),
      mkRecord("2026-05-14"),
      mkRecord("2026-05-15"),
    ];
    const result = calcTraineeUnitRevenue("이영희", records, period, dowHours, ctx);
    expect(result.revenue).toBe(35 * COST_PER_PERSON_HOUR);
  });

  it("80% 미달 시 출석한 날 시간만 정산", () => {
    // 실업자 5일 중 3일만 출석 = 60% < 80%
    const dowHours = getDefaultDowHours("실업자", null);
    const period = {
      index: 0,
      startDate: "2026-05-11",
      endDate: "2026-05-15",
      trainingDays: 5,
    };
    const ctx: ClassDayContext = {
      hrdAttendanceDates: new Set(),
      holidays: new Set(),
      today: new Date("2026-05-01"),
    };
    const records = [
      mkRecord("2026-05-11"),
      mkRecord("2026-05-12"),
      mkRecord("2026-05-13"),
      // 5/14, 5/15 결석
    ];
    const result = calcTraineeUnitRevenue("박학생", records, period, dowHours, ctx);
    expect(result.meetsThreshold).toBe(false);
    expect(result.revenue).toBe(3 * 7 * COST_PER_PERSON_HOUR); // 3일 × 7h
  });
});

// ─── 5월 공휴일 통합 시나리오 ───────────────────────────────

describe("calcCohortRevenue — 5월 공휴일/요일별 시간 통합", () => {
  it("실업자 1기, 5/1 개강 1주차: 5/5(어린이날) 제외 4일", () => {
    const course = mkCourse({
      startDate: "2026-05-01",
      totalDays: 4,
      category: "실업자",
    });
    const records: AttendanceDayRecord[] = [
      mkRecord("2026-05-01"),
      mkRecord("2026-05-04"),
      mkRecord("2026-05-06"),
      mkRecord("2026-05-07"),
      // 5/5 어린이날 — 출결 기록 없어야 정상
    ];
    const dailyMap = new Map([["홍길동", records]]);
    const ctx: ClassDayContext = {
      hrdAttendanceDates: new Set(["2026-05-01", "2026-05-04", "2026-05-06", "2026-05-07"]),
      holidays: new Set(["2026-05-05"]),
      today: new Date("2026-05-15"),
    };

    const result = calcCohortRevenue(course, "1", [mkStudent("홍길동")], dailyMap, ctx);

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0].period.trainingDays).toBe(4); // 5/5 제외
    // 매출 = 4일 × 7h × 18,150 = 508,200
    expect(result.totalRevenue).toBe(4 * 7 * COST_PER_PERSON_HOUR);
  });
});
