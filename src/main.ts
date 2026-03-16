import "./style.css";

declare global {
  interface Window {
    __kpiAllData: KpiAllData | null;
  }
}
import { findAssistantCode, getAssistantSession, setAssistantSession, clearAssistantSession } from "./auth/assistantAuth";
import { initAttendanceDashboard } from "./hrd/hrdAttendance";
import { initAnalytics } from "./hrd/hrdAnalytics";
import { initDropoutDashboard } from "./hrd/hrdDropout";
import { initDashboard } from "./hrd/hrdDashboard";
import { initTraineeHistory } from "./hrd/hrdTraineeHistory";
import { initAssistantCheck } from "./hrd/hrdAssistantCheck";
import { fetchKpiData, testKpiConnection, loadKpiConfig, saveKpiConfig } from "./kpi/kpiSheets";
import { renderKpiDashboard, populateFilters, initKpiTabs, resetKpiDashboard } from "./kpi/kpiReport";
import { printKpiReport } from "./kpi/kpiPdf";
import type { KpiAllData, KpiConfig } from "./kpi/kpiTypes";
import { createTableElement } from "./ui/utils/dom";
import { domRefs } from "./ui/domRefs";
import { generateSchedule } from "./core/calendar";
import { parseCsv } from "./core/csv";
import { removeBasicModeSections } from "./core/basicModeSections";
import {
  createCsvBlob,
  toDayConflictRow,
} from "./ui/utils/csv";
import { detectConflicts } from "./core/conflicts";
import { assignInstructorToModule } from "./core/autoAssignInstructor";
import { exportHrdCsvForCohort } from "./core/export";
import { fromScheduleDaysToSessions } from "./core/fromSchedule";
import { findScheduleTemplate } from "./core/scheduleTemplates";
import { buildSessions } from "./core/sessions";
import {
  type TemplateRowState,
} from "./core/state";
import { resolveShowAdvancedPolicy } from "./core/showAdvancedPolicy";
import { deriveModuleRangesFromSessions } from "./core/staffing";
import { normalizeInstructorCode, normalizeSubjectCode } from "./core/standardize";
import { buildCohortSummaries } from "./core/summary";
import { getKdtScheduleSummaries } from "./hrd/hrdScheduleData";
import { validateHrdExportForCohortDetailed } from "./core/hrdValidation";
import { isDevRuntime, isProdRuntime } from "./core/env";
import {
  CohortSummary,
  DayTimeTemplate,
  Phase,
  ScheduleConfig,
  SkippedDay,
  ResourceType,
  TrackType,
} from "./core/types";
import {
  isInstructorCloudEnabled,
} from "./core/instructorSync";
import {
  addDaysToIso,
  formatDate,
  getTodayIsoDate,
  parseCompactDate,
  parseIsoDate,
} from "./ui/utils/date";
import {
  formatHours,
  getConflictTabLabel,
  isTrackType,
  normalizeTimeInputToHHMM,
  getPolicyForTrack,
} from "./ui/utils/format";
import {
  appState,
  cohortTrackType,
  generatedCohortRanges,
  holidayNameByDate,
  moduleInstructorDraft,
  skipExpanded,
  staffingCellState,
  subjectInstructorMappingDraft,
  type StaffCellState,
  type StaffingMode,
  type ViewMode,
} from "./ui/appState";
import { initEventListeners } from "./ui/events";
import {
  initConflictsFeature,
  setConflictTab,
  renderTimeConflicts,
  applyConflictFilters,
  resetConflictsBeforeCompute,
  downloadVisibleTimeConflictsCsv,
  downloadVisibleInstructorDayConflictsCsv,
  downloadVisibleFoDayConflictsCsv,
  openConflictDetailModal,
  closeConflictDetailModal,
  renderInstructorDayOverlapPanel,
  renderFoDayOverlapPanel,
  applyInstructorDayFilters,
  applyFoDayFilters,
  CONFLICT_COLUMNS,
  DAY_CONFLICT_COLUMNS,
} from "./ui/features/conflicts";
import {
  initTimelineFeature,
  parseTimelineViewType,
  renderTimeline,
  setTimelineViewType,
  startOfWeekIso,
  type TimelineNotificationFocus,
} from "./ui/features/timeline";
import {
  clearHolidayList as holidayClearHolidayList,
  dedupeHolidayList as holidayDedupeHolidayList,
  handleAddCustomBreak as holidayHandleAddCustomBreak,
  handleAddHoliday as holidayHandleAddHoliday,
  handleLoadPublicHolidays as holidayHandleLoadPublicHolidays,
  initHolidaysFeature,
  renderHolidayAndBreakLists as holidayRenderHolidayAndBreakLists,
} from "./ui/features/holidays";
import {
  applySelectedScheduleTemplate as scheduleTemplatesApplySelectedScheduleTemplate,
  applyTemplateRowsState as scheduleTemplatesApplyTemplateRowsState,
  collectTemplateRowsState as scheduleTemplatesCollectTemplateRowsState,
  deleteSelectedScheduleTemplate as scheduleTemplatesDeleteSelectedScheduleTemplate,
  initScheduleTemplatesFeature,
  loadScheduleTemplatesFromLocalStorage as scheduleTemplatesLoadScheduleTemplatesFromLocalStorage,
  renderScheduleTemplateOptions as scheduleTemplatesRenderScheduleTemplateOptions,
  saveCurrentScheduleTemplate as scheduleTemplatesSaveCurrentScheduleTemplate,
} from "./ui/features/scheduleTemplates";
import {
  autoFillStaffingFromCohorts as staffingAutoFillStaffingFromCohorts,
  downloadStaffingCsv as staffingDownloadStaffingCsv,
  initStaffingFeature,
  isV7eStrictReady as staffingIsV7eStrictReady,
  refreshStaffingAnalytics as staffingRefreshStaffingAnalytics,
  renderStaffingSection as staffingRenderStaffingSection,
} from "./ui/features/staffing";
import {
  initSidebarMenuFeature,
  normalizeSidebarMenuConfig,
  getDefaultSidebarMenuConfig,
  loadSidebarMenuConfig,
  saveSidebarMenuConfig,
  cloneSidebarMenuConfig,
  applySidebarMenuConfigToSidebar,
  renderSidebarMenuConfigEditor,
} from "./ui/features/sidebarMenu";
import {
  initNotificationsFeature,
  refreshNotificationItems,
  getCohortNotificationCountMap,
  renderNotificationCenter,
  pushRecentActionLog,
} from "./ui/features/notifications";
import {
  initCourseTemplatesFeature,
  renderCourseTemplateOptions,
  saveCurrentCourseTemplate,
  applySelectedCourseTemplate,
  deleteSelectedCourseTemplate,
} from "./ui/features/courseTemplates";
import {
  initRegistryFeature,
  renderCourseSelectOptions,
  renderCourseRegistry,
  upsertCourseRegistryEntry,
  renderInstructorDirectory,
  upsertInstructorDirectoryEntry,
  renderSubjectDirectory,
  upsertSubjectDirectoryEntry,
  renderSubjectMappingTable,
  applySubjectMappingsToSessions,
  syncCourseTemplateCloud,
  syncDeleteCourseTemplateCloud,
  loadManagementDataFromCloudFallback,
} from "./ui/features/registry";
import {
  initNavigationFeature,
  closeDrawers,
  openDrawer,
  switchInstructorDrawerTab,
  openInstructorDrawerWithTab,
  setNotificationFocus,
  activatePrimarySidebarPage,
  scrollToSection,
  setJibbleManagementSubmenuVisible,
  setJibbleManagementSubmenuActive,
  setJibbleSidebarActive,
  setupJibbleSidebarNavigation,
  renderGlobalWarnings,
  renderRiskSummary,
  renderJibbleRightRail,
  highlightGanttByCohortModule,
} from "./ui/features/navigation";
import {
  initProjectStateFeature,
  serializeProjectState,
  scheduleAutoSave,
  applyLoadedProjectState,
  loadProjectStateFromLocalStorage,
  downloadProjectStateJson,
  importProjectStateFromFile,
  resetAllStateWithConfirm,
} from "./ui/features/projectState";

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

const PHASES: Phase[] = ["P1", "P2", "365"];
const TRACK_TYPES: TrackType[] = ["UNEMPLOYED", "EMPLOYED"];
const MATRIX_RESOURCE_TYPES: ResourceType[] = ["INSTRUCTOR", "FACILITATOR", "OPERATION"];

const TRACK_LABEL: Record<TrackType, string> = {
  UNEMPLOYED: "실업자",
  EMPLOYED: "재직자",
};

const RESOURCE_TYPE_ORDER: Record<ResourceType, number> = {
  INSTRUCTOR: 0,
  FACILITATOR: 1,
  OPERATION: 2,
};

const STORAGE_KEY = "academic_schedule_manager_state_v1";
const AUTH_SESSION_KEY = "academic_schedule_manager_auth_v2";
const AUTH_CODE_V2 = "v2";
const PRINT_CONFLICT_LIMIT = 50;

const DEFAULT_DOWNLOAD_LABEL = "선택한 기수 CSV 다운로드";
const DEFAULT_COMPUTE_LABEL = "충돌 계산";
const RECOMPUTE_LABEL = "충돌 다시 계산";

const fileInput = domRefs.fileInput;
const uploadStatus = domRefs.uploadStatus;
const standardizeStatus = domRefs.standardizeStatus;
const authGate = domRefs.authGate;
const authCodeInput = domRefs.authCodeInput;
const authStatus = domRefs.authStatus;

const stateMigrationBanner = domRefs.stateMigrationBanner;
const stateMigrationList = domRefs.stateMigrationList;
const adminModeToggle = domRefs.adminModeToggle;

const drawerBackdrop = domRefs.drawerBackdrop;
const instructorDrawer = domRefs.instructorDrawer;
const headerRuntimePanel = domRefs.headerRuntimePanel;
const headerCurrentTime = domRefs.headerCurrentTime;
const headerSyncState = domRefs.headerSyncState;
const menuConfigStatus = domRefs.menuConfigStatus;


const cohortSelect = domRefs.cohortSelect;
const cohortInfo = domRefs.cohortInfo;
const downloadButton = domRefs.downloadButton;
const hrdValidationPanel = domRefs.hrdValidationPanel;
const hrdValidationList = domRefs.hrdValidationList;


const scheduleCohortInput = domRefs.scheduleCohortInput;
const scheduleStartDateInput = domRefs.scheduleStartDateInput;
const scheduleTotalHoursInput = domRefs.scheduleTotalHoursInput;
const dayTemplateTable = domRefs.dayTemplateTable;
const scheduleTemplateSelect = domRefs.scheduleTemplateSelect;
const scheduleTemplateNameInput = domRefs.scheduleTemplateNameInput;
const loadScheduleTemplateButton = domRefs.loadScheduleTemplateButton;
const saveScheduleTemplateButton = domRefs.saveScheduleTemplateButton;
const deleteScheduleTemplateButton = domRefs.deleteScheduleTemplateButton;
const scheduleTemplateStatus = domRefs.scheduleTemplateStatus;


const scheduleInstructorCodeInput = domRefs.scheduleInstructorCodeInput;
const scheduleClassroomCodeInput = domRefs.scheduleClassroomCodeInput;
const scheduleSubjectCodeInput = domRefs.scheduleSubjectCodeInput;

const generateScheduleButton = domRefs.generateScheduleButton;
const pushScheduleToConflicts = domRefs.pushScheduleToConflicts;
const appendScheduleButton = domRefs.appendScheduleButton;

const scheduleError = domRefs.scheduleError;
const scheduleResult = domRefs.scheduleResult;
const scheduleSummary = domRefs.scheduleSummary;
const scheduleSkippedSummary = domRefs.scheduleSkippedSummary;
const scheduleSkippedDetails = domRefs.scheduleSkippedDetails;
const scheduleDaysInfo = domRefs.scheduleDaysInfo;
const scheduleDaysPreview = domRefs.scheduleDaysPreview;
const scheduleAppendStatus = domRefs.scheduleAppendStatus;

const staffingStatus = domRefs.staffingStatus;
const staffingModeSelect = domRefs.staffingModeSelect;
const staffingModeHint = domRefs.staffingModeHint;
const staffAutoFillButton = domRefs.staffAutoFillButton;
const staffRefreshButton = domRefs.staffRefreshButton;
const staffExportCsvButton = domRefs.staffExportCsvButton;
const staffExportModeSelect = domRefs.staffExportModeSelect;
const staffExportModeHint = domRefs.staffExportModeHint;
const staffExportWarningsAgree = domRefs.staffExportWarningsAgree;
const staffExportValidationPanel = domRefs.staffExportValidationPanel;
const staffExportValidationList = domRefs.staffExportValidationList;
const staffModuleManagerContainer = domRefs.staffModuleManagerContainer;
const staffModuleManagerContainerAdmin = domRefs.staffModuleManagerContainerAdmin;
const staffAdvancedContainer = domRefs.staffAdvancedContainer;
const staffCohortGantt = domRefs.staffCohortGantt;
const staffAssigneeGantt = domRefs.staffAssigneeGantt;

const errorCount = domRefs.errorCount;
const errorList = domRefs.errorList;
const errorEmpty = domRefs.errorEmpty;

const confCount = domRefs.confCount;
const computeConflictsButton = domRefs.computeConflictsButton;
const keySearchInput = domRefs.keySearchInput;
const downloadTimeConflictsButton = domRefs.downloadTimeConflictsButton;


const saveProjectButton = domRefs.saveProjectButton;
const loadProjectButton = domRefs.loadProjectButton;
const resetProjectButton = domRefs.resetProjectButton;
const printReportButton = domRefs.printReportButton;
const loadProjectInput = domRefs.loadProjectInput;
const stateStorageStatus = domRefs.stateStorageStatus;
const stateStorageWarning = domRefs.stateStorageWarning;

const demoSampleSection = domRefs.demoSampleSection;
const demoSampleSelect = domRefs.demoSampleSelect;
const loadDemoSampleButton = domRefs.loadDemoSampleButton;
const restorePreviousStateButton = domRefs.restorePreviousStateButton;
const demoSampleBanner = domRefs.demoSampleBanner;

const opsChecklistList = domRefs.opsChecklistList;

const printReportCard = domRefs.printReportCard;
const printReportMeta = domRefs.printReportMeta;
const printCohortGantt = domRefs.printCohortGantt;
const printAssigneeGantt = domRefs.printAssigneeGantt;
const printKpiContainer = domRefs.printKpiContainer;
const printConflictTitle = domRefs.printConflictTitle;
const printConflictContainer = domRefs.printConflictContainer;


function isCloudAccessAllowed(): boolean {
  return appState.isAuthVerified;
}

function applyAuthGate(authenticated: boolean): void {
  appState.isAuthVerified = authenticated;
  document.body.classList.toggle("auth-locked", !authenticated);
  authGate.setAttribute("aria-hidden", authenticated ? "true" : "false");

  if (authenticated) {
    authStatus.textContent = "";
    authCodeInput.value = "";
    return;
  }

  authStatus.textContent = "";
  authCodeInput.value = "";
  window.setTimeout(() => {
    authCodeInput.focus();
  }, 0);
}

async function bootstrapAppAfterAuthLogin(): Promise<void> {
  if (!isCloudAccessAllowed() || appState.hasAppBootstrapped) {
    return;
  }

  appState.hasAppBootstrapped = true;
  domRefs.holidayLoadStatus.textContent = "자동 불러오기 미실행";
  demoSampleSection.style.display = isDemoModeEnabled() ? "block" : "none";
  restorePreviousStateButton.disabled = true;
  loadScheduleTemplatesFromLocalStorage();
  renderScheduleTemplateOptions();
  scheduleTemplateStatus.textContent = "템플릿 준비 완료";

  if (localStorage.getItem(STORAGE_KEY)) {
    await loadProjectStateFromLocalStorage();
    return;
  }

  renderInitialUiState();
  await loadManagementDataFromCloudFallback();
}

async function submitAuthCode(): Promise<void> {
  const code = authCodeInput.value.trim();

  // 1) 관리자 코드
  if (code === AUTH_CODE_V2) {
    sessionStorage.setItem(AUTH_SESSION_KEY, "verified");
    clearAssistantSession();
    applyAuthGate(true);
    void bootstrapAppAfterAuthLogin();
    return;
  }

  // 2) 보조강사 코드 (Supabase 조회)
  try {
    const assistant = await findAssistantCode(code);
    if (assistant) {
      sessionStorage.setItem(AUTH_SESSION_KEY, "verified");
      setAssistantSession({
        role: "assistant",
        trainPrId: assistant.trainPrId,
        degr: assistant.degr,
        courseName: assistant.courseName,
      });
      applyAuthGate(true);
      applyAssistantMode(assistant.courseName, assistant.degr);
      window.dispatchEvent(new CustomEvent("assistantLogin"));
      void bootstrapAppAfterAuthLogin();
      return;
    }
  } catch {
    // Supabase 연결 실패 시 에러 표시
    authStatus.textContent = "서버 연결에 실패했습니다. 잠시 후 다시 시도하세요.";
    authCodeInput.select();
    return;
  }

  authStatus.textContent = "인증코드가 올바르지 않습니다.";
  authCodeInput.select();
}

function applyAssistantMode(courseName: string, degr: string): void {
  document.body.classList.add("assistant-mode");

  // 헤더에 보조강사 안내 표시
  const headerEl = document.querySelector(".app-header-title");
  if (headerEl) {
    headerEl.textContent = `📋 ${courseName} ${degr}기 출결현황 (보조강사)`;
  }

  // 로그아웃 바 라벨
  const modeLabel = document.getElementById("assistantModeLabel");
  if (modeLabel) modeLabel.textContent = `📋 ${courseName} ${degr}기 — 보조강사 모드`;

  // 출결현황 탭으로 강제 이동
  const attNavBtn = document.querySelector('[data-nav-key="attendance"]') as HTMLElement | null;
  attNavBtn?.click();

  // 과정/기수 드롭다운 고정
  const session = getAssistantSession();
  if (session) {
    const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
    const degrSelect = document.getElementById("attFilterDegr") as HTMLSelectElement | null;
    if (courseSelect) {
      courseSelect.value = session.trainPrId;
      courseSelect.disabled = true;
    }
    if (degrSelect) {
      degrSelect.value = session.degr;
      degrSelect.disabled = true;
    }
  }
}

function handleLogout(): void {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  clearAssistantSession();
  document.body.classList.remove("assistant-mode");
  applyAuthGate(false);
  location.reload();
}

function buildModuleAssignSummaries(): ModuleAssignSummary[] {
  const ranges = deriveModuleRangesFromSessions(appState.sessions);
  const map = new Map<
    string,
    ModuleAssignSummary & {
      instructorSet: Set<string>;
    }
  >();

  for (const range of ranges) {
    const moduleKey = `${range.cohort}|||${range.module}`;
    const existing = map.get(moduleKey);

    if (!existing) {
      const instructorSet = new Set<string>();
      if (range.instructorCode) {
        instructorSet.add(range.instructorCode);
      }
      map.set(moduleKey, {
        moduleKey,
        cohort: range.cohort,
        module: range.module,
        startDate: range.startDate,
        endDate: range.endDate,
        sessionCount: range.sessionCount,
        instructorCodes: [],
        missingInstructorSessions: range.instructorCode ? 0 : range.sessionCount,
        instructorSet,
      });
      continue;
    }

    existing.startDate = existing.startDate < range.startDate ? existing.startDate : range.startDate;
    existing.endDate = existing.endDate > range.endDate ? existing.endDate : range.endDate;
    existing.sessionCount += range.sessionCount;
    if (range.instructorCode) {
      existing.instructorSet.add(range.instructorCode);
    } else {
      existing.missingInstructorSessions += range.sessionCount;
    }
  }

  return Array.from(map.values())
    .map((item) => ({
      moduleKey: item.moduleKey,
      cohort: item.cohort,
      module: item.module,
      startDate: item.startDate,
      endDate: item.endDate,
      sessionCount: item.sessionCount,
      instructorCodes: Array.from(item.instructorSet).sort((a, b) => a.localeCompare(b)),
      missingInstructorSessions: item.missingInstructorSessions,
    }))
    .sort(
      (a, b) =>
        a.cohort.localeCompare(b.cohort) || a.module.localeCompare(b.module) || a.startDate.localeCompare(b.startDate),
    );
}

function getCurrentInstructorCodeForModule(summary: ModuleAssignSummary): string {
  const draft = moduleInstructorDraft.get(summary.moduleKey);
  if (draft !== undefined) {
    return draft;
  }

  if (summary.instructorCodes.length === 1 && summary.missingInstructorSessions === 0) {
    return summary.instructorCodes[0] ?? "";
  }

  return "";
}

function isModuleInstructorApplied(summary: ModuleAssignSummary): boolean {
  return summary.instructorCodes.length === 1 && summary.missingInstructorSessions === 0;
}

function buildConflictModuleKeySet(): Set<string> {
  const keys = new Set<string>();

  if (!appState.hasComputedConflicts) {
    return keys;
  }

  for (const conflict of appState.allConflicts) {
    const moduleA = normalizeSubjectCode(conflict.A교과목);
    const moduleB = normalizeSubjectCode(conflict.B교과목);
    const cohortA = conflict.과정A.trim();
    const cohortB = conflict.과정B.trim();

    if (cohortA && moduleA) {
      keys.add(`${cohortA}|||${moduleA}`);
    }
    if (cohortB && moduleB) {
      keys.add(`${cohortB}|||${moduleB}`);
    }
  }

  return keys;
}

function recomputeTimeConflictsImmediate(): void {
  appState.allConflicts = detectConflicts(appState.sessions, { resourceTypes: ["INSTRUCTOR"] });
  appState.hasComputedConflicts = true;
  computeConflictsButton.textContent = RECOMPUTE_LABEL;
  applyConflictFilters();
}

function applyInstructorToModuleSummary(summary: ModuleAssignSummary, rawInstructorCode: string): void {
  const normalizedCode = normalizeInstructorCode(rawInstructorCode);
  if (!normalizedCode) {
    setStaffingStatus(`❌ ${summary.moduleKey}: 강사코드를 입력해 주세요.`, true);
    return;
  }

  const beforeTargets = appState.sessions.filter(
    (session) =>
      session.과정기수.trim() === summary.cohort &&
      normalizeSubjectCode(session["교과목(및 능력단위)코드"]) === summary.module,
  );

  if (beforeTargets.length === 0) {
    setStaffingStatus(`❌ ${summary.moduleKey}: 배정할 수업시간표를 찾지 못했습니다.`, true);
    return;
  }

  const overwriteCount = beforeTargets.filter((session) => {
    const beforeCode = normalizeInstructorCode(session.훈련강사코드);
    return beforeCode.length > 0 && beforeCode !== normalizedCode;
  }).length;

  appState.sessions = assignInstructorToModule({
    sessions: appState.sessions,
    moduleKey: summary.moduleKey,
    instructorCode: normalizedCode,
  });
  moduleInstructorDraft.set(summary.moduleKey, normalizedCode);

  regenerateSummariesAndTimeline(cohortSelect.value);
  recomputeTimeConflictsImmediate();
  scheduleAutoSave();

  if (overwriteCount > 0) {
    setStaffingStatus(
      `⚠ ${summary.moduleKey}: ${beforeTargets.length}개 수업시간표 배정 완료 (${overwriteCount}개 기존 강사코드 덮어씀).`,
    );
    return;
  }

  setStaffingStatus(`✅ ${summary.moduleKey}: ${beforeTargets.length}개 수업시간표 강사 자동 배정 완료.`);
}

function renderStaffModuleManagerTable(isBusy = false): void {
  staffModuleManagerContainer.innerHTML = "";

  const moduleRows = buildModuleAssignSummaries();
  if (moduleRows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "수업시간표가 없어 운영매니저 교과목 배치표를 표시할 수 없습니다.";
    staffModuleManagerContainer.appendChild(empty);
    return;
  }

  const conflictKeys = buildConflictModuleKeySet();
  const table = document.createElement("table");
  table.className = "module-assign-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["교과목(moduleKey)", "기간", "강사코드", "자동 배정 상태", "시간 충돌 여부"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const summary of moduleRows) {
    const tr = document.createElement("tr");
    const hasConflict = conflictKeys.has(summary.moduleKey);
    if (hasConflict) {
      tr.classList.add("module-assign-row-conflict");
    }

    const moduleCell = document.createElement("td");
    moduleCell.textContent = summary.moduleKey;
    tr.appendChild(moduleCell);

    const periodCell = document.createElement("td");
    periodCell.textContent = `${summary.startDate} ~ ${summary.endDate} (${summary.sessionCount}개 수업시간표)`;
    tr.appendChild(periodCell);

    const inputCell = document.createElement("td");
    const inputWrap = document.createElement("div");
    inputWrap.className = "row";
    inputWrap.style.alignItems = "center";

    const codeInput = document.createElement("input");
    codeInput.type = "text";
    codeInput.value = getCurrentInstructorCodeForModule(summary);
    codeInput.placeholder = "강사코드";
    codeInput.disabled = isBusy;

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.textContent = "적용";
    applyButton.disabled = isBusy;
    applyButton.addEventListener("click", () => {
      applyInstructorToModuleSummary(summary, codeInput.value);
    });

    inputWrap.appendChild(codeInput);
    inputWrap.appendChild(applyButton);
    inputCell.appendChild(inputWrap);
    tr.appendChild(inputCell);

    const statusCell = document.createElement("td");

    const renderStatusCell = (): void => {
      const effectiveCode = normalizeInstructorCode(codeInput.value);
      if (isModuleInstructorApplied(summary) && effectiveCode === (summary.instructorCodes[0] ?? "")) {
        statusCell.textContent = "✅ 배정 완료";
        statusCell.className = "module-assign-status-ok";
        return;
      }

      if (!effectiveCode) {
        statusCell.textContent = "❌ 강사코드 미입력";
      } else {
        statusCell.textContent = "❌ 적용 필요";
      }
      statusCell.className = "module-assign-status-error";
    };

    codeInput.addEventListener("input", () => {
      moduleInstructorDraft.set(summary.moduleKey, codeInput.value);
      renderStatusCell();
    });

    renderStatusCell();
    tr.appendChild(statusCell);

    const conflictCell = document.createElement("td");
    if (!appState.hasComputedConflicts) {
      conflictCell.textContent = "⚠ 충돌 미계산";
      conflictCell.className = "module-assign-status-warn";
    } else if (hasConflict) {
      conflictCell.textContent = "⚠ 충돌 발생";
      conflictCell.className = "module-assign-status-error";
    } else {
      conflictCell.textContent = "✅ 충돌 없음";
      conflictCell.className = "module-assign-status-ok";
    }
    tr.appendChild(conflictCell);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  staffModuleManagerContainer.appendChild(table);
  staffModuleManagerContainerAdmin.innerHTML = "운영 화면의 빠른 수정 테이블과 동일한 데이터가 표시됩니다.";
}























function applyViewMode(mode: ViewMode): void {
  appState.viewMode = mode;
  document.body.classList.toggle("simple-mode", mode === "simple");
}

function resolveShowAdvanced(savedShowAdvanced: boolean | undefined): boolean {
  return resolveShowAdvancedPolicy({
    savedShowAdvanced,
    search: window.location.search,
    isDev: isDevRuntime(),
    isProd: isProdRuntime(),
  });
}

function applyShowAdvancedMode(enabled: boolean): void {
  appState.showAdvanced = enabled;
  document.body.classList.toggle("admin-mode", enabled);
  if (!enabled && !appState.hasPrunedBasicModeSections) {
    removeBasicModeSections(document);
    appState.hasPrunedBasicModeSections = true;
  }
  if (adminModeToggle) {
    adminModeToggle.checked = enabled;
  }
}

function resolveManagementInlineMode(): boolean {
  return true;
}

function applyManagementInlineMode(): void {
  appState.managementInlineMode = resolveManagementInlineMode();
  document.body.classList.toggle("management-inline-mode", appState.managementInlineMode);

  if (appState.managementInlineMode) {
    instructorDrawer.classList.add("open");
    instructorDrawer.setAttribute("aria-hidden", "false");
    drawerBackdrop.classList.remove("open");
    if (appState.activeDrawer === "instructor") {
      appState.activeDrawer = null;
    }
    return;
  }

  if (appState.activeDrawer !== "instructor") {
    instructorDrawer.classList.remove("open");
    instructorDrawer.setAttribute("aria-hidden", "true");
  }
}

function renderHeaderRuntimeStatus(): void {
  headerCurrentTime.textContent = new Date().toLocaleTimeString("ko-KR", { hour12: false });

  const cloudEnabled = isInstructorCloudEnabled();
  const hasWarning = appState.instructorDirectoryCloudWarning.trim().length > 0;
  const isHealthy = cloudEnabled && !hasWarning;

  headerRuntimePanel.classList.remove("runtime-online", "runtime-warning");
  headerSyncState.classList.remove("runtime-online", "runtime-warning");
  if (isHealthy) {
    headerSyncState.textContent = "클라우드 동기화 정상";
    headerSyncState.classList.add("runtime-online");
    headerRuntimePanel.classList.add("runtime-online");
    return;
  }

  if (cloudEnabled) {
    headerSyncState.textContent = "동기화 점검 필요";
  } else {
    headerSyncState.textContent = "로컬 모드";
  }
  headerSyncState.classList.add("runtime-warning");
  headerRuntimePanel.classList.add("runtime-warning");
}

function markQuickNavUpdated(target: "course" | "subject" | "instructor" | "mapping"): void {
  const stamp = new Date().toLocaleString("ko-KR", { hour12: false });
  const text = `최근 수정: ${stamp}`;
  if (target === "course") {
    domRefs.quickNavCourseMeta.textContent = text;
    return;
  }
  if (target === "subject") {
    domRefs.quickNavSubjectMeta.textContent = text;
    return;
  }
  if (target === "instructor") {
    domRefs.quickNavInstructorMeta.textContent = text;
    return;
  }
  domRefs.quickNavMappingMeta.textContent = text;
}






function applyStaffingMode(mode: StaffingMode): void {
  appState.staffingMode = mode;
  staffingModeSelect.value = mode;
  const managerMode = mode === "manager";
  staffModuleManagerContainer.style.display = managerMode ? "block" : "none";
  staffAdvancedContainer.style.display = managerMode ? "none" : "block";
  staffingModeHint.textContent = managerMode
    ? "운영매니저 모드: 교과목별 강사코드를 입력하면 즉시 수업시간표에 자동 배정하고 시간 충돌을 다시 계산합니다."
    : "고급 모드: 코호트별 P1/P2/365, resourceType, 기간 정책까지 상세 편집합니다.";
}





















function getTrackTypeMissingCohorts(): string[] {
  return appState.summaries
    .map((summary) => summary.과정기수)
    .filter((cohort) => !isTrackType(cohortTrackType.get(cohort)));
}

function getUnassignedInstructorModules(): string[] {
  if (appState.staffingMode === "manager") {
    return buildModuleAssignSummaries()
      .filter((item) => !isModuleInstructorApplied(item))
      .map((item) => item.moduleKey)
      .sort((a, b) => a.localeCompare(b));
  }

  const missing = new Set<string>();

  const sessionCohorts = new Set(appState.sessions.map((session) => session.과정기수));
  for (const cohort of sessionCohorts) {
    const hasInstructorAssignee = appState.staffingAssignments.some(
      (assignment) =>
        assignment.cohort === cohort &&
        assignment.resourceType === "INSTRUCTOR" &&
        assignment.assignee.trim().length > 0,
    );
    if (!hasInstructorAssignee) {
      missing.add(`${cohort} (강사 미배정)`);
    }
  }

  for (const range of appState.staffingCohortRanges) {
    for (const phase of PHASES) {
      const state = getStaffCellState(range.cohort, phase);
      if (state.resourceType !== "INSTRUCTOR") {
        continue;
      }

      if (!state.assignee.trim() || !state.startDate || !state.endDate) {
        missing.add(`${range.cohort} ${phase}`);
      }
    }
  }

  return Array.from(missing).sort((a, b) => a.localeCompare(b));
}

function isHolidayApplied(): boolean {
  return appState.hasLoadedPublicHoliday || appState.holidayDates.length > 0;
}

function isHrdChecklistPassed(): boolean {
  return (
    appState.sessions.length > 0 &&
    Boolean(cohortSelect.value) &&
    appState.hrdValidationErrors.length === 0 &&
    appState.hasComputedConflicts &&
    appState.allConflicts.length === 0 &&
    appState.instructorDayOverlaps.length === 0 &&
    appState.facilitatorOperationOverlaps.length === 0 &&
    isHolidayApplied() &&
    getTrackTypeMissingCohorts().length === 0 &&
    getUnassignedInstructorModules().length === 0
  );
}







function collectTemplateRowsState(): TemplateRowState[] {
  return scheduleTemplatesCollectTemplateRowsState();
}

function applyTemplateRowsState(rows: TemplateRowState[] | undefined): void {
  scheduleTemplatesApplyTemplateRowsState(rows);
}

function loadScheduleTemplatesFromLocalStorage(): void {
  scheduleTemplatesLoadScheduleTemplatesFromLocalStorage();
}

function renderScheduleTemplateOptions(preferredName = ""): void {
  scheduleTemplatesRenderScheduleTemplateOptions(preferredName);
}

function applySelectedScheduleTemplate(): void {
  scheduleTemplatesApplySelectedScheduleTemplate();
}

function saveCurrentScheduleTemplate(): void {
  scheduleTemplatesSaveCurrentScheduleTemplate();
}

function deleteSelectedScheduleTemplate(): void {
  scheduleTemplatesDeleteSelectedScheduleTemplate();
}

















function renderInitialUiState(): void {
  applyViewMode("full");
  setTimelineViewType("COHORT_TIMELINE");
  applyStaffingMode(staffingModeSelect.value === "advanced" ? "advanced" : "manager");
  applyShowAdvancedMode(resolveShowAdvanced(false));
  setStateMigrationWarnings([]);
  renderScheduleTemplateOptions();
  renderHolidayAndBreakLists();
  renderGeneratedScheduleResult();
  regenerateSummariesAndTimeline();
  renderErrors();
  renderHrdValidationErrors();
  renderTimeConflicts();
  setConflictTab("time");
  updateActionStates();
}

function getDefaultTrackTypeForCohort(cohort: string): TrackType {
  const hasSaturday = appState.sessions.some((session) => {
    if (session.과정기수 !== cohort) {
      return false;
    }
    const parsed = parseCompactDate(session.훈련일자);
    return parsed?.getUTCDay() === 6;
  });

  return hasSaturday ? "EMPLOYED" : "UNEMPLOYED";
}

function staffCellKey(cohort: string, phase: Phase): string {
  return `${cohort}|||${phase}`;
}

function getStaffCellState(cohort: string, phase: Phase): StaffCellState {
  return (
    staffingCellState.get(staffCellKey(cohort, phase)) ?? {
      assignee: "",
      startDate: "",
      endDate: "",
      resourceType: "FACILITATOR",
    }
  );
}

function setStaffCellState(cohort: string, phase: Phase, next: StaffCellState): void {
  staffingCellState.set(staffCellKey(cohort, phase), next);
  scheduleAutoSave();
}

function setScheduleError(message: string | null): void {
  if (!message) {
    scheduleError.style.display = "none";
    scheduleError.textContent = "";
    return;
  }

  scheduleError.style.display = "block";
  scheduleError.textContent = message;
}

function setStaffingStatus(message: string, isError = false): void {
  staffingStatus.textContent = message;
  staffingStatus.style.color = isError ? "#b42318" : "";
}

function setUploadProcessingState(processing: boolean): void {
  appState.isUploadProcessing = processing;
  uploadStatus.textContent = processing ? "처리중..." : uploadStatus.textContent;

  if (processing) {
    downloadButton.textContent = "처리중...";
  } else {
    downloadButton.textContent = DEFAULT_DOWNLOAD_LABEL;
  }

  updateActionStates();
}

function setHolidayLoadingState(loading: boolean): void {
  appState.isHolidayLoading = loading;
  domRefs.holidayLoadSpinner.style.display = loading ? "inline-block" : "none";
  domRefs.loadPublicHolidaysButton.textContent = loading ? "불러오는 중..." : "공휴일 불러오기(대한민국)";
  updateActionStates();
}

function updateActionStates(): void {
  const hasSessions = appState.sessions.length > 0;
  const canComputeConflicts = hasSessions && !appState.isUploadProcessing;
  const canUseConflictControls =
    appState.hasComputedConflicts && !appState.isConflictComputing && !appState.isUploadProcessing;
  const isBusy = appState.isUploadProcessing || appState.isConflictComputing || appState.isHolidayLoading;
  const advancedMode = appState.staffingMode === "advanced";
  const canDownloadHrd = hasSessions && !appState.isUploadProcessing;

  fileInput.disabled = appState.isUploadProcessing;
  cohortSelect.disabled = !hasSessions || appState.isUploadProcessing;
  downloadButton.disabled = !canDownloadHrd;

  computeConflictsButton.disabled = !canComputeConflicts || appState.isConflictComputing;
  keySearchInput.disabled = !canUseConflictControls;
  downloadTimeConflictsButton.disabled = !canUseConflictControls || appState.visibleConflicts.length === 0;
  domRefs.downloadInstructorDayConflictsButton.disabled = isBusy || appState.visibleInstructorDayOverlaps.length === 0;
  domRefs.downloadFoDayConflictsButton.disabled = isBusy || appState.visibleFoDayOverlaps.length === 0;

  generateScheduleButton.disabled = isBusy;
  domRefs.addHolidayButton.disabled = isBusy;
  domRefs.loadPublicHolidaysButton.disabled = isBusy;
  domRefs.clearHolidaysButton.disabled = isBusy;
  domRefs.dedupeHolidaysButton.disabled = isBusy;
  domRefs.addCustomBreakButton.disabled = isBusy;
  scheduleTemplateSelect.disabled = isBusy;
  scheduleTemplateNameInput.disabled = isBusy;
  loadScheduleTemplateButton.disabled = isBusy || appState.scheduleTemplates.length === 0;
  saveScheduleTemplateButton.disabled = isBusy;
  if (isBusy) {
    deleteScheduleTemplateButton.disabled = true;
  } else {
    const selectedTemplate = findScheduleTemplate(appState.scheduleTemplates, scheduleTemplateSelect.value);
    deleteScheduleTemplateButton.disabled =
      Boolean(selectedTemplate?.builtIn) || appState.scheduleTemplates.length === 0;
  }

  staffAutoFillButton.disabled = isBusy || appState.staffingCohortRanges.length === 0 || !advancedMode;
  staffRefreshButton.disabled = isBusy || !advancedMode;
  const strictCheck = staffExportModeSelect.value === "v7e_strict" ? isV7eStrictReady() : { ok: true };
  const strictReady = strictCheck.ok;
  staffExportCsvButton.disabled = isBusy || appState.staffingCohortRanges.length === 0 || !strictReady || !advancedMode;
  staffExportCsvButton.title = !strictReady ? `v7e_strict 비활성: ${strictCheck.reason ?? "프리셋 미적용"}` : "";
  staffExportWarningsAgree.disabled = isBusy || !advancedMode;
  if (staffExportModeSelect.value === "v7e_strict") {
    staffExportModeHint.textContent = strictReady
      ? "v7e_strict 활성: v7-E 표준 헤더/순서로 내보냅니다."
      : `v7e_strict 비활성: ${strictCheck.reason ?? "P1/P2/365 프리셋 기간이 필요합니다."}`;
  } else {
    staffExportModeHint.textContent = "modules_generic 활성: 수업시간표 기반 교과목 범위를 내보냅니다.";
  }
  saveProjectButton.disabled = isBusy;
  loadProjectButton.disabled = isBusy;
  resetProjectButton.disabled = isBusy;
  printReportButton.disabled = isBusy;
  domRefs.openConflictDetailModalButton.disabled = isBusy;
  loadDemoSampleButton.disabled = isBusy;
  restorePreviousStateButton.disabled = isBusy || appState.previousStateBeforeSampleLoad === null;
  domRefs.upsertCourseButton.disabled = isBusy;
  domRefs.upsertInstructorButton.disabled = isBusy;
  domRefs.upsertSubjectButton.disabled = isBusy;
  domRefs.applySubjectMappingsButton.disabled = isBusy || appState.sessions.length === 0;

  const canAppendSchedule =
    appState.generatedScheduleResult !== null &&
    appState.generatedScheduleResult.days.length > 0 &&
    pushScheduleToConflicts.checked &&
    !isBusy;

  appendScheduleButton.disabled = !canAppendSchedule;
  renderStaffModuleManagerTable(isBusy);
  renderCourseRegistry();
  renderCourseSelectOptions();
  renderCourseTemplateOptions();
  renderInstructorDirectory();
  renderSubjectDirectory();
  renderSubjectMappingTable();
  updateStandardizeStatus();
  renderGlobalWarnings();
  renderNotificationCenter();
  renderTimeline();
  renderRiskSummary();
  renderJibbleRightRail();
  renderOpsChecklist();
}

function setCohortOptions(cohortSummaries: CohortSummary[], preferredCohort = ""): void {
  const previous = preferredCohort || cohortSelect.value;

  cohortSelect.innerHTML = "";

  for (const summary of cohortSummaries) {
    const option = document.createElement("option");
    option.value = summary.과정기수;
    option.textContent = summary.과정기수;
    cohortSelect.appendChild(option);
  }

  if (cohortSummaries.length > 0) {
    const hasPreferred = cohortSummaries.some((item) => item.과정기수 === previous);
    cohortSelect.value = hasPreferred ? previous : cohortSummaries[0].과정기수;
  }

  updateCohortInfo();
}

function updateCohortInfo(): void {
  const cohort = cohortSelect.value;
  const summary = appState.summaries.find((item) => item.과정기수 === cohort);

  if (!summary) {
    cohortInfo.textContent = "기간:  ~  / 훈련일수: 0 / 수업시간표 건수: 0";
    appState.hrdValidationErrors = [];
    appState.hrdValidationWarnings = [];
    renderHrdValidationErrors();
    updateActionStates();
    return;
  }

  cohortInfo.textContent = `기간: ${summary.시작일} ~ ${summary.종료일} / 훈련일수: ${summary.훈련일수} / 수업시간표 건수: ${summary.세션수}`;
  refreshHrdValidation();
  scheduleAutoSave();
}

function renderErrors(): void {
  errorCount.textContent = `총 ${appState.parseErrors.length}건`;
  errorList.innerHTML = "";

  if (appState.parseErrors.length === 0) {
    errorEmpty.style.display = "block";
    return;
  }

  errorEmpty.style.display = "none";

  const topErrors = appState.parseErrors.slice(0, 10);
  for (const item of topErrors) {
    const li = document.createElement("li");
    li.textContent = `[행 ${item.rowIndex}] ${item.message}`;
    errorList.appendChild(li);
  }
}

function renderHrdValidationErrors(): void {
  hrdValidationList.innerHTML = "";

  if (appState.hrdValidationErrors.length === 0 && appState.hrdValidationWarnings.length === 0) {
    hrdValidationPanel.style.display = "none";
    return;
  }

  hrdValidationPanel.style.display = "block";

  for (const message of appState.hrdValidationErrors) {
    const li = document.createElement("li");
    li.textContent = `[ERROR] ${message}`;
    hrdValidationList.appendChild(li);
  }

  for (const message of appState.hrdValidationWarnings) {
    const li = document.createElement("li");
    li.textContent = `[WARN] ${message}`;
    hrdValidationList.appendChild(li);
  }
}

function renderStaffExportValidation(errors: string[], warnings: string[]): void {
  staffExportValidationList.innerHTML = "";

  if (errors.length === 0 && warnings.length === 0) {
    staffExportValidationPanel.style.display = "none";
    return;
  }

  staffExportValidationPanel.style.display = "block";

  for (const error of errors) {
    const li = document.createElement("li");
    li.textContent = `[ERROR] ${error}`;
    staffExportValidationList.appendChild(li);
  }

  for (const warning of warnings) {
    const li = document.createElement("li");
    li.textContent = `[WARN] ${warning}`;
    staffExportValidationList.appendChild(li);
  }
}

function updateStandardizeStatus(): void {
  const hasStandardizedData = appState.sessions.length > 0 || (appState.generatedScheduleResult?.days.length ?? 0) > 0;
  standardizeStatus.style.display = hasStandardizedData ? "block" : "none";
}

function renderStateMigrationWarnings(): void {
  stateMigrationList.innerHTML = "";

  if (appState.stateMigrationWarnings.length === 0) {
    stateMigrationBanner.style.display = "none";
    return;
  }

  stateMigrationBanner.style.display = "block";

  for (const warning of appState.stateMigrationWarnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    stateMigrationList.appendChild(li);
  }
}

function setStateMigrationWarnings(warnings: string[]): void {
  appState.stateMigrationWarnings = [...warnings];
  renderStateMigrationWarnings();
}

function isDemoModeEnabled(): boolean {
  return new URLSearchParams(window.location.search).get("demo") === "1";
}

function setDemoSampleBanner(message: string | null): void {
  if (!message) {
    demoSampleBanner.style.display = "none";
    demoSampleBanner.textContent = "";
    return;
  }

  demoSampleBanner.style.display = "block";
  demoSampleBanner.textContent = message;
}

async function loadDemoSampleState(): Promise<void> {
  const fileName = demoSampleSelect.value;
  appState.previousStateBeforeSampleLoad = serializeProjectState();

  const response = await fetch(`samples/${fileName}`);
  if (!response.ok) {
    throw new Error(`샘플 파일을 불러오지 못했습니다. (${response.status})`);
  }

  const sampleState = (await response.json()) as unknown;
  applyLoadedProjectState(sampleState);
  restorePreviousStateButton.disabled = appState.previousStateBeforeSampleLoad === null;
  setDemoSampleBanner(`샘플 로드됨: ${fileName}`);
  scheduleAutoSave();
}

function restoreStateBeforeSampleLoad(): void {
  if (!appState.previousStateBeforeSampleLoad) {
    return;
  }

  applyLoadedProjectState(appState.previousStateBeforeSampleLoad);
  appState.previousStateBeforeSampleLoad = null;
  restorePreviousStateButton.disabled = true;
  setDemoSampleBanner("샘플 적용 전 상태로 복원했습니다.");
  scheduleAutoSave();
}

function validateHrdExportForCohortWithWarnings(cohort: string): { errors: string[]; warnings: string[] } {
  const subjectCodes = new Set(appState.subjectDirectory.map((item) => item.subjectCode));
  return validateHrdExportForCohortDetailed(
    appState.sessions,
    cohort,
    appState.holidayDates,
    holidayNameByDate,
    subjectCodes,
  );
}

function refreshHrdValidation(): void {
  const cohort = cohortSelect.value;
  const validation = cohort ? validateHrdExportForCohortWithWarnings(cohort) : { errors: [], warnings: [] };
  appState.hrdValidationErrors = validation.errors;
  appState.hrdValidationWarnings = validation.warnings;
  renderHrdValidationErrors();
  updateActionStates();
}

function renderOpsChecklist(): void {
  opsChecklistList.innerHTML = "";

  const hrdPass = isHrdChecklistPassed();
  const trackTypeMissing = getTrackTypeMissingCohorts();
  const unassignedInstructorModules = getUnassignedInstructorModules();
  const trackTypeComplete =
    trackTypeMissing.length === 0 &&
    (appState.staffingCohortRanges.length === 0 ||
      appState.staffingCohortRanges.every(
        (range) => isTrackType(range.trackType) && getPolicyForTrack(range.trackType).length > 0,
      ));

  const items: Array<{ label: string; ok: boolean; warn?: boolean }> = [
    {
      label: `HRD CSV 다운로드 검증 ${hrdPass ? "통과" : "미통과"}`,
      ok: hrdPass,
      warn: true,
    },
    {
      label: appState.hasComputedConflicts
        ? `강사 시간 충돌 ${appState.allConflicts.length === 0 ? "0건" : `${appState.allConflicts.length}건`}`
        : "강사 시간 충돌 미계산",
      ok: appState.hasComputedConflicts && appState.allConflicts.length === 0,
      warn: true,
    },
    {
      label: `강사 배치(일) 충돌 ${appState.instructorDayOverlaps.length === 0 ? "0건" : `${appState.instructorDayOverlaps.length}건`}`,
      ok: appState.instructorDayOverlaps.length === 0,
      warn: appState.staffingAssignments.length > 0,
    },
    {
      label: `퍼실/운영 배치(일) 충돌 ${appState.facilitatorOperationOverlaps.length === 0 ? "0건" : `${appState.facilitatorOperationOverlaps.length}건`}`,
      ok: appState.facilitatorOperationOverlaps.length === 0,
      warn: appState.staffingAssignments.length > 0,
    },
    {
      label: `공휴일 자동 로드 ${appState.hasLoadedPublicHoliday ? "적용" : "미적용"}`,
      ok: appState.hasLoadedPublicHoliday,
      warn: true,
    },
    {
      label: `trackType 설정 ${trackTypeComplete ? "완료" : "누락"}`,
      ok: trackTypeComplete,
      warn: appState.staffingCohortRanges.length > 0,
    },
    {
      label:
        unassignedInstructorModules.length === 0
          ? "강사 배정 누락 없음"
          : `강사 배정 누락 ${unassignedInstructorModules.length}건`,
      ok: unassignedInstructorModules.length === 0,
      warn: true,
    },
  ];

  for (const item of items) {
    const li = document.createElement("li");
    if (item.ok) {
      li.className = "check-ok";
      li.textContent = `OK - ${item.label}`;
    } else if (item.warn) {
      li.className = "check-warn";
      li.textContent = `WARN - ${item.label}`;
    } else {
      li.className = "check-fail";
      li.textContent = `FAIL - ${item.label}`;
    }
    opsChecklistList.appendChild(li);
  }
}

async function computeConflicts(): Promise<void> {
  if (appState.sessions.length === 0 || appState.isConflictComputing) {
    return;
  }

  appState.isConflictComputing = true;
  computeConflictsButton.textContent = "계산중...";
  confCount.textContent = "계산중...";
  updateActionStates();

  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), 0);
  });

  if (appState.sessions.length >= 10000) {
    console.warn(`[conflict-calc] 세션 수가 많습니다: ${appState.sessions.length}건`);
  }

  appState.allConflicts = detectConflicts(appState.sessions, { resourceTypes: ["INSTRUCTOR"] });
  appState.hasComputedConflicts = true;

  appState.isConflictComputing = false;
  computeConflictsButton.textContent = RECOMPUTE_LABEL;
  applyConflictFilters();
  scheduleAutoSave();
}

function downloadCohortCSV(): void {
  const cohort = cohortSelect.value;
  if (!cohort) {
    return;
  }

  const validation = validateHrdExportForCohortWithWarnings(cohort);
  appState.hrdValidationErrors = validation.errors;
  appState.hrdValidationWarnings = validation.warnings;
  renderHrdValidationErrors();
  if (validation.errors.length > 0) {
    updateActionStates();
    return;
  }

  const generatedDays =
    cohort === appState.generatedScheduleCohort && appState.generatedScheduleResult
      ? appState.generatedScheduleResult.days
      : undefined;
  const { csv, rowWarning } = exportHrdCsvForCohort(appState.sessions, cohort, { generatedDays });
  if (rowWarning) {
    pushRecentActionLog("WARNING", rowWarning, "hrdDownloadCard");
  }
  const blob = createCsvBlob(csv);
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = `${cohort}_HRD_업로드용.csv`;
  link.click();

  URL.revokeObjectURL(url);
  if (validation.warnings.length > 0) {
    pushRecentActionLog(
      "WARNING",
      `경고: 교과목/강사 누락 ${validation.warnings.length}건 (다운로드는 허용)`,
      "hrdDownloadCard",
    );
  }
  pushRecentActionLog("INFO", `HRD CSV 다운로드 완료: ${cohort}`, "hrdDownloadCard");
  updateActionStates();
}




function buildPrintReport(): void {
  printReportMeta.textContent = `생성시각: ${new Date().toLocaleString()} / 선택 탭: ${getConflictTabLabel(appState.activeConflictTab)}`;
  printCohortGantt.innerHTML = staffCohortGantt.innerHTML;
  printAssigneeGantt.innerHTML = staffAssigneeGantt.innerHTML;

  const sourceKpiTable = document.querySelector<HTMLTableElement>("#staffKpiTable");
  printKpiContainer.innerHTML = "";
  if (sourceKpiTable) {
    printKpiContainer.appendChild(sourceKpiTable.cloneNode(true));
  }

  let conflictColumns: readonly string[];
  let conflictRows: string[][];

  if (appState.activeConflictTab === "time") {
    conflictColumns = CONFLICT_COLUMNS;
    conflictRows = appState.visibleConflicts
      .slice(0, PRINT_CONFLICT_LIMIT)
      .map((conflict) => [
        conflict.기준,
        conflict.일자,
        conflict.키,
        conflict.과정A,
        conflict.A시간,
        conflict.A교과목,
        conflict.과정B,
        conflict.B시간,
        conflict.B교과목,
      ]);
  } else if (appState.activeConflictTab === "instructor_day") {
    conflictColumns = DAY_CONFLICT_COLUMNS;
    conflictRows = appState.visibleInstructorDayOverlaps
      .slice(0, PRINT_CONFLICT_LIMIT)
      .map((item) => toDayConflictRow(item));
  } else {
    conflictColumns = DAY_CONFLICT_COLUMNS;
    conflictRows = appState.visibleFoDayOverlaps.slice(0, PRINT_CONFLICT_LIMIT).map((item) => toDayConflictRow(item));
  }

  printConflictTitle.textContent = `${getConflictTabLabel(appState.activeConflictTab)} 상위 ${PRINT_CONFLICT_LIMIT}건`;
  printConflictContainer.innerHTML = "";
  printConflictContainer.appendChild(createTableElement(conflictColumns, conflictRows));
}

function printReport(): void {
  buildPrintReport();
  printReportCard.style.display = "block";
  window.print();
}

function renderHolidayAndBreakLists(): void {
  holidayRenderHolidayAndBreakLists();
}

function parseTemplateRows(): { dayTemplates: DayTimeTemplate[]; weekdays: number[] } {
  const rows = Array.from(dayTemplateTable.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const dayTemplates: DayTimeTemplate[] = [];
  const weekdaySet = new Set<number>();

  for (const row of rows) {
    const weekdayRaw = row.dataset.weekday;
    const weekday = Number.parseInt(weekdayRaw ?? "", 10);
    const weekdayLabel = row.querySelector("td")?.textContent?.trim() ?? `요일(${weekdayRaw})`;

    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error(`${weekdayLabel} 템플릿의 weekday 값이 올바르지 않습니다.`);
    }

    const startInput = row.querySelector<HTMLInputElement>(".tpl-start");
    const endInput = row.querySelector<HTMLInputElement>(".tpl-end");
    const breakCheck = row.querySelector<HTMLInputElement>(".tpl-break-check");
    const breakStartInput = row.querySelector<HTMLInputElement>(".tpl-break-start");

    if (!startInput || !endInput) {
      throw new Error(`${weekdayLabel} 템플릿 입력 요소를 찾을 수 없습니다.`);
    }

    const startValue = startInput.value.trim();
    const endValue = endInput.value.trim();
    const hasLunch = breakCheck?.checked ?? false;
    const breakStartValue = hasLunch ? (breakStartInput?.value.trim() ?? "") : "";

    const hasClassRange = startValue.length > 0 || endValue.length > 0;

    if (!hasClassRange && !hasLunch) {
      continue;
    }

    if (!hasClassRange && hasLunch) {
      throw new Error(`${weekdayLabel}은 점심시간만 설정할 수 없습니다. 수업 시작/종료를 입력해 주세요.`);
    }

    if (!startValue || !endValue) {
      throw new Error(`${weekdayLabel} 수업 시작/종료 시간을 모두 입력해 주세요.`);
    }

    const startHHMM = normalizeTimeInputToHHMM(startValue);
    const endHHMM = normalizeTimeInputToHHMM(endValue);

    if (!startHHMM || !endHHMM) {
      throw new Error(`${weekdayLabel} 수업 시작/종료 시간 형식이 올바르지 않습니다.`);
    }

    const breaks: Array<{ startHHMM: string; endHHMM: string }> = [];
    if (hasLunch && breakStartValue) {
      const breakStartHHMM = normalizeTimeInputToHHMM(breakStartValue);
      if (!breakStartHHMM) {
        throw new Error(`${weekdayLabel} 점심시간 형식이 올바르지 않습니다.`);
      }
      // 점심시간은 항상 1시간: start + 1h
      const [bh, bm] = breakStartValue.split(":").map(Number);
      const breakEndHH = String((bh + 1) % 24).padStart(2, "0");
      const breakEndMM = String(bm).padStart(2, "0");
      const breakEndHHMM = `${breakEndHH}${breakEndMM}`;
      breaks.push({ startHHMM: breakStartHHMM, endHHMM: breakEndHHMM });
    }

    dayTemplates.push({
      weekday,
      blocks: [{ startHHMM, endHHMM }],
      breaks,
    });
    weekdaySet.add(weekday);
  }

  return {
    dayTemplates,
    weekdays: Array.from(weekdaySet).sort((a, b) => a - b),
  };
}

function readScheduleConfigFromUi(): { cohort: string; config: ScheduleConfig } | null {
  const cohort = scheduleCohortInput.value.trim();
  const startDate = scheduleStartDateInput.value;
  const totalHours = Number(scheduleTotalHoursInput.value);

  if (!cohort) {
    setScheduleError("과정기수명을 입력해 주세요.");
    return null;
  }

  if (!parseIsoDate(startDate)) {
    setScheduleError("개강일을 올바르게 입력해 주세요.");
    return null;
  }

  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    setScheduleError("총 훈련시간은 0보다 커야 합니다.");
    return null;
  }

  let parsedTemplate: { dayTemplates: DayTimeTemplate[]; weekdays: number[] };
  try {
    parsedTemplate = parseTemplateRows();
  } catch (error) {
    if (error instanceof Error) {
      setScheduleError(error.message);
    } else {
      setScheduleError("요일별 템플릿을 해석할 수 없습니다.");
    }
    return null;
  }

  if (parsedTemplate.dayTemplates.length === 0) {
    setScheduleError("요일별 시간표 템플릿을 1개 이상 입력해 주세요.");
    return null;
  }

  return {
    cohort,
    config: {
      startDate,
      totalHours,
      weekdays: parsedTemplate.weekdays,
      holidays: [...appState.holidayDates],
      customBreaks: [...appState.customBreakDates],
      dayTemplates: parsedTemplate.dayTemplates,
    },
  };
}

function summarizeSkipped(skipped: SkippedDay[]): { holiday: number; customBreak: number; weekdayExcluded: number } {
  const summary = { holiday: 0, customBreak: 0, weekdayExcluded: 0 };

  for (const item of skipped) {
    if (item.reason === "holiday") {
      summary.holiday += 1;
      continue;
    }
    if (item.reason === "custom_break") {
      summary.customBreak += 1;
      continue;
    }
    summary.weekdayExcluded += 1;
  }

  return summary;
}

function getSkipReasonTitle(reason: SkippedDay["reason"]): string {
  if (reason === "holiday") {
    return "공휴일";
  }
  if (reason === "custom_break") {
    return "자체휴강";
  }
  return "요일 제외";
}

function formatSkippedLabel(item: SkippedDay): string {
  if (item.reason === "holiday") {
    const holidayName = holidayNameByDate.get(item.date);
    return holidayName ? `${item.date} (${holidayName})` : item.date;
  }
  return item.date;
}

function renderSkippedDetails(skipped: SkippedDay[]): void {
  scheduleSkippedDetails.innerHTML = "";

  const reasons: SkippedDay["reason"][] = ["holiday", "custom_break", "weekday_excluded"];

  for (const reason of reasons) {
    const items = skipped.filter((item) => item.reason === reason).sort((a, b) => a.date.localeCompare(b.date));

    const section = document.createElement("div");
    section.className = "skip-section";

    const header = document.createElement("div");
    header.className = "skip-header";

    const title = document.createElement("div");
    title.className = "skip-title";
    title.textContent = `${getSkipReasonTitle(reason)} ${items.length}건`;

    header.appendChild(title);

    if (items.length > 10) {
      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "small-btn";
      toggleButton.textContent = skipExpanded[reason] ? "접기" : "더보기";
      toggleButton.addEventListener("click", () => {
        skipExpanded[reason] = !skipExpanded[reason];
        renderSkippedDetails(skipped);
      });
      header.appendChild(toggleButton);
    }

    section.appendChild(header);

    const list = document.createElement("ul");
    list.className = "skip-list";

    const visibleItems = skipExpanded[reason] ? items : items.slice(0, 10);

    if (visibleItems.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "없음";
      list.appendChild(empty);
    } else {
      for (const item of visibleItems) {
        const li = document.createElement("li");
        li.textContent = formatSkippedLabel(item);
        list.appendChild(li);
      }
    }

    section.appendChild(list);
    scheduleSkippedDetails.appendChild(section);
  }
}

function renderGeneratedScheduleResult(): void {
  if (!appState.generatedScheduleResult) {
    scheduleResult.style.display = "none";
    scheduleSummary.textContent = "";
    scheduleSkippedSummary.textContent = "";
    scheduleSkippedDetails.innerHTML = "";
    scheduleDaysInfo.textContent = "";
    scheduleDaysPreview.innerHTML = "";
    return;
  }

  scheduleResult.style.display = "block";

  const skippedSummary = summarizeSkipped(appState.generatedScheduleResult.skipped);
  const previewDays = appState.generatedScheduleResult.days.slice(-20);

  scheduleSummary.textContent = `종강일: ${appState.generatedScheduleResult.endDate} / 총 수업일수: ${appState.generatedScheduleResult.totalDays} / 계획 총시간: ${formatHours(appState.generatedScheduleResult.totalHoursPlanned)}시간`;
  scheduleSkippedSummary.textContent = `스킵 요약 - 공휴일: ${skippedSummary.holiday}, 자체휴강: ${skippedSummary.customBreak}, 요일제외: ${skippedSummary.weekdayExcluded}`;
  renderSkippedDetails(appState.generatedScheduleResult.skipped);

  scheduleDaysInfo.textContent = `생성된 수업일 ${appState.generatedScheduleResult.days.length}건 중 최근 ${previewDays.length}건 미리보기`;

  scheduleDaysPreview.innerHTML = "";
  for (const day of previewDays) {
    const li = document.createElement("li");
    const dayTrainingHours = formatHours(day.netMinutes / 60);
    li.textContent = `${day.date} / 일 훈련시간 ${dayTrainingHours}h`;
    scheduleDaysPreview.appendChild(li);
  }
}

function clearHolidayList(): void {
  holidayClearHolidayList();
}

function dedupeHolidayList(): void {
  holidayDedupeHolidayList();
}

function compactToIso(value: string): string | null {
  const parsed = parseCompactDate(value);
  return parsed ? formatDate(parsed) : null;
}

function upsertCohortRange<T extends { cohort: string; startDate: string; endDate: string }>(
  target: Map<string, T>,
  range: T,
): void {
  const existing = target.get(range.cohort);
  if (!existing) {
    target.set(range.cohort, { ...range });
    return;
  }

  existing.startDate = existing.startDate < range.startDate ? existing.startDate : range.startDate;
  existing.endDate = existing.endDate > range.endDate ? existing.endDate : range.endDate;
}

function refreshStaffingAnalytics(showStatus = true): void {
  staffingRefreshStaffingAnalytics(showStatus);
}

function renderStaffingSection(): void {
  staffingRenderStaffingSection();
}

function autoFillStaffingFromCohorts(): void {
  staffingAutoFillStaffingFromCohorts();
}

function isV7eStrictReady(): { ok: boolean; reason?: string } {
  return staffingIsV7eStrictReady();
}

function downloadStaffingCsv(): void {
  staffingDownloadStaffingCsv();
}

function regenerateSummariesAndTimeline(preferredCohort = ""): void {
  const sessionSummaries = buildCohortSummaries(appState.sessions);
  // KDT 학사일정 데이터 병합 (세션 데이터가 없는 과정만 추가)
  const sessionCohortNames = new Set(sessionSummaries.map((s) => s.과정기수));
  const kdtSummaries = getKdtScheduleSummaries().filter((s) => !sessionCohortNames.has(s.과정기수));
  appState.summaries = [...sessionSummaries, ...kdtSummaries];
  setCohortOptions(appState.summaries, preferredCohort);
  renderTimeline();
  renderStaffingSection();
}

function generateScheduleFromUi(): void {
  const prepared = readScheduleConfigFromUi();
  if (!prepared) {
    return;
  }

  try {
    appState.generatedScheduleResult = generateSchedule(prepared.config);
    appState.generatedScheduleCohort = prepared.cohort;
    scheduleAppendStatus.textContent = "";
    skipExpanded.holiday = false;
    skipExpanded.custom_break = false;
    skipExpanded.weekday_excluded = false;

    if (appState.generatedScheduleResult.days.length > 0) {
      generatedCohortRanges.set(appState.generatedScheduleCohort, {
        cohort: appState.generatedScheduleCohort,
        startDate: appState.generatedScheduleResult.days[0].date,
        endDate: appState.generatedScheduleResult.endDate,
      });
      renderStaffingSection();
    }

    setScheduleError(null);
    renderGeneratedScheduleResult();
    pushRecentActionLog(
      "INFO",
      `일정 생성 완료: ${appState.generatedScheduleCohort} (종강 ${appState.generatedScheduleResult.endDate})`,
      "sectionScheduleGenerate",
    );
    updateActionStates();
    scheduleAutoSave();
  } catch (error) {
    appState.generatedScheduleResult = null;
    renderGeneratedScheduleResult();
    updateActionStates();

    if (error instanceof Error) {
      setScheduleError(error.message);
    } else {
      setScheduleError("일정 생성 중 알 수 없는 오류가 발생했습니다.");
    }
  }
}

function appendGeneratedScheduleToSessions(): void {
  if (!appState.generatedScheduleResult || appState.generatedScheduleResult.days.length === 0) {
    setScheduleError("먼저 일정을 생성해 주세요.");
    return;
  }

  if (!pushScheduleToConflicts.checked) {
    setScheduleError("충돌 계산에 올리기 체크박스를 선택해 주세요.");
    return;
  }

  try {
    const createdSessions = fromScheduleDaysToSessions({
      cohort: appState.generatedScheduleCohort,
      days: appState.generatedScheduleResult.days,
      instructorCode: scheduleInstructorCodeInput.value,
      classroomCode: scheduleClassroomCodeInput.value,
      subjectCode: scheduleSubjectCodeInput.value,
    });

    appState.sessions = [...appState.sessions, ...createdSessions];
    moduleInstructorDraft.clear();
    subjectInstructorMappingDraft.clear();
    regenerateSummariesAndTimeline(appState.generatedScheduleCohort);

    resetConflictsBeforeCompute();
    computeConflictsButton.textContent = DEFAULT_COMPUTE_LABEL;

    uploadStatus.textContent = `현재 수업시간표 ${appState.sessions.length}건 (CSV + 생성 일정 합산)`;
    scheduleAppendStatus.textContent = `${appState.generatedScheduleCohort} 일정 ${createdSessions.length}건을 충돌 검토 대상에 추가했습니다.`;
    setScheduleError(null);
    pushRecentActionLog(
      "INFO",
      `일정 반영 완료: ${appState.generatedScheduleCohort} ${createdSessions.length}건 추가`,
      "sectionTimeline",
    );
    updateActionStates();
    scheduleAutoSave();
  } catch (error) {
    if (error instanceof Error) {
      setScheduleError(error.message);
    } else {
      setScheduleError("생성 일정 반영 중 오류가 발생했습니다.");
    }
  }
}

const CSV_UPLOAD_WARN_BYTES = 5 * 1024 * 1024;

async function handleFileChange(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  if (file.size > CSV_UPLOAD_WARN_BYTES) {
    uploadStatus.textContent = `경고: 파일 크기가 ${(file.size / 1024 / 1024).toFixed(1)}MB입니다. 처리하는 중...`;
  }

  setUploadProcessingState(true);

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    const built = buildSessions(rows);

    appState.sessions = built.sessions;
    moduleInstructorDraft.clear();
    subjectInstructorMappingDraft.clear();
    appState.parseErrors = built.errors;

    regenerateSummariesAndTimeline();
    resetConflictsBeforeCompute();
    computeConflictsButton.textContent = DEFAULT_COMPUTE_LABEL;

    renderErrors();
    uploadStatus.textContent = `처리 완료: 수업시간표 ${appState.sessions.length}건 / 에러 ${appState.parseErrors.length}건`;

    if (appState.parseErrors.length > 0) {
      console.warn("CSV 파싱 중 오류가 발견되었습니다.", appState.parseErrors);
    }

    scheduleAutoSave();
  } finally {
    setUploadProcessingState(false);
  }
}

function handleOpenNotificationDrawer(): void {
  openDrawer("notification");
  renderNotificationCenter();
}

function focusNotificationCenter(focus: TimelineNotificationFocus): void {
  setNotificationFocus(focus);
  openDrawer("notification");
  renderNotificationCenter();
}

function handleConflictModalCancel(event: Event): void {
  event.preventDefault();
  closeConflictDetailModal();
}

function handleConflictModalClick(event: MouseEvent): void {
  if (!(event instanceof MouseEvent)) {
    return;
  }
  const rect = domRefs.conflictDetailModal.getBoundingClientRect();
  const insideDialog =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!insideDialog) {
    closeConflictDetailModal();
  }
}

function handleOpenInstructorDrawer(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  openInstructorDrawerWithTab("course");
}

function handleQuickNavCourse(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  openInstructorDrawerWithTab("course");
}

function handleQuickNavSubject(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  openInstructorDrawerWithTab("subject");
}

function handleQuickNavInstructor(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  openInstructorDrawerWithTab("register");
}

function handleQuickNavMapping(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  openInstructorDrawerWithTab("mapping");
}

function handleTimelineViewTypeChange(): void {
  setTimelineViewType(parseTimelineViewType(domRefs.timelineViewTypeSelect.value));
  renderTimeline();
  scheduleAutoSave();
}

function handleAssigneeModeInstructor(): void {
  appState.assigneeTimelineKind = "INSTRUCTOR";
  domRefs.assigneeModeInstructorButton.classList.add("active");
  domRefs.assigneeModeStaffButton.classList.remove("active");
  renderTimeline();
  scheduleAutoSave();
}

function handleAssigneeModeStaff(): void {
  appState.assigneeTimelineKind = "STAFF";
  domRefs.assigneeModeStaffButton.classList.add("active");
  domRefs.assigneeModeInstructorButton.classList.remove("active");
  renderTimeline();
  scheduleAutoSave();
}

function handleWeekPrev(): void {
  appState.weekGridStartDate = addDaysToIso(startOfWeekIso(appState.weekGridStartDate), -7);
  renderTimeline();
}

function handleWeekNext(): void {
  appState.weekGridStartDate = addDaysToIso(startOfWeekIso(appState.weekGridStartDate), 7);
  renderTimeline();
}

function handleMonthPrev(): void {
  const parsed = appState.monthCalendarCursor.match(/^(\d{4})-(\d{2})$/);
  if (!parsed) {
    appState.monthCalendarCursor = getTodayIsoDate().slice(0, 7);
  }
  const [year, month] = appState.monthCalendarCursor.split("-").map((value) => Number.parseInt(value, 10));
  const prev = new Date(Date.UTC(year, (month || 1) - 2, 1));
  appState.monthCalendarCursor = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  renderTimeline();
}

function handleMonthNext(): void {
  const parsed = appState.monthCalendarCursor.match(/^(\d{4})-(\d{2})$/);
  if (!parsed) {
    appState.monthCalendarCursor = getTodayIsoDate().slice(0, 7);
  }
  const [year, month] = appState.monthCalendarCursor.split("-").map((value) => Number.parseInt(value, 10));
  const next = new Date(Date.UTC(year, month || 1, 1));
  appState.monthCalendarCursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  renderTimeline();
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && appState.activeDrawer) {
    closeDrawers();
  }
}

function handleComputeConflictsClick(): void {
  void computeConflicts();
}

function handleKeySearchInput(): void {
  if (appState.keySearchTimer !== undefined) {
    window.clearTimeout(appState.keySearchTimer);
  }

  appState.keySearchTimer = window.setTimeout(() => {
    applyConflictFilters();
    scheduleAutoSave();
  }, 300);
}

function handleInstructorDaySearchInput(): void {
  if (appState.instructorDaySearchTimer !== undefined) {
    window.clearTimeout(appState.instructorDaySearchTimer);
  }

  appState.instructorDaySearchTimer = window.setTimeout(() => {
    applyInstructorDayFilters();
    scheduleAutoSave();
  }, 300);
}

function handleFoDaySearchInput(): void {
  if (appState.foDaySearchTimer !== undefined) {
    window.clearTimeout(appState.foDaySearchTimer);
  }

  appState.foDaySearchTimer = window.setTimeout(() => {
    applyFoDayFilters();
    scheduleAutoSave();
  }, 300);
}

function handleTabTimeConflicts(): void {
  setConflictTab("time");
}

function handleTabInstructorDayConflicts(): void {
  setConflictTab("instructor_day");
}

function handleTabFoDayConflicts(): void {
  setConflictTab("fo_day");
}

function handleAddHoliday(): void {
  holidayHandleAddHoliday();
}

function handleLoadPublicHolidays(): void {
  holidayHandleLoadPublicHolidays();
}

function handleAddCustomBreak(): void {
  holidayHandleAddCustomBreak();
}

function handleScheduleTemplateSelectChange(): void {
  const selectedTemplate = findScheduleTemplate(appState.scheduleTemplates, scheduleTemplateSelect.value);
  deleteScheduleTemplateButton.disabled = Boolean(selectedTemplate?.builtIn);
}

function handlePushScheduleToConflictsChange(): void {
  updateActionStates();
  scheduleAutoSave();
}

function handleStaffRefresh(): void {
  refreshStaffingAnalytics(true);
  scheduleAutoSave();
}

function handleStaffingModeSelectChange(): void {
  applyStaffingMode(staffingModeSelect.value === "advanced" ? "advanced" : "manager");
  renderStaffingSection();
  updateActionStates();
  scheduleAutoSave();
}

function handleAdminModeToggleChange(): void {
  applyShowAdvancedMode(resolveShowAdvanced(adminModeToggle!.checked));
  scheduleAutoSave();
}

function handleSaveMenuConfig(): void {
  appState.sidebarMenuConfig = normalizeSidebarMenuConfig(appState.sidebarMenuDraft);
  appState.sidebarMenuDraft = cloneSidebarMenuConfig(appState.sidebarMenuConfig);
  applySidebarMenuConfigToSidebar(appState.sidebarMenuConfig);
  saveSidebarMenuConfig(appState.sidebarMenuConfig);
  renderSidebarMenuConfigEditor();
  menuConfigStatus.textContent = `메뉴 설정 저장 완료 (${new Date().toLocaleTimeString()})`;
}

function handleResetMenuConfig(): void {
  appState.sidebarMenuConfig = getDefaultSidebarMenuConfig();
  appState.sidebarMenuDraft = cloneSidebarMenuConfig(appState.sidebarMenuConfig);
  applySidebarMenuConfigToSidebar(appState.sidebarMenuConfig);
  saveSidebarMenuConfig(appState.sidebarMenuConfig);
  renderSidebarMenuConfigEditor();
  menuConfigStatus.textContent = "기본 메뉴 설정으로 복원했습니다.";
}

function handleJibbleSubCourse(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("course");
  openInstructorDrawerWithTab("course");
}

function handleJibbleSubSubject(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("subject");
  openInstructorDrawerWithTab("subject");
}

function handleJibbleSubInstructor(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false,
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("instructor");
  openInstructorDrawerWithTab("register");
}

function handleInstructorTabCourse(): void {
  switchInstructorDrawerTab("course");
}

function handleInstructorTabRegister(): void {
  switchInstructorDrawerTab("register");
}

function handleInstructorTabMapping(): void {
  switchInstructorDrawerTab("mapping");
}

function handleInstructorTabSubject(): void {
  switchInstructorDrawerTab("subject");
}

function handleSubjectCourseSelectChange(): void {
  renderSubjectDirectory();
  scheduleAutoSave();
}

function handleMappingCourseSelectChange(): void {
  renderSubjectMappingTable();
  scheduleAutoSave();
}

function handleCourseTemplateCourseSelectChange(): void {
  renderCourseTemplateOptions();
  scheduleAutoSave();
}

function handleStaffExportModeSelectChange(): void {
  staffExportWarningsAgree.checked = false;
  renderStaffExportValidation([], []);
  scheduleAutoSave();
  updateActionStates();
}

function handleLoadProjectButtonClick(): void {
  loadProjectInput.click();
}

async function handleLoadProjectInputChange(): Promise<void> {
  const file = loadProjectInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    await importProjectStateFromFile(file);
    stateStorageStatus.textContent = `프로젝트 불러오기 완료 (${new Date().toLocaleTimeString()})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    stateStorageWarning.textContent = `프로젝트 불러오기 실패: ${message}`;
    stateStorageStatus.textContent = "프로젝트 불러오기 실패";
  } finally {
    loadProjectInput.value = "";
  }
}

async function handleLoadDemoSampleButtonClick(): Promise<void> {
  try {
    await loadDemoSampleState();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    setDemoSampleBanner(`샘플 로드 실패: ${message}`);
  }
}

function handleAuthCodeInputKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    void submitAuthCode();
  }
}

function handleDayTemplateInputTemplateStatus(): void {
  scheduleTemplateStatus.textContent = "현재 템플릿이 수정되었습니다. 필요 시 저장해 주세요.";
}

function handleWindowAfterprint(): void {
  printReportCard.style.display = "none";
}

initConflictsFeature({
  highlightGanttByCohortModule,
  updateActionStates,
  scheduleAutoSave,
});

initTimelineFeature({
  getCohortNotificationMap: () => getCohortNotificationCountMap(refreshNotificationItems()),
  focusNotification: focusNotificationCenter,
});

initHolidaysFeature({
  refreshHrdValidation,
  scheduleAutoSave,
  setHolidayLoadingState,
  setScheduleError,
});

initScheduleTemplatesFeature({
  scheduleAutoSave,
  updateActionStates,
  pushRecentActionLog,
});

initStaffingFeature({
  phases: PHASES,
  trackTypes: TRACK_TYPES,
  matrixResourceTypes: MATRIX_RESOURCE_TYPES,
  trackLabel: TRACK_LABEL,
  resourceTypeOrder: RESOURCE_TYPE_ORDER,
  compactToIso,
  upsertCohortRange,
  getDefaultTrackTypeForCohort,
  getStaffCellState,
  setStaffCellState,
  setStaffingStatus,
  scheduleAutoSave,
  renderInstructorDayOverlapPanel,
  renderFoDayOverlapPanel,
  applyInstructorDayFilters,
  applyFoDayFilters,
  renderStaffExportValidation,
  renderStaffModuleManagerTable,
  buildModuleAssignSummaries,
});

initSidebarMenuFeature({
  setJibbleSidebarActive,
});

initNotificationsFeature({
  scrollToSection,
  closeDrawers,
});

initCourseTemplatesFeature({
  scheduleAutoSave,
  collectTemplateRowsState,
  applyTemplateRowsState,
  renderHolidayAndBreakLists: holidayRenderHolidayAndBreakLists,
  renderSubjectDirectory,
  renderSubjectMappingTable,
  syncCourseTemplateCloud,
  syncDeleteCourseTemplateCloud,
});

initRegistryFeature({
  scheduleAutoSave,
  markQuickNavUpdated,
  renderGlobalWarnings,
  setStaffingStatus,
  recomputeTimeConflictsImmediate,
  regenerateSummariesAndTimeline,
  buildModuleAssignSummaries,
  isCloudAccessAllowed,
});

initNavigationFeature({
  renderHeaderRuntimeStatus,
  getTrackTypeMissingCohorts,
  getUnassignedInstructorModules,
  isHolidayApplied,
  isHrdChecklistPassed,
});

initProjectStateFeature({
  getStaffCellState,
  renderInitialUiState,
  updateActionStates,
  regenerateSummariesAndTimeline,
  applyViewMode,
  applyShowAdvancedMode,
  applyStaffingMode,
  setStateMigrationWarnings,
  refreshHrdValidation,
  renderHolidayAndBreakLists: holidayRenderHolidayAndBreakLists,
  renderGeneratedScheduleResult,
  renderErrors,
  renderHrdValidationErrors,
  renderTimeConflicts,
  collectTemplateRowsState,
  applyTemplateRowsState,
  renderScheduleTemplateOptions,
});

initEventListeners({
  onFileChange: handleFileChange,
  onCohortSelectChange: updateCohortInfo,
  onDownloadButtonClick: downloadCohortCSV,
  onOpenNotificationDrawerButtonClick: handleOpenNotificationDrawer,
  onOpenConflictDetailModalButtonClick: openConflictDetailModal,
  onCloseConflictDetailModalButtonClick: closeConflictDetailModal,
  onConflictDetailModalCancel: handleConflictModalCancel,
  onConflictDetailModalClick: handleConflictModalClick,
  onOpenInstructorDrawerButtonClick: handleOpenInstructorDrawer,
  onQuickNavCourseButtonClick: handleQuickNavCourse,
  onQuickNavSubjectButtonClick: handleQuickNavSubject,
  onQuickNavInstructorButtonClick: handleQuickNavInstructor,
  onQuickNavMappingButtonClick: handleQuickNavMapping,
  onTimelineViewTypeSelectChange: handleTimelineViewTypeChange,
  onAssigneeModeInstructorButtonClick: handleAssigneeModeInstructor,
  onAssigneeModeStaffButtonClick: handleAssigneeModeStaff,
  onWeekPrevButtonClick: handleWeekPrev,
  onWeekNextButtonClick: handleWeekNext,
  onMonthPrevButtonClick: handleMonthPrev,
  onMonthNextButtonClick: handleMonthNext,
  onDrawerBackdropClick: closeDrawers,
  onCloseDrawerButtonClick: closeDrawers,
  onWindowKeydown: handleWindowKeydown,
  onWindowResize: applyManagementInlineMode,
  onComputeConflictsButtonClick: handleComputeConflictsClick,
  onKeySearchInputInput: handleKeySearchInput,
  onInstructorDaySearchInputInput: handleInstructorDaySearchInput,
  onFoDaySearchInputInput: handleFoDaySearchInput,
  onDownloadTimeConflictsButtonClick: downloadVisibleTimeConflictsCsv,
  onDownloadInstructorDayConflictsButtonClick: downloadVisibleInstructorDayConflictsCsv,
  onDownloadFoDayConflictsButtonClick: downloadVisibleFoDayConflictsCsv,
  onTabTimeConflictsClick: handleTabTimeConflicts,
  onTabInstructorDayConflictsClick: handleTabInstructorDayConflicts,
  onTabFoDayConflictsClick: handleTabFoDayConflicts,
  onAddHolidayButtonClick: handleAddHoliday,
  onLoadPublicHolidaysButtonClick: handleLoadPublicHolidays,
  onClearHolidaysButtonClick: clearHolidayList,
  onDedupeHolidaysButtonClick: dedupeHolidayList,
  onAddCustomBreakButtonClick: handleAddCustomBreak,
  onScheduleTemplateSelectChange: handleScheduleTemplateSelectChange,
  onLoadScheduleTemplateButtonClick: applySelectedScheduleTemplate,
  onSaveScheduleTemplateButtonClick: saveCurrentScheduleTemplate,
  onDeleteScheduleTemplateButtonClick: deleteSelectedScheduleTemplate,
  onGenerateScheduleButtonClick: generateScheduleFromUi,
  onAppendScheduleButtonClick: appendGeneratedScheduleToSessions,
  onPushScheduleToConflictsChange: handlePushScheduleToConflictsChange,
  onStaffAutoFillButtonClick: autoFillStaffingFromCohorts,
  onStaffRefreshButtonClick: handleStaffRefresh,
  onStaffingModeSelectChange: handleStaffingModeSelectChange,
  onAdminModeToggleChange: handleAdminModeToggleChange,
  onSaveMenuConfigButtonClick: handleSaveMenuConfig,
  onResetMenuConfigButtonClick: handleResetMenuConfig,
  onJibbleSubCourseButtonClick: handleJibbleSubCourse,
  onJibbleSubSubjectButtonClick: handleJibbleSubSubject,
  onJibbleSubInstructorButtonClick: handleJibbleSubInstructor,
  onInstructorTabCourseClick: handleInstructorTabCourse,
  onInstructorTabRegisterClick: handleInstructorTabRegister,
  onInstructorTabMappingClick: handleInstructorTabMapping,
  onInstructorTabSubjectClick: handleInstructorTabSubject,
  onUpsertCourseButtonClick: upsertCourseRegistryEntry,
  onUpsertInstructorButtonClick: upsertInstructorDirectoryEntry,
  onUpsertSubjectButtonClick: upsertSubjectDirectoryEntry,
  onApplySubjectMappingsButtonClick: applySubjectMappingsToSessions,
  onSubjectCourseSelectChange: handleSubjectCourseSelectChange,
  onMappingCourseSelectChange: handleMappingCourseSelectChange,
  onCourseTemplateCourseSelectChange: handleCourseTemplateCourseSelectChange,
  onSaveCourseTemplateButtonClick: saveCurrentCourseTemplate,
  onLoadCourseTemplateButtonClick: applySelectedCourseTemplate,
  onDeleteCourseTemplateButtonClick: deleteSelectedCourseTemplate,
  onStaffExportCsvButtonClick: downloadStaffingCsv,
  onStaffExportModeSelectChange: handleStaffExportModeSelectChange,
  onStaffExportIncludeDetailsChange: scheduleAutoSave,
  onStaffExportWarningsAgreeChange: updateActionStates,
  onSaveProjectButtonClick: downloadProjectStateJson,
  onLoadProjectButtonClick: handleLoadProjectButtonClick,
  onLoadProjectInputChange: handleLoadProjectInputChange,
  onResetProjectButtonClick: resetAllStateWithConfirm,
  onPrintReportButtonClick: printReport,
  onLoadDemoSampleButtonClick: handleLoadDemoSampleButtonClick,
  onRestorePreviousStateButtonClick: restoreStateBeforeSampleLoad,
  onAuthLoginButtonClick: submitAuthCode,
  onAuthCodeInputKeydown: handleAuthCodeInputKeydown,
  onScheduleInputInput: scheduleAutoSave,
  onDayTemplateTableInput: scheduleAutoSave,
  onDayTemplateTableInputTemplateStatus: handleDayTemplateInputTemplateStatus,
  onWindowAfterprint: handleWindowAfterprint,
});

if (!scheduleStartDateInput.value) {
  scheduleStartDateInput.value = getTodayIsoDate();
}

appState.sidebarMenuConfig = loadSidebarMenuConfig();
appState.sidebarMenuDraft = cloneSidebarMenuConfig(appState.sidebarMenuConfig);
applyManagementInlineMode();
renderHeaderRuntimeStatus();
window.setInterval(renderHeaderRuntimeStatus, 1000);

applyViewMode("full");
setTimelineViewType("COHORT_TIMELINE");
applyStaffingMode(staffingModeSelect.value === "advanced" ? "advanced" : "manager");
applyShowAdvancedMode(resolveShowAdvanced(false));
appState.sidebarMenuConfig = normalizeSidebarMenuConfig(appState.sidebarMenuConfig);
appState.sidebarMenuDraft = cloneSidebarMenuConfig(appState.sidebarMenuConfig);
applySidebarMenuConfigToSidebar(appState.sidebarMenuConfig);
renderSidebarMenuConfigEditor();

// Dark mode is always on — set via data-theme="dark" in HTML
menuConfigStatus.textContent = "메뉴 이모지/이름/순서를 변경한 뒤 저장할 수 있습니다.";
switchInstructorDrawerTab("course");
setupJibbleSidebarNavigation();

// 점심시간 체크박스 토글 이벤트: input 활성화/비활성화 + 종료시간 표시 업데이트
for (const row of Array.from(dayTemplateTable.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
  const check = row.querySelector<HTMLInputElement>(".tpl-break-check");
  const bStart = row.querySelector<HTMLInputElement>(".tpl-break-start");
  const bEndDisp = row.querySelector<HTMLElement>(".tpl-break-end-display");
  if (check && bStart) {
    const updateLunchUI = (): void => {
      bStart.disabled = !check.checked;
      if (bEndDisp) {
        const val = bStart.value || "13:00";
        const [h, m] = val.split(":").map(Number);
        const eh = String(((h || 0) + 1) % 24).padStart(2, "0");
        const em = String(m || 0).padStart(2, "0");
        bEndDisp.textContent = `~ ${eh}:${em}`;
      }
    };
    check.addEventListener("change", updateLunchUI);
    bStart.addEventListener("input", updateLunchUI);
  }
}

const hasAuthSession = sessionStorage.getItem(AUTH_SESSION_KEY) === "verified";
applyAuthGate(hasAuthSession);
if (hasAuthSession) {
  const assistantSession = getAssistantSession();
  if (assistantSession) {
    applyAssistantMode(assistantSession.courseName, assistantSession.degr);
  }
}

document.getElementById("assistantLogoutBtn")?.addEventListener("click", handleLogout);

// HRD dashboards (attendance + dropout defense)
initAttendanceDashboard();
initDropoutDashboard();
initAnalytics();
initDashboard();
initTraineeHistory();
initAssistantCheck();

// ─── 출결현황 / 하차방어율 상위 탭 전환 ───
// ─── KPI 자율성과지표 Google Sheets 연동 ───
(() => {
  let kpiData: KpiAllData | null = null;
  const statusEl = document.getElementById("kpiUploadStatus");
  const connectStatusEl = document.getElementById("kpiConnectStatus");
  const connectUrlInput = document.getElementById("kpiConnectUrl") as HTMLInputElement | null;
  const connectModeSelect = document.getElementById("kpiConnectMode") as HTMLSelectElement | null;

  // KPI 탭 전환 초기화
  initKpiTabs();

  function setStatus(el: HTMLElement | null, msg: string, type: "success" | "error" | "loading" = "loading") {
    if (!el) return;
    el.textContent = msg;
    el.className = `kpi-connect-status ${type}`;
  }

  // 저장된 설정 로드 & UI 반영
  const savedConfig = loadKpiConfig();
  if (connectUrlInput && savedConfig.webAppUrl) {
    connectUrlInput.value = savedConfig.webAppUrl;
    if (connectModeSelect) connectModeSelect.value = "appsscript";
  } else if (connectUrlInput && savedConfig.spreadsheetId) {
    connectUrlInput.value = savedConfig.spreadsheetId;
    if (connectModeSelect) connectModeSelect.value = "published";
  }

  function getConfigFromForm(): KpiConfig {
    const mode = connectModeSelect?.value ?? "appsscript";
    const val = connectUrlInput?.value.trim() ?? "";
    if (mode === "appsscript") {
      return { webAppUrl: val, spreadsheetId: "" };
    } else {
      // URL에서 스프레드시트 ID 추출
      const match = val.match(/\/d\/([a-zA-Z0-9_-]+)/);
      return { webAppUrl: "", spreadsheetId: match ? match[1] : val };
    }
  }

  // 연결 테스트
  document.getElementById("kpiConnectTestBtn")?.addEventListener("click", async () => {
    const config = getConfigFromForm();
    setStatus(connectStatusEl, "연결 테스트 중...", "loading");
    const result = await testKpiConnection(config);
    setStatus(connectStatusEl, result.message, result.ok ? "success" : "error");
  });

  // 저장 후 불러오기
  document.getElementById("kpiConnectSaveBtn")?.addEventListener("click", async () => {
    const config = getConfigFromForm();
    if (!config.webAppUrl && !config.spreadsheetId) {
      setStatus(connectStatusEl, "URL 또는 스프레드시트 ID를 입력하세요.", "error");
      return;
    }
    saveKpiConfig(config);
    setStatus(connectStatusEl, "설정 저장됨. 데이터 불러오는 중...", "loading");
    await loadKpiDataAndRender(config);
  });

  // 데이터 불러오기 버튼
  document.getElementById("kpiLoadBtn")?.addEventListener("click", async () => {
    const config = loadKpiConfig();
    if (!config.webAppUrl && !config.spreadsheetId) {
      if (statusEl) statusEl.textContent = "⚠️ Google Sheets 연결 설정을 먼저 해주세요.";
      return;
    }
    if (statusEl) statusEl.textContent = "데이터 불러오는 중...";
    await loadKpiDataAndRender(config);
  });

  // PDF 리포트
  document.getElementById("kpiPdfBtn")?.addEventListener("click", () => {
    if (!kpiData) {
      alert("데이터를 먼저 불러오세요.");
      return;
    }
    const course = (document.getElementById("kpiFilterCourse") as HTMLSelectElement)?.value ?? "all";
    const cohort = (document.getElementById("kpiFilterCohort") as HTMLSelectElement)?.value ?? "all";
    printKpiReport(kpiData, course, cohort);
  });

  // 초기화
  document.getElementById("kpiClearBtn")?.addEventListener("click", () => {
    kpiData = null;
    window.__kpiAllData = null;
    resetKpiDashboard();
    if (statusEl) statusEl.textContent = "";
  });

  // 필터 변경
  document.getElementById("kpiFilterCourse")?.addEventListener("change", () => applyFilters());
  document.getElementById("kpiFilterCohort")?.addEventListener("change", () => applyFilters());

  function applyFilters() {
    if (!kpiData) return;
    const course = (document.getElementById("kpiFilterCourse") as HTMLSelectElement)?.value ?? "all";
    const cohort = (document.getElementById("kpiFilterCohort") as HTMLSelectElement)?.value ?? "all";
    renderKpiDashboard(kpiData, course, cohort);
  }

  async function loadKpiDataAndRender(config: KpiConfig) {
    try {
      kpiData = await fetchKpiData(config);
      window.__kpiAllData = kpiData;
      populateFilters(kpiData);
      renderKpiDashboard(kpiData);
      if (statusEl) statusEl.textContent = `✅ ${kpiData.achievement.length}명 학습자 데이터 로드 완료`;
      setStatus(connectStatusEl, `✅ 연결 완료! ${kpiData.achievement.length}명 데이터 로드`, "success");
    } catch (e) {
      const msg = `❌ 데이터 로드 실패: ${(e as Error).message}`;
      if (statusEl) statusEl.textContent = msg;
      setStatus(connectStatusEl, msg, "error");
    }
  }

  // 저장된 설정이 있으면 자동 로드
  if (savedConfig.webAppUrl || savedConfig.spreadsheetId) {
    void loadKpiDataAndRender(savedConfig);
  }
})();

// ─── 주간 운영회의 보고팩 ───
import { printWeeklyOpsReport, checkDataAvailability, getWeekLabel } from "./reports/weeklyOpsReport";

(() => {
  const generateBtn = document.getElementById("weeklyReportGenerateBtn");
  const statusEl = document.getElementById("weeklyReportStatus");
  const dataStatusEl = document.getElementById("weeklyReportDataStatus");
  const page3Check = document.getElementById("weeklyReportPage3") as HTMLInputElement | null;
  const page4Check = document.getElementById("weeklyReportPage4") as HTMLInputElement | null;
  const page5Check = document.getElementById("weeklyReportPage5") as HTMLInputElement | null;

  function updateDataStatus(): void {
    if (!dataStatusEl) return;
    const avail = checkDataAvailability();
    const kpiLoaded = window.__kpiAllData != null;
    const indicator = (ok: boolean, label: string) =>
      `<div class="weekly-report-indicator ${ok ? "is-ok" : "is-missing"}">${ok ? "✅" : "⚠️"} ${label} ${ok ? "준비됨" : "없음"}</div>`;
    dataStatusEl.innerHTML = [
      indicator(avail.hasAttendance, "출결 데이터"),
      indicator(avail.hasDropout, "하차방어율 데이터"),
      indicator(avail.hasAnalytics, "훈련생 분석 데이터"),
      indicator(kpiLoaded, "KPI 데이터"),
    ].join("");
  }

  const header = document.querySelector("#settingsWeeklyReport .settings-section-header");
  header?.addEventListener("click", () => setTimeout(updateDataStatus, 50));

  generateBtn?.addEventListener("click", () => {
    updateDataStatus();
    const config = {
      includePage3: page3Check?.checked ?? true,
      includePage4: page4Check?.checked ?? true,
      includePage5: page5Check?.checked ?? false,
      reportDate: new Date().toISOString().slice(0, 10),
      reportWeekLabel: getWeekLabel(new Date()),
    };
    if (!config.includePage3 && !config.includePage4 && !config.includePage5) {
      if (statusEl) statusEl.textContent = "⚠️ 최소 1개 페이지를 선택하세요.";
      return;
    }
    if (statusEl) statusEl.textContent = "보고팩 생성 중...";
    printWeeklyOpsReport(config, window.__kpiAllData ?? null);
    if (statusEl) statusEl.textContent = `✅ 보고팩 생성 완료 (${new Date().toLocaleTimeString()})`;
  });
})();

if (hasAuthSession) {
  void bootstrapAppAfterAuthLogin();
}
