/** 공결 신청 조회 모듈 — Supabase에서 excused_absence_requests 조회 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";

// ─── Supabase Client ────────────────────────────────────────
const rawUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const supabaseUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const supabaseKey = typeof rawKey === "string" ? rawKey.trim() : "";
const sbClient: SupabaseClient | null =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      })
    : null;

const TABLE = "excused_absence_requests";

// ─── Types ──────────────────────────────────────────────────
export interface ExcusedAbsenceRow {
  id: string;
  source: "application" | "evidence";
  course_name: string;
  trainee_name: string;
  birth_date: string;
  reason: string;
  request_date: string;
  file_link: string;
  submitted_at: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string;
  reviewed_at: string | null;
}

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// ─── 조회 ───────────────────────────────────────────────────

async function fetchRequests(courseName?: string): Promise<ExcusedAbsenceRow[]> {
  if (!sbClient) return [];
  try {
    let query = sbClient.from(TABLE).select("*").order("submitted_at", { ascending: false }).limit(100);
    if (courseName) {
      query = query.ilike("course_name", `%${courseName}%`);
    }
    const { data, error } = await query;
    if (error) {
      console.warn("[ExcusedAbsence] Fetch error:", error.message);
      return [];
    }
    return (data || []) as ExcusedAbsenceRow[];
  } catch (e) {
    console.warn("[ExcusedAbsence] Fetch failed:", e);
    return [];
  }
}

async function updateStatus(id: string, status: "approved" | "rejected"): Promise<void> {
  if (!sbClient) return;
  try {
    await sbClient.from(TABLE).update({ status, reviewed_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    console.warn("[ExcusedAbsence] Update failed:", e);
  }
}

// ─── UI 렌더링 ─────────────────────────────────────────────

function statusBadge(status: string): string {
  if (status === "approved") return '<span class="ea-badge ea-approved">승인</span>';
  if (status === "rejected") return '<span class="ea-badge ea-rejected">거절</span>';
  return '<span class="ea-badge ea-pending">대기</span>';
}

function sourceBadge(source: string): string {
  return source === "evidence"
    ? '<span class="ea-source-badge ea-source-evidence">증빙</span>'
    : '<span class="ea-source-badge ea-source-app">신청</span>';
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadAndRender(): Promise<void> {
  const tbody = $("eaTbody");
  const emptyState = $("eaEmptyState");
  const content = $("eaContent");
  const meta = $("eaMeta");

  if (!tbody) return;

  // 출결현황 필터에서 과정명 가져오기
  const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
  const selectedOption = courseSelect?.selectedOptions[0];
  const courseName = selectedOption && selectedOption.value ? selectedOption.textContent?.trim() || "" : "";

  const rows = await fetchRequests(courseName || undefined);

  if (rows.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (content) content.style.display = "none";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (content) content.style.display = "block";

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const approvedCount = rows.filter((r) => r.status === "approved").length;
  if (meta) {
    meta.textContent = `총 ${rows.length}건 (대기 ${pendingCount} / 승인 ${approvedCount})`;
  }

  tbody.innerHTML = rows
    .map((r, i) => {
      return `<tr>
        <td>${i + 1}</td>
        <td>${sourceBadge(r.source)}</td>
        <td><strong>${r.trainee_name}</strong></td>
        <td>${r.course_name}</td>
        <td>${r.reason || "-"}</td>
        <td>${r.request_date || "-"}</td>
        <td>${r.file_link ? '<a href="' + r.file_link + '" target="_blank">보기</a>' : "-"}</td>
        <td>${formatDate(r.submitted_at)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>
          ${
            r.status === "pending"
              ? `
            <button class="ea-action-btn ea-approve-btn" data-id="${r.id}" title="승인">✅</button>
            <button class="ea-action-btn ea-reject-btn" data-id="${r.id}" title="거절">❌</button>
          `
              : ""
          }
        </td>
      </tr>`;
    })
    .join("");

  // 승인/거절 이벤트
  tbody.querySelectorAll<HTMLButtonElement>(".ea-approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateStatus(btn.dataset.id || "", "approved");
      await loadAndRender();
    });
  });
  tbody.querySelectorAll<HTMLButtonElement>(".ea-reject-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await updateStatus(btn.dataset.id || "", "rejected");
      await loadAndRender();
    });
  });
}

// ─── 탭 전환 ───────────────────────────────────────────────

function setupExcusedTab(): void {
  const tabBar = document.querySelector(".att-tab-bar");
  if (!tabBar) return;

  tabBar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".att-tab[data-att-tab]");
    if (!btn || btn.disabled) return;

    if (btn.dataset.attTab === "excused") {
      tabBar.querySelectorAll<HTMLButtonElement>(".att-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const panels = ["attPageAttendance", "attPageManual", "attPageContacts", "attPageExcused"];
      panels.forEach((id) => {
        const el = $(id);
        if (el) el.style.display = id === "attPageExcused" ? "block" : "none";
      });

      void loadAndRender();
    } else if (btn.dataset.attTab !== "contacts") {
      const excusedPanel = $("attPageExcused");
      if (excusedPanel) excusedPanel.style.display = "none";
    }
  });
}

// ─── 응답시트 바로가기 링크 ───────────────────────────────────

function updateSheetLink(): void {
  const link = $("eaSheetLink") as HTMLAnchorElement | null;
  if (!link) return;
  try {
    const raw = localStorage.getItem("academic_schedule_manager_hrd_config_v1");
    if (raw) {
      const config = JSON.parse(raw);
      const url = config.excusedSheetUrl;
      if (url) {
        link.href = url;
        link.style.display = "";
        return;
      }
    }
  } catch { /* */ }
  link.style.display = "none";
}

// ─── Init ───────────────────────────────────────────────────

export function initExcusedAbsence(): void {
  setupExcusedTab();
  updateSheetLink();

  $("eaLoadBtn")?.addEventListener("click", () => {
    updateSheetLink();
    void loadAndRender();
  });
}
