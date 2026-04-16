/**
 * HRD-Net API 호출 모듈
 *
 * 우선순위:
 *   1. Supabase Edge Function 프록시 (authKey 서버 보관, 보안)
 *   2. 폴백: 기존 CORS 프록시 직접 호출 (Edge Function 미배포 시)
 *
 * Edge Function이 배포되면 자동으로 프록시 경유로 전환됩니다.
 * 미배포 상태에서는 localStorage의 authKey + CORS 프록시로 동작합니다.
 */
import type { HrdRawTrainee, HrdRawAttendance, HrdConfig } from "./hrdTypes";
import { fetchWithTimeout } from "./hrdCacheUtils";
import { readClientEnv } from "../core/env";

// ─── 공통 ────────────────────────────────────────────────────

const HRD_BASE = "https://hrd.work24.go.kr/jsp/HRDP/HRDPO00/HRDPOA60/HRDPOA60_4.jsp";
const SUPABASE_URL = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const SUPABASE_ANON = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const HRD_PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/hrd-proxy` : "";

// Edge Function 사용 가능 여부 캐시 (세션 중 한 번만 시도)
let edgeFunctionAvailable: boolean | null = null;

// ─── 응답 파싱 (공통) ────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════
// 경로 A: Edge Function 프록시 호출
// ═══════════════════════════════════════════════════════════════

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
    throw new Error("EDGE_UNAVAILABLE");
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

  // 404 = Edge Function 미배포 → 폴백으로 전환
  if (r.status === 404) {
    throw new Error("EDGE_UNAVAILABLE");
  }

  let json: ProxyResponse<T>;
  try {
    json = (await r.json()) as ProxyResponse<T>;
  } catch {
    throw new Error(`[HRD ${label}] 응답 JSON 파싱 실패 (HTTP ${r.status})`);
  }

  if (!r.ok || !json.ok) {
    throw new Error(json.error || `HTTP ${r.status}`);
  }

  if (json.data === undefined) {
    throw new Error(`[HRD ${label}] 응답 데이터 없음`);
  }
  return json.data;
}

// ═══════════════════════════════════════════════════════════════
// 경로 B: 기존 CORS 프록시 직접 호출 (폴백)
// ═══════════════════════════════════════════════════════════════

interface CorsProxyEntry {
  prefix: string;
  encode: boolean;
}

const BUILTIN_PROXIES: CorsProxyEntry[] = [
  { prefix: "https://cors.eu.org/", encode: false },
  { prefix: "https://corsproxy.io/?url=", encode: true },
  { prefix: "https://api.allorigins.win/raw?url=", encode: true },
];

async function directFetch(rawUrl: string, config: HrdConfig, label: string): Promise<unknown> {
  const tryOne = async (entry: CorsProxyEntry): Promise<Response> => {
    const url = entry.encode ? entry.prefix + encodeURIComponent(rawUrl) : entry.prefix + rawUrl;
    const r = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }, 15_000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };

  // 1) 커스텀 프록시 시도
  if (config.proxy) {
    try {
      return (await tryOne({ prefix: config.proxy, encode: true })).json();
    } catch {
      console.warn(`[HRD ${label}] Custom proxy failed, falling back`);
    }
  }

  // 2) 빌트인 프록시 폴백
  let lastErr: Error | null = null;
  for (let i = 0; i < BUILTIN_PROXIES.length; i++) {
    try {
      const r = await tryOne(BUILTIN_PROXIES[i]);
      return r.json();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[HRD ${label}] Proxy #${i} failed:`, lastErr.message);
    }
  }

  throw new Error(`[HRD ${label}] 모든 프록시 실패: ${lastErr?.message ?? "unknown"}`);
}

function buildDirectUrl(config: HrdConfig, trainPrId: string, degr: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({
    returnType: "JSON",
    authKey: config.authKey,
    srchTrprId: trainPrId,
    srchTrprDegr: degr,
    outType: "2",
    ...extra,
  });
  return `${HRD_BASE}?${params}`;
}

// ═══════════════════════════════════════════════════════════════
// 통합 호출: Edge Function 우선, 실패 시 직접 호출 폴백
// ═══════════════════════════════════════════════════════════════

async function fetchHrd(
  config: HrdConfig,
  edgeBody: Record<string, unknown>,
  directUrl: string,
  label: string,
): Promise<unknown[]> {
  // Edge Function이 이전에 미배포로 확인됐으면 바로 폴백
  if (edgeFunctionAvailable !== false) {
    try {
      const data = await callEdgeProxy(edgeBody, label);
      edgeFunctionAvailable = true;
      return parseResponse(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "EDGE_UNAVAILABLE") {
        edgeFunctionAvailable = false;
        console.warn(`[HRD ${label}] Edge Function 미배포 → 직접 호출 폴백`);
      } else {
        // Edge Function 배포돼있지만 다른 에러 → 재시도하지 않고 직접 호출 폴백
        console.warn(`[HRD ${label}] Edge Function 에러: ${msg} → 직접 호출 폴백`);
      }
    }
  }

  // 폴백: 기존 CORS 프록시 직접 호출 (config.authKey 사용)
  if (!config.authKey) {
    throw new Error(
      `[HRD ${label}] Edge Function이 미배포 상태이고 authKey도 설정되지 않았습니다.\n` +
      `해결: ① Supabase에 hrd-proxy Edge Function 배포 또는 ② 설정 탭에서 HRD-Net authKey 입력`,
    );
  }

  const data = await directFetch(directUrl, config, label);
  return parseResponse(data);
}

// ═══════════════════════════════════════════════════════════════
// 공개 API 함수 (시그니처 기존과 동일)
// ═══════════════════════════════════════════════════════════════

/** 명단 조회 (전체기간) */
export async function fetchRoster(
  config: HrdConfig,
  trainPrId: string,
  degr: string,
): Promise<HrdRawTrainee[]> {
  return fetchHrd(
    config,
    { type: "roster", trainPrId, degr },
    buildDirectUrl(config, trainPrId, degr),
    "roster",
  ) as Promise<HrdRawTrainee[]>;
}

/** 월별 출결 조회 */
export async function fetchDailyAttendance(
  config: HrdConfig,
  trainPrId: string,
  degr: string,
  month: string, // YYYYMM
): Promise<HrdRawAttendance[]> {
  return fetchHrd(
    config,
    { type: "daily", trainPrId, degr, month },
    buildDirectUrl(config, trainPrId, degr, { srchTorgId: "student_detail", atendMo: month }),
    "daily",
  ) as Promise<HrdRawAttendance[]>;
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
