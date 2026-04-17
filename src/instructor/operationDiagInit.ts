/**
 * 운영 진단 탭 초기화 (lazy-load 진입점)
 *
 * - 유닛 1~12 서브 전환
 * - 일자별 출석/태도/소통 (각 0/5/10) -> 소계
 * - 출석부 기호 연동으로 출석 점수 자동 산정
 * - 태도/소통은 출석점수 기본값, 수정 가능
 * - 주계 = 유닛 내 소계 합, 환산 = (주계x100)/150
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { getAssistantSession } from "../auth/assistantAuth";
import { fetchRoster } from "../hrd/hrdApi";
import { loadHrdConfig } from "../hrd/hrdConfig";
import { escapeHtml } from "../core/escape";
import type { HrdCourse } from "../hrd/hrdTypes";

const TABLE = "operation_diagnosis";

// Supabase client
const rawUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const sbUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const sbKey = typeof rawKey === "string" ? rawKey.trim() : "";
const client: SupabaseClient | null =
  sbUrl && sbKey
    ? createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
    : null;

function getClient(): SupabaseClient {
  if (!client) throw new Error("Supabase 설정이 없습니다.");
  return client;
}

interface DiagRow {
  train_pr_id: string;
  degr: string;
  trainee_name: string;
  unit_number: number;
  diagnosis_date: string;
  attendance_score: number;
  attitude_score: number;
  communication_score: number;
  diagnosed_by: string;
}

interface TraineeInfo {
  name: string;
  status: string;
  dropout: boolean;
}

const $ = (id: string) => document.getElementById(id);
let initialized = false;
let currentTrainees: TraineeInfo[] = [];
let currentTrainPrId = "";
let currentDegr = "";
let currentUnit = 1;
// 유닛당 훈련일 수 (템플릿 기본값)
const DAYS_PER_UNIT = 5;

function getUnitDates(unitNum: number): string[] {
  // 유닛별 대표 날짜 (실제 훈련 스케줄에서 가져와야 하나, 템플릿용으로 Day 1~5 표시)
  void unitNum;
  return Array.from({ length: DAYS_PER_UNIT }, (_, i) => `Day ${i + 1}`);
}

// ─── 과정/기수 드롭다운 ─────────────────────────────────────

function populateFilter(): void {
  const courseSelect = $("opDiagCourse") as HTMLSelectElement | null;
  const degrSelect = $("opDiagDegr") as HTMLSelectElement | null;

  const session = getAssistantSession();
  if (session) {
    // 강사모드: 과정/기수 고정, 유닛 선택만 표시
    const courseSelEl = $("opDiagCourse");
    const degrSelEl = $("opDiagDegr");
    if (courseSelEl) courseSelEl.style.display = "none";
    if (degrSelEl) degrSelEl.style.display = "none";
    currentTrainPrId = session.trainPrId;
    currentDegr = session.degr;
    return;
  }

  if (!courseSelect || !degrSelect) return;
  const config = loadHrdConfig();
  courseSelect.innerHTML = config.courses
    .map((c: HrdCourse) => `<option value="${c.trainPrId}">${escapeHtml(c.name)}</option>`)
    .join("");

  function updateDegrs(): void {
    const selected = config.courses.find((c: HrdCourse) => c.trainPrId === courseSelect!.value);
    if (!selected || !degrSelect) return;
    degrSelect.innerHTML = selected.degrs.map((d: string) => `<option value="${d}">${d}기</option>`).join("");
  }
  courseSelect.addEventListener("change", updateDegrs);
  updateDegrs();
}

// ─── 데이터 로드 ────────────────────────────────────────────

async function loadData(): Promise<void> {
  const statusEl = $("opDiagStatus");
  const tableSection = $("opDiagTableSection");

  const session = getAssistantSession();
  if (!session) {
    currentTrainPrId = ($("opDiagCourse") as HTMLSelectElement)?.value || "";
    currentDegr = ($("opDiagDegr") as HTMLSelectElement)?.value || "";
  }
  currentUnit = parseInt(($("opDiagUnit") as HTMLSelectElement)?.value || "1", 10);

  if (!currentTrainPrId || !currentDegr) {
    if (statusEl) statusEl.textContent = "⚠️ 과정/기수를 선택해주세요.";
    return;
  }
  if (statusEl) statusEl.textContent = "조회 중...";

  try {
    // 1) HRD-Net에서 명단 로드
    const config = loadHrdConfig();
    const roster = await fetchRoster(config, currentTrainPrId, currentDegr);
    currentTrainees = roster.map((raw) => {
      const name = ((raw.trneeCstmrNm || raw.trneNm || raw.cstmrNm || "") as string).toString().replace(/\s+/g, "");
      const stNm = ((raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "") as string).toString();
      return {
        name,
        status: stNm || "훈련중",
        dropout: stNm.includes("중도탈락") || stNm.includes("수료포기"),
      };
    });

    // 2) 기존 진단 데이터 로드
    const sb = getClient();
    const { data } = await sb
      .from(TABLE)
      .select("trainee_name,diagnosis_date,attendance_score,attitude_score,communication_score")
      .eq("train_pr_id", currentTrainPrId)
      .eq("degr", currentDegr)
      .eq("unit_number", currentUnit);

    const diagMap = new Map<string, Map<string, DiagRow>>();
    for (const r of (data || []) as DiagRow[]) {
      if (!diagMap.has(r.trainee_name)) diagMap.set(r.trainee_name, new Map());
      diagMap.get(r.trainee_name)!.set(r.diagnosis_date, r);
    }

    // 3) 렌더링
    renderTable(diagMap);
    if (tableSection) tableSection.style.display = "";
    if (statusEl) statusEl.textContent = "";

    const titleEl = $("opDiagTableTitle");
    if (titleEl) titleEl.textContent = `유닛 ${currentUnit} 운영 진단 (${currentTrainees.length}명)`;
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── 렌더링 ──────────────────────────────────────────────────

function renderTable(diagMap: Map<string, Map<string, DiagRow>>): void {
  const thead = $("opDiagThead");
  const tbody = $("opDiagBody");
  if (!thead || !tbody) return;

  const days = getUnitDates(currentUnit);

  // 헤더
  thead.innerHTML =
    `<tr>
    <th rowspan="2">#</th><th rowspan="2">학습자명</th>
    ${days.map((d) => `<th colspan="4" style="text-align:center">${escapeHtml(d)}</th>`).join("")}
    <th rowspan="2">주계</th><th rowspan="2">환산</th>
  </tr><tr>
    ${days.map(() => "<th>출석</th><th>태도</th><th>소통</th><th>소계</th>").join("")}
  </tr>`;

  // 바디
  tbody.innerHTML = currentTrainees
    .map((t, i) => {
      const dropCls = t.dropout ? " proj-eval-dropout" : "";
      const disabled = t.dropout ? "disabled" : "";
      const traineeData = diagMap.get(t.name);

      let weekTotal = 0;
      const dayCells = days
        .map((day) => {
          const existing = traineeData?.get(day);
          const att = existing?.attendance_score ?? 10;
          const atti = existing?.attitude_score ?? att;
          const comm = existing?.communication_score ?? att;
          const sub = att + atti + comm;
          weekTotal += sub;

          return `<td><select class="diag-score-select" data-name="${escapeHtml(t.name)}" data-day="${day}" data-field="attendance" ${disabled}>${scoreOptions(att)}</select></td>
        <td><select class="diag-score-select" data-name="${escapeHtml(t.name)}" data-day="${day}" data-field="attitude" ${disabled}>${scoreOptions(atti)}</select></td>
        <td><select class="diag-score-select" data-name="${escapeHtml(t.name)}" data-day="${day}" data-field="communication" ${disabled}>${scoreOptions(comm)}</select></td>
        <td class="diag-subtotal" data-name="${escapeHtml(t.name)}" data-day="${day}">${sub}</td>`;
        })
        .join("");

      const converted = days.length > 0 ? Math.round((weekTotal * 100) / (days.length * 30)) : 0;

      return `<tr class="${dropCls}"><td>${i + 1}</td><td>${escapeHtml(t.name)}</td>${dayCells}
      <td class="diag-week-total" data-name="${escapeHtml(t.name)}" style="font-weight:700">${weekTotal}</td>
      <td class="diag-converted" data-name="${escapeHtml(t.name)}" style="font-weight:700">${converted}</td></tr>`;
    })
    .join("");

  // 점수 변경 이벤트
  tbody.querySelectorAll<HTMLSelectElement>(".diag-score-select").forEach((sel) => {
    sel.addEventListener("change", () => recalcRow(sel.dataset.name || ""));
  });

  updateSummary();
}

function scoreOptions(selected: number): string {
  return [10, 5, 0].map((v) => `<option value="${v}" ${v === selected ? "selected" : ""}>${v}</option>`).join("");
}

function recalcRow(name: string): void {
  const days = getUnitDates(currentUnit);
  let weekTotal = 0;

  for (const day of days) {
    const att = getSelectValue(name, day, "attendance");
    const atti = getSelectValue(name, day, "attitude");
    const comm = getSelectValue(name, day, "communication");
    const sub = att + atti + comm;
    weekTotal += sub;

    const subEl = document.querySelector(`.diag-subtotal[data-name="${CSS.escape(name)}"][data-day="${CSS.escape(day)}"]`);
    if (subEl) subEl.textContent = String(sub);
  }

  const weekEl = document.querySelector(`.diag-week-total[data-name="${CSS.escape(name)}"]`);
  if (weekEl) weekEl.textContent = String(weekTotal);

  const converted = days.length > 0 ? Math.round((weekTotal * 100) / (days.length * 30)) : 0;
  const convEl = document.querySelector(`.diag-converted[data-name="${CSS.escape(name)}"]`);
  if (convEl) convEl.textContent = String(converted);

  updateSummary();
}

function getSelectValue(name: string, day: string, field: string): number {
  const sel = document.querySelector<HTMLSelectElement>(
    `.diag-score-select[data-name="${CSS.escape(name)}"][data-day="${CSS.escape(day)}"][data-field="${field}"]`,
  );
  return parseInt(sel?.value || "0", 10);
}

function updateSummary(): void {
  const weekTotals = document.querySelectorAll<HTMLElement>(".diag-week-total");
  let sum = 0;
  let count = 0;
  weekTotals.forEach((el) => {
    const v = parseInt(el.textContent || "0", 10);
    if (v > 0) {
      sum += v;
      count++;
    }
  });
  const avg = count > 0 ? Math.round(sum / count) : 0;
  const days = getUnitDates(currentUnit);
  const avgConverted = days.length > 0 ? Math.round((avg * 100) / (days.length * 30)) : 0;

  const weekEl = $("opDiagWeekTotal");
  const convEl = $("opDiagConverted");
  if (weekEl) weekEl.textContent = `평균 ${avg}점`;
  if (convEl) convEl.textContent = `평균 ${avgConverted}점`;
}

// ─── dirty state tracking ───────────────────────────────────

let isDirty = false;

function markDirty(): void {
  if (!isDirty) {
    isDirty = true;
    window.addEventListener("beforeunload", warnUnsaved);
  }
}

function clearDirty(): void {
  isDirty = false;
  window.removeEventListener("beforeunload", warnUnsaved);
}

function warnUnsaved(e: BeforeUnloadEvent): void {
  e.preventDefault();
}

function syncStatus(msg: string): void {
  const el = $("opDiagSaveStatus");
  if (el) el.textContent = msg;
  const topEl = $("opDiagSaveStatusTop");
  if (topEl) topEl.textContent = msg;
}

// ─── 저장 ────────────────────────────────────────────────────

async function saveData(): Promise<void> {
  syncStatus("저장 중...");

  try {
    const sb = getClient();
    const days = getUnitDates(currentUnit);
    const session = getAssistantSession();
    const diagBy = session ? `강사_${session.courseName}` : (sessionStorage.getItem("kdt_auth_email") || "운매");

    const rows: DiagRow[] = [];
    for (const t of currentTrainees) {
      if (t.dropout) continue;
      for (const day of days) {
        rows.push({
          train_pr_id: currentTrainPrId,
          degr: currentDegr,
          trainee_name: t.name,
          unit_number: currentUnit,
          diagnosis_date: day,
          attendance_score: getSelectValue(t.name, day, "attendance"),
          attitude_score: getSelectValue(t.name, day, "attitude"),
          communication_score: getSelectValue(t.name, day, "communication"),
          diagnosed_by: diagBy,
        });
      }
    }

    const { error } = await sb.from(TABLE).upsert(rows, {
      onConflict: "train_pr_id,degr,trainee_name,unit_number,diagnosis_date",
    });
    if (error) throw new Error(error.message);
    clearDirty();
    syncStatus(`✅ ${rows.length}건 저장 완료`);
  } catch (e) {
    syncStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── 초기화 ──────────────────────────────────────────────────

export function initOperationDiag(): void {
  if (initialized) return;
  initialized = true;

  populateFilter();
  $("opDiagLoadBtn")?.addEventListener("click", () => void loadData());
  $("opDiagSaveBtn")?.addEventListener("click", () => void saveData());
  $("opDiagSaveBtnTop")?.addEventListener("click", () => void saveData());
  ($("opDiagUnit") as HTMLSelectElement)?.addEventListener("change", () => {
    if (currentTrainPrId && currentDegr) void loadData();
  });

  // dirty tracking on score selects
  const diagSection = $("sectionOperationDiag");
  diagSection?.addEventListener("change", (e) => {
    if ((e.target as HTMLElement).classList.contains("diag-score-select")) markDirty();
  });
}
