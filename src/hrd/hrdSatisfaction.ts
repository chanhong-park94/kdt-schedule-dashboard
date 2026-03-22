/**
 * 만족도 대시보드
 *
 * 스키마 구글시트 "만족도" 탭의 수기 취합 데이터를
 * Apps Script Web App을 통해 조회/표시합니다.
 */
import type { SatisfactionRecord, SatisfactionConfig, SatisfactionStats, SatisfactionSummary } from "./hrdSatisfactionTypes";
import {
  loadSatisfactionConfig,
  saveSatisfactionConfig,
  testSatisfactionConnection,
  fetchSatisfactionRecords,
  calcSatisfactionStats,
  summarizeByCohort,
  extractSatisfactionFilters,
  loadSatisfactionCache,
  getSatisfactionCacheTimestamp,
} from "./hrdSatisfactionApi";
import { formatCacheAge, classifyApiError } from "./hrdCacheUtils";

// ─── DOM 헬퍼 ───────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

let currentConfig: SatisfactionConfig = { webAppUrl: "" };
let allRecords: SatisfactionRecord[] = [];

function setStatus(msg: string, type: "success" | "error" | "loading" = "loading"): void {
  const el = $("satisfactionStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `ana-status ${type}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── NPS 색상 헬퍼 ──────────────────────────────────────────
function npsColor(nps: number): string {
  if (nps >= 50) return "background:#ecfdf5;color:#065f46";
  if (nps >= 0) return "background:#fefce8;color:#854d0e";
  return "background:#fef2f2;color:#991b1b";
}

function scoreColor(score: number): string {
  if (score >= 4) return "background:#ecfdf5;color:#065f46";
  if (score >= 3) return "background:#dbeafe;color:#1e40af";
  if (score >= 2) return "background:#fefce8;color:#854d0e";
  return "background:#fef2f2;color:#991b1b";
}

// ─── 통계 카드 렌더링 ───────────────────────────────────────
function renderStats(stats: SatisfactionStats): void {
  const container = $("satisfactionStats");
  if (!container) return;
  container.style.display = "";

  const npsEl = $("satStatNps");
  if (npsEl) npsEl.innerHTML = `<span class="achv-badge" style="${npsColor(stats.NPS평균)}">${stats.NPS평균}</span>`;

  const teacherEl = $("satStatTeacher");
  if (teacherEl) teacherEl.innerHTML = `<span class="achv-badge" style="${scoreColor(stats.강사만족도평균)}">${stats.강사만족도평균}</span>`;

  const midEl = $("satStatMid");
  if (midEl) midEl.innerHTML = `<span class="achv-badge" style="${scoreColor(stats.중간만족도평균)}">${stats.중간만족도평균}</span>`;

  const finalEl = $("satStatFinal");
  if (finalEl) finalEl.innerHTML = `<span class="achv-badge" style="${scoreColor(stats.최종만족도평균)}">${stats.최종만족도평균}</span>`;

  const totalEl = $("satStatTotal");
  if (totalEl) totalEl.textContent = `${stats.총응답수}건`;

  // 과정별 NPS 칩
  const courseNpsEl = $("satStatCourseNps");
  if (courseNpsEl) {
    courseNpsEl.innerHTML = Object.entries(stats.과정별NPS)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="achv-badge" style="${npsColor(v)}">${esc(k)} ${v}</span>`)
      .join(" ");
  }
}

// ─── 테이블 렌더링 (과정/기수별 집계) ───────────────────────
function renderTable(summaries: SatisfactionSummary[]): void {
  const tbody = $("satTableBody");
  const content = $("satisfactionContent");
  const empty = $("satisfactionEmpty");
  const count = $("satRecordCount");
  if (!tbody || !content || !empty) return;

  if (summaries.length === 0) {
    content.style.display = "none";
    empty.style.display = "";
    return;
  }

  empty.style.display = "none";
  content.style.display = "";
  if (count) count.textContent = `${summaries.length}개 과정/기수`;

  tbody.innerHTML = summaries
    .map(
      (s, i) => `
    <tr data-sat-idx="${i}" style="cursor:pointer">
      <td style="font-weight:600">${esc(s.과정명)}</td>
      <td>${esc(s.기수)}</td>
      <td>${s.응답수}명</td>
      <td><span class="achv-badge" style="${npsColor(s.NPS평균)}">${s.NPS평균}</span></td>
      <td><span class="achv-badge" style="${scoreColor(s.강사만족도평균)}">${s.강사만족도평균 || "-"}</span></td>
      <td><span class="achv-badge" style="${scoreColor(s.중간만족도평균)}">${s.중간만족도평균 || "-"}</span></td>
      <td><span class="achv-badge" style="${scoreColor(s.최종만족도평균)}">${s.최종만족도평균 || "-"}</span></td>
    </tr>`,
    )
    .join("");

  // 행 클릭 → 모듈별 상세
  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-sat-idx]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const idx = Number(tr.getAttribute("data-sat-idx"));
      if (summaries[idx]) showModuleDetail(summaries[idx]);
    });
  });
}

// ─── 모듈별 상세 펼침 ──────────────────────────────────────
function showModuleDetail(summary: SatisfactionSummary): void {
  const detailEl = $("satisfactionDetail");
  const titleEl = $("satDetailTitle");
  const bodyEl = $("satDetailBody");
  if (!detailEl || !titleEl || !bodyEl) return;

  titleEl.textContent = `${summary.과정명} ${summary.기수} — 모듈별 NPS`;
  detailEl.style.display = "";

  if (summary.모듈별.length === 0) {
    bodyEl.innerHTML = '<p class="muted">모듈별 데이터 없음</p>';
    return;
  }

  const sorted = [...summary.모듈별].sort((a, b) => b.NPS평균 - a.NPS평균);
  bodyEl.innerHTML = `
    <div style="overflow-x:auto">
      <table class="hrd-table" style="font-size:13px">
        <thead><tr><th>모듈명</th><th>NPS 평균</th><th>응답수</th></tr></thead>
        <tbody>
          ${sorted
            .map(
              (m) => `
            <tr>
              <td>${esc(m.모듈명)}</td>
              <td><span class="achv-badge" style="${npsColor(m.NPS평균)}">${m.NPS평균}</span></td>
              <td>${m.응답수}명</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

// ─── 필터 ───────────────────────────────────────────────────
function populateFilters(records: SatisfactionRecord[]): void {
  const { courses, cohorts } = extractSatisfactionFilters(records);
  const courseSelect = $("satFilterCourse") as HTMLSelectElement | null;
  const cohortSelect = $("satFilterCohort") as HTMLSelectElement | null;
  const filtersEl = $("satisfactionFilters");

  if (courseSelect) {
    courseSelect.innerHTML =
      '<option value="">전체 과정</option>' + courses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  if (cohortSelect) {
    cohortSelect.innerHTML =
      '<option value="">전체 기수</option>' + cohorts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  if (filtersEl) filtersEl.style.display = "";
}

function applyFilterAndRender(): void {
  const courseVal = ($("satFilterCourse") as HTMLSelectElement)?.value ?? "";
  const cohortVal = ($("satFilterCohort") as HTMLSelectElement)?.value ?? "";
  const summaries = summarizeByCohort(allRecords, courseVal, cohortVal);
  renderTable(summaries);
  const detailEl = $("satisfactionDetail");
  if (detailEl) detailEl.style.display = "none";
}

// ─── 설정 탭 초기화 ────────────────────────────────────────
function initSettingsSatisfaction(): void {
  const urlInput = $("settingsSatisfactionUrl") as HTMLInputElement | null;
  if (urlInput && currentConfig.webAppUrl) urlInput.value = currentConfig.webAppUrl;

  $("settingsSatisfactionTestBtn")?.addEventListener("click", async () => {
    const url = (urlInput?.value ?? "").trim();
    const statusEl = $("settingsSatisfactionTestStatus");
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
    const result = await testSatisfactionConnection({ webAppUrl: url });
    if (statusEl) {
      statusEl.textContent = result.message;
      statusEl.className = `settings-status-msg ${result.ok ? "success" : "error"}`;
    }
  });

  $("settingsSatisfactionSave")?.addEventListener("click", () => {
    const url = (urlInput?.value ?? "").trim();
    currentConfig = { webAppUrl: url };
    saveSatisfactionConfig(currentConfig);
    const statusEl = $("settingsSatisfactionTestStatus");
    if (statusEl) {
      statusEl.textContent = "저장됨 ✓";
      statusEl.className = "settings-status-msg success";
    }
    updateConfigNotice();
  });
}

function updateConfigNotice(): void {
  const noticeEl = $("satisfactionConfigNotice");
  if (!noticeEl) return;
  noticeEl.style.display = currentConfig.webAppUrl ? "none" : "";
}

// ─── 캐시 자동 복원 ────────────────────────────────────────
function restoreFromCache(): void {
  const cached = loadSatisfactionCache();
  if (!cached || cached.length === 0) return;
  allRecords = cached;
  populateFilters(allRecords);
  const stats = calcSatisfactionStats(allRecords);
  renderStats(stats);
  applyFilterAndRender();
  const ts = getSatisfactionCacheTimestamp();
  const age = ts ? ` · ${formatCacheAge(ts)}` : "";
  setStatus(`${allRecords.length}건 (캐시${age})`, "success");
}

// ─── 수기 입력 로직 ──────────────────────────────────────────
const SAT_LOCAL_KEY = "kdt_satisfaction_manual_v1";

function loadManualRecords(): SatisfactionRecord[] {
  try {
    const raw = localStorage.getItem(SAT_LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveManualRecords(records: SatisfactionRecord[]): void {
  localStorage.setItem(SAT_LOCAL_KEY, JSON.stringify(records));
}

function populateCourseDatalist(): void {
  const datalist = $("satCourseList");
  if (!datalist) return;

  // 기존 데이터 + HRD 과정 목록에서 추출
  const courses = new Set<string>();
  allRecords.forEach((r) => { if (r.과정명) courses.add(r.과정명); });

  try {
    const stored = localStorage.getItem("academic_schedule_manager_hrd_config_v1");
    if (stored) {
      const config = JSON.parse(stored);
      config.courses?.forEach((c: { name: string }) => { if (c.name) courses.add(c.name); });
    }
  } catch { /* no config */ }

  datalist.innerHTML = [...courses].sort().map((c) => `<option value="${esc(c)}">`).join("");
}

function initSatInput(): void {
  const formEl = $("satInputForm");
  const bodyEl = $("satInputBody");
  let isOpen = false;

  // 입력 버튼 토글
  $("satShowInputBtn")?.addEventListener("click", () => {
    isOpen = !isOpen;
    if (formEl) formEl.style.display = isOpen ? "" : "none";
    if (isOpen) populateCourseDatalist();
  });

  // 접기 버튼
  $("satInputToggleBtn")?.addEventListener("click", () => {
    if (bodyEl) bodyEl.style.display = bodyEl.style.display === "none" ? "" : "none";
    const btn = $("satInputToggleBtn");
    if (btn) btn.textContent = bodyEl?.style.display === "none" ? "펼치기" : "접기";
  });

  // 추가 버튼
  $("satInputAddBtn")?.addEventListener("click", () => {
    const courseSelect = $("satInputCourse") as HTMLInputElement | null;
    const cohortInput = $("satInputCohort") as HTMLInputElement | null;
    const moduleInput = $("satInputModule") as HTMLInputElement | null;
    const npsInput = $("satInputNps") as HTMLInputElement | null;
    const teacherInput = $("satInputTeacher") as HTMLInputElement | null;
    const midInput = $("satInputMid") as HTMLInputElement | null;
    const finalInput = $("satInputFinal") as HTMLInputElement | null;
    const statusEl = $("satInputStatus");

    const course = courseSelect?.value ?? "";
    const cohort = cohortInput?.value?.trim() ?? "";
    const module = moduleInput?.value?.trim() ?? "";
    const nps = Number(npsInput?.value) || 0;

    if (!course || !cohort || !module) {
      if (statusEl) { statusEl.textContent = "과정, 기수, 모듈명은 필수입니다."; statusEl.style.color = "var(--text-danger, #ef4444)"; }
      return;
    }

    const record: SatisfactionRecord = {
      과정명: course,
      기수: cohort,
      모듈명: module,
      NPS: nps,
      강사만족도: Number(teacherInput?.value) || 0,
      중간만족도: Number(midInput?.value) || 0,
      최종만족도: Number(finalInput?.value) || 0,
    };

    // 로컬 저장
    const manual = loadManualRecords();
    manual.push(record);
    saveManualRecords(manual);

    // 현재 데이터에도 추가
    allRecords.push(record);
    populateFilters(allRecords);
    const stats = calcSatisfactionStats(allRecords);
    renderStats(stats);
    applyFilterAndRender();
    setStatus(`${allRecords.length}건 (${manual.length}건 수기 입력 포함)`, "success");

    // 입력 필드 초기화 (과정/기수는 유지)
    if (moduleInput) moduleInput.value = "";
    if (npsInput) npsInput.value = "";
    if (teacherInput) teacherInput.value = "";
    if (midInput) midInput.value = "";
    if (finalInput) finalInput.value = "";
    if (statusEl) { statusEl.textContent = `✓ "${module}" 추가됨`; statusEl.style.color = "var(--text-success, #22c55e)"; }
  });
}

// ─── 초기화 ─────────────────────────────────────────────────
export function initSatisfaction(): void {
  currentConfig = loadSatisfactionConfig();
  initSettingsSatisfaction();
  updateConfigNotice();
  initSatInput();

  $("satFilterCourse")?.addEventListener("change", applyFilterAndRender);
  $("satFilterCohort")?.addEventListener("change", applyFilterAndRender);

  // 필터 초기화
  $("satFilterReset")?.addEventListener("click", () => {
    for (const id of ["satFilterCourse", "satFilterCohort"]) {
      const el = $(id) as HTMLSelectElement | null;
      if (el) el.selectedIndex = 0;
    }
    applyFilterAndRender();
  });

  // 캐시 자동 복원 + 수기 입력 데이터 병합
  restoreFromCache();
  const manual = loadManualRecords();
  if (manual.length > 0) {
    allRecords = [...allRecords, ...manual];
    if (allRecords.length > 0) {
      populateFilters(allRecords);
      const stats = calcSatisfactionStats(allRecords);
      renderStats(stats);
      applyFilterAndRender();
      setStatus(`${allRecords.length}건 (${manual.length}건 수기 포함)`, "success");
    }
  }

  // 조회
  $("satisfactionFetchBtn")?.addEventListener("click", async () => {
    currentConfig = loadSatisfactionConfig();
    if (!currentConfig.webAppUrl) {
      setStatus("설정 → API 연동에서 Apps Script URL을 입력해주세요.", "error");
      return;
    }
    setStatus("데이터 로딩 중...", "loading");
    try {
      const fetched = await fetchSatisfactionRecords(currentConfig);
      const manual = loadManualRecords();
      allRecords = [...fetched, ...manual];
      populateFilters(allRecords);
      const stats = calcSatisfactionStats(allRecords);
      renderStats(stats);
      applyFilterAndRender();
      setStatus(`${allRecords.length}건 로드 완료 (${manual.length}건 수기 포함)`, "success");
    } catch (e) {
      setStatus(classifyApiError(e), "error");
    }
  });
}
