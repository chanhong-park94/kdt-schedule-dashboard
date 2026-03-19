/**
 * 문의응대 Airtable API 연동 모듈
 *
 * 3개 테이블(응대, 수강생, 과정) fetch → ID→이름 매핑 → InquiryRecord 변환
 */
import type {
  AirtableResponse,
  AirtableInquiryFields,
  AirtableStudentFields,
  AirtableCourseFields,
  InquiryRecord,
  InquiryStats,
  InquiryConfig,
} from "./hrdInquiryTypes";
import { INQUIRY_CONFIG_KEY, INQUIRY_CACHE_KEY, INQUIRY_CATEGORIES } from "./hrdInquiryTypes";

// ── 설정 저장/불러오기 ──────────────────────────────────────
export function loadInquiryConfig(): InquiryConfig {
  try {
    const raw = localStorage.getItem(INQUIRY_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as InquiryConfig;
  } catch {
    /* ignore */
  }
  return { baseId: "", pat: "" };
}

export function saveInquiryConfig(config: InquiryConfig): void {
  localStorage.setItem(INQUIRY_CONFIG_KEY, JSON.stringify(config));
}

// ── 캐시 ────────────────────────────────────────────────────
interface InquiryCache {
  timestamp: number;
  records: InquiryRecord[];
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

export function loadInquiryCache(): InquiryRecord[] | null {
  const c = _loadCache();
  return c ? c.records : null;
}

function _loadCache(): InquiryCache | null {
  try {
    const raw = localStorage.getItem(INQUIRY_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as InquiryCache;
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache;
  } catch {
    return null;
  }
}

function saveCache(records: InquiryRecord[]): void {
  const cache: InquiryCache = { timestamp: Date.now(), records };
  try {
    localStorage.setItem(INQUIRY_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota exceeded — ignore */
  }
}

// ── Airtable fetch (페이지네이션 포함) ──────────────────────
async function fetchAllRecords<T>(
  baseId: string,
  tableName: string,
  pat: string,
  fields?: string[],
): Promise<{ id: string; fields: T }[]> {
  const all: { id: string; fields: T }[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams();
    if (offset) params.set("offset", offset);
    if (fields) fields.forEach((f) => params.append("fields[]", f));
    params.set("pageSize", "100");

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
    });

    if (!res.ok) {
      throw new Error(`Airtable API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as AirtableResponse<T>;
    all.push(...data.records.map((r) => ({ id: r.id, fields: r.fields })));
    offset = data.offset;
  } while (offset);

  return all;
}

// ── 연결 테스트 ─────────────────────────────────────────────
export async function testInquiryConnection(config: InquiryConfig): Promise<string> {
  const url = `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent("응대")}?maxRecords=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.pat}` },
  });

  if (!res.ok) {
    throw new Error(`연결 실패: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as AirtableResponse<AirtableInquiryFields>;
  return `연결 성공! (${data.records.length > 0 ? "데이터 확인됨" : "빈 테이블"})`;
}

// ── 전체 데이터 로드 ────────────────────────────────────────
export async function fetchInquiryRecords(
  config: InquiryConfig,
  useCache = true,
): Promise<InquiryRecord[]> {
  // 캐시 확인
  if (useCache) {
    const cached = _loadCache();
    if (cached) return cached.records;
  }

  // 3개 테이블 병렬 fetch
  const [inquiryRaw, studentRaw, courseRaw] = await Promise.all([
    fetchAllRecords<AirtableInquiryFields>(config.baseId, "응대", config.pat),
    fetchAllRecords<AirtableStudentFields>(config.baseId, "수강생", config.pat, ["Student Name"]),
    fetchAllRecords<AirtableCourseFields>(config.baseId, "과정", config.pat, ["과정명"]),
  ]);

  // ID→이름 매핑 테이블
  const studentMap = new Map<string, string>();
  for (const s of studentRaw) {
    if (s.fields["Student Name"]) studentMap.set(s.id, s.fields["Student Name"]);
  }

  const courseMap = new Map<string, string>();
  for (const c of courseRaw) {
    if (c.fields["과정명"]) courseMap.set(c.id, c.fields["과정명"]);
  }

  // 변환
  const records: InquiryRecord[] = inquiryRaw.map((r) => {
    const f = r.fields;
    const studentIds = f.학생이름 ?? [];
    const courseIds = f.과정 ?? [];

    return {
      id: r.id,
      작성자: f.작성자 ?? "",
      학생이름: studentIds.map((id) => studentMap.get(id) ?? "").filter(Boolean).join(", ") || "-",
      문의내용: f.문의내용 ?? "",
      응답내용: f.응답내용 ?? "",
      질문요약: f.질문요약 ?? "",
      응대채널: f.응대채널 ?? "",
      과정명: courseIds.map((id) => courseMap.get(id) ?? "").filter(Boolean).join(", ") || "-",
      상담일: f["상담 진행 날짜"] ?? "",
    };
  });

  // 날짜 내림차순 정렬
  records.sort((a, b) => b.상담일.localeCompare(a.상담일));

  saveCache(records);
  return records;
}

// ── 통계 계산 ───────────────────────────────────────────────
export function calcInquiryStats(records: InquiryRecord[]): InquiryStats {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const 채널별: Record<string, number> = {};
  const 작성자별: Record<string, number> = {};
  const 유형별: Record<string, number> = {};
  let 최근7일 = 0;

  for (const r of records) {
    // 채널
    const ch = r.응대채널 || "기타";
    채널별[ch] = (채널별[ch] ?? 0) + 1;

    // 작성자
    if (r.작성자) {
      작성자별[r.작성자] = (작성자별[r.작성자] ?? 0) + 1;
    }

    // 최근 7일
    if (r.상담일 >= weekAgoStr) 최근7일++;

    // 유형 분류
    const summary = r.질문요약;
    let matched = false;
    for (const [category, keywords] of Object.entries(INQUIRY_CATEGORIES)) {
      if (keywords.some((kw) => summary.includes(kw))) {
        유형별[category] = (유형별[category] ?? 0) + 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      유형별["기타"] = (유형별["기타"] ?? 0) + 1;
    }
  }

  return { 총건수: records.length, 최근7일, 채널별, 작성자별, 유형별 };
}
