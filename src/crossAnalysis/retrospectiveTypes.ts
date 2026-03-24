/**
 * 회고 리포트 타입 정의
 *
 * 종강 후 기수별 회고 리포트를 자동 생성하기 위한 인터페이스.
 * 출결·성취도·만족도·문의응대·하차방어 데이터를 섹션별로 집계한다.
 */

// ── 필터 & 데이터 가용성 ─────────────────────────────────────

/** 회고 리포트 필터 조건 */
export interface RetrospectiveFilter {
  courseName: string; // 과정명
  trainPrId: string; // HRD 과정실시 ID
  selectedDegrs: string[]; // 선택된 기수 목록
}

/** 섹션별 데이터 존재 여부 (API 설정·캐시 유무 기반) */
export interface DataAvailability {
  attendance: boolean; // 출결 데이터
  achievement: boolean; // 학업성취도 데이터
  satisfaction: boolean; // 만족도 데이터
  inquiry: boolean; // 문의응대 데이터
  dropout: boolean; // 하차방어 데이터
}

// ── 출결 섹션 ────────────────────────────────────────────────

/** 위험군 등급별 인원수 */
export interface RiskCounts {
  danger: number; // 위험 (출결률 70% 미만)
  warning: number; // 경고 (70~80%)
  caution: number; // 주의 (80~90%)
  safe: number; // 안전 (90%+)
}

/** 결석 상위 3명 정보 */
export interface AbsentTop3Entry {
  name: string;
  absentDays: number;
  rate: number; // 출결률 (0~100)
}

/** 출결률 분포 구간별 인원 */
export interface RateDistributionEntry {
  label: string; // "90%+", "80~90%" 등
  count: number;
}

/** 출결 섹션 집계 데이터 */
export interface AttendanceSectionData {
  avgRate: number; // 평균 출결률 (0~100)
  defenseRate: number; // 하차방어율 (0~100)
  riskCounts: RiskCounts;
  absentTop3: AbsentTop3Entry[];
  rateDistribution: RateDistributionEntry[];
  totalStudents: number; // 전체 인원
  activeStudents: number; // 훈련중 인원
  dropoutStudents: number; // 중도탈락 인원
}

// ── 학업성취도 섹션 ──────────────────────────────────────────

/** 신호등 분포 항목 */
export interface SignalDistributionEntry {
  signal: "green" | "yellow" | "red";
  count: number;
}

/** 학업성취도 섹션 집계 데이터 */
export interface AchievementSectionData {
  greenRate: number; // 신호등 green 비율 (0~100)
  yellowRate: number; // 신호등 yellow 비율 (0~100)
  redRate: number; // 신호등 red 비율 (0~100)
  avgNodeRate: number; // 평균 노드 완료율 (0~100)
  avgQuestRate: number; // 평균 퀘스트 완료율 (0~100)
  avgComposite: number; // 평균 복합점수 (0~100)
  signalDistribution: SignalDistributionEntry[];
  totalMatched: number; // 매칭된 학생 수
}

// ── 만족도 섹션 ──────────────────────────────────────────────

/** 만족도 항목별 점수 */
export interface ItemScoreEntry {
  label: string; // 항목명 (예: "교육내용", "교육환경")
  score: number; // 점수 (1~5 또는 0~100 스케일)
}

/** 만족도 섹션 집계 데이터 */
export interface SatisfactionSectionData {
  NPS: number; // NPS (-100~100)
  강사만족도: number; // 강사 만족도 (1~5)
  HRD만족도: number; // HRD 만족도 (1~5)
  추천의향: number; // 추천의향 점수 (1~5)
  itemScores: ItemScoreEntry[];
}

// ── 문의응대 섹션 ────────────────────────────────────────────

/** 채널별 문의 건수 */
export interface ChannelBreakdownEntry {
  channel: string; // 채널명 (예: "카카오톡", "전화", "이메일")
  count: number;
}

/** 카테고리별 문의 건수 */
export interface CategoryBreakdownEntry {
  category: string; // 카테고리명 (예: "출결", "교육과정", "취업")
  count: number;
}

/** 문의응대 섹션 집계 데이터 */
export interface InquirySectionData {
  totalCount: number; // 총 문의 건수
  channelBreakdown: ChannelBreakdownEntry[];
  topCategory: string; // 최다 문의 카테고리
  categoryBreakdown: CategoryBreakdownEntry[];
}

// ── 하차방어 섹션 ────────────────────────────────────────────

/** 하차방어 섹션 집계 데이터 */
export interface DropoutSectionData {
  finalDefenseRate: number; // 최종 하차방어율 (0~100)
  totalStudents: number; // 전체 인원
  dropoutCount: number; // 중도탈락 인원
  earlyEmployment: number; // 조기취업 인원
  targetRate: number; // 목표 방어율 (0~100)
}

// ── 회고 리포트 통합 ─────────────────────────────────────────

/** 회고 리포트 전체 데이터 (섹션별 데이터는 가용하지 않으면 null) */
export interface RetrospectiveReportData {
  filter: RetrospectiveFilter;
  availability: DataAvailability;
  attendance: AttendanceSectionData | null;
  achievement: AchievementSectionData | null;
  satisfaction: SatisfactionSectionData | null;
  inquiry: InquirySectionData | null;
  dropout: DropoutSectionData | null;
  generatedAt: string; // ISO 8601 생성 시각
}

// ── 인사이트 ─────────────────────────────────────────────────

/** 섹션별 자동 생성 인사이트 (긍정/중립/부정 판정) */
export interface SectionInsight {
  section: string; // 섹션 식별자 (예: "attendance", "achievement")
  emoji: string; // 시각 표시 이모지
  text: string; // 인사이트 텍스트 (한국어)
  level: "positive" | "neutral" | "negative";
}
