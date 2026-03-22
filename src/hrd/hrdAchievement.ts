/**
 * 학업성취도 대시보드
 *
 * Google Sheets(Apps Script Web App)에서 노드/퀘스트 데이터를 읽어와
 * 과정/기수별 훈련생 학업성취도 테이블을 표시합니다.
 */
import type { TraineeAchievementSummary, AchievementConfig } from "./hrdAchievementTypes";
import {
  loadAchievementConfig,
  saveAchievementConfig,
  testAchievementConnection,
  fetchUnified,
  fetchNodeSheet,
  fetchQuestSheet,
  summarizeByTrainee,
  extractFilters,
  loadAchievementCache,
  getAchievementCacheTimestamp,
} from "./hrdAchievementApi";
import type { UnifiedRecord } from "./hrdAchievementTypes";
import type { EmployedRecord, EmployedSummary } from "./hrdEmployedTypes";
import { fetchEmployedRecords, summarizeEmployed, extractEmployedFilters, loadEmployedCache } from "./hrdEmployedApi";
import { formatCacheAge, classifyApiError, showToast } from "./hrdCacheUtils";

// ─── DOM 헬퍼 ───────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

let currentConfig: AchievementConfig = { webAppUrl: "" };
let allRecords: UnifiedRecord[] = [];

function setStatus(msg: string, type: "success" | "error" | "loading" = "loading"): void {
  const el = $("achievementStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `ana-status ${type}`;
}

// ─── 테이블 렌더링 ──────────────────────────────────────────
function renderTable(summaries: TraineeAchievementSummary[]): void {
  const tbody = $("achvTableBody");
  const content = $("achievementContent");
  const empty = $("achievementEmpty");
  const count = $("achvTraineeCount");
  if (!tbody || !content || !empty) return;

  if (summaries.length === 0) {
    content.style.display = "none";
    empty.style.display = "";
    return;
  }

  empty.style.display = "none";
  content.style.display = "";
  if (count) count.textContent = `${summaries.length}명`;

  const signalEmoji: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
  const signalBg: Record<string, string> = {
    green: "background:#ecfdf5;color:#065f46",
    yellow: "background:#fefce8;color:#854d0e",
    red: "background:#fef2f2;color:#991b1b",
  };
  const statusColor: Record<string, string> = {
    훈련중: "background:#dbeafe;color:#1e40af",
    정상수료: "background:#ecfdf5;color:#065f46",
    중도탈락: "background:#fef2f2;color:#991b1b",
    확인필요: "background:#fefce8;color:#854d0e",
  };

  tbody.innerHTML = summaries
    .map(
      (s, i) => `
    <tr data-achv-idx="${i}" style="cursor: pointer">
      <td style="font-weight:600">${esc(s.이름)}</td>
      <td>${esc(s.길드)}</td>
      <td><span class="achv-badge" style="${statusColor[s.훈련상태] ?? ""}">${esc(s.훈련상태)}</span></td>
      <td>${s.제출노드수}/${s.총노드수}</td>
      <td>${s.노드평균별점}</td>
      <td>${s.패스퀘스트수}/${s.총퀘스트수}</td>
      <td><span class="achv-badge" style="${signalBg[s.신호등] ?? ""}">${signalEmoji[s.신호등] ?? ""}</span></td>
    </tr>`,
    )
    .join("");

  // 행 클릭 이벤트
  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-achv-idx]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const idx = Number(tr.getAttribute("data-achv-idx"));
      if (summaries[idx]) handleRowClick(summaries[idx]);
    });
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── 상세 펼침 ──────────────────────────────────────────────
async function handleRowClick(summary: TraineeAchievementSummary): Promise<void> {
  const detailEl = $("achievementDetail");
  const titleEl = $("achvDetailTitle");
  const nodeEl = $("achvDetailNode");
  const questEl = $("achvDetailQuest");
  if (!detailEl || !titleEl || !nodeEl || !questEl) return;

  titleEl.textContent = `${summary.이름} (${summary.과정} ${summary.기수}) 상세`;
  detailEl.style.display = "";
  nodeEl.innerHTML = "<p>노드 상세 로딩중...</p>";
  questEl.innerHTML = "<p>퀘스트 상세 로딩중...</p>";

  const sheetKey = `${summary.기수}${summary.과정}`;

  try {
    const [nodeRows, questRows] = await Promise.all([
      fetchNodeSheet(currentConfig, sheetKey).catch(() => []),
      fetchQuestSheet(currentConfig, sheetKey).catch(() => []),
    ]);

    // 노드 상세
    const myNode = nodeRows.find((r) => r.이름 === summary.이름);
    if (myNode) {
      const modules = Object.entries(myNode.모듈별점수);
      nodeEl.innerHTML = `
        <h5>노드 점수 (${esc(myNode.신호등)} | 누적: ${myNode.누적별점} | 제출률: ${myNode.노드제출률}%)</h5>
        <div style="overflow-x:auto">
          <table class="hrd-table" style="font-size:13px">
            <thead><tr>${modules.map(([k]) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
            <tbody><tr>${modules.map(([, v]) => `<td>${v ?? "-"}</td>`).join("")}</tr></tbody>
          </table>
        </div>`;
    } else {
      nodeEl.innerHTML = "<p class='muted'>개별 노드 시트 데이터 없음</p>";
    }

    // 퀘스트 상세
    const myQuest = questRows.find((r) => r.이름 === summary.이름);
    if (myQuest) {
      const quests = Object.entries(myQuest.퀘스트별상태);
      const statusStyle = (v: "P" | "F" | null) =>
        v === "P" ? "color:#10b981" : v === "F" ? "color:#ef4444" : "color:#6b7280";
      questEl.innerHTML = `
        <h5>퀘스트 상태 (TOTAL: ${myQuest.TOTAL} | PASS: ${myQuest.PASS_TOTAL})</h5>
        <div style="overflow-x:auto">
          <table class="hrd-table" style="font-size:13px">
            <thead><tr>${quests.map(([k]) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
            <tbody><tr>${quests.map(([, v]) => `<td style="${statusStyle(v)};font-weight:600">${v ?? "-"}</td>`).join("")}</tr></tbody>
          </table>
        </div>`;
    } else {
      questEl.innerHTML = "<p class='muted'>개별 퀘스트 시트 데이터 없음</p>";
    }
  } catch (e) {
    nodeEl.innerHTML = `<p class="muted">상세 로드 실패: ${(e as Error).message}</p>`;
    questEl.innerHTML = "";
  }
}

// ─── 필터 채우기 ────────────────────────────────────────────
function populateFilters(courses: string[], cohorts: string[]): void {
  const courseSelect = $("achvFilterCourse") as HTMLSelectElement | null;
  const cohortSelect = $("achvFilterCohort") as HTMLSelectElement | null;
  const filtersEl = $("achievementFilters");
  if (!courseSelect || !cohortSelect) return;

  courseSelect.innerHTML =
    '<option value="">전체 과정</option>' + courses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  cohortSelect.innerHTML =
    '<option value="">전체 기수</option>' + cohorts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (filtersEl) filtersEl.style.display = "";
}

// ─── 페이지네이션 ────────────────────────────────────────────
const PAGE_SIZE = 50;
let currentPage = 0;
let lastFilteredSummaries: TraineeAchievementSummary[] = [];

function renderPagination(total: number): void {
  const el = $("achvPagination");
  if (!el) return;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) { el.innerHTML = ""; return; }

  const btns: string[] = [];
  btns.push(`<button class="btn btn--sm" ${currentPage === 0 ? "disabled" : ""} data-achv-page="${currentPage - 1}">◀</button>`);
  for (let i = 0; i < totalPages; i++) {
    const active = i === currentPage ? "btn--primary" : "";
    btns.push(`<button class="btn btn--sm ${active}" data-achv-page="${i}">${i + 1}</button>`);
  }
  btns.push(`<button class="btn btn--sm" ${currentPage >= totalPages - 1 ? "disabled" : ""} data-achv-page="${currentPage + 1}">▶</button>`);
  el.innerHTML = btns.join("");

  el.querySelectorAll<HTMLButtonElement>("button[data-achv-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = Number(btn.dataset.achvPage);
      if (page >= 0 && page < totalPages) {
        currentPage = page;
        renderTable(lastFilteredSummaries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE));
        renderPagination(lastFilteredSummaries.length);
        $("achievementContent")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

// ─── 필터 적용 + 재렌더 ────────────────────────────────────
function applyFilterAndRender(): void {
  const courseVal = ($("achvFilterCourse") as HTMLSelectElement)?.value ?? "";
  const cohortVal = ($("achvFilterCohort") as HTMLSelectElement)?.value ?? "";
  const statusVal = ($("achvFilterStatus") as HTMLSelectElement)?.value ?? "";
  const signalVal = ($("achvFilterSignal") as HTMLSelectElement)?.value ?? "";
  const searchVal = ($("achvFilterSearch") as HTMLInputElement)?.value?.toLowerCase() ?? "";

  let summaries = summarizeByTrainee(allRecords, courseVal, cohortVal);
  if (searchVal) summaries = summaries.filter((s) => s.이름.toLowerCase().includes(searchVal));
  if (statusVal) summaries = summaries.filter((s) => s.훈련상태 === statusVal);
  if (signalVal) summaries = summaries.filter((s) => s.신호등 === signalVal);

  lastFilteredSummaries = summaries;
  currentPage = 0;
  renderTable(summaries.slice(0, PAGE_SIZE));
  renderPagination(summaries.length);

  const detailEl = $("achievementDetail");
  if (detailEl) detailEl.style.display = "none";
}

// ─── 설정 탭 초기화 (API 연동 섹션) ────────────────────────
function initSettingsAchievement(): void {
  const urlInput = $("settingsAchievementUrl") as HTMLInputElement | null;
  if (urlInput && currentConfig.webAppUrl) urlInput.value = currentConfig.webAppUrl;

  // 연결 테스트
  $("settingsAchievementTestBtn")?.addEventListener("click", async () => {
    const url = (urlInput?.value ?? "").trim();
    const statusEl = $("settingsAchievementTestStatus");
    if (!url) {
      if (statusEl) {
        statusEl.textContent = "URL을 입력하세요.";
        statusEl.className = "settings-status-msg error";
      }
      return;
    }
    if (statusEl) {
      statusEl.textContent = "테스트 중...";
      statusEl.className = "settings-status-msg loading";
    }
    const result = await testAchievementConnection({ webAppUrl: url });
    if (statusEl) {
      statusEl.textContent = result.message;
      statusEl.className = `settings-status-msg ${result.ok ? "success" : "error"}`;
    }
  });

  // 저장
  $("settingsAchievementSave")?.addEventListener("click", () => {
    const url = (urlInput?.value ?? "").trim();
    currentConfig = { webAppUrl: url };
    saveAchievementConfig(currentConfig);
    const statusEl = $("settingsAchievementTestStatus");
    if (statusEl) {
      statusEl.textContent = "저장됨 ✓";
      statusEl.className = "settings-status-msg success";
    }
    updateAchievementNotice();
  });
}

// ─── 설정 미완료 안내 ───────────────────────────────────────
function updateAchievementNotice(): void {
  const noticeEl = $("achievementConfigNotice");
  if (!noticeEl) return;
  noticeEl.style.display = currentConfig.webAppUrl ? "none" : "";
}

// ─── 서브탭 전환 ─────────────────────────────────────────────
let activeSubTab: "unemployed" | "employed" = "unemployed";

function switchSubTab(tab: "unemployed" | "employed"): void {
  activeSubTab = tab;
  const uBtn = $("achvTabUnemployed");
  const eBtn = $("achvTabEmployed");
  const uPanel = $("achvPanelUnemployed");
  const ePanel = $("achvPanelEmployed");
  if (uBtn) { uBtn.className = tab === "unemployed" ? "btn btn--sm btn--primary" : "btn btn--sm"; uBtn.style.opacity = tab === "unemployed" ? "1" : "0.6"; }
  if (eBtn) { eBtn.className = tab === "employed" ? "btn btn--sm btn--primary" : "btn btn--sm"; eBtn.style.opacity = tab === "employed" ? "1" : "0.6"; }
  if (uPanel) uPanel.style.display = tab === "unemployed" ? "" : "none";
  if (ePanel) ePanel.style.display = tab === "employed" ? "" : "none";
}

// ─── 재직자 로직 ─────────────────────────────────────────────
let empRecords: EmployedRecord[] = [];

function setEmpStatus(msg: string, type: "success" | "error" | "loading" = "loading"): void {
  const el = $("empStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `ana-status ${type}`;
}

function gradeColor(grade: string): string {
  if (grade === "A") return "background:#ecfdf5;color:#065f46";
  if (grade === "B") return "background:#dbeafe;color:#1e40af";
  if (grade === "C") return "background:#fefce8;color:#854d0e";
  return "background:#fef2f2;color:#991b1b";
}

function renderEmpTable(summaries: EmployedSummary[]): void {
  const tbody = $("empTableBody");
  const content = $("empContent");
  const empty = $("empEmpty");
  const count = $("empTraineeCount");
  if (!tbody || !content || !empty) return;
  if (summaries.length === 0) { content.style.display = "none"; empty.style.display = ""; return; }
  empty.style.display = "none";
  content.style.display = "";
  if (count) count.textContent = `${summaries.length}명`;
  tbody.innerHTML = summaries.map((s, i) => `
    <tr data-emp-idx="${i}" style="cursor:pointer">
      <td style="font-weight:600">${esc(s.성명)}</td>
      <td>${esc(s.기수)}</td>
      <td><span class="achv-badge" style="${gradeColor(s.종합등급)}">${s.종합등급}</span></td>
      <td>${s.강사진단평균}</td>
      <td>${s.운영진단평균}</td>
      <td>${s.프로젝트평균 || "-"}</td>
      <td>${s.경험치}</td>
    </tr>`).join("");

  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-emp-idx]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const idx = Number(tr.getAttribute("data-emp-idx"));
      const s = summaries[idx];
      if (s) showEmpDetail(empRecords.find((r) => r.성명 === s.성명 && r.기수 === s.기수));
    });
  });
}

function showEmpDetail(record: EmployedRecord | undefined): void {
  const el = $("empDetail");
  const title = $("empDetailTitle");
  const body = $("empDetailBody");
  if (!el || !title || !body || !record) return;
  title.textContent = `${record.성명} (${record.과정명} ${record.기수}) 유닛리포트 상세`;
  el.style.display = "";
  const unitHeaders = record.강사진단.map((_, i) => `유닛${i + 1}`).filter((_, i) => record.강사진단[i] != null || record.운영진단[i] != null);
  body.innerHTML = `
    <div style="overflow-x:auto">
      <table class="hrd-table" style="font-size:13px">
        <thead><tr><th></th>${unitHeaders.map((h) => `<th>${h}</th>`).join("")}${record.프로젝트.some((v) => v != null) ? record.프로젝트.map((_, i) => `<th>P${i + 1}</th>`).join("") : ""}</tr></thead>
        <tbody>
          <tr><td style="font-weight:600">강사진단</td>${record.강사진단.filter((_, i) => unitHeaders.includes(`유닛${i + 1}`)).map((v) => `<td>${v ?? "-"}</td>`).join("")}${record.프로젝트.some((v) => v != null) ? record.프로젝트.map(() => "<td>-</td>").join("") : ""}</tr>
          <tr><td style="font-weight:600">운영진단</td>${record.운영진단.filter((_, i) => unitHeaders.includes(`유닛${i + 1}`)).map((v) => `<td>${v ?? "-"}</td>`).join("")}${record.프로젝트.some((v) => v != null) ? record.프로젝트.map((v) => `<td>${v ?? "-"}</td>`).join("") : ""}</tr>
        </tbody>
      </table>
    </div>`;
}

function populateEmpFilters(records: EmployedRecord[]): void {
  const { courses, cohorts } = extractEmployedFilters(records);
  const cSel = $("empFilterCourse") as HTMLSelectElement | null;
  const chSel = $("empFilterCohort") as HTMLSelectElement | null;
  if (cSel) cSel.innerHTML = '<option value="">전체 과정</option>' + courses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (chSel) chSel.innerHTML = '<option value="">전체 기수</option>' + cohorts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const f = $("empFilters");
  if (f) f.style.display = "";
}

function applyEmpFilterAndRender(): void {
  const course = ($("empFilterCourse") as HTMLSelectElement)?.value ?? "";
  const cohort = ($("empFilterCohort") as HTMLSelectElement)?.value ?? "";
  const search = ($("empFilterSearch") as HTMLInputElement)?.value?.toLowerCase() ?? "";
  const summaries = summarizeEmployed(empRecords, course, cohort, search);
  renderEmpTable(summaries);
  const d = $("empDetail");
  if (d) d.style.display = "none";
}

function restoreEmpCache(): void {
  const cached = loadEmployedCache();
  if (!cached || cached.length === 0) return;
  empRecords = cached;
  populateEmpFilters(empRecords);
  applyEmpFilterAndRender();
  setEmpStatus(`${empRecords.length}명 (캐시)`, "success"); // 재직자는 별도 캐시 타임스탬프 없음
}

// ─── 초기화 ─────────────────────────────────────────────────
export function initAchievement(): void {
  currentConfig = loadAchievementConfig();
  initSettingsAchievement();
  updateAchievementNotice();

  // 서브탭 전환
  $("achvTabUnemployed")?.addEventListener("click", () => switchSubTab("unemployed"));
  $("achvTabEmployed")?.addEventListener("click", () => switchSubTab("employed"));

  // 실업자 필터
  $("achvFilterCourse")?.addEventListener("change", applyFilterAndRender);
  $("achvFilterCohort")?.addEventListener("change", applyFilterAndRender);
  $("achvFilterStatus")?.addEventListener("change", applyFilterAndRender);
  $("achvFilterSignal")?.addEventListener("change", applyFilterAndRender);
  $("achvFilterSearch")?.addEventListener("input", applyFilterAndRender);

  // 실업자 필터 초기화
  $("achvFilterReset")?.addEventListener("click", () => {
    for (const id of ["achvFilterCourse", "achvFilterCohort", "achvFilterStatus", "achvFilterSignal"]) {
      const el = $(id) as HTMLSelectElement | null;
      if (el) el.selectedIndex = 0;
    }
    const search = $("achvFilterSearch") as HTMLInputElement | null;
    if (search) search.value = "";
    applyFilterAndRender();
  });

  // 재직자 필터
  $("empFilterCourse")?.addEventListener("change", applyEmpFilterAndRender);
  $("empFilterCohort")?.addEventListener("change", applyEmpFilterAndRender);
  $("empFilterSearch")?.addEventListener("input", applyEmpFilterAndRender);

  // 재직자 필터 초기화
  $("empFilterReset")?.addEventListener("click", () => {
    for (const id of ["empFilterCourse", "empFilterCohort"]) {
      const el = $(id) as HTMLSelectElement | null;
      if (el) el.selectedIndex = 0;
    }
    const search = $("empFilterSearch") as HTMLInputElement | null;
    if (search) search.value = "";
    applyEmpFilterAndRender();
  });

  // 캐시 복원
  restoreFromCache();
  restoreEmpCache();

  // 조회 (현재 활성 탭에 따라 분기)
  $("achievementFetchBtn")?.addEventListener("click", async () => {
    currentConfig = loadAchievementConfig();
    if (!currentConfig.webAppUrl) {
      setStatus("설정 → API 연동에서 Apps Script URL을 입력해주세요.", "error");
      return;
    }

    if (activeSubTab === "unemployed") {
      setStatus("실업자 데이터 로딩 중...", "loading");
      try {
        allRecords = await fetchUnified(currentConfig);
        const { courses, cohorts } = extractFilters(allRecords);
        populateFilters(courses, cohorts);
        applyFilterAndRender();
        setStatus(`${allRecords.length.toLocaleString()}건 로드 완료`, "success");
      } catch (e) {
        setStatus(classifyApiError(e), "error");
      }
    } else {
      setEmpStatus("재직자 데이터 로딩 중...", "loading");
      try {
        empRecords = await fetchEmployedRecords();
        populateEmpFilters(empRecords);
        applyEmpFilterAndRender();
        setEmpStatus(`${empRecords.length}명 로드 완료`, "success");
      } catch (e) {
        setEmpStatus(classifyApiError(e), "error");
      }
    }
  });

  // Excel 다운로드
  $("achievementExcelBtn")?.addEventListener("click", async () => {
    if (allRecords.length === 0) {
      showToast("데이터가 없습니다. 먼저 조회해주세요.", "warning");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const summaries = summarizeByTrainee(allRecords, "", "");
      const wsData = summaries.map((s) => ({
        이름: s.이름,
        과정: s.과정,
        기수: s.기수,
        훈련상태: s.훈련상태,
        "노드 제출": `${s.제출노드수}/${s.총노드수}`,
        "노드 평균별점": s.노드평균별점,
        "퀘스트 패스": `${s.패스퀘스트수}/${s.총퀘스트수}`,
        신호등: s.신호등 === "green" ? "양호" : s.신호등 === "yellow" ? "주의" : "위험",
      }));
      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "학업성취도");
      XLSX.writeFile(wb, `학업성취도_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast("Excel 다운로드 완료", "success");
    } catch (e) {
      showToast(`Excel 생성 실패: ${(e as Error).message}`, "error");
    }
  });
}

// ─── 캐시 자동 복원 ───────────────────────────────────────
function restoreFromCache(): void {
  const cached = loadAchievementCache();
  if (!cached || cached.length === 0) return;
  allRecords = cached;
  const { courses, cohorts } = extractFilters(allRecords);
  populateFilters(courses, cohorts);
  applyFilterAndRender();
  const ts = getAchievementCacheTimestamp();
  const age = ts ? ` · ${formatCacheAge(ts)}` : "";
  setStatus(`${allRecords.length.toLocaleString()}건 (캐시${age})`, "success");
}
