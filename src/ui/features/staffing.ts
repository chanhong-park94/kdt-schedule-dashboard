import { V7E_STRICT_DETAIL_HEADER, buildAssignments, deriveModuleRangesFromSessions, detectStaffOverlaps, exportV7eStrictCsv, summarizeWorkload } from "../../core/staffing";
import { exportWithMapping, type ExportFormatKey } from "../../core/exportMapping";
import { validateRecordsForFormat } from "../../core/exportValidation";
import { type InternalV7ERecord } from "../../core/schema";
import { type AssigneeSummary, type Phase, type ResourceType, type StaffAssignment, type StaffAssignmentInput, type TrackType } from "../../core/types";
import { appState, cohortTrackType, generatedCohortRanges, staffingCellState, type CohortRange, type StaffCellState } from "../appState";
import { domRefs } from "../domRefs";
import { RESOURCE_TYPE_LABEL } from "./conflicts";
import { DAY_MS, addDaysToIso, formatDate, getTodayCompactDate, parseIsoDate } from "../utils/date";
import { downloadCsvFile, downloadCsvText } from "../utils/csv";
import { getPolicyForTrack, getPolicyLabel, normalizePolicyDays } from "../utils/format";

type ModuleAssignSummary = {
  moduleKey: string;
  cohort: string;
  module: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
  instructorCodes: string[];
  missingInstructorSessions: number;
};

type StaffingFeatureDeps = {
  phases: Phase[];
  trackTypes: TrackType[];
  matrixResourceTypes: ResourceType[];
  trackLabel: Record<TrackType, string>;
  resourceTypeOrder: Record<ResourceType, number>;
  compactToIso: (value: string) => string | null;
  upsertCohortRange: <T extends { cohort: string; startDate: string; endDate: string }>(
    target: Map<string, T>,
    range: T
  ) => void;
  getDefaultTrackTypeForCohort: (cohort: string) => TrackType;
  getStaffCellState: (cohort: string, phase: Phase) => StaffCellState;
  setStaffCellState: (cohort: string, phase: Phase, next: StaffCellState) => void;
  setStaffingStatus: (message: string, isError?: boolean) => void;
  scheduleAutoSave: () => void;
  renderInstructorDayOverlapPanel: () => void;
  renderFoDayOverlapPanel: () => void;
  applyInstructorDayFilters: () => void;
  applyFoDayFilters: () => void;
  renderStaffExportValidation: (errors: string[], warnings: string[]) => void;
  renderStaffModuleManagerTable: (isBusy?: boolean) => void;
  buildModuleAssignSummaries: () => ModuleAssignSummary[];
};

const defaultDeps: StaffingFeatureDeps = {
  phases: ["P1", "P2", "365"],
  trackTypes: ["UNEMPLOYED", "EMPLOYED"],
  matrixResourceTypes: ["INSTRUCTOR", "FACILITATOR", "OPERATION"],
  trackLabel: {
    UNEMPLOYED: "실업자",
    EMPLOYED: "재직자"
  },
  resourceTypeOrder: {
    INSTRUCTOR: 0,
    FACILITATOR: 1,
    OPERATION: 2
  },
  compactToIso: () => null,
  upsertCohortRange: () => {},
  getDefaultTrackTypeForCohort: () => "UNEMPLOYED",
  getStaffCellState: () => ({ assignee: "", startDate: "", endDate: "", resourceType: "FACILITATOR" }),
  setStaffCellState: () => {},
  setStaffingStatus: () => {},
  scheduleAutoSave: () => {},
  renderInstructorDayOverlapPanel: () => {},
  renderFoDayOverlapPanel: () => {},
  applyInstructorDayFilters: () => {},
  applyFoDayFilters: () => {},
  renderStaffExportValidation: () => {},
  renderStaffModuleManagerTable: () => {},
  buildModuleAssignSummaries: () => []
};

let deps: StaffingFeatureDeps = defaultDeps;

export function initStaffingFeature(nextDeps: StaffingFeatureDeps): void {
  deps = nextDeps;
}

export function rebuildStaffingCohortRanges(): void {
  const rangeMap = new Map<string, Omit<CohortRange, "trackType">>();

  for (const summary of appState.summaries) {
    const startDate = deps.compactToIso(summary.시작일);
    const endDate = deps.compactToIso(summary.종료일);
    if (!startDate || !endDate) {
      continue;
    }

    deps.upsertCohortRange(rangeMap, {
      cohort: summary.과정기수,
      startDate,
      endDate
    });
  }

  for (const range of generatedCohortRanges.values()) {
    deps.upsertCohortRange(rangeMap, range);
  }

  const mergedRanges = Array.from(rangeMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));

  appState.staffingCohortRanges = mergedRanges.map((range) => {
    const existingTrack = cohortTrackType.get(range.cohort);
    const trackType = existingTrack ?? deps.getDefaultTrackTypeForCohort(range.cohort);
    cohortTrackType.set(range.cohort, trackType);
    return { ...range, trackType };
  });

  for (const range of appState.staffingCohortRanges) {
    for (const phase of deps.phases) {
      const key = `${range.cohort}|||${phase}`;
      if (!staffingCellState.has(key)) {
        staffingCellState.set(key, { assignee: "", startDate: "", endDate: "", resourceType: "FACILITATOR" });
      }
    }
  }
}

export function renderStaffingMatrix(): void {
  domRefs.staffMatrixContainer.innerHTML = "";

  if (appState.staffingCohortRanges.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "코호트 데이터가 없어 배치표를 표시할 수 없습니다.";
    domRefs.staffMatrixContainer.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "staffing-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["과정", "트랙유형", "개강", "종강", "P1", "P2", "365"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const range of appState.staffingCohortRanges) {
    const tr = document.createElement("tr");

    const cohortCell = document.createElement("td");
    cohortCell.textContent = range.cohort;
    tr.appendChild(cohortCell);

    const trackCell = document.createElement("td");
    const trackSelect = document.createElement("select");
    const currentTrack = range.trackType ?? cohortTrackType.get(range.cohort) ?? deps.getDefaultTrackTypeForCohort(range.cohort);

    for (const trackType of deps.trackTypes) {
      const option = document.createElement("option");
      option.value = trackType;
      option.textContent = `${deps.trackLabel[trackType]} (${getPolicyLabel(getPolicyForTrack(trackType))})`;
      trackSelect.appendChild(option);
    }
    trackSelect.value = currentTrack;
    trackSelect.addEventListener("change", () => {
      const nextTrack = trackSelect.value as TrackType;
      cohortTrackType.set(range.cohort, nextTrack);
      const nextRange = appState.staffingCohortRanges.find((item) => item.cohort === range.cohort);
      if (nextRange) {
        nextRange.trackType = nextTrack;
      }
      refreshStaffingAnalytics(true);
      deps.scheduleAutoSave();
    });

    trackCell.appendChild(trackSelect);
    tr.appendChild(trackCell);

    const startCell = document.createElement("td");
    startCell.textContent = range.startDate;
    tr.appendChild(startCell);

    const endCell = document.createElement("td");
    endCell.textContent = range.endDate;
    tr.appendChild(endCell);

    for (const phase of deps.phases) {
      const state = deps.getStaffCellState(range.cohort, phase);

      const td = document.createElement("td");
      const wrapper = document.createElement("div");
      wrapper.className = "phase-cell";

      const resourceBox = document.createElement("div");
      const resourceLabel = document.createElement("div");
      resourceLabel.className = "phase-field-label";
      resourceLabel.textContent = "유형";
      const resourceSelect = document.createElement("select");
      for (const resourceType of deps.matrixResourceTypes) {
        const option = document.createElement("option");
        option.value = resourceType;
        option.textContent = RESOURCE_TYPE_LABEL[resourceType];
        resourceSelect.appendChild(option);
      }
      resourceSelect.value = state.resourceType === "INSTRUCTOR" ? "FACILITATOR" : state.resourceType;

      const assigneeInput = document.createElement("input");
      const startInput = document.createElement("input");
      const endInput = document.createElement("input");
      assigneeInput.type = "text";
      startInput.type = "date";
      endInput.type = "date";
      assigneeInput.value = state.assignee;
      startInput.value = state.startDate;
      endInput.value = state.endDate;

      resourceSelect.addEventListener("change", () => {
        deps.setStaffCellState(range.cohort, phase, {
          assignee: assigneeInput.value,
          startDate: startInput.value,
          endDate: endInput.value,
          resourceType: resourceSelect.value as ResourceType
        });
        refreshStaffingAnalytics(false);
      });
      resourceBox.appendChild(resourceLabel);
      resourceBox.appendChild(resourceSelect);

      const assigneeBox = document.createElement("div");
      const assigneeLabel = document.createElement("div");
      assigneeLabel.className = "phase-field-label";
      assigneeLabel.textContent = "담당자";
      assigneeInput.addEventListener("input", () => {
        deps.setStaffCellState(range.cohort, phase, {
          assignee: assigneeInput.value,
          startDate: startInput.value,
          endDate: endInput.value,
          resourceType: resourceSelect.value as ResourceType
        });
        refreshStaffingAnalytics(false);
      });
      assigneeBox.appendChild(assigneeLabel);
      assigneeBox.appendChild(assigneeInput);

      const startBox = document.createElement("div");
      const startLabel = document.createElement("div");
      startLabel.className = "phase-field-label";
      startLabel.textContent = "시작";
      startInput.addEventListener("input", () => {
        deps.setStaffCellState(range.cohort, phase, {
          assignee: assigneeInput.value,
          startDate: startInput.value,
          endDate: endInput.value,
          resourceType: resourceSelect.value as ResourceType
        });
        refreshStaffingAnalytics(false);
      });
      startBox.appendChild(startLabel);
      startBox.appendChild(startInput);

      const endBox = document.createElement("div");
      const endLabel = document.createElement("div");
      endLabel.className = "phase-field-label";
      endLabel.textContent = "종료";
      endInput.addEventListener("input", () => {
        deps.setStaffCellState(range.cohort, phase, {
          assignee: assigneeInput.value,
          startDate: startInput.value,
          endDate: endInput.value,
          resourceType: resourceSelect.value as ResourceType
        });
        refreshStaffingAnalytics(false);
      });
      endBox.appendChild(endLabel);
      endBox.appendChild(endInput);

      wrapper.appendChild(resourceBox);
      wrapper.appendChild(assigneeBox);
      wrapper.appendChild(startBox);
      wrapper.appendChild(endBox);
      td.appendChild(wrapper);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  domRefs.staffMatrixContainer.appendChild(table);
}

export function collectStaffingInputs(): StaffAssignmentInput[] {
  const inputs: StaffAssignmentInput[] = [];

  for (const range of appState.staffingCohortRanges) {
    const trackType = range.trackType ?? cohortTrackType.get(range.cohort) ?? deps.getDefaultTrackTypeForCohort(range.cohort);

    for (const phase of deps.phases) {
      const state = deps.getStaffCellState(range.cohort, phase);
      const assignee = state.assignee.trim();
      const startDate = state.startDate.trim();
      const endDate = state.endDate.trim();
      const resourceType = state.resourceType;

      const isEmpty = assignee.length === 0 && startDate.length === 0 && endDate.length === 0;
      if (isEmpty) {
        continue;
      }

      if (!assignee || !startDate || !endDate) {
        throw new Error(`${range.cohort} ${phase} 배치는 담당자/시작일/종료일을 모두 입력해야 합니다.`);
      }

      inputs.push({
        cohort: range.cohort,
        phase,
        assignee,
        startDate,
        endDate,
        resourceType,
        trackType
      });
    }
  }

  return inputs;
}

export function renderStaffGantt(
  container: HTMLElement,
  groups: Array<{ label: string; assignments: StaffAssignment[] }>,
  barLabel: (assignment: StaffAssignment) => string
): void {
  container.innerHTML = "";

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "데이터가 없습니다.";
    container.appendChild(empty);
    return;
  }

  const allAssignments = groups.flatMap((group) => group.assignments);
  const starts = allAssignments.map((item) => item.startDate).sort();
  const ends = allAssignments.map((item) => item.endDate).sort();

  const minDate = starts[0];
  const maxDate = ends[ends.length - 1];
  const minParsed = parseIsoDate(minDate);
  const maxParsed = parseIsoDate(maxDate);

  if (!minParsed || !maxParsed) {
    return;
  }

  const totalSpan = Math.max((maxParsed.getTime() - minParsed.getTime()) / DAY_MS, 1);
  const phaseColor: Record<Phase, string> = {
    P1: "#60a5fa",
    P2: "#34d399",
    "365": "#fbbf24"
  };

  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "staff-gantt-row";

    const label = document.createElement("div");
    label.className = "staff-gantt-label";
    label.textContent = group.label;

    const track = document.createElement("div");
    track.className = "staff-gantt-track";

    for (const assignment of group.assignments) {
      const startParsed = parseIsoDate(assignment.startDate);
      const endParsed = parseIsoDate(assignment.endDate);
      if (!startParsed || !endParsed) {
        continue;
      }

      const left = ((startParsed.getTime() - minParsed.getTime()) / DAY_MS / totalSpan) * 100;
      const width =
        Math.max(((endParsed.getTime() - startParsed.getTime()) / DAY_MS / totalSpan) * 100, 1.2);

      const bar = document.createElement("div");
      bar.className = "staff-gantt-bar";
      bar.dataset.cohort = assignment.cohort;
      bar.dataset.phase = assignment.phase;
      bar.style.left = `${Math.max(0, Math.min(100, left))}%`;
      bar.style.width = `${Math.max(1.2, Math.min(100, width))}%`;
      bar.style.background = phaseColor[assignment.phase];
      bar.textContent = barLabel(assignment);
      bar.title = `${assignment.cohort} ${assignment.phase} ${assignment.assignee}\n${assignment.startDate}~${assignment.endDate}`;

      track.appendChild(bar);
    }

    row.appendChild(label);
    row.appendChild(track);
    container.appendChild(row);
  }
}

export function buildOverlapDayMapByAssignment(): Map<StaffAssignment, number> {
  const map = new Map<StaffAssignment, Set<string>>();

  for (const overlap of [...appState.instructorDayOverlaps, ...appState.facilitatorOperationOverlaps]) {
    const start = parseIsoDate(overlap.overlapStartDate);
    const end = parseIsoDate(overlap.overlapEndDate);
    if (!start || !end) {
      continue;
    }

    const overlapPolicy = normalizePolicyDays(
      overlap.assignmentA.includeWeekdays.filter((day) => overlap.assignmentB.includeWeekdays.includes(day))
    );
    if (overlapPolicy.length === 0) {
      continue;
    }

    for (const target of [overlap.assignmentA, overlap.assignmentB]) {
      if (!map.has(target)) {
        map.set(target, new Set<string>());
      }

      const set = map.get(target);
      if (!set) {
        continue;
      }

      let current = new Date(start.getTime());
      while (current.getTime() <= end.getTime()) {
        if (overlapPolicy.includes(current.getUTCDay())) {
          set.add(formatDate(current));
        }
        current = new Date(current.getTime() + DAY_MS);
      }
    }
  }

  const countMap = new Map<StaffAssignment, number>();
  for (const [assignment, days] of map.entries()) {
    countMap.set(assignment, days.size);
  }
  return countMap;
}

export function getPolicyLabelsForAssignee(assignee: string, resourceType: ResourceType): string[] {
  if (resourceType === "INSTRUCTOR") {
    return [];
  }

  const set = new Set<string>();

  for (const assignment of appState.staffingAssignments) {
    if (assignment.assignee !== assignee || assignment.resourceType !== resourceType) {
      continue;
    }
    set.add(getPolicyLabel(assignment.includeWeekdays));
  }

  return Array.from(set).sort();
}

export function renderStaffKpiAndDetails(): void {
  domRefs.staffKpiBody.innerHTML = "";

  const kpiRows = [...appState.instructorSummaries, ...appState.staffingSummaries].sort(
    (a, b) =>
      deps.resourceTypeOrder[a.resourceType] - deps.resourceTypeOrder[b.resourceType] ||
      a.assignee.localeCompare(b.assignee)
  );

  if (kpiRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "배치 데이터가 없습니다.";
    tr.appendChild(td);
    domRefs.staffKpiBody.appendChild(tr);
  } else {
    for (const summary of kpiRows) {
      const tr = document.createElement("tr");
      const assigneeCell = document.createElement("td");
      assigneeCell.textContent = summary.assignee;

      const policyLabels = getPolicyLabelsForAssignee(summary.assignee, summary.resourceType);
      for (const label of policyLabels) {
        const badge = document.createElement("span");
        badge.className = "policy-badge";
        badge.textContent = label;
        assigneeCell.appendChild(badge);
      }

      tr.appendChild(assigneeCell);

      const resourceTypeCell = document.createElement("td");
      resourceTypeCell.textContent = RESOURCE_TYPE_LABEL[summary.resourceType];
      tr.appendChild(resourceTypeCell);

      const phaseValues =
        summary.resourceType === "INSTRUCTOR"
          ? ["-", "-", "-"]
          : [
              String(summary.phaseWorkDays.P1),
              String(summary.phaseWorkDays.P2),
              String(summary.phaseWorkDays["365"])
            ];

      const values = [
        String(summary.totalWorkDays),
        ...phaseValues,
        String(summary.overlapDays)
      ];

      values.forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = value;
        if (index === 4 && summary.overlapDays === 0) {
          td.className = "kpi-ok";
        }
        tr.appendChild(td);
      });

      domRefs.staffKpiBody.appendChild(tr);
    }
  }

  domRefs.staffDetailContainer.innerHTML = "";
  const overlapDayMap = buildOverlapDayMapByAssignment();

  for (const summary of appState.instructorSummaries) {
    const group = document.createElement("div");
    group.className = "staff-detail-group";

    const title = document.createElement("div");
    title.className = "staff-detail-title";
    title.textContent = `${summary.assignee} (${RESOURCE_TYPE_LABEL[summary.resourceType]}) / 총 ${summary.totalWorkDays}일 / 겹침 ${summary.overlapDays}일`;
    group.appendChild(title);

    const text = document.createElement("div");
    text.className = "muted";
    text.textContent = "Staffing 배치 기준 집계입니다. 강사 배치(일) 충돌 탭에서 상세 일자를 확인할 수 있습니다.";
    group.appendChild(text);

    domRefs.staffDetailContainer.appendChild(group);
  }

  for (const summary of appState.staffingSummaries) {
    const group = document.createElement("div");
    group.className = "staff-detail-group";

    const title = document.createElement("div");
    title.className = "staff-detail-title";
    title.textContent = `${summary.assignee} (${RESOURCE_TYPE_LABEL[summary.resourceType]}) / 총 ${summary.totalWorkDays}일 / 겹침 ${summary.overlapDays}일`;

    const titlePolicies = getPolicyLabelsForAssignee(summary.assignee, summary.resourceType);
    for (const label of titlePolicies) {
      const badge = document.createElement("span");
      badge.className = "policy-badge";
      badge.textContent = label;
      title.appendChild(badge);
    }

    group.appendChild(title);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    ["Phase", "과정", "시작일", "종료일", "일수", "산정기준", "관련겹침일수"].forEach((text) => {
      const th = document.createElement("th");
      th.textContent = text;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const rows = appState.staffingAssignments
      .filter(
        (assignment) => assignment.assignee === summary.assignee && assignment.resourceType === summary.resourceType
      )
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.phase.localeCompare(b.phase) ||
          a.cohort.localeCompare(b.cohort)
      );

    for (const assignment of rows) {
      const tr = document.createElement("tr");
      const overlapDays = overlapDayMap.get(assignment) ?? 0;
      const values = [
        assignment.phase,
        assignment.cohort,
        assignment.startDate,
        assignment.endDate,
        String(assignment.workDays)
      ];

      values.forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });

      const policyCell = document.createElement("td");
      const policyBadge = document.createElement("span");
      policyBadge.className = "policy-badge";
      policyBadge.textContent = getPolicyLabel(assignment.includeWeekdays);
      policyCell.appendChild(policyBadge);
      tr.appendChild(policyCell);

      const overlapCell = document.createElement("td");
      overlapCell.textContent = String(overlapDays);
      if (overlapDays === 0) {
        overlapCell.className = "kpi-ok";
      }
      tr.appendChild(overlapCell);

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    group.appendChild(table);
    domRefs.staffDetailContainer.appendChild(group);
  }
}

export function refreshStaffingAnalytics(showStatus = true): void {
  try {
    const inputs = collectStaffingInputs();
    appState.staffingAssignments = buildAssignments(inputs);
    const allOverlaps = detectStaffOverlaps(appState.staffingAssignments);
    appState.instructorDayOverlaps = allOverlaps.filter((item) => item.resourceType === "INSTRUCTOR");
    appState.facilitatorOperationOverlaps = allOverlaps.filter((item) => item.resourceType !== "INSTRUCTOR");

    const allSummaries = summarizeWorkload(appState.staffingAssignments);
    appState.instructorSummaries = allSummaries.filter((item) => item.resourceType === "INSTRUCTOR");
    appState.staffingSummaries = allSummaries.filter((item) => item.resourceType !== "INSTRUCTOR");

    deps.applyInstructorDayFilters();
    deps.applyFoDayFilters();

    const byCohort = new Map<string, StaffAssignment[]>();
    for (const assignment of appState.staffingAssignments) {
      if (!byCohort.has(assignment.cohort)) {
        byCohort.set(assignment.cohort, []);
      }
      byCohort.get(assignment.cohort)?.push(assignment);
    }
    renderStaffGantt(
      domRefs.staffCohortGantt,
      Array.from(byCohort.entries()).map(([label, assignments]) => ({ label, assignments })),
      (assignment) => `${assignment.phase} ${assignment.assignee}`
    );

    const byAssignee = new Map<string, StaffAssignment[]>();
    for (const assignment of appState.staffingAssignments) {
      if (!byAssignee.has(assignment.assignee)) {
        byAssignee.set(assignment.assignee, []);
      }
      byAssignee.get(assignment.assignee)?.push(assignment);
    }
    renderStaffGantt(
      domRefs.staffAssigneeGantt,
      Array.from(byAssignee.entries()).map(([label, assignments]) => ({ label, assignments })),
      (assignment) => `${assignment.cohort} ${assignment.phase}`
    );

    renderStaffKpiAndDetails();

    if (showStatus) {
      const kpiTarget = appState.instructorSummaries.length + appState.staffingSummaries.length;
      deps.setStaffingStatus(
        `배치 ${appState.staffingAssignments.length}건 / 강사 일충돌 ${appState.instructorDayOverlaps.length}건 / 퍼실·운영 일충돌 ${appState.facilitatorOperationOverlaps.length}건 / KPI ${kpiTarget}명`
      );
    }

    domRefs.staffExportWarningsAgree.checked = false;
    deps.renderStaffExportValidation([], []);
  } catch (error) {
    appState.staffingAssignments = [];
    appState.facilitatorOperationOverlaps = [];
    appState.instructorDayOverlaps = [];
    appState.visibleInstructorDayOverlaps = [];
    appState.visibleFoDayOverlaps = [];
    appState.staffingSummaries = [];
    appState.instructorSummaries = [];

    deps.renderInstructorDayOverlapPanel();
    deps.renderFoDayOverlapPanel();
    renderStaffGantt(domRefs.staffCohortGantt, [], () => "");
    renderStaffGantt(domRefs.staffAssigneeGantt, [], () => "");
    renderStaffKpiAndDetails();

    if (showStatus) {
      const message = error instanceof Error ? error.message : "배치 계산 중 오류가 발생했습니다.";
      deps.setStaffingStatus(message, true);
    }

    domRefs.staffExportWarningsAgree.checked = false;
    deps.renderStaffExportValidation([], []);
  }
}

export function renderStaffingSection(): void {
  rebuildStaffingCohortRanges();
  deps.renderStaffModuleManagerTable(false);
  renderStaffingMatrix();
  refreshStaffingAnalytics(false);

  if (appState.staffingMode === "manager") {
    const moduleRows = deps.buildModuleAssignSummaries();
    if (moduleRows.length === 0) {
      deps.setStaffingStatus("수업시간표가 없어 운영매니저 교과목 배치표를 표시할 수 없습니다.");
    } else {
      deps.setStaffingStatus(`모듈 ${moduleRows.length}건 기준으로 강사 자동 배정을 관리합니다.`);
    }
    return;
  }

  if (appState.staffingCohortRanges.length === 0) {
    deps.setStaffingStatus("코호트 데이터가 없어 고급 배치표를 표시할 수 없습니다.");
  } else {
    deps.setStaffingStatus(`코호트 ${appState.staffingCohortRanges.length}개를 기준으로 배치표를 구성했습니다.`);
  }
}

export function autoFillStaffingFromCohorts(): void {
  if (appState.staffingCohortRanges.length === 0) {
    deps.setStaffingStatus("자동 채울 코호트가 없습니다.", true);
    return;
  }

  const p1Weeks = Number.parseInt(domRefs.staffP1WeeksInput.value, 10);
  const d365Weeks = Number.parseInt(domRefs.staff365WeeksInput.value, 10);

  if (!Number.isInteger(p1Weeks) || p1Weeks <= 0 || !Number.isInteger(d365Weeks) || d365Weeks <= 0) {
    deps.setStaffingStatus("P1/365 기본 주수는 1 이상의 정수여야 합니다.", true);
    return;
  }

  for (const range of appState.staffingCohortRanges) {
    const p1EndCandidate = addDaysToIso(range.startDate, p1Weeks * 7 - 1);
    const p1End = p1EndCandidate < range.endDate ? p1EndCandidate : range.endDate;

    const p2StartCandidate = addDaysToIso(p1End, 1);
    const hasP2 = p2StartCandidate <= range.endDate;

    const d365Start = range.endDate;
    const d365End = addDaysToIso(d365Start, d365Weeks * 7 - 1);

    const p1State = deps.getStaffCellState(range.cohort, "P1");
    const p2State = deps.getStaffCellState(range.cohort, "P2");
    const d365State = deps.getStaffCellState(range.cohort, "365");

    deps.setStaffCellState(range.cohort, "P1", {
      assignee: p1State.assignee,
      startDate: range.startDate,
      endDate: p1End,
      resourceType: p1State.resourceType
    });

    deps.setStaffCellState(range.cohort, "P2", {
      assignee: p2State.assignee,
      startDate: hasP2 ? p2StartCandidate : "",
      endDate: hasP2 ? range.endDate : "",
      resourceType: p2State.resourceType
    });

    deps.setStaffCellState(range.cohort, "365", {
      assignee: d365State.assignee,
      startDate: d365Start,
      endDate: d365End,
      resourceType: d365State.resourceType
    });
  }

  renderStaffingMatrix();
  refreshStaffingAnalytics(true);
  deps.setStaffingStatus("코호트 일정 기준으로 P1/P2/365 기간을 자동 반영했습니다.");
  deps.scheduleAutoSave();
}

export function isV7eStrictReady(): { ok: boolean; reason?: string } {
  if (appState.staffingCohortRanges.length === 0) {
    return { ok: false, reason: "코호트 데이터가 없습니다." };
  }

  const p1Weeks = Number.parseInt(domRefs.staffP1WeeksInput.value, 10);
  const d365Weeks = Number.parseInt(domRefs.staff365WeeksInput.value, 10);
  if (!Number.isInteger(p1Weeks) || !Number.isInteger(d365Weeks) || p1Weeks <= 0 || d365Weeks <= 0) {
    return { ok: false, reason: "P1/365 기본 주수가 올바르지 않습니다." };
  }

  for (const range of appState.staffingCohortRanges) {
    const p1State = deps.getStaffCellState(range.cohort, "P1");
    const p2State = deps.getStaffCellState(range.cohort, "P2");
    const d365State = deps.getStaffCellState(range.cohort, "365");

    const p1EndCandidate = addDaysToIso(range.startDate, p1Weeks * 7 - 1);
    const expectedP1End = p1EndCandidate < range.endDate ? p1EndCandidate : range.endDate;
    if (p1State.startDate !== range.startDate || p1State.endDate !== expectedP1End) {
      return { ok: false, reason: `${range.cohort} P1 기간이 프리셋과 다릅니다.` };
    }

    const expectedP2Start = addDaysToIso(expectedP1End, 1);
    if (expectedP2Start <= range.endDate) {
      if (p2State.startDate !== expectedP2Start || p2State.endDate !== range.endDate) {
        return { ok: false, reason: `${range.cohort} P2 기간이 프리셋과 다릅니다.` };
      }
    } else if (p2State.startDate || p2State.endDate) {
      return { ok: false, reason: `${range.cohort} P2 기간이 프리셋과 다릅니다.` };
    }

    const expected365Start = range.endDate;
    const expected365End = addDaysToIso(expected365Start, d365Weeks * 7 - 1);
    if (d365State.startDate !== expected365Start || d365State.endDate !== expected365End) {
      return { ok: false, reason: `${range.cohort} 365 기간이 프리셋과 다릅니다.` };
    }
  }

  return { ok: true };
}

export function buildStrictExportRecords(): InternalV7ERecord[] {
  const records: InternalV7ERecord[] = [];

  for (const range of appState.staffingCohortRanges) {
    const p1 = deps.getStaffCellState(range.cohort, "P1");
    const p2 = deps.getStaffCellState(range.cohort, "P2");
    const d365 = deps.getStaffCellState(range.cohort, "365");

    records.push({
      cohort: range.cohort,
      startDate: range.startDate,
      endDate: range.endDate,
      p1Assignee: p1.assignee,
      p1Range: p1.startDate && p1.endDate ? `${p1.startDate}~${p1.endDate}` : "",
      p2Assignee: p2.assignee,
      p2Range: p2.startDate && p2.endDate ? `${p2.startDate}~${p2.endDate}` : "",
      p365Assignee: d365.assignee,
      p365Range: d365.startDate && d365.endDate ? `${d365.startDate}~${d365.endDate}` : ""
    });
  }

  return records;
}

export function buildModulesGenericExportRecords(): InternalV7ERecord[] {
  const moduleRanges = deriveModuleRangesFromSessions(appState.sessions);

  return moduleRanges.map((range) => ({
    cohort: range.cohort,
    moduleKey: range.module,
    instructorCode: range.instructorCode,
    classroomCode: range.classroomCode,
    startDate: range.startDate,
    endDate: range.endDate,
    start: range.startDate,
    end: range.endDate,
    sessionCount: String(range.sessionCount)
  }));
}

export function downloadStaffingCsv(): void {
  if (appState.staffingCohortRanges.length === 0) {
    deps.setStaffingStatus("내보낼 배치 데이터가 없습니다.", true);
    return;
  }

  const mode: ExportFormatKey =
    domRefs.staffExportModeSelect.value === "modules_generic" ? "modules_generic" : "v7e_strict";

  if (mode === "v7e_strict") {
    const strictReady = isV7eStrictReady();
    if (!strictReady.ok) {
      deps.setStaffingStatus(
        `v7e_strict는 P1/P2/365 프리셋 적용 상태에서만 내보낼 수 있습니다. (${strictReady.reason})`,
        true
      );
      return;
    }
  }

  const records = mode === "v7e_strict" ? buildStrictExportRecords() : buildModulesGenericExportRecords();
  const validation = validateRecordsForFormat(mode, records);
  deps.renderStaffExportValidation(validation.errors, validation.warnings);

  if (validation.errors.length > 0) {
    deps.setStaffingStatus("내보내기 검증 오류가 있어 진행할 수 없습니다.", true);
    return;
  }

  if (validation.warnings.length > 0 && !domRefs.staffExportWarningsAgree.checked) {
    deps.setStaffingStatus("경고를 확인한 뒤 체크박스를 선택하면 내보내기를 진행할 수 있습니다.", true);
    return;
  }

  const csv = mode === "v7e_strict" ? exportV7eStrictCsv(records) : exportWithMapping("modules_generic", records);
  const fileName =
    mode === "v7e_strict"
      ? `staffing_v7e_strict_${getTodayCompactDate()}.csv`
      : `staffing_modules_generic_${getTodayCompactDate()}.csv`;
  downloadCsvText(fileName, csv);

  if (mode === "v7e_strict" && domRefs.staffExportIncludeDetails.checked) {
    const detailRows = appState.staffingAssignments
      .sort(
        (a, b) =>
          a.assignee.localeCompare(b.assignee) ||
          a.cohort.localeCompare(b.cohort) ||
          a.phase.localeCompare(b.phase)
      )
      .map((assignment) => [
        assignment.assignee,
        assignment.resourceType,
        assignment.cohort,
        assignment.phase,
        assignment.startDate,
        assignment.endDate,
        String(assignment.workDays),
        getPolicyLabel(assignment.includeWeekdays)
      ]);

    downloadCsvFile(`staffing_v7e_strict_details_${getTodayCompactDate()}.csv`, V7E_STRICT_DETAIL_HEADER, detailRows);
  }

  deps.setStaffingStatus(`${mode} 내보내기를 완료했습니다.`);
}
