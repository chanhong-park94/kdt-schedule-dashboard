/** 보조강사 수기체크 모듈 — Zoom/Zep 참여 확인, 메모, 엑셀 다운로드 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { getAssistantSession, type AssistantSession } from "../auth/assistantAuth";
import { fetchRoster } from "./hrdApi";
import { loadHrdConfig } from "./hrdConfig";
import type { HrdRawTrainee } from "./hrdTypes";
import * as XLSX from "xlsx";

// ─── Supabase Client ────────────────────────────────────────
const rawUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const supabaseUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const supabaseKey = typeof rawKey === "string" ? rawKey.trim() : "";
const hasConfig = supabaseUrl.length > 0 && supabaseKey.length > 0;

const client: SupabaseClient | null = hasConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  : null;

function getClient(): SupabaseClient {
  if (!client) throw new Error("Supabase 설정이 없습니다.");
  return client;
}

// ─── Constants ──────────────────────────────────────────────
const TABLE = "assistant_attendance_checks";
const DEBOUNCE_MS = 500;

// ─── Types ──────────────────────────────────────────────────
interface CheckRow {
  id?: string;
  train_pr_id: string;
  degr: string;
  check_date: string;
  trainee_name: string;
  zoom_checked: boolean;
  zep_checked: boolean;
  memo: string;
  checked_by: string;
  created_at?: string;
  updated_at?: string;
}

interface MergedRow {
  index: number;
  name: string;
  hrdStatus: string;
  zoomChecked: boolean;
  zepChecked: boolean;
  memo: string;
}

// ─── DOM Helpers ────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

// ─── State ──────────────────────────────────────────────────
let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let currentSession: AssistantSession | null = null;

// ─── Supabase CRUD ──────────────────────────────────────────

async function fetchChecks(trainPrId: string, degr: string, date: string): Promise<CheckRow[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("train_pr_id", trainPrId)
    .eq("degr", degr)
    .eq("check_date", date);

  if (error) throw new Error(error.message);
  return (data ?? []) as CheckRow[];
}

async function upsertCheck(row: Omit<CheckRow, "id" | "created_at" | "updated_at">): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from(TABLE).upsert(row, {
    onConflict: "train_pr_id,degr,check_date,trainee_name",
  });
  if (error) throw new Error(error.message);
}

async function fetchChecksRange(trainPrId: string, degr: string, startDate: string, endDate: string): Promise<CheckRow[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("train_pr_id", trainPrId)
    .eq("degr", degr)
    .gte("check_date", startDate)
    .lte("check_date", endDate)
    .order("check_date", { ascending: true })
    .order("trainee_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CheckRow[];
}

// ─── Save Status ────────────────────────────────────────────

function showSaveStatus(msg: string, type: "saving" | "saved" | "error" = "saved") {
  const el = $("amcSaveStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `amc-save-status amc-status-${type}`;
  if (type === "saved") {
    setTimeout(() => {
      if (el.textContent === msg) el.textContent = "";
    }, 2000);
  }
}

// ─── Debounced Upsert ───────────────────────────────────────

function debouncedUpsert(key: string, row: Omit<CheckRow, "id" | "created_at" | "updated_at">): void {
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  showSaveStatus("저장 중...", "saving");

  debounceTimers.set(
    key,
    setTimeout(async () => {
      try {
        await upsertCheck(row);
        showSaveStatus("✅ 저장 완료", "saved");
      } catch (e) {
        showSaveStatus(`❌ 저장 실패: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      debounceTimers.delete(key);
    }, DEBOUNCE_MS),
  );
}

// ─── Normalize HRD Status ───────────────────────────────────

function getTraineeStatus(raw: HrdRawTrainee): string {
  const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
  if (stNm.includes("중도탈락")) return "중도탈락";
  if (stNm.includes("수료포기")) return "수료포기";
  if (stNm.includes("조기취업")) return "조기취업";
  if (stNm.includes("훈련중")) return "훈련중";
  if (stNm.includes("수료")) return "수료";
  return stNm || "훈련중";
}

function getTraineeName(raw: HrdRawTrainee): string {
  return (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").toString().trim();
}

// ─── Render Table ───────────────────────────────────────────

function renderTable(merged: MergedRow[], session: AssistantSession, date: string): void {
  const tbody = $("amcTbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (merged.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">훈련생 명단이 없습니다.</td></tr>`;
    return;
  }

  for (const row of merged) {
    const tr = document.createElement("tr");

    // #
    const tdIdx = document.createElement("td");
    tdIdx.textContent = String(row.index);
    tr.appendChild(tdIdx);

    // 이름
    const tdName = document.createElement("td");
    tdName.textContent = row.name;
    tdName.style.fontWeight = "600";
    tr.appendChild(tdName);

    // HRD 상태
    const tdStatus = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `amc-status-badge amc-st-${row.hrdStatus === "훈련중" ? "active" : "inactive"}`;
    badge.textContent = row.hrdStatus;
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    // Zoom 체크
    const tdZoom = document.createElement("td");
    tdZoom.className = "amc-check-cell";
    const zoomCb = document.createElement("input");
    zoomCb.type = "checkbox";
    zoomCb.className = "amc-checkbox";
    zoomCb.checked = row.zoomChecked;
    zoomCb.addEventListener("change", () => {
      row.zoomChecked = zoomCb.checked;
      debouncedUpsert(`${row.name}-${date}`, buildUpsertRow(row, session, date));
    });
    tdZoom.appendChild(zoomCb);
    tr.appendChild(tdZoom);

    // Zep 체크
    const tdZep = document.createElement("td");
    tdZep.className = "amc-check-cell";
    const zepCb = document.createElement("input");
    zepCb.type = "checkbox";
    zepCb.className = "amc-checkbox";
    zepCb.checked = row.zepChecked;
    zepCb.addEventListener("change", () => {
      row.zepChecked = zepCb.checked;
      debouncedUpsert(`${row.name}-${date}`, buildUpsertRow(row, session, date));
    });
    tdZep.appendChild(zepCb);
    tr.appendChild(tdZep);

    // 메모
    const tdMemo = document.createElement("td");
    const memoInput = document.createElement("input");
    memoInput.type = "text";
    memoInput.className = "amc-memo-input";
    memoInput.placeholder = "이석 발생 및 특이사항을 기록하세요";
    memoInput.value = row.memo;
    memoInput.addEventListener("input", () => {
      row.memo = memoInput.value;
      debouncedUpsert(`${row.name}-${date}`, buildUpsertRow(row, session, date));
    });
    tdMemo.appendChild(memoInput);
    tr.appendChild(tdMemo);

    tbody.appendChild(tr);
  }
}

function buildUpsertRow(
  row: MergedRow,
  session: AssistantSession,
  date: string,
): Omit<CheckRow, "id" | "created_at" | "updated_at"> {
  return {
    train_pr_id: session.trainPrId,
    degr: session.degr,
    check_date: date,
    trainee_name: row.name,
    zoom_checked: row.zoomChecked,
    zep_checked: row.zepChecked,
    memo: row.memo,
    checked_by: "", // 보조강사 코드 (세션에 없으므로 빈값)
  };
}

// ─── Load & Render ──────────────────────────────────────────

async function loadAndRender(): Promise<void> {
  const session = getAssistantSession();
  if (!session) return;
  currentSession = session;

  const dateInput = $("amcFilterDate") as HTMLInputElement | null;
  const date = dateInput?.value || new Date().toISOString().slice(0, 10);

  const emptyEl = $("amcEmptyState");
  const contentEl = $("amcContent");

  showSaveStatus("조회 중...", "saving");

  try {
    // HRD 명단 조회
    const config = loadHrdConfig();
    const roster = await fetchRoster(config, session.trainPrId, session.degr);

    // Supabase 체크 데이터 조회
    let checks: CheckRow[] = [];
    try {
      checks = await fetchChecks(session.trainPrId, session.degr, date);
    } catch {
      // 테이블 미생성 시 무시
    }

    const checkMap = new Map<string, CheckRow>();
    for (const c of checks) {
      checkMap.set(c.trainee_name, c);
    }

    // Merge
    const merged: MergedRow[] = roster.map((raw, i) => {
      const name = getTraineeName(raw);
      const existing = checkMap.get(name);
      return {
        index: i + 1,
        name,
        hrdStatus: getTraineeStatus(raw),
        zoomChecked: existing?.zoom_checked ?? false,
        zepChecked: existing?.zep_checked ?? false,
        memo: existing?.memo ?? "",
      };
    });

    // 과정/회차 표시
    const courseInput = $("amcCourseName") as HTMLInputElement | null;
    const degrInput = $("amcDegr") as HTMLInputElement | null;
    if (courseInput) courseInput.value = session.courseName;
    if (degrInput) degrInput.value = `${session.degr}회차`;

    // 렌더
    renderTable(merged, session, date);

    if (emptyEl) emptyEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";
    showSaveStatus(`${merged.length}명 조회 완료`, "saved");
  } catch (e) {
    showSaveStatus(`❌ 조회 실패: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

// ─── Excel Export ───────────────────────────────────────────

async function exportToExcel(startDate: string, endDate: string): Promise<void> {
  const session = currentSession || getAssistantSession();
  if (!session) {
    alert("보조강사 세션이 없습니다.");
    return;
  }

  showSaveStatus("엑셀 생성 중...", "saving");

  try {
    const checks = await fetchChecksRange(session.trainPrId, session.degr, startDate, endDate);

    if (checks.length === 0) {
      showSaveStatus("해당 기간 데이터가 없습니다.", "error");
      return;
    }

    const rows = checks.map((c) => ({
      날짜: c.check_date,
      이름: c.trainee_name,
      "Zoom 확인": c.zoom_checked ? "O" : "X",
      "Zep 확인": c.zep_checked ? "O" : "X",
      메모: c.memo || "",
      체크시각: c.updated_at ? new Date(c.updated_at).toLocaleString("ko-KR") : "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // 컬럼 너비 설정
    ws["!cols"] = [
      { wch: 12 }, // 날짜
      { wch: 10 }, // 이름
      { wch: 10 }, // Zoom
      { wch: 10 }, // Zep
      { wch: 40 }, // 메모
      { wch: 20 }, // 체크시각
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "수기체크");
    XLSX.writeFile(wb, `수기체크_${session.courseName}_${session.degr}회차_${startDate}~${endDate}.xlsx`);

    showSaveStatus("✅ 엑셀 다운로드 완료", "saved");

    // 모달 닫기
    $("amcExcelModal")?.classList.remove("active");
  } catch (e) {
    showSaveStatus(`❌ 엑셀 생성 실패: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

// ─── Tab Switching ──────────────────────────────────────────

function setupTabSwitching(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-att-tab]");
  const hrdPage = $("attPageAttendance");
  const manualPage = $("attPageManual");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.disabled) return;
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.attTab;
      if (target === "hrd") {
        if (hrdPage) hrdPage.style.display = "";
        if (manualPage) manualPage.style.display = "none";
      } else if (target === "manual") {
        if (hrdPage) hrdPage.style.display = "none";
        if (manualPage) manualPage.style.display = "";
        void loadAndRender();
      }
    });
  });
}

function enableManualTab(): void {
  const manualTab = $("attManualTab") as HTMLButtonElement | null;
  if (!manualTab) return;
  manualTab.disabled = false;
  const lock = manualTab.querySelector(".att-tab-lock");
  if (lock) lock.remove();
}

// ─── Date Filter ────────────────────────────────────────────

function setupDateFilter(): void {
  const dateInput = $("amcFilterDate") as HTMLInputElement | null;
  if (!dateInput) return;

  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = today;

  // 최근 7일까지만 허용
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 7);
  dateInput.min = minDate.toISOString().slice(0, 10);
  dateInput.max = today;

  dateInput.addEventListener("change", () => {
    void loadAndRender();
  });
}

// ─── Excel Modal ────────────────────────────────────────────

function setupExcelModal(): void {
  const excelBtn = $("amcExcelBtn");
  const modal = $("amcExcelModal");
  const closeBtn = $("amcExcelClose");
  const downloadBtn = $("amcExcelDownload");
  const startInput = $("amcExcelStart") as HTMLInputElement | null;
  const endInput = $("amcExcelEnd") as HTMLInputElement | null;

  excelBtn?.addEventListener("click", () => {
    // 기본값: 최근 7일
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    if (startInput) startInput.value = weekAgo.toISOString().slice(0, 10);
    if (endInput) endInput.value = today;
    modal?.classList.add("active");
  });

  closeBtn?.addEventListener("click", () => {
    modal?.classList.remove("active");
  });

  // 배경 클릭으로 닫기
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("active");
  });

  downloadBtn?.addEventListener("click", () => {
    const start = startInput?.value;
    const end = endInput?.value;
    if (!start || !end) {
      alert("시작일과 종료일을 모두 선택해주세요.");
      return;
    }
    if (start > end) {
      alert("시작일이 종료일보다 늦습니다.");
      return;
    }
    void exportToExcel(start, end);
  });
}

// ─── Init ───────────────────────────────────────────────────

export function initAssistantCheck(): void {
  setupTabSwitching();
  setupDateFilter();
  setupExcelModal();

  // 보조강사 세션 또는 운영매니저(v2) 로그인 시 수기체크 탭 활성화
  const session = getAssistantSession();
  const isManagerAuth = sessionStorage.getItem("academic_schedule_manager_auth_v2") === "verified";
  if (session || isManagerAuth) {
    enableManualTab();
  }

  // 보조강사 로그인 이벤트 수신 (동적 활성화)
  window.addEventListener("assistantLogin", () => {
    enableManualTab();
  });
}
