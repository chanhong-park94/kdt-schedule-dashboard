import { FACILITATOR_DATA, FACILITATOR_META, type FacilitatorCourse } from "./facilitatorData";

export type FetchVia = "direct" | "cors.eu.org" | "allorigins.raw" | "allorigins.get" | "corsproxy.io" | "thingproxy";

export interface DiffResult {
  ok: true;
  added: FacilitatorCourse[];
  removed: FacilitatorCourse[];
  changed: { name: string; localPhases: number; remotePhases: number }[];
  remoteCount: number;
  localCount: number;
  via: FetchVia;
}

export interface DiffError {
  ok: false;
  error: string;
}

const TIMEOUT_MS = 15_000;

interface ProxyEntry {
  label: FetchVia;
  build: (target: string) => string;
  /** 응답을 HTML 문자열로 변환 (allorigins /get은 JSON.contents에서 꺼냄) */
  parse: (resp: Response) => Promise<string>;
}

async function asText(r: Response): Promise<string> {
  return r.text();
}
async function asAllOriginsContents(r: Response): Promise<string> {
  const j = (await r.json()) as { contents?: string };
  return typeof j.contents === "string" ? j.contents : "";
}

const PROXIES: ProxyEntry[] = [
  { label: "direct", build: (t) => t, parse: asText },
  { label: "allorigins.get", build: (t) => `https://api.allorigins.win/get?url=${encodeURIComponent(t)}`, parse: asAllOriginsContents },
  { label: "corsproxy.io", build: (t) => `https://corsproxy.io/?${encodeURIComponent(t)}`, parse: asText },
  { label: "allorigins.raw", build: (t) => `https://api.allorigins.win/raw?url=${encodeURIComponent(t)}`, parse: asText },
  { label: "thingproxy", build: (t) => `https://thingproxy.freeboard.io/fetch/${t}`, parse: asText },
  { label: "cors.eu.org", build: (t) => `https://cors.eu.org/${t}`, parse: asText },
];

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { mode: "cors", credentials: "omit", signal: ctrl.signal }).finally(() => clearTimeout(tm));
}

/**
 * 외부 사이트 HTML을 가져온다 — 6단계 fallback.
 * 1) direct  → 2) allorigins.get(JSON)  → 3) corsproxy.io
 * 4) allorigins.raw → 5) thingproxy → 6) cors.eu.org
 * 모두 실패하면 마지막 오류 반환.
 */
async function fetchExternalHtml(): Promise<{ html: string; via: FetchVia } | { error: string }> {
  const errors: string[] = [];
  for (const proxy of PROXIES) {
    const url = proxy.build(FACILITATOR_META.source);
    try {
      const r = await fetchWithTimeout(url, TIMEOUT_MS);
      if (!r.ok) {
        errors.push(`${proxy.label} HTTP ${r.status}`);
        continue;
      }
      const html = await proxy.parse(r);
      if (!html || html.length < 200 || !html.includes("const DATA")) {
        errors.push(`${proxy.label} 본문에 데이터 없음 (${html.length}B)`);
        continue;
      }
      return { html, via: proxy.label };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${proxy.label} ${msg}`);
      console.warn(`[facilitator] ${proxy.label} 실패: ${msg}`);
    }
  }
  return { error: `모든 경로 실패 — ${errors.join(" / ")}` };
}

/**
 * 외부 사이트 fetch + const DATA 추출 + 우리 정적 데이터와 비교.
 *
 * 직접 → cors.eu.org → allorigins.win 순으로 자동 fallback.
 */
export async function checkFacilitatorUpdate(): Promise<DiffResult | DiffError> {
  const fetched = await fetchExternalHtml();
  if ("error" in fetched) {
    return { ok: false, error: fetched.error };
  }
  const m = fetched.html.match(/const\s+DATA\s*=\s*(\{[\s\S]*?\});/);
  if (!m) {
    return { ok: false, error: "외부 사이트에서 데이터(const DATA) 패턴을 찾지 못했습니다." };
  }
  let remote: { courses?: FacilitatorCourse[] };
  try {
    remote = JSON.parse(m[1]);
  } catch (e) {
    return { ok: false, error: `JSON 파싱 실패: ${(e as Error).message}` };
  }
  const remoteCourses = remote.courses ?? [];
  const diff = diffCourses(FACILITATOR_DATA.courses, remoteCourses);
  return { ...diff, via: fetched.via };
}

function diffCourses(local: FacilitatorCourse[], remote: FacilitatorCourse[]): Omit<DiffResult, "via"> {
  const localMap = new Map(local.map((c) => [c.name, c]));
  const remoteMap = new Map(remote.map((c) => [c.name, c]));

  const added: FacilitatorCourse[] = [];
  const removed: FacilitatorCourse[] = [];
  const changed: { name: string; localPhases: number; remotePhases: number }[] = [];

  for (const [name, rc] of remoteMap) {
    const lc = localMap.get(name);
    if (!lc) {
      added.push(rc);
      continue;
    }
    // phase 길이·필드 일부 비교
    const localKey = JSON.stringify(lc.phases);
    const remoteKey = JSON.stringify(rc.phases);
    if (localKey !== remoteKey || lc.type !== rc.type || lc.section !== rc.section) {
      changed.push({ name, localPhases: lc.phases.length, remotePhases: rc.phases.length });
    }
  }
  for (const [name, lc] of localMap) {
    if (!remoteMap.has(name)) removed.push(lc);
  }

  return {
    ok: true,
    added,
    removed,
    changed,
    remoteCount: remote.length,
    localCount: local.length,
  };
}
