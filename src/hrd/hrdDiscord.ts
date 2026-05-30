/**
 * 디스코드 GAS 프록시 API 클라이언트 + 설정/캐시
 */
import { fetchWithTimeout } from "./hrdCacheUtils";
import {
  DISCORD_CACHE_KEY,
  DISCORD_CONFIG_KEY,
  type DiscordConfig,
  type DiscordProxyResponse,
  type DiscordRawMessage,
} from "./hrdDiscordTypes";

// ── 설정 ────────────────────────────────────────────────────
export function loadDiscordConfig(): DiscordConfig {
  try {
    const raw = localStorage.getItem(DISCORD_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DiscordConfig>;
      return {
        gasUrl: typeof parsed.gasUrl === "string" ? parsed.gasUrl : "",
        channels: Array.isArray(parsed.channels)
          ? parsed.channels.filter((c) => c && typeof c.id === "string")
          : [],
        staffAuthorIds: Array.isArray(parsed.staffAuthorIds)
          ? parsed.staffAuthorIds.filter((s) => typeof s === "string")
          : [],
      };
    }
  } catch {
    /* ignore */
  }
  return { gasUrl: "", channels: [], staffAuthorIds: [] };
}

export function saveDiscordConfig(config: DiscordConfig): void {
  localStorage.setItem(DISCORD_CONFIG_KEY, JSON.stringify(config));
}

export function isDiscordConfigured(config: DiscordConfig = loadDiscordConfig()): boolean {
  return config.gasUrl.trim().length > 0 && config.channels.length > 0;
}

// ── 캐시 ────────────────────────────────────────────────────
interface DiscordCache {
  timestamp: number;
  messages: DiscordRawMessage[];
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

function loadCacheRaw(): DiscordCache | null {
  try {
    const raw = localStorage.getItem(DISCORD_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as DiscordCache;
    if (!c || !Array.isArray(c.messages)) return null;
    return c;
  } catch {
    return null;
  }
}

export function loadDiscordCache(): DiscordRawMessage[] | null {
  const c = loadCacheRaw();
  return c ? c.messages : null;
}

export function getDiscordCacheTimestamp(): number | null {
  const c = loadCacheRaw();
  if (!c) return null;
  return Date.now() - c.timestamp < CACHE_TTL ? c.timestamp : c.timestamp; // 만료돼도 시점은 보여줌
}

function saveCache(messages: DiscordRawMessage[]): void {
  try {
    localStorage.setItem(DISCORD_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), messages }));
  } catch (e) {
    console.warn("[discord] cache save failed", e);
  }
}

// ── GAS 프록시 호출 ─────────────────────────────────────────
/**
 * GAS 웹앱을 통해 설정된 모든 채널의 메시지를 가져온다.
 * GAS가 302 redirect(googleusercontent)로 응답하므로 fetch는 자동 추종한다.
 */
export async function fetchDiscordMessages(
  config: DiscordConfig = loadDiscordConfig(),
): Promise<DiscordRawMessage[]> {
  if (!config.gasUrl.trim()) {
    throw new Error("디스코드 GAS URL이 설정되지 않았습니다. 설정 → API 연동 → 디스코드에서 등록하세요.");
  }
  if (config.channels.length === 0) {
    throw new Error("채널↔기수 매핑이 비어 있습니다. 설정에서 채널을 등록하세요.");
  }
  const channelIds = config.channels.map((c) => c.id).join(",");
  const sep = config.gasUrl.includes("?") ? "&" : "?";
  const url = `${config.gasUrl}${sep}channels=${encodeURIComponent(channelIds)}&limit=100`;

  const res = await fetchWithTimeout(url, { method: "GET" }, 25_000);
  if (!res.ok) {
    throw new Error(`GAS 프록시 응답 오류 (HTTP ${res.status})`);
  }
  let json: DiscordProxyResponse;
  try {
    json = (await res.json()) as DiscordProxyResponse;
  } catch {
    throw new Error("GAS 응답 JSON 파싱 실패 — 웹앱 배포 권한(모든 사용자)을 확인하세요.");
  }
  if (!json.ok) {
    throw new Error(json.error || "GAS 프록시가 오류를 반환했습니다.");
  }
  const messages = json.messages ?? [];
  saveCache(messages);
  return messages;
}

/** 연결 테스트 — 메시지 수 반환 */
export async function testDiscordConnection(
  config: DiscordConfig = loadDiscordConfig(),
): Promise<{ ok: boolean; count: number; message: string }> {
  try {
    const msgs = await fetchDiscordMessages(config);
    return { ok: true, count: msgs.length, message: `연결 성공 (${msgs.length}건 수신)` };
  } catch (e) {
    return { ok: false, count: 0, message: e instanceof Error ? e.message : String(e) };
  }
}
