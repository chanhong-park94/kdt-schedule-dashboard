/** HRD-Net API 호출 모듈 (CORS 프록시 폴백) */
import type { HrdRawTrainee, HrdRawAttendance, HrdConfig } from "./hrdTypes";

const HRD_BASE = "https://hrd.work24.go.kr/jsp/HRDP/HRDPO00/HRDPOA60/HRDPOA60_4.jsp";

interface ProxyEntry {
  prefix: string;
  /** true = prefix + encodeURIComponent(url), false = prefix + url */
  encode: boolean;
}

const BUILTIN_PROXIES: ProxyEntry[] = [
  { prefix: "https://cors.eu.org/", encode: false },
  { prefix: "https://corsproxy.io/?url=", encode: true },
  { prefix: "https://api.allorigins.win/raw?url=", encode: true },
];

let activeProxyIndex = 0;

// ─── 프록시 fetch 래퍼 ──────────────────────────────────────

async function proxyFetch(rawUrl: string, config: HrdConfig, label: string): Promise<unknown> {
  const tryOne = async (entry: ProxyEntry): Promise<Response> => {
    const url = entry.encode
      ? entry.prefix + encodeURIComponent(rawUrl)
      : entry.prefix + rawUrl;
    const r = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };

  // 1) 커스텀 프록시 시도
  if (config.proxy) {
    try {
      const r = await tryOne({ prefix: config.proxy, encode: true });
      return r.json();
    } catch {
      console.warn(`[HRD ${label}] Custom proxy failed, falling back`);
    }
  }

  // 2) 빌트인 프록시 폴백
  let lastErr: Error | null = null;
  for (let i = 0; i < BUILTIN_PROXIES.length; i++) {
    try {
      const r = await tryOne(BUILTIN_PROXIES[i]);
      activeProxyIndex = i;
      return r.json();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[HRD ${label}] Proxy #${i} failed:`, lastErr.message);
    }
  }

  throw new Error(`[HRD ${label}] 모든 프록시 실패: ${lastErr?.message ?? "unknown"}`);
}

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

// ─── 공개 API 함수 ──────────────────────────────────────────

/** 명단 조회 (전체기간) */
export async function fetchRoster(
  config: HrdConfig,
  trainPrId: string,
  degr: string
): Promise<HrdRawTrainee[]> {
  const params = new URLSearchParams({
    returnType: "JSON",
    authKey: config.authKey,
    srchTrprId: trainPrId,
    srchTrprDegr: degr,
    outType: "2",
  });
  const raw = `${HRD_BASE}?${params}`;
  const data = await proxyFetch(raw, config, "roster");
  return parseResponse(data) as HrdRawTrainee[];
}

/** 월별 출결 조회 */
export async function fetchDailyAttendance(
  config: HrdConfig,
  trainPrId: string,
  degr: string,
  month: string  // YYYYMM
): Promise<HrdRawAttendance[]> {
  const params = new URLSearchParams({
    returnType: "JSON",
    authKey: config.authKey,
    srchTrprId: trainPrId,
    srchTrprDegr: degr,
    outType: "2",
    srchTorgId: "student_detail",
    atendMo: month,
  });
  const raw = `${HRD_BASE}?${params}`;
  const data = await proxyFetch(raw, config, "daily");
  return parseResponse(data) as HrdRawAttendance[];
}

/** API 연결 테스트 */
export async function testConnection(config: HrdConfig, trainPrId: string, degr: string): Promise<{ ok: boolean; count: number; message: string }> {
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
    const batch = Array.from(
      { length: Math.min(BATCH, maxDegr - start + 1) },
      (_, i) => start + i,
    );
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
