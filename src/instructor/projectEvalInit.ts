/**
 * 프로젝트 평가 탭 초기화 (lazy-load 진입점)
 *
 * - 과정/기수별 프로젝트 1~4 평가
 * - HRD-Net 명단에서 학습자 로드
 * - 중도탈락은 회색 처리, 평가 제외
 * - 점수(100점) + 피드백 → Supabase project_evaluations 저장
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { getAssistantSession } from "../auth/assistantAuth";
import { fetchRoster } from "../hrd/hrdApi";
import { loadHrdConfig } from "../hrd/hrdConfig";
import { escapeHtml } from "../core/escape";
import type { HrdCourse } from "../hrd/hrdTypes";

const TABLE = "project_evaluations";

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

// 기본 루브릭 (LLM 과정 기본)
const DEFAULT_RUBRIC = [
  { label: "기술 구현 및 기능성", weight: 50 },
  { label: "대화 흐름의 논리성과 일관성", weight: 20 },
  { label: "사용자 입력 해석 및 적응성", weight: 10 },
  { label: "창의적 문제 해결 및 차별화 요소", weight: 10 },
  { label: "협동성 및 팀워크", weight: 10 },
];

interface EvalRow {
  train_pr_id: string;
  degr: string;
  trainee_name: string;
  project_number: number;
  score: number;
  feedback: string;
  evaluated_by: string;
}

interface TraineeInfo {
  name: string;
  status: string; // 훈련중 / 중도탈락
  dropout: boolean;
}

const $ = (id: string) => document.getElementById(id);
let initialized = false;
let currentTrainees: TraineeInfo[] = [];
let currentTrainPrId = "";
let currentDegr = "";
let currentProject = 1;

// ─── Supabase CRUD ──────────────────────────────────────────

async function fetchEvals(trainPrId: string, degr: string, projectNum: number): Promise<EvalRow[]> {
  const sb = getClient();
  const { data, error } = await sb
    .from(TABLE)
    .select("train_pr_id,degr,trainee_name,project_number,score,feedback,evaluated_by")
    .eq("train_pr_id", trainPrId)
    .eq("degr", degr)
    .eq("project_number", projectNum);
  if (error) throw new Error(error.message);
  return (data ?? []) as EvalRow[];
}

async function upsertEvals(rows: EvalRow[]): Promise<void> {
  if (rows.length === 0) return;
  const sb = getClient();
  const { error } = await sb.from(TABLE).upsert(rows, {
    onConflict: "train_pr_id,degr,trainee_name,project_number",
  });
  if (error) throw new Error(error.message);
}

// ─── 과정/기수 드롭다운 ─────────────────────────────────────

function populateCourseFilter(): void {
  const courseSelect = $("projEvalCourse") as HTMLSelectElement | null;
  const degrSelect = $("projEvalDegr") as HTMLSelectElement | null;
  const filterDiv = $("projEvalCourseFilter");
  if (!courseSelect || !degrSelect) return;

  const session = getAssistantSession();
  if (session) {
    // 강사모드: 과정/기수 고정
    if (filterDiv) filterDiv.style.display = "none";
    currentTrainPrId = session.trainPrId;
    currentDegr = session.degr;
    // 자동 조회
    void loadData();
    return;
  }

  // 운매 모드: 드롭다운
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
  const statusEl = $("projEvalStatus");
  const rubricSection = $("projEvalRubric");
  const tableSection = $("projEvalTableSection");

  const session = getAssistantSession();
  if (!session) {
    const courseSelect = $("projEvalCourse") as HTMLSelectElement | null;
    const degrSelect = $("projEvalDegr") as HTMLSelectElement | null;
    currentTrainPrId = courseSelect?.value || "";
    currentDegr = degrSelect?.value || "";
  }

  const projSelect = $("projEvalProject") as HTMLSelectElement | null;
  currentProject = parseInt(projSelect?.value || "1", 10);

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
      const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기");
      return { name, status: stNm || "훈련중", dropout };
    });

    if (currentTrainees.length === 0) {
      if (statusEl) statusEl.textContent = "⚠️ 해당 과정/기수의 훈련생이 없습니다.";
      return;
    }

    // 2) Supabase에서 기존 평가 로드
    const evals = await fetchEvals(currentTrainPrId, currentDegr, currentProject);
    const evalMap = new Map<string, EvalRow>();
    for (const e of evals) evalMap.set(e.trainee_name, e);

    // 3) 렌더링
    renderRubric();
    renderTable(evalMap);

    if (rubricSection) rubricSection.style.display = "";
    if (tableSection) tableSection.style.display = "";
    if (statusEl) statusEl.textContent = "";

    const titleEl = $("projEvalTableTitle");
    if (titleEl) titleEl.textContent = `프로젝트 ${currentProject} 학습자 평가 (${currentTrainees.length}명)`;

    const scopeEl = $("projEvalScope");
    if (scopeEl) scopeEl.textContent = `(${currentTrainees.filter((t) => !t.dropout).length}명 평가 대상)`;
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── 렌더링 ──────────────────────────────────────────────────

function renderRubric(): void {
  const body = $("projEvalRubricBody");
  if (!body) return;
  body.innerHTML = DEFAULT_RUBRIC.map(
    (r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.label)}</td><td>${r.weight}</td></tr>`,
  ).join("");
}

function renderTable(evalMap: Map<string, EvalRow>): void {
  const body = $("projEvalBody");
  if (!body) return;

  body.innerHTML = currentTrainees
    .map((t, i) => {
      const existing = evalMap.get(t.name);
      const score = existing?.score ?? 0;
      const feedback = existing?.feedback ?? "";
      const dropoutClass = t.dropout ? " proj-eval-dropout" : "";
      const disabled = t.dropout ? "disabled" : "";

      return `<tr class="proj-eval-row${dropoutClass}" data-name="${escapeHtml(t.name)}">
      <td>${i + 1}</td>
      <td>${escapeHtml(t.name)}</td>
      <td>${t.dropout ? '<span style="color:var(--danger)">중도탈락</span>' : '<span style="color:var(--success,#059669)">훈련중</span>'}</td>
      <td><input type="number" class="proj-eval-score hrd-input" min="0" max="100" value="${score}" ${disabled} data-name="${escapeHtml(t.name)}" /></td>
      <td><input type="text" class="proj-eval-feedback hrd-input" value="${escapeHtml(feedback)}" placeholder="피드백 입력" ${disabled} data-name="${escapeHtml(t.name)}" /></td>
    </tr>`;
    })
    .join("");
}

// ─── 저장 ────────────────────────────────────────────────────

async function saveData(): Promise<void> {
  const saveStatus = $("projEvalSaveStatus");
  if (saveStatus) saveStatus.textContent = "저장 중...";

  try {
    const rows: EvalRow[] = [];
    const session = getAssistantSession();
    const evaluatedBy = session ? `강사_${session.courseName}` : (sessionStorage.getItem("kdt_auth_email") || "운매");

    document.querySelectorAll<HTMLInputElement>(".proj-eval-score").forEach((input) => {
      const name = input.dataset.name || "";
      if (!name) return;
      const trainee = currentTrainees.find((t) => t.name === name);
      if (trainee?.dropout) return; // 중도탈락 제외

      const feedbackInput = document.querySelector<HTMLInputElement>(
        `.proj-eval-feedback[data-name="${CSS.escape(name)}"]`,
      );
      rows.push({
        train_pr_id: currentTrainPrId,
        degr: currentDegr,
        trainee_name: name,
        project_number: currentProject,
        score: parseInt(input.value, 10) || 0,
        feedback: feedbackInput?.value?.trim() || "",
        evaluated_by: evaluatedBy,
      });
    });

    await upsertEvals(rows);
    if (saveStatus) {
      saveStatus.textContent = `✅ ${rows.length}명 저장 완료`;
      saveStatus.className = "att-status";
    }
  } catch (e) {
    if (saveStatus) {
      saveStatus.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
      saveStatus.className = "att-status";
    }
  }
}

// ─── 초기화 ──────────────────────────────────────────────────

export function initProjectEval(): void {
  if (initialized) return;
  initialized = true;

  populateCourseFilter();

  $("projEvalLoadBtn")?.addEventListener("click", () => void loadData());
  $("projEvalSaveBtn")?.addEventListener("click", () => void saveData());

  // 프로젝트 번호 변경 시 자동 재조회 (데이터가 이미 로드된 경우)
  ($("projEvalProject") as HTMLSelectElement)?.addEventListener("change", () => {
    if (currentTrainPrId && currentDegr) void loadData();
  });
}
