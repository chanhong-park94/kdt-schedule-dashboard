/**
 * 매출 계산 엔진
 *
 * HRD-Net 출결 데이터를 기반으로 과정/기수별 훈련비 매출을 산정합니다.
 * - 인당 시간당 훈련비: 18,150원 (모든 과정 공통)
 * - 단위기간: 개강일 기준 매월 (예: 1/15~2/14)
 * - 단위기간 내 80%+ 출석 → 전체 훈련비, 미만 → 출석일만 산정
 * - 공결은 출석 인정 (훈련비 산정 포함)
 *
 * 수업일 판정:
 *   - 과거(오늘 미만): HRD-Net 출결 데이터에 일자가 존재하면 수업일 (자체 휴강 자동 반영)
 *   - 미래/오늘: 요일별 수업 패턴 + 한국 공휴일 API (date.nager.at)
 *
 * 요일별 시간 (점심시간 1h 제외):
 *   - 실업자: 월~금 7h
 *   - 재직자 LLM/데이터: 화~금 2.5h, 토 7h
 *   - 재직자 기획/개발: 화~금 2.0h, 토 7h
 *   - course.dowHours 가 명시되면 자동 매핑보다 우선
 */
import type {
  HrdCourse,
  AttendanceDayRecord,
  AttendanceStudent,
  CourseCategory,
  DayOfWeekHours,
  EmployedSubCategory,
} from "./hrdTypes";
import { isAttendedStatus, isExcusedStatus } from "./hrdTypes";
import type {
  UnitPeriod,
  TraineeUnitRevenue,
  PeriodRevenue,
  CohortRevenue,
} from "./hrdRevenueTypes";

// 인당 시간당 훈련비 (원) — 모든 과정 공통
export const COST_PER_PERSON_HOUR = 18_150;
// 단위기간 출석 기준
const UNIT_PERIOD_THRESHOLD = 0.8;

// ─── 요일별 시간 매핑 (운영 정책 default) ──────────────────

const DEFAULT_DOW_UNEMPLOYED: DayOfWeekHours = {
  "1": 7, "2": 7, "3": 7, "4": 7, "5": 7,
};
const DEFAULT_DOW_EMPLOYED_2_5H: DayOfWeekHours = {
  "2": 2.5, "3": 2.5, "4": 2.5, "5": 2.5, "6": 7,
};
const DEFAULT_DOW_EMPLOYED_2_0H: DayOfWeekHours = {
  "2": 2.0, "3": 2.0, "4": 2.0, "5": 2.0, "6": 7,
};

/** degr 코드 10의 자리 → 재직자 sub-category 자동 판별
 *  parseCohortCode 와 동일 규칙: 0→LLM, 1→데이터, 2→기획개발 */
export function parseEmployedSubCategoryFromDegr(degr: string): EmployedSubCategory | null {
  const num = parseInt(degr.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(num)) return null;
  const prefix = Math.floor(num / 10);
  if (prefix === 0) return "LLM";
  if (prefix === 1) return "데이터";
  if (prefix === 2) return "기획개발";
  return null;
}

/** 카테고리 + sub-category 기반 default 시간 매핑 */
export function getDefaultDowHours(
  category: CourseCategory,
  sub: EmployedSubCategory | null,
): DayOfWeekHours {
  if (category === "실업자") return { ...DEFAULT_DOW_UNEMPLOYED };
  if (sub === "기획개발") return { ...DEFAULT_DOW_EMPLOYED_2_0H };
  // LLM, 데이터, 또는 미판별 — 보수적으로 2.5h
  return { ...DEFAULT_DOW_EMPLOYED_2_5H };
}

/** 과정+기수에 적용될 요일별 시간 결정
 *  우선순위: course.dowHours > course.employedSubCategory > degr 코드 자동 판별 > 카테고리 default */
export function resolveDowHours(course: HrdCourse, degr: string): DayOfWeekHours {
  if (course.dowHours && Object.keys(course.dowHours).length > 0) {
    return { ...course.dowHours };
  }
  const category = course.category || "실업자";
  if (category === "실업자") {
    return getDefaultDowHours(category, null);
  }
  // 재직자: sub 명시 > degr 코드 자동 판별
  const sub = course.employedSubCategory || parseEmployedSubCategoryFromDegr(degr);
  return getDefaultDowHours(category, sub);
}

/** 특정 요일의 훈련시간 (없으면 0) */
function hoursForDow(dow: DayOfWeekHours, day: number): number {
  const v = dow[String(day) as keyof DayOfWeekHours];
  return typeof v === "number" && v > 0 ? v : 0;
}

// ─── 수업일 판정 ──────────────────────────────────────────

/** 요일이 수업 가능한 요일인지 — 카테고리별 기본 (공휴일/휴강 미고려) */
function isPotentialClassDay(date: Date, dowHours: DayOfWeekHours): boolean {
  return hoursForDow(dowHours, date.getDay()) > 0;
}

/** YYYY-MM-DD 포맷 */
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── 단위기간 생성 (async — 공휴일 API + HRD SSOT) ────────

export interface ClassDayContext {
  /** HRD-Net 출결 데이터에 1건이라도 존재한 날짜 set (YYYY-MM-DD) — 과거 시점 SSOT */
  hrdAttendanceDates: Set<string>;
  /** 공휴일 set (YYYY-MM-DD) */
  holidays: Set<string>;
  /** "오늘" 기준일 — 이 날 이전은 HRD SSOT 우선, 이후는 요일+공휴일 추정 */
  today: Date;
}

/** 특정 날짜가 수업일인지 — HRD SSOT(과거) + 요일·공휴일(미래) 하이브리드 */
function isClassDay(date: Date, dowHours: DayOfWeekHours, ctx: ClassDayContext): boolean {
  const dStr = fmt(date);
  const isPast = date < ctx.today;
  if (isPast) {
    // 과거: HRD-Net에 그 날 출결 기록이 있으면 수업일 (자체 휴강 자동 반영)
    return ctx.hrdAttendanceDates.has(dStr);
  }
  // 미래/오늘: 요일 + 공휴일 (자체 휴강은 미래엔 알 수 없음)
  if (!isPotentialClassDay(date, dowHours)) return false;
  if (ctx.holidays.has(dStr)) return false;
  return true;
}

/** 개강일 기준 단위기간 목록 생성 — totalDays까지 누적 */
export function generateUnitPeriods(
  startDateStr: string,
  totalDays: number,
  dowHours: DayOfWeekHours,
  ctx: ClassDayContext,
): UnitPeriod[] {
  if (!startDateStr) return [];
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return [];

  const periods: UnitPeriod[] = [];
  let cumulativeDays = 0;
  let periodStart = new Date(start);

  while (cumulativeDays < totalDays) {
    // 단위기간 종료일 = 시작일 + 1개월 - 1일 (JS setMonth 경계 함정 회피)
    let periodEnd = addOneMonthMinusOneDay(periodStart);

    // 이 기간 내 수업일 카운트 + 마지막 수업일 추적 (totalDays cap 도달 시 periodEnd 클램프용)
    let trainingDays = 0;
    let lastClassDay: Date | null = null;
    const cursor = new Date(periodStart);
    while (cursor <= periodEnd && cumulativeDays + trainingDays < totalDays) {
      if (isClassDay(cursor, dowHours, ctx)) {
        trainingDays++;
        lastClassDay = new Date(cursor);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    // totalDays cap 에 정확히 도달 → 마지막 수업일까지로 periodEnd 잘라줌
    // (sumPeriodHours 가 cap 너머 시간까지 합산되는 버그 방지)
    if (cumulativeDays + trainingDays >= totalDays && lastClassDay) {
      periodEnd = lastClassDay;
    }

    if (trainingDays > 0) {
      periods.push({
        index: periods.length,
        startDate: fmt(periodStart),
        endDate: fmt(periodEnd),
        trainingDays,
      });
    }

    cumulativeDays += trainingDays;
    if (trainingDays === 0) break; // 무한 루프 방지 — 더 이상 수업일이 없음

    periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() + 1);
  }

  return periods;
}

/** d + 1개월 - 1일 — 1/31 + 1개월 = 2월 말일이 되도록 클램프 */
function addOneMonthMinusOneDay(d: Date): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  // 다음달 같은 날(또는 그 달 말일) → 거기서 -1일
  const targetMonth = m + 1;
  const lastOfTargetMonth = new Date(y, targetMonth + 1, 0).getDate();
  const safeDay = Math.min(day, lastOfTargetMonth);
  const result = new Date(y, targetMonth, safeDay);
  result.setDate(result.getDate() - 1);
  return result;
}

// ─── 훈련생별 단위기간 매출 ──────────────────────────────────

function getRecordsForPeriod(records: AttendanceDayRecord[], period: UnitPeriod): AttendanceDayRecord[] {
  return records.filter((r) => r.date >= period.startDate && r.date <= period.endDate);
}

/** 단위기간 내 모든 수업일의 시간 합 */
function sumPeriodHours(period: UnitPeriod, dowHours: DayOfWeekHours, ctx: ClassDayContext): number {
  let total = 0;
  const cursor = new Date(period.startDate);
  const end = new Date(period.endDate);
  while (cursor <= end) {
    if (isClassDay(cursor, dowHours, ctx)) {
      total += hoursForDow(dowHours, cursor.getDay());
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

/** 출석/공결한 날들의 시간 합 */
function sumPaidHours(
  records: AttendanceDayRecord[],
  period: UnitPeriod,
  dowHours: DayOfWeekHours,
): number {
  const paidRecords = getRecordsForPeriod(records, period).filter(
    (r) => isAttendedStatus(r.status) || isExcusedStatus(r.status),
  );
  let total = 0;
  for (const r of paidRecords) {
    const d = new Date(r.date);
    total += hoursForDow(dowHours, d.getDay());
  }
  return total;
}

/** 훈련생 1명의 단위기간 매출 계산 (요일별 시간 가중) */
export function calcTraineeUnitRevenue(
  name: string,
  records: AttendanceDayRecord[],
  period: UnitPeriod,
  dowHours: DayOfWeekHours,
  ctx: ClassDayContext,
): TraineeUnitRevenue {
  const periodRecords = getRecordsForPeriod(records, period);
  // 출석 + 공결 = 훈련비 인정일
  const paidDays = periodRecords.filter((r) => isAttendedStatus(r.status) || isExcusedStatus(r.status)).length;
  const attendanceRatio = period.trainingDays > 0 ? paidDays / period.trainingDays : 0;
  const meetsThreshold = attendanceRatio >= UNIT_PERIOD_THRESHOLD;

  // 80% 이상: 단위기간 전체 시간, 미만: 출석/공결한 날의 시간만
  const billableHours = meetsThreshold
    ? sumPeriodHours(period, dowHours, ctx)
    : sumPaidHours(records, period, dowHours);
  const revenue = billableHours * COST_PER_PERSON_HOUR;

  return { traineeName: name, paidDays, periodDays: period.trainingDays, attendanceRatio, meetsThreshold, revenue };
}

// ─── 과정/기수별 매출 ────────────────────────────────────────

/** 과정/기수 단위 매출 계산
 *  ⚠️ ctx.hrdAttendanceDates 는 호출자가 해당 과정/기수의 모든 학생 출결을 union 한 set 이어야 함 */
export function calcCohortRevenue(
  course: HrdCourse,
  degr: string,
  students: AttendanceStudent[],
  dailyRecordsMap: Map<string, AttendanceDayRecord[]>,
  ctx: ClassDayContext,
): CohortRevenue {
  const category = course.category || "실업자";
  const dowHours = resolveDowHours(course, degr);
  const periods = generateUnitPeriods(course.startDate, course.totalDays, dowHours, ctx);

  const activeStudents = students.filter((s) => !s.dropout);
  const dropoutStudents = students.filter((s) => s.dropout);

  const periodRevenues: PeriodRevenue[] = periods.map((period) => {
    const trainees: TraineeUnitRevenue[] = activeStudents.map((s) => {
      const records = dailyRecordsMap.get(s.name.replace(/\s+/g, "")) || [];
      return calcTraineeUnitRevenue(s.name, records, period, dowHours, ctx);
    });

    const totalRevenue = trainees.reduce((sum, t) => sum + t.revenue, 0);
    const periodHourSum = sumPeriodHours(period, dowHours, ctx);
    const maxRevenue = activeStudents.length * periodHourSum * COST_PER_PERSON_HOUR;

    return {
      period,
      trainees,
      totalRevenue,
      maxRevenue,
      lostRevenue: maxRevenue - totalRevenue,
    };
  });

  // 하차 손실: 마지막 출석/공결 기록일 다음부터 종강일까지의 시간 합
  let dropoutLoss = 0;
  for (const s of dropoutStudents) {
    const records = dailyRecordsMap.get(s.name.replace(/\s+/g, "")) || [];
    // 출석/공결 기록 중 가장 마지막 일자만 유효 (결석 일자는 의미 없음)
    const paidDates = records
      .filter((r) => isAttendedStatus(r.status) || isExcusedStatus(r.status))
      .map((r) => r.date)
      .sort();
    const lastPaidDate = paidDates.length > 0 ? paidDates[paidDates.length - 1] : "";
    for (const period of periods) {
      if (period.startDate > lastPaidDate) {
        // 기간 전체 손실
        dropoutLoss += sumPeriodHours(period, dowHours, ctx) * COST_PER_PERSON_HOUR;
      } else if (period.endDate > lastPaidDate && lastPaidDate >= period.startDate) {
        // 기간 중간 하차 — lastPaidDate 다음날 ~ periodEnd 까지 손실
        const start = new Date(lastPaidDate);
        start.setDate(start.getDate() + 1);
        const end = new Date(period.endDate);
        let lostHours = 0;
        const cursor = new Date(start);
        while (cursor <= end) {
          if (isClassDay(cursor, dowHours, ctx)) {
            lostHours += hoursForDow(dowHours, cursor.getDay());
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        dropoutLoss += lostHours * COST_PER_PERSON_HOUR;
      }
    }
  }

  const totalRevenue = periodRevenues.reduce((sum, p) => sum + p.totalRevenue, 0);
  const maxRevenue = periodRevenues.reduce((sum, p) => sum + p.maxRevenue, 0);
  // hoursPerDay 필드는 deprecated — 평균 시간으로 후방호환 표시
  const avgHoursPerDay = periods.length > 0
    ? periods.reduce((s, p) => s + sumPeriodHours(p, dowHours, ctx) / Math.max(1, p.trainingDays), 0) / periods.length
    : 0;

  return {
    courseName: course.name,
    trainPrId: course.trainPrId,
    degr,
    category,
    hoursPerDay: avgHoursPerDay,
    periods: periodRevenues,
    totalRevenue,
    maxRevenue,
    lostRevenue: maxRevenue - totalRevenue,
    dropoutLoss,
    activeTrainees: activeStudents.length,
    dropoutCount: dropoutStudents.length,
  };
}

// ─── 금액 포맷 ──────────────────────────────────────────────

/** 금액을 한국어 형식으로 포맷 (억/만 단위) */
export function formatRevenue(amount: number): string {
  if (amount >= 100_000_000) {
    const eok = Math.floor(amount / 100_000_000);
    const man = Math.floor((amount % 100_000_000) / 10_000);
    return man > 0 ? `${eok}억 ${man.toLocaleString()}만원` : `${eok}억원`;
  }
  if (amount >= 10_000) {
    return `${Math.floor(amount / 10_000).toLocaleString()}만원`;
  }
  return `${amount.toLocaleString()}원`;
}
