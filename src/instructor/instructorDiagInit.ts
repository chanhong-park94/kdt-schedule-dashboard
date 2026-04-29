/**
 * 교강사 진단 탭 초기화 (lazy-load 진입점)
 *
 * - 유닛 1~12 x 1차/2차 진단 입력 (1.0~5.0 점)
 * - 평균 = AVERAGE(1차, 2차)
 * - 환산 = (평균/5) x 100
 * - 교강사/운매 둘다 조회 가능
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { getAssistantSession } from "../auth/assistantAuth";
import { fetchRoster } from "../hrd/hrdApi";
import { loadHrdConfig } from "../hrd/hrdConfig";
import { escapeHtml } from "../core/escape";
import type { HrdCourse } from "../hrd/hrdTypes";

const TABLE = "instructor_diagnosis";
const TOTAL_UNITS = 12;

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
  first_score: number;
  second_score: number;
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
let diagData: Map<string, Map<number, DiagRow>> = new Map(); // name -> unit -> row

// ─── 과정/기수 드롭다운 ─────────────────────────────────────

function populateFilter(): void {
  const courseSelect = $("instrDiagCourse") as HTMLSelectElement | null;
  const degrSelect = $("instrDiagDegr") as HTMLSelectElement | null;

  const session = getAssistantSession();
  if (session) {
    const cEl = $("instrDiagCourse");
    const dEl = $("instrDiagDegr");
    if (cEl) cEl.style.display = "none";
    if (dEl) dEl.style.display = "none";
    currentTrainPrId = session.trainPrId;
    currentDegr = session.degr;
    void loadData();
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
  const statusEl = $("instrDiagStatus");
  const tableSection = $("instrDiagTableSection");

  const session = getAssistantSession();
  if (!session) {
    currentTrainPrId = ($("instrDiagCourse") as HTMLSelectElement)?.value || "";
    currentDegr = ($("instrDiagDegr") as HTMLSelectElement)?.value || "";
  }

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

    // 2) Supabase에서 전체 유닛 진단 데이터 로드
    const sb = getClient();
    const { data } = await sb
      .from(TABLE)
      .select("trainee_name,unit_number,first_score,second_score")
      .eq("train_pr_id", currentTrainPrId)
      .eq("degr", currentDegr);

    diagData = new Map();
    for (const r of (data || []) as DiagRow[]) {
      if (!diagData.has(r.trainee_name)) diagData.set(r.trainee_name, new Map());
      diagData.get(r.trainee_name)!.set(r.unit_number, r);
    }

    // 3) 렌더링
    renderTable();
    if (tableSection) tableSection.style.display = "";
    if (statusEl) statusEl.textContent = "";

    const scopeEl = $("instrDiagScope");
    if (scopeEl) scopeEl.textContent = `(${currentTrainees.filter((t) => !t.dropout).length}명 평가 대상)`;
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── 렌더링 ──────────────────────────────────────────────────

function getUnitRange(): number[] {
  return Array.from({ length: TOTAL_UNITS }, (_, i) => i + 1);
}

function renderTable(): void {
  const thead = $("instrDiagThead");
  const tbody = $("instrDiagBody");
  if (!thead || !tbody) return;

  const unitRange = getUnitRange();

  // 헤더
  thead.innerHTML =
    `<tr>
    <th rowspan="2">#</th><th rowspan="2">학습자명</th><th rowspan="2">상태</th>
    ${unitRange.map((u) => `<th colspan="4" style="text-align:center">유닛 ${u}</th>`).join("")}
  </tr><tr>
    ${unitRange.map(() => "<th>1차</th><th>2차</th><th>평균</th><th>환산</th>").join("")}
  </tr>`;

  // 바디
  tbody.innerHTML = currentTrainees
    .map((t, i) => {
      const dropCls = t.dropout ? " proj-eval-dropout" : "";
      const disabled = t.dropout ? "disabled" : "";
      const tData = diagData.get(t.name);

      const unitCells = unitRange
        .map((u) => {
          const d = tData?.get(u);
          const first = d?.first_score ?? 0;
          const second = d?.second_score ?? 0;
          const avg = first > 0 && second > 0 ? ((first + second) / 2).toFixed(2) : "-";
          const converted = avg !== "-" ? Math.round((parseFloat(avg) / 5) * 100) : "-";

          return `<td><input type="number" class="instr-diag-input" step="0.1" min="0" max="5" value="${first || ""}"
        data-name="${escapeHtml(t.name)}" data-unit="${u}" data-field="first" ${disabled} /></td>
        <td><input type="number" class="instr-diag-input" step="0.1" min="0" max="5" value="${second || ""}"
        data-name="${escapeHtml(t.name)}" data-unit="${u}" data-field="second" ${disabled} /></td>
        <td class="instr-avg" data-name="${escapeHtml(t.name)}" data-unit="${u}">${avg}</td>
        <td class="instr-conv" data-name="${escapeHtml(t.name)}" data-unit="${u}" style="font-weight:600">${converted}</td>`;
        })
        .join("");

      return `<tr class="${dropCls}"><td>${i + 1}</td><td>${escapeHtml(t.name)}</td>
      <td>${t.dropout ? '<span style="color:var(--danger)">중도탈락</span>' : "훈련중"}</td>
      ${unitCells}</tr>`;
    })
    .join("");

  // 입력 변경 시 평균/환산 재계산
  tbody.querySelectorAll<HTMLInputElement>(".instr-diag-input").forEach((input) => {
    input.addEventListener("input", () => {
      const name = input.dataset.name || "";
      const unit = input.dataset.unit || "";
      recalcUnit(name, parseInt(unit, 10));
    });
  });
}

function recalcUnit(name: string, unit: number): void {
  const firstEl = document.querySelector<HTMLInputElement>(
    `.instr-diag-input[data-name="${CSS.escape(name)}"][data-unit="${unit}"][data-field="first"]`,
  );
  const secondEl = document.querySelector<HTMLInputElement>(
    `.instr-diag-input[data-name="${CSS.escape(name)}"][data-unit="${unit}"][data-field="second"]`,
  );
  const avgEl = document.querySelector(`.instr-avg[data-name="${CSS.escape(name)}"][data-unit="${unit}"]`);
  const convEl = document.querySelector(`.instr-conv[data-name="${CSS.escape(name)}"][data-unit="${unit}"]`);

  const first = parseFloat(firstEl?.value || "0");
  const second = parseFloat(secondEl?.value || "0");

  if (first > 0 && second > 0) {
    const avg = (first + second) / 2;
    const conv = Math.round((avg / 5) * 100);
    if (avgEl) avgEl.textContent = avg.toFixed(2);
    if (convEl) convEl.textContent = String(conv);
  } else {
    if (avgEl) avgEl.textContent = "-";
    if (convEl) convEl.textContent = "-";
  }
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
  const el = $("instrDiagSaveStatus");
  if (el) el.textContent = msg;
  const topEl = $("instrDiagSaveStatusTop");
  if (topEl) topEl.textContent = msg;
}

// ─── 저장 ────────────────────────────────────────────────────

async function saveData(): Promise<void> {
  syncStatus("저장 중...");

  try {
    const sb = getClient();
    const session = getAssistantSession();
    const diagBy = session ? `강사_${session.courseName}` : (sessionStorage.getItem("kdt_auth_email") || "운매");

    const rows: DiagRow[] = [];
    document.querySelectorAll<HTMLInputElement>('.instr-diag-input[data-field="first"]').forEach((input) => {
      const name = input.dataset.name || "";
      const unit = parseInt(input.dataset.unit || "0", 10);
      if (!name || !unit) return;
      const t = currentTrainees.find((tr) => tr.name === name);
      if (t?.dropout) return;

      const secondEl = document.querySelector<HTMLInputElement>(
        `.instr-diag-input[data-name="${CSS.escape(name)}"][data-unit="${unit}"][data-field="second"]`,
      );
      const first = parseFloat(input.value) || 0;
      const second = parseFloat(secondEl?.value || "0") || 0;

      if (first > 0 || second > 0) {
        rows.push({
          train_pr_id: currentTrainPrId,
          degr: currentDegr,
          trainee_name: name,
          unit_number: unit,
          first_score: first,
          second_score: second,
          diagnosed_by: diagBy,
        });
      }
    });

    if (rows.length > 0) {
      const { error } = await sb.from(TABLE).upsert(rows, {
        onConflict: "train_pr_id,degr,trainee_name,unit_number",
      });
      if (error) throw new Error(error.message);
    }
    clearDirty();
    syncStatus(`✅ ${rows.length}건 저장 완료`);
  } catch (e) {
    syncStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── 초기화 ──────────────────────────────────────────────────

export function initInstructorDiag(): void {
  if (initialized) return;
  initialized = true;

  populateFilter();
  $("instrDiagLoadBtn")?.addEventListener("click", () => void loadData());
  $("instrDiagSaveBtn")?.addEventListener("click", () => void saveData());
  $("instrDiagSaveBtnTop")?.addEventListener("click", () => void saveData());

  // dirty tracking on score inputs
  const instrSection = $("sectionInstructorDiag");
  instrSection?.addEventListener("input", (e) => {
    if ((e.target as HTMLElement).classList.contains("instr-diag-input")) markDirty();
  });
}
