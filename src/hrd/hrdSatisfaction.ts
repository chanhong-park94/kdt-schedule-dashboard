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

// ─── 매트릭스 폼 ────────────────────────────────────────────

interface CourseOption {
  label: string;
  courseName: string;
  degr: string;
  category: string;
}

let matrixSatType: "course" | "facil" = "course";
let matrixRows: string[] = [];

function buildCourseOptions(): CourseOption[] {
  const options: CourseOption[] = [];
  try {
    const stored = localStorage.getItem("academic_schedule_manager_hrd_config_v1");
    if (stored) {
      const config = JSON.parse(stored);
      for (const c of config.courses || []) {
        for (const d of c.degrs || []) {
          options.push({
            label: `${c.name} ${d}기`,
            courseName: c.name,
            degr: d,
            category: c.category || "실업자",
          });
        }
      }
    }
  } catch { /* */ }
  return options;
}

function getDefaultRows(category: string): string[] {
  if (category === "재직자") {
    return ["프로젝트1", "프로젝트2", "프로젝트3", "프로젝트4"];
  }
  return Array.from({ length: 12 }, (_, i) => `모듈${i + 1}`);
}

function getTypeSuffix(): string {
  return matrixSatType === "course" ? "(과정만족도)" : "(퍼실만족도)";
}

function renderMatrixTable(): void {
  const container = $("satMatrixContainer");
  if (!container) return;

  const select = $("satMatrixCourse") as HTMLSelectElement | null;
  if (!select || !select.value) {
    container.innerHTML = '<p class="muted">과정·기수를 선택해주세요.</p>';
    return;
  }

  const opt = JSON.parse(select.value) as CourseOption;
  const suffix = getTypeSuffix();

  // 기존 저장 데이터 로드
  const manual = loadManualRecords();
  const existing = manual.filter(
    (r) => r.과정명 === opt.courseName && r.기수 === opt.degr && r.모듈명.endsWith(suffix),
  );
  const existingMap = new Map(existing.map((r) => [r.모듈명.replace(` ${suffix}`, ""), r]));

  // 저장된 행이 있으면 그 행 목록 사용, 없으면 기본값
  if (existing.length > 0 && matrixRows.length === 0) {
    matrixRows = existing.map((r) => r.모듈명.replace(` ${suffix}`, ""));
  } else if (matrixRows.length === 0) {
    matrixRows = getDefaultRows(opt.category);
  }

  const rows = matrixRows
    .map(
      (label, i) => {
        const r = existingMap.get(label);
        return `<tr>
          <td>
            <input class="sat-mx-label hrd-input" data-row="${i}" value="${esc(label)}" style="width:100%;min-width:80px" />
          </td>
          <td><input class="sat-mx-nps hrd-input" data-row="${i}" type="number" min="-100" max="100" value="${r?.NPS ?? ""}" style="width:70px" /></td>
          <td><input class="sat-mx-teacher hrd-input" data-row="${i}" type="number" min="0" max="5" step="0.1" value="${r?.강사만족도 || ""}" style="width:70px" /></td>
          <td><input class="sat-mx-hrd hrd-input" data-row="${i}" type="number" min="0" max="5" step="0.1" value="${r?.최종만족도 || ""}" style="width:70px" /></td>
          <td><button class="btn btn--sm sat-mx-del" data-row="${i}" type="button" style="color:var(--text-danger,#ef4444);padding:2px 6px">✕</button></td>
        </tr>`;
      },
    )
    .join("");

  container.innerHTML = `
    <table class="sat-matrix-table">
      <thead>
        <tr>
          <th>${opt.category === "재직자" ? "프로젝트" : "모듈"}</th>
          <th>NPS</th>
          <th>강사만족도</th>
          <th>HRD만족도</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // 삭제 버튼
  container.querySelectorAll<HTMLButtonElement>(".sat-mx-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.row);
      matrixRows.splice(idx, 1);
      renderMatrixTable();
    });
  });
}

function saveMatrixData(): void {
  const select = $("satMatrixCourse") as HTMLSelectElement | null;
  const statusEl = $("satInputStatus");
  if (!select?.value) return;

  const opt = JSON.parse(select.value) as CourseOption;
  const suffix = getTypeSuffix();
  const container = $("satMatrixContainer");
  if (!container) return;

  const newRecords: SatisfactionRecord[] = [];
  const labelInputs = container.querySelectorAll<HTMLInputElement>(".sat-mx-label");

  labelInputs.forEach((labelInput) => {
    const i = labelInput.dataset.row!;
    const label = labelInput.value.trim();
    if (!label) return;

    const nps = Number(container.querySelector<HTMLInputElement>(`.sat-mx-nps[data-row="${i}"]`)?.value) || 0;
    const teacher = Number(container.querySelector<HTMLInputElement>(`.sat-mx-teacher[data-row="${i}"]`)?.value) || 0;
    const hrd = Number(container.querySelector<HTMLInputElement>(`.sat-mx-hrd[data-row="${i}"]`)?.value) || 0;

    // NPS/강사/HRD 중 하나라도 입력된 행만 저장
    if (nps || teacher || hrd) {
      newRecords.push({
        과정명: opt.courseName,
        기수: opt.degr,
        모듈명: `${label} ${suffix}`,
        NPS: nps,
        강사만족도: teacher,
        중간만족도: 0,
        최종만족도: hrd,
      });
    }
  });

  // 기존 manual에서 해당 과정·기수·유형 제거 후 새 데이터 추가
  let manual = loadManualRecords();
  manual = manual.filter(
    (r) => !(r.과정명 === opt.courseName && r.기수 === opt.degr && r.모듈명.endsWith(suffix)),
  );
  manual.push(...newRecords);
  saveManualRecords(manual);

  // allRecords 갱신
  allRecords = allRecords.filter(
    (r) => !(r.과정명 === opt.courseName && r.기수 === opt.degr && r.모듈명.endsWith(suffix)),
  );
  allRecords.push(...newRecords);
  populateFilters(allRecords);
  const stats = calcSatisfactionStats(allRecords);
  renderStats(stats);
  applyFilterAndRender();

  const totalManual = loadManualRecords().length;
  setStatus(`${allRecords.length}건 (${totalManual}건 수기 포함)`, "success");
  if (statusEl) {
    statusEl.textContent = `✓ ${opt.label} ${matrixSatType === "course" ? "과정" : "퍼실"}만족도 ${newRecords.length}건 저장`;
    statusEl.style.color = "var(--text-success, #22c55e)";
  }
}

function initSatInput(): void {
  const formEl = $("satInputForm");
  const bodyEl = $("satInputBody");
  let isOpen = false;

  // 과정 드롭다운 채우기
  function populateCourseSelect(): void {
    const select = $("satMatrixCourse") as HTMLSelectElement | null;
    if (!select) return;
    const options = buildCourseOptions();
    select.innerHTML =
      '<option value="">과정·기수 선택</option>' +
      options.map((o) => `<option value='${esc(JSON.stringify(o))}'>${esc(o.label)}</option>`).join("");
  }

  // 입력 버튼 토글
  $("satShowInputBtn")?.addEventListener("click", () => {
    isOpen = !isOpen;
    if (formEl) formEl.style.display = isOpen ? "" : "none";
    if (isOpen) populateCourseSelect();
  });

  // 접기
  $("satInputToggleBtn")?.addEventListener("click", () => {
    if (bodyEl) bodyEl.style.display = bodyEl.style.display === "none" ? "" : "none";
    const btn = $("satInputToggleBtn");
    if (btn) btn.textContent = bodyEl?.style.display === "none" ? "펼치기" : "접기";
  });

  // 과정 선택 변경
  $("satMatrixCourse")?.addEventListener("change", () => {
    matrixRows = []; // 초기화해서 기본값 또는 저장된 값으로 로드
    renderMatrixTable();
  });

  // 만족도 유형 탭
  document.querySelectorAll<HTMLButtonElement>("[data-sat-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      matrixSatType = (btn.dataset.satType as "course" | "facil") ?? "course";
      document.querySelectorAll("[data-sat-type]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      matrixRows = []; // 유형 전환 시 행 초기화
      renderMatrixTable();
    });
  });

  // 행 추가
  $("satMatrixAddRowBtn")?.addEventListener("click", () => {
    const select = $("satMatrixCourse") as HTMLSelectElement | null;
    if (!select?.value) return;
    const opt = JSON.parse(select.value) as CourseOption;
    const prefix = opt.category === "재직자" ? "프로젝트" : "모듈";
    matrixRows.push(`${prefix}${matrixRows.length + 1}`);
    renderMatrixTable();
  });

  // 초기화
  $("satMatrixResetBtn")?.addEventListener("click", () => {
    const select = $("satMatrixCourse") as HTMLSelectElement | null;
    if (!select?.value) return;
    const opt = JSON.parse(select.value) as CourseOption;
    matrixRows = getDefaultRows(opt.category);
    renderMatrixTable();
  });

  // 일괄 저장
  $("satMatrixSaveBtn")?.addEventListener("click", saveMatrixData);
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
