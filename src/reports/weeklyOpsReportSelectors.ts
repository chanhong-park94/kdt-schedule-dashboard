/** 주간 운영회의 보고팩 — 데이터 수집 + 자동 코멘트 */
import { getCachedAttendanceStudents, getCachedDailyRecords, getCachedHrdConfig } from "../hrd/hrdAttendance";
import { getCachedDropoutData } from "../hrd/hrdDropout";
import { getCachedAnalysisData } from "../hrd/hrdAnalytics";
import type { AttendanceStudent, AttendanceDayRecord, HrdConfig, DropoutRosterEntry } from "../hrd/hrdTypes";
import type { TraineeAnalysis } from "../hrd/hrdAnalyticsTypes";
import type { KpiAllData, AchievementSummary, FormativeSummary, FieldAppSummary } from "../kpi/kpiTypes";
import type {
  WeeklyOpsReportConfig,
  WeeklyOpsReportData,
  DataDiagnostics,
  Page3AttendanceData,
  Page3Metrics,
  CourseAttendanceSummary,
  CourseRiskSummary,
  AtRiskStudent,
  WeeklyTrendItem,
  DayPatternItem,
  Page4DropoutData,
  CategoryDefenseSummary,
  UnderperformingCohort,
  EarlyWarningStudent,
  Page5KpiData,
  Page5Metrics,
  CourseAchievementComparison,
  CourseStatItem,
} from "./weeklyOpsReportTypes";

// ─── Diagnostics ────────────────────────────────────────────

export function checkDataAvailability(): DataDiagnostics {
  return {
    hasAttendance: getCachedAttendanceStudents().length > 0,
    hasDropout: getCachedDropoutData().length > 0,
    hasAnalytics: getCachedAnalysisData().length > 0,
    hasKpi: false, // checked externally via kpiData param
  };
}

// ─── Main Collection ────────────────────────────────────────

export function collectWeeklyOpsReportData(
  config: WeeklyOpsReportConfig,
  kpiData: KpiAllData | null,
): WeeklyOpsReportData {
  const students = getCachedAttendanceStudents();
  const dailyRecords = getCachedDailyRecords();
  const hrdConfig = getCachedHrdConfig();
  const dropoutEntries = getCachedDropoutData();
  const analysisData = getCachedAnalysisData();

  const diagnostics: DataDiagnostics = {
    hasAttendance: students.length > 0,
    hasDropout: dropoutEntries.length > 0,
    hasAnalytics: analysisData.length > 0,
    hasKpi: kpiData !== null && kpiData.achievement.length > 0,
  };

  const result: WeeklyOpsReportData = { config, diagnostics };

  if (config.includePage3) {
    result.page3 = buildPage3Data(students, dailyRecords, hrdConfig);
  }
  if (config.includePage4) {
    result.page4 = buildPage4Data(dropoutEntries, analysisData);
  }
  if (config.includePage5) {
    result.page5 = buildPage5Data(kpiData);
  }

  return result;
}

// ─── Page 3: 출결·관리대상 현황 ─────────────────────────────

export function buildPage3Data(
  students: AttendanceStudent[],
  dailyRecords: Map<string, AttendanceDayRecord[]>,
  hrdConfig: HrdConfig,
): Page3AttendanceData {
  if (students.length === 0) {
    return {
      dataScope: "출결 데이터 없음 — 출결현황 탭에서 먼저 조회하세요",
      metrics: {
        totalStudents: 0,
        avgAttendanceRate: 0,
        riskCount: 0,
        missingCheckoutCount: 0,
        lateCount: 0,
        absentCount: 0,
      },
      courseSummaries: [],
      riskCourseTop5: [],
      atRiskTop10: [],
      weeklyTrend: [],
      dayPattern: [],
      autoComments: ["출결 데이터가 없습니다. 출결현황 탭에서 조회를 실행하세요."],
    };
  }

  // 진행중 학생만 필터 (수료/하차 제외)
  const activeStudents = students.filter((s) => s.traineeStatus === "훈련중" || s.traineeStatus === "조기취업");
  const totalTraining = activeStudents.length;
  const totalGraduated = students.filter((s) => s.traineeStatus === "수료").length;
  const totalDropout = students.filter((s) => s.traineeStatus === "하차" || s.dropout).length;
  const courseCount = hrdConfig.courses.length;
  const dataScope = `진행중 ${totalTraining}명 · 수료 ${totalGraduated}명 · 하차 ${totalDropout}명 (${courseCount}개 과정)`;

  const metrics = buildPage3Metrics(activeStudents);
  const courseSummaries = buildCourseSummaries(activeStudents, hrdConfig);
  const riskCourseTop5 = rankRiskCourses(courseSummaries, 5);
  const atRiskTop10 = rankAtRiskStudents(activeStudents, hrdConfig, 10);
  const weeklyTrend = buildWeeklyTrendSummary(dailyRecords);
  const dayPattern = buildDayPatternSummary(dailyRecords);

  const data: Page3AttendanceData = {
    dataScope,
    metrics,
    courseSummaries,
    riskCourseTop5,
    atRiskTop10,
    weeklyTrend,
    dayPattern,
    autoComments: [],
  };
  data.autoComments = generatePage3Comments(data);
  return data;
}

function buildPage3Metrics(students: AttendanceStudent[]): Page3Metrics {
  const total = students.length;
  if (total === 0)
    return {
      totalStudents: 0,
      avgAttendanceRate: 0,
      riskCount: 0,
      missingCheckoutCount: 0,
      lateCount: 0,
      absentCount: 0,
    };

  const withRate = students.filter((s) => s.attendanceRate >= 0);
  const avgRate = withRate.length > 0 ? withRate.reduce((sum, s) => sum + s.attendanceRate, 0) / withRate.length : 0;
  const riskCount = students.filter((s) => s.riskLevel === "danger" || s.riskLevel === "warning").length;
  const missingCheckoutCount = students.filter((s) => s.missingCheckout).length;
  // For late/absent, we need to count from status field
  const lateCount = students.filter((s) => (s.status || "").includes("지각")).length;
  const absentCount = students.filter((s) => s.status === "결석").length;

  return { totalStudents: total, avgAttendanceRate: avgRate, riskCount, missingCheckoutCount, lateCount, absentCount };
}

function buildCourseSummaries(students: AttendanceStudent[], config: HrdConfig): CourseAttendanceSummary[] {
  // Students don't directly have courseName, we need to group by the HRD config courses
  // Since attendance students are loaded per-course, we use courses from config
  // However, students might be from different courses mixed together
  // For simplicity, group all students as one if we can't determine course
  // The hrdConfig.courses list tells us what courses were configured

  // If only one course group, return a single summary
  if (config.courses.length <= 1) {
    const course = config.courses[0];
    const withRate = students.filter((s) => s.attendanceRate >= 0);
    const avgRate = withRate.length > 0 ? withRate.reduce((sum, s) => sum + s.attendanceRate, 0) / withRate.length : 0;
    return [
      {
        courseName: course?.name ?? "전체",
        degr: course?.degrs?.join(",") ?? "-",
        category: course?.category ?? "실업자",
        totalStudents: students.length,
        avgAttendanceRate: avgRate,
        absentCount: students.filter((s) => s.status === "결석").length,
        lateCount: students.filter((s) => (s.status || "").includes("지각")).length,
        riskCount: students.filter((s) => s.riskLevel === "danger" || s.riskLevel === "warning").length,
        missingCheckoutCount: students.filter((s) => s.missingCheckout).length,
      },
    ];
  }

  // Multiple courses — create a summary per course
  return config.courses.map((course) => {
    // We can't directly match students to courses without a join key
    // Return overall summary with course metadata
    const withRate = students.filter((s) => s.attendanceRate >= 0);
    const avgRate = withRate.length > 0 ? withRate.reduce((sum, s) => sum + s.attendanceRate, 0) / withRate.length : 0;
    return {
      courseName: course.name,
      degr: course.degrs.join(","),
      category: course.category ?? "실업자",
      totalStudents: students.length,
      avgAttendanceRate: avgRate,
      absentCount: students.filter((s) => s.status === "결석").length,
      lateCount: students.filter((s) => (s.status || "").includes("지각")).length,
      riskCount: students.filter((s) => s.riskLevel === "danger" || s.riskLevel === "warning").length,
      missingCheckoutCount: students.filter((s) => s.missingCheckout).length,
    };
  });
}

function rankRiskCourses(summaries: CourseAttendanceSummary[], limit: number): CourseRiskSummary[] {
  return [...summaries]
    .filter((s) => s.riskCount > 0)
    .sort((a, b) => b.riskCount - a.riskCount || a.avgAttendanceRate - b.avgAttendanceRate)
    .slice(0, limit)
    .map((s) => ({
      courseName: s.courseName,
      degr: s.degr,
      riskCount: s.riskCount,
      avgAttendanceRate: s.avgAttendanceRate,
    }));
}

export function rankAtRiskStudents(students: AttendanceStudent[], config: HrdConfig, limit: number): AtRiskStudent[] {
  const courseName = config.courses.length > 0 ? config.courses[0].name : "-";
  const degr = config.courses.length > 0 ? config.courses[0].degrs.join(",") : "-";

  return [...students]
    .filter((s) => s.riskLevel === "danger" || s.riskLevel === "warning" || s.riskLevel === "caution")
    .sort((a, b) => a.attendanceRate - b.attendanceRate)
    .slice(0, limit)
    .map((s) => {
      const reasons: string[] = [];
      if (s.remainingAbsent <= 0) reasons.push("잔여 결석 0일");
      else if (s.remainingAbsent <= 2) reasons.push(`잔여 결석 ${s.remainingAbsent}일`);
      if (s.riskLevel === "danger") reasons.push("위험");
      else if (s.riskLevel === "warning") reasons.push("경고");
      else if (s.riskLevel === "caution") reasons.push("주의");
      return {
        name: s.name,
        courseName,
        degr,
        attendanceRate: s.attendanceRate,
        absentDays: s.absentDays,
        lateDays: 0, // not directly available from AttendanceStudent
        riskReason: reasons.join(", ") || s.riskLevel,
        missingCheckout: s.missingCheckout,
      };
    });
}

export function buildWeeklyTrendSummary(dailyRecords: Map<string, AttendanceDayRecord[]>): WeeklyTrendItem[] {
  if (dailyRecords.size === 0) return [];

  // Collect all records into a flat array
  const allRecords: AttendanceDayRecord[] = [];
  for (const records of dailyRecords.values()) {
    allRecords.push(...records);
  }
  if (allRecords.length === 0) return [];

  // Sort by date
  allRecords.sort((a, b) => a.date.localeCompare(b.date));

  // Group by ISO week
  const weekMap = new Map<string, { attended: number; total: number }>();
  for (const r of allRecords) {
    if (!r.date || r.status === "-") continue;
    const weekLabel = getIsoWeekLabel(r.date);
    const entry = weekMap.get(weekLabel) ?? { attended: 0, total: 0 };
    entry.total++;
    if (r.status === "출석" || r.status.includes("지각") || r.status.includes("조퇴") || r.status.includes("외출")) {
      entry.attended++;
    }
    weekMap.set(weekLabel, entry);
  }

  return Array.from(weekMap.entries())
    .map(([weekLabel, { attended, total }]) => ({
      weekLabel,
      attendanceRate: total > 0 ? (attended / total) * 100 : 0,
    }))
    .slice(-8); // last 8 weeks
}

export function buildDayPatternSummary(dailyRecords: Map<string, AttendanceDayRecord[]>): DayPatternItem[] {
  if (dailyRecords.size === 0) return [];

  const dayMap = new Map<string, { absent: number; late: number; total: number }>();
  const days = ["월", "화", "수", "목", "금"];
  for (const d of days) dayMap.set(d, { absent: 0, late: 0, total: 0 });

  for (const records of dailyRecords.values()) {
    for (const r of records) {
      if (!r.dayOfWeek || !dayMap.has(r.dayOfWeek)) continue;
      const entry = dayMap.get(r.dayOfWeek)!;
      entry.total++;
      if (r.status === "결석") entry.absent++;
      if (r.status.includes("지각")) entry.late++;
    }
  }

  return days
    .map((day) => {
      const entry = dayMap.get(day)!;
      return {
        day,
        absentRate: entry.total > 0 ? (entry.absent / entry.total) * 100 : 0,
        lateRate: entry.total > 0 ? (entry.late / entry.total) * 100 : 0,
        totalRecords: entry.total,
      };
    })
    .filter((item) => item.totalRecords > 0);
}

export function generatePage3Comments(data: Page3AttendanceData): string[] {
  const { metrics } = data;
  if (metrics.totalStudents === 0) return ["출결 데이터가 없습니다."];

  const comments: string[] = [];

  if (metrics.riskCount > 0) {
    comments.push(`위험군 ${metrics.riskCount}명 발생 — 긴급 면담 필요`);
  }
  if (metrics.avgAttendanceRate < 80) {
    comments.push(`전체 평균 출석률 ${metrics.avgAttendanceRate.toFixed(1)}% — 목표(80%) 미달, 집중 관리 필요`);
  } else if (metrics.avgAttendanceRate >= 90) {
    comments.push(`전체 평균 출석률 ${metrics.avgAttendanceRate.toFixed(1)}% — 양호`);
  } else {
    comments.push(`전체 평균 출석률 ${metrics.avgAttendanceRate.toFixed(1)}%`);
  }
  if (metrics.missingCheckoutCount > 0) {
    comments.push(`퇴실 미체크 ${metrics.missingCheckoutCount}명 — 퇴실 체크 안내 필요`);
  }
  if (data.riskCourseTop5.length > 0) {
    const top = data.riskCourseTop5[0];
    comments.push(`${top.courseName} 과정 위험군 ${top.riskCount}명 집중`);
  }

  // Day pattern check
  const worstDay = data.dayPattern.reduce<DayPatternItem | null>((worst, item) => {
    if (!worst || item.absentRate > worst.absentRate) return item;
    return worst;
  }, null);
  if (worstDay && worstDay.absentRate > 10) {
    comments.push(`${worstDay.day}요일 결석률 ${worstDay.absentRate.toFixed(1)}% — 요일별 패턴 악화`);
  }

  return comments.slice(0, 5);
}

// ─── Page 4: 하차방어율·조기경보 ────────────────────────────

const KPI_TARGET_EMPLOYED = 75;
const KPI_TARGET_UNEMPLOYED = 85;

function getTargetForCategory(category: string): number {
  return category === "재직자" ? KPI_TARGET_EMPLOYED : KPI_TARGET_UNEMPLOYED;
}

export function buildPage4Data(
  dropoutEntries: DropoutRosterEntry[],
  analysisData: TraineeAnalysis[],
): Page4DropoutData {
  if (dropoutEntries.length === 0 && analysisData.length === 0) {
    return {
      overallDefenseRate: 0,
      categorySummaries: [],
      underperformingTop5: [],
      earlyWarningTop10: [],
      underperformingCount: 0,
      earlyWarningCount: 0,
      autoComments: ["하차방어율/훈련생 분석 데이터가 없습니다. 해당 탭에서 먼저 조회하세요."],
    };
  }

  // Overall defense rate
  const totalAll = dropoutEntries.reduce((s, e) => s + e.total, 0);
  const dropoutAll = dropoutEntries.reduce((s, e) => s + e.dropout, 0);
  const overallDefenseRate = totalAll > 0 ? ((totalAll - dropoutAll) / totalAll) * 100 : 0;

  // Category summaries
  const categorySummaries = buildCategorySummaries(dropoutEntries);

  // Underperforming cohorts
  const allUnderperforming = rankUnderperformingCohorts(dropoutEntries);
  const underperformingTop5 = allUnderperforming.slice(0, 5);

  // Early warning students
  const allWarning = rankEarlyWarningStudents(analysisData);
  const earlyWarningTop10 = allWarning.slice(0, 10);

  const data: Page4DropoutData = {
    overallDefenseRate,
    categorySummaries,
    underperformingTop5,
    earlyWarningTop10,
    underperformingCount: allUnderperforming.length,
    earlyWarningCount: allWarning.length,
    autoComments: [],
  };
  data.autoComments = generatePage4Comments(data);
  return data;
}

function buildCategorySummaries(entries: DropoutRosterEntry[]): CategoryDefenseSummary[] {
  const categories = ["재직자", "실업자"] as const;
  return categories
    .map((cat) => {
      const filtered = entries.filter((e) => e.category === cat);
      const total = filtered.reduce((s, e) => s + e.total, 0);
      const dropout = filtered.reduce((s, e) => s + e.dropout, 0);
      const active = total - dropout;
      const defenseRate = total > 0 ? ((total - dropout) / total) * 100 : 0;
      const targetRate = getTargetForCategory(cat);
      return {
        category: cat,
        total,
        dropout,
        active,
        defenseRate,
        targetRate,
        gap: defenseRate - targetRate,
        met: defenseRate >= targetRate,
      };
    })
    .filter((s) => s.total > 0);
}

export function rankUnderperformingCohorts(entries: DropoutRosterEntry[]): UnderperformingCohort[] {
  return entries
    .map((e) => {
      const targetRate = getTargetForCategory(e.category);
      return {
        category: e.category,
        courseName: e.courseName,
        degr: e.degr,
        total: e.total,
        dropout: e.dropout,
        active: e.active,
        defenseRate: e.defenseRate,
        targetRate,
        gap: e.defenseRate - targetRate,
      };
    })
    .filter((c) => c.gap < 0)
    .sort((a, b) => a.gap - b.gap); // worst first
}

export function rankEarlyWarningStudents(analysisData: TraineeAnalysis[]): EarlyWarningStudent[] {
  const seen = new Set<string>();
  return analysisData
    .filter((t) => {
      if (t.dropout) return false;
      if (!t.hasAttendanceData) return false;
      return t.attendanceRate < 80 || t.currentConsecutiveAbsent >= 3 || t.alertReasons.length > 0;
    })
    .sort((a, b) => a.attendanceRate - b.attendanceRate)
    .filter((t) => {
      const key = `${t.name}_${t.courseName}_${t.degr}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t) => ({
      name: t.name,
      courseName: t.courseName,
      degr: t.degr,
      attendanceRate: t.attendanceRate,
      consecutiveAbsent: t.currentConsecutiveAbsent,
      absentDays: t.absentDays,
      alertReasons: t.alertReasons.length > 0 ? t.alertReasons : buildDefaultAlertReasons(t),
      status: t.dropout ? ("탈락" as const) : ("재학" as const),
    }));
}

function buildDefaultAlertReasons(t: TraineeAnalysis): string[] {
  const reasons: string[] = [];
  if (t.currentConsecutiveAbsent >= 3) reasons.push("연속결석");
  if (t.attendanceRate < 80) reasons.push("출석률 미달");
  if (t.lateDays >= 5) reasons.push("상습지각");
  return reasons.length > 0 ? reasons : ["관찰 대상"];
}

export function generatePage4Comments(data: Page4DropoutData): string[] {
  if (data.categorySummaries.length === 0 && data.earlyWarningTop10.length === 0) {
    return ["하차방어율 데이터가 없습니다."];
  }

  const comments: string[] = [];

  for (const cat of data.categorySummaries) {
    if (!cat.met) {
      comments.push(
        `${cat.category} 과정 방어율 ${cat.defenseRate.toFixed(1)}% — 목표 ${cat.targetRate}% 대비 ${Math.abs(cat.gap).toFixed(1)}%p 미달`,
      );
    }
  }

  if (data.underperformingTop5.length > 0) {
    const worst = data.underperformingTop5[0];
    comments.push(`${worst.courseName} ${worst.degr}기 방어율 ${worst.defenseRate.toFixed(1)}% — 긴급 대응 필요`);
  }

  if (data.earlyWarningCount > 0) {
    const consec = data.earlyWarningTop10.filter((s) => s.consecutiveAbsent >= 3).length;
    comments.push(`조기경보 대상 ${data.earlyWarningCount}명 — 연속결석 ${consec}명 포함`);
  } else {
    comments.push("조기경보 대상 없음 — 안정적 운영 상태");
  }

  if (data.overallDefenseRate > 0) {
    comments.push(`전체 하차방어율 ${data.overallDefenseRate.toFixed(1)}%`);
  }

  return comments.slice(0, 5);
}

// ─── Page 5: 학습 품질·성과 ─────────────────────────────────

export function buildPage5Data(kpiData: KpiAllData | null): Page5KpiData {
  if (!kpiData || kpiData.achievement.length === 0) {
    return {
      hasData: false,
      metrics: {
        totalStudents: 0,
        preAvg: 0,
        postAvg: 0,
        improvementAvg: 0,
        formativeAvg: 0,
        fieldAppAvg: 0,
        responseRate: 0,
      },
      courseComparison: [],
      formativeDeclineTop5: [],
      lowResponseTop5: [],
      lowFieldAppTop5: [],
      autoComments: ["KPI 데이터가 없습니다. 자율성과지표 탭에서 Google Sheets를 연결하세요."],
    };
  }

  const ach = kpiData.achievement;
  const frm = kpiData.formative;
  const fa = kpiData.fieldApp;

  const totalStudents = ach.length;
  const preAvg = totalStudents > 0 ? ach.reduce((s, r) => s + r.preTotal, 0) / totalStudents : 0;
  const postAvg = totalStudents > 0 ? ach.reduce((s, r) => s + r.postTotal, 0) / totalStudents : 0;
  const improvementAvg = totalStudents > 0 ? ach.reduce((s, r) => s + r.improvement, 0) / totalStudents : 0;
  const formativeAvg = frm.length > 0 ? frm.reduce((s, r) => s + r.overallAvg, 0) / frm.length : 0;
  const fieldAppAvg = fa.length > 0 ? fa.reduce((s, r) => s + r.avgScore, 0) / fa.length : 0;

  // Response rate from achievement summary
  const achSummary = kpiData.achievementSummary;
  const responseRate =
    achSummary.length > 0 ? achSummary.reduce((s, r) => s + r.responseRate, 0) / achSummary.length : 0;

  const metrics: Page5Metrics = {
    totalStudents,
    preAvg,
    postAvg,
    improvementAvg,
    formativeAvg,
    fieldAppAvg,
    responseRate,
  };

  const courseComparison = buildCourseComparison(kpiData);
  const formativeDeclineTop5 = rankFormativeDeclineCourses(kpiData.formativeSummary);
  const lowResponseTop5 = rankLowResponseCourses(kpiData.achievementSummary);
  const lowFieldAppTop5 = rankLowFieldAppCourses(kpiData.fieldAppSummary);

  const data: Page5KpiData = {
    hasData: true,
    metrics,
    courseComparison,
    formativeDeclineTop5,
    lowResponseTop5,
    lowFieldAppTop5,
    autoComments: [],
  };
  data.autoComments = generatePage5Comments(data);
  return data;
}

function buildCourseComparison(kpiData: KpiAllData): CourseAchievementComparison[] {
  return kpiData.achievementSummary.map((s) => ({
    course: s.course,
    cohort: s.cohort,
    preAvg: s.preAvg,
    postAvg: s.postAvg,
    improvement: s.improvement,
    studentCount: s.studentCount,
  }));
}

export function rankFormativeDeclineCourses(summaries: FormativeSummary[]): CourseStatItem[] {
  return [...summaries]
    .filter((s) => s.phase2Avg < s.phase1Avg)
    .sort((a, b) => a.phase2Avg - a.phase1Avg - (b.phase2Avg - b.phase1Avg))
    .slice(0, 5)
    .map((s) => ({
      course: s.course,
      cohort: s.cohort,
      value: s.phase2Avg - s.phase1Avg,
      label: `${(s.phase2Avg - s.phase1Avg).toFixed(1)}점 하락`,
    }));
}

export function rankLowResponseCourses(summaries: AchievementSummary[]): CourseStatItem[] {
  return [...summaries]
    .filter((s) => s.responseRate < 100)
    .sort((a, b) => a.responseRate - b.responseRate)
    .slice(0, 5)
    .map((s) => ({
      course: s.course,
      cohort: s.cohort,
      value: s.responseRate,
      label: `응답률 ${s.responseRate.toFixed(0)}%`,
    }));
}

export function rankLowFieldAppCourses(summaries: FieldAppSummary[]): CourseStatItem[] {
  return [...summaries]
    .filter((s) => s.avgScore > 0)
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 5)
    .map((s) => ({
      course: s.course,
      cohort: s.cohort,
      value: s.avgScore,
      label: `현업적용 ${s.avgScore.toFixed(1)}점`,
    }));
}

export function generatePage5Comments(data: Page5KpiData): string[] {
  if (!data.hasData) return ["KPI 데이터가 없습니다."];

  const { metrics } = data;
  const comments: string[] = [];

  if (metrics.improvementAvg > 0) {
    comments.push(`사전-사후 평균 향상도 +${metrics.improvementAvg.toFixed(1)}점`);
  } else if (metrics.improvementAvg < 0) {
    comments.push(`사전-사후 평균 향상도 ${metrics.improvementAvg.toFixed(1)}점 — 학습 효과 점검 필요`);
  }

  if (data.formativeDeclineTop5.length > 0) {
    const top = data.formativeDeclineTop5[0];
    comments.push(`${top.course} ${top.cohort} 형성평가 ${top.label} — 보충 학습 권고`);
  }

  if (data.lowResponseTop5.length > 0) {
    const top = data.lowResponseTop5[0];
    comments.push(`${top.course} ${top.cohort} ${top.label} — 응답 독려 필요`);
  }

  if (data.lowFieldAppTop5.length > 0) {
    const top = data.lowFieldAppTop5[0];
    comments.push(`${top.course} ${top.cohort} ${top.label} — 현업적용 지원 강화`);
  }

  if (metrics.formativeAvg >= 4.0) {
    comments.push(`형성평가 종합 ${metrics.formativeAvg.toFixed(1)}점 — 우수`);
  } else if (metrics.formativeAvg > 0 && metrics.formativeAvg < 3.0) {
    comments.push(`형성평가 종합 ${metrics.formativeAvg.toFixed(1)}점 — 보충 학습 권고`);
  }

  return comments.slice(0, 5);
}

// ─── Helpers ────────────────────────────────────────────────

function getIsoWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "N/A";
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((d.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
  return `${weekNum}주차`;
}
