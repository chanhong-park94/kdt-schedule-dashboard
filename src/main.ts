import "./style.css";
import { initAttendanceDashboard } from "./hrd/hrdAttendance";
import { initAnalytics } from "./hrd/hrdAnalytics";
import { initDropoutDashboard } from "./hrd/hrdDropout";
import { fetchKpiData, testKpiConnection, loadKpiConfig, saveKpiConfig } from "./kpi/kpiSheets";
import { renderKpiDashboard, populateFilters, initKpiTabs, resetKpiDashboard } from "./kpi/kpiReport";
import { printKpiReport } from "./kpi/kpiPdf";
import type { KpiAllData, KpiConfig } from "./kpi/kpiTypes";
import {
  createClickableCell,
  createTableElement,
  setRenderNotice
} from "./ui/utils/dom";
import { domRefs } from "./ui/domRefs";
import { generateSchedule } from "./core/calendar";
import { parseCsv } from "./core/csv";
import { applyCourseTemplateToState } from "./core/courseTemplateApply";
import { removeBasicModeSections } from "./core/basicModeSections";
import {
  createCsvBlob,
  csvEscape,
  downloadCsvFile,
  downloadCsvText,
  getOverlapRangeLabel,
  toDayConflictRow
} from "./ui/utils/csv";
import { detectConflicts } from "./core/conflicts";
import { assignInstructorToModule } from "./core/autoAssignInstructor";
import { exportHrdCsvForCohort } from "./core/export";
import { fromScheduleDaysToSessions } from "./core/fromSchedule";
import { normalizeHHMM } from "./core/normalize";
import {
  findScheduleTemplate,
  NamedScheduleTemplate,
} from "./core/scheduleTemplates";
import {
  applyCourseSubjectInstructorMappingsToCohortSessions
} from "./core/subjectMapping";
import { buildSessions } from "./core/sessions";
import {
  CURRENT_SCHEMA_VERSION,
  migrateState,
  type AppSidebarMenuConfig,
  type AppSidebarNavKey,
  type AppStateVCurrent,
  type AppTimelineViewType,
  type AppViewMode,
  type SavedStaffCell,
  type TemplateRowState
} from "./core/state";
import { type InternalV7ERecord } from "./core/schema";
import { resolveShowAdvancedPolicy } from "./core/showAdvancedPolicy";
import {
  deriveModuleRangesFromSessions,
} from "./core/staffing";
import { normalizeInstructorCode, normalizeSubjectCode } from "./core/standardize";
import { buildCohortSummaries } from "./core/summary";
import { getKdtScheduleSummaries } from "./hrd/hrdScheduleData";
import {
  validateHrdExportForCohortDetailed
} from "./core/hrdValidation";
import { isDevRuntime, isProdRuntime } from "./core/env";
import {
  AssigneeSummary,
  CohortSummary,
  Conflict,
  DayTimeTemplate,
  GenerateScheduleResult,
  Holiday,
  ParseError,
  Phase,
  ScheduleConfig,
  Session,
  SkippedDay,
  ResourceType,
  StaffAssignment,
  StaffAssignmentInput,
  StaffOverlap,
  type InstructorDirectoryEntry,
  TrackType
} from "./core/types";
import {
  deleteInstructorFromCloud,
  isInstructorCloudEnabled,
  loadInstructorDirectoryFromCloud,
  mergeWithLocalInstructorDirectory,
  upsertInstructorInCloud
} from "./core/instructorSync";
import {
  createCourse,
  createSubject,
  deleteCourseTemplate,
  isManagementCloudEnabled,
  listCourseTemplates,
  listCourses,
  listSubjects,
  saveCourseTemplate,
  type CourseTemplateRecord
} from "./core/supabaseManagement";
import {
  DAY_MS,
  addDaysToIso,
  dedupeAndSortDates,
  formatCompactDate,
  formatDate,
  formatShortDateFromCompact,
  formatShortDateFromIso,
  getTodayCompactDate,
  getTodayIsoDate,
  isDateInsideRange,
  parseCompactDate,
  parseIsoDate,
  toCompactDateFromIso
} from "./ui/utils/date";
import {
  ConflictTab,
  estimateUtf8SizeBytes,
  formatBytes,
  formatHHMM,
  formatHours,
  getConflictTabLabel,
  getReadableTextColorFromCssColor,
  isPhase,
  isResourceType,
  isTrackType,
  normalizeCourseId,
  normalizePolicyDays,
  normalizeTimeInputToHHMM,
  parseCourseGroupFromCohortName,
  parseCourseSubjectKey,
  getPolicyForTrack,
  getPolicyLabel,
  toCourseSubjectKey
} from "./ui/utils/format";
import {
  appState,
  cohortTrackType,
  collapsedCourseGroups,
  generatedCohortRanges,
  holidayNameByDate,
  moduleInstructorDraft,
  skipExpanded,
  staffingCellState,
  subjectInstructorMappingDraft,
  subjectInstructorMappings,
  type CohortRange,
  type CourseRegistryEntry,
  type CourseTemplate,
  type NotificationItem,
  type RecentActionLog,
  type SidebarMenuConfig,
  type StaffCellState,
  type StaffingMode,
  type AssigneeTimelineKind,
  type SubjectDirectoryEntry,
  type ViewMode,
  type TimelineViewType,
  type PrimarySidebarNavKey
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
  RESOURCE_TYPE_LABEL
} from "./ui/features/conflicts";
import {
  initTimelineFeature,
  parseTimelineViewType,
  renderTimeline,
  renderTimelineDetail,
  setTimelineViewType,
  startOfWeekIso,
  type TimelineNotificationFocus
} from "./ui/features/timeline";
import {
  addDateToList as holidayAddDateToList,
  clearHolidayList as holidayClearHolidayList,
  dedupeHolidayList as holidayDedupeHolidayList,
  getHolidayDisplayLabel as holidayGetHolidayDisplayLabel,
  getHolidayFetchYears as holidayGetHolidayFetchYears,
  handleAddCustomBreak as holidayHandleAddCustomBreak,
  handleAddHoliday as holidayHandleAddHoliday,
  handleLoadPublicHolidays as holidayHandleLoadPublicHolidays,
  initHolidaysFeature,
  loadPublicHolidays as holidayLoadPublicHolidays,
  mergeFetchedHolidays as holidayMergeFetchedHolidays,
  renderDateList as holidayRenderDateList,
  renderHolidayAndBreakLists as holidayRenderHolidayAndBreakLists
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
  saveScheduleTemplatesToLocalStorage as scheduleTemplatesSaveScheduleTemplatesToLocalStorage
} from "./ui/features/scheduleTemplates";
import {
  autoFillStaffingFromCohorts as staffingAutoFillStaffingFromCohorts,
  buildModulesGenericExportRecords as staffingBuildModulesGenericExportRecords,
  buildOverlapDayMapByAssignment as staffingBuildOverlapDayMapByAssignment,
  buildStrictExportRecords as staffingBuildStrictExportRecords,
  collectStaffingInputs as staffingCollectStaffingInputs,
  downloadStaffingCsv as staffingDownloadStaffingCsv,
  getPolicyLabelsForAssignee as staffingGetPolicyLabelsForAssignee,
  initStaffingFeature,
  isV7eStrictReady as staffingIsV7eStrictReady,
  rebuildStaffingCohortRanges as staffingRebuildStaffingCohortRanges,
  refreshStaffingAnalytics as staffingRefreshStaffingAnalytics,
  renderStaffGantt as staffingRenderStaffGantt,
  renderStaffingMatrix as staffingRenderStaffingMatrix,
  renderStaffingSection as staffingRenderStaffingSection,
  renderStaffKpiAndDetails as staffingRenderStaffKpiAndDetails
} from "./ui/features/staffing";
type ActivatePrimaryPageOptions = {
  scrollToTop?: boolean;
  openManagementTab?: boolean;
};

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
  EMPLOYED: "재직자"
};


const RESOURCE_TYPE_ORDER: Record<ResourceType, number> = {
  INSTRUCTOR: 0,
  FACILITATOR: 1,
  OPERATION: 2
};


const STORAGE_KEY = "academic_schedule_manager_state_v1";
const AUTH_SESSION_KEY = "academic_schedule_manager_auth_v2";
const AUTH_CODE_V2 = "v2";
const STORAGE_WARN_BYTES = 4_500_000;
const AUTO_SAVE_DEBOUNCE_MS = 500;
const PRINT_CONFLICT_LIMIT = 50;
const SIDEBAR_MENU_CONFIG_KEY = "academic_schedule_manager_sidebar_menu_v3";

const PRIMARY_SIDEBAR_NAV_KEYS: PrimarySidebarNavKey[] = [
  "timeline",
  "generator",
  "kpi",
  "attendance",
  "analytics",
  "settings"
];

const DEFAULT_PRIMARY_SIDEBAR_LABELS: Record<PrimarySidebarNavKey, string> = {
  timeline: "학사일정",
  generator: "HRD시간표 생성",
  kpi: "재직자 자율성과지표",
  attendance: "출결현황",
  analytics: "훈련생 분석",
  settings: "설정"
};

const DEFAULT_PRIMARY_SIDEBAR_ICONS: Record<PrimarySidebarNavKey, string> = {
  timeline: "📅",
  generator: "🛠️",
  kpi: "📊",
  attendance: "📋",
  analytics: "📈",
  settings: "⚙️"
};

const DEFAULT_DOWNLOAD_LABEL = "선택한 기수 CSV 다운로드";
const DEFAULT_COMPUTE_LABEL = "충돌 계산";
const RECOMPUTE_LABEL = "충돌 다시 계산";

const TIMELINE_VIEW_ORDER: TimelineViewType[] = [
  "COHORT_TIMELINE",
  "COURSE_GROUPED",
  "ASSIGNEE_TIMELINE",
  "WEEK_GRID",
  "MONTH_CALENDAR"
];
const TIMELINE_RENDER_LIMIT = 600;


const fileInput = domRefs.fileInput;
const uploadStatus = domRefs.uploadStatus;
const standardizeStatus = domRefs.standardizeStatus;
const authGate = domRefs.authGate;
const authCodeInput = domRefs.authCodeInput;
const authLoginButton = domRefs.authLoginButton;
const authStatus = domRefs.authStatus;

const stateMigrationBanner = domRefs.stateMigrationBanner;
const stateMigrationList = domRefs.stateMigrationList;
const globalWarningPanel = domRefs.globalWarningPanel;
const globalWarningList = domRefs.globalWarningList;
const adminModeToggle = domRefs.adminModeToggle;

const drawerBackdrop = domRefs.drawerBackdrop;
const notificationDrawer = domRefs.notificationDrawer;
const instructorDrawer = domRefs.instructorDrawer;
const headerRuntimePanel = domRefs.headerRuntimePanel;
const headerCurrentTime = domRefs.headerCurrentTime;
const headerSyncState = domRefs.headerSyncState;
const openNotificationDrawerButton = domRefs.openNotificationDrawerButton;
const openInstructorDrawerButton = domRefs.openInstructorDrawerButton;
const quickNavCourseButton = domRefs.quickNavCourseButton;
const quickNavSubjectButton = domRefs.quickNavSubjectButton;
const quickNavInstructorButton = domRefs.quickNavInstructorButton;
const quickNavMappingButton = domRefs.quickNavMappingButton;
const quickNavCourseMeta = domRefs.quickNavCourseMeta;
const quickNavSubjectMeta = domRefs.quickNavSubjectMeta;
const quickNavInstructorMeta = domRefs.quickNavInstructorMeta;
const quickNavMappingMeta = domRefs.quickNavMappingMeta;
const jibbleRightMemberText = domRefs.jibbleRightMemberText;
const jibbleRightStatInstructor = domRefs.jibbleRightStatInstructor;
const jibbleRightStatCohort = domRefs.jibbleRightStatCohort;
const jibbleRightStatConflict = domRefs.jibbleRightStatConflict;
const jibbleOpsStatus = domRefs.jibbleOpsStatus;
const jibbleOpsSummary = domRefs.jibbleOpsSummary;
const jibbleManagementSubmenu = domRefs.jibbleManagementSubmenu;
const jibbleSubCourseButton = domRefs.jibbleSubCourseButton;
const jibbleSubSubjectButton = domRefs.jibbleSubSubjectButton;
const jibbleSubInstructorButton = domRefs.jibbleSubInstructorButton;
const jibbleMainNav = domRefs.jibbleMainNav;
const jibblePrimaryNavButtons = domRefs.jibblePrimaryNavButtons;
const jibbleSubNavButtons = domRefs.jibbleSubNavButtons;
const jibblePageGroupElements = domRefs.jibblePageGroupElements;
const menuConfigList = domRefs.menuConfigList;
const saveMenuConfigButton = domRefs.saveMenuConfigButton;
const resetMenuConfigButton = domRefs.resetMenuConfigButton;
const menuConfigStatus = domRefs.menuConfigStatus;
const openConflictDetailModalButton = domRefs.openConflictDetailModalButton;
const conflictDetailModal = domRefs.conflictDetailModal;
const conflictDetailTitle = domRefs.conflictDetailTitle;
const conflictDetailContent = domRefs.conflictDetailContent;
const closeConflictDetailModalButton = domRefs.closeConflictDetailModalButton;

const riskCardTime = domRefs.riskCardTime;
const riskTimeConflict = domRefs.riskTimeConflict;
const riskCardInstructorDay = domRefs.riskCardInstructorDay;
const riskInstructorDayConflict = domRefs.riskInstructorDayConflict;
const riskCardFoDay = domRefs.riskCardFoDay;
const riskFoDayConflict = domRefs.riskFoDayConflict;
const riskCardHrd = domRefs.riskCardHrd;
const riskHrdValidation = domRefs.riskHrdValidation;
const riskCardHoliday = domRefs.riskCardHoliday;
const riskHolidayApplied = domRefs.riskHolidayApplied;

const cohortSelect = domRefs.cohortSelect;
const cohortInfo = domRefs.cohortInfo;
const downloadButton = domRefs.downloadButton;
const hrdValidationPanel = domRefs.hrdValidationPanel;
const hrdValidationList = domRefs.hrdValidationList;

const timelineRange = domRefs.timelineRange;
const timelineEmpty = domRefs.timelineEmpty;
const timelineViewTypeSelect = domRefs.timelineViewTypeSelect;
const assigneeTimelineControls = domRefs.assigneeTimelineControls;
const assigneeModeInstructorButton = domRefs.assigneeModeInstructorButton;
const assigneeModeStaffButton = domRefs.assigneeModeStaffButton;
const weekGridControls = domRefs.weekGridControls;
const weekPrevButton = domRefs.weekPrevButton;
const weekNextButton = domRefs.weekNextButton;
const weekLabel = domRefs.weekLabel;
const monthCalendarControls = domRefs.monthCalendarControls;
const monthPrevButton = domRefs.monthPrevButton;
const monthNextButton = domRefs.monthNextButton;
const monthLabel = domRefs.monthLabel;
const timelineDetailPanel = domRefs.timelineDetailPanel;
const timelineList = domRefs.timelineList;
const notificationStatusList = domRefs.notificationStatusList;

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

const holidayDateInput = domRefs.holidayDateInput;
const addHolidayButton = domRefs.addHolidayButton;
const loadPublicHolidaysButton = domRefs.loadPublicHolidaysButton;
const clearHolidaysButton = domRefs.clearHolidaysButton;
const dedupeHolidaysButton = domRefs.dedupeHolidaysButton;
const holidayLoadStatus = domRefs.holidayLoadStatus;
const holidayLoadSpinner = domRefs.holidayLoadSpinner;
const holidayList = domRefs.holidayList;

const customBreakDateInput = domRefs.customBreakDateInput;
const addCustomBreakButton = domRefs.addCustomBreakButton;
const customBreakList = domRefs.customBreakList;

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
const staffP1WeeksInput = domRefs.staffP1WeeksInput;
const staff365WeeksInput = domRefs.staff365WeeksInput;
const staffAutoFillButton = domRefs.staffAutoFillButton;
const staffRefreshButton = domRefs.staffRefreshButton;
const staffExportCsvButton = domRefs.staffExportCsvButton;
const staffExportModeSelect = domRefs.staffExportModeSelect;
const staffExportIncludeDetails = domRefs.staffExportIncludeDetails;
const staffExportModeHint = domRefs.staffExportModeHint;
const staffExportWarningsAgree = domRefs.staffExportWarningsAgree;
const staffExportValidationPanel = domRefs.staffExportValidationPanel;
const staffExportValidationList = domRefs.staffExportValidationList;
const staffModuleManagerContainer = domRefs.staffModuleManagerContainer;
const staffModuleManagerContainerAdmin = domRefs.staffModuleManagerContainerAdmin;
const staffAdvancedContainer = domRefs.staffAdvancedContainer;
const staffMatrixContainer = domRefs.staffMatrixContainer;
const staffCohortGantt = domRefs.staffCohortGantt;
const staffAssigneeGantt = domRefs.staffAssigneeGantt;
const staffKpiBody = domRefs.staffKpiBody;
const staffDetailContainer = domRefs.staffDetailContainer;

const errorCount = domRefs.errorCount;
const errorList = domRefs.errorList;
const errorEmpty = domRefs.errorEmpty;

const confCount = domRefs.confCount;
const confTableBody = domRefs.confTableBody;
const computeConflictsButton = domRefs.computeConflictsButton;
const keySearchInput = domRefs.keySearchInput;
const downloadTimeConflictsButton = domRefs.downloadTimeConflictsButton;
const confRenderNotice = domRefs.confRenderNotice;

const tabTimeConflicts = domRefs.tabTimeConflicts;
const tabInstructorDayConflicts = domRefs.tabInstructorDayConflicts;
const tabFoDayConflicts = domRefs.tabFoDayConflicts;
const timeConflictPanel = domRefs.timeConflictPanel;
const instructorDayConflictPanel = domRefs.instructorDayConflictPanel;
const foDayConflictPanel = domRefs.foDayConflictPanel;
const instructorDaySearchInput = domRefs.instructorDaySearchInput;
const foDaySearchInput = domRefs.foDaySearchInput;
const downloadInstructorDayConflictsButton = domRefs.downloadInstructorDayConflictsButton;
const downloadFoDayConflictsButton = domRefs.downloadFoDayConflictsButton;
const instructorDayOverlapCount = domRefs.instructorDayOverlapCount;
const instructorDayOverlapBody = domRefs.instructorDayOverlapBody;
const instructorDayRenderNotice = domRefs.instructorDayRenderNotice;
const foOverlapCount = domRefs.foOverlapCount;
const foOverlapBody = domRefs.foOverlapBody;
const foDayRenderNotice = domRefs.foDayRenderNotice;

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

const instructorCodeInput = domRefs.instructorCodeInput;
const instructorNameInput = domRefs.instructorNameInput;
const instructorMemoInput = domRefs.instructorMemoInput;
const upsertInstructorButton = domRefs.upsertInstructorButton;
const instructorDirectoryBody = domRefs.instructorDirectoryBody;
const courseIdInput = domRefs.courseIdInput;
const courseNameInput = domRefs.courseNameInput;
const courseMemoInput = domRefs.courseMemoInput;
const upsertCourseButton = domRefs.upsertCourseButton;
const courseRegistryBody = domRefs.courseRegistryBody;
const subjectCourseSelect = domRefs.subjectCourseSelect;
const mappingCourseSelect = domRefs.mappingCourseSelect;
const courseTemplateCourseSelect = domRefs.courseTemplateCourseSelect;
const courseTemplateNameInput = domRefs.courseTemplateNameInput;
const courseTemplateSelect = domRefs.courseTemplateSelect;
const saveCourseTemplateButton = domRefs.saveCourseTemplateButton;
const loadCourseTemplateButton = domRefs.loadCourseTemplateButton;
const deleteCourseTemplateButton = domRefs.deleteCourseTemplateButton;
const courseTemplateStatus = domRefs.courseTemplateStatus;
const subjectCodeInput = domRefs.subjectCodeInput;
const subjectNameInput = domRefs.subjectNameInput;
const subjectMemoInput = domRefs.subjectMemoInput;
const upsertSubjectButton = domRefs.upsertSubjectButton;
const subjectDirectoryBody = domRefs.subjectDirectoryBody;
const applySubjectMappingsButton = domRefs.applySubjectMappingsButton;
const subjectMappingContainer = domRefs.subjectMappingContainer;
const instructorTabCourse = domRefs.instructorTabCourse;
const instructorTabRegister = domRefs.instructorTabRegister;
const instructorTabMapping = domRefs.instructorTabMapping;
const instructorTabSubject = domRefs.instructorTabSubject;
const instructorCoursePanel = domRefs.instructorCoursePanel;
const instructorRegisterPanel = domRefs.instructorRegisterPanel;
const instructorMappingPanel = domRefs.instructorMappingPanel;
const instructorSubjectPanel = domRefs.instructorSubjectPanel;

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
  holidayLoadStatus.textContent = "자동 불러오기 미실행";
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

function submitAuthCode(): void {
  const code = authCodeInput.value.trim();
  if (code === AUTH_CODE_V2) {
    sessionStorage.setItem(AUTH_SESSION_KEY, "verified");
    applyAuthGate(true);
    void bootstrapAppAfterAuthLogin();
    return;
  }

  authStatus.textContent = "인증코드가 올바르지 않습니다.";
  authCodeInput.select();
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
        instructorSet
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
      missingInstructorSessions: item.missingInstructorSessions
    }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort) || a.module.localeCompare(b.module) || a.startDate.localeCompare(b.startDate));
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
      normalizeSubjectCode(session["교과목(및 능력단위)코드"]) === summary.module
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
    instructorCode: normalizedCode
  });
  moduleInstructorDraft.set(summary.moduleKey, normalizedCode);

  regenerateSummariesAndTimeline(cohortSelect.value);
  recomputeTimeConflictsImmediate();
  scheduleAutoSave();

  if (overwriteCount > 0) {
    setStaffingStatus(
      `⚠ ${summary.moduleKey}: ${beforeTargets.length}개 수업시간표 배정 완료 (${overwriteCount}개 기존 강사코드 덮어씀).`
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

function ensureCourseRegistryDefaults(): void {
  if (appState.courseRegistry.length > 0) {
    return;
  }

  const inferred = new Set<string>();
  for (const session of appState.sessions) {
    const parsed = parseCourseGroupFromCohortName(session.과정기수);
    const normalizedCourseId = normalizeCourseId(parsed.course);
    if (normalizedCourseId) {
      inferred.add(normalizedCourseId);
    }
  }

  if (inferred.size === 0) {
    return;
  }

  appState.courseRegistry = Array.from(inferred).map((courseId) => ({ courseId, courseName: courseId, memo: "" }));
}

function renderCourseSelectOptions(): void {
  const sortedCourses = [...appState.courseRegistry].sort((a, b) => a.courseId.localeCompare(b.courseId));
  const optionTargets = [subjectCourseSelect, mappingCourseSelect, courseTemplateCourseSelect];

  for (const select of optionTargets) {
    const previous = normalizeCourseId(select.value);
    select.innerHTML = "";

    for (const entry of sortedCourses) {
      const option = document.createElement("option");
      option.value = entry.courseId;
      option.textContent = `${entry.courseId}${entry.courseName ? ` (${entry.courseName})` : ""}`;
      select.appendChild(option);
    }

    if (sortedCourses.length === 0) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "과정을 먼저 등록하세요";
      select.appendChild(emptyOption);
      select.value = "";
      continue;
    }

    const matched = sortedCourses.find((entry) => entry.courseId === previous);
    select.value = matched ? matched.courseId : sortedCourses[0].courseId;
  }
}

function renderCourseRegistry(): void {
  ensureCourseRegistryDefaults();
  courseRegistryBody.innerHTML = "";

  const sorted = [...appState.courseRegistry].sort((a, b) => a.courseId.localeCompare(b.courseId));
  for (const entry of sorted) {
    const tr = document.createElement("tr");
    const courseIdTd = document.createElement("td");
    courseIdTd.textContent = entry.courseId;
    const nameTd = document.createElement("td");
    nameTd.textContent = entry.courseName;
    const memoTd = document.createElement("td");
    memoTd.textContent = entry.memo;
    const actionTd = document.createElement("td");

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "수정";
    editButton.addEventListener("click", () => {
      courseIdInput.value = entry.courseId;
      courseNameInput.value = entry.courseName;
      courseMemoInput.value = entry.memo;
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "삭제";
    removeButton.addEventListener("click", () => {
      appState.courseRegistry = appState.courseRegistry.filter((item) => item.courseId !== entry.courseId);
      appState.subjectDirectory = appState.subjectDirectory.filter((item) => item.courseId !== entry.courseId);
      for (const key of Array.from(subjectInstructorMappings.keys())) {
        const parsed = parseCourseSubjectKey(key);
        if (parsed.courseId === entry.courseId) {
          subjectInstructorMappings.delete(key);
        }
      }
      renderCourseRegistry();
      renderCourseSelectOptions();
      renderSubjectDirectory();
      renderSubjectMappingTable();
      scheduleAutoSave();
    });

    actionTd.appendChild(editButton);
    actionTd.appendChild(removeButton);
    tr.appendChild(courseIdTd);
    tr.appendChild(nameTd);
    tr.appendChild(memoTd);
    tr.appendChild(actionTd);
    courseRegistryBody.appendChild(tr);
  }
}

function upsertCourseRegistryEntry(): void {
  const courseId = normalizeCourseId(courseIdInput.value);
  const courseName = courseNameInput.value.trim();
  const memo = courseMemoInput.value.trim();

  if (!courseId || !courseName) {
    setStaffingStatus("과정 ID와 과정명은 필수입니다.", true);
    return;
  }

  const existing = appState.courseRegistry.find((item) => item.courseId === courseId);
  if (existing) {
    existing.courseName = courseName;
    existing.memo = memo;
  } else {
    appState.courseRegistry.push({ courseId, courseName, memo });
  }

  courseIdInput.value = "";
  courseNameInput.value = "";
  courseMemoInput.value = "";
  renderCourseRegistry();
  renderCourseSelectOptions();
  renderSubjectDirectory();
  renderSubjectMappingTable();
  markQuickNavUpdated("course");
  scheduleAutoSave();
  void syncCourseRegistryCloud({ courseId, courseName, memo });
}

function renderInstructorDirectory(): void {
  instructorDirectoryBody.innerHTML = "";

  const sorted = [...appState.instructorDirectory].sort((a, b) => a.instructorCode.localeCompare(b.instructorCode));
  for (const entry of sorted) {
    const tr = document.createElement("tr");
    const codeTd = document.createElement("td");
    codeTd.textContent = entry.instructorCode;
    const nameTd = document.createElement("td");
    nameTd.textContent = entry.name;
    const memoTd = document.createElement("td");
    memoTd.textContent = entry.memo;
    const actionTd = document.createElement("td");

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "수정";
    editButton.addEventListener("click", () => {
      instructorCodeInput.value = entry.instructorCode;
      instructorNameInput.value = entry.name;
      instructorMemoInput.value = entry.memo;
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "삭제";
    removeButton.addEventListener("click", async () => {
      const removedCode = entry.instructorCode;
      appState.instructorDirectory = appState.instructorDirectory.filter((item) => item.instructorCode !== removedCode);
      for (const [key, value] of subjectInstructorMappings.entries()) {
        if (value === removedCode) {
          subjectInstructorMappings.delete(key);
        }
      }
      renderInstructorDirectory();
      renderSubjectMappingTable();
      scheduleAutoSave();
      await syncInstructorDirectoryCloud("delete", removedCode);
    });

    actionTd.appendChild(editButton);
    actionTd.appendChild(removeButton);
    tr.appendChild(codeTd);
    tr.appendChild(nameTd);
    tr.appendChild(memoTd);
    tr.appendChild(actionTd);
    instructorDirectoryBody.appendChild(tr);
  }
}

async function syncInstructorDirectoryCloud(mode: "upsert" | "delete", instructorCode: string, payload?: InstructorDirectoryEntry): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isInstructorCloudEnabled()) {
    appState.instructorDirectoryCloudWarning =
      "클라우드 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 설정을 확인해 주세요.";
    renderGlobalWarnings();
    return;
  }

  try {
    if (mode === "upsert") {
      if (!payload) {
        return;
      }
      await upsertInstructorInCloud(payload);
    } else {
      await deleteInstructorFromCloud(instructorCode);
    }
    appState.instructorDirectoryCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.instructorDirectoryCloudWarning =
      mode === "upsert"
        ? `클라우드 강사 동기화(추가/수정) 실패: ${message}. 로컬 데이터는 유지됩니다.`
        : `클라우드 강사 동기화(삭제) 실패: ${message}. 로컬 데이터는 유지됩니다.`;
  } finally {
    renderGlobalWarnings();
  }
}

function toCourseTemplateFromCloudRecord(record: CourseTemplateRecord): CourseTemplate {
  const raw = record.templateJson;
  const source = typeof raw === "object" && raw !== null ? raw : {};
  const sourceRecord = source as Record<string, unknown>;

  const readStringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  };

  const readTemplateRows = (value: unknown): TemplateRowState[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    const rows: TemplateRowState[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Partial<TemplateRowState>;
      const weekday = typeof row.weekday === "number" ? row.weekday : Number.NaN;
      if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) {
        continue;
      }
      rows.push({
        weekday,
        start: typeof row.start === "string" ? row.start : "",
        end: typeof row.end === "string" ? row.end : "",
        breakStart: typeof row.breakStart === "string" ? row.breakStart : "",
        breakEnd: typeof row.breakEnd === "string" ? row.breakEnd : ""
      });
    }
    return rows;
  };

  const readSubjectList = (value: unknown): Array<{ subjectCode: string; subjectName: string; memo: string }> => {
    if (!Array.isArray(value)) {
      return [];
    }
    const rows: Array<{ subjectCode: string; subjectName: string; memo: string }> = [];
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const subjectCode = normalizeSubjectCode(typeof row.subjectCode === "string" ? row.subjectCode : "").toUpperCase();
      if (!subjectCode) {
        continue;
      }
      rows.push({
        subjectCode,
        subjectName: typeof row.subjectName === "string" ? row.subjectName.trim() : "",
        memo: typeof row.memo === "string" ? row.memo.trim() : ""
      });
    }
    return rows;
  };

  const readSubjectInstructorMapping = (value: unknown): Array<{ key: string; instructorCode: string }> => {
    if (!Array.isArray(value)) {
      return [];
    }
    const rows: Array<{ key: string; instructorCode: string }> = [];
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const key = typeof row.key === "string" ? row.key.trim() : "";
      const instructorCode = normalizeInstructorCode(typeof row.instructorCode === "string" ? row.instructorCode : "");
      if (!key || !instructorCode) {
        continue;
      }
      rows.push({ key, instructorCode });
    }
    return rows;
  };

  const templateCourseId = normalizeCourseId(
    typeof sourceRecord.courseId === "string" ? sourceRecord.courseId : record.courseId
  );

  return {
    name: record.templateName,
    version: typeof sourceRecord.version === "string" && sourceRecord.version.trim() ? sourceRecord.version.trim() : "v1",
    courseId: templateCourseId,
    dayTemplates: readTemplateRows(sourceRecord.dayTemplates),
    holidays: dedupeAndSortDates(readStringList(sourceRecord.holidays)),
    customBreaks: dedupeAndSortDates(readStringList(sourceRecord.customBreaks)),
    subjectList: readSubjectList(sourceRecord.subjectList),
    subjectInstructorMapping: readSubjectInstructorMapping(sourceRecord.subjectInstructorMapping)
  };
}

async function syncCourseRegistryCloud(entry: CourseRegistryEntry): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    appState.managementCloudWarning = "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    renderGlobalWarnings();
    return;
  }

  try {
    await createCourse({ courseId: entry.courseId, courseName: entry.courseName });
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `과정 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

async function syncSubjectDirectoryCloud(entry: SubjectDirectoryEntry): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    appState.managementCloudWarning = "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    renderGlobalWarnings();
    return;
  }

  try {
    await createSubject({
      courseId: entry.courseId,
      subjectCode: entry.subjectCode,
      subjectName: entry.subjectName
    });
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `교과목 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

async function syncCourseTemplateCloud(template: CourseTemplate): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    appState.managementCloudWarning = "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    renderGlobalWarnings();
    return;
  }

  try {
    await saveCourseTemplate({
      courseId: template.courseId,
      templateName: template.name,
      templateJson: {
        version: template.version,
        courseId: template.courseId,
        dayTemplates: template.dayTemplates,
        holidays: template.holidays,
        customBreaks: template.customBreaks,
        subjectList: template.subjectList,
        subjectInstructorMapping: template.subjectInstructorMapping
      }
    });
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `템플릿 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

async function syncDeleteCourseTemplateCloud(courseId: string, templateName: string): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    return;
  }

  try {
    await deleteCourseTemplate(courseId, templateName);
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `템플릿 삭제 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

async function loadManagementDataFromCloudFallback(): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    return;
  }

  try {
    let hasChanged = false;
    if (appState.courseRegistry.length === 0) {
      const cloudCourses = await listCourses();
      if (cloudCourses.length > 0) {
        appState.courseRegistry = cloudCourses.map((item) => ({
          courseId: normalizeCourseId(item.courseId),
          courseName: item.courseName,
          memo: ""
        }));
        hasChanged = true;
      }
    }

    if (appState.subjectDirectory.length === 0 && appState.courseRegistry.length > 0) {
      const byCourse = await Promise.all(appState.courseRegistry.map((course) => listSubjects(course.courseId)));
      const merged = byCourse.flat();
      if (merged.length > 0) {
        appState.subjectDirectory = merged.map((item) => ({
          courseId: normalizeCourseId(item.courseId),
          subjectCode: normalizeSubjectCode(item.subjectCode).toUpperCase(),
          subjectName: item.subjectName,
          memo: ""
        }));
        hasChanged = true;
      }
    }

    if (appState.courseTemplates.length === 0) {
      const cloudTemplates = await listCourseTemplates();
      if (cloudTemplates.length > 0) {
        appState.courseTemplates = cloudTemplates.map(toCourseTemplateFromCloudRecord);
        hasChanged = true;
      }
    }

    if (hasChanged) {
      renderCourseRegistry();
      renderCourseSelectOptions();
      renderSubjectDirectory();
      renderSubjectMappingTable();
      renderCourseTemplateOptions();
      scheduleAutoSave();
      stateStorageStatus.textContent = `클라우드 관리 데이터 동기화 완료 (${new Date().toLocaleTimeString()})`;
    }

    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `클라우드 관리 데이터 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

function renderSubjectDirectory(): void {
  subjectDirectoryBody.innerHTML = "";
  const selectedCourseId = normalizeCourseId(subjectCourseSelect.value);
  const rows = appState.subjectDirectory
    .filter((item) => item.courseId === selectedCourseId)
    .sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));

  for (const entry of rows) {
    const tr = document.createElement("tr");

    const codeTd = document.createElement("td");
    codeTd.textContent = entry.subjectCode;

    const nameTd = document.createElement("td");
    nameTd.textContent = entry.subjectName;

    const memoTd = document.createElement("td");
    memoTd.textContent = entry.memo;

    const actionTd = document.createElement("td");
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "수정";
    editButton.addEventListener("click", () => {
      subjectCourseSelect.value = entry.courseId;
      subjectCodeInput.value = entry.subjectCode;
      subjectNameInput.value = entry.subjectName;
      subjectMemoInput.value = entry.memo;
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "삭제";
    deleteButton.addEventListener("click", () => {
      appState.subjectDirectory = appState.subjectDirectory.filter(
        (item) => !(item.courseId === entry.courseId && item.subjectCode === entry.subjectCode)
      );
      subjectInstructorMappings.delete(toCourseSubjectKey(entry.courseId, entry.subjectCode));
      renderSubjectDirectory();
      renderSubjectMappingTable();
      scheduleAutoSave();
    });

    actionTd.appendChild(editButton);
    actionTd.appendChild(deleteButton);

    tr.appendChild(codeTd);
    tr.appendChild(nameTd);
    tr.appendChild(memoTd);
    tr.appendChild(actionTd);
    subjectDirectoryBody.appendChild(tr);
  }
}

function upsertSubjectDirectoryEntry(): void {
  const courseId = normalizeCourseId(subjectCourseSelect.value);
  if (!courseId) {
    setStaffingStatus("교과목을 저장할 과정을 먼저 선택해 주세요.", true);
    return;
  }

  const subjectCode = normalizeSubjectCode(subjectCodeInput.value).toUpperCase();
  if (!subjectCode) {
    setStaffingStatus("교과목코드를 입력해 주세요.", true);
    return;
  }

  const subjectName = subjectNameInput.value.trim();
  const memo = subjectMemoInput.value.trim();
  const existing = appState.subjectDirectory.find((item) => item.courseId === courseId && item.subjectCode === subjectCode);
  if (existing) {
    existing.subjectName = subjectName;
    existing.memo = memo;
  } else {
    appState.subjectDirectory.push({ courseId, subjectCode, subjectName, memo });
  }

  subjectCodeInput.value = "";
  subjectNameInput.value = "";
  subjectMemoInput.value = "";
  renderSubjectDirectory();
  renderSubjectMappingTable();
  markQuickNavUpdated("subject");
  scheduleAutoSave();
  void syncSubjectDirectoryCloud({ courseId, subjectCode, subjectName, memo });
}

function renderSubjectMappingTable(): void {
  subjectMappingContainer.innerHTML = "";
  const selectedCourseId = normalizeCourseId(mappingCourseSelect.value);
  if (!selectedCourseId) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "과정을 먼저 등록하고 선택하세요.";
    subjectMappingContainer.appendChild(empty);
    return;
  }

  const summaries = buildModuleAssignSummaries().filter(
    (summary) => normalizeCourseId(parseCourseGroupFromCohortName(summary.cohort).course) === selectedCourseId
  );
  if (summaries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "선택한 과정의 수업시간표가 없습니다.";
    subjectMappingContainer.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "subject-mapping-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  ["코호트", "교과목", "기간", "강사 선택", "직접 입력"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const summary of summaries) {
    const mappingKey = toCourseSubjectKey(selectedCourseId, summary.module);
    const tr = document.createElement("tr");
    const cohortTd = document.createElement("td");
    cohortTd.textContent = summary.cohort;
    const moduleTd = document.createElement("td");
    const subjectEntry = appState.subjectDirectory.find(
      (item) => item.courseId === selectedCourseId && item.subjectCode === summary.module
    );
    moduleTd.textContent = subjectEntry?.subjectName
      ? `${summary.module} (${subjectEntry.subjectName})`
      : summary.module;
    const periodTd = document.createElement("td");
    periodTd.textContent = `${summary.startDate}~${summary.endDate}`;

    const selectTd = document.createElement("td");
    const select = document.createElement("select");
    const autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = "선택 안함";
    select.appendChild(autoOption);
    for (const entry of appState.instructorDirectory) {
      const option = document.createElement("option");
      option.value = entry.instructorCode;
      option.textContent = `${entry.instructorCode}${entry.name ? ` (${entry.name})` : ""}`;
      select.appendChild(option);
    }

    const inputTd = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    const current = subjectInstructorMappingDraft.get(mappingKey) ?? subjectInstructorMappings.get(mappingKey) ?? "";
    input.value = current;
    select.value = appState.instructorDirectory.some((item) => item.instructorCode === current) ? current : "";

    select.addEventListener("change", () => {
      if (select.value) {
        input.value = select.value;
      }
      subjectInstructorMappingDraft.set(mappingKey, normalizeInstructorCode(input.value));
    });
    input.addEventListener("input", () => {
      subjectInstructorMappingDraft.set(mappingKey, normalizeInstructorCode(input.value));
    });

    selectTd.appendChild(select);
    inputTd.appendChild(input);
    tr.appendChild(cohortTd);
    tr.appendChild(moduleTd);
    tr.appendChild(periodTd);
    tr.appendChild(selectTd);
    tr.appendChild(inputTd);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  subjectMappingContainer.appendChild(table);
}

function upsertInstructorDirectoryEntry(): void {
  const instructorCode = normalizeInstructorCode(instructorCodeInput.value);
  if (!instructorCode) {
    setStaffingStatus("강사코드를 입력해 주세요.", true);
    return;
  }

  const name = instructorNameInput.value.trim();
  const memo = instructorMemoInput.value.trim();
  const existing = appState.instructorDirectory.find((item) => item.instructorCode === instructorCode);
  if (existing) {
    existing.name = name;
    existing.memo = memo;
  } else {
    appState.instructorDirectory.push({ instructorCode, name, memo });
  }

  instructorCodeInput.value = "";
  instructorNameInput.value = "";
  instructorMemoInput.value = "";
  renderInstructorDirectory();
  renderSubjectMappingTable();
  markQuickNavUpdated("instructor");
  scheduleAutoSave();
  void syncInstructorDirectoryCloud("upsert", instructorCode, { instructorCode, name, memo });
}

function applySubjectMappingsToSessions(): void {
  const selectedCohort = cohortSelect.value.trim();
  if (!selectedCohort) {
    setStaffingStatus("먼저 적용할 기수를 선택해 주세요.", true);
    return;
  }

  const cohortCourseId = normalizeCourseId(parseCourseGroupFromCohortName(selectedCohort).course);
  const selectedCourseId = normalizeCourseId(mappingCourseSelect.value || cohortCourseId);
  if (selectedCourseId !== cohortCourseId) {
    setStaffingStatus("선택 기수와 다른 과정이 선택되었습니다. 동일 과정으로 맞춰 주세요.", true);
    return;
  }

  const courseSubjects = appState.subjectDirectory.filter((item) => item.courseId === selectedCourseId);
  const subjectDirectoryCodes = new Set(courseSubjects.map((item) => item.subjectCode));
  const cohortSessionSubjects = new Set(
    appState.sessions
      .filter((session) => session.과정기수.trim() === selectedCohort)
      .map((session) => normalizeSubjectCode(session["교과목(및 능력단위)코드"]).toUpperCase())
      .filter((value) => value.length > 0)
  );
  let missingSubjectCount = 0;
  for (const subjectCode of cohortSessionSubjects) {
    if (!subjectDirectoryCodes.has(subjectCode)) {
      missingSubjectCount += 1;
    }
  }
  const normalizedMappings: Array<{ cohort: string; subjectCode: string; instructorCode: string }> = [];

  for (const subject of courseSubjects) {
    const mappingKey = toCourseSubjectKey(selectedCourseId, subject.subjectCode);
    const selectedCode = normalizeInstructorCode(
      subjectInstructorMappingDraft.get(mappingKey) ?? subjectInstructorMappings.get(mappingKey) ?? ""
    );
    if (!selectedCode) {
      continue;
    }

    subjectInstructorMappings.set(mappingKey, selectedCode);
    normalizedMappings.push({
      cohort: selectedCohort,
      subjectCode: subject.subjectCode,
      instructorCode: selectedCode
    });
  }

  const applyResult = applyCourseSubjectInstructorMappingsToCohortSessions(
    appState.sessions,
    selectedCohort,
    normalizedMappings.map((item) => ({
      courseId: selectedCourseId,
      subjectCode: item.subjectCode,
      instructorCode: item.instructorCode
    })),
    subjectDirectoryCodes
  );
  const updatedRows = applyResult.updatedRows;
  const overwriteRows = applyResult.overwrittenRows;

  if (updatedRows === 0) {
    setStaffingStatus("적용할 교과목 매핑이 없습니다.", true);
    return;
  }

  appState.sessions = applyResult.sessions.map((session) => ({
    ...session,
    "교과목(및 능력단위)코드": normalizeSubjectCode(session["교과목(및 능력단위)코드"]).toUpperCase()
  }));
  moduleInstructorDraft.clear();
  subjectInstructorMappingDraft.clear();
  regenerateSummariesAndTimeline(selectedCohort);
  recomputeTimeConflictsImmediate();
  scheduleAutoSave();

  setStaffingStatus(
    overwriteRows > 0
      ? `교과목 매핑 일괄 적용 완료: ${updatedRows}개 수업시간표 반영 (${overwriteRows}개 덮어씀)`
      : `교과목 매핑 일괄 적용 완료: ${updatedRows}개 수업시간표 반영`
  );
  if (missingSubjectCount > 0) {
    pushRecentActionLog(
      "WARNING",
      `경고: 교과목 미등록 ${missingSubjectCount}개 (HRD 다운로드는 가능)`,
      "instructorDrawer"
    );
  }
  pushRecentActionLog("INFO", `강사 매핑 적용: 교과목 ${normalizedMappings.length}개 업데이트`, "instructorDrawer");
  markQuickNavUpdated("mapping");
}

function buildNotifications(): NotificationItem[] {
  return appState.recentActionLogs.map((log) => ({
    id: log.id,
    severity: log.severity,
    source: "HRD_VALIDATION",
    title: log.severity === "ERROR" ? "오류" : log.severity === "WARNING" ? "경고" : "정보",
    message: log.message
  }));
}

function refreshNotificationItems(): NotificationItem[] {
  appState.notificationItems = buildNotifications();
  return appState.notificationItems;
}

function getCohortNotificationCountMap(items: NotificationItem[]): Map<string, { warning: number; error: number }> {
  const map = new Map<string, { warning: number; error: number }>();
  void items;
  return map;
}

function renderNotificationCenter(): void {
  refreshNotificationItems();
  notificationStatusList.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "notification-list";
  const logs = [...appState.recentActionLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  if (logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "최근 작업 로그가 없습니다.";
    wrap.appendChild(empty);
  }

  for (const row of logs) {
    const card = document.createElement("div");
    card.className = `notification-item ${
      row.severity === "ERROR" ? "error" : row.severity === "WARNING" ? "warning" : "info"
    }`;
    if (row.focusSectionId) {
      card.role = "button";
      card.tabIndex = 0;
      card.addEventListener("click", () => {
        scrollToSection(row.focusSectionId ?? "sectionTimeline");
        closeDrawers();
      });
    }

    const head = document.createElement("div");
    head.innerHTML = `<strong>${row.severity}</strong> · ${new Date(row.createdAt).toLocaleString()}`;
    card.appendChild(head);

    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = row.message;
    card.appendChild(msg);

    wrap.appendChild(card);
  }

  notificationStatusList.appendChild(wrap);
}

function pushRecentActionLog(
  severity: "INFO" | "WARNING" | "ERROR",
  message: string,
  focusSectionId?: string
): void {
  appState.recentActionLogs = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      severity,
      message,
      focusSectionId,
      createdAt: new Date().toISOString()
    },
    ...appState.recentActionLogs
  ].slice(0, 5);
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
    isProd: isProdRuntime()
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
    quickNavCourseMeta.textContent = text;
    return;
  }
  if (target === "subject") {
    quickNavSubjectMeta.textContent = text;
    return;
  }
  if (target === "instructor") {
    quickNavInstructorMeta.textContent = text;
    return;
  }
  quickNavMappingMeta.textContent = text;
}

function closeDrawers(): void {
  appState.activeDrawer = null;
  drawerBackdrop.classList.remove("open");
  notificationDrawer.classList.remove("open");
  notificationDrawer.setAttribute("aria-hidden", "true");

  if (appState.managementInlineMode) {
    instructorDrawer.classList.add("open");
    instructorDrawer.setAttribute("aria-hidden", "false");
    return;
  }

  instructorDrawer.classList.remove("open");
  instructorDrawer.setAttribute("aria-hidden", "true");
}

function openDrawer(target: "notification" | "instructor"): void {
  closeDrawers();
  appState.activeDrawer = target;
  if (target === "notification") {
    drawerBackdrop.classList.add("open");
    notificationDrawer.classList.add("open");
    notificationDrawer.setAttribute("aria-hidden", "false");
    return;
  }

  instructorDrawer.classList.add("open");
  instructorDrawer.setAttribute("aria-hidden", "false");
  if (!appState.managementInlineMode) {
    drawerBackdrop.classList.add("open");
  }
}

function switchInstructorDrawerTab(tab: "course" | "register" | "mapping" | "subject"): void {
  const course = tab === "course";
  const register = tab === "register";
  const mapping = tab === "mapping";
  const subject = tab === "subject";
  instructorTabCourse.classList.toggle("active", course);
  instructorTabRegister.classList.toggle("active", register);
  instructorTabMapping.classList.toggle("active", mapping);
  instructorTabSubject.classList.toggle("active", subject);
  quickNavCourseButton.classList.toggle("is-active", course);
  quickNavSubjectButton.classList.toggle("is-active", subject);
  quickNavInstructorButton.classList.toggle("is-active", register);
  quickNavMappingButton.classList.toggle("is-active", mapping);
  instructorCoursePanel.style.display = course ? "block" : "none";
  instructorRegisterPanel.style.display = register ? "block" : "none";
  instructorMappingPanel.style.display = mapping ? "block" : "none";
  instructorSubjectPanel.style.display = subject ? "block" : "none";

  if (course) {
    setJibbleManagementSubmenuActive("course");
  } else if (subject) {
    setJibbleManagementSubmenuActive("subject");
  } else if (register) {
    setJibbleManagementSubmenuActive("instructor");
  }
}

function openInstructorDrawerWithTab(tab: "course" | "register" | "mapping" | "subject"): void {
  openDrawer("instructor");
  switchInstructorDrawerTab(tab);
  if (appState.managementInlineMode) {
    instructorDrawer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setNotificationFocus(focus: { cohort?: string; assignee?: string; date?: string } | null): void {
  appState.notificationFocus = focus;
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

function isPrimarySidebarNavKey(value: string): value is PrimarySidebarNavKey {
  return PRIMARY_SIDEBAR_NAV_KEYS.includes(value as PrimarySidebarNavKey);
}

function normalizeSidebarMenuLabel(navKey: PrimarySidebarNavKey, value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PRIMARY_SIDEBAR_LABELS[navKey];
}

function normalizeSidebarMenuIcon(navKey: PrimarySidebarNavKey, value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PRIMARY_SIDEBAR_ICONS[navKey];
}

function cloneSidebarMenuConfig(config: SidebarMenuConfig): SidebarMenuConfig {
  return {
    order: [...config.order],
    labels: {
      timeline: config.labels.timeline,
      generator: config.labels.generator,
      kpi: config.labels.kpi,
      attendance: config.labels.attendance,
      analytics: config.labels.analytics,
      settings: config.labels.settings
    },
    icons: {
      timeline: config.icons.timeline,
      generator: config.icons.generator,
      kpi: config.icons.kpi,
      attendance: config.icons.attendance,
      analytics: config.icons.analytics,
      settings: config.icons.settings
    }
  };
}

function normalizeSidebarMenuOrder(orderValue: unknown): PrimarySidebarNavKey[] {
  if (!Array.isArray(orderValue)) {
    return [...PRIMARY_SIDEBAR_NAV_KEYS];
  }

  const deduped: PrimarySidebarNavKey[] = [];
  for (const value of orderValue) {
    if (typeof value !== "string") {
      continue;
    }

    if (!isPrimarySidebarNavKey(value) || deduped.includes(value)) {
      continue;
    }

    deduped.push(value);
  }

  for (const navKey of PRIMARY_SIDEBAR_NAV_KEYS) {
    if (!deduped.includes(navKey)) {
      deduped.push(navKey);
    }
  }

  return deduped;
}

function normalizeSidebarMenuConfig(config: SidebarMenuConfig): SidebarMenuConfig {
  return {
    order: normalizeSidebarMenuOrder(config.order),
    labels: {
      timeline: normalizeSidebarMenuLabel("timeline", config.labels.timeline),
      generator: normalizeSidebarMenuLabel("generator", config.labels.generator),
      kpi: normalizeSidebarMenuLabel("kpi", config.labels.kpi),
      attendance: normalizeSidebarMenuLabel("attendance", config.labels.attendance),
      analytics: normalizeSidebarMenuLabel("analytics", config.labels.analytics),
      settings: normalizeSidebarMenuLabel("settings", config.labels.settings)
    },
    icons: {
      timeline: normalizeSidebarMenuIcon("timeline", config.icons.timeline),
      generator: normalizeSidebarMenuIcon("generator", config.icons.generator),
      kpi: normalizeSidebarMenuIcon("kpi", config.icons.kpi),
      attendance: normalizeSidebarMenuIcon("attendance", config.icons.attendance),
      analytics: normalizeSidebarMenuIcon("analytics", config.icons.analytics),
      settings: normalizeSidebarMenuIcon("settings", config.icons.settings)
    }
  };
}

function getDefaultSidebarMenuConfig(): SidebarMenuConfig {
  return {
    order: [...PRIMARY_SIDEBAR_NAV_KEYS],
    labels: {
      timeline: DEFAULT_PRIMARY_SIDEBAR_LABELS.timeline,
      generator: DEFAULT_PRIMARY_SIDEBAR_LABELS.generator,
      kpi: DEFAULT_PRIMARY_SIDEBAR_LABELS.kpi,
      attendance: DEFAULT_PRIMARY_SIDEBAR_LABELS.attendance,
      analytics: DEFAULT_PRIMARY_SIDEBAR_LABELS.analytics,
      settings: DEFAULT_PRIMARY_SIDEBAR_LABELS.settings
    },
    icons: {
      timeline: DEFAULT_PRIMARY_SIDEBAR_ICONS.timeline,
      generator: DEFAULT_PRIMARY_SIDEBAR_ICONS.generator,
      kpi: DEFAULT_PRIMARY_SIDEBAR_ICONS.kpi,
      attendance: DEFAULT_PRIMARY_SIDEBAR_ICONS.attendance,
      analytics: DEFAULT_PRIMARY_SIDEBAR_ICONS.analytics,
      settings: DEFAULT_PRIMARY_SIDEBAR_ICONS.settings
    }
  };
}

function loadSidebarMenuConfig(): SidebarMenuConfig {
  const fallback = getDefaultSidebarMenuConfig();
  const raw = localStorage.getItem(SIDEBAR_MENU_CONFIG_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as {
      order?: unknown;
      labels?: Record<string, unknown>;
      icons?: Record<string, unknown>;
    };

    const order = normalizeSidebarMenuOrder(parsed.order);
    const labels = {
      timeline: normalizeSidebarMenuLabel(
        "timeline",
        typeof parsed.labels?.timeline === "string"
          ? parsed.labels.timeline
          : fallback.labels.timeline
      ),
      generator: normalizeSidebarMenuLabel(
        "generator",
        typeof parsed.labels?.generator === "string"
          ? parsed.labels.generator
          : fallback.labels.generator
      ),
      kpi: normalizeSidebarMenuLabel(
        "kpi",
        typeof parsed.labels?.kpi === "string"
          ? parsed.labels.kpi
          : fallback.labels.kpi
      ),
      attendance: normalizeSidebarMenuLabel(
        "attendance",
        typeof parsed.labels?.attendance === "string"
          ? parsed.labels.attendance
          : fallback.labels.attendance
      ),
      analytics: normalizeSidebarMenuLabel(
        "analytics",
        typeof parsed.labels?.analytics === "string"
          ? parsed.labels.analytics
          : fallback.labels.analytics
      ),
      settings: normalizeSidebarMenuLabel(
        "settings",
        typeof parsed.labels?.settings === "string"
          ? parsed.labels.settings
          : fallback.labels.settings
      )
    };

    const icons = {
      timeline: normalizeSidebarMenuIcon(
        "timeline",
        typeof parsed.icons?.timeline === "string"
          ? parsed.icons.timeline
          : fallback.icons.timeline
      ),
      generator: normalizeSidebarMenuIcon(
        "generator",
        typeof parsed.icons?.generator === "string"
          ? parsed.icons.generator
          : fallback.icons.generator
      ),
      kpi: normalizeSidebarMenuIcon(
        "kpi",
        typeof parsed.icons?.kpi === "string"
          ? parsed.icons.kpi
          : fallback.icons.kpi
      ),
      attendance: normalizeSidebarMenuIcon(
        "attendance",
        typeof parsed.icons?.attendance === "string"
          ? parsed.icons.attendance
          : fallback.icons.attendance
      ),
      analytics: normalizeSidebarMenuIcon(
        "analytics",
        typeof parsed.icons?.analytics === "string"
          ? parsed.icons.analytics
          : fallback.icons.analytics
      ),
      settings: normalizeSidebarMenuIcon(
        "settings",
        typeof parsed.icons?.settings === "string"
          ? parsed.icons.settings
          : fallback.icons.settings
      )
    };

    return { order, labels, icons };
  } catch {
    return fallback;
  }
}

function saveSidebarMenuConfig(config: SidebarMenuConfig): void {
  localStorage.setItem(SIDEBAR_MENU_CONFIG_KEY, JSON.stringify(config));
}

function getPrimarySidebarButtonByKey(navKey: PrimarySidebarNavKey): HTMLButtonElement | undefined {
  return jibblePrimaryNavButtons.find((button) => button.dataset.navKey?.trim() === navKey);
}

function applySidebarMenuConfigToSidebar(config: SidebarMenuConfig): void {
  if (jibbleMainNav) {
    for (const navKey of config.order) {
      const button = getPrimarySidebarButtonByKey(navKey);
      if (button) {
        jibbleMainNav.appendChild(button);
      }
    }
  }

  for (const navKey of PRIMARY_SIDEBAR_NAV_KEYS) {
    const button = getPrimarySidebarButtonByKey(navKey);
    if (!button) {
      continue;
    }

    const iconElement = button.querySelector<HTMLElement>(".jibble-nav-icon");
    const icon = normalizeSidebarMenuIcon(navKey, config.icons[navKey]);
    button.dataset.navIcon = icon;
    if (iconElement) {
      iconElement.textContent = icon;
    }

    const labelElement = button.querySelector<HTMLElement>(".jibble-nav-label");
    const label = normalizeSidebarMenuLabel(navKey, config.labels[navKey]);
    if (labelElement) {
      labelElement.textContent = label;
    }
  }

  setJibbleSidebarActive(appState.activePrimarySidebarPage);
}

function moveSidebarMenuDraft(navKey: PrimarySidebarNavKey, direction: -1 | 1): void {
  const currentIndex = appState.sidebarMenuDraft.order.indexOf(navKey);
  if (currentIndex < 0) {
    return;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= appState.sidebarMenuDraft.order.length) {
    return;
  }

  const nextOrder = [...appState.sidebarMenuDraft.order];
  const [moved] = nextOrder.splice(currentIndex, 1);
  nextOrder.splice(nextIndex, 0, moved);
  appState.sidebarMenuDraft = {
    ...appState.sidebarMenuDraft,
    order: nextOrder
  };

  applySidebarMenuConfigToSidebar(appState.sidebarMenuDraft);
  renderSidebarMenuConfigEditor();
  menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
}

function renderSidebarMenuConfigEditor(): void {
  menuConfigList.innerHTML = "";

  const total = appState.sidebarMenuDraft.order.length;
  for (const [index, navKey] of appState.sidebarMenuDraft.order.entries()) {
    const row = document.createElement("div");
    row.className = "menu-config-row";

    const icon = document.createElement("span");
    icon.className = "menu-config-icon";
    icon.textContent = normalizeSidebarMenuIcon(navKey, appState.sidebarMenuDraft.icons[navKey]);
    row.appendChild(icon);

    const iconInput = document.createElement("input");
    iconInput.className = "menu-config-icon-input";
    iconInput.type = "text";
    iconInput.maxLength = 4;
    iconInput.value = appState.sidebarMenuDraft.icons[navKey];
    iconInput.setAttribute("aria-label", `${navKey} 아이콘`);
    iconInput.addEventListener("input", () => {
      appState.sidebarMenuDraft.icons[navKey] = iconInput.value;
      icon.textContent = normalizeSidebarMenuIcon(navKey, iconInput.value);
      applySidebarMenuConfigToSidebar(appState.sidebarMenuDraft);
      menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
    });
    row.appendChild(iconInput);

    const input = document.createElement("input");
    input.className = "menu-config-input";
    input.type = "text";
    input.maxLength = 20;
    input.value = appState.sidebarMenuDraft.labels[navKey];
    input.addEventListener("input", () => {
      appState.sidebarMenuDraft.labels[navKey] = input.value;
      applySidebarMenuConfigToSidebar(appState.sidebarMenuDraft);
      menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
    });
    row.appendChild(input);

    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "menu-config-move";
    upButton.textContent = "↑";
    upButton.disabled = index === 0;
    upButton.addEventListener("click", () => moveSidebarMenuDraft(navKey, -1));
    row.appendChild(upButton);

    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "menu-config-move";
    downButton.textContent = "↓";
    downButton.disabled = index === total - 1;
    downButton.addEventListener("click", () => moveSidebarMenuDraft(navKey, 1));
    row.appendChild(downButton);

    menuConfigList.appendChild(row);
  }
}

function setPageGroupVisibility(activePage: PrimarySidebarNavKey): void {
  for (const element of jibblePageGroupElements) {
    const group = element.dataset.pageGroup?.trim() ?? "";
    if (!group) {
      continue;
    }

    element.classList.toggle("jibble-page-hidden", group !== activePage);
  }
}

function activatePrimarySidebarPage(
  navKey: PrimarySidebarNavKey,
  options: ActivatePrimaryPageOptions = {}
): void {
  appState.activePrimarySidebarPage = navKey;
  setJibbleSidebarActive(navKey);
  setPageGroupVisibility(navKey);

  // 설정 페이지에 과정 정보입력(management) 콘텐츠가 통합됨
  const showManagement = navKey === "settings";
  setJibbleManagementSubmenuVisible(showManagement);
  if (showManagement && options.openManagementTab !== false) {
    setJibbleManagementSubmenuActive("course");
    openInstructorDrawerWithTab("course");
  }

  if (options.scrollToTop !== false) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function scrollToSection(sectionId: string): void {
  const target = document.getElementById(sectionId);
  if (!target) {
    return;
  }

  const pageGroup = target.dataset.pageGroup?.trim() ?? "";
  if (isPrimarySidebarNavKey(pageGroup) && pageGroup !== appState.activePrimarySidebarPage) {
    activatePrimarySidebarPage(pageGroup, { scrollToTop: false, openManagementTab: false });
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setJibbleManagementSubmenuVisible(visible: boolean): void {
  if (!jibbleManagementSubmenu) {
    return;
  }

  jibbleManagementSubmenu.classList.toggle("u-hidden", !visible);
}

function setJibbleManagementSubmenuActive(tab: "course" | "subject" | "instructor"): void {
  jibbleSubCourseButton?.classList.toggle("is-active", tab === "course");
  jibbleSubSubjectButton?.classList.toggle("is-active", tab === "subject");
  jibbleSubInstructorButton?.classList.toggle("is-active", tab === "instructor");
}

function setJibbleSidebarActive(navKey: PrimarySidebarNavKey): void {
  for (const button of jibblePrimaryNavButtons) {
    const currentKey = button.dataset.navKey?.trim() ?? "";
    button.classList.toggle("is-active", currentKey === navKey);
  }
}

function setupJibbleSidebarNavigation(): void {
  if (jibblePrimaryNavButtons.length === 0) {
    return;
  }

  for (const button of jibblePrimaryNavButtons) {
    button.addEventListener("click", () => {
      const navKeyRaw = button.dataset.navKey?.trim() ?? "";
      if (!isPrimarySidebarNavKey(navKeyRaw)) {
        return;
      }

      activatePrimarySidebarPage(navKeyRaw, {
        scrollToTop: true,
        openManagementTab: navKeyRaw === "settings"
      });
    });
  }

  for (const button of jibbleSubNavButtons) {
    button.addEventListener("click", () => {
      const targetId = button.dataset.scrollTarget?.trim() ?? "";
      if (!targetId) {
        return;
      }

      scrollToSection(targetId);
    });
  }

  const activeButton =
    jibblePrimaryNavButtons.find((button) => button.classList.contains("is-active")) ||
    jibblePrimaryNavButtons[0];
  const initialNavKeyRaw = activeButton?.dataset.navKey?.trim() ?? "timeline";
  const initialNavKey = isPrimarySidebarNavKey(initialNavKeyRaw) ? initialNavKeyRaw : "timeline";

  activatePrimarySidebarPage(initialNavKey, {
    scrollToTop: false,
    openManagementTab: false
  });

  // Mobile bottom nav
  const mobileNavButtons = document.querySelectorAll<HTMLButtonElement>("[data-mobile-nav]");
  for (const btn of mobileNavButtons) {
    btn.addEventListener("click", () => {
      const navKeyRaw = btn.dataset.mobileNav?.trim() ?? "";
      if (!isPrimarySidebarNavKey(navKeyRaw)) {
        return;
      }
      // Update mobile active state
      for (const b of mobileNavButtons) b.classList.remove("is-active");
      btn.classList.add("is-active");
      // Also sync desktop sidebar
      activatePrimarySidebarPage(navKeyRaw, {
        scrollToTop: true,
        openManagementTab: navKeyRaw === "settings"
      });
    });
  }
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
        assignment.assignee.trim().length > 0
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

function renderGlobalWarnings(): void {
  const warnings: string[] = [];
  const trackTypeMissing = getTrackTypeMissingCohorts();
  const unassignedModules = getUnassignedInstructorModules();
  const cloudWarning = appState.instructorDirectoryCloudWarning.trim();
  const managementWarning = appState.managementCloudWarning.trim();

  if (trackTypeMissing.length > 0) {
    warnings.push(`trackType 미설정 코호트: ${trackTypeMissing.join(", ")}`);
  }

  if (unassignedModules.length > 0) {
    const preview = unassignedModules.slice(0, 6).join(", ");
    const suffix = unassignedModules.length > 6 ? ` 외 ${unassignedModules.length - 6}건` : "";
    warnings.push(`강사 배정 안된 모듈/코호트: ${preview}${suffix}`);
  }

  if (appState.hasComputedConflicts && appState.allConflicts.length > 0) {
    warnings.push(`강사 시간 충돌 ${appState.allConflicts.length}건`);
  }

  if (cohortSelect.value && appState.hrdValidationErrors.length > 0) {
    warnings.push(`HRD 검증 오류 ${appState.hrdValidationErrors.length}건 (기수: ${cohortSelect.value})`);
  }

  if (cloudWarning) {
    warnings.push(`강사 동기화: ${cloudWarning}`);
  }

  if (managementWarning) {
    warnings.push(`관리 데이터 동기화: ${managementWarning}`);
  }

  globalWarningList.innerHTML = "";

  if (warnings.length === 0) {
    globalWarningPanel.style.display = "none";
    renderHeaderRuntimeStatus();
    return;
  }

  globalWarningPanel.style.display = "block";
  for (const warning of warnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    globalWarningList.appendChild(li);
  }
  renderHeaderRuntimeStatus();
}

function setRiskCardState(card: HTMLElement, valueElement: HTMLElement, text: string, tone: "ok" | "warn" | "error"): void {
  card.classList.remove("risk-ok", "risk-warn", "risk-error");
  card.classList.add(tone === "ok" ? "risk-ok" : tone === "warn" ? "risk-warn" : "risk-error");
  valueElement.textContent = text;
}

function renderRiskSummary(): void {
  if (!appState.hasComputedConflicts) {
    setRiskCardState(riskCardTime, riskTimeConflict, "0 / 미계산", "warn");
  } else {
    setRiskCardState(
      riskCardTime,
      riskTimeConflict,
      `0 / ${appState.allConflicts.length}`,
      appState.allConflicts.length === 0 ? "ok" : "error"
    );
  }

  if (appState.staffingAssignments.length === 0) {
    setRiskCardState(riskCardInstructorDay, riskInstructorDayConflict, "0 / 미계산", "warn");
    setRiskCardState(riskCardFoDay, riskFoDayConflict, "0 / 미계산", "warn");
  } else {
    setRiskCardState(
      riskCardInstructorDay,
      riskInstructorDayConflict,
      `0 / ${appState.instructorDayOverlaps.length}`,
      appState.instructorDayOverlaps.length === 0 ? "ok" : "error"
    );
    setRiskCardState(
      riskCardFoDay,
      riskFoDayConflict,
      `0 / ${appState.facilitatorOperationOverlaps.length}`,
      appState.facilitatorOperationOverlaps.length === 0 ? "ok" : "error"
    );
  }

  if (!cohortSelect.value) {
    setRiskCardState(riskCardHrd, riskHrdValidation, "대상 없음", "warn");
  } else {
    setRiskCardState(
      riskCardHrd,
      riskHrdValidation,
      isHrdChecklistPassed() ? "통과" : "미통과",
      isHrdChecklistPassed() ? "ok" : "warn"
    );
  }

  setRiskCardState(
    riskCardHoliday,
    riskHolidayApplied,
    isHolidayApplied() ? "적용" : "미적용",
    isHolidayApplied() ? "ok" : "warn"
  );
}

function renderJibbleRightRail(): void {
  if (
    !jibbleRightMemberText ||
    !jibbleRightStatInstructor ||
    !jibbleRightStatCohort ||
    !jibbleRightStatConflict ||
    !jibbleOpsStatus ||
    !jibbleOpsSummary
  ) {
    return;
  }

  const instructorCount = appState.instructorDirectory.length;
  const cohortCount = appState.summaries.length;
  const conflictCount = appState.hasComputedConflicts ? appState.allConflicts.length : -1;
  const unassignedCount = getUnassignedInstructorModules().length;

  jibbleRightMemberText.textContent = `강사 ${instructorCount}명 등록`;
  jibbleRightStatInstructor.textContent = String(instructorCount);
  jibbleRightStatCohort.textContent = String(cohortCount);
  jibbleRightStatConflict.textContent = conflictCount >= 0 ? String(conflictCount) : "-";

  if (!cohortSelect.value) {
    jibbleOpsStatus.textContent = "검토중";
    jibbleOpsSummary.textContent = "기수를 선택하면 운영 상태를 계산합니다.";
    return;
  }

  if (!appState.hasComputedConflicts) {
    jibbleOpsStatus.textContent = "분석대기";
    jibbleOpsSummary.textContent = `${cohortSelect.value} · 시간 충돌 계산 전`;
    return;
  }

  if (isHrdChecklistPassed()) {
    jibbleOpsStatus.textContent = "안정";
    jibbleOpsSummary.textContent = `${cohortSelect.value} · HRD 점검 통과 준비 완료`;
    return;
  }

  if (appState.allConflicts.length > 0 || appState.instructorDayOverlaps.length > 0 || unassignedCount > 0) {
    jibbleOpsStatus.textContent = "점검필요";
    jibbleOpsSummary.textContent =
      `${cohortSelect.value} · 시간충돌 ${appState.allConflicts.length}건 / 일충돌 ${appState.instructorDayOverlaps.length}건 / 미배정 ${unassignedCount}건`;
    return;
  }

  jibbleOpsStatus.textContent = "검토중";
  jibbleOpsSummary.textContent = `${cohortSelect.value} · 운영 체크리스트 점검 중`;
}

function clearGanttHighlights(): void {
  const highlighted = document.querySelectorAll<HTMLElement>(".staff-gantt-bar.gantt-highlight");
  for (const element of highlighted) {
    element.classList.remove("gantt-highlight");
  }
}

function highlightGanttByCohortModule(cohort: string, module?: string): void {
  clearGanttHighlights();

  const bars = document.querySelectorAll<HTMLElement>("#staffCohortGantt .staff-gantt-bar, #staffAssigneeGantt .staff-gantt-bar");
  const matched: HTMLElement[] = [];

  for (const bar of bars) {
    const barCohort = bar.dataset.cohort ?? "";
    const barPhase = bar.dataset.phase ?? "";
    if (barCohort !== cohort) {
      continue;
    }
    if (module && barPhase !== module) {
      continue;
    }
    bar.classList.add("gantt-highlight");
    matched.push(bar);
  }

  if (matched.length > 0) {
    matched[0].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }

  if (appState.ganttHighlightTimer !== undefined) {
    window.clearTimeout(appState.ganttHighlightTimer);
  }
  appState.ganttHighlightTimer = window.setTimeout(() => clearGanttHighlights(), 3500);
}

function collectTemplateRowsState(): TemplateRowState[] {
  return scheduleTemplatesCollectTemplateRowsState();
}

function applyTemplateRowsState(rows: TemplateRowState[] | undefined): void {
  scheduleTemplatesApplyTemplateRowsState(rows);
}

function saveScheduleTemplatesToLocalStorage(): void {
  scheduleTemplatesSaveScheduleTemplatesToLocalStorage();
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

function buildCourseTemplateOptionValue(template: CourseTemplate): string {
  return `${template.courseId}|||${template.name}`;
}

function parseCourseTemplateOptionValue(value: string): { courseId: string; name: string } {
  const [courseIdRaw, nameRaw] = value.split("|||");
  return {
    courseId: normalizeCourseId(courseIdRaw ?? ""),
    name: (nameRaw ?? "").trim()
  };
}

function renderCourseTemplateOptions(preferredValue = ""): void {
  const selectedCourseId = normalizeCourseId(courseTemplateCourseSelect.value);
  const previous = preferredValue || courseTemplateSelect.value;
  courseTemplateSelect.innerHTML = "";

  const templates = appState.courseTemplates
    .filter((item) => item.courseId === selectedCourseId)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (templates.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "저장된 템플릿 없음";
    courseTemplateSelect.appendChild(emptyOption);
    courseTemplateSelect.value = "";
    return;
  }

  for (const template of templates) {
    const option = document.createElement("option");
    option.value = buildCourseTemplateOptionValue(template);
    option.textContent = `${template.name} (${template.version})`;
    courseTemplateSelect.appendChild(option);
  }

  const hasPrevious = templates.some((item) => buildCourseTemplateOptionValue(item) === previous);
  courseTemplateSelect.value = hasPrevious
    ? previous
    : buildCourseTemplateOptionValue(templates[0]);
}

function saveCurrentCourseTemplate(): void {
  const courseId = normalizeCourseId(courseTemplateCourseSelect.value);
  const name = courseTemplateNameInput.value.trim();
  if (!courseId || !name) {
    courseTemplateStatus.textContent = "과정과 템플릿명을 입력해 주세요.";
    return;
  }

  const subjectList = appState.subjectDirectory
    .filter((item) => item.courseId === courseId)
    .map((item) => ({ subjectCode: item.subjectCode, subjectName: item.subjectName, memo: item.memo }));

  const subjectInstructorMapping = Array.from(subjectInstructorMappings.entries())
    .map(([key, instructorCode]) => ({ key, instructorCode }))
    .filter((item) => parseCourseSubjectKey(item.key).courseId === courseId);

  const template: CourseTemplate = {
    name,
    version: "v1",
    courseId,
    dayTemplates: collectTemplateRowsState(),
    holidays: [...appState.holidayDates],
    customBreaks: [...appState.customBreakDates],
    subjectList,
    subjectInstructorMapping
  };

  const existingIndex = appState.courseTemplates.findIndex((item) => item.courseId === courseId && item.name === name);
  if (existingIndex >= 0) {
    appState.courseTemplates[existingIndex] = template;
  } else {
    appState.courseTemplates.push(template);
  }

  courseTemplateNameInput.value = "";
  const selectedValue = buildCourseTemplateOptionValue(template);
  renderCourseTemplateOptions(selectedValue);
  courseTemplateStatus.textContent = `템플릿 저장 완료: ${courseId} / ${name}`;
  pushRecentActionLog("INFO", `템플릿 저장 완료: ${courseId}`, "instructorDrawer");
  scheduleAutoSave();
  void syncCourseTemplateCloud(template);
}

function applySelectedCourseTemplate(): void {
  const selected = parseCourseTemplateOptionValue(courseTemplateSelect.value);
  const template = appState.courseTemplates.find(
    (item) => item.courseId === selected.courseId && item.name === selected.name
  );
  if (!template) {
    courseTemplateStatus.textContent = "불러올 템플릿을 찾을 수 없습니다.";
    return;
  }

  const applied = applyCourseTemplateToState({
    subjectDirectory: appState.subjectDirectory,
    subjectInstructorMappings: Array.from(subjectInstructorMappings.entries()).map(([key, instructorCode]) => ({
      key,
      instructorCode
    })),
    template
  });

  applyTemplateRowsState(applied.dayTemplates);
  appState.holidayDates = dedupeAndSortDates(applied.holidays);
  appState.customBreakDates = dedupeAndSortDates(applied.customBreaks);
  renderHolidayAndBreakLists();
  appState.subjectDirectory = applied.subjectDirectory;
  subjectInstructorMappings.clear();
  for (const row of applied.subjectInstructorMappings) {
    subjectInstructorMappings.set(row.key, row.instructorCode);
  }

  subjectCourseSelect.value = template.courseId;
  mappingCourseSelect.value = template.courseId;
  courseTemplateCourseSelect.value = template.courseId;
  renderCourseTemplateOptions(buildCourseTemplateOptionValue(template));
  renderSubjectDirectory();
  renderSubjectMappingTable();
  courseTemplateStatus.textContent =
    `템플릿 적용 완료: ${template.courseId} ` +
    `(교과목 ${applied.overwrite.subjectEntriesReplaced}개/매핑 ${applied.overwrite.mappingEntriesReplaced}개 overwrite)`;
  pushRecentActionLog("INFO", `템플릿 적용 완료: ${template.courseId}`, "sectionScheduleGenerate");
  scheduleAutoSave();
}

function deleteSelectedCourseTemplate(): void {
  const selected = parseCourseTemplateOptionValue(courseTemplateSelect.value);
  if (!selected.courseId || !selected.name) {
    courseTemplateStatus.textContent = "삭제할 템플릿을 선택해 주세요.";
    return;
  }

  const nextTemplates = appState.courseTemplates.filter(
    (item) => !(item.courseId === selected.courseId && item.name === selected.name)
  );
  if (nextTemplates.length === appState.courseTemplates.length) {
    courseTemplateStatus.textContent = "삭제할 템플릿을 찾지 못했습니다.";
    return;
  }

  appState.courseTemplates = nextTemplates;
  renderCourseTemplateOptions();
  courseTemplateStatus.textContent = `템플릿 삭제 완료: ${selected.courseId} / ${selected.name}`;
  scheduleAutoSave();
  void syncDeleteCourseTemplateCloud(selected.courseId, selected.name);
}

function collectSavedStaffingCells(): SavedStaffCell[] {
  const cells: SavedStaffCell[] = [];

  for (const range of appState.staffingCohortRanges) {
    for (const phase of PHASES) {
      const state = getStaffCellState(range.cohort, phase);
      if (!state.assignee && !state.startDate && !state.endDate) {
        continue;
      }

      cells.push({
        cohort: range.cohort,
        phase,
        assignee: state.assignee,
        startDate: state.startDate,
        endDate: state.endDate,
        resourceType: state.resourceType
      });
    }
  }

  return cells;
}

function normalizeInstructorDirectoryEntries(rawInstructors: unknown): InstructorDirectoryEntry[] {
  if (!Array.isArray(rawInstructors)) {
    return [];
  }

  const entries: InstructorDirectoryEntry[] = [];
  for (const item of rawInstructors) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Partial<{ instructorCode: string; name: string; memo: string }>;
    const instructorCode = normalizeInstructorCode(record.instructorCode ?? "");
    if (!instructorCode) {
      continue;
    }

    entries.push({
      instructorCode,
      name: typeof record.name === "string" ? record.name.trim() : "",
      memo: typeof record.memo === "string" ? record.memo.trim() : ""
    });
  }

  return entries;
}

function mergeInstructorDirectoryWarning(sizeWarning: string): string {
  const cloudWarning = appState.instructorDirectoryCloudWarning;
  if (!sizeWarning && !cloudWarning) {
    return "";
  }
  if (!sizeWarning) {
    return cloudWarning;
  }
  if (!cloudWarning) {
    return sizeWarning;
  }
  return `${sizeWarning} / ${cloudWarning}`;
}

async function loadInstructorDirectoryWithCloudFallback(
  localInstructors: InstructorDirectoryEntry[]
): Promise<InstructorDirectoryEntry[]> {
  if (!isCloudAccessAllowed()) {
    return localInstructors;
  }

  if (!isInstructorCloudEnabled()) {
    appState.instructorDirectoryCloudWarning =
      "클라우드 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 설정을 확인해 주세요.";
    return localInstructors;
  }

  try {
    const cloudInstructors = await loadInstructorDirectoryFromCloud();
    if (cloudInstructors.length > 0) {
      appState.instructorDirectoryCloudWarning = localInstructors.length > 0
        ? "클라우드 강사 목록을 병합했습니다."
        : "클라우드 강사 목록을 가져와 적용했습니다.";
    } else {
      appState.instructorDirectoryCloudWarning = localInstructors.length > 0
        ? ""
        : "클라우드에 저장된 강사 목록이 없습니다. 로컬 데이터를 사용합니다.";
    }
    return mergeWithLocalInstructorDirectory(localInstructors, cloudInstructors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.instructorDirectoryCloudWarning = `클라우드 강사 목록 동기화 실패: ${message}. 로컬 데이터를 사용합니다.`;
    return localInstructors;
  }
}

function getStorageWarningMessage(bytes: number): string {
  if (bytes < STORAGE_WARN_BYTES) {
    return "";
  }

  return `저장 데이터가 큽니다 (${formatBytes(bytes)}). localStorage 용량 초과 가능성이 있으니 JSON 파일 백업을 권장합니다.`;
}

function serializeProjectState(): AppStateVCurrent {
  const cohortTrackTypes: Record<string, TrackType> = {};
  for (const [cohort, trackType] of cohortTrackType.entries()) {
    cohortTrackTypes[cohort] = trackType;
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    sessions: appState.sessions,
    cohortTrackTypes,
    generatedCohortRanges: Array.from(generatedCohortRanges.values()),
    scheduleGenerator: {
      cohort: scheduleCohortInput.value,
      startDate: scheduleStartDateInput.value,
      totalHours: scheduleTotalHoursInput.value,
      instructorCode: scheduleInstructorCodeInput.value,
      classroomCode: scheduleClassroomCodeInput.value,
      subjectCode: scheduleSubjectCodeInput.value,
      pushToConflicts: pushScheduleToConflicts.checked,
      dayTemplates: collectTemplateRowsState(),
      holidays: [...appState.holidayDates],
      customBreaks: [...appState.customBreakDates],
      generatedResult: appState.generatedScheduleResult,
      generatedCohort: appState.generatedScheduleCohort,
      publicHolidayLoaded: appState.hasLoadedPublicHoliday
    },
    staffingCells: collectSavedStaffingCells(),
    instructorDirectory: appState.instructorDirectory,
    instructorRegistry: appState.instructorDirectory,
    courseRegistry: appState.courseRegistry,
    subjectDirectory: appState.subjectDirectory,
    subjectRegistryByCourse: appState.subjectDirectory.map((item) => ({
      courseId: item.courseId,
      subjectCode: item.subjectCode,
      subjectName: item.subjectName,
      memo: item.memo
    })),
    subjectInstructorMappings: Array.from(subjectInstructorMappings.entries())
      .map(([moduleKey, instructorCode]) => {
        const parsed = parseCourseSubjectKey(moduleKey);
        const normalizedKey = toCourseSubjectKey(parsed.courseId, parsed.subjectCode);
        const normalizedInstructor = normalizeInstructorCode(instructorCode);
        return { moduleKey: normalizedKey, instructorCode: normalizedInstructor };
      })
      .filter((item) => item.moduleKey.length > 0 && item.instructorCode.length > 0),
    courseSubjectInstructorMapping: Array.from(subjectInstructorMappings.entries())
      .map(([key, instructorCode]) => {
        const parsed = parseCourseSubjectKey(key);
        return {
          courseId: parsed.courseId,
          moduleKey: toCourseSubjectKey(parsed.courseId, parsed.subjectCode),
          instructorCode: normalizeInstructorCode(instructorCode)
        };
      })
      .filter((item) => item.courseId.length > 0 && item.moduleKey.length > 0 && item.instructorCode.length > 0),
    courseTemplates: appState.courseTemplates,
    ui: {
      activeConflictTab: appState.activeConflictTab,
      viewMode: appState.viewMode,
      timelineViewType: appState.timelineViewType,
      showAdvanced: appState.showAdvanced,
      keySearch: keySearchInput.value,
      instructorDaySearch: instructorDaySearchInput.value,
      foDaySearch: foDaySearchInput.value,
      sidebarMenu: normalizeSidebarMenuConfig(appState.sidebarMenuDraft)
    }
  };
}

function scheduleAutoSave(): void {
  if (appState.isApplyingProjectState) {
    return;
  }

  if (appState.autoSaveTimer !== undefined) {
    window.clearTimeout(appState.autoSaveTimer);
  }

  appState.autoSaveTimer = window.setTimeout(() => {
    saveProjectToLocalStorage();
  }, AUTO_SAVE_DEBOUNCE_MS);
}

function saveProjectToLocalStorage(showMessage = false): void {
  try {
    const state = serializeProjectState();
    const payload = JSON.stringify(state);
    const bytes = estimateUtf8SizeBytes(payload);

    localStorage.setItem(STORAGE_KEY, payload);
    stateStorageWarning.textContent = getStorageWarningMessage(bytes);
    stateStorageStatus.textContent = `자동저장 완료 (${new Date().toLocaleTimeString()}) / ${formatBytes(bytes)}`;
    if (showMessage) {
      stateStorageStatus.textContent = `저장 완료 (${new Date().toLocaleTimeString()}) / ${formatBytes(bytes)}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    stateStorageWarning.textContent = `자동저장 실패: ${message}`;
    stateStorageStatus.textContent = "자동저장 실패";
  }
}

function applyLoadedProjectState(raw: unknown, instructorDirectoryOverride?: InstructorDirectoryEntry[]): void {
  const migrated = migrateState(raw);
  const state = migrated.state;
  setStateMigrationWarnings(migrated.warnings);

  appState.isApplyingProjectState = true;
  try {
    appState.sessions = Array.isArray(state.sessions) ? (state.sessions as Session[]) : [];
    moduleInstructorDraft.clear();
    subjectInstructorMappingDraft.clear();
    appState.parseErrors = [];

    const scheduleState = state.scheduleGenerator;
    appState.holidayDates = dedupeAndSortDates(Array.isArray(scheduleState?.holidays) ? scheduleState.holidays : []);
    appState.customBreakDates = dedupeAndSortDates(Array.isArray(scheduleState?.customBreaks) ? scheduleState.customBreaks : []);
    appState.generatedScheduleResult = (scheduleState?.generatedResult as GenerateScheduleResult | null | undefined) ?? null;
    appState.generatedScheduleCohort = scheduleState?.generatedCohort ?? "";
    appState.hasLoadedPublicHoliday = Boolean(scheduleState?.publicHolidayLoaded);

    scheduleCohortInput.value = scheduleState?.cohort ?? "";
    scheduleStartDateInput.value = scheduleState?.startDate ?? scheduleStartDateInput.value;
    scheduleTotalHoursInput.value = scheduleState?.totalHours ?? scheduleTotalHoursInput.value;
    scheduleInstructorCodeInput.value = scheduleState?.instructorCode ?? "";
    scheduleClassroomCodeInput.value = scheduleState?.classroomCode ?? "";
    scheduleSubjectCodeInput.value = scheduleState?.subjectCode ?? "";
    pushScheduleToConflicts.checked = Boolean(scheduleState?.pushToConflicts);

    applyTemplateRowsState(Array.isArray(scheduleState?.dayTemplates) ? scheduleState.dayTemplates : undefined);
    renderScheduleTemplateOptions();

    generatedCohortRanges.clear();
    if (Array.isArray(state.generatedCohortRanges)) {
      for (const range of state.generatedCohortRanges) {
        if (!range || typeof range !== "object") {
          continue;
        }
        const cohort = (range as { cohort?: string }).cohort ?? "";
        const startDate = (range as { startDate?: string }).startDate ?? "";
        const endDate = (range as { endDate?: string }).endDate ?? "";
        if (!cohort || !parseIsoDate(startDate) || !parseIsoDate(endDate)) {
          continue;
        }
        generatedCohortRanges.set(cohort, { cohort, startDate, endDate });
      }
    }

    cohortTrackType.clear();
    const trackMap = state.cohortTrackTypes ?? {};
    for (const [cohort, trackType] of Object.entries(trackMap)) {
      if (isTrackType(trackType)) {
        cohortTrackType.set(cohort, trackType);
      }
    }

    staffingCellState.clear();
    if (Array.isArray(state.staffingCells)) {
      for (const row of state.staffingCells) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const cohort = row.cohort ?? "";
        const phase = row.phase;
        const resourceType = row.resourceType;
        if (!cohort || !isPhase(phase) || !isResourceType(resourceType)) {
          continue;
        }

        staffingCellState.set(staffCellKey(cohort, phase), {
          assignee: row.assignee ?? "",
          startDate: row.startDate ?? "",
          endDate: row.endDate ?? "",
          resourceType
        });
      }
    }

    const instructorSource = Array.isArray(instructorDirectoryOverride)
      ? instructorDirectoryOverride
      : normalizeInstructorDirectoryEntries(
          Array.isArray(state.instructorRegistry)
            ? state.instructorRegistry
            : Array.isArray(state.instructorDirectory)
              ? state.instructorDirectory
              : []
        );
    appState.instructorDirectory = instructorSource
      .map((item) => ({
        instructorCode: normalizeInstructorCode(item.instructorCode),
        name: item.name ?? "",
        memo: item.memo ?? ""
      }))
      .filter((item) => item.instructorCode.length > 0)
      .sort((a, b) => a.instructorCode.localeCompare(b.instructorCode));

    appState.courseRegistry = Array.isArray(state.courseRegistry)
      ? state.courseRegistry.map((item) => ({
          courseId: normalizeCourseId(item.courseId),
          courseName: item.courseName ?? "",
          memo: item.memo ?? ""
        }))
      : [];

    const rawSubjects = Array.isArray(state.subjectRegistryByCourse)
      ? state.subjectRegistryByCourse
      : Array.isArray(state.subjectDirectory)
        ? state.subjectDirectory
        : [];
    appState.subjectDirectory = rawSubjects.map((item) => ({
          courseId: normalizeCourseId(item.courseId ?? ""),
          subjectCode: normalizeSubjectCode(item.subjectCode).toUpperCase(),
          subjectName: item.subjectName ?? "",
          memo: item.memo ?? ""
        }));
    appState.subjectDirectory = appState.subjectDirectory.filter((item) => item.courseId.length > 0 && item.subjectCode.length > 0);
    for (const courseId of new Set(appState.subjectDirectory.map((item) => item.courseId))) {
      if (!appState.courseRegistry.some((item) => item.courseId === courseId)) {
        appState.courseRegistry.push({ courseId, courseName: courseId, memo: "" });
      }
    }

    subjectInstructorMappings.clear();
    const rawCourseMappings = state.courseSubjectInstructorMapping;
    for (const row of rawCourseMappings) {
      const parsed = parseCourseSubjectKey(row.moduleKey ?? "");
      const rawCourseId = normalizeCourseId(row.courseId ?? parsed.courseId);
      const courseId = normalizeCourseId(parseCourseGroupFromCohortName(rawCourseId).course);
      const moduleKey = toCourseSubjectKey(courseId, parsed.subjectCode);
        const instructorCode = normalizeInstructorCode(row.instructorCode ?? "");
        if (!moduleKey || !instructorCode) {
          continue;
        }
        subjectInstructorMappings.set(moduleKey, instructorCode);
    }
    for (const row of state.subjectInstructorMappings) {
      const parsed = parseCourseSubjectKey(row.moduleKey ?? "");
      const courseId = normalizeCourseId(parseCourseGroupFromCohortName(parsed.courseId).course);
      const moduleKey = toCourseSubjectKey(courseId, parsed.subjectCode);
      const instructorCode = normalizeInstructorCode(row.instructorCode ?? "");
      if (!moduleKey || !instructorCode) {
        continue;
      }
      subjectInstructorMappings.set(moduleKey, instructorCode);
    }
    appState.courseTemplates = Array.isArray(state.courseTemplates) ? state.courseTemplates : [];

    regenerateSummariesAndTimeline();
    resetConflictsBeforeCompute();
    computeConflictsButton.textContent = DEFAULT_COMPUTE_LABEL;

    const ui = state.ui;
    const loadedSidebarMenu = ui?.sidebarMenu;
    // 마이그레이션: 이전 사이드바 설정(기수 일정 생성기, 설정 순서 등)이면 기본값으로 리셋
    const needsMigration = loadedSidebarMenu &&
      (loadedSidebarMenu.labels?.generator?.includes("기수") ||
       loadedSidebarMenu.order?.indexOf("settings") < loadedSidebarMenu.order?.indexOf("attendance"));
    if (loadedSidebarMenu && !needsMigration) {
      appState.sidebarMenuConfig = normalizeSidebarMenuConfig({
        order: loadedSidebarMenu.order,
        labels: loadedSidebarMenu.labels,
        icons: loadedSidebarMenu.icons
      });
    } else {
      appState.sidebarMenuConfig = getDefaultSidebarMenuConfig();
    }
    appState.sidebarMenuDraft = cloneSidebarMenuConfig(appState.sidebarMenuConfig);
    applySidebarMenuConfigToSidebar(appState.sidebarMenuConfig);
    saveSidebarMenuConfig(appState.sidebarMenuConfig);

    applyViewMode(ui?.viewMode === "simple" ? "simple" : "full");
    setTimelineViewType(ui?.timelineViewType ?? "COHORT_TIMELINE");
    applyStaffingMode(staffingModeSelect.value === "advanced" ? "advanced" : "manager");
    applyShowAdvancedMode(resolveShowAdvanced(ui?.showAdvanced));
    keySearchInput.value = ui?.keySearch ?? "";
    instructorDaySearchInput.value = ui?.instructorDaySearch ?? "";
    foDaySearchInput.value = ui?.foDaySearch ?? "";

    renderHolidayAndBreakLists();
    renderGeneratedScheduleResult();
    renderErrors();
    refreshHrdValidation();
    applyConflictFilters();
    applyInstructorDayFilters();
    applyFoDayFilters();

    const tab = ui?.activeConflictTab;
    setConflictTab(tab === "time" || tab === "instructor_day" || tab === "fo_day" ? tab : "time");

    uploadStatus.textContent = appState.sessions.length > 0 ? `현재 수업시간표 ${appState.sessions.length}건` : "대기중";
    stateStorageStatus.textContent = `프로젝트 불러오기 완료 (${new Date().toLocaleTimeString()})`;
  } finally {
    appState.isApplyingProjectState = false;
    updateActionStates();
  }
}

async function loadProjectStateFromLocalStorage(): Promise<void> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    stateStorageStatus.textContent = "자동저장 대기";
    stateStorageWarning.textContent = "";
    setStateMigrationWarnings([]);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
    const stateLike = parsed as { instructorRegistry?: unknown; instructorDirectory?: unknown };
    const localInstructors = normalizeInstructorDirectoryEntries(
      Array.isArray(stateLike.instructorRegistry)
        ? stateLike.instructorRegistry
        : Array.isArray(stateLike.instructorDirectory)
          ? stateLike.instructorDirectory
          : []
    );
    const resolvedInstructorDirectory = await loadInstructorDirectoryWithCloudFallback(localInstructors);
    applyLoadedProjectState(parsed, resolvedInstructorDirectory);
    await loadManagementDataFromCloudFallback();
    const bytes = estimateUtf8SizeBytes(raw);
    const sizeWarning = getStorageWarningMessage(bytes);
    stateStorageWarning.textContent = mergeInstructorDirectoryWarning(sizeWarning);
    stateStorageStatus.textContent = `자동저장 상태 복원 (${formatBytes(bytes)})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    stateStorageWarning.textContent = `저장 상태를 복원하지 못했습니다: ${message}`;
    stateStorageStatus.textContent = "자동저장 복원 실패";
    setStateMigrationWarnings([]);
    renderInitialUiState();
  }
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
      resourceType: "FACILITATOR"
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
  holidayLoadSpinner.style.display = loading ? "inline-block" : "none";
  loadPublicHolidaysButton.textContent = loading ? "불러오는 중..." : "공휴일 불러오기(대한민국)";
  updateActionStates();
}

function updateActionStates(): void {
  const hasSessions = appState.sessions.length > 0;
  const canComputeConflicts = hasSessions && !appState.isUploadProcessing;
  const canUseConflictControls = appState.hasComputedConflicts && !appState.isConflictComputing && !appState.isUploadProcessing;
  const isBusy = appState.isUploadProcessing || appState.isConflictComputing || appState.isHolidayLoading;
  const advancedMode = appState.staffingMode === "advanced";
  const canDownloadHrd = hasSessions && !appState.isUploadProcessing;

  fileInput.disabled = appState.isUploadProcessing;
  cohortSelect.disabled = !hasSessions || appState.isUploadProcessing;
  downloadButton.disabled = !canDownloadHrd;

  computeConflictsButton.disabled = !canComputeConflicts || appState.isConflictComputing;
  keySearchInput.disabled = !canUseConflictControls;
  downloadTimeConflictsButton.disabled = !canUseConflictControls || appState.visibleConflicts.length === 0;
  downloadInstructorDayConflictsButton.disabled = isBusy || appState.visibleInstructorDayOverlaps.length === 0;
  downloadFoDayConflictsButton.disabled = isBusy || appState.visibleFoDayOverlaps.length === 0;

  generateScheduleButton.disabled = isBusy;
  addHolidayButton.disabled = isBusy;
  loadPublicHolidaysButton.disabled = isBusy;
  clearHolidaysButton.disabled = isBusy;
  dedupeHolidaysButton.disabled = isBusy;
  addCustomBreakButton.disabled = isBusy;
  scheduleTemplateSelect.disabled = isBusy;
  scheduleTemplateNameInput.disabled = isBusy;
  loadScheduleTemplateButton.disabled = isBusy || appState.scheduleTemplates.length === 0;
  saveScheduleTemplateButton.disabled = isBusy;
  if (isBusy) {
    deleteScheduleTemplateButton.disabled = true;
  } else {
    const selectedTemplate = findScheduleTemplate(appState.scheduleTemplates, scheduleTemplateSelect.value);
    deleteScheduleTemplateButton.disabled = Boolean(selectedTemplate?.builtIn) || appState.scheduleTemplates.length === 0;
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
  openConflictDetailModalButton.disabled = isBusy;
  loadDemoSampleButton.disabled = isBusy;
  restorePreviousStateButton.disabled = isBusy || appState.previousStateBeforeSampleLoad === null;
  upsertCourseButton.disabled = isBusy;
  upsertInstructorButton.disabled = isBusy;
  upsertSubjectButton.disabled = isBusy;
  applySubjectMappingsButton.disabled = isBusy || appState.sessions.length === 0;

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
  return validateHrdExportForCohortDetailed(appState.sessions, cohort, appState.holidayDates, holidayNameByDate, subjectCodes);
}

function refreshHrdValidation(): void {
  const cohort = cohortSelect.value;
  const validation = cohort
    ? validateHrdExportForCohortWithWarnings(cohort)
    : { errors: [], warnings: [] };
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
      appState.staffingCohortRanges.every((range) => isTrackType(range.trackType) && getPolicyForTrack(range.trackType).length > 0));

  const items: Array<{ label: string; ok: boolean; warn?: boolean }> = [
    {
      label: `HRD CSV 다운로드 검증 ${hrdPass ? "통과" : "미통과"}`,
      ok: hrdPass,
      warn: true
    },
    {
      label: appState.hasComputedConflicts
        ? `강사 시간 충돌 ${appState.allConflicts.length === 0 ? "0건" : `${appState.allConflicts.length}건`}`
        : "강사 시간 충돌 미계산",
      ok: appState.hasComputedConflicts && appState.allConflicts.length === 0,
      warn: true
    },
    {
      label: `강사 배치(일) 충돌 ${appState.instructorDayOverlaps.length === 0 ? "0건" : `${appState.instructorDayOverlaps.length}건`}`,
      ok: appState.instructorDayOverlaps.length === 0,
      warn: appState.staffingAssignments.length > 0
    },
    {
      label: `퍼실/운영 배치(일) 충돌 ${appState.facilitatorOperationOverlaps.length === 0 ? "0건" : `${appState.facilitatorOperationOverlaps.length}건`}`,
      ok: appState.facilitatorOperationOverlaps.length === 0,
      warn: appState.staffingAssignments.length > 0
    },
    {
      label: `공휴일 자동 로드 ${appState.hasLoadedPublicHoliday ? "적용" : "미적용"}`,
      ok: appState.hasLoadedPublicHoliday,
      warn: true
    },
    {
      label: `trackType 설정 ${trackTypeComplete ? "완료" : "누락"}`,
      ok: trackTypeComplete,
      warn: appState.staffingCohortRanges.length > 0
    },
    {
      label:
        unassignedInstructorModules.length === 0
          ? "강사 배정 누락 없음"
          : `강사 배정 누락 ${unassignedInstructorModules.length}건`,
      ok: unassignedInstructorModules.length === 0,
      warn: true
    }
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

  console.time("conflict-calc");
  try {
    appState.allConflicts = detectConflicts(appState.sessions, { resourceTypes: ["INSTRUCTOR"] });
    appState.hasComputedConflicts = true;
  } finally {
    console.timeEnd("conflict-calc");
  }

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
    cohort === appState.generatedScheduleCohort && appState.generatedScheduleResult ? appState.generatedScheduleResult.days : undefined;
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
    pushRecentActionLog("WARNING", `경고: 교과목/강사 누락 ${validation.warnings.length}건 (다운로드는 허용)`, "hrdDownloadCard");
  }
  pushRecentActionLog("INFO", `HRD CSV 다운로드 완료: ${cohort}`, "hrdDownloadCard");
  updateActionStates();
}


function downloadProjectStateJson(): void {
  const state = serializeProjectState();
  const payload = JSON.stringify(state, null, 2);
  const fileName = `project_state_${getTodayCompactDate()}.json`;

  const blob = new Blob([payload], { type: "application/json;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
  saveProjectToLocalStorage(true);
}

async function importProjectStateFromFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  applyLoadedProjectState(parsed);
  scheduleAutoSave();
}

function resetAllStateWithConfirm(): void {
  const ok = window.confirm("저장된 프로젝트 상태와 현재 화면 데이터를 모두 초기화하시겠습니까?");
  if (!ok) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
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
    conflictRows = appState.visibleConflicts.slice(0, PRINT_CONFLICT_LIMIT).map((conflict) => [
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
  } else if (appState.activeConflictTab === "instructor_day") {
    conflictColumns = DAY_CONFLICT_COLUMNS;
    conflictRows = appState.visibleInstructorDayOverlaps.slice(0, PRINT_CONFLICT_LIMIT).map((item) => toDayConflictRow(item));
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

function renderDateList(
  listElement: HTMLUListElement,
  values: string[],
  toLabel: (value: string) => string,
  onRemove: (value: string) => void
): void {
  holidayRenderDateList(listElement, values, toLabel, onRemove);
}

function getHolidayDisplayLabel(date: string): string {
  return holidayGetHolidayDisplayLabel(date);
}

function renderHolidayAndBreakLists(): void {
  holidayRenderHolidayAndBreakLists();
}

function addDateToList(input: HTMLInputElement, target: "holiday" | "customBreak"): void {
  holidayAddDateToList(input, target);
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
      breaks
    });
    weekdaySet.add(weekday);
  }

  return {
    dayTemplates,
    weekdays: Array.from(weekdaySet).sort((a, b) => a - b)
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
      dayTemplates: parsedTemplate.dayTemplates
    }
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
    const items = skipped
      .filter((item) => item.reason === reason)
      .sort((a, b) => a.date.localeCompare(b.date));

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

function getHolidayFetchYears(startDate: string): number[] {
  return holidayGetHolidayFetchYears(startDate);
}

function mergeFetchedHolidays(holidays: Holiday[]): number {
  return holidayMergeFetchedHolidays(holidays);
}

async function loadPublicHolidays(): Promise<void> {
  await holidayLoadPublicHolidays();
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
  range: T
): void {
  const existing = target.get(range.cohort);
  if (!existing) {
    target.set(range.cohort, { ...range });
    return;
  }

  existing.startDate = existing.startDate < range.startDate ? existing.startDate : range.startDate;
  existing.endDate = existing.endDate > range.endDate ? existing.endDate : range.endDate;
}

function rebuildStaffingCohortRanges(): void { staffingRebuildStaffingCohortRanges(); }

function renderStaffingMatrix(): void { staffingRenderStaffingMatrix(); }

function collectStaffingInputs(): StaffAssignmentInput[] { return staffingCollectStaffingInputs(); }


function renderStaffGantt(container: HTMLElement, groups: Array<{ label: string; assignments: StaffAssignment[] }>, barLabel: (assignment: StaffAssignment) => string): void { staffingRenderStaffGantt(container, groups, barLabel); }

function buildOverlapDayMapByAssignment(): Map<StaffAssignment, number> { return staffingBuildOverlapDayMapByAssignment(); }

function getPolicyLabelsForAssignee(assignee: string, resourceType: ResourceType): string[] { return staffingGetPolicyLabelsForAssignee(assignee, resourceType); }

function renderStaffKpiAndDetails(): void { staffingRenderStaffKpiAndDetails(); }

function refreshStaffingAnalytics(showStatus = true): void { staffingRefreshStaffingAnalytics(showStatus); }

function renderStaffingSection(): void { staffingRenderStaffingSection(); }

function autoFillStaffingFromCohorts(): void { staffingAutoFillStaffingFromCohorts(); }

function isV7eStrictReady(): { ok: boolean; reason?: string } { return staffingIsV7eStrictReady(); }

function buildStrictExportRecords(): InternalV7ERecord[] { return staffingBuildStrictExportRecords(); }

function buildModulesGenericExportRecords(): InternalV7ERecord[] { return staffingBuildModulesGenericExportRecords(); }

function downloadStaffingCsv(): void { staffingDownloadStaffingCsv(); }

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
        endDate: appState.generatedScheduleResult.endDate
      });
      renderStaffingSection();
    }

    setScheduleError(null);
    renderGeneratedScheduleResult();
    pushRecentActionLog(
      "INFO",
      `일정 생성 완료: ${appState.generatedScheduleCohort} (종강 ${appState.generatedScheduleResult.endDate})`,
      "sectionScheduleGenerate"
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
      subjectCode: scheduleSubjectCodeInput.value
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
      "sectionTimeline"
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
  const rect = conflictDetailModal.getBoundingClientRect();
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
    openManagementTab: false
  });
  openInstructorDrawerWithTab("course");
}

function handleQuickNavCourse(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("course");
}

function handleQuickNavSubject(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("subject");
}

function handleQuickNavInstructor(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("register");
}

function handleQuickNavMapping(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("mapping");
}

function handleTimelineViewTypeChange(): void {
  setTimelineViewType(parseTimelineViewType(timelineViewTypeSelect.value));
  renderTimeline();
  scheduleAutoSave();
}

function handleAssigneeModeInstructor(): void {
  appState.assigneeTimelineKind = "INSTRUCTOR";
  assigneeModeInstructorButton.classList.add("active");
  assigneeModeStaffButton.classList.remove("active");
  renderTimeline();
  scheduleAutoSave();
}

function handleAssigneeModeStaff(): void {
  appState.assigneeTimelineKind = "STAFF";
  assigneeModeStaffButton.classList.add("active");
  assigneeModeInstructorButton.classList.remove("active");
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
    openManagementTab: false
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("course");
  openInstructorDrawerWithTab("course");
}

function handleJibbleSubSubject(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("subject");
  openInstructorDrawerWithTab("subject");
}

function handleJibbleSubInstructor(): void {
  activatePrimarySidebarPage("settings", {
    scrollToTop: false,
    openManagementTab: false
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
    submitAuthCode();
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
  scheduleAutoSave
});

initTimelineFeature({
  getCohortNotificationMap: () => getCohortNotificationCountMap(refreshNotificationItems()),
  focusNotification: focusNotificationCenter
});

initHolidaysFeature({
  refreshHrdValidation,
  scheduleAutoSave,
  setHolidayLoadingState,
  setScheduleError
});

initScheduleTemplatesFeature({
  scheduleAutoSave,
  updateActionStates,
  pushRecentActionLog
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
  buildModuleAssignSummaries
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

// HRD dashboards (attendance + dropout defense)
initAttendanceDashboard();
initDropoutDashboard();
initAnalytics();

// ─── 출결현황 / 하차방어율 상위 탭 전환 ───
(() => {
  const pageTabs = document.querySelectorAll<HTMLButtonElement>("[data-att-page]");
  const pagePanels = document.querySelectorAll<HTMLElement>("[data-att-page-panel]");
  for (const tab of pageTabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.attPage ?? "";
      for (const t of pageTabs) t.classList.toggle("active", t === tab);
      for (const p of pagePanels) {
        p.style.display = p.dataset.attPagePanel === target ? "block" : "none";
      }
    });
  }
})();

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

if (hasAuthSession) {
  void bootstrapAppAfterAuthLogin();
}
