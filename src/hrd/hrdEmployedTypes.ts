/**
 * 재직자 학업성취도 (유닛리포트) 타입 정의
 *
 * CSV 기반 유닛리포트 데이터를 스키마 구글시트 "학업성취도(재직자)"에서 조회합니다.
 * 헤더: 과정명, 기수, 성명, 레벨, 경험치, 작성일,
 *       유닛1~12_강사진단, 유닛1~12_운영진단, 프로젝트1~4
 */

export const EMPLOYED_CACHE_KEY = "kdt_employed_cache_v1";

export interface EmployedRecord {
  과정명: string;
  기수: string;
  성명: string;
  레벨: number;
  경험치: number;
  작성일: string;
  강사진단: (number | null)[]; // 유닛1~12
  운영진단: (number | null)[]; // 유닛1~12
  프로젝트: (number | null)[]; // 프로젝트1~4
}

export interface EmployedSummary {
  과정명: string;
  기수: string;
  성명: string;
  레벨: number;
  경험치: number;
  강사진단평균: number;
  운영진단평균: number;
  프로젝트평균: number;
  종합등급: string; // A/B/C/D
}

export interface EmployedCache {
  timestamp: number;
  records: EmployedRecord[];
}
