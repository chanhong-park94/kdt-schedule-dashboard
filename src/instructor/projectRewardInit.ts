/**
 * 프로젝트 보상 탭 초기화 (운매 전용)
 *
 * - project_evaluations에서 프로젝트 1~4 점수 로드
 * - 달성 기준 자동 판정 (점수 + PERCENTRANK)
 * - 집행일은 운매가 직접 입력
 * - CSV 다운로드 기능
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { fetchRoster } from "../hrd/hrdApi";
import { loadHrdConfig } from "../hrd/hrdConfig";
import { escapeHtml } from "../core/escape";
import type { HrdCourse } from "../hrd/hrdTypes";

const EVAL_TABLE = "project_evaluations";
const REWARD_TABLE = "project_rewards";

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

// 보상 기준
const REWARD_CRITERIA = [
  { project: 1, amount: 10000, label: "1만원", minScore: 80, minRank: 0.7 },
  { project: 2, amount: 30000, label: "3만원", minScore: 75, minRank: 0.8 },
  { project: 3, amount: 50000, label: "5만원", minScore: 70, minRank: 0.9 },
  { project: 4, amount: 80000, label: "8만원", minScore: 70, minRank: 0.95 },
];

interface TraineeReward {
  name: string;
  status: string;
  dropout: boolean;
  scores: number[]; // [P1, P2, P3, P4]
  achieved: boolean[];
  executionDates: string[];
}

const $ = (id: string) => document.getElementById(id);
let initialized = false;
let currentData: TraineeReward[] = [];
let currentTrainPrId = "";
let currentDegr = "";

// PERCENTRANK: Excel 호환 — 해당 값보다 작은 값의 비율
function percentRank(values: number[], target: number): number {
  if (values.length <= 1) return target > 0 ? 1 : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < target).length;
  return below / (sorted.length - 1);
}

// ─── 과정/기수 드롭다운 ─────────────────────────────────────

function populateFilter(): void {
  const courseSelect = $("projRewardCourse") as HTMLSelectElement | null;
  const degrSelect = $("projRewardDegr") as HTMLSelectElement | null;
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
  const statusEl = $("projRewardStatus");
  const tableSection = $("projRewardTableSection");

  const courseSelect = $("projRewardCourse") as HTMLSelectElement | null;
  const degrSelect = $("projRewardDegr") as HTMLSelectElement | null;
  currentTrainPrId = courseSelect?.value || "";
  currentDegr = degrSelect?.value || "";

  if (!currentTrainPrId || !currentDegr) {
    if (statusEl) statusEl.textContent = "⚠️ 과정/기수를 선택해주세요.";
    return;
  }
  if (statusEl) statusEl.textContent = "조회 중...";

  try {
    const config = loadHrdConfig();
    const roster = await fetchRoster(config, currentTrainPrId, currentDegr);
    const sb = getClient();

    // 전체 프로젝트 점수 로드
    const { data: evalData } = await sb
      .from(EVAL_TABLE)
      .select("trainee_name,project_number,score")
      .eq("train_pr_id", currentTrainPrId)
      .eq("degr", currentDegr);

    // 보상 데이터 로드
    const { data: rewardData } = await sb
      .from(REWARD_TABLE)
      .select("trainee_name,project_number,execution_date")
      .eq("train_pr_id", currentTrainPrId)
      .eq("degr", currentDegr);

    // 점수 맵
    const scoreMap = new Map<string, number[]>();
    for (const e of evalData || []) {
      const key = e.trainee_name as string;
      if (!scoreMap.has(key)) scoreMap.set(key, [0, 0, 0, 0]);
      const arr = scoreMap.get(key)!;
      const pn = (e.project_number as number) - 1;
      if (pn >= 0 && pn < 4) arr[pn] = e.score as number;
    }

    // 집행일 맵
    const execMap = new Map<string, string[]>();
    for (const r of rewardData || []) {
      const key = r.trainee_name as string;
      if (!execMap.has(key)) execMap.set(key, ["", "", "", ""]);
      const arr = execMap.get(key)!;
      const pn = (r.project_number as number) - 1;
      if (pn >= 0 && pn < 4) arr[pn] = (r.execution_date as string) || "";
    }

    // 프로젝트별 점수 배열 (PERCENTRANK 계산용 — 중도탈락 제외)
    const allScores: number[][] = [[], [], [], []];

    currentData = roster.map((raw) => {
      const name = ((raw.trneeCstmrNm || raw.trneNm || raw.cstmrNm || "") as string).toString().replace(/\s+/g, "");
      const stNm = ((raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "") as string).toString();
      const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기");
      const scores = scoreMap.get(name) || [0, 0, 0, 0];
      if (!dropout) {
        for (let p = 0; p < 4; p++) allScores[p].push(scores[p]);
      }
      return {
        name,
        status: stNm || "훈련중",
        dropout,
        scores,
        achieved: [false, false, false, false],
        executionDates: execMap.get(name) || ["", "", "", ""],
      };
    });

    // 달성 여부 계산
    for (const t of currentData) {
      if (t.dropout) continue;
      for (let p = 0; p < 4; p++) {
        const c = REWARD_CRITERIA[p];
        const rank = percentRank(allScores[p], t.scores[p]);
        t.achieved[p] = t.scores[p] >= c.minScore && rank >= c.minRank;
      }
    }

    renderTable();
    if (tableSection) tableSection.style.display = "";
    if (statusEl) statusEl.textContent = "";

    const scopeEl = $("projRewardScope");
    if (scopeEl) {
      const active = currentData.filter((t) => !t.dropout).length;
      scopeEl.textContent = `(${active}명 평가 대상)`;
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── 렌더링 ──────────────────────────────────────────────────

function renderTable(): void {
  const body = $("projRewardBody");
  if (!body) return;

  body.innerHTML = currentData
    .map((t, i) => {
      const dropCls = t.dropout ? " proj-eval-dropout" : "";
      const cols = [0, 1, 2, 3]
        .map((p) => {
          const achieved = t.achieved[p];
          const badge = t.dropout
            ? "-"
            : achieved
              ? '<span style="color:var(--success,#059669);font-weight:700">&#x2705;</span>'
              : '<span style="color:var(--text-secondary)">&mdash;</span>';
          const disabled = t.dropout ? "disabled" : "";
          return `<td style="text-align:center">${t.scores[p]}</td>
        <td style="text-align:center">${badge}</td>
        <td><input type="date" class="hrd-input proj-reward-exec" data-name="${escapeHtml(t.name)}" data-project="${p + 1}" value="${t.executionDates[p]}" ${disabled} style="width:130px" /></td>`;
        })
        .join("");

      return `<tr class="${dropCls}">
      <td>${i + 1}</td>
      <td>${escapeHtml(t.name)}</td>
      <td>${t.dropout ? '<span style="color:var(--danger)">중도탈락</span>' : "훈련중"}</td>
      ${cols}
    </tr>`;
    })
    .join("");
}

// ─── 저장 ────────────────────────────────────────────────────

async function saveExecutionDates(): Promise<void> {
  const saveStatus = $("projRewardSaveStatus");
  if (saveStatus) saveStatus.textContent = "저장 중...";

  try {
    const sb = getClient();
    const rows: Array<Record<string, unknown>> = [];
    document.querySelectorAll<HTMLInputElement>(".proj-reward-exec").forEach((input) => {
      const name = input.dataset.name || "";
      const pn = parseInt(input.dataset.project || "0", 10);
      if (!name || !pn) return;
      const t = currentData.find((d) => d.name === name);
      if (!t || t.dropout) return;
      rows.push({
        train_pr_id: currentTrainPrId,
        degr: currentDegr,
        trainee_name: name,
        project_number: pn,
        score: t.scores[pn - 1],
        achieved: t.achieved[pn - 1],
        execution_date: input.value || "",
        executed_by: sessionStorage.getItem("kdt_auth_email") || "운매",
      });
    });

    if (rows.length > 0) {
      const { error } = await sb.from(REWARD_TABLE).upsert(rows, {
        onConflict: "train_pr_id,degr,trainee_name,project_number",
      });
      if (error) throw new Error(error.message);
    }
    if (saveStatus) saveStatus.textContent = `✅ ${rows.length}건 저장 완료`;
  } catch (e) {
    if (saveStatus) saveStatus.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── CSV 다운로드 ────────────────────────────────────────────

function downloadCsv(): void {
  if (currentData.length === 0) return;
  const headers = [
    "#",
    "이름",
    "상태",
    "P1점수",
    "P1달성",
    "P1집행일",
    "P2점수",
    "P2달성",
    "P2집행일",
    "P3점수",
    "P3달성",
    "P3집행일",
    "P4점수",
    "P4달성",
    "P4집행일",
  ];
  const rows = currentData.map((t, i) => {
    const cols = [0, 1, 2, 3].flatMap((p) => [t.scores[p], t.achieved[p] ? "달성" : "-", t.executionDates[p] || "-"]);
    return [i + 1, t.name, t.dropout ? "중도탈락" : "훈련중", ...cols];
  });
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join(
    "\n",
  );
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `프로젝트보상_${currentTrainPrId}_${currentDegr}기.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 초기화 ──────────────────────────────────────────────────

export function initProjectReward(): void {
  if (initialized) return;
  initialized = true;

  populateFilter();
  $("projRewardLoadBtn")?.addEventListener("click", () => void loadData());
  $("projRewardSaveBtn")?.addEventListener("click", () => void saveExecutionDates());
  $("projRewardCsvBtn")?.addEventListener("click", downloadCsv);
}
