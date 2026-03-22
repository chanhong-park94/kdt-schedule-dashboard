/**
 * 재직자 학업성취도 API 모듈
 *
 * 스키마 구글시트 "학업성취도(재직자)" 탭을 Apps Script Web App을 통해 조회.
 * 학업성취도(실업자)와 동일한 Apps Script URL을 사용합니다.
 */
import type { EmployedRecord, EmployedSummary, EmployedCache } from "./hrdEmployedTypes";
import { EMPLOYED_CACHE_KEY } from "./hrdEmployedTypes";
import { loadAchievementConfig } from "./hrdAchievementApi";

const CACHE_TTL = 24 * 60 * 60 * 1000;

// ── 기수 코드 → 과정명/기수 매핑 ────────────────────────────
// CSV 기수: 1~9 → 재직자LLM, 11~19 → 재직자데이터, 21~29 → 재직자기획/개발
const COURSE_PREFIX_MAP: Record<number, string> = {
  0: "재직자LLM",
  1: "재직자데이터",
  2: "재직자기획/개발",
};

export function parseCohortCode(raw: string | number): { 과정명: string; 기수: string } {
  const num = typeof raw === "string" ? parseInt(raw, 10) : raw;
  if (isNaN(num) || num === 99) return { 과정명: "테스트", 기수: "99" };
  const prefix = Math.floor(num / 10); // 0, 1, 2
  const cohort = num % 10; // 1~9
  const courseName = COURSE_PREFIX_MAP[prefix] ?? `재직자${prefix}`;
  return { 과정명: courseName, 기수: `${cohort}기` };
}

// ── 캐시 ────────────────────────────────────────────────────
export function loadEmployedCache(): EmployedRecord[] | null {
  try {
    const raw = localStorage.getItem(EMPLOYED_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as EmployedCache;
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache.records;
  } catch {
    return null;
  }
}

function saveCache(records: EmployedRecord[]): void {
  try {
    localStorage.setItem(EMPLOYED_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), records }));
  } catch {
    /* quota exceeded */
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

// ── 데이터 로드 ─────────────────────────────────────────────
export async function fetchEmployedRecords(): Promise<EmployedRecord[]> {
  const cached = loadEmployedCache();
  if (cached) return cached;

  const config = loadAchievementConfig();
  if (!config.webAppUrl) throw new Error("Apps Script URL이 설정되지 않았습니다.");

  const json = (await fetchAction(config.webAppUrl, { action: "schema_employed" })) as {
    headers: string[];
    rows: (string | number | null)[][];
    error?: string;
  };
  if (json.error) throw new Error(json.error);

  const headers = json.headers.map(String);
  const idx = (name: string) => headers.indexOf(name);

  const records: EmployedRecord[] = json.rows
    .filter((row) => {
      const name = String(row[idx("성명")] ?? row[idx("이름")] ?? "").trim();
      const cohort = String(row[idx("기수")] ?? "");
      return name !== "" && cohort !== "99"; // 빈 이름 + 테스트(99) 제외
    })
    .map((row) => {
      const 강사진단: (number | null)[] = [];
      const 운영진단: (number | null)[] = [];
      const 프로젝트: (number | null)[] = [];

      for (let i = 1; i <= 12; i++) {
        const kIdx = idx(`유닛${i}_강사진단`);
        강사진단.push(kIdx >= 0 && row[kIdx] != null && row[kIdx] !== "" ? Number(row[kIdx]) : null);
        const uIdx = idx(`유닛${i}_운영진단`);
        운영진단.push(uIdx >= 0 && row[uIdx] != null && row[uIdx] !== "" ? Number(row[uIdx]) : null);
      }
      for (let i = 1; i <= 4; i++) {
        const pIdx = idx(`프로젝트${i}`);
        프로젝트.push(pIdx >= 0 && row[pIdx] != null && row[pIdx] !== "" ? Number(row[pIdx]) : null);
      }

      // 기수 코드 → 과정명/기수 자동 매핑 (과정명 열이 비어있으면 코드에서 변환)
      const rawCohort = row[idx("기수")] ?? "";
      const explicitCourse = String(row[idx("과정명")] ?? "").trim();
      const parsed = parseCohortCode(rawCohort);

      return {
        과정명: explicitCourse || parsed.과정명,
        기수: parsed.기수,
        성명: String(row[idx("성명")] ?? row[idx("이름")] ?? "").trim(),
        레벨: Number(row[idx("레벨")]) || 0,
        경험치: Number(row[idx("경험치")]) || 0,
        작성일: String(row[idx("작성일")] ?? "").trim(),
        강사진단,
        운영진단,
        프로젝트,
      };
    });

  saveCache(records);
  return records;
}

// ── 집계 ────────────────────────────────────────────────────
export function summarizeEmployed(
  records: EmployedRecord[],
  courseFilter: string,
  cohortFilter: string,
  searchFilter: string,
): EmployedSummary[] {
  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v != null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  };
  const round1 = (n: number) => Math.round(n * 10) / 10;

  return records
    .filter(
      (r) =>
        (!courseFilter || r.과정명 === courseFilter) &&
        (!cohortFilter || r.기수 === cohortFilter) &&
        (!searchFilter || r.성명.toLowerCase().includes(searchFilter)),
    )
    .map((r) => {
      const 강사avg = round1(avg(r.강사진단));
      const 운영avg = round1(avg(r.운영진단));
      const 프로젝트avg = round1(avg(r.프로젝트));
      const total = (강사avg + 운영avg) / 2;
      const grade = total >= 80 ? "A" : total >= 70 ? "B" : total >= 60 ? "C" : "D";
      return {
        과정명: r.과정명,
        기수: r.기수,
        성명: r.성명,
        레벨: r.레벨,
        경험치: r.경험치,
        강사진단평균: 강사avg,
        운영진단평균: 운영avg,
        프로젝트평균: 프로젝트avg,
        종합등급: grade,
      };
    })
    .sort((a, b) => {
      const order: Record<string, number> = { D: 0, C: 1, B: 2, A: 3 };
      return (order[a.종합등급] ?? 0) - (order[b.종합등급] ?? 0) || a.성명.localeCompare(b.성명);
    });
}

export function extractEmployedFilters(records: EmployedRecord[]): { courses: string[]; cohorts: string[] } {
  return {
    courses: [...new Set(records.map((r) => r.과정명).filter(Boolean))].sort(),
    cohorts: [...new Set(records.map((r) => r.기수).filter(Boolean))].sort(),
  };
}
