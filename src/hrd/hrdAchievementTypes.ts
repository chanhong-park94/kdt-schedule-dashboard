/** 노드퀘스트DB 통합시트 1행 = 1개 노드 또는 퀘스트 기록 */
export interface UnifiedRecord {
  구분: string;
  기수: string;
  학번: number;
  고유번호: number;
  이름: string;
  길드: string;
  과정: string;
  세부과정: string;
  훈련상태: string;
  모듈명: string;
  노드명: string;
  별점: number;
  노드순서: number;
  노드실행여부: boolean;
  퀘스트명: string;
  퀘스트상태: "P" | "F" | null;
  퀘스트순서: number;
  퀘스트실행여부: boolean;
}

/** 훈련생별 집계 (클라이언트에서 통합시트 그룹핑 후 생성) */
export interface TraineeAchievementSummary {
  이름: string;
  길드: string;
  과정: string;
  기수: string;
  훈련상태: string;
  총노드수: number;
  제출노드수: number;
  노드평균별점: number;
  총퀘스트수: number;
  패스퀘스트수: number;
  신호등: "green" | "yellow" | "red";
}

/** 개별 노드 시트 행 */
export interface NodeSheetRow {
  이름: string;
  신호등: string;
  누적별점: number;
  노드제출률: number;
  모듈별점수: Record<string, number | null>;
}

/** 개별 퀘스트 시트 행 */
export interface QuestSheetRow {
  고유번호: number;
  이름: string;
  길드: string;
  과정: string;
  상태: string;
  퀘스트별상태: Record<string, "P" | "F" | null>;
  PASS_TOTAL: number;
  퀘스트점수: number;
  TOTAL: number;
}

/** 학업성취도 설정 */
export interface AchievementConfig {
  webAppUrl: string;
}

export const ACHIEVEMENT_CONFIG_KEY = "kdt_achievement_config_v1";
export const ACHIEVEMENT_CACHE_KEY = "kdt_achievement_cache_v1";
