/** KPI 자율성과지표 타입 정의 */

// ── 설정 시트 ────────────────────────────────────
export interface CourseInfo {
  code: string;
  name: string;
  cohort: string;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  targetStudents: number;
  status: string;
}

export interface GradeEntry {
  grade: string;
  scoreRange: string;
  description: string;
  note: string;
}

// ── 성취평가 ────────────────────────────────────
export interface AchievementRecord {
  no: number;
  studentId: string;
  name: string;
  course: string;
  cohort: string;
  preScores: number[];
  preTotal: number;
  preGrade: string;
  postScores: number[];
  postTotal: number;
  postGrade: string;
  improvement: number;
  gradeChange: string;
  status: string;
}

// ── 형성평가 ────────────────────────────────────
export interface FormativeRecord {
  no: number;
  studentId: string;
  name: string;
  course: string;
  cohort: string;
  phase1Scores: number[];
  phase1Avg: number;
  phase2Scores: number[];
  phase2Avg: number;
  overallAvg: number;
  status: string;
}

// ── 현업적용평가 ────────────────────────────────
export interface FieldAppRecord {
  no: number;
  studentId: string;
  name: string;
  course: string;
  cohort: string;
  scores: number[];
  avgScore: number;
  grade: string;
  status: string;
}

// ── 과정별 집계 ────────────────────────────────
export interface AchievementSummary {
  course: string;
  cohort: string;
  studentCount: number;
  preAvg: number;
  postAvg: number;
  improvement: number;
  preGradeA: number;
  postGradeA: number;
  completed: number;
  responseRate: number;
}

export interface FormativeSummary {
  course: string;
  cohort: string;
  studentCount: number;
  phase1Avg: number;
  phase2Avg: number;
  overallAvg: number;
}

export interface FieldAppSummary {
  course: string;
  cohort: string;
  studentCount: number;
  avgScore: number;
  completed: number;
  responseRate: number;
}

// ── 통합 데이터 ────────────────────────────────
export interface KpiAllData {
  courses: CourseInfo[];
  grades: GradeEntry[];
  achievement: AchievementRecord[];
  formative: FormativeRecord[];
  fieldApp: FieldAppRecord[];
  achievementSummary: AchievementSummary[];
  formativeSummary: FormativeSummary[];
  fieldAppSummary: FieldAppSummary[];
}

// ── 설정 ────────────────────────────────────────
export interface KpiConfig {
  /** Apps Script Web App URL */
  webAppUrl: string;
  /** Spreadsheet ID (fallback) */
  spreadsheetId: string;
}

export const KPI_CONFIG_KEY = "kdt_kpi_config_v1";
