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
} from "./hrdAchievementApi";
import type { UnifiedRecord } from "./hrdAchievementTypes";

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
  tbody.innerHTML = summaries
    .map(
      (s, i) => `
    <tr data-achv-idx="${i}" style="cursor: pointer">
      <td>${esc(s.이름)}</td>
      <td>${esc(s.길드)}</td>
      <td>${esc(s.훈련상태)}</td>
      <td>${s.제출노드수}/${s.총노드수}</td>
      <td>${s.노드평균별점}</td>
      <td>${s.패스퀘스트수}/${s.총퀘스트수}</td>
      <td>${signalEmoji[s.신호등] ?? ""}</td>
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

// ─── 필터 적용 + 재렌더 ────────────────────────────────────
function applyFilterAndRender(): void {
  const courseVal = ($("achvFilterCourse") as HTMLSelectElement)?.value ?? "";
  const cohortVal = ($("achvFilterCohort") as HTMLSelectElement)?.value ?? "";
  const summaries = summarizeByTrainee(allRecords, courseVal, cohortVal);
  renderTable(summaries);
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

// ─── 초기화 ─────────────────────────────────────────────────
export function initAchievement(): void {
  currentConfig = loadAchievementConfig();

  // 설정 탭 UI 초기화
  initSettingsAchievement();
  updateAchievementNotice();

  // 필터 변경 이벤트
  $("achvFilterCourse")?.addEventListener("change", applyFilterAndRender);
  $("achvFilterCohort")?.addEventListener("change", applyFilterAndRender);

  // 조회
  $("achievementFetchBtn")?.addEventListener("click", async () => {
    // 매번 최신 설정 읽기
    currentConfig = loadAchievementConfig();
    if (!currentConfig.webAppUrl) {
      setStatus("설정 → API 연동에서 Apps Script URL을 입력해주세요.", "error");
      return;
    }
    setStatus("데이터 로딩 중...", "loading");
    try {
      allRecords = await fetchUnified(currentConfig);
      const { courses, cohorts } = extractFilters(allRecords);
      populateFilters(courses, cohorts);
      applyFilterAndRender();
      setStatus(`${allRecords.length.toLocaleString()}건 로드 완료`, "success");
    } catch (e) {
      setStatus(`로드 실패: ${(e as Error).message}`, "error");
    }
  });
}
