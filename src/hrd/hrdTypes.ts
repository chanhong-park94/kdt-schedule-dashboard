/** HRD 출결 대시보드 타입 정의 */

// ─── HRD API 원본 응답 타입 ──────────────────────────────────

/** 명단 조회 응답 (trneList) */
export interface HrdRawTrainee {
  trneeCstmrNm?: string;
  trneNm?: string;
  trneNm1?: string;
  cstmrNm?: string;
  lifyeaMd?: string;
  trneBrdt?: string;
  trneRrno?: string;
  trneeSttusNm?: string;
  atendSttsNm?: string;
  stttsCdNm?: string;
  [key: string]: unknown;
}

/** 월별 출결 응답 (atabList) */
export interface HrdRawAttendance {
  cstmrNm?: string;
  trneeCstmrNm?: string;
  trneNm?: string;
  atendDe?: string;
  atendSttusNm?: string;
  atendSttusCd?: string;
  lpsilTime?: string;
  atendTmIn?: string;
  levromTime?: string;
  atendTmOut?: string;
  [key: string]: unknown;
}

// ─── 설정 타입 ──────────────────────────────────────────────

export type CourseCategory = "재직자" | "실업자";

export interface HrdCourse {
  name: string;
  trainPrId: string; // srchTrprId
  degrs: string[]; // 기수 목록 ["1","2",...]
  startDate: string; // 개강일 YYYY-MM-DD
  totalDays: number; // 총 훈련일수
  endTime: string; // 수업 종료시간 HH:MM (퇴실 미체크 판단용)
  category?: CourseCategory; // 재직자/실업자 구분
  smsFrom?: string; // 과정별 SMS 발신번호 (운영매니저 법인폰)
}

export interface SlackScheduleConfig {
  enabled: boolean;
  hour: number; // 0-23
  minute: number; // 0-59
  weekdaysOnly: boolean; // 평일만
  targetCourses: string[]; // trainPrId[] — 빈 배열이면 전체
  headerText: string; // 메시지 헤더
  footerText: string; // 메시지 푸터
  lastSentDate?: string; // YYYY-MM-DD (중복 방지)
  courseManagers?: Record<string, string>; // trainPrId → Slack 멤버 ID (예: "U12345,U67890")
}

export const DEFAULT_SLACK_SCHEDULE: SlackScheduleConfig = {
  enabled: false,
  hour: 10,
  minute: 0,
  weekdaysOnly: true,
  targetCourses: [],
  headerText: "🚨 *[KDT 출결 관리대상 리포트]*",
  footerText: "📍 모두의연구소 HRD 운영팀",
};

export interface HrdConfig {
  authKey: string;
  proxy: string;
  slackWebhookUrl?: string;
  excusedSlackWebhookUrl?: string; // 공결신청 전용 Slack Webhook
  excusedSheetUrl?: string; // 공가신청 응답시트 URL (Slack 바로가기용)
  evidenceSheetUrl?: string; // 증빙자료 제출 응답시트 URL
  slackSchedule?: SlackScheduleConfig;
  courses: HrdCourse[];
}

// ─── 출결 상태 ──────────────────────────────────────────────

/**
 * 출결 상태 (HRD API 원본 그대로 사용)
 * - 기본: 출석, 결석, 지각, 조퇴, 외출, 휴가, 공결
 * - 복합: 외출&조퇴, 지각&조퇴, 지각&외출 등
 * - 특수: 질병/입원, 입사시험(면접), 100분의50미만출석, 중도탈락미출석
 */
export type AttendanceStatus = string;

export type RiskLevel = "safe" | "caution" | "warning" | "danger";

export const ATTENDANCE_STATUS_CODE: Record<string, string> = {
  "01": "출석",
  "02": "결석",
  "03": "지각",
  "04": "조퇴",
  "05": "휴가",
  "06": "공결",
};

/** 결석으로 카운트되는 상태인지 (제적 산정용) */
export function isAbsentStatus(status: string): boolean {
  if (!status || status === "-") return false;
  // 순수 결석 + 중도탈락 관련
  if (status === "결석") return true;
  if (status.includes("중도탈락")) return true;
  if (status === "100분의50미만출석") return true;
  return false;
}

/** 출석으로 인정되는 상태인지 (지각, 조퇴, 외출, 복합 포함) */
export function isAttendedStatus(status: string): boolean {
  if (!status || status === "-") return false;
  if (status === "출석") return true;
  if (status.includes("지각")) return true;
  if (status.includes("조퇴")) return true;
  if (status.includes("외출")) return true;
  return false;
}

/** 공결/사유결석 (출석일수에서 제외) */
export function isExcusedStatus(status: string): boolean {
  if (!status) return false;
  if (status === "공결") return true;
  if (status === "휴가") return true;
  if (status.includes("질병")) return true;
  if (status.includes("입원")) return true;
  if (status.includes("입사시험")) return true;
  if (status.includes("면접")) return true;
  return false;
}

// ─── 내부 데이터 모델 ────────────────────────────────────────

export type TraineeGender = "" | "남" | "여";

/** 훈련생 상태: 훈련중 / 수료 / 조기취업 / 하차(중도탈락·수료포기) */
export type TraineeStatus = "훈련중" | "수료" | "조기취업" | "하차";

export interface AttendanceStudent {
  name: string;
  birth: string;
  status: AttendanceStatus;
  inTime: string;
  outTime: string;
  dropout: boolean; // 하차 여부 (하차자 또는 미수료 조기취업만 true)
  traineeStatus: TraineeStatus; // 훈련중/수료/조기취업/하차 세분화
  hrdStatusRaw: string; // HRD-Net 원본 훈련상태명 (그대로 표시용)
  riskLevel: RiskLevel;
  totalDays: number; // 총 훈련일수 (과정 설정)
  attendedDays: number; // 출석 인정일수 (출석+지각+조퇴+외출+복합)
  absentDays: number; // 결석일수 (순수 결석만)
  excusedDays: number; // 공결/사유 일수
  maxAbsent: number; // 최대 허용 결석일수 (totalDays * 0.2)
  remainingAbsent: number; // 잔여 허용 결석일수
  attendanceRate: number;
  missingCheckout: boolean;
  gender: TraineeGender;
}

export interface AttendanceDayRecord {
  date: string; // YYYY-MM-DD
  dayOfWeek: string; // 월~일
  status: AttendanceStatus;
  inTime: string;
  outTime: string;
}

export interface AttendanceMetrics {
  total: number;
  present: number;
  late: number;
  absent: number;
  earlyLeave: number;
  excused: number;
  attendanceRate: number;
  riskCount: number;
  missingCheckout: number;
}

export interface WeeklyTrend {
  weekLabel: string; // "1주차", "2주차"...
  weekStart: string; // YYYY-MM-DD
  attendanceRate: number;
  presentCount: number;
  totalCount: number;
}

export interface DayPattern {
  day: string; // 월~금
  lateRate: number;
  absentRate: number;
  totalDays: number;
}

export type AttendanceViewMode = "all" | "monthly" | "weekly";

// ─── 하차방어율 타입 ────────────────────────────────────────

export interface DropoutRosterEntry {
  courseName: string;
  trainPrId: string;
  degr: string;
  category: CourseCategory;
  total: number; // 전체 인원
  dropout: number; // 중도탈락 인원
  active: number; // 재적 인원
  defenseRate: number; // 하차방어율 (%)
  startDate: string; // 개강일 YYYY-MM-DD (과정 설정에서 가져옴)
}

export interface DropoutSummary {
  label: string;
  total: number;
  dropout: number;
  active: number;
  defenseRate: number;
}
