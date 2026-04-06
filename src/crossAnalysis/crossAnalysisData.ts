/**
 * 교차분석 데이터 매칭 및 집계
 *
 * 출결(AttendanceStudent) + 학업성취도(UnifiedRecord) + 만족도(SatisfactionRecord)를
 * 학생/기수 단위로 조인하여 상관관계 분석 결과를 산출합니다.
 */

import { loadAchievementCache, summarizeByTrainee } from "../hrd/hrdAchievementApi";
import { loadSatisfactionCache, summarizeByCohort } from "../hrd/hrdSatisfactionApi";
import type { UnifiedRecord, TraineeAchievementSummary } from "../hrd/hrdAchievementTypes";
import type { SatisfactionRecord } from "../hrd/hrdSatisfactionTypes";
import type { AttendanceStudent } from "../hrd/hrdTypes";
import type {
  StudentCrossData,
  CohortCrossData,
  HeatmapCell,
  CrossAnalysisStats,
  CohortCrossStats,
} from "./crossAnalysisTypes";

// ── Helpers ──────────────────────────────────────────────────

/** 생년월일 문자열에서 나이 계산 */
function calculateAgeFromBirth(birth: string): number {
  if (!birth || birth === "-") return 0;
  const digits = birth.replace(/[^0-9]/g, "");
  let year: number;
  if (digits.length >= 8) {
    year = parseInt(digits.slice(0, 4), 10);
  } else if (digits.length >= 6) {
    const yy = parseInt(digits.slice(0, 2), 10);
    year = yy >= 50 ? 1900 + yy : 2000 + yy;
  } else {
    return 0;
  }
  const now = new Date();
  const monthDay = digits.length >= 8 ? digits.slice(4, 8) : digits.slice(2, 6);
  const month = parseInt(monthDay.slice(0, 2), 10);
  const day = parseInt(monthDay.slice(2, 4), 10);
  // 월/일 유효성 검사
  if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
  if (year < 1930 || year > now.getFullYear()) return 0;
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age--;
  return age > 0 ? age : 0;
}

// ── Constants ───────────────────────────────────────────────

const ATTENDANCE_BRACKETS = [
  { label: "90%+", min: 90, max: 100 },
  { label: "80~90%", min: 80, max: 90 },
  { label: "70~80%", min: 70, max: 80 },
  { label: "70%미만", min: 0, max: 70 },
] as const;

const SIGNALS = ["green", "yellow", "red"] as const;

// ── Pearson correlation ─────────────────────────────────────

/** 피어슨 상관계수 계산 */
function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom === 0 ? 0 : sumXY / denom;
}

/** 상관계수 강도 한국어 설명 */
export function describeCorrelation(r: number): string {
  const abs = Math.abs(r);
  const direction = r >= 0 ? "양" : "음";
  if (abs >= 0.7) return `강한 ${direction}의 상관`;
  if (abs >= 0.4) return `중간 ${direction}의 상관`;
  if (abs >= 0.2) return `약한 ${direction}의 상관`;
  return "상관관계 거의 없음";
}

// ── 캐시 기반 데이터 로드 ────────────────────────────────────

/**
 * 학업성취도 캐시에서 UnifiedRecord 로드
 * @returns 캐시된 레코드 배열 또는 빈 배열
 */
export function loadCachedAchievementRecords(): UnifiedRecord[] {
  return loadAchievementCache() ?? [];
}

/**
 * 만족도 데이터 로드 — Apps Script 캐시 + 수기입력 데이터 병합
 * @returns 병합된 레코드 배열
 */
export function loadCachedSatisfactionRecords(): SatisfactionRecord[] {
  const apiCache = loadSatisfactionCache() ?? [];
  // 수기입력 데이터 병합 (kdt_satisfaction_manual_v1)
  let manual: SatisfactionRecord[] = [];
  try {
    const raw = localStorage.getItem("kdt_satisfaction_manual_v1");
    if (raw) manual = JSON.parse(raw) as SatisfactionRecord[];
  } catch {
    /* ignore */
  }
  if (manual.length === 0) return apiCache;
  if (apiCache.length === 0) return manual;
  // 중복 제거: 수기입력 우선 (동일 과정·기수·모듈이면 수기입력 데이터 사용)
  const manualKeys = new Set(manual.map((r) => `${r.과정명}|${r.기수}|${r.모듈명}`));
  const deduped = apiCache.filter((r) => !manualKeys.has(`${r.과정명}|${r.기수}|${r.모듈명}`));
  return [...deduped, ...manual];
}

// ── 학생 단위 매칭 ──────────────────────────────────────────

/**
 * 출결 + 성취도 학생 단위 조인
 *
 * 이름(trim) 기준으로 양쪽 데이터셋에 모두 존재하는 학생만 반환.
 * compositeScore = (nodeRate * 0.4 + questRate * 0.6) * 100
 */
export function matchStudentData(
  attendanceStudents: AttendanceStudent[],
  achievementRecords: UnifiedRecord[],
  cohortHint?: string,
): StudentCrossData[] {
  // 성취도 데이터를 훈련생별로 집계 (필터 없이 전체)
  const summaries = summarizeByTrainee(achievementRecords, "", "");

  // 이름 기준 매칭 (동명이인 대응: 이름별 배열로 저장)
  const achievementByName = new Map<string, TraineeAchievementSummary[]>();
  for (const s of summaries) {
    const name = s.이름.trim();
    if (!achievementByName.has(name)) achievementByName.set(name, []);
    achievementByName.get(name)!.push(s);
  }

  const results: StudentCrossData[] = [];

  for (const att of attendanceStudents) {
    const name = att.name.trim();
    const candidates = achievementByName.get(name);
    if (!candidates || candidates.length === 0) continue;

    // 동명이인 없으면 바로 매칭
    // 동명이인 있으면 cohortHint로 구분, 없으면 첫 번째 후보 사용
    const ach =
      candidates.length === 1
        ? candidates[0]
        : ((cohortHint ? candidates.find((c) => c.기수 === cohortHint) : null) ?? candidates[0]);

    // 성취도 복합점수 계산: 노드제출률 40% + 퀘스트패스률 60%
    const nodeRate = ach.총노드수 > 0 ? ach.제출노드수 / ach.총노드수 : 0;
    const questRate = ach.총퀘스트수 > 0 ? ach.패스퀘스트수 / ach.총퀘스트수 : 0;
    const compositeScore = Math.round((nodeRate * 0.4 + questRate * 0.6) * 100 * 10) / 10;

    results.push({
      이름: name,
      기수: ach.기수,
      과정: ach.과정,
      attendanceRate: att.attendanceRate,
      compositeScore,
      신호등: ach.신호등,
      riskLevel: att.riskLevel,
      훈련상태: ach.훈련상태,
      absentDays: att.absentDays,
      totalDays: att.totalDays,
      gender: att.gender || "",
      age: calculateAgeFromBirth(att.birth),
    });
  }

  return results;
}

// ── 기수 단위 매칭 ──────────────────────────────────────────

/**
 * 학생 교차데이터 + 만족도 → 기수별 종합 분석
 *
 * 종합점수 = avgAttendanceRate * 0.3 + greenRate * 0.4 + normalizedNPS * 0.3
 * normalizedNPS = (NPS + 100) / 2 (maps -100~100 → 0~100)
 */
export function matchCohortData(
  studentData: StudentCrossData[],
  satisfactionRecords: SatisfactionRecord[],
): CohortCrossData[] {
  // 만족도 기수별 집계 (필터 없이 전체)
  const satSummaries = summarizeByCohort(satisfactionRecords, "", "");

  // 만족도 맵: "과정명|기수" → { NPS, 강사만족도 }
  const satMap = new Map<string, { NPS: number; 강사만족도: number }>();
  for (const s of satSummaries) {
    satMap.set(`${s.과정명}|${s.기수}`, {
      NPS: s.NPS평균,
      강사만족도: s.강사만족도평균,
    });
  }

  // 학생 데이터를 과정+기수로 그룹핑
  const cohortMap = new Map<string, StudentCrossData[]>();
  for (const st of studentData) {
    const key = `${st.과정}|${st.기수}`;
    if (!cohortMap.has(key)) cohortMap.set(key, []);
    cohortMap.get(key)!.push(st);
  }

  const results: CohortCrossData[] = [];

  for (const [key, students] of cohortMap) {
    const [과정명, 기수] = key.split("|");
    const n = students.length;

    // 평균 출결률
    const avgAttendanceRate = Math.round((students.reduce((s, st) => s + st.attendanceRate, 0) / n) * 10) / 10;

    // green 비율
    const greenCount = students.filter((st) => st.신호등 === "green").length;
    const greenRate = Math.round((greenCount / n) * 100 * 10) / 10;

    // 평균 성취도 복합점수
    const avgComposite = Math.round((students.reduce((s, st) => s + st.compositeScore, 0) / n) * 10) / 10;

    // 만족도 조인
    const sat = satMap.get(key);
    const NPS = sat?.NPS ?? 0;
    const 강사만족도 = sat?.강사만족도 ?? 0;

    // 종합점수 계산
    const normalizedNPS = (NPS + 100) / 2;
    const 종합점수 = Math.round((avgAttendanceRate * 0.3 + greenRate * 0.4 + normalizedNPS * 0.3) * 10) / 10;

    results.push({
      과정명,
      기수,
      인원: n,
      avgAttendanceRate,
      greenRate,
      avgComposite,
      NPS,
      강사만족도,
      종합점수,
    });
  }

  // 종합점수 내림차순 정렬
  results.sort((a, b) => b.종합점수 - a.종합점수);

  return results;
}

// ── 히트맵 생성 ─────────────────────────────────────────────

/**
 * 출결 구간 x 신호등 히트맵 생성
 *
 * 4개 출결 구간 x 3개 신호등 = 12셀
 */
export function buildHeatmap(students: StudentCrossData[]): HeatmapCell[] {
  const cells: HeatmapCell[] = [];

  for (const bracket of ATTENDANCE_BRACKETS) {
    for (const signal of SIGNALS) {
      const matched = students.filter((st) => {
        const rate = st.attendanceRate;
        // 최상위 구간은 양쪽 포함 [90, 100], 나머지는 [min, max)
        const inBracket = bracket.min === 90 ? rate >= bracket.min && rate <= bracket.max : rate >= bracket.min && rate < bracket.max;
        return inBracket && st.신호등 === signal;
      });

      cells.push({
        attendanceBracket: bracket.label,
        signal,
        count: matched.length,
        students: matched,
      });
    }
  }

  return cells;
}

// ── 학생 통계 ───────────────────────────────────────────────

/**
 * 학생 단위 교차분석 통계 산출
 *
 * - 피어슨 상관계수 (출결률 vs 성취도)
 * - 고위험군: riskLevel warning|danger AND 신호등 red
 * - 우수군: 출결률 90%+ AND 신호등 green
 */
export function calcStudentStats(students: StudentCrossData[]): CrossAnalysisStats {
  const xs = students.map((s) => s.attendanceRate);
  const ys = students.map((s) => s.compositeScore);
  const correlationR = Math.round(pearsonR(xs, ys) * 1000) / 1000;

  const highRiskCount = students.filter(
    (s) => (s.riskLevel === "warning" || s.riskLevel === "danger") && s.신호등 === "red",
  ).length;

  const excellentCount = students.filter((s) => s.attendanceRate >= 90 && s.신호등 === "green").length;

  return {
    matchedStudents: students.length,
    correlationR,
    highRiskCount,
    excellentCount,
  };
}

// ── 기수 통계 ───────────────────────────────────────────────

/**
 * 기수 단위 교차분석 통계 산출
 *
 * - 종합점수 최고 기수
 * - 하위 25% 개선 필요 기수
 */
export function calcCohortStats(cohorts: CohortCrossData[]): CohortCrossStats {
  if (cohorts.length === 0) {
    return { matchedCohorts: 0, bestCohort: "-", needsImprovement: [] };
  }

  // 종합점수 기준 정렬 (내림차순)
  const sorted = [...cohorts].sort((a, b) => b.종합점수 - a.종합점수);
  const bestCohort = `${sorted[0].과정명} ${sorted[0].기수}`;

  // 하위 25% 기수
  const cutoffIdx = Math.ceil(sorted.length * 0.75);
  const needsImprovement = sorted.slice(cutoffIdx).map((c) => `${c.과정명} ${c.기수}`);

  return {
    matchedCohorts: cohorts.length,
    bestCohort,
    needsImprovement,
  };
}

// ── 인사이트 생성 ───────────────────────────────────────────

/**
 * 교차분석 결과에서 3~5개 핵심 인사이트 문장 생성 (한국어)
 */
export function generateInsights(
  students: StudentCrossData[],
  cohorts: CohortCrossData[],
  stats: CrossAnalysisStats,
): string[] {
  const insights: string[] = [];

  // 1. 상관계수 인사이트
  const rStr = stats.correlationR >= 0 ? `+${stats.correlationR.toFixed(2)}` : stats.correlationR.toFixed(2);
  insights.push(`출결률과 성취도 상관계수: r=${rStr} (${describeCorrelation(stats.correlationR)})`);

  // 2. 매칭 현황
  insights.push(`총 ${stats.matchedStudents}명 매칭 완료 (출결+성취도 양쪽 데이터 보유)`);

  // 3. 고위험군/우수군 비교
  if (stats.matchedStudents > 0) {
    const highRiskPct = Math.round((stats.highRiskCount / stats.matchedStudents) * 100);
    const excellentPct = Math.round((stats.excellentCount / stats.matchedStudents) * 100);
    insights.push(
      `우수군(출결90%+, green) ${stats.excellentCount}명(${excellentPct}%) / 고위험군(warning+danger, red) ${stats.highRiskCount}명(${highRiskPct}%)`,
    );
  }

  // 4. NPS 최고 기수
  if (cohorts.length > 0) {
    const bestNPS = [...cohorts].sort((a, b) => b.NPS - a.NPS)[0];
    if (bestNPS.NPS !== 0) {
      insights.push(`NPS가 가장 높은 기수: ${bestNPS.과정명} ${bestNPS.기수} (NPS ${bestNPS.NPS})`);
    }
  }

  // 5. 출결률 vs 성취도 하위 기수 경고
  const lowCohorts = cohorts.filter((c) => c.avgAttendanceRate < 80 && c.greenRate < 50);
  if (lowCohorts.length > 0) {
    const names = lowCohorts.map((c) => `${c.과정명} ${c.기수}`).join(", ");
    insights.push(`출결률·성취도 모두 저조한 기수: ${names} (집중 관리 필요)`);
  }

  // 6. 인구통계 인사이트 통합
  const genderData = buildGenderAnalysis(students);
  const ageData = buildAgeGroupAnalysis(students);
  const demoInsights = generateDemographicInsights(genderData, ageData, students);
  insights.push(...demoInsights);

  return insights;
}

/** 출결률 분포 (10% 구간 히스토그램 데이터) */
export function buildAttendanceDistribution(students: StudentCrossData[]): { label: string; count: number }[] {
  const brackets = [
    { label: "0~60%", min: 0, max: 60 },
    { label: "60~70%", min: 60, max: 70 },
    { label: "70~80%", min: 70, max: 80 },
    { label: "80~85%", min: 80, max: 85 },
    { label: "85~90%", min: 85, max: 90 },
    { label: "90~95%", min: 90, max: 95 },
    { label: "95~100%", min: 95, max: 101 },
  ];
  return brackets.map((b) => ({
    label: b.label,
    count: students.filter((s) => s.attendanceRate >= b.min && s.attendanceRate < b.max).length,
  }));
}

/** 위험등급 분포 */
export function buildRiskDistribution(students: StudentCrossData[]): { level: string; count: number; color: string }[] {
  const levels = [
    { level: "safe", label: "안전", color: "#10b981" },
    { level: "caution", label: "주의", color: "#f59e0b" },
    { level: "warning", label: "경고", color: "#f97316" },
    { level: "danger", label: "위험", color: "#ef4444" },
  ];
  return levels.map((l) => ({
    level: l.label,
    count: students.filter((s) => s.riskLevel === l.level).length,
    color: l.color,
  }));
}

/** 사분면 분석 (median 기준) */
export function buildQuadrantAnalysis(students: StudentCrossData[]): {
  medianAttendance: number;
  medianScore: number;
  quadrants: { label: string; emoji: string; count: number; students: StudentCrossData[] }[];
} {
  const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
  const median = (arr: number[]) => {
    const s = sorted(arr);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const attRates = students.map((s) => s.attendanceRate);
  const scores = students.map((s) => s.compositeScore);
  const medAtt = attRates.length > 0 ? median(attRates) : 80;
  const medScore = scores.length > 0 ? median(scores) : 50;

  const q1 = students.filter((s) => s.attendanceRate >= medAtt && s.compositeScore >= medScore);
  const q2 = students.filter((s) => s.attendanceRate < medAtt && s.compositeScore >= medScore);
  const q3 = students.filter((s) => s.attendanceRate < medAtt && s.compositeScore < medScore);
  const q4 = students.filter((s) => s.attendanceRate >= medAtt && s.compositeScore < medScore);

  return {
    medianAttendance: Math.round(medAtt * 10) / 10,
    medianScore: Math.round(medScore * 10) / 10,
    quadrants: [
      { label: "우수군 (고출결·고성취)", emoji: "🌟", count: q1.length, students: q1 },
      { label: "잠재력 (저출결·고성취)", emoji: "💎", count: q2.length, students: q2 },
      { label: "위험군 (저출결·저성취)", emoji: "🚨", count: q3.length, students: q3 },
      { label: "관리필요 (고출결·저성취)", emoji: "📋", count: q4.length, students: q4 },
    ],
  };
}

/** 과정 유형별(재직자/실업자) 비교 집계 */
export function buildCategoryComparison(cohorts: CohortCrossData[]): {
  category: string;
  avgAttendance: number;
  avgGreenRate: number;
  avgNPS: number;
  count: number;
}[] {
  // CohortCrossData에는 category가 없으므로 과정명으로 판별
  // 이 함수는 cohort 데이터만으로는 정확한 분류가 어려우므로
  // 모든 기수의 평균을 반환
  const all = cohorts;
  if (all.length === 0) return [];
  const avgAtt = all.reduce((s, c) => s + c.avgAttendanceRate, 0) / all.length;
  const avgGreen = all.reduce((s, c) => s + c.greenRate, 0) / all.length;
  const avgNPS = all.reduce((s, c) => s + c.NPS, 0) / all.length;
  return [{ category: "전체", avgAttendance: Math.round(avgAtt * 10) / 10, avgGreenRate: Math.round(avgGreen * 10) / 10, avgNPS: Math.round(avgNPS * 10) / 10, count: all.length }];
}

// ── 인구통계 대조분석 ─────────────────────────────────────

/** 성별 대조분석 */
export function buildGenderAnalysis(students: StudentCrossData[]): {
  gender: string;
  count: number;
  avgAttendance: number;
  avgScore: number;
  greenRate: number;
  dropoutRate: number;
  dangerRate: number;
}[] {
  const genders = ["남", "여"];
  return genders
    .map((g) => {
      const group = students.filter((s) => s.gender === g);
      const n = group.length;
      if (n === 0) return { gender: g, count: 0, avgAttendance: 0, avgScore: 0, greenRate: 0, dropoutRate: 0, dangerRate: 0 };
      const avgAtt = group.reduce((s, st) => s + st.attendanceRate, 0) / n;
      const avgScore = group.reduce((s, st) => s + st.compositeScore, 0) / n;
      const greenCount = group.filter((s) => s.신호등 === "green").length;
      const dropoutCount = group.filter((s) => s.훈련상태?.includes("중도탈락") || s.훈련상태?.includes("수료포기")).length;
      const dangerCount = group.filter((s) => s.riskLevel === "danger" || s.riskLevel === "warning").length;
      return {
        gender: g,
        count: n,
        avgAttendance: Math.round(avgAtt * 10) / 10,
        avgScore: Math.round(avgScore * 10) / 10,
        greenRate: Math.round((greenCount / n) * 100 * 10) / 10,
        dropoutRate: Math.round((dropoutCount / n) * 100 * 10) / 10,
        dangerRate: Math.round((dangerCount / n) * 100 * 10) / 10,
      };
    })
    .filter((g) => g.count > 0);
}

/** 연령대 대조분석 */
export function buildAgeGroupAnalysis(students: StudentCrossData[]): {
  ageGroup: string;
  count: number;
  avgAttendance: number;
  avgScore: number;
  greenRate: number;
  dropoutRate: number;
  dangerRate: number;
}[] {
  const brackets = [
    { label: "10대", min: 10, max: 20 },
    { label: "20대", min: 20, max: 30 },
    { label: "30대", min: 30, max: 40 },
    { label: "40대", min: 40, max: 50 },
    { label: "50대+", min: 50, max: 200 },
  ];
  return brackets
    .map((b) => {
      const group = students.filter((s) => s.age >= b.min && s.age < b.max);
      const n = group.length;
      if (n === 0)
        return { ageGroup: b.label, count: 0, avgAttendance: 0, avgScore: 0, greenRate: 0, dropoutRate: 0, dangerRate: 0 };
      const avgAtt = group.reduce((s, st) => s + st.attendanceRate, 0) / n;
      const avgScore = group.reduce((s, st) => s + st.compositeScore, 0) / n;
      const greenCount = group.filter((s) => s.신호등 === "green").length;
      const dropoutCount = group.filter((s) => s.훈련상태?.includes("중도탈락") || s.훈련상태?.includes("수료포기")).length;
      const dangerCount = group.filter((s) => s.riskLevel === "danger" || s.riskLevel === "warning").length;
      return {
        ageGroup: b.label,
        count: n,
        avgAttendance: Math.round(avgAtt * 10) / 10,
        avgScore: Math.round(avgScore * 10) / 10,
        greenRate: Math.round((greenCount / n) * 100 * 10) / 10,
        dropoutRate: Math.round((dropoutCount / n) * 100 * 10) / 10,
        dangerRate: Math.round((dangerCount / n) * 100 * 10) / 10,
      };
    })
    .filter((g) => g.count > 0);
}

/** 결석일수 구간별 하차 확률 분석 */
export function buildAbsentDropoutCorrelation(students: StudentCrossData[]): {
  bracket: string;
  totalCount: number;
  dropoutCount: number;
  dropoutRate: number;
}[] {
  const brackets = [
    { label: "0~2일", min: 0, max: 3 },
    { label: "3~5일", min: 3, max: 6 },
    { label: "6~9일", min: 6, max: 10 },
    { label: "10~14일", min: 10, max: 15 },
    { label: "15일+", min: 15, max: 999 },
  ];
  return brackets
    .map((b) => {
      const group = students.filter((s) => s.absentDays >= b.min && s.absentDays < b.max);
      const dropouts = group.filter((s) => s.훈련상태?.includes("중도탈락") || s.훈련상태?.includes("수료포기"));
      return {
        bracket: b.label,
        totalCount: group.length,
        dropoutCount: dropouts.length,
        dropoutRate: group.length > 0 ? Math.round((dropouts.length / group.length) * 100 * 10) / 10 : 0,
      };
    })
    .filter((b) => b.totalCount > 0);
}

/** 성별×연령 교차표 (2차원 매트릭스) */
export function buildGenderAgeMatrix(students: StudentCrossData[]): {
  rows: {
    ageGroup: string;
    male: { count: number; avgAtt: number; avgScore: number };
    female: { count: number; avgAtt: number; avgScore: number };
  }[];
} {
  const ageGroups = [
    { label: "20대", min: 20, max: 30 },
    { label: "30대", min: 30, max: 40 },
    { label: "40대+", min: 40, max: 200 },
  ];
  const calc = (group: StudentCrossData[]) => ({
    count: group.length,
    avgAtt:
      group.length > 0
        ? Math.round((group.reduce((s, st) => s + st.attendanceRate, 0) / group.length) * 10) / 10
        : 0,
    avgScore:
      group.length > 0
        ? Math.round((group.reduce((s, st) => s + st.compositeScore, 0) / group.length) * 10) / 10
        : 0,
  });
  const rows = ageGroups
    .map((ag) => {
      const inAge = students.filter((s) => s.age >= ag.min && s.age < ag.max);
      return {
        ageGroup: ag.label,
        male: calc(inAge.filter((s) => s.gender === "남")),
        female: calc(inAge.filter((s) => s.gender === "여")),
      };
    })
    .filter((r) => r.male.count > 0 || r.female.count > 0);
  return { rows };
}

/** 이탈 위험 요인 순위 (각 요인별 이탈자 비율 비교) */
export function buildDropoutRiskFactors(students: StudentCrossData[]): {
  factor: string;
  description: string;
  riskRate: number;
  safeRate: number;
  impactScore: number;
}[] {
  const dropouts = students.filter(
    (s) => s.훈련상태?.includes("중도탈락") || s.훈련상태?.includes("수료포기"),
  );
  const active = students.filter(
    (s) => !s.훈련상태?.includes("중도탈락") && !s.훈련상태?.includes("수료포기"),
  );
  if (dropouts.length === 0 || active.length === 0) return [];

  const factors: { factor: string; description: string; riskRate: number; safeRate: number }[] = [];

  // 1. 저출결 (80% 미만)
  const lowAttDropout = (dropouts.filter((s) => s.attendanceRate < 80).length / dropouts.length) * 100;
  const lowAttActive = (active.filter((s) => s.attendanceRate < 80).length / active.length) * 100;
  factors.push({
    factor: "저출결 (<80%)",
    description: "출결률 80% 미만",
    riskRate: Math.round(lowAttDropout * 10) / 10,
    safeRate: Math.round(lowAttActive * 10) / 10,
  });

  // 2. 저성취 (red 신호등)
  const redDropout = (dropouts.filter((s) => s.신호등 === "red").length / dropouts.length) * 100;
  const redActive = (active.filter((s) => s.신호등 === "red").length / active.length) * 100;
  factors.push({
    factor: "저성취 (red)",
    description: "신호등 red 등급",
    riskRate: Math.round(redDropout * 10) / 10,
    safeRate: Math.round(redActive * 10) / 10,
  });

  // 3. 고결석 (10일+)
  const highAbsDropout = (dropouts.filter((s) => s.absentDays >= 10).length / dropouts.length) * 100;
  const highAbsActive = (active.filter((s) => s.absentDays >= 10).length / active.length) * 100;
  factors.push({
    factor: "고결석 (10일+)",
    description: "결석 10일 이상",
    riskRate: Math.round(highAbsDropout * 10) / 10,
    safeRate: Math.round(highAbsActive * 10) / 10,
  });

  // 4. 위험등급 (warning/danger)
  const riskDropout =
    (dropouts.filter((s) => s.riskLevel === "warning" || s.riskLevel === "danger").length / dropouts.length) * 100;
  const riskActive =
    (active.filter((s) => s.riskLevel === "warning" || s.riskLevel === "danger").length / active.length) * 100;
  factors.push({
    factor: "위험등급",
    description: "경고/제적위험",
    riskRate: Math.round(riskDropout * 10) / 10,
    safeRate: Math.round(riskActive * 10) / 10,
  });

  // Impact score = risk/safe ratio (higher = more predictive)
  return factors
    .map((f) => ({
      ...f,
      impactScore: f.safeRate > 0 ? Math.round((f.riskRate / f.safeRate) * 10) / 10 : f.riskRate > 0 ? 99 : 0,
    }))
    .sort((a, b) => b.impactScore - a.impactScore);
}

/** NPS vs 출결률 상관 (기수 단위) */
export function calcNPSAttendanceCorrelation(cohorts: CohortCrossData[]): { r: number; description: string } {
  const valid = cohorts.filter((c) => c.NPS !== 0);
  if (valid.length < 3) return { r: 0, description: "데이터 부족" };
  const xs = valid.map((c) => c.NPS);
  const ys = valid.map((c) => c.avgAttendanceRate);
  const r = Math.round(pearsonR(xs, ys) * 1000) / 1000;
  return { r, description: describeCorrelation(r) };
}

/** 강사만족도 vs 성취도 상관 (기수 단위) */
export function calcInstructorScoreCorrelation(cohorts: CohortCrossData[]): { r: number; description: string } {
  const valid = cohorts.filter((c) => c.강사만족도 > 0);
  if (valid.length < 3) return { r: 0, description: "데이터 부족" };
  const xs = valid.map((c) => c.강사만족도);
  const ys = valid.map((c) => c.greenRate);
  const r = Math.round(pearsonR(xs, ys) * 1000) / 1000;
  return { r, description: describeCorrelation(r) };
}

/** 인구통계 기반 인사이트 생성 */
export function generateDemographicInsights(
  genderData: ReturnType<typeof buildGenderAnalysis>,
  ageData: ReturnType<typeof buildAgeGroupAnalysis>,
  students: StudentCrossData[],
): string[] {
  const insights: string[] = [];

  // 성별 인사이트
  if (genderData.length === 2) {
    const [a, b] = genderData;
    const attDiff = Math.abs(a.avgAttendance - b.avgAttendance);
    if (attDiff > 3) {
      const higher = a.avgAttendance > b.avgAttendance ? a : b;
      insights.push(`${higher.gender}성의 평균 출결률(${higher.avgAttendance}%)이 ${attDiff.toFixed(1)}%p 더 높습니다`);
    }
    const scoreDiff = Math.abs(a.avgScore - b.avgScore);
    if (scoreDiff > 5) {
      const higher = a.avgScore > b.avgScore ? a : b;
      insights.push(`${higher.gender}성의 평균 성취도(${higher.avgScore}점)가 ${scoreDiff.toFixed(1)}점 더 높습니다`);
    }
    const dangerDiffPct = Math.abs(a.dangerRate - b.dangerRate);
    if (dangerDiffPct > 5) {
      const higher = a.dangerRate > b.dangerRate ? a : b;
      insights.push(`${higher.gender}성 위험군 비율(${higher.dangerRate}%)이 상대적으로 높아 관리 필요`);
    }
  }

  // 연령대 인사이트
  if (ageData.length >= 2) {
    const bestAtt = [...ageData].sort((a, b) => b.avgAttendance - a.avgAttendance)[0];
    const worstAtt = [...ageData].sort((a, b) => a.avgAttendance - b.avgAttendance)[0];
    if (bestAtt.avgAttendance - worstAtt.avgAttendance > 3) {
      insights.push(
        `출결률 최고 연령대: ${bestAtt.ageGroup}(${bestAtt.avgAttendance}%) — 최저: ${worstAtt.ageGroup}(${worstAtt.avgAttendance}%)`,
      );
    }

    const bestScore = [...ageData].sort((a, b) => b.avgScore - a.avgScore)[0];
    insights.push(`성취도 최고 연령대: ${bestScore.ageGroup}(${bestScore.avgScore}점, ${bestScore.count}명)`);

    const highDanger = ageData.filter((a) => a.dangerRate > 15);
    if (highDanger.length > 0) {
      insights.push(`위험군 비율 높은 연령대: ${highDanger.map((a) => `${a.ageGroup}(${a.dangerRate}%)`).join(", ")}`);
    }
  }

  // 성별x연령 교차
  const youngMale = students.filter((s) => s.gender === "남" && s.age >= 20 && s.age < 30);
  const youngFemale = students.filter((s) => s.gender === "여" && s.age >= 20 && s.age < 30);
  if (youngMale.length >= 5 && youngFemale.length >= 5) {
    const mAtt = youngMale.reduce((s, st) => s + st.attendanceRate, 0) / youngMale.length;
    const fAtt = youngFemale.reduce((s, st) => s + st.attendanceRate, 0) / youngFemale.length;
    const diff = Math.abs(mAtt - fAtt);
    if (diff > 3) {
      const higher = mAtt > fAtt ? "남" : "여";
      insights.push(`20대 ${higher}성 출결률이 ${diff.toFixed(1)}%p 높음 (남 ${mAtt.toFixed(1)}% vs 여 ${fAtt.toFixed(1)}%)`);
    }
  }

  return insights;
}
