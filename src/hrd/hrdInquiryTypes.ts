/**
 * 문의응대 Airtable 연동 타입 정의
 */

// ── Airtable 원본 레코드 ────────────────────────────────────
export interface AirtableInquiryFields {
  작성자?: string;
  학생이름?: string[]; // Linked Record IDs
  문의내용?: string;
  응답내용?: string;
  질문요약?: string;
  응대채널?: string;
  과정?: string[]; // Linked Record IDs
  "상담 진행 날짜"?: string;
}

export interface AirtableRecord<T> {
  id: string;
  createdTime: string;
  fields: T;
}

export interface AirtableResponse<T> {
  records: AirtableRecord<T>[];
  offset?: string;
}

// ── ID→이름 매핑용 ──────────────────────────────────────────
export interface AirtableStudentFields {
  "Student Name"?: string;
}

export interface AirtableCourseFields {
  과정명?: string;
}

// ── 변환 후 내부 타입 ───────────────────────────────────────
export interface InquiryRecord {
  id: string;
  작성자: string;
  학생이름: string;
  문의내용: string;
  응답내용: string;
  질문요약: string;
  응대채널: string;
  과정명: string;
  상담일: string;
}

// ── 통계 ────────────────────────────────────────────────────
export interface InquiryStats {
  총건수: number;
  최근7일: number;
  채널별: Record<string, number>;
  작성자별: Record<string, number>;
  유형별: Record<string, number>;
}

// ── 설정 ────────────────────────────────────────────────────
export interface InquiryConfig {
  baseId: string;
  pat: string;
}

export const INQUIRY_CONFIG_KEY = "inquiry_airtable_config";
export const INQUIRY_CACHE_KEY = "inquiry_airtable_cache";

// ── 질문 유형 분류 키워드 ───────────────────────────────────
export const INQUIRY_CATEGORIES: Record<string, string[]> = {
  출결: ["출결", "출석", "결석", "지각", "병결", "공가", "병가"],
  수강신청: ["수강신청", "수강", "신청", "입과", "등록"],
  중도포기: ["중도포기", "중도탈락", "수강철회", "포기"],
  내배카: ["내배카", "내일배움", "카드", "크레딧"],
  수료: ["수료", "수료증", "제적"],
  취업: ["취업", "조기취업", "고용보험", "근로계약"],
  훈련장려금: ["장려금", "훈련장려금", "지급"],
  수업문의: ["수업", "강의", "녹화", "휴일", "공휴일"],
} as const;
