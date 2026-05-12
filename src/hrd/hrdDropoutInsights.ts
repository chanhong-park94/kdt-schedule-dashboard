/**
 * 하차방어율 개선 인사이트 — 계산 로직
 *
 * 그룹회의 피드백 대응:
 *  - 대시보드 도입 전/후 비교 (cohort 단위)
 *  - 관리할 수 있는 leading 지표 4종 (위험군 회복/발생/연속결석 끊기/NPS)
 *  - Phase 2 시계열 데이터 동시 마련
 *
 * 설계: docs/plans/2026-05-12-dropout-insights-design.md
 */

import { summarizeByCohort } from "./hrdSatisfactionApi";
import type { DropoutRosterEntry } from "./hrdTypes";
import type { TraineeAnalysis } from "./hrdAnalyticsTypes";
import type { SatisfactionRecord } from "./hrdSatisfactionTypes";

// ─── 상수 ───────────────────────────────────────────────────

export const INSIGHTS_CONFIG_KEY = "kdt_dropout_insights_config_v1";
/** 본격 활용 시작 cutoff (사용자 합의 — 2026-05-12 회의) */
export const DEFAULT_CUTOFF = "2026-03-01";

/** 위험군 판정 임계 — maxConsecutiveAbsent 일수 */
const RISK_THRESHOLD_DAYS = 3;
/** 연속결석 "끊기" 판정 임계 */
const CONSEC_BREAK_THRESHOLD_DAYS = 5;
/** 충분한 표본 기준 (cohort 수) */
const SUFFICIENT_SAMPLE = 2;

// ─── 타입 ───────────────────────────────────────────────────

export interface DropoutInsightsConfig {
  cutoffDate: string; // YYYY-MM-DD
}

export type CohortClass = "before" | "after" | "unknown";

export interface ImpactMetrics {
  beforeAvgRate: number;
  afterAvgRate: number;
  deltaPp: number;
  beforeN: number;
  afterN: number;
  beforeTotalStudents: number;
  afterTotalStudents: number;
  /** 추정 절감 하차 인원 — (deltaPp/100) × 도입 후 전체 학생 수 (음수는 0 클램프) */
  estimatedSavedHeadcount: number;
}

export interface LeadingMetric {
  label: string;
  beforeValue: number;
  afterValue: number;
  delta: number;
  unit: "%" | "p" | "건";
  betterDirection: "up" | "down";
  beforeN: number;
  afterN: number;
}

export interface LeadingMetrics {
  riskRecovery: LeadingMetric;
  riskOccurrence: LeadingMetric;
  consecAbsentBreak: LeadingMetric;
  npsChange: LeadingMetric;
}

export interface TrendPoint {
  month: string; // YYYY-MM
  defenseRate: number;
  cohortCount: number;
}

export interface InsightsDiagnostics {
  beforeCohorts: string[];
  afterCohorts: string[];
  /** 만족도 시트에서 매칭 실패한 cohort 라벨 */
  missingNpsCohorts: string[];
  insufficientSample: boolean;
  warnings: string[];
}

// ─── Config 저장/로드 ───────────────────────────────────────

export function loadInsightsConfig(): DropoutInsightsConfig {
  try {
    const raw = localStorage.getItem(INSIGHTS_CONFIG_KEY);
    if (!raw) return { cutoffDate: DEFAULT_CUTOFF };
    const parsed = JSON.parse(raw) as Partial<DropoutInsightsConfig>;
    if (!parsed.cutoffDate || typeof parsed.cutoffDate !== "string") {
      return { cutoffDate: DEFAULT_CUTOFF };
    }
    return { cutoffDate: parsed.cutoffDate };
  } catch {
    return { cutoffDate: DEFAULT_CUTOFF };
  }
}

export function saveInsightsConfig(config: DropoutInsightsConfig): void {
  // 빈 cutoffDate는 저장 거부 — load 시 default로 폴백
  if (!config.cutoffDate) {
    localStorage.removeItem(INSIGHTS_CONFIG_KEY);
    return;
  }
  localStorage.setItem(INSIGHTS_CONFIG_KEY, JSON.stringify(config));
}

// ─── classifyCohort ─────────────────────────────────────────

export function classifyCohort(
  entry: { startDate: string },
  cutoff: string,
): CohortClass {
  if (!entry.startDate || !cutoff) return "unknown";
  const start = new Date(entry.startDate);
  const cut = new Date(cutoff);
  if (isNaN(start.getTime()) || isNaN(cut.getTime())) return "unknown";
  return start >= cut ? "after" : "before";
}

// ─── computeImpactMetrics ───────────────────────────────────

export function computeImpactMetrics(
  entries: DropoutRosterEntry[],
  cutoff: string,
): ImpactMetrics {
  const before: DropoutRosterEntry[] = [];
  const after: DropoutRosterEntry[] = [];
  for (const e of entries) {
    const cls = classifyCohort(e, cutoff);
    if (cls === "before") before.push(e);
    else if (cls === "after") after.push(e);
  }

  const beforeAvgRate = avg(before.map((e) => e.defenseRate));
  const afterAvgRate = avg(after.map((e) => e.defenseRate));
  // before 또는 after 중 하나가 비어있으면 비교 불가 → delta 0
  const deltaPp = before.length > 0 && after.length > 0
    ? round1(afterAvgRate - beforeAvgRate)
    : 0;

  const beforeTotalStudents = before.reduce((s, e) => s + e.total, 0);
  const afterTotalStudents = after.reduce((s, e) => s + e.total, 0);

  // 음수 delta는 0으로 클램프 (회의용 보수적 표현, 절감 효과는 음수 의미 없음)
  const estimatedSavedHeadcount = deltaPp > 0
    ? Math.round((deltaPp / 100) * afterTotalStudents)
    : 0;

  return {
    beforeAvgRate: round1(beforeAvgRate),
    afterAvgRate: round1(afterAvgRate),
    deltaPp,
    beforeN: before.length,
    afterN: after.length,
    beforeTotalStudents,
    afterTotalStudents,
    estimatedSavedHeadcount,
  };
}

// ─── computeLeadingMetrics ──────────────────────────────────

export function computeLeadingMetrics(
  dropoutEntries: DropoutRosterEntry[],
  analysisData: TraineeAnalysis[],
  satRecords: SatisfactionRecord[],
  cutoff: string,
): LeadingMetrics {
  // 1) cohort 분류 — 키: courseName|degr (TraineeAnalysis와 매칭용)
  const cohortClassMap = new Map<string, CohortClass>();
  for (const e of dropoutEntries) {
    cohortClassMap.set(`${e.courseName}|${e.degr}`, classifyCohort(e, cutoff));
  }

  // 2) cohort별 학생 그룹핑 (analysisData)
  const cohortStudents = new Map<string, TraineeAnalysis[]>();
  for (const t of analysisData) {
    const key = `${t.courseName}|${t.degr}`;
    if (!cohortStudents.has(key)) cohortStudents.set(key, []);
    cohortStudents.get(key)!.push(t);
  }

  // 3) cohort별 leading 지표 계산
  const beforeRecovery: number[] = [];
  const afterRecovery: number[] = [];
  const beforeOccurrence: number[] = [];
  const afterOccurrence: number[] = [];
  const beforeBreak: number[] = [];
  const afterBreak: number[] = [];

  for (const [key, students] of cohortStudents) {
    const cls = cohortClassMap.get(key);
    if (cls !== "before" && cls !== "after") continue;
    if (students.length === 0) continue;

    const riskStudents = students.filter((s) => s.maxConsecutiveAbsent >= RISK_THRESHOLD_DAYS);
    const breakStudents = students.filter((s) => s.maxConsecutiveAbsent >= CONSEC_BREAK_THRESHOLD_DAYS);

    // 위험군 발생률 (모든 cohort 포함 — 0명이어도 0%로 의미 있음)
    const occurrenceRate = (riskStudents.length / students.length) * 100;
    if (cls === "before") beforeOccurrence.push(occurrenceRate);
    else afterOccurrence.push(occurrenceRate);

    // 위험군 회복률 (위험 0명인 cohort는 산정 불가 → 제외)
    if (riskStudents.length > 0) {
      const recoveryRate = (riskStudents.filter((s) => !s.dropout).length / riskStudents.length) * 100;
      if (cls === "before") beforeRecovery.push(recoveryRate);
      else afterRecovery.push(recoveryRate);
    }

    // 연속결석 끊기 성공률 (5일+ 0명인 cohort 제외)
    if (breakStudents.length > 0) {
      const breakRate = (breakStudents.filter((s) => !s.dropout).length / breakStudents.length) * 100;
      if (cls === "before") beforeBreak.push(breakRate);
      else afterBreak.push(breakRate);
    }
  }

  // 4) NPS — 만족도 시트와 매칭 (cohort 단위)
  const satSummaries = summarizeByCohort(satRecords, "", "");
  const satNpsMap = new Map<string, number>();
  for (const s of satSummaries) {
    satNpsMap.set(`${s.과정명}|${s.기수}`, s.NPS평균);
  }
  const beforeNps: number[] = [];
  const afterNps: number[] = [];
  for (const e of dropoutEntries) {
    const cls = classifyCohort(e, cutoff);
    if (cls !== "before" && cls !== "after") continue;
    const nps = satNpsMap.get(`${e.courseName}|${e.degr}기`);
    if (nps === undefined) continue;
    if (cls === "before") beforeNps.push(nps);
    else afterNps.push(nps);
  }

  return {
    riskRecovery: makeMetric({
      label: "위험군 회복률",
      before: beforeRecovery, after: afterRecovery,
      unit: "%", betterDirection: "up",
    }),
    riskOccurrence: makeMetric({
      label: "신규 위험군 발생률",
      before: beforeOccurrence, after: afterOccurrence,
      unit: "%", betterDirection: "down",
    }),
    consecAbsentBreak: makeMetric({
      label: "연속결석 끊기 성공률",
      before: beforeBreak, after: afterBreak,
      unit: "%", betterDirection: "up",
    }),
    npsChange: makeMetric({
      label: "NPS 평균",
      before: beforeNps, after: afterNps,
      unit: "p", betterDirection: "up",
    }),
  };
}

// ─── computeMonthlyTrend ────────────────────────────────────

export function computeMonthlyTrend(entries: DropoutRosterEntry[]): TrendPoint[] {
  const monthMap = new Map<string, { rates: number[]; count: number }>();
  for (const e of entries) {
    if (!e.startDate) continue;
    const d = new Date(e.startDate);
    if (isNaN(d.getTime())) continue;
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthMap.has(month)) monthMap.set(month, { rates: [], count: 0 });
    const entry = monthMap.get(month)!;
    entry.rates.push(e.defenseRate);
    entry.count++;
  }

  return Array.from(monthMap.entries())
    .map(([month, { rates, count }]) => ({
      month,
      defenseRate: round1(avg(rates)),
      cohortCount: count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ─── buildDiagnostics ───────────────────────────────────────

export function buildDiagnostics(
  entries: DropoutRosterEntry[],
  satRecords: SatisfactionRecord[],
  cutoff: string,
): InsightsDiagnostics {
  const satKeys = new Set(
    summarizeByCohort(satRecords, "", "").map((s) => `${s.과정명}|${s.기수}`),
  );

  const beforeCohorts: string[] = [];
  const afterCohorts: string[] = [];
  const missingNpsCohorts: string[] = [];

  for (const e of entries) {
    const cls = classifyCohort(e, cutoff);
    const label = `${e.courseName} ${e.degr}기`;
    if (cls === "before") beforeCohorts.push(label);
    else if (cls === "after") afterCohorts.push(label);
    else continue;
    if (!satKeys.has(`${e.courseName}|${e.degr}기`)) {
      missingNpsCohorts.push(label);
    }
  }

  const insufficientSample = beforeCohorts.length < SUFFICIENT_SAMPLE
    || afterCohorts.length < SUFFICIENT_SAMPLE;

  const warnings: string[] = [];
  if (insufficientSample) {
    warnings.push(
      `표본이 부족합니다 (도입 전 ${beforeCohorts.length}기수 / 도입 후 ${afterCohorts.length}기수). ` +
      `최소 ${SUFFICIENT_SAMPLE}기수 이상이어야 신뢰 가능합니다.`,
    );
  }
  if (missingNpsCohorts.length > 0) {
    warnings.push(`만족도 데이터 누락: ${missingNpsCohorts.length}개 기수 — NPS 비교에서 제외됨`);
  }

  return {
    beforeCohorts,
    afterCohorts,
    missingNpsCohorts,
    insufficientSample,
    warnings,
  };
}

// ─── 내부 헬퍼 ──────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function makeMetric(args: {
  label: string;
  before: number[];
  after: number[];
  unit: LeadingMetric["unit"];
  betterDirection: LeadingMetric["betterDirection"];
}): LeadingMetric {
  const beforeValue = round1(avg(args.before));
  const afterValue = round1(avg(args.after));
  const delta = args.before.length > 0 && args.after.length > 0
    ? round1(afterValue - beforeValue)
    : 0;
  return {
    label: args.label,
    beforeValue,
    afterValue,
    delta,
    unit: args.unit,
    betterDirection: args.betterDirection,
    beforeN: args.before.length,
    afterN: args.after.length,
  };
}
