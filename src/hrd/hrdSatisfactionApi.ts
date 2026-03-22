/**
 * 만족도 API 연동 모듈
 *
 * 스키마 구글시트의 "만족도" 시트를 Apps Script Web App을 통해 조회합니다.
 * 학업성취도와 동일한 Apps Script를 공유할 수 있습니다.
 */
import type {
  SatisfactionConfig,
  SatisfactionRecord,
  SatisfactionStats,
  SatisfactionSummary,
  SatisfactionCache,
} from "./hrdSatisfactionTypes";
import { SATISFACTION_CONFIG_KEY, SATISFACTION_CACHE_KEY } from "./hrdSatisfactionTypes";
import { fetchWithTimeout, classifyApiError } from "./hrdCacheUtils";

// ── 설정 저장/불러오기 ──────────────────────────────────────
export function loadSatisfactionConfig(): SatisfactionConfig {
  try {
    const raw = localStorage.getItem(SATISFACTION_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as SatisfactionConfig;
  } catch {
    /* ignore */
  }
  return { webAppUrl: "" };
}

export function saveSatisfactionConfig(config: SatisfactionConfig): void {
  localStorage.setItem(SATISFACTION_CONFIG_KEY, JSON.stringify(config));
}

// ── 캐시 ────────────────────────────────────────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

export function loadSatisfactionCache(): SatisfactionRecord[] | null {
  const c = _loadCache();
  return c ? c.records : null;
}

/** 캐시 저장 시점(ms) 반환. 캐시 없거나 만료면 null */
export function getSatisfactionCacheTimestamp(): number | null {
  const c = _loadCache();
  return c ? c.timestamp : null;
}

function _loadCache(): SatisfactionCache | null {
  try {
    const raw = localStorage.getItem(SATISFACTION_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as SatisfactionCache;
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache;
  } catch {
    return null;
  }
}

function saveCache(records: SatisfactionRecord[]): void {
  try {
    localStorage.setItem(SATISFACTION_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), records }));
  } catch {
    /* quota exceeded — ignore */
  }
}

// ── API 호출 ────────────────────────────────────────────────
async function fetchAction(baseUrl: string, params: Record<string, string>): Promise<unknown> {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const r = await fetchWithTimeout(`${baseUrl}${sep}${qs}`, {}, 30_000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── 연결 테스트 ─────────────────────────────────────────────
export async function testSatisfactionConnection(
  config: SatisfactionConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (!config.webAppUrl) return { ok: false, message: "Apps Script URL을 입력하세요." };
    const json = (await fetchAction(config.webAppUrl, { action: "schema_satisfaction" })) as {
      headers?: string[];
      rows?: unknown[][];
      rowCount?: number;
      error?: string;
    };
    if (json.error) return { ok: false, message: `오류: ${json.error}` };
    const count = json.rowCount ?? json.rows?.length ?? 0;
    return { ok: true, message: `연결 성공! (${count}건 확인)` };
  } catch (e) {
    return { ok: false, message: classifyApiError(e) };
  }
}

// ── 전체 데이터 로드 ────────────────────────────────────────
export async function fetchSatisfactionRecords(config: SatisfactionConfig): Promise<SatisfactionRecord[]> {
  const cached = _loadCache();
  if (cached) return cached.records;

  const json = (await fetchAction(config.webAppUrl, { action: "schema_satisfaction" })) as {
    headers: string[];
    rows: (string | number | null)[][];
    error?: string;
  };
  if (json.error) throw new Error(json.error);

  const headers = json.headers.map(String);
  const idx = (name: string) => headers.indexOf(name);

  const records: SatisfactionRecord[] = json.rows
    .filter((row) => {
      const course = String(row[idx("과정명")] ?? "").trim();
      return course !== "";
    })
    .map((row) => ({
      과정명: String(row[idx("과정명")] ?? "").trim(),
      기수: String(row[idx("기수")] ?? "").trim(),
      모듈명: String(row[idx("모듈/프로젝트명")] ?? "").trim(),
      NPS: Number(row[idx("NPS점수(-100~100)")]) || 0,
      강사만족도: Number(row[idx("강사만족도(5점)")]) || 0,
      중간만족도: Number(row[idx("고용24중간만족도(5점)")]) || 0,
      최종만족도: Number(row[idx("고용24최종만족도(5점)")]) || 0,
    }));

  saveCache(records);
  return records;
}

// ── 과정/기수별 집계 ────────────────────────────────────────
export function summarizeByCohort(
  records: SatisfactionRecord[],
  courseFilter: string,
  cohortFilter: string,
): SatisfactionSummary[] {
  const filtered = records.filter(
    (r) => (!courseFilter || r.과정명 === courseFilter) && (!cohortFilter || r.기수 === cohortFilter),
  );

  const map = new Map<
    string,
    { records: SatisfactionRecord[]; moduleMap: Map<string, SatisfactionRecord[]> }
  >();

  for (const r of filtered) {
    const key = `${r.과정명}|${r.기수}`;
    if (!map.has(key)) map.set(key, { records: [], moduleMap: new Map() });
    const entry = map.get(key)!;
    entry.records.push(r);
    if (r.모듈명) {
      if (!entry.moduleMap.has(r.모듈명)) entry.moduleMap.set(r.모듈명, []);
      entry.moduleMap.get(r.모듈명)!.push(r);
    }
  }

  const results: SatisfactionSummary[] = [];
  for (const [, { records: recs, moduleMap }] of map) {
    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    const 모듈별: SatisfactionSummary["모듈별"] = [];
    for (const [모듈명, mRecs] of moduleMap) {
      모듈별.push({
        모듈명,
        NPS평균: round1(avg(mRecs.map((r) => r.NPS))),
        응답수: mRecs.length,
      });
    }

    results.push({
      과정명: recs[0].과정명,
      기수: recs[0].기수,
      응답수: recs.length,
      NPS평균: round1(avg(recs.map((r) => r.NPS))),
      강사만족도평균: round1(avg(recs.filter((r) => r.강사만족도 > 0).map((r) => r.강사만족도))),
      중간만족도평균: round1(avg(recs.filter((r) => r.중간만족도 > 0).map((r) => r.중간만족도))),
      최종만족도평균: round1(avg(recs.filter((r) => r.최종만족도 > 0).map((r) => r.최종만족도))),
      모듈별,
    });
  }

  return results.sort((a, b) => a.과정명.localeCompare(b.과정명) || a.기수.localeCompare(b.기수));
}

// ── 전체 통계 ───────────────────────────────────────────────
export function calcSatisfactionStats(records: SatisfactionRecord[]): SatisfactionStats {
  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const 과정별NPS: Record<string, number> = {};
  const courseMap = new Map<string, number[]>();
  for (const r of records) {
    if (!courseMap.has(r.과정명)) courseMap.set(r.과정명, []);
    courseMap.get(r.과정명)!.push(r.NPS);
  }
  for (const [k, v] of courseMap) {
    과정별NPS[k] = round1(avg(v));
  }

  return {
    총응답수: records.length,
    NPS평균: round1(avg(records.map((r) => r.NPS))),
    강사만족도평균: round1(avg(records.filter((r) => r.강사만족도 > 0).map((r) => r.강사만족도))),
    중간만족도평균: round1(avg(records.filter((r) => r.중간만족도 > 0).map((r) => r.중간만족도))),
    최종만족도평균: round1(avg(records.filter((r) => r.최종만족도 > 0).map((r) => r.최종만족도))),
    과정별NPS,
  };
}

// ── 필터 유니크 목록 ────────────────────────────────────────
export function extractSatisfactionFilters(records: SatisfactionRecord[]): {
  courses: string[];
  cohorts: string[];
} {
  return {
    courses: [...new Set(records.map((r) => r.과정명).filter(Boolean))].sort(),
    cohorts: [...new Set(records.map((r) => r.기수).filter(Boolean))].sort(),
  };
}
