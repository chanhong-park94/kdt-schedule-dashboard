/**
 * 교차분석 타입 정의
 *
 * 출결(HRD) + 학업성취도 + 만족도 데이터를 조인하여
 * 학생/기수 단위 교차분석을 수행하기 위한 인터페이스.
 */

// ── 학생 단위 교차분석 ──────────────────────────────────────

/** 학생 교차분석 매칭 결과 (출결 + 성취도 조인) */
export interface StudentCrossData {
  이름: string;
  기수: string;
  과정: string;
  attendanceRate: number; // 출결률 (0~100)
  compositeScore: number; // 성취도 복합점수 (0~100 스케일)
  신호등: "green" | "yellow" | "red";
  riskLevel: "safe" | "caution" | "warning" | "danger";
  훈련상태: string;
  absentDays: number;
  totalDays: number;
}

// ── 기수 단위 교차분석 ──────────────────────────────────────

/** 기수 교차분석 매칭 결과 */
export interface CohortCrossData {
  과정명: string;
  기수: string;
  인원: number;
  avgAttendanceRate: number; // 평균 출결률
  greenRate: number; // 성취도 green 비율 (0~100)
  avgComposite: number; // 평균 성취도 점수 (0~100)
  NPS: number; // NPS (-100~100)
  강사만족도: number; // 1~5
  종합점수: number; // 가중합산 (0~100)
}

// ── 히트맵 ──────────────────────────────────────────────────

/** 히트맵 셀 */
export interface HeatmapCell {
  attendanceBracket: string; // "90%+", "80~90%", "70~80%", "70%미만"
  signal: "green" | "yellow" | "red";
  count: number;
  students: StudentCrossData[];
}

// ── 통계 ────────────────────────────────────────────────────

/** 교차분석 통계 */
export interface CrossAnalysisStats {
  matchedStudents: number;
  correlationR: number; // Pearson r
  highRiskCount: number; // danger/warning + red
  excellentCount: number; // 90%+ attendance + green
}

/** 기수 교차분석 통계 */
export interface CohortCrossStats {
  matchedCohorts: number;
  bestCohort: string; // 종합점수 최고 기수
  needsImprovement: string[]; // 하위 25% 기수
}
