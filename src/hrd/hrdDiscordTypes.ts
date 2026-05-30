/**
 * 디스코드 강의질의응답 수집·분석 타입
 */

/** GAS 프록시가 반환하는 원본 메시지 */
export interface DiscordRawMessage {
  channelId: string;
  id: string;
  authorId: string;
  authorName: string;
  authorBot: boolean;
  content: string;
  timestamp: string; // ISO
}

export interface DiscordProxyResponse {
  ok: boolean;
  messages?: DiscordRawMessage[];
  fetchedAt?: string;
  channelErrors?: string[];
  error?: string;
}

/** 분석 파생 필드까지 포함한 내부 메시지 */
export interface DiscordMessage extends DiscordRawMessage {
  cohortLabel: string; // 채널↔기수 매핑 결과
  isStaff: boolean; // 운영자 author ID 목록 대조
  category: string; // 키워드 분류 (출결/…/기타)
  isQuestion: boolean; // 학생 + 물음표/의문사 휴리스틱
  answered: boolean; // 이후 같은 채널 운영자 답변 존재
}

/** 채널 ↔ 기수 매핑 */
export interface DiscordChannelMap {
  id: string; // 디스코드 채널 ID
  label: string; // 기수 라벨 (예: "데싸 6기")
}

/** 설정 (localStorage) */
export interface DiscordConfig {
  gasUrl: string;
  channels: DiscordChannelMap[];
  staffAuthorIds: string[];
}

/** 분석 통계 */
export interface DiscordStats {
  총메시지: number;
  학생질문: number;
  미응답: number;
  응답완료: number;
  카테고리별: Record<string, number>;
  기수별: Record<string, number>;
  최다카테고리: string;
}

export const DISCORD_CONFIG_KEY = "kdt_discord_config_v1";
export const DISCORD_CACHE_KEY = "kdt_discord_cache_v1";

/** 카테고리 → 운영지침 매뉴얼 카테고리 ID (방금 만든 guideline 모듈) */
export const CATEGORY_TO_GUIDELINE: Record<string, string> = {
  출결: "attendance",
  수강신청: "trainee",
  중도포기: "attendance",
  내배카: "regulationNbc",
  수료: "reporting",
  취업: "reporting",
  훈련장려금: "payment",
  수업문의: "execution",
};

/** 카테고리 표시 색상 (문의응대 CATEGORY_COLORS와 일관) */
export const DISCORD_CATEGORY_COLORS: Record<string, string> = {
  출결: "background:#dbeafe;color:#1e40af",
  수강신청: "background:#fce7f3;color:#9d174d",
  내배카: "background:#fef3c7;color:#92400e",
  훈련장려금: "background:#d1fae5;color:#065f46",
  중도포기: "background:#fef2f2;color:#991b1b",
  수업문의: "background:#e0e7ff;color:#3730a3",
  취업: "background:#ede9fe;color:#5b21b6",
  수료: "background:#ecfdf5;color:#065f46",
  기타: "background:#f3f4f6;color:#374151",
};
