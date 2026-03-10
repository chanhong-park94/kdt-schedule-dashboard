/** 훈련생 분석 타입 정의 */

export interface TraineeAnalysis {
  name: string;
  birth: string;            // YYYYMMDD or YY.MM.DD
  age: number;              // 만 나이
  courseName: string;
  trainPrId: string;
  category: "재직자" | "실업자";
  degr: string;
  attendanceRate: number;   // 출석률 %
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  attendedDays: number;
  totalDays: number;
  dropout: boolean;
  /** 요일별 결석 (0=일,1=월,...6=토) */
  absentByWeekday: number[];
  /** 월차별 결석 (개강 후 1월차, 2월차...) */
  absentByMonth: number[];
}

export interface AnalyticsSummary {
  totalTrainees: number;
  avgAge: number;
  dropoutCount: number;
  dropoutRate: number;
  avgAttendanceRate: number;
}

export interface InsightCard {
  icon: string;
  text: string;
  severity: "info" | "warning" | "danger";
}

export type AgeGroup = "10대" | "20대" | "30대" | "40대" | "50대+";

export function getAgeGroup(age: number): AgeGroup {
  if (age < 20) return "10대";
  if (age < 30) return "20대";
  if (age < 40) return "30대";
  if (age < 50) return "40대";
  return "50대+";
}
