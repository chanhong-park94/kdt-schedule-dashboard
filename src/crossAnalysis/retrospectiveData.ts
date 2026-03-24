/**
 * 회고 리포트 데이터 수집 및 집계
 *
 * 5개 데이터 소스(출결·성취도·만족도·문의응대·하차방어)를 병렬 로드한 뒤
 * 섹션별 집계 데이터와 인사이트를 생성합니다.
 * 캐시가 없거나 비어 있으면 해당 섹션은 null로 반환 (graceful degradation).
 */

import { loadAchievementCache, summarizeByTrainee } from "../hrd/hrdAchievementApi";
import { loadSatisfactionCache, summarizeByCohort } from "../hrd/hrdSatisfactionApi";
import { loadInquiryCache, calcInquiryStats } from "../hrd/hrdInquiryApi";
import type { UnifiedRecord } from "../hrd/hrdAchievementTypes";
import type { SatisfactionRecord } from "../hrd/hrdSatisfactionTypes";
import type { InquiryRecord } from "../hrd/hrdInquiryTypes";
import type { AttendanceStudent } from "../hrd/hrdTypes";
import type {
  RetrospectiveFilter,
  RetrospectiveReportData,
  DataAvailability,
  AttendanceSectionData,
  AchievementSectionData,
  SatisfactionSectionData,
  InquirySectionData,
  DropoutSectionData,
  SectionInsight,
} from "./retrospectiveTypes";

// ── 유틸 ──────────────────────────────────────────────────────

/** 소수점 첫째 자리까지 반올림 */
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 배열 평균 (빈 배열이면 0) */
const avg = (arr: number[]): number => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// ── 출결 데이터 로드 ───────────────────────────────────────────

/**
 * hrdAttendance 모듈에서 캐시된 출결 학생 목록을 동적 import로 로드.
 * 모듈 미로드 시 빈 배열 반환.
 */
export async function loadAttendanceStudents(): Promise<AttendanceStudent[]> {
  try {
    const mod = await import("../hrd/hrdAttendance");
    if (typeof mod.getCachedAttendanceStudents === "function") {
      return mod.getCachedAttendanceStudents();
    }
  } catch {
    /* hrdAttendance 미로드 시 무시 */
  }
  return [];
}

// ── 출결 섹션 ──────────────────────────────────────────────────

/** 출결 데이터 → 출결 섹션 집계 */
export function buildAttendanceSection(students: AttendanceStudent[]): AttendanceSectionData | null {
  if (students.length === 0) return null;

  // 평균 출결률
  const avgRate = round1(avg(students.map((s) => s.attendanceRate)));

  // 중도탈락 / 재적 인원
  const dropoutStudents = students.filter((s) => s.dropout).length;
  const activeStudents = students.length - dropoutStudents;

  // 하차방어율: 재적 인원 / 전체 인원
  const defenseRate = students.length > 0 ? round1((activeStudents / students.length) * 100) : 0;

  // 위험군 분류
  const riskCounts = { danger: 0, warning: 0, caution: 0, safe: 0 };
  for (const s of students) {
    riskCounts[s.riskLevel]++;
  }

  // 결석 상위 3명 (결석일수 내림차순)
  const sorted = [...students].sort((a, b) => b.absentDays - a.absentDays);
  const absentTop3 = sorted.slice(0, 3).map((s) => ({
    name: s.name,
    absentDays: s.absentDays,
    rate: round1(s.attendanceRate),
  }));

  // 출결률 분포
  const brackets = [
    { label: "90%+", min: 90, max: 101 },
    { label: "80~90%", min: 80, max: 90 },
    { label: "70~80%", min: 70, max: 80 },
    { label: "70%미만", min: 0, max: 70 },
  ];
  const rateDistribution = brackets.map((b) => ({
    label: b.label,
    count: students.filter((s) => {
      // 최상위 구간은 [90, 100] 포함
      if (b.min === 90) return s.attendanceRate >= b.min;
      return s.attendanceRate >= b.min && s.attendanceRate < b.max;
    }).length,
  }));

  return {
    avgRate,
    defenseRate,
    riskCounts,
    absentTop3,
    rateDistribution,
    totalStudents: students.length,
    activeStudents,
    dropoutStudents,
  };
}

// ── 학업성취도 섹션 ─────────────────────────────────────────────

/** 성취도 레코드 → 학업성취도 섹션 집계 */
export function buildAchievementSection(
  records: UnifiedRecord[],
  filter: RetrospectiveFilter,
): AchievementSectionData | null {
  if (records.length === 0) return null;

  // 과정 필터 적용 후 훈련생별 집계 (기수는 후처리 필터)
  const summaries = summarizeByTrainee(records, filter.courseName, "");

  // 선택된 기수 필터 적용
  const filtered =
    filter.selectedDegrs.length > 0 ? summaries.filter((s) => filter.selectedDegrs.includes(s.기수)) : summaries;

  if (filtered.length === 0) return null;

  const total = filtered.length;

  // 신호등 분포
  const greenCount = filtered.filter((s) => s.신호등 === "green").length;
  const yellowCount = filtered.filter((s) => s.신호등 === "yellow").length;
  const redCount = filtered.filter((s) => s.신호등 === "red").length;

  const greenRate = round1((greenCount / total) * 100);
  const yellowRate = round1((yellowCount / total) * 100);
  const redRate = round1((redCount / total) * 100);

  // 평균 노드 완료율 / 퀘스트 완료율
  const nodeRates = filtered.map((s) => (s.총노드수 > 0 ? (s.제출노드수 / s.총노드수) * 100 : 0));
  const questRates = filtered.map((s) => (s.총퀘스트수 > 0 ? (s.패스퀘스트수 / s.총퀘스트수) * 100 : 0));

  const avgNodeRate = round1(avg(nodeRates));
  const avgQuestRate = round1(avg(questRates));

  // 복합점수: 노드 40% + 퀘스트 60%
  const avgComposite = round1(avgNodeRate * 0.4 + avgQuestRate * 0.6);

  return {
    greenRate,
    yellowRate,
    redRate,
    avgNodeRate,
    avgQuestRate,
    avgComposite,
    signalDistribution: [
      { signal: "green", count: greenCount },
      { signal: "yellow", count: yellowCount },
      { signal: "red", count: redCount },
    ],
    totalMatched: total,
  };
}

// ── 만족도 섹션 ─────────────────────────────────────────────────

/** 만족도 레코드 → 만족도 섹션 집계 */
export function buildSatisfactionSection(
  records: SatisfactionRecord[],
  filter: RetrospectiveFilter,
): SatisfactionSectionData | null {
  if (records.length === 0) return null;

  // 기수별 집계 후 과정/기수 필터
  const summaries = summarizeByCohort(records, filter.courseName, "");
  const filtered =
    filter.selectedDegrs.length > 0 ? summaries.filter((s) => filter.selectedDegrs.includes(s.기수)) : summaries;

  if (filtered.length === 0) return null;

  // 전체 평균 NPS / 강사만족도
  const NPS = round1(avg(filtered.map((s) => s.NPS평균)));
  const 강사만족도 = round1(avg(filtered.filter((s) => s.강사만족도평균 > 0).map((s) => s.강사만족도평균)));

  // HRD 만족도 (중간 + 최종 평균)
  const 중간 = filtered.filter((s) => s.중간만족도평균 > 0).map((s) => s.중간만족도평균);
  const 최종 = filtered.filter((s) => s.최종만족도평균 > 0).map((s) => s.최종만족도평균);
  const HRD만족도 = round1(avg([...중간, ...최종]));

  // 추천의향: NPS를 5점 스케일로 환산 (NPS -100~100 → 1~5)
  const 추천의향 = round1(((NPS + 100) / 200) * 4 + 1);

  // 항목별 점수 구성
  const itemScores = [
    { label: "NPS", score: NPS },
    { label: "강사만족도", score: 강사만족도 },
    { label: "HRD중간만족도", score: round1(avg(중간)) },
    { label: "HRD최종만족도", score: round1(avg(최종)) },
  ];

  return {
    NPS,
    강사만족도,
    HRD만족도,
    추천의향,
    itemScores,
  };
}

// ── 문의응대 섹션 ───────────────────────────────────────────────

/** 문의 레코드 → 문의응대 섹션 집계 */
export function buildInquirySection(
  records: InquiryRecord[],
  filter: RetrospectiveFilter,
): InquirySectionData | null {
  if (records.length === 0) return null;

  // 과정명 필터 적용
  const filtered = filter.courseName
    ? records.filter((r) => r.과정명.includes(filter.courseName))
    : records;

  if (filtered.length === 0) return null;

  // 기존 통계 함수 활용
  const stats = calcInquiryStats(filtered);

  // 채널별 분포
  const channelBreakdown = Object.entries(stats.채널별)
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  // 카테고리별 분포
  const categoryBreakdown = Object.entries(stats.유형별)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // 최다 문의 카테고리
  const topCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0].category : "-";

  return {
    totalCount: stats.총건수,
    channelBreakdown,
    topCategory,
    categoryBreakdown,
  };
}

// ── 하차방어 섹션 ───────────────────────────────────────────────

/** 출결 학생 → 하차방어 섹션 집계 */
export function buildDropoutSection(
  students: AttendanceStudent[],
  filter: RetrospectiveFilter,
): DropoutSectionData | null {
  if (students.length === 0) return null;

  const totalStudents = students.length;
  const dropoutCount = students.filter((s) => s.dropout).length;

  // 조기취업: 훈련상태가 없으므로 dropout이 아닌 학생 중 결석 0인 경우는 추정 불가
  // 하차방어율 = (전체 - 중도탈락) / 전체 * 100
  const finalDefenseRate = round1(((totalStudents - dropoutCount) / totalStudents) * 100);

  // 목표 방어율: 과정명으로 재직자/실업자 구분
  // 재직자 과정은 보통 목표 75%, 실업자는 85%
  const isEmployed = filter.courseName.includes("재직자");
  const targetRate = isEmployed ? 75 : 85;

  // 조기취업은 출결 데이터만으로 판별 불가 → 0으로 설정
  const earlyEmployment = 0;

  return {
    finalDefenseRate,
    totalStudents,
    dropoutCount,
    earlyEmployment,
    targetRate,
  };
}

// ── 인사이트 생성 ───────────────────────────────────────────────

/** 회고 리포트 전체 데이터에서 섹션별 인사이트 자동 생성 */
export function generateRetrospectiveInsights(data: RetrospectiveReportData): SectionInsight[] {
  const insights: SectionInsight[] = [];

  // 출결 섹션 인사이트
  if (data.attendance) {
    const att = data.attendance;
    if (att.avgRate >= 90) {
      insights.push({
        section: "attendance",
        emoji: "✅",
        text: `평균 출결률 ${att.avgRate}%로 우수한 수준입니다.`,
        level: "positive",
      });
    } else if (att.avgRate >= 80) {
      insights.push({
        section: "attendance",
        emoji: "⚠️",
        text: `평균 출결률 ${att.avgRate}%로 관리가 필요합니다.`,
        level: "neutral",
      });
    } else {
      insights.push({
        section: "attendance",
        emoji: "🚨",
        text: `평균 출결률 ${att.avgRate}%로 심각한 수준입니다. 집중 관리가 필요합니다.`,
        level: "negative",
      });
    }

    // 위험군 인사이트
    const dangerTotal = att.riskCounts.danger + att.riskCounts.warning;
    if (dangerTotal > 0) {
      insights.push({
        section: "attendance",
        emoji: "🔴",
        text: `위험·경고 등급 ${dangerTotal}명 (전체 ${att.totalStudents}명 중 ${round1((dangerTotal / att.totalStudents) * 100)}%)`,
        level: dangerTotal >= 5 ? "negative" : "neutral",
      });
    }
  }

  // 학업성취도 섹션 인사이트
  if (data.achievement) {
    const ach = data.achievement;
    if (ach.greenRate >= 70) {
      insights.push({
        section: "achievement",
        emoji: "🟢",
        text: `성취도 green 비율 ${ach.greenRate}%로 양호합니다.`,
        level: "positive",
      });
    } else if (ach.greenRate >= 50) {
      insights.push({
        section: "achievement",
        emoji: "🟡",
        text: `성취도 green 비율 ${ach.greenRate}%로 보통 수준입니다.`,
        level: "neutral",
      });
    } else {
      insights.push({
        section: "achievement",
        emoji: "🔴",
        text: `성취도 green 비율 ${ach.greenRate}%로 개선이 필요합니다.`,
        level: "negative",
      });
    }

    // 노드/퀘스트 완료율 인사이트
    insights.push({
      section: "achievement",
      emoji: "📊",
      text: `노드 완료율 ${ach.avgNodeRate}%, 퀘스트 패스율 ${ach.avgQuestRate}% (${ach.totalMatched}명 기준)`,
      level: ach.avgQuestRate >= 60 ? "positive" : "neutral",
    });
  }

  // 만족도 섹션 인사이트
  if (data.satisfaction) {
    const sat = data.satisfaction;
    if (sat.NPS >= 50) {
      insights.push({
        section: "satisfaction",
        emoji: "😊",
        text: `NPS ${sat.NPS}점으로 높은 만족도를 보입니다.`,
        level: "positive",
      });
    } else if (sat.NPS >= 0) {
      insights.push({
        section: "satisfaction",
        emoji: "😐",
        text: `NPS ${sat.NPS}점으로 보통 수준입니다.`,
        level: "neutral",
      });
    } else {
      insights.push({
        section: "satisfaction",
        emoji: "😟",
        text: `NPS ${sat.NPS}점으로 개선이 시급합니다.`,
        level: "negative",
      });
    }

    if (sat.강사만족도 > 0) {
      insights.push({
        section: "satisfaction",
        emoji: "👨‍🏫",
        text: `강사 만족도 ${sat.강사만족도}점/5점`,
        level: sat.강사만족도 >= 4 ? "positive" : sat.강사만족도 >= 3 ? "neutral" : "negative",
      });
    }
  }

  // 문의응대 섹션 인사이트
  if (data.inquiry) {
    const inq = data.inquiry;
    insights.push({
      section: "inquiry",
      emoji: "📞",
      text: `총 ${inq.totalCount}건 문의 응대, 최다 유형: ${inq.topCategory}`,
      level: "neutral",
    });

    // 채널 분포 인사이트
    if (inq.channelBreakdown.length > 0) {
      const topChannel = inq.channelBreakdown[0];
      const pct = round1((topChannel.count / inq.totalCount) * 100);
      insights.push({
        section: "inquiry",
        emoji: "💬",
        text: `주요 채널: ${topChannel.channel} (${topChannel.count}건, ${pct}%)`,
        level: "neutral",
      });
    }
  }

  // 하차방어 섹션 인사이트
  if (data.dropout) {
    const dr = data.dropout;
    const isAboveTarget = dr.finalDefenseRate >= dr.targetRate;
    insights.push({
      section: "dropout",
      emoji: isAboveTarget ? "🛡️" : "⚠️",
      text: `하차방어율 ${dr.finalDefenseRate}% (목표 ${dr.targetRate}%) — 중도탈락 ${dr.dropoutCount}명/${dr.totalStudents}명`,
      level: isAboveTarget ? "positive" : "negative",
    });
  }

  return insights;
}

// ── 메인: 데이터 수집 ───────────────────────────────────────────

/**
 * 5개 데이터 소스를 병렬 로드하여 회고 리포트 데이터를 생성합니다.
 *
 * 각 소스는 캐시에서 로드하며, 캐시가 없으면 해당 섹션은 null.
 * 에러 발생 시에도 다른 섹션은 정상 반환 (graceful degradation).
 */
export async function collectRetrospectiveData(filter: RetrospectiveFilter): Promise<RetrospectiveReportData> {
  // 5개 소스 병렬 로드 — 각각 에러 시 null/빈배열
  const [attendanceStudents, achievementRecords, satisfactionRecords, inquiryRecords] = await Promise.all([
    loadAttendanceStudents().catch(() => [] as AttendanceStudent[]),
    Promise.resolve(loadAchievementCache() ?? ([] as UnifiedRecord[])),
    Promise.resolve(loadSatisfactionCache() ?? ([] as SatisfactionRecord[])),
    Promise.resolve(loadInquiryCache() ?? ([] as InquiryRecord[])),
  ]);

  // 데이터 가용성 판별
  const availability: DataAvailability = {
    attendance: attendanceStudents.length > 0,
    achievement: achievementRecords.length > 0,
    satisfaction: satisfactionRecords.length > 0,
    inquiry: inquiryRecords.length > 0,
    dropout: attendanceStudents.length > 0, // 출결 데이터 기반
  };

  // 섹션별 집계 (데이터 없으면 null 반환)
  const attendance = availability.attendance ? buildAttendanceSection(attendanceStudents) : null;

  const achievement = availability.achievement ? buildAchievementSection(achievementRecords, filter) : null;

  const satisfaction = availability.satisfaction ? buildSatisfactionSection(satisfactionRecords, filter) : null;

  const inquiry = availability.inquiry ? buildInquirySection(inquiryRecords, filter) : null;

  const dropout = availability.dropout ? buildDropoutSection(attendanceStudents, filter) : null;

  return {
    filter,
    availability,
    attendance,
    achievement,
    satisfaction,
    inquiry,
    dropout,
    generatedAt: new Date().toISOString(),
  };
}
