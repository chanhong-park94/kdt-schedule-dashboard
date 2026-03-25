/**
 * 만족도 대시보드
 *
 * 스키마 구글시트 "만족도" 탭의 수기 취합 데이터를
 * Apps Script Web App을 통해 조회/표시합니다.
 */
import type { SatisfactionRecord, SatisfactionStats, SatisfactionSummary } from "./hrdSatisfactionTypes";
import {
  calcSatisfactionStats,
  summarizeByCohort,
  extractSatisfactionFilters,
} from "./hrdSatisfactionApi";

// ─── DOM 헬퍼 ───────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

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
  const count = $("satRecordCount");
  if (!tbody) return;

  if (summaries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">📝 데이터 입력 버튼을 눌러 만족도를 입력해주세요.</td></tr>';
    if (count) count.textContent = "";
    return;
  }

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

// ─── 수기 데이터 즉시 로드 (대시보드 표시) ──────────────────
function loadAndRenderManualData(): void {
  allRecords = loadManualRecords();
  if (allRecords.length > 0) {
    populateFilters(allRecords);
    const stats = calcSatisfactionStats(allRecords);
    renderStats(stats);
    applyFilterAndRender();
    setStatus(`${allRecords.length}건 입력됨`, "success");
  } else {
    applyFilterAndRender(); // 빈 테이블 안내 표시
  }
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

let moduleRows: string[] = [];
let projectRows: string[] = [];

function buildCourseOptions(): CourseOption[] {
  const options: CourseOption[] = [];
  try {
    const stored = localStorage.getItem("academic_schedule_manager_hrd_config_v1");
    if (stored) {
      const config = JSON.parse(stored);
      for (const c of config.courses || []) {
        for (const d of c.degrs || []) {
          options.push({ label: `${c.name} ${d}기`, courseName: c.name, degr: d, category: c.category || "실업자" });
        }
      }
    }
  } catch { /* */ }
  return options;
}

function getSelectedCourseOpt(): CourseOption | null {
  const select = $("satMatrixCourse") as HTMLSelectElement | null;
  if (!select?.value) return null;
  try { return JSON.parse(select.value) as CourseOption; } catch { return null; }
}

/** 섹션별 테이블 렌더링 공통 */
function renderSectionTable(
  container: HTMLElement,
  rows: string[],
  colHeaders: string[],
  colKeys: string[],
  existingMap: Map<string, SatisfactionRecord>,
  prefix: string,
): void {
  const tableRows = rows
    .map((label, i) => {
      const r = existingMap.get(label);
      const cells = colKeys
        .map((key) => {
          const val = r ? (r as unknown as Record<string, number>)[key] : "";
          return `<td><input class="sat-input sat-mx-val sat-mx-${key}" data-row="${i}" type="number" step="0.1" placeholder="-" value="${val || ""}" /></td>`;
        })
        .join("");
      return `<tr>
        <td class="sat-mx-label-cell"><input class="sat-input sat-mx-label" data-row="${i}" value="${esc(label)}" /></td>
        ${cells}
        <td class="sat-mx-del-cell"><button class="sat-mx-del" data-row="${i}" data-prefix="${prefix}" type="button" title="삭제">✕</button></td>
      </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table class="sat-matrix-table">
      <thead><tr><th class="sat-th-label">${prefix === "module" ? "모듈" : "프로젝트"}</th>${colHeaders.map((h) => `<th>${h}</th>`).join("")}<th></th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;

  // 삭제 핸들러
  container.querySelectorAll<HTMLButtonElement>(".sat-mx-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.row);
      const p = btn.dataset.prefix;
      if (p === "module") { moduleRows.splice(idx, 1); } else { projectRows.splice(idx, 1); }
      renderAllSections();
    });
  });
}

function renderAllSections(): void {
  const opt = getSelectedCourseOpt();
  const moduleContainer = $("satModuleContainer");
  const projectSection = $("satProjectSection");
  const projectContainer = $("satProjectContainer");
  const moduleSectionLabel = $("satModuleSectionLabel");

  if (!opt || !moduleContainer) {
    if (moduleContainer) moduleContainer.innerHTML = '<p class="muted">과정·기수를 선택해주세요.</p>';
    if (projectSection) projectSection.style.display = "none";
    return;
  }

  const manual = loadManualRecords();
  const courseRecords = manual.filter((r) => r.과정명 === opt.courseName && r.기수 === opt.degr);

  const isEmployed = opt.category === "재직자";

  // ── 모듈/프로젝트별 (과정NPS + 강사만족도) ──
  if (isEmployed) {
    // 재직자: 프로젝트1~4
    if (moduleSectionLabel) moduleSectionLabel.textContent = "프로젝트별 만족도 (과정 NPS + 강사만족도)";
    const existing = courseRecords.filter((r) => r.모듈명.startsWith("프로젝트") && !r.모듈명.includes("(퍼실)"));
    const existingMap = new Map(existing.map((r) => [r.모듈명, r]));
    if (moduleRows.length === 0) {
      moduleRows = existing.length > 0 ? existing.map((r) => r.모듈명) : ["프로젝트1", "프로젝트2", "프로젝트3", "프로젝트4"];
    }
    renderSectionTable(moduleContainer, moduleRows, ["과정 NPS", "강사만족도"], ["NPS", "강사만족도"], existingMap, "module");
    if (projectSection) projectSection.style.display = "none";
  } else {
    // 실업자: 모듈1~12 (과정NPS + 강사만족도)
    if (moduleSectionLabel) moduleSectionLabel.textContent = "모듈별 만족도 (과정 NPS + 강사만족도)";
    const existing = courseRecords.filter((r) => r.모듈명.startsWith("모듈"));
    const existingMap = new Map(existing.map((r) => [r.모듈명, r]));
    if (moduleRows.length === 0) {
      moduleRows = existing.length > 0 ? existing.map((r) => r.모듈명) : Array.from({ length: 12 }, (_, i) => `모듈${i + 1}`);
    }
    renderSectionTable(moduleContainer, moduleRows, ["과정 NPS", "강사만족도"], ["NPS", "강사만족도"], existingMap, "module");

    // 실업자 프로젝트 (과정NPS + 퍼실NPS)
    if (projectSection && projectContainer) {
      projectSection.style.display = "";
      const projExisting = courseRecords.filter((r) => r.모듈명.includes("(퍼실)") || (r.모듈명.startsWith("프로젝트") && !r.모듈명.startsWith("모듈")));
      const projMap = new Map(projExisting.map((r) => [r.모듈명.replace(" (퍼실)", ""), r]));
      if (projectRows.length === 0) {
        projectRows = projExisting.length > 0
          ? projExisting.map((r) => r.모듈명.replace(" (퍼실)", ""))
          : ["프로젝트"];
      }
      renderSectionTable(projectContainer, projectRows, ["과정 NPS", "퍼실 NPS"], ["NPS", "강사만족도"], projMap, "project");
    }
  }

  // HRD 만족도 기존값 로드
  const hrdRecord = courseRecords.find((r) => r.모듈명 === "HRD만족도");
  const midInput = $("satHrdMid") as HTMLInputElement | null;
  const finalInput = $("satHrdFinal") as HTMLInputElement | null;
  if (midInput) midInput.value = hrdRecord?.중간만족도 ? String(hrdRecord.중간만족도) : "";
  if (finalInput) finalInput.value = hrdRecord?.최종만족도 ? String(hrdRecord.최종만족도) : "";
}

function collectAndSave(): void {
  const opt = getSelectedCourseOpt();
  const statusEl = $("satInputStatus");
  if (!opt) {
    if (statusEl) { statusEl.textContent = "과정·기수를 선택해주세요."; statusEl.className = "sat-status-msg error"; }
    return;
  }

  const newRecords: SatisfactionRecord[] = [];

  // HRD 만족도
  const midVal = Number(($("satHrdMid") as HTMLInputElement)?.value) || 0;
  const finalVal = Number(($("satHrdFinal") as HTMLInputElement)?.value) || 0;
  if (midVal || finalVal) {
    newRecords.push({ 과정명: opt.courseName, 기수: opt.degr, 모듈명: "HRD만족도", NPS: 0, 강사만족도: 0, 중간만족도: midVal, 최종만족도: finalVal });
  }

  // 모듈/프로젝트 (과정NPS + 강사만족도)
  const moduleContainer = $("satModuleContainer");
  if (moduleContainer) {
    moduleContainer.querySelectorAll<HTMLInputElement>(".sat-mx-label").forEach((labelInput) => {
      const i = labelInput.dataset.row!;
      const label = labelInput.value.trim();
      if (!label) return;
      const nps = Number(moduleContainer.querySelector<HTMLInputElement>(`.sat-mx-NPS[data-row="${i}"]`)?.value) || 0;
      const teacher = Number(moduleContainer.querySelector<HTMLInputElement>(`.sat-mx-강사만족도[data-row="${i}"]`)?.value) || 0;
      if (nps || teacher) {
        newRecords.push({ 과정명: opt.courseName, 기수: opt.degr, 모듈명: label, NPS: nps, 강사만족도: teacher, 중간만족도: 0, 최종만족도: 0 });
      }
    });
  }

  // 실업자 프로젝트 (과정NPS + 퍼실NPS)
  const projectContainer = $("satProjectContainer");
  if (projectContainer && opt.category !== "재직자") {
    projectContainer.querySelectorAll<HTMLInputElement>(".sat-mx-label").forEach((labelInput) => {
      const i = labelInput.dataset.row!;
      const label = labelInput.value.trim();
      if (!label) return;
      const nps = Number(projectContainer.querySelector<HTMLInputElement>(`.sat-mx-NPS[data-row="${i}"]`)?.value) || 0;
      const facil = Number(projectContainer.querySelector<HTMLInputElement>(`.sat-mx-강사만족도[data-row="${i}"]`)?.value) || 0;
      if (nps || facil) {
        newRecords.push({ 과정명: opt.courseName, 기수: opt.degr, 모듈명: `${label} (퍼실)`, NPS: nps, 강사만족도: facil, 중간만족도: 0, 최종만족도: 0 });
      }
    });
  }

  // 저장: 해당 과정·기수 기존 수기 데이터 교체
  let manual = loadManualRecords();
  manual = manual.filter((r) => !(r.과정명 === opt.courseName && r.기수 === opt.degr));
  manual.push(...newRecords);
  saveManualRecords(manual);

  // 대시보드 갱신
  loadAndRenderManualData();

  if (statusEl) {
    statusEl.textContent = `✓ ${opt.label} — ${newRecords.length}건 저장 완료`;
    statusEl.className = "sat-status-msg success";
  }
}

function initSatInput(): void {
  const formEl = $("satInputForm");
  const bodyEl = $("satInputBody");
  let isOpen = false;

  function populateCourseSelect(): void {
    const select = $("satMatrixCourse") as HTMLSelectElement | null;
    if (!select) return;
    const options = buildCourseOptions();
    select.innerHTML =
      '<option value="">과정·기수 선택</option>' +
      options.map((o) => `<option value='${esc(JSON.stringify(o))}'>${esc(o.label)}</option>`).join("");
  }

  $("satShowInputBtn")?.addEventListener("click", () => {
    isOpen = !isOpen;
    if (formEl) formEl.style.display = isOpen ? "" : "none";
    if (isOpen) populateCourseSelect();
  });

  $("satInputToggleBtn")?.addEventListener("click", () => {
    if (bodyEl) bodyEl.style.display = bodyEl.style.display === "none" ? "" : "none";
    const btn = $("satInputToggleBtn");
    if (btn) btn.textContent = bodyEl?.style.display === "none" ? "펼치기" : "접기";
  });

  $("satMatrixCourse")?.addEventListener("change", () => {
    moduleRows = [];
    projectRows = [];
    renderAllSections();
  });

  $("satModuleAddBtn")?.addEventListener("click", () => {
    const opt = getSelectedCourseOpt();
    if (!opt) return;
    const prefix = opt.category === "재직자" ? "프로젝트" : "모듈";
    moduleRows.push(`${prefix}${moduleRows.length + 1}`);
    renderAllSections();
  });

  $("satProjectAddBtn")?.addEventListener("click", () => {
    projectRows.push(`프로젝트${projectRows.length + 1}`);
    renderAllSections();
  });

  $("satMatrixResetBtn")?.addEventListener("click", () => {
    if (!confirm("입력한 내용을 초기화하시겠습니까?")) return;
    moduleRows = [];
    projectRows = [];
    renderAllSections();
  });

  $("satMatrixSaveBtn")?.addEventListener("click", collectAndSave);
}

// ─── 초기화 ─────────────────────────────────────────────────
export function initSatisfaction(): void {
  initSatInput();

  $("satFilterCourse")?.addEventListener("change", applyFilterAndRender);
  $("satFilterCohort")?.addEventListener("change", applyFilterAndRender);

  $("satFilterReset")?.addEventListener("click", () => {
    for (const id of ["satFilterCourse", "satFilterCohort"]) {
      const el = $(id) as HTMLSelectElement | null;
      if (el) el.selectedIndex = 0;
    }
    applyFilterAndRender();
  });

  // 수기입력 데이터 즉시 로드 → 대시보드 표시
  loadAndRenderManualData();
}
