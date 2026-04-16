/**
 * HRD-Net API 호출 모듈 (Supabase Edge Function 프록시 경유)
 *
 * ⚠️ authKey는 더 이상 클라이언트에 존재하지 않습니다.
 * Edge Function 'hrd-proxy'가 Deno.env('HRD_AUTH_KEY')로 HRD-Net API를 대신 호출합니다.
 *
 * 기존 프록시 폴백(cors.eu.org 등)은 authKey를 3rd party에 노출시키는
 * 보안 문제가 있어 제거되었습니다.
 */
import type { HrdRawTrainee, HrdRawAttendance, HrdConfig } from "./hrdTypes";
import { fetchWithTimeout } from "./hrdCacheUtils";
import { readClientEnv } from "../core/env";

// ─── Edge Function 엔드포인트 ────────────────────────────────

const SUPABASE_URL = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const SUPABASE_ANON = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);

const HRD_PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/hrd-proxy` : "";

// ─── 프록시 호출 ────────────────────────────────────────────

interface ProxyResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function callEdgeProxy<T = unknown>(
  body: Record<string, unknown>,
  label: string,
): Promise<T> {
  if (!HRD_PROXY_URL || !SUPABASE_ANON) {
    throw new Error(
      "[HRD] Supabase 설정이 누락되었습니다. .env의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인하세요.",
    );
  }

  const r = await fetchWithTimeout(
    HRD_PROXY_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify(body),
    },
    25_000,
  );

  let json: ProxyResponse<T>;
  try {
    json = (await r.json()) as ProxyResponse<T>;
  } catch {
    throw new Error(`[HRD ${label}] 응답 JSON 파싱 실패 (HTTP ${r.status})`);
  }

  if (!r.ok || !json.ok) {
    const errMsg = json.error || `HTTP ${r.status}`;
    throw new Error(`[HRD ${label}] ${errMsg}`);
  }

  if (json.data === undefined) {
    throw new Error(`[HRD ${label}] 응답 데이터 없음`);
  }
  return json.data;
}

// ─── 응답 파싱 (기존 로직 그대로) ────────────────────────────

function parseResponse(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (typeof d.returnJSON === "string") {
    try {
      const parsed = JSON.parse(d.returnJSON) as Record<string, unknown>;
      return (parsed.trneList || parsed.atabList || []) as unknown[];
    } catch {
      return [];
    }
  }
  if (Array.isArray(d.srchList)) return d.srchList as unknown[];
  if (Array.isArray(d.trneList)) return d.trneList as unknown[];
  if (Array.isArray(d.atabList)) return d.atabList as unknown[];
  if (Array.isArray(d)) return d as unknown[];
  return [];
}

// ─── 공개 API 함수 (시그니처 유지) ──────────────────────────

/** 명단 조회 (전체기간) */
export async function fetchRoster(
  _config: HrdConfig,
  trainPrId: string,
  degr: string,
): Promise<HrdRawTrainee[]> {
  const data = await callEdgeProxy({ type: "roster", trainPrId, degr }, "roster");
  return parseResponse(data) as HrdRawTrainee[];
}

/** 월별 출결 조회 */
export async function fetchDailyAttendance(
  _config: HrdConfig,
  trainPrId: string,
  degr: string,
  month: string, // YYYYMM
): Promise<HrdRawAttendance[]> {
  const data = await callEdgeProxy({ type: "daily", trainPrId, degr, month }, "daily");
  return parseResponse(data) as HrdRawAttendance[];
}

/** API 연결 테스트 */
export async function testConnection(
  config: HrdConfig,
  trainPrId: string,
  degr: string,
): Promise<{ ok: boolean; count: number; message: string }> {
  try {
    const list = await fetchRoster(config, trainPrId, degr);
    if (list.length > 0) {
      return { ok: true, count: list.length, message: `연결 성공 (${list.length}명)` };
    }
    return { ok: false, count: 0, message: "데이터 없음 (파라미터 확인 필요)" };
  } catch (e) {
    return { ok: false, count: 0, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 기수 자동 탐색 — degr 1~maxDegr 스캔 후 유효 기수 반환 */
export async function discoverDegrs(
  config: HrdConfig,
  trainPrId: string,
  maxDegr = 20,
  onProgress?: (degr: number, found: boolean) => void,
): Promise<{ degr: string; count: number }[]> {
  const results: { degr: string; count: number }[] = [];

  // 3개씩 병렬 실행하여 API 부하 분산
  const BATCH = 3;
  for (let start = 1; start <= maxDegr; start += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, maxDegr - start + 1) }, (_, i) => start + i);
    const checks = batch.map(async (d) => {
      try {
        const list = await fetchRoster(config, trainPrId, String(d));
        const found = list.length > 0;
        onProgress?.(d, found);
        if (found) results.push({ degr: String(d), count: list.length });
      } catch {
        onProgress?.(d, false);
      }
    });
    await Promise.all(checks);
  }

  results.sort((a, b) => Number(a.degr) - Number(b.degr));
  return results;
}
