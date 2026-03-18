/**
 * 학업성취도 Google Sheets 연동 모듈
 *
 * Apps Script Web App → JSON fetch → 타입 변환
 * 통합시트(노드퀘스트DB) + 개별 노드/퀘스트 시트 읽기
 */
import type {
  UnifiedRecord,
  TraineeAchievementSummary,
  NodeSheetRow,
  QuestSheetRow,
  AchievementConfig,
} from "./hrdAchievementTypes";
import { ACHIEVEMENT_CONFIG_KEY, ACHIEVEMENT_CACHE_KEY } from "./hrdAchievementTypes";

// ── 설정 저장/불러오기 ──────────────────────────────────────
export function loadAchievementConfig(): AchievementConfig {
  try {
    const raw = localStorage.getItem(ACHIEVEMENT_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as AchievementConfig;
  } catch {
    /* ignore */
  }
  return { webAppUrl: "" };
}

export function saveAchievementConfig(config: AchievementConfig): void {
  localStorage.setItem(ACHIEVEMENT_CONFIG_KEY, JSON.stringify(config));
}

// ── 캐시 ────────────────────────────────────────────────────
interface AchievementCache {
  timestamp: number;
  unified: UnifiedRecord[];
  sheetList: string[];
}

const CACHE_TTL = 60 * 60 * 1000; // 1시간

export function loadCache(): AchievementCache | null {
  try {
    const raw = localStorage.getItem(ACHIEVEMENT_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as AchievementCache;
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache;
  } catch {
    return null;
  }
}

function saveCache(data: AchievementCache): void {
  try {
    localStorage.setItem(ACHIEVEMENT_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* quota exceeded 등 무시 */
  }
}

// ── API 호출 ────────────────────────────────────────────────
async function fetchAction(baseUrl: string, params: Record<string, string>): Promise<unknown> {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const r = await fetch(`${baseUrl}${sep}${qs}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** 통합시트 전체 로드 */
export async function fetchUnified(config: AchievementConfig): Promise<UnifiedRecord[]> {
  const cached = loadCache();
  if (cached) return cached.unified;

  const json = (await fetchAction(config.webAppUrl, { action: "unified" })) as {
    headers: string[];
    rows: (string | number | boolean | null)[][];
    error?: string;
  };
  if (json.error) throw new Error(json.error);

  const records: UnifiedRecord[] = json.rows.map((row) => ({
    구분: String(row[0] ?? ""),
    기수: String(row[1] ?? ""),
    학번: Number(row[2]) || 0,
    고유번호: Number(row[3]) || 0,
    이름: String(row[4] ?? ""),
    길드: String(row[5] ?? ""),
    과정: String(row[6] ?? ""),
    세부과정: String(row[7] ?? ""),
    훈련상태: String(row[8] ?? ""),
    모듈명: String(row[9] ?? ""),
    노드명: String(row[10] ?? ""),
    별점: Number(row[11]) || 0,
    노드순서: Number(row[12]) || 0,
    노드실행여부: row[13] === true || row[13] === "true",
    퀘스트명: String(row[14] ?? ""),
    퀘스트상태: row[15] === "P" ? "P" : row[15] === "F" ? "F" : null,
    퀘스트순서: Number(row[16]) || 0,
    퀘스트실행여부: row[17] === true || row[17] === "true",
  }));

  // 시트 목록도 함께 캐시
  const sheetsJson = (await fetchAction(config.webAppUrl, { action: "sheets" })) as { sheets: string[] };
  saveCache({ timestamp: Date.now(), unified: records, sheetList: sheetsJson.sheets });
  return records;
}

/** 사용 가능한 시트 목록 */
export async function fetchSheetList(config: AchievementConfig): Promise<string[]> {
  const cached = loadCache();
  if (cached) return cached.sheetList;
  const json = (await fetchAction(config.webAppUrl, { action: "sheets" })) as { sheets: string[] };
  return json.sheets;
}

/** 개별 노드 시트 로드 */
export async function fetchNodeSheet(config: AchievementConfig, sheetKey: string): Promise<NodeSheetRow[]> {
  const json = (await fetchAction(config.webAppUrl, { action: "node", sheet: sheetKey })) as {
    headers: string[];
    rows: (string | number | null)[][];
    error?: string;
  };
  if (json.error) throw new Error(json.error);

  const headers = json.headers.map(String);
  const nameIdx = headers.indexOf("이름");
  const signalIdx = headers.indexOf("신호등");
  const cumIdx = headers.findIndex((h) => h.includes("누적별점"));
  const submitIdx = headers.findIndex((h) => h.includes("노드제출률"));
  // 모듈 컬럼: 노드제출률 이후
  const moduleStartIdx = submitIdx >= 0 ? submitIdx + 1 : 9;

  return json.rows
    .filter((row) => row[nameIdx] && String(row[nameIdx]).trim())
    .map((row) => {
      const 모듈별점수: Record<string, number | null> = {};
      for (let i = moduleStartIdx; i < headers.length; i++) {
        const v = row[i];
        모듈별점수[headers[i]] = v != null && v !== "" ? Number(v) : null;
      }
      return {
        이름: String(row[nameIdx] ?? ""),
        신호등: String(row[signalIdx] ?? ""),
        누적별점: Number(row[cumIdx]) || 0,
        노드제출률: Number(row[submitIdx]) || 0,
        모듈별점수,
      };
    });
}

/** 개별 퀘스트 시트 로드 */
export async function fetchQuestSheet(config: AchievementConfig, sheetKey: string): Promise<QuestSheetRow[]> {
  const json = (await fetchAction(config.webAppUrl, { action: "quest", sheet: sheetKey })) as {
    headers: string[];
    rows: (string | number | null)[][];
    error?: string;
  };
  if (json.error) throw new Error(json.error);

  const headers = json.headers.map(String);
  const nameIdx = headers.indexOf("이름");
  const idIdx = headers.indexOf("고유번호");
  const guildIdx = headers.indexOf("길드");
  const courseIdx = headers.indexOf("과정");
  const statusIdx = headers.indexOf("상태");
  const passTotalIdx = headers.findIndex((h) => h === "PASS_TOTAL");
  const questScoreIdx = headers.findIndex((h) => h === "퀘스트점수");
  const totalIdx = headers.findIndex((h) => h === "TOTAL");

  // 퀘스트 컬럼: 상태 이후 ~ PASS_TOTAL 이전
  const questStart = (statusIdx >= 0 ? statusIdx : 5) + 1;
  const questEnd = passTotalIdx >= 0 ? passTotalIdx : headers.length;

  return json.rows
    .filter((row) => row[nameIdx] && String(row[nameIdx]).trim())
    .map((row) => {
      const 퀘스트별상태: Record<string, "P" | "F" | null> = {};
      for (let i = questStart; i < questEnd; i++) {
        const v = String(row[i] ?? "").trim();
        퀘스트별상태[headers[i]] = v === "P" ? "P" : v === "F" ? "F" : null;
      }
      return {
        고유번호: Number(row[idIdx]) || 0,
        이름: String(row[nameIdx] ?? ""),
        길드: String(row[guildIdx] ?? ""),
        과정: String(row[courseIdx] ?? ""),
        상태: String(row[statusIdx] ?? ""),
        퀘스트별상태,
        PASS_TOTAL: Number(row[passTotalIdx]) || 0,
        퀘스트점수: Number(row[questScoreIdx]) || 0,
        TOTAL: Number(row[totalIdx]) || 0,
      };
    });
}

/** 통합 데이터 → 과정/기수별 훈련생 집계 */
export function summarizeByTrainee(
  records: UnifiedRecord[],
  courseFilter: string,
  cohortFilter: string,
): TraineeAchievementSummary[] {
  const filtered = records.filter(
    (r) => (!courseFilter || r.과정 === courseFilter) && (!cohortFilter || r.기수 === cohortFilter),
  );

  // 이름+과정+기수 그룹핑
  const map = new Map<string, { nodes: UnifiedRecord[]; quests: UnifiedRecord[]; first: UnifiedRecord }>();
  for (const r of filtered) {
    const key = `${r.이름}|${r.과정}|${r.기수}`;
    if (!map.has(key)) map.set(key, { nodes: [], quests: [], first: r });
    const entry = map.get(key)!;
    if (r.노드명) entry.nodes.push(r);
    if (r.퀘스트명) entry.quests.push(r);
  }

  const results: TraineeAchievementSummary[] = [];
  for (const [, { nodes, quests, first }] of map) {
    const submitted = nodes.filter((n) => n.노드실행여부);
    const passed = quests.filter((q) => q.퀘스트상태 === "P");
    const avgStar = submitted.length > 0 ? submitted.reduce((s, n) => s + n.별점, 0) / submitted.length : 0;
    const nodeRate = nodes.length > 0 ? submitted.length / nodes.length : 0;
    const questRate = quests.length > 0 ? passed.length / quests.length : 0;
    // 복합 스코어: 노드제출률 40% + 퀘스트패스률 60%
    const composite = nodeRate * 0.4 + questRate * 0.6;
    const 신호등: "green" | "yellow" | "red" = composite >= 0.7 ? "green" : composite >= 0.4 ? "yellow" : "red";

    results.push({
      이름: first.이름,
      길드: first.길드,
      과정: first.과정,
      기수: first.기수,
      훈련상태: first.훈련상태,
      총노드수: nodes.length,
      제출노드수: submitted.length,
      노드평균별점: Math.round(avgStar * 10) / 10,
      총퀘스트수: quests.length,
      패스퀘스트수: passed.length,
      신호등,
    });
  }

  // 신호등: 빨강 먼저, 같으면 이름순
  return results.sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 };
    return order[a.신호등] - order[b.신호등] || a.이름.localeCompare(b.이름);
  });
}

/** 과정/기수 유니크 목록 추출 */
export function extractFilters(records: UnifiedRecord[]): { courses: string[]; cohorts: string[] } {
  const courses = [...new Set(records.map((r) => r.과정).filter(Boolean))].sort();
  const cohorts = [...new Set(records.map((r) => r.기수).filter(Boolean))].sort();
  return { courses, cohorts };
}

/** 연결 테스트 */
export async function testAchievementConnection(config: AchievementConfig): Promise<{ ok: boolean; message: string }> {
  try {
    if (!config.webAppUrl) return { ok: false, message: "Apps Script URL을 입력하세요." };
    const json = (await fetchAction(config.webAppUrl, { action: "sheets" })) as {
      sheets: string[];
      error?: string;
    };
    if (json.error) return { ok: false, message: `오류: ${json.error}` };
    const count = json.sheets?.length ?? 0;
    return { ok: true, message: `연결 성공! (${count}개 시트 확인)` };
  } catch (e) {
    return { ok: false, message: `연결 실패: ${(e as Error).message}` };
  }
}
