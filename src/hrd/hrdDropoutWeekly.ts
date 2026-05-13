/**
 * 하차방어율 — 주차별 운영 트래커 (수기 입력 + 분석)
 *
 * 데이터 입력 출처: 그룹회의 스프레드시트
 *  - [2026]KDT공통_실업자.xlsx / [2026]KDT공통_재직자.xlsx 의 각 기수 탭 R9(하차방어율)
 *  - 매주 갱신되는 값을 사용자(owner=박찬홍)가 이 모듈로 수기 입력
 *
 * 매칭 규칙:
 *  - 스프레드시트 탭명(alias) ↔ 대시보드 hrdConfig 의 trainPrId+degr 1:1 매핑
 *  - RESEARCH 만 +8 offset ("RESEARCH16" = [아이펠]딥러닝 8기), 나머지는 prefix+N 그대로
 */

import { DEFAULT_COURSES } from "./hrdConfig";

// ─── 매칭 테이블 ────────────────────────────────────────────

export interface CohortPrefixMap {
  prefix: string;
  trainPrId: string;
  courseName: string;
  /** alias 숫자 - 대시보드 degr (RESEARCH 만 8, 나머지 0) */
  degrOffset: number;
  category: "실업자" | "재직자";
  /** 하차방어율 목표 % — 그룹회의 스프레드시트 기준 */
  target: number;
}

export const COHORT_PREFIX_MAP: CohortPrefixMap[] = [
  // ─── 실업자 (목표 80%) ───
  {
    prefix: "DS",
    trainPrId: "AIG20230000455611",
    courseName: "데이터사이언티스트",
    degrOffset: 0,
    category: "실업자",
    target: 80,
  },
  {
    prefix: "PDA",
    trainPrId: "AIG20240000498265",
    courseName: "데이터분석",
    degrOffset: 0,
    category: "실업자",
    target: 80,
  },
  {
    prefix: "RESEARCH",
    trainPrId: "AIG20240000459187",
    courseName: "[아이펠]딥러닝 개발자 도약 과정",
    degrOffset: 8,
    category: "실업자",
    target: 80,
  },
  {
    prefix: "ENGR",
    trainPrId: "AIG20250000501638",
    courseName: "AI 기반 지능형 서비스 개발 전문가 과정",
    degrOffset: 0,
    category: "실업자",
    target: 80,
  },
  // ─── 재직자 (목표 75%) ───
  {
    prefix: "ELLM",
    trainPrId: "AIG20240000498389",
    courseName: "재직자 LLM",
    degrOffset: 0,
    category: "재직자",
    target: 75,
  },
  {
    prefix: "EDATA",
    trainPrId: "AIG20250000501393",
    courseName: "데이터 기반 의사결정",
    degrOffset: 0,
    category: "재직자",
    target: 75,
  },
  {
    prefix: "EGIGAE",
    trainPrId: "AIG20250000501545",
    courseName: "AI 활용 서비스 기획/개발",
    degrOffset: 0,
    category: "재직자",
    target: 75,
  },
];

/** alias → {trainPrId, degr, courseName, category, target} (없으면 null) */
export function parseAlias(alias: string): CohortMatch | null {
  const trimmed = alias.trim().toUpperCase();
  for (const m of COHORT_PREFIX_MAP) {
    if (!trimmed.startsWith(m.prefix)) continue;
    const numStr = trimmed.slice(m.prefix.length);
    const aliasNum = parseInt(numStr, 10);
    if (!Number.isFinite(aliasNum) || aliasNum <= 0) continue;
    const dashboardDegr = aliasNum - m.degrOffset;
    if (dashboardDegr <= 0) continue;
    return {
      alias: `${m.prefix}${aliasNum}`,
      trainPrId: m.trainPrId,
      degr: String(dashboardDegr),
      courseName: m.courseName,
      category: m.category,
      target: m.target,
    };
  }
  return null;
}

/** trainPrId + degr → alias (없으면 null) */
export function aliasFor(trainPrId: string, degr: string): string | null {
  const m = COHORT_PREFIX_MAP.find((p) => p.trainPrId === trainPrId);
  if (!m) return null;
  const d = parseInt(degr, 10);
  if (!Number.isFinite(d) || d <= 0) return null;
  return `${m.prefix}${d + m.degrOffset}`;
}

export interface CohortMatch {
  alias: string;
  trainPrId: string;
  degr: string;
  courseName: string;
  category: "실업자" | "재직자";
  target: number;
}

/**
 * hrdConfig.DEFAULT_COURSES + COHORT_PREFIX_MAP 교집합 — 입력 폼 dropdown 옵션.
 * 결과는 카테고리(실업자→재직자), prefix, degr 순으로 정렬.
 */
export function getAllCohortOptions(): CohortMatch[] {
  const out: CohortMatch[] = [];
  for (const m of COHORT_PREFIX_MAP) {
    const course = DEFAULT_COURSES.find((c) => c.trainPrId === m.trainPrId);
    if (!course) continue;
    for (const degr of course.degrs) {
      const alias = aliasFor(course.trainPrId, degr);
      if (!alias) continue;
      out.push({
        alias,
        trainPrId: course.trainPrId,
        degr,
        courseName: course.name,
        category: m.category,
        target: m.target,
      });
    }
  }
  // 실업자 먼저, prefix alphabetic, degr 숫자 오름차순
  out.sort((a, b) => {
    if (a.category !== b.category) return a.category === "실업자" ? -1 : 1;
    const ap = a.alias.replace(/\d+$/, "");
    const bp = b.alias.replace(/\d+$/, "");
    if (ap !== bp) return ap.localeCompare(bp);
    return (parseInt(a.degr, 10) || 0) - (parseInt(b.degr, 10) || 0);
  });
  return out;
}

// ─── 주차별 입력 데이터 ─────────────────────────────────────

const STORAGE_KEY = "kdt_dropout_weekly_v1";

export type RiskSignal = "출결" | "성취도" | "만족도" | "복합" | "";

export interface WeeklyDropoutEntry {
  id: string;
  /** 매칭 키 — alias 그대로 저장하여 향후 매핑 변경 시에도 추적 가능 */
  alias: string;
  /** hrdConfig 매칭 — dropout entry와 join 용도 */
  trainPrId: string;
  degr: string;
  /** 1 ~ 26 (실업자) / 1 ~ 13+ (재직자) */
  weekNum: number;
  /** 0 ~ 100 — 스프레드시트 R9 값 */
  defenseRate: number;
  /** 위험 모듈 라벨 (예: "모듈5") — 선택 */
  riskModule: string;
  /** 위험 신호 — 선택 */
  riskSignal: RiskSignal;
  /** 이번 주에 한 액션 — 선택 */
  actionTaken: string;
  /** 다음 주 계획 — 선택 */
  actionPlanned: string;
  /** 자유 메모 — 선택 */
  note: string;
  /** ISO timestamp */
  enteredAt: string;
}

export function loadWeeklyEntries(): WeeklyDropoutEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WeeklyDropoutEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveWeeklyEntries(entries: WeeklyDropoutEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function addOrUpdateWeeklyEntry(
  input: Omit<WeeklyDropoutEntry, "id" | "enteredAt">,
): WeeklyDropoutEntry {
  const entries = loadWeeklyEntries();
  // 같은 (alias, weekNum) 이미 있으면 update — 매주 갱신 UX
  const idx = entries.findIndex(
    (e) => e.alias === input.alias && e.weekNum === input.weekNum,
  );
  const now = new Date().toISOString();
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...input, enteredAt: now };
    saveWeeklyEntries(entries);
    return entries[idx];
  }
  const created: WeeklyDropoutEntry = {
    ...input,
    id: crypto.randomUUID(),
    enteredAt: now,
  };
  entries.push(created);
  saveWeeklyEntries(entries);
  return created;
}

export function deleteWeeklyEntry(id: string): void {
  saveWeeklyEntries(loadWeeklyEntries().filter((e) => e.id !== id));
}

/** alias 기준 주차 오름차순 정렬 시계열 */
export function getWeeklySeries(alias: string): WeeklyDropoutEntry[] {
  return loadWeeklyEntries()
    .filter((e) => e.alias === alias)
    .sort((a, b) => a.weekNum - b.weekNum);
}

// ─── 만족도 데이터 (그룹회의 스프레드시트 R16/R17) ───────────

const SATISFACTION_STORAGE_KEY = "kdt_dropout_satisfaction_v1";

export interface CohortSatisfaction {
  alias: string;
  /** 과정만족도 평균 (D열) — null 이면 미입력 */
  courseAvg: number | null;
  /** 과정만족도 목표 (스프레드시트 기준 통상 45) */
  courseTarget: number;
  /** [모듈번호, 점수] 정렬됨 */
  courseModules: Array<[number, number]>;
  /** 강사만족도 평균 — null 이면 미입력 */
  instructorAvg: number | null;
  /** 강사만족도 목표 (스프레드시트 기준 통상 50) */
  instructorTarget: number;
  instructorModules: Array<[number, number]>;
}

export function loadSatisfactionMap(): Record<string, CohortSatisfaction> {
  try {
    const raw = localStorage.getItem(SATISFACTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSatisfactionMap(map: Record<string, CohortSatisfaction>): void {
  localStorage.setItem(SATISFACTION_STORAGE_KEY, JSON.stringify(map));
}

export function getSatisfaction(alias: string): CohortSatisfaction | null {
  return loadSatisfactionMap()[alias] ?? null;
}

// ─── 분석 도출 ──────────────────────────────────────────────

export type SignalLight = "green" | "yellow" | "red" | "gray";

export interface CohortStatus {
  match: CohortMatch;
  /** 최근 주차 entry — null이면 데이터 없음 */
  latest: WeeklyDropoutEntry | null;
  /** 직전 3주 변화량 (pp) — 데이터 부족 시 null */
  delta3w: number | null;
  signal: SignalLight;
  /** entries 갯수 (시계열 길이) */
  entryCount: number;
}

/**
 * 신호등 규칙:
 *  - 🔴 red:    latest.defenseRate < target  또는  delta3w ≤ -5
 *  - 🟡 yellow: target ≤ latest < target + 5  또는  -5 < delta3w ≤ -2
 *  - 🟢 green:  latest ≥ target + 5  그리고  delta3w > -2
 *  - ⚪ gray:   데이터 없음
 */
export function computeSignal(
  latest: WeeklyDropoutEntry | null,
  delta3w: number | null,
  target: number,
): SignalLight {
  if (!latest) return "gray";
  const r = latest.defenseRate;
  const d = delta3w ?? 0;
  if (r < target || d <= -5) return "red";
  if (r < target + 5 || d <= -2) return "yellow";
  return "green";
}

/** 모든 매칭 가능 기수의 상태 — 입력값 0건이어도 gray로 반환 */
export function computeAllCohortStatuses(): CohortStatus[] {
  const entries = loadWeeklyEntries();
  const byAlias = new Map<string, WeeklyDropoutEntry[]>();
  for (const e of entries) {
    if (!byAlias.has(e.alias)) byAlias.set(e.alias, []);
    byAlias.get(e.alias)!.push(e);
  }

  return getAllCohortOptions().map((match) => {
    const list = (byAlias.get(match.alias) || []).sort((a, b) => a.weekNum - b.weekNum);
    const latest = list.length > 0 ? list[list.length - 1] : null;
    let delta3w: number | null = null;
    if (list.length >= 4) {
      // latest 와 -3주 비교 (latest 포함 4개 항목)
      const baseline = list[list.length - 4];
      delta3w = round1(latest!.defenseRate - baseline.defenseRate);
    } else if (list.length >= 2 && latest) {
      delta3w = round1(latest.defenseRate - list[0].defenseRate);
    }
    return {
      match,
      latest,
      delta3w,
      signal: computeSignal(latest, delta3w, match.target),
      entryCount: list.length,
    };
  });
}

/** 입력 데이터가 있는 기수만 반환 — "운영 중" 시그널 테이블용 */
export function computeActiveCohortStatuses(): CohortStatus[] {
  return computeAllCohortStatuses().filter((s) => s.entryCount > 0);
}

// ─── 헬퍼 ───────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
