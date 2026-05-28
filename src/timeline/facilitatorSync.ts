import { FACILITATOR_DATA, FACILITATOR_META, type FacilitatorCourse } from "./facilitatorData";

export interface DiffResult {
  ok: true;
  added: FacilitatorCourse[];
  removed: FacilitatorCourse[];
  changed: { name: string; localPhases: number; remotePhases: number }[];
  remoteCount: number;
  localCount: number;
}

export interface DiffError {
  ok: false;
  error: string;
}

/**
 * 외부 사이트 fetch + const DATA 추출 + 우리 정적 데이터와 비교.
 *
 * CORS 정책에 따라 Netlify가 헤더를 보내지 않으면 fetch 실패할 수 있음.
 * 그 경우 사용자에게 외부 사이트를 직접 열어 확인하도록 안내한다.
 */
export async function checkFacilitatorUpdate(): Promise<DiffResult | DiffError> {
  try {
    const r = await fetch(FACILITATOR_META.source, { mode: "cors", credentials: "omit" });
    if (!r.ok) {
      return { ok: false, error: `HTTP ${r.status}` };
    }
    const html = await r.text();
    const m = html.match(/const\s+DATA\s*=\s*(\{[\s\S]*?\});/);
    if (!m) {
      return { ok: false, error: "외부 사이트에서 데이터(DATA) 패턴을 찾지 못했습니다." };
    }
    let remote: { courses?: FacilitatorCourse[] };
    try {
      remote = JSON.parse(m[1]);
    } catch (e) {
      return { ok: false, error: `JSON 파싱 실패: ${(e as Error).message}` };
    }
    const remoteCourses = remote.courses ?? [];
    return diffCourses(FACILITATOR_DATA.courses, remoteCourses);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // CORS 차단된 경우 (TypeError: Failed to fetch)
    return {
      ok: false,
      error: msg.includes("Failed to fetch")
        ? "외부 사이트 CORS 허용이 필요합니다. 사이트를 직접 열어 확인하세요."
        : msg,
    };
  }
}

function diffCourses(local: FacilitatorCourse[], remote: FacilitatorCourse[]): DiffResult {
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
