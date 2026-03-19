/**
 * 만족도 대시보드 타입 정의
 *
 * 스키마 구글시트 "만족도" 탭에서 수기 취합된 데이터를
 * Apps Script Web App을 통해 조회합니다.
 */

// ── localStorage 키 ─────────────────────────────────────────
export const SATISFACTION_CONFIG_KEY = "kdt_satisfaction_config_v1";
export const SATISFACTION_CACHE_KEY = "kdt_satisfaction_cache_v1";

// ── 설정 ────────────────────────────────────────────────────
export interface SatisfactionConfig {
  /** Apps Script Web App URL (학업성취도와 동일 URL 공유 가능) */
  webAppUrl: string;
}

// ── 원본 레코드 (시트 행 1개) ───────────────────────────────
export interface SatisfactionRecord {
  과정명: string;
  기수: string;
  모듈명: string;
  NPS: number;
  강사만족도: number;
  중간만족도: number;
  최종만족도: number;
}

// ── 과정/기수별 집계 ────────────────────────────────────────
export interface SatisfactionSummary {
  과정명: string;
  기수: string;
  응답수: number;
  NPS평균: number;
  강사만족도평균: number;
  중간만족도평균: number;
  최종만족도평균: number;
  모듈별: { 모듈명: string; NPS평균: number; 응답수: number }[];
}

// ── 전체 통계 ───────────────────────────────────────────────
export interface SatisfactionStats {
  총응답수: number;
  NPS평균: number;
  강사만족도평균: number;
  중간만족도평균: number;
  최종만족도평균: number;
  과정별NPS: Record<string, number>;
}

// ── 캐시 ────────────────────────────────────────────────────
export interface SatisfactionCache {
  timestamp: number;
  records: SatisfactionRecord[];
}
