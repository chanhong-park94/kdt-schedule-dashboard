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
 * 만족도 캐시에서 SatisfactionRecord 로드
 * @returns 캐시된 레코드 배열 또는 빈 배열
 */
export function loadCachedSatisfactionRecords(): SatisfactionRecord[] {
  return loadSatisfactionCache() ?? [];
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

  return insights;
}
