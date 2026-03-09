import { domRefs } from "../domRefs";
import { appState } from "../appState";
import { type ConflictTab } from "../appState";
import { createClickableCell, createTableElement, setRenderNotice } from "../utils/dom";
import { downloadCsvFile, toDayConflictRow, getOverlapRangeLabel } from "../utils/csv";
import { getTodayCompactDate, isDateInsideRange } from "../utils/date";
import { getConflictTabLabel } from "../utils/format";
import { type ResourceType, type StaffOverlap } from "../../core/types";

// ---------------------------------------------------------------------------
// Exported constants (also used by main.ts for print report and staffing UI)
// ---------------------------------------------------------------------------

export const CONFLICT_COLUMNS = [
  "기준",
  "일자",
  "키",
  "과정A",
  "A시간",
  "A교과목",
  "과정B",
  "B시간",
  "B교과목"
] as const;

export const DAY_CONFLICT_COLUMNS = [
  "담당자",
  "리소스타입",
  "과정A",
  "모듈A",
  "시작A",
  "종료A",
  "과정B",
  "모듈B",
  "시작B",
  "종료B",
  "겹침일수(정책반영)"
] as const;

export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  INSTRUCTOR: "강사",
  FACILITATOR: "퍼실",
  OPERATION: "운영"
};

// Private to this module
const TABLE_RENDER_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Dependency injection — provided by main.ts via initConflictsFeature()
// ---------------------------------------------------------------------------

let _highlightGanttByCohortModule: (cohort: string, module?: string) => void = () => {};
let _updateActionStates: () => void = () => {};
let _scheduleAutoSave: () => void = () => {};

export function initConflictsFeature(deps: {
  highlightGanttByCohortModule: (cohort: string, module?: string) => void;
  updateActionStates: () => void;
  scheduleAutoSave: () => void;
}): void {
  _highlightGanttByCohortModule = deps.highlightGanttByCohortModule;
  _updateActionStates = deps.updateActionStates;
  _scheduleAutoSave = deps.scheduleAutoSave;
}

// ---------------------------------------------------------------------------
// Conflict tab switching
// ---------------------------------------------------------------------------

export function setConflictTab(tab: ConflictTab): void {
  appState.activeConflictTab = tab;

  const isTime = tab === "time";
  const isInstructorDay = tab === "instructor_day";

  domRefs.tabTimeConflicts.classList.toggle("active", isTime);
  domRefs.tabInstructorDayConflicts.classList.toggle("active", isInstructorDay);
  domRefs.tabFoDayConflicts.classList.toggle("active", tab === "fo_day");

  domRefs.timeConflictPanel.style.display = isTime ? "block" : "none";
  domRefs.instructorDayConflictPanel.style.display = isInstructorDay ? "block" : "none";
  domRefs.foDayConflictPanel.style.display = tab === "fo_day" ? "block" : "none";
  _scheduleAutoSave();
}

// ---------------------------------------------------------------------------
// Time conflict table rendering
// ---------------------------------------------------------------------------

export function renderTimeConflicts(): void {
  domRefs.confTableBody.innerHTML = "";

  if (!appState.hasComputedConflicts) {
    domRefs.confCount.textContent = "계산 대기";
    domRefs.confRenderNotice.textContent = "";
    return;
  }

  domRefs.confCount.textContent = `총 ${appState.visibleConflicts.length}건`;

  const preview = appState.visibleConflicts.slice(0, TABLE_RENDER_LIMIT);
  setRenderNotice(domRefs.confRenderNotice, appState.visibleConflicts.length, preview.length);

  for (const conflict of preview) {
    const tr = document.createElement("tr");
    tr.title = `동일 키(${conflict.키}), ${conflict.일자} 시간구간 겹침`;
    const columns = [
      conflict.기준,
      conflict.일자,
      conflict.키,
      conflict.과정A,
      conflict.A시간,
      conflict.A교과목,
      conflict.과정B,
      conflict.B시간,
      conflict.B교과목
    ];

    for (const [index, value] of columns.entries()) {
      if (index === 3) {
        tr.appendChild(createClickableCell(value, () => _highlightGanttByCohortModule(conflict.과정A)));
        continue;
      }
      if (index === 6) {
        tr.appendChild(createClickableCell(value, () => _highlightGanttByCohortModule(conflict.과정B)));
        continue;
      }

      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    domRefs.confTableBody.appendChild(tr);
  }
}

export function applyConflictFilters(): void {
  if (!appState.hasComputedConflicts) {
    appState.visibleConflicts = [];
    renderTimeConflicts();
    _updateActionStates();
    return;
  }

  const keyQuery = domRefs.keySearchInput.value.trim().toLowerCase();

  appState.visibleConflicts = appState.allConflicts
    .filter((conflict) => (keyQuery.length === 0 ? true : conflict.키.toLowerCase().includes(keyQuery)))
    .sort(
      (a, b) =>
        a.일자.localeCompare(b.일자) ||
        a.기준.localeCompare(b.기준) ||
        a.키.localeCompare(b.키) ||
        a.과정A.localeCompare(b.과정A)
    );

  renderTimeConflicts();
  _updateActionStates();
}

export function resetConflictsBeforeCompute(): void {
  appState.allConflicts = [];
  appState.visibleConflicts = [];
  appState.hasComputedConflicts = false;

  domRefs.keySearchInput.value = "";
  renderTimeConflicts();
  _updateActionStates();
}

// ---------------------------------------------------------------------------
// CSV downloads
// ---------------------------------------------------------------------------

export function downloadVisibleTimeConflictsCsv(): void {
  if (appState.visibleConflicts.length === 0) {
    return;
  }

  const rows = appState.visibleConflicts.map((conflict) => [
    conflict.기준,
    conflict.일자,
    conflict.키,
    conflict.과정A,
    conflict.A시간,
    conflict.A교과목,
    conflict.과정B,
    conflict.B시간,
    conflict.B교과목
  ]);

  downloadCsvFile(`conflicts_instructor_time_${getTodayCompactDate()}.csv`, CONFLICT_COLUMNS, rows);
}

export function downloadVisibleInstructorDayConflictsCsv(): void {
  if (appState.visibleInstructorDayOverlaps.length === 0) {
    return;
  }

  const rows = appState.visibleInstructorDayOverlaps.map((overlap) => toDayConflictRow(overlap));
  downloadCsvFile(`conflicts_instructor_day_${getTodayCompactDate()}.csv`, DAY_CONFLICT_COLUMNS, rows);
}

export function downloadVisibleFoDayConflictsCsv(): void {
  if (appState.visibleFoDayOverlaps.length === 0) {
    return;
  }

  const rows = appState.visibleFoDayOverlaps.map((overlap) => toDayConflictRow(overlap));
  downloadCsvFile(`conflicts_facil_ops_day_${getTodayCompactDate()}.csv`, DAY_CONFLICT_COLUMNS, rows);
}

// ---------------------------------------------------------------------------
// Conflict detail modal
// ---------------------------------------------------------------------------

export function renderConflictDetailModalContent(): void {
  domRefs.conflictDetailContent.innerHTML = "";
  domRefs.conflictDetailTitle.textContent = "충돌 상세";

  const sections: Array<{ label: string; columns: readonly string[]; rows: string[][] }> = [
    {
      label: "강사 시간 충돌",
      columns: CONFLICT_COLUMNS,
      rows: appState.allConflicts.map((conflict) => [
        conflict.기준,
        conflict.일자,
        conflict.키,
        conflict.과정A,
        conflict.A시간,
        conflict.A교과목,
        conflict.과정B,
        conflict.B시간,
        conflict.B교과목
      ])
    },
    {
      label: "강사 배치(일) 충돌",
      columns: DAY_CONFLICT_COLUMNS,
      rows: appState.instructorDayOverlaps.map((overlap) => toDayConflictRow(overlap))
    },
    {
      label: "퍼실/운영 배치(일) 충돌",
      columns: DAY_CONFLICT_COLUMNS,
      rows: appState.facilitatorOperationOverlaps.map((overlap) => toDayConflictRow(overlap))
    }
  ];

  const hasAnyConflict = sections.some((section) => section.rows.length > 0);
  if (!hasAnyConflict) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "현재 감지된 충돌 상세가 없습니다.";
    domRefs.conflictDetailContent.appendChild(empty);
    return;
  }

  for (const section of sections) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "12px";

    const heading = document.createElement("strong");
    heading.textContent = `${section.label} (${section.rows.length}건)`;
    wrap.appendChild(heading);

    if (section.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.marginTop = "6px";
      empty.textContent = "없음";
      wrap.appendChild(empty);
      domRefs.conflictDetailContent.appendChild(wrap);
      continue;
    }

    const previewRows = section.rows.slice(0, TABLE_RENDER_LIMIT);
    const table = createTableElement(section.columns, previewRows);
    table.style.marginTop = "6px";
    wrap.appendChild(table);

    if (section.rows.length > previewRows.length) {
      const notice = document.createElement("div");
      notice.className = "muted";
      notice.style.marginTop = "4px";
      notice.textContent = `총 ${section.rows.length}건 중 상위 ${previewRows.length}건만 표시합니다.`;
      wrap.appendChild(notice);
    }

    domRefs.conflictDetailContent.appendChild(wrap);
  }
}

export function openConflictDetailModal(): void {
  renderConflictDetailModalContent();
  if (!domRefs.conflictDetailModal.open) {
    domRefs.conflictDetailModal.showModal();
  }
}

export function closeConflictDetailModal(): void {
  if (domRefs.conflictDetailModal.open) {
    domRefs.conflictDetailModal.close();
  }
}

// ---------------------------------------------------------------------------
// Instructor-day overlap panel
// ---------------------------------------------------------------------------

function overlapToSearchText(overlap: StaffOverlap): string {
  return [
    overlap.assignee,
    overlap.resourceType,
    RESOURCE_TYPE_LABEL[overlap.resourceType],
    overlap.assignmentA.cohort,
    overlap.assignmentA.phase,
    overlap.assignmentA.startDate,
    overlap.assignmentA.endDate,
    overlap.assignmentB.cohort,
    overlap.assignmentB.phase,
    overlap.assignmentB.startDate,
    overlap.assignmentB.endDate
  ]
    .join(" ")
    .toLowerCase();
}

export function renderInstructorDayOverlapPanel(): void {
  domRefs.instructorDayOverlapBody.innerHTML = "";
  domRefs.instructorDayOverlapCount.textContent = `총 ${appState.visibleInstructorDayOverlaps.length}건`;
  const preview = appState.visibleInstructorDayOverlaps.slice(0, TABLE_RENDER_LIMIT);
  setRenderNotice(domRefs.instructorDayRenderNotice, appState.visibleInstructorDayOverlaps.length, preview.length);

  if (appState.visibleInstructorDayOverlaps.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "겹침이 없습니다.";
    tr.appendChild(td);
    domRefs.instructorDayOverlapBody.appendChild(tr);
    return;
  }

  for (const overlap of preview) {
    const tr = document.createElement("tr");
    const overlapRangeLabel = getOverlapRangeLabel(overlap);
    tr.title = `동일 담당자, ${overlapRangeLabel} 겹침 ${overlap.overlapDays}건`;

    const assigneeCell = document.createElement("td");
    assigneeCell.textContent = overlap.assignee;
    tr.appendChild(assigneeCell);

    const resourceTypeCell = document.createElement("td");
    resourceTypeCell.textContent = overlap.resourceType;
    tr.appendChild(resourceTypeCell);

    tr.appendChild(
      createClickableCell(overlap.assignmentA.cohort, () =>
        _highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentA.phase, () =>
        _highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
      )
    );

    const startACell = document.createElement("td");
    startACell.textContent = overlap.assignmentA.startDate;
    if (isDateInsideRange(overlap.assignmentA.startDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      startACell.classList.add("date-highlight");
    }
    tr.appendChild(startACell);

    const endACell = document.createElement("td");
    endACell.textContent = overlap.assignmentA.endDate;
    if (isDateInsideRange(overlap.assignmentA.endDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      endACell.classList.add("date-highlight");
    }
    tr.appendChild(endACell);

    tr.appendChild(
      createClickableCell(overlap.assignmentB.cohort, () =>
        _highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentB.phase, () =>
        _highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
      )
    );

    const startBCell = document.createElement("td");
    startBCell.textContent = overlap.assignmentB.startDate;
    if (isDateInsideRange(overlap.assignmentB.startDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      startBCell.classList.add("date-highlight");
    }
    tr.appendChild(startBCell);

    const endBCell = document.createElement("td");
    endBCell.textContent = overlap.assignmentB.endDate;
    if (isDateInsideRange(overlap.assignmentB.endDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      endBCell.classList.add("date-highlight");
    }
    tr.appendChild(endBCell);

    const overlapCountCell = document.createElement("td");
    overlapCountCell.textContent = String(overlap.overlapDays);
    overlapCountCell.classList.add("date-highlight");
    tr.appendChild(overlapCountCell);

    domRefs.instructorDayOverlapBody.appendChild(tr);
  }
}

export function applyInstructorDayFilters(): void {
  const query = domRefs.instructorDaySearchInput.value.trim().toLowerCase();

  appState.visibleInstructorDayOverlaps = appState.instructorDayOverlaps
    .filter((overlap) => (query.length === 0 ? true : overlapToSearchText(overlap).includes(query)))
    .sort(
      (a, b) =>
        a.assignee.localeCompare(b.assignee) ||
        a.overlapStartDate.localeCompare(b.overlapStartDate) ||
        a.assignmentA.cohort.localeCompare(b.assignmentA.cohort)
    );

  renderInstructorDayOverlapPanel();
  _updateActionStates();
}

// ---------------------------------------------------------------------------
// Facilitator/operation day overlap panel
// ---------------------------------------------------------------------------

export function renderFoDayOverlapPanel(): void {
  domRefs.foOverlapBody.innerHTML = "";
  domRefs.foOverlapCount.textContent = `총 ${appState.visibleFoDayOverlaps.length}건`;
  const preview = appState.visibleFoDayOverlaps.slice(0, TABLE_RENDER_LIMIT);
  setRenderNotice(domRefs.foDayRenderNotice, appState.visibleFoDayOverlaps.length, preview.length);

  if (appState.visibleFoDayOverlaps.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "겹침이 없습니다.";
    tr.appendChild(td);
    domRefs.foOverlapBody.appendChild(tr);
    return;
  }

  for (const overlap of preview) {
    const tr = document.createElement("tr");
    const overlapRangeLabel = getOverlapRangeLabel(overlap);
    tr.title = `동일 담당자, ${overlapRangeLabel} 겹침 ${overlap.overlapDays}건`;

    const assigneeCell = document.createElement("td");
    assigneeCell.textContent = overlap.assignee;
    tr.appendChild(assigneeCell);

    const resourceTypeCell = document.createElement("td");
    resourceTypeCell.textContent = overlap.resourceType;
    tr.appendChild(resourceTypeCell);

    tr.appendChild(
      createClickableCell(overlap.assignmentA.cohort, () =>
        _highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentA.phase, () =>
        _highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
      )
    );

    const startACell = document.createElement("td");
    startACell.textContent = overlap.assignmentA.startDate;
    if (isDateInsideRange(overlap.assignmentA.startDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      startACell.classList.add("date-highlight");
    }
    tr.appendChild(startACell);

    const endACell = document.createElement("td");
    endACell.textContent = overlap.assignmentA.endDate;
    if (isDateInsideRange(overlap.assignmentA.endDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      endACell.classList.add("date-highlight");
    }
    tr.appendChild(endACell);

    tr.appendChild(
      createClickableCell(overlap.assignmentB.cohort, () =>
        _highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentB.phase, () =>
        _highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
      )
    );

    const startBCell = document.createElement("td");
    startBCell.textContent = overlap.assignmentB.startDate;
    if (isDateInsideRange(overlap.assignmentB.startDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      startBCell.classList.add("date-highlight");
    }
    tr.appendChild(startBCell);

    const endBCell = document.createElement("td");
    endBCell.textContent = overlap.assignmentB.endDate;
    if (isDateInsideRange(overlap.assignmentB.endDate, overlap.overlapStartDate, overlap.overlapEndDate)) {
      endBCell.classList.add("date-highlight");
    }
    tr.appendChild(endBCell);

    const overlapCountCell = document.createElement("td");
    overlapCountCell.textContent = String(overlap.overlapDays);
    overlapCountCell.classList.add("date-highlight");
    tr.appendChild(overlapCountCell);

    domRefs.foOverlapBody.appendChild(tr);
  }
}

export function applyFoDayFilters(): void {
  const query = domRefs.foDaySearchInput.value.trim().toLowerCase();

  appState.visibleFoDayOverlaps = appState.facilitatorOperationOverlaps
    .filter((overlap) => (query.length === 0 ? true : overlapToSearchText(overlap).includes(query)))
    .sort(
      (a, b) =>
        a.resourceType.localeCompare(b.resourceType) ||
        a.assignee.localeCompare(b.assignee) ||
        a.overlapStartDate.localeCompare(b.overlapStartDate)
    );

  renderFoDayOverlapPanel();
  _updateActionStates();
}

// Re-export for use in main.ts print report
export { getConflictTabLabel };
