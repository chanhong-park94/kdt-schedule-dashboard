/** 주간 운영회의 보고팩 타입 정의 */
import type { AttendanceStudent, CourseCategory, DropoutRosterEntry } from "../hrd/hrdTypes";
import type { TraineeAnalysis } from "../hrd/hrdAnalyticsTypes";
import type { KpiAllData, AchievementSummary, FormativeSummary, FieldAppSummary } from "../kpi/kpiTypes";

// ─── Report Config ──────────────────────────────────────────
export interface WeeklyOpsReportConfig {
  includePage3: boolean;
  includePage4: boolean;
  includePage5: boolean;
  reportDate: string;       // YYYY-MM-DD
  reportWeekLabel: string;  // e.g. "2026년 제11주차 (3/9~3/13)"
}

// ─── Diagnostics ────────────────────────────────────────────
export interface DataDiagnostics {
  hasAttendance: boolean;
  hasDropout: boolean;
  hasAnalytics: boolean;
  hasKpi: boolean;
}

// ─── Page 3: 출결·관리대상 현황 ─────────────────────────────
export interface Page3AttendanceData {
  dataScope: string; // e.g. "캐시된 조회 데이터 기준 (3개 과정)"
  metrics: Page3Metrics;
  courseSummaries: CourseAttendanceSummary[];
  riskCourseTop5: CourseRiskSummary[];
  atRiskTop10: AtRiskStudent[];
  weeklyTrend: WeeklyTrendItem[];
  dayPattern: DayPatternItem[];
  autoComments: string[];
}

export interface Page3Metrics {
  totalStudents: number;
  avgAttendanceRate: number;
  riskCount: number;        // danger + warning
  missingCheckoutCount: number;
  lateCount: number;
  absentCount: number;
}

export interface CourseAttendanceSummary {
  courseName: string;
  degr: string;
  category: CourseCategory;
  totalStudents: number;
  avgAttendanceRate: number;
  absentCount: number;
  lateCount: number;
  riskCount: number;
  missingCheckoutCount: number;
}

export interface CourseRiskSummary {
  courseName: string;
  degr: string;
  riskCount: number;
  avgAttendanceRate: number;
}

export interface AtRiskStudent {
  name: string;
  courseName: string;
  degr: string;
  attendanceRate: number;
  absentDays: number;
  lateDays: number;
  riskReason: string;
  missingCheckout: boolean;
}

export interface WeeklyTrendItem {
  weekLabel: string;
  attendanceRate: number;
}

export interface DayPatternItem {
  day: string;
  absentRate: number;
  lateRate: number;
  totalRecords: number;
}

// ─── Page 4: 하차방어율·조기경보 ────────────────────────────
export interface Page4DropoutData {
  overallDefenseRate: number;
  categorySummaries: CategoryDefenseSummary[];
  underperformingTop5: UnderperformingCohort[];
  earlyWarningTop10: EarlyWarningStudent[];
  underperformingCount: number;
  earlyWarningCount: number;
  autoComments: string[];
}

export interface CategoryDefenseSummary {
  category: CourseCategory;
  total: number;
  dropout: number;
  active: number;
  defenseRate: number;
  targetRate: number;
  gap: number; // defenseRate - targetRate (negative = underperforming)
  met: boolean;
}

export interface UnderperformingCohort {
  category: CourseCategory;
  courseName: string;
  degr: string;
  total: number;
  dropout: number;
  active: number;
  defenseRate: number;
  targetRate: number;
  gap: number;
}

export interface EarlyWarningStudent {
  name: string;
  courseName: string;
  degr: string;
  attendanceRate: number;
  consecutiveAbsent: number;
  absentDays: number;
  alertReasons: string[];
  status: "재학" | "탈락";
}

// ─── Page 5: 학습 품질·성과 ─────────────────────────────────
export interface Page5KpiData {
  hasData: boolean;
  metrics: Page5Metrics;
  courseComparison: CourseAchievementComparison[];
  formativeDeclineTop5: CourseStatItem[];
  lowResponseTop5: CourseStatItem[];
  lowFieldAppTop5: CourseStatItem[];
  autoComments: string[];
}

export interface Page5Metrics {
  totalStudents: number;
  preAvg: number;
  postAvg: number;
  improvementAvg: number;
  formativeAvg: number;
  fieldAppAvg: number;
  responseRate: number;
}

export interface CourseAchievementComparison {
  course: string;
  cohort: string;
  preAvg: number;
  postAvg: number;
  improvement: number;
  studentCount: number;
}

export interface CourseStatItem {
  course: string;
  cohort: string;
  value: number;
  label: string;
}

// ─── Composite ──────────────────────────────────────────────
export interface WeeklyOpsReportData {
  config: WeeklyOpsReportConfig;
  diagnostics: DataDiagnostics;
  page3?: Page3AttendanceData;
  page4?: Page4DropoutData;
  page5?: Page5KpiData;
}
