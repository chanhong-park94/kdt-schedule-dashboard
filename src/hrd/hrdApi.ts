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

// HRD-Net 출결 API 엔드포인트.
// ⚠️ 구 JSP 경로(/jsp/HRDP/HRDPO00/HRDPOA60/HRDPOA60_4.jsp)는 2026-06 현재 신규 .do 경로로
//    302 리다이렉트된다. 일부 CORS 프록시가 302를 따라가지 못해(또는 302 본문을 그대로 반환해서)
//    출결조회가 깨지므로, 리다이렉트가 없는 .do 경로를 직접 호출한다.
//    (동일 파라미터로 roster/daily 모두 검증 완료 — redirects=0, returnJSON 정상 반환)
const HRD_BASE = "https://hrd.work24.go.kr/hrdp/api/apipo/APIPO0104T.do";
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
  label: string;
  build: (rawUrl: string) => string;
  /** 프록시 응답에서 HRD 원본 JSON 객체를 추출 */
  extract: (r: Response) => Promise<unknown>;
}

/** 대부분 프록시는 HRD 응답 본문을 그대로 전달 → r.json() */
const asJson = (r: Response): Promise<unknown> => r.json();
/** allorigins /get 은 {contents:"<json 문자열>"} 로 한 번 더 감싸므로 풀어준다 */
async function asAllOriginsContents(r: Response): Promise<unknown> {
  const j = (await r.json()) as { contents?: string };
  if (typeof j.contents !== "string") throw new Error("allorigins: contents 없음");
  return JSON.parse(j.contents);
}

// ⚠️ corsproxy.io 는 2026-04 유료 전환으로 제외 — ATTENDANCE_CRITICAL.md §B "코드에 부활시키지 말 것"
// 공개 CORS 프록시는 개별적으로 신뢰 불가(레이트리밋/일시장애/지연)하므로,
// 아래 풀을 "순차"가 아니라 "병렬 레이스"로 호출해 가장 먼저 정상 응답하는 프록시를 채택한다.
// → 느리거나 죽은 프록시가 전체 조회를 막던 회귀(모든 프록시 실패: signal is aborted)를 근본 차단.
const BUILTIN_PROXIES: CorsProxyEntry[] = [
  { label: "cors.eu.org", build: (u) => `https://cors.eu.org/${u}`, extract: asJson },
  { label: "allorigins.raw", build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, extract: asJson },
  { label: "allorigins.get", build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, extract: asAllOriginsContents },
  { label: "codetabs", build: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`, extract: asJson },
];

/** 응답이 실제 HRD 데이터 형태인지 검증 (프록시가 200으로 반환하는 레이트리밋 HTML/빈응답 차단) */
function looksLikeHrd(data: unknown): boolean {
  if (Array.isArray(data)) return true; // parseResponse 의 top-level array 분기 호환
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.returnJSON === "string" ||
    Array.isArray(d.srchList) ||
    Array.isArray(d.trneList) ||
    Array.isArray(d.atabList)
  );
}

/**
 * 여러 프록시를 동시에 호출해 가장 먼저 "정상 HRD 응답"을 주는 결과를 채택한다.
 * - 첫 성공이 즉시 resolve → 건강한 프록시 한 곳만 있으면 ~1초 내 성공.
 * - 전부 실패해야 reject → 메시지에 "모든 프록시 실패" 유지(classifyApiError 가 인식) + 프록시별 사유.
 * - Promise.any(ES2021) 대신 수동 레이스로 ES2020 타깃과 호환.
 */
function raceProxies(entries: CorsProxyEntry[], rawUrl: string, label: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (entries.length === 0) {
      reject(new Error(`[HRD ${label}] 사용할 프록시가 없습니다.`));
      return;
    }
    let remaining = entries.length;
    let settled = false;
    const errs: string[] = [];

    for (const entry of entries) {
      void (async () => {
        try {
          const r = await fetchWithTimeout(
            entry.build(rawUrl),
            { method: "GET", headers: { "Content-Type": "application/json" } },
            15_000,
          );
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await entry.extract(r);
          if (!looksLikeHrd(data)) throw new Error("비정상 응답(레이트리밋/차단 의심)");
          // 주의: "유효하지만 빈" 응답(해당 월 데이터 없음 등)도 정상으로 간주해 레이스에서 이긴다.
          //   동일 쿼리는 모든 프록시가 같은 본문을 주므로 단일 조회에서는 무해하다.
          //   (만약 특정 프록시의 stale 캐시로 빈 응답이 실데이터를 이기는 사례가 field 에서
          //    관측되면, parseResponse(data).length>0 우선 채택으로 강화할 것 — 현재는 단순성 우선)
          if (!settled) {
            settled = true;
            resolve(data);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errs.push(`${entry.label}: ${msg}`);
          console.warn(`[HRD ${label}] ${entry.label} 실패: ${msg}`);
          remaining -= 1;
          if (remaining === 0 && !settled) {
            reject(new Error(`[HRD ${label}] 모든 프록시 실패: ${errs.join(" / ")}`));
          }
        }
      })();
    }
  });
}

async function directFetch(rawUrl: string, config: HrdConfig, label: string): Promise<unknown> {
  const entries: CorsProxyEntry[] = [];
  // 설정 탭에서 지정한 커스텀 프록시가 있으면 레이스 풀에 함께 참가시킨다.
  if (config.proxy) {
    const customPrefix = config.proxy;
    entries.push({ label: "custom", build: (u) => customPrefix + encodeURIComponent(u), extract: asJson });
  }
  entries.push(...BUILTIN_PROXIES);
  return raceProxies(entries, rawUrl, label);
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
      // Edge Function 이 배포되면 이 경로가 "주 경로"가 된다. 프록시 폴백과 동일하게 HRD 형태를
      // 검증해, 상류(HRD-Net) 장애로 빈/깨진 응답을 ok:true 로 흘려보내도 조용한 "0명" 실패가
      // 되지 않게 한다. (검증 실패 시 아래 catch 로 떨어져 CORS 폴백을 한 번 더 시도)
      if (!looksLikeHrd(data)) throw new Error("Edge Function 비정상 응답(HRD 형태 아님)");
      edgeFunctionAvailable = true;
      return parseResponse(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // 어떤 에러든 Edge Function 사용 불가로 판정 → 세션 중 재시도 안 함
      edgeFunctionAvailable = false;
      if (msg === "EDGE_UNAVAILABLE") {
        console.warn(`[HRD ${label}] Edge Function 미배포 → 직접 호출 폴백`);
      } else {
        console.warn(`[HRD ${label}] Edge Function 에러: ${msg} → 직접 호출 폴백 (세션 중 재시도 안 함)`);
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
