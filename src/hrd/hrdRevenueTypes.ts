/** 매출 산정 타입 정의 */

/** 단위기간 (개강일 기준 월별 정산 단위) */
export interface UnitPeriod {
  index: number; // 0-based 기간 번호
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  trainingDays: number; // 해당 기간 내 훈련일수 (수업일만)
}

/** 훈련생별 단위기간 매출 */
export interface TraineeUnitRevenue {
  traineeName: string;
  paidDays: number; // 출석일 + 공결일 (훈련비 인정일)
  periodDays: number; // 해당 기간 훈련일수
  attendanceRatio: number; // paidDays / periodDays
  meetsThreshold: boolean; // >= 0.8
  revenue: number; // 원
}

/** 단위기간별 과정/기수 매출 */
export interface PeriodRevenue {
  period: UnitPeriod;
  trainees: TraineeUnitRevenue[];
  totalRevenue: number; // 실매출
  maxRevenue: number; // 전원 100% 출석 시 매출
  lostRevenue: number; // maxRevenue - totalRevenue
}

/** 과정/기수별 매출 요약 */
export interface CohortRevenue {
  courseName: string;
  trainPrId: string;
  degr: string;
  category: "재직자" | "실업자";
  hoursPerDay: number;
  periods: PeriodRevenue[];
  totalRevenue: number;
  maxRevenue: number;
  lostRevenue: number;
  dropoutLoss: number; // 하차로 인한 잔여기간 손실액
  activeTrainees: number;
  dropoutCount: number;
}

/** 전체 매출 요약 (KPI 카드용) */
export interface RevenueSummary {
  totalRevenue: number;
  dailyRevenue: number;
  totalLost: number;
  dropoutLoss: number;
  maxRevenue: number;
  cohorts: CohortRevenue[];
}
