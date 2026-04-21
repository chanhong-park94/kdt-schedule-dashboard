/**
 * 과정·기수별 담당자 메모 (훈련생분석 탭)
 *
 * - Supabase `course_cohort_notes` 테이블 (@modulabs.co.kr RLS)
 * - localStorage 폴백: 위험도만 (특이사항은 DB 필수 — 민감정보 보호)
 * - 자동 계산 값(평균출석률/남은결석가능일수)은 저장하지 않음
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { escapeHtml, escapeAttr } from "../core/escape";
import type { TraineeAnalysis } from "./hrdAnalyticsTypes";

// ─── 타입 ──────────────────────────────────────────────────────

export type RiskLevel = "safe" | "caution" | "warning" | "danger";

export interface CohortNote {
  courseName: string;
  degr: string;
  riskLevel: RiskLevel;
  notes: string;
  updatedByEmail: string;
  updatedByName: string;
  updatedAt: string; // ISO
}

export interface CohortAutoStats {
  avgRate: number; // -1이면 데이터 없음
  minRemainingAbsent: number; // Infinity면 데이터 없음
  imminentCount: number; // 남은 결석 ≤ 3일 (재학생만)
}

// ─── Supabase 클라이언트 (authClient 재사용 패턴) ──────────────

const rawUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const supabaseUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const supabaseKey = typeof rawKey === "string" ? rawKey.trim() : "";
const hasConfig = supabaseUrl.length > 0 && supabaseKey.length > 0;

const TABLE = "course_cohort_notes";
const LS_KEY = "kdt_cohort_notes_risk_v1";
const ALLOWED_DOMAIN = "modulabs.co.kr";

// auth 세션을 공유하기 위해 persistSession: true
let authClient: SupabaseClient | null = null;
function getClient(): SupabaseClient | null {
  if (!hasConfig) return null;
  if (!authClient) {
    authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, detectSessionInUrl: true },
    });
  }
  return authClient;
}

// ─── 자동 계산 ──────────────────────────────────────────────────

export function computeCohortStats(list: TraineeAnalysis[]): CohortAutoStats {
  const withData = list.filter((d) => d.hasAttendanceData);
  const avgRate = withData.length > 0 ? withData.reduce((s, d) => s + d.attendanceRate, 0) / withData.length : -1;

  const active = list.filter((d) => !d.dropout && d.hasAttendanceData);
  const remaining = active.map((d) => d.remainingAbsent).filter((v) => Number.isFinite(v));
  const minRemainingAbsent = remaining.length > 0 ? Math.min(...remaining) : Infinity;
  const imminentCount = active.filter((d) => d.remainingAbsent <= 3).length;

  return { avgRate, minRemainingAbsent, imminentCount };
}

// ─── 현재 로그인 세션 ─────────────────────────────────────────

async function getCurrentSession(): Promise<{ email: string; name: string } | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const email = data.session?.user?.email ?? "";
  if (!email.endsWith("@" + ALLOWED_DOMAIN)) return null;
  const localPart = email.split("@")[0] || "";
  return { email, name: localPart };
}

// ─── 조회 ───────────────────────────────────────────────────────

/** 과정·기수 메모를 DB에서 조회. 실패/미로그인 시 null */
export async function fetchCohortNote(courseName: string, degr: string): Promise<CohortNote | null> {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("course_name, degr, risk_level, notes, updated_by_email, updated_by_name, updated_at")
      .eq("course_name", courseName)
      .eq("degr", degr)
      .maybeSingle();
    if (error || !data) return null;
    return {
      courseName: data.course_name,
      degr: data.degr,
      riskLevel: (data.risk_level as RiskLevel) || "safe",
      notes: data.notes || "",
      updatedByEmail: data.updated_by_email || "",
      updatedByName: data.updated_by_name || "",
      updatedAt: data.updated_at || "",
    };
  } catch {
    return null;
  }
}

// ─── localStorage 폴백 (위험도만) ─────────────────────────────

type LocalRiskMap = Record<string, { riskLevel: RiskLevel; updatedAt: string }>;

function keyOf(courseName: string, degr: string): string {
  return `${courseName}||${degr}`;
}

function readLocalRisk(): LocalRiskMap {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LocalRiskMap) : {};
  } catch {
    return {};
  }
}

function writeLocalRisk(map: LocalRiskMap): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* 용량 초과 등 무시 */
  }
}

export function getLocalRisk(courseName: string, degr: string): RiskLevel | null {
  const map = readLocalRisk();
  return map[keyOf(courseName, degr)]?.riskLevel ?? null;
}

// ─── 저장 ───────────────────────────────────────────────────────

export interface SaveResult {
  ok: boolean;
  savedToDb: boolean;
  savedToLocal: boolean;
  message: string;
  note?: CohortNote;
}

/**
 * Supabase upsert 시도.
 * - 특이사항은 DB 필수 (민감정보 보호 정책).
 * - 실패 시 위험도만 localStorage 폴백, 특이사항은 경고 메시지.
 */
export async function saveCohortNote(input: {
  courseName: string;
  degr: string;
  riskLevel: RiskLevel;
  notes: string;
}): Promise<SaveResult> {
  const { courseName, degr, riskLevel } = input;
  const notes = (input.notes || "").slice(0, 1000);

  const sb = getClient();
  const session = await getCurrentSession();

  if (sb && session) {
    try {
      const payload = {
        course_name: courseName,
        degr,
        risk_level: riskLevel,
        notes,
        updated_by_email: session.email,
        updated_by_name: session.name,
      };
      const { data, error } = await sb
        .from(TABLE)
        .upsert(payload, { onConflict: "course_name,degr" })
        .select("course_name, degr, risk_level, notes, updated_by_email, updated_by_name, updated_at")
        .single();
      if (error) throw new Error(error.message);
      // DB 저장 성공 시 로컬 폴백 항목 제거
      const map = readLocalRisk();
      if (map[keyOf(courseName, degr)]) {
        delete map[keyOf(courseName, degr)];
        writeLocalRisk(map);
      }
      return {
        ok: true,
        savedToDb: true,
        savedToLocal: false,
        message: "저장 완료",
        note: data
          ? {
              courseName: data.course_name,
              degr: data.degr,
              riskLevel: (data.risk_level as RiskLevel) || "safe",
              notes: data.notes || "",
              updatedByEmail: data.updated_by_email || "",
              updatedByName: data.updated_by_name || "",
              updatedAt: data.updated_at || "",
            }
          : undefined,
      };
    } catch (err) {
      // DB 실패 → 위험도만 로컬 저장
      const map = readLocalRisk();
      map[keyOf(courseName, degr)] = { riskLevel, updatedAt: new Date().toISOString() };
      writeLocalRisk(map);
      return {
        ok: false,
        savedToDb: false,
        savedToLocal: true,
        message: `DB 저장 실패. 위험도만 로컬 저장됨. 특이사항은 저장 안 됨 (재시도 필요): ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
      };
    }
  }

  // 로그인 세션 없음 → 위험도만 로컬 저장
  const map = readLocalRisk();
  map[keyOf(courseName, degr)] = { riskLevel, updatedAt: new Date().toISOString() };
  writeLocalRisk(map);
  return {
    ok: false,
    savedToDb: false,
    savedToLocal: true,
    message: "로그인이 필요합니다. 위험도만 로컬 저장됨 (특이사항은 저장되지 않음).",
  };
}

// ─── PII 감지 ───────────────────────────────────────────────────

const PII_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /01[016789][- ]?\d{3,4}[- ]?\d{4}/, label: "휴대폰 번호" },
  { regex: /\d{6}[- ]?[1-4]\d{6}/, label: "주민등록번호" },
  { regex: /[가-힣]{2,4}\s*(학생|훈련생|수강생|씨|님)/, label: "학생 실명+호칭" },
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, label: "이메일" },
];

export function detectPii(text: string): string[] {
  const found: string[] = [];
  for (const { regex, label } of PII_PATTERNS) {
    if (regex.test(text)) found.push(label);
  }
  return found;
}

// ─── UI 렌더링 ──────────────────────────────────────────────────

const RISK_OPTIONS: Array<{ value: RiskLevel; label: string; icon: string }> = [
  { value: "safe", label: "안전", icon: "🟢" },
  { value: "caution", label: "주의", icon: "🟡" },
  { value: "warning", label: "경고", icon: "🟠" },
  { value: "danger", label: "위험", icon: "🔴" },
];

function fmtRate(rate: number): string {
  return rate < 0 ? "N/A" : `${rate.toFixed(1)}%`;
}

function fmtRemaining(v: number): string {
  return Number.isFinite(v) ? `${v}일` : "-";
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

/**
 * 메모 섹션 HTML (자동 요약 + 편집 폼).
 * 초기 상태는 로딩 표시 → hydrateCohortNoteSection에서 실제 데이터 주입.
 */
export function renderCohortNoteSection(
  courseName: string,
  degr: string,
  stats: CohortAutoStats,
  initialRiskFallback: RiskLevel | null,
): string {
  const safeCourse = escapeAttr(courseName);
  const safeDegr = escapeAttr(degr);
  const imminentClass = stats.imminentCount > 0 ? "ana-note-warn" : "";
  const rateClass =
    stats.avgRate < 0
      ? ""
      : stats.avgRate >= 90
        ? "ana-cell-good"
        : stats.avgRate >= 80
          ? "ana-cell-warn"
          : "ana-cell-bad";
  const remainClass = !Number.isFinite(stats.minRemainingAbsent)
    ? ""
    : stats.minRemainingAbsent <= 3
      ? "ana-cell-bad"
      : stats.minRemainingAbsent <= 5
        ? "ana-cell-warn"
        : "ana-cell-good";
  const initialRisk: RiskLevel = initialRiskFallback || "safe";

  const riskRadios = RISK_OPTIONS.map(
    (o) => `
      <label class="ana-note-risk-opt ana-note-risk-${o.value}${o.value === initialRisk ? " is-checked" : ""}">
        <input type="radio" name="anaNoteRisk_${safeCourse}_${safeDegr}" value="${o.value}"${o.value === initialRisk ? " checked" : ""} />
        <span>${o.icon} ${o.label}</span>
      </label>`,
  ).join("");

  return `
<div class="ana-note-section" data-note-course="${safeCourse}" data-note-degr="${safeDegr}">
  <div class="ana-note-grid">
    <div class="ana-note-stat">
      <div class="ana-note-stat-label">평균 출석률</div>
      <div class="ana-note-stat-value ${rateClass}">${fmtRate(stats.avgRate)}</div>
    </div>
    <div class="ana-note-stat">
      <div class="ana-note-stat-label">남은결석 최소</div>
      <div class="ana-note-stat-value ${remainClass}">${fmtRemaining(stats.minRemainingAbsent)}</div>
    </div>
    <div class="ana-note-stat">
      <div class="ana-note-stat-label">임박(≤3일) 학생</div>
      <div class="ana-note-stat-value ${imminentClass}">${stats.imminentCount}명</div>
    </div>
  </div>

  <div class="ana-note-editor">
    <div class="ana-note-row">
      <label class="ana-note-label">위험도 (담당자 판단)</label>
      <div class="ana-note-risk-group">${riskRadios}</div>
    </div>
    <div class="ana-note-row">
      <label class="ana-note-label">특이사항</label>
      <textarea
        class="ana-note-textarea"
        maxlength="1000"
        placeholder="⚠️ 학생 실명·연락처·건강정보 입력 금지. 예) 2주차 결석자 2명 발생, 사유 확인 중"
      ></textarea>
      <div class="ana-note-counter"><span class="ana-note-count">0</span> / 1000자</div>
    </div>
    <div class="ana-note-actions">
      <button type="button" class="ana-note-save-btn">저장</button>
      <span class="ana-note-status">불러오는 중…</span>
    </div>
  </div>
</div>`;
}

/**
 * 섹션을 DOM에 삽입한 뒤 호출. Supabase에서 실제 메모 불러와 주입 + 이벤트 바인딩.
 * section 엘리먼트의 data-note-course/degr 속성에서 키를 읽는다.
 */
export async function hydrateCohortNoteSection(section: HTMLElement): Promise<void> {
  if (!section) return;
  // 중복 hydrate 방지
  if (section.dataset.hydrated === "1") return;
  section.dataset.hydrated = "1";

  const courseName = section.dataset.noteCourse || "";
  const degr = section.dataset.noteDegr || "";
  if (!courseName || !degr) return;

  const textarea = section.querySelector<HTMLTextAreaElement>(".ana-note-textarea");
  const counter = section.querySelector<HTMLSpanElement>(".ana-note-count");
  const saveBtn = section.querySelector<HTMLButtonElement>(".ana-note-save-btn");
  const statusEl = section.querySelector<HTMLSpanElement>(".ana-note-status");
  const radios = Array.from(section.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  if (!textarea || !counter || !saveBtn || !statusEl) return;

  // DB 조회
  const note = await fetchCohortNote(courseName, degr);
  if (note) {
    textarea.value = note.notes;
    counter.textContent = String(note.notes.length);
    for (const r of radios) {
      r.checked = r.value === note.riskLevel;
      const parent = r.parentElement;
      if (parent) parent.classList.toggle("is-checked", r.checked);
    }
    statusEl.innerHTML = renderMetaLine(note);
  } else {
    const localRisk = getLocalRisk(courseName, degr);
    if (localRisk) {
      for (const r of radios) {
        r.checked = r.value === localRisk;
        const parent = r.parentElement;
        if (parent) parent.classList.toggle("is-checked", r.checked);
      }
      statusEl.textContent = "로컬 저장된 위험도만 있음 (특이사항 없음)";
      statusEl.classList.add("ana-note-status-warn");
    } else {
      statusEl.textContent = "저장된 메모 없음";
    }
  }

  // textarea 카운터
  textarea.addEventListener("input", () => {
    counter.textContent = String(textarea.value.length);
  });

  // 라디오 토글 시각 효과
  for (const r of radios) {
    r.addEventListener("change", () => {
      for (const other of radios) {
        const p = other.parentElement;
        if (p) p.classList.toggle("is-checked", other.checked);
      }
    });
  }

  // 행 클릭 전파 방지 (편집 영역)
  section.addEventListener("click", (e) => e.stopPropagation());

  // 저장
  saveBtn.addEventListener("click", async () => {
    const checked = radios.find((r) => r.checked);
    const riskLevel = (checked?.value as RiskLevel) || "safe";
    const notes = textarea.value.trim();

    // PII 감지 (특이사항만 검사)
    if (notes) {
      const hits = detectPii(notes);
      if (hits.length > 0) {
        const ok = confirm(
          `⚠️ 개인정보로 보이는 내용이 감지됐습니다.\n(${hits.join(", ")})\n\n민감정보는 저장하지 않는 것이 원칙입니다.\n그래도 저장할까요?`,
        );
        if (!ok) return;
      }
    }

    saveBtn.disabled = true;
    statusEl.textContent = "저장 중…";
    statusEl.classList.remove("ana-note-status-warn", "ana-note-status-ok");

    const result = await saveCohortNote({ courseName, degr, riskLevel, notes });
    saveBtn.disabled = false;

    if (result.ok && result.note) {
      statusEl.innerHTML = renderMetaLine(result.note);
      statusEl.classList.add("ana-note-status-ok");
    } else {
      statusEl.textContent = result.message;
      statusEl.classList.add("ana-note-status-warn");
    }
  });
}

function renderMetaLine(note: CohortNote): string {
  const who = note.updatedByName ? escapeHtml(note.updatedByName) : "(익명)";
  return `저장됨 · ${who} · ${escapeHtml(fmtDate(note.updatedAt))}`;
}
