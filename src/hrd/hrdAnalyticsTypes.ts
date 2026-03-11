/** 훈련생 분석 타입 정의 */

export interface TraineeAnalysis {
  name: string;
  birth: string; // YYYYMMDD or YY.MM.DD
  age: number; // 만 나이
  courseName: string;
  trainPrId: string;
  category: "재직자" | "실업자";
  degr: string;
  attendanceRate: number; // 출석률 %
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  attendedDays: number;
  totalDays: number;
  dropout: boolean;
  /** 출결 데이터 존재 여부 (false면 출석률 N/A) */
  hasAttendanceData: boolean;
  /** 요일별 결석 (0=일,1=월,...6=토) */
  absentByWeekday: number[];
  /** 월차별 결석 (개강 후 1월차, 2월차...) */
  absentByMonth: number[];
  /** 최대 연속결석 일수 */
  maxConsecutiveAbsent: number;
  /** 현재 진행중 연속결석 일수 */
  currentConsecutiveAbsent: number;
  /** 시간대별 지각 분포 [7시,8시,...12시] (6칸) */
  lateByHour: number[];
  /** 주차별 출석률 배열 */
  weeklyAttendanceRates: number[];
  /** 탈락 시점 (개강 후 주차, -1=미탈락) */
  dropoutWeekIdx: number;
  /** 경보 사유 태그 배열 */
  alertReasons: string[];
  /** 과정 상태: 진행중 or 종강 */
  courseStatus: "진행중" | "종강";
}

export interface AnalyticsSummary {
  totalTrainees: number;
  avgAge: number;
  dropoutCount: number;
  dropoutRate: number;
  avgAttendanceRate: number;
  /** 연속결석 3일+ 학생 수 */
  consecutiveAbsentCount: number;
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
