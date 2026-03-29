/**
 * 매출 계산 엔진
 *
 * HRD-Net 출결 데이터를 기반으로 과정/기수별 훈련비 매출을 산정합니다.
 * - 인당 시간당 훈련비: 18,150원
 * - 단위기간: 개강일 기준 매월 (예: 1/15~2/14)
 * - 단위기간 내 80%+ 출석 → 전체 훈련비, 미만 → 출석일만 산정
 * - 공결은 출석 인정 (훈련비 산정 포함)
 */
import type { HrdConfig, HrdCourse, AttendanceDayRecord, AttendanceStudent, CourseCategory } from "./hrdTypes";
import { isAttendedStatus, isExcusedStatus } from "./hrdTypes";
import type { UnitPeriod, TraineeUnitRevenue, PeriodRevenue, CohortRevenue, RevenueSummary } from "./hrdRevenueTypes";

// 인당 시간당 훈련비 (원)
export const COST_PER_PERSON_HOUR = 18_150;
// 단위기간 출석 기준
const UNIT_PERIOD_THRESHOLD = 0.8;

// ─── 단위기간 생성 ──────────────────────────────────────────

/** 특정 날짜가 수업일인지 판단 */
function isClassDay(date: Date, category: CourseCategory): boolean {
  const day = date.getDay();
  return category === "재직자" ? day >= 2 && day <= 6 : day >= 1 && day <= 5;
}

/** 개강일 기준 단위기간 목록 생성 */
export function generateUnitPeriods(
  startDateStr: string,
  totalDays: number,
  category: CourseCategory,
): UnitPeriod[] {
  if (!startDateStr) return [];
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return [];

  const periods: UnitPeriod[] = [];
  let cumulativeDays = 0;
  let periodStart = new Date(start);

  while (cumulativeDays < totalDays) {
    // 단위기간 종료일: 시작일 + 1개월 - 1일
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);

    // 이 기간 내 수업일 카운트
    let trainingDays = 0;
    const cursor = new Date(periodStart);
    while (cursor <= periodEnd && cumulativeDays + trainingDays < totalDays) {
      if (isClassDay(cursor, category)) {
        trainingDays++;
      }
      cursor.setDate(cursor.getDate() + 1);
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
    // 다음 기간 시작
    periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() + 1);
  }

  return periods;
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── 훈련생별 단위기간 매출 ──────────────────────────────────

/** 특정 기간 내 훈련생 출결 기록 필터 */
function getRecordsForPeriod(records: AttendanceDayRecord[], period: UnitPeriod): AttendanceDayRecord[] {
  return records.filter((r) => r.date >= period.startDate && r.date <= period.endDate);
}

/** 훈련생 1명의 단위기간 매출 계산 */
export function calcTraineeUnitRevenue(
  name: string,
  records: AttendanceDayRecord[],
  period: UnitPeriod,
  hoursPerDay: number,
): TraineeUnitRevenue {
  const periodRecords = getRecordsForPeriod(records, period);
  // 출석 + 공결 = 훈련비 인정일
  const paidDays = periodRecords.filter((r) => isAttendedStatus(r.status) || isExcusedStatus(r.status)).length;
  const attendanceRatio = period.trainingDays > 0 ? paidDays / period.trainingDays : 0;
  const meetsThreshold = attendanceRatio >= UNIT_PERIOD_THRESHOLD;

  // 80% 이상: 전체 훈련일 × 시간 × 단가, 미만: 출석일만
  const billableDays = meetsThreshold ? period.trainingDays : paidDays;
  const revenue = billableDays * hoursPerDay * COST_PER_PERSON_HOUR;

  return { traineeName: name, paidDays, periodDays: period.trainingDays, attendanceRatio, meetsThreshold, revenue };
}

// ─── 과정/기수별 매출 ────────────────────────────────────────

/** 과정/기수 단위 매출 계산 */
export function calcCohortRevenue(
  course: HrdCourse,
  degr: string,
  students: AttendanceStudent[],
  dailyRecordsMap: Map<string, AttendanceDayRecord[]>,
): CohortRevenue {
  const category = course.category || "실업자";
  const hoursPerDay = course.trainingHoursPerDay || 8;
  const periods = generateUnitPeriods(course.startDate, course.totalDays, category);

  const activeStudents = students.filter((s) => !s.dropout);
  const dropoutStudents = students.filter((s) => s.dropout);

  const periodRevenues: PeriodRevenue[] = periods.map((period) => {
    const trainees: TraineeUnitRevenue[] = activeStudents.map((s) => {
      const records = dailyRecordsMap.get(s.name.replace(/\s+/g, "")) || [];
      return calcTraineeUnitRevenue(s.name, records, period, hoursPerDay);
    });

    const totalRevenue = trainees.reduce((sum, t) => sum + t.revenue, 0);
    const maxRevenue = activeStudents.length * period.trainingDays * hoursPerDay * COST_PER_PERSON_HOUR;

    return {
      period,
      trainees,
      totalRevenue,
      maxRevenue,
      lostRevenue: maxRevenue - totalRevenue,
    };
  });

  // 하차 손실: 탈락자의 잔여 기간 예상 매출
  let dropoutLoss = 0;
  for (const s of dropoutStudents) {
    const records = dailyRecordsMap.get(s.name.replace(/\s+/g, "")) || [];
    const lastDate = records.length > 0 ? records[records.length - 1].date : "";
    // 마지막 출석일 이후 기간의 매출을 손실로 계산
    for (const period of periods) {
      if (period.startDate > lastDate) {
        dropoutLoss += period.trainingDays * hoursPerDay * COST_PER_PERSON_HOUR;
      } else if (period.endDate > lastDate && lastDate >= period.startDate) {
        // 기간 중간에 하차 → 남은 수업일 계산
        const remainStart = new Date(lastDate);
        remainStart.setDate(remainStart.getDate() + 1);
        const periodEndDate = new Date(period.endDate);
        let remainDays = 0;
        const cursor = new Date(remainStart);
        while (cursor <= periodEndDate) {
          if (isClassDay(cursor, category)) remainDays++;
          cursor.setDate(cursor.getDate() + 1);
        }
        dropoutLoss += remainDays * hoursPerDay * COST_PER_PERSON_HOUR;
      }
    }
  }

  const totalRevenue = periodRevenues.reduce((sum, p) => sum + p.totalRevenue, 0);
  const maxRevenue = periodRevenues.reduce((sum, p) => sum + p.maxRevenue, 0);

  return {
    courseName: course.name,
    trainPrId: course.trainPrId,
    degr,
    category,
    hoursPerDay,
    periods: periodRevenues,
    totalRevenue,
    maxRevenue,
    lostRevenue: maxRevenue - totalRevenue,
    dropoutLoss,
    activeTrainees: activeStudents.length,
    dropoutCount: dropoutStudents.length,
  };
}

// ─── 전체 매출 요약 ──────────────────────────────────────────

/** 전체 과정/기수 매출 요약 계산 */
export function calcRevenueSummary(
  config: HrdConfig,
  allStudents: AttendanceStudent[],
  allDailyRecords: Map<string, AttendanceDayRecord[]>,
): RevenueSummary {
  const cohorts: CohortRevenue[] = [];

  for (const course of config.courses) {
    if (!course.startDate) continue; // 개강일 미설정 → 매출 계산 불가

    for (const degr of course.degrs) {
      // 해당 과정/기수 학생 필터 (이름 기반으로 매칭 — fetchAllAttendanceData 순서 의존)
      // buildStudents가 과정/기수별로 호출되므로, allStudents에서 인접 그룹으로 존재
      // 안전하게: 모든 학생 대상으로 계산 (과정별 개별 호출이 더 정확하지만 현재 구조상 이 방식)
      const students = allStudents.filter((s) => {
        // trainPrId/degr 기반 필터가 없으므로 이름 기반으로 매칭
        // → fetchAllAttendanceData에서 과정별로 순차 추가됨
        return true; // 아래에서 과정별 개별 조회로 대체
      });

      // TODO: 과정별 개별 조회가 필요 → initRevenue에서 과정별로 호출
      void students;
    }
  }

  // 일매출: 오늘 출석한 학생 기준
  const today = fmt(new Date());
  let dailyRevenue = 0;
  for (const course of config.courses) {
    if (!course.startDate) continue;
    const hoursPerDay = course.trainingHoursPerDay || 8;
    for (const [, records] of allDailyRecords) {
      const todayRecord = records.find((r) => r.date === today);
      if (todayRecord && (isAttendedStatus(todayRecord.status) || isExcusedStatus(todayRecord.status))) {
        // 학생이 어느 과정인지 구분 어려움 → hoursPerDay 8 기본값 사용
        dailyRevenue += hoursPerDay * COST_PER_PERSON_HOUR;
        break; // 한 학생당 한 번만 카운트 (중복 방지)
      }
    }
  }

  const totalRevenue = cohorts.reduce((sum, c) => sum + c.totalRevenue, 0);
  const totalLost = cohorts.reduce((sum, c) => sum + c.lostRevenue, 0);
  const dropoutLoss = cohorts.reduce((sum, c) => sum + c.dropoutLoss, 0);
  const maxRevenue = cohorts.reduce((sum, c) => sum + c.maxRevenue, 0);

  return { totalRevenue, dailyRevenue, totalLost, dropoutLoss, maxRevenue, cohorts };
}

// ─── 과정별 개별 매출 계산 (initRevenue에서 사용) ──────────────

/** 개별 과정/기수의 출결 데이터로 매출 계산 (API 재호출 없이) */
export function calcCohortRevenueFromStudents(
  course: HrdCourse,
  degr: string,
  students: AttendanceStudent[],
  dailyRecordsMap: Map<string, AttendanceDayRecord[]>,
): CohortRevenue {
  return calcCohortRevenue(course, degr, students, dailyRecordsMap);
}

/** 일매출 계산: 오늘 출석/공결 학생수 × 시간 × 단가 */
export function calcDailyRevenue(
  allStudents: AttendanceStudent[],
  config: HrdConfig,
): number {
  // 오늘 날짜에 출석/공결 상태인 활동 학생
  const todayAttended = allStudents.filter(
    (s) => !s.dropout && (isAttendedStatus(s.status) || isExcusedStatus(s.status)),
  );
  // 과정별 시간이 다르므로 기본 8시간으로 통일 (정확한 매칭은 initRevenue에서 처리)
  const defaultHours = config.courses[0]?.trainingHoursPerDay || 8;
  return todayAttended.length * defaultHours * COST_PER_PERSON_HOUR;
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
