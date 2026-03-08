import { generateSchedule } from "./core/calendar";
import { parseCsv } from "./core/csv";
import { applyCourseTemplateToState } from "./core/courseTemplateApply";
import { removeBasicModeSections } from "./core/basicModeSections";
import { toCsvDownloadText } from "./core/csvDownload";
import { detectConflicts } from "./core/conflicts";
import { assignInstructorToModule } from "./core/autoAssignInstructor";
import { exportHrdCsvForCohort } from "./core/export";
import { fromScheduleDaysToSessions } from "./core/fromSchedule";
import { fetchPublicHolidaysKR } from "./core/holidays";
import { buildCohortInstructorMetaMap } from "./core/instructorTimeline";
import { normalizeHHMM } from "./core/normalize";
import {
  createDefaultScheduleTemplates,
  findScheduleTemplate,
  mergeScheduleTemplates,
  NamedScheduleTemplate,
  removeScheduleTemplate,
  SCHEDULE_TEMPLATE_STORAGE_KEY,
  upsertScheduleTemplate
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
import { resolveShowAdvancedPolicy } from "./core/showAdvancedPolicy";
import {
  V7E_STRICT_DETAIL_HEADER,
  buildAssignments,
  deriveModuleRangesFromSessions,
  detectStaffOverlaps,
  exportV7eStrictCsv,
  summarizeWorkload
} from "./core/staffing";
import { exportWithMapping, type ExportFormatKey } from "./core/exportMapping";
import { validateRecordsForFormat } from "./core/exportValidation";
import { type InternalV7ERecord } from "./core/schema";
import { normalizeInstructorCode, normalizeSubjectCode } from "./core/standardize";
import { buildCohortSummaries } from "./core/summary";
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

type ConflictTab = "time" | "instructor_day" | "fo_day";
type ViewMode = AppViewMode;
type TimelineViewType = AppTimelineViewType;
type StaffingMode = "manager" | "advanced";
type AssigneeTimelineKind = "INSTRUCTOR" | "STAFF";
type PrimarySidebarNavKey = AppSidebarNavKey;

type SidebarMenuConfig = AppSidebarMenuConfig;

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

type NotificationSeverity = "INFO" | "WARNING" | "ERROR";
type NotificationSource = "PARSE_ERROR" | "CONFLICT_TIME" | "HRD_VALIDATION" | "MISSING_INSTRUCTOR";

type NotificationItem = {
  id: string;
  severity: NotificationSeverity;
  source: NotificationSource;
  title: string;
  message: string;
  cohort?: string;
  moduleKey?: string;
  assignee?: string;
  date?: string;
  details?: string[];
};

type SubjectDirectoryEntry = {
  courseId: string;
  subjectCode: string;
  subjectName: string;
  memo: string;
};

type CourseRegistryEntry = {
  courseId: string;
  courseName: string;
  memo: string;
};

type RecentActionLog = {
  id: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  focusSectionId?: string;
  createdAt: string;
};

type CourseTemplate = {
  name: string;
  version: string;
  courseId: string;
  dayTemplates: TemplateRowState[];
  holidays: string[];
  customBreaks: string[];
  subjectList: Array<{ subjectCode: string; subjectName: string; memo: string }>;
  subjectInstructorMapping: Array<{ key: string; instructorCode: string }>;
};

type CohortRange = {
  cohort: string;
  startDate: string;
  endDate: string;
  trackType: TrackType;
};

type StaffCellState = {
  assignee: string;
  startDate: string;
  endDate: string;
  resourceType: ResourceType;
};

const PHASES: Phase[] = ["P1", "P2", "365"];
const TRACK_TYPES: TrackType[] = ["UNEMPLOYED", "EMPLOYED"];
const MATRIX_RESOURCE_TYPES: ResourceType[] = ["INSTRUCTOR", "FACILITATOR", "OPERATION"];

const TRACK_LABEL: Record<TrackType, string> = {
  UNEMPLOYED: "실업자",
  EMPLOYED: "재직자"
};

const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  INSTRUCTOR: "강사",
  FACILITATOR: "퍼실",
  OPERATION: "운영"
};

const RESOURCE_TYPE_ORDER: Record<ResourceType, number> = {
  INSTRUCTOR: 0,
  FACILITATOR: 1,
  OPERATION: 2
};

const POLICY_BY_TRACK: Record<TrackType, number[]> = {
  UNEMPLOYED: [1, 2, 3, 4, 5],
  EMPLOYED: [1, 2, 3, 4, 5, 6]
};

const CONFLICT_COLUMNS = [
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

const DAY_CONFLICT_COLUMNS = [
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

const STORAGE_KEY = "academic_schedule_manager_state_v1";
const AUTH_SESSION_KEY = "academic_schedule_manager_auth_v2";
const AUTH_CODE_V2 = "v2";
const STORAGE_WARN_BYTES = 4_500_000;
const AUTO_SAVE_DEBOUNCE_MS = 500;
const PRINT_CONFLICT_LIMIT = 50;
const TABLE_RENDER_LIMIT = 1000;
const SIDEBAR_MENU_CONFIG_KEY = "academic_schedule_manager_sidebar_menu_v1";

const PRIMARY_SIDEBAR_NAV_KEYS: PrimarySidebarNavKey[] = [
  "timeline",
  "management",
  "generator",
  "reports",
  "settings"
];

const DEFAULT_PRIMARY_SIDEBAR_LABELS: Record<PrimarySidebarNavKey, string> = {
  timeline: "학사일정",
  management: "과정 정보입력",
  generator: "기수 일정 생성기",
  reports: "보고서",
  settings: "설정"
};

const DEFAULT_PRIMARY_SIDEBAR_ICONS: Record<PrimarySidebarNavKey, string> = {
  timeline: "📅",
  management: "📄",
  generator: "🛠️",
  reports: "🧾",
  settings: "⚙️"
};

const DEFAULT_DOWNLOAD_LABEL = "선택한 기수 CSV 다운로드";
const DEFAULT_COMPUTE_LABEL = "충돌 계산";
const RECOMPUTE_LABEL = "충돌 다시 계산";

const DAY_MS = 24 * 60 * 60 * 1000;

const TIMELINE_VIEW_ORDER: TimelineViewType[] = [
  "COHORT_TIMELINE",
  "COURSE_GROUPED",
  "ASSIGNEE_TIMELINE",
  "WEEK_GRID",
  "MONTH_CALENDAR"
];
const TIMELINE_RENDER_LIMIT = 600;

let sessions: Session[] = [];
let summaries: CohortSummary[] = [];
let parseErrors: ParseError[] = [];
let hrdValidationErrors: string[] = [];
let hrdValidationWarnings: string[] = [];

let allConflicts: Conflict[] = [];
let visibleConflicts: Conflict[] = [];

let generatedScheduleResult: GenerateScheduleResult | null = null;
let generatedScheduleCohort = "";

let holidayDates: string[] = [];
let customBreakDates: string[] = [];

const holidayNameByDate = new Map<string, string>();

const skipExpanded: Record<SkippedDay["reason"], boolean> = {
  holiday: false,
  custom_break: false,
  weekday_excluded: false
};

const staffingCellState = new Map<string, StaffCellState>();
const cohortTrackType = new Map<string, TrackType>();
const generatedCohortRanges = new Map<string, { cohort: string; startDate: string; endDate: string }>();

let staffingCohortRanges: CohortRange[] = [];
let staffingAssignments: StaffAssignment[] = [];
let facilitatorOperationOverlaps: StaffOverlap[] = [];
let instructorDayOverlaps: StaffOverlap[] = [];
let visibleInstructorDayOverlaps: StaffOverlap[] = [];
let visibleFoDayOverlaps: StaffOverlap[] = [];
let staffingSummaries: AssigneeSummary[] = [];
let instructorSummaries: AssigneeSummary[] = [];
let hasLoadedPublicHoliday = false;
let stateMigrationWarnings: string[] = [];
let autoSaveTimer: number | undefined;
let isApplyingProjectState = false;
let previousStateBeforeSampleLoad: AppStateVCurrent | null = null;
let viewMode: ViewMode = "full";
let timelineViewType: TimelineViewType = "COHORT_TIMELINE";
let assigneeTimelineKind: AssigneeTimelineKind = "INSTRUCTOR";
let weekGridStartDate = getTodayIsoDate();
let monthCalendarCursor = getTodayIsoDate().slice(0, 7);
let ganttHighlightTimer: number | undefined;

let activeConflictTab: ConflictTab = "time";
let staffingMode: StaffingMode = "manager";
let showAdvanced = false;
let hasPrunedBasicModeSections = false;
let activeDrawer: "notification" | "instructor" | null = null;
let managementInlineMode = false;
let instructorDirectoryCloudWarning = "";
let managementCloudWarning = "";
let isAuthVerified = false;
let hasAppBootstrapped = false;
let activePrimarySidebarPage: PrimarySidebarNavKey = "timeline";
let sidebarMenuConfig = loadSidebarMenuConfig();
let sidebarMenuDraft = cloneSidebarMenuConfig(sidebarMenuConfig);

let isUploadProcessing = false;
let isConflictComputing = false;
let hasComputedConflicts = false;
let isHolidayLoading = false;
let keySearchTimer: number | undefined;
let instructorDaySearchTimer: number | undefined;
let foDaySearchTimer: number | undefined;
const moduleInstructorDraft = new Map<string, string>();
const subjectInstructorMappingDraft = new Map<string, string>();
let instructorDirectory: InstructorDirectoryEntry[] = [];
let courseRegistry: CourseRegistryEntry[] = [];
let subjectDirectory: SubjectDirectoryEntry[] = [];
const subjectInstructorMappings = new Map<string, string>();
let notificationItems: NotificationItem[] = [];
let scheduleTemplates: NamedScheduleTemplate[] = [];
let recentActionLogs: RecentActionLog[] = [];
let courseTemplates: CourseTemplate[] = [];
let notificationFocus:
  | {
      cohort?: string;
      assignee?: string;
      date?: string;
    }
  | null = null;
const collapsedCourseGroups = new Set<string>();

const fileInput = getRequiredElement<HTMLInputElement>("#file");
const uploadStatus = getRequiredElement<HTMLElement>("#uploadStatus");
const standardizeStatus = getRequiredElement<HTMLElement>("#standardizeStatus");
const authGate = getRequiredElement<HTMLElement>("#authGate");
const authCodeInput = getRequiredElement<HTMLInputElement>("#authCodeInput");
const authLoginButton = getRequiredElement<HTMLButtonElement>("#authLoginButton");
const authStatus = getRequiredElement<HTMLElement>("#authStatus");

const stateMigrationBanner = getRequiredElement<HTMLElement>("#stateMigrationBanner");
const stateMigrationList = getRequiredElement<HTMLUListElement>("#stateMigrationList");
const globalWarningPanel = getRequiredElement<HTMLElement>("#globalWarningPanel");
const globalWarningList = getRequiredElement<HTMLUListElement>("#globalWarningList");
const adminModeToggle = document.querySelector<HTMLInputElement>("#adminModeToggle");

const drawerBackdrop = getRequiredElement<HTMLElement>("#drawerBackdrop");
const notificationDrawer = getRequiredElement<HTMLElement>("#notificationDrawer");
const instructorDrawer = getRequiredElement<HTMLElement>("#instructorDrawer");
const headerRuntimePanel = getRequiredElement<HTMLElement>(".header-runtime-panel");
const headerCurrentTime = getRequiredElement<HTMLElement>("#headerCurrentTime");
const headerSyncState = getRequiredElement<HTMLElement>("#headerSyncState");
const openNotificationDrawerButton = getRequiredElement<HTMLButtonElement>("#openNotificationDrawer");
const openInstructorDrawerButton = getRequiredElement<HTMLButtonElement>("#openInstructorDrawer");
const quickNavCourseButton = getRequiredElement<HTMLButtonElement>("#quickNavCourse");
const quickNavSubjectButton = getRequiredElement<HTMLButtonElement>("#quickNavSubject");
const quickNavInstructorButton = getRequiredElement<HTMLButtonElement>("#quickNavInstructor");
const quickNavMappingButton = getRequiredElement<HTMLButtonElement>("#quickNavMapping");
const quickNavCourseMeta = getRequiredElement<HTMLElement>("#quickNavCourseMeta");
const quickNavSubjectMeta = getRequiredElement<HTMLElement>("#quickNavSubjectMeta");
const quickNavInstructorMeta = getRequiredElement<HTMLElement>("#quickNavInstructorMeta");
const quickNavMappingMeta = getRequiredElement<HTMLElement>("#quickNavMappingMeta");
const jibbleRightMemberText = document.querySelector<HTMLElement>("#jibbleRightMemberText");
const jibbleRightStatInstructor = document.querySelector<HTMLElement>("#jibbleRightStatInstructor");
const jibbleRightStatCohort = document.querySelector<HTMLElement>("#jibbleRightStatCohort");
const jibbleRightStatConflict = document.querySelector<HTMLElement>("#jibbleRightStatConflict");
const jibbleOpsStatus = document.querySelector<HTMLElement>("#jibbleOpsStatus");
const jibbleOpsSummary = document.querySelector<HTMLElement>("#jibbleOpsSummary");
const jibbleManagementSubmenu = document.querySelector<HTMLElement>("#jibbleManagementSubmenu");
const jibbleSubCourseButton = document.querySelector<HTMLButtonElement>("#jibbleSubCourse");
const jibbleSubSubjectButton = document.querySelector<HTMLButtonElement>("#jibbleSubSubject");
const jibbleSubInstructorButton = document.querySelector<HTMLButtonElement>("#jibbleSubInstructor");
const jibbleMainNav = document.querySelector<HTMLElement>("#jibbleMainNav");
const jibblePrimaryNavButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("#jibbleMainNav .jibble-nav-item[data-nav-key]")
);
const jibbleSubNavButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".jibble-nav-sub .jibble-nav-item[data-scroll-target]")
);
const jibblePageGroupElements = Array.from(document.querySelectorAll<HTMLElement>("[data-page-group]"));
const menuConfigList = getRequiredElement<HTMLElement>("#menuConfigList");
const saveMenuConfigButton = getRequiredElement<HTMLButtonElement>("#saveMenuConfigButton");
const resetMenuConfigButton = getRequiredElement<HTMLButtonElement>("#resetMenuConfigButton");
const menuConfigStatus = getRequiredElement<HTMLElement>("#menuConfigStatus");
const openConflictDetailModalButton = getRequiredElement<HTMLButtonElement>("#openConflictDetailModal");
const conflictDetailModal = getRequiredElement<HTMLDialogElement>("#conflictDetailModal");
const conflictDetailTitle = getRequiredElement<HTMLElement>("#conflictDetailTitle");
const conflictDetailContent = getRequiredElement<HTMLElement>("#conflictDetailContent");
const closeConflictDetailModalButton = getRequiredElement<HTMLButtonElement>("#closeConflictDetailModal");

const riskCardTime = getRequiredElement<HTMLElement>("#riskCardTime");
const riskTimeConflict = getRequiredElement<HTMLElement>("#riskTimeConflict");
const riskCardInstructorDay = getRequiredElement<HTMLElement>("#riskCardInstructorDay");
const riskInstructorDayConflict = getRequiredElement<HTMLElement>("#riskInstructorDayConflict");
const riskCardFoDay = getRequiredElement<HTMLElement>("#riskCardFoDay");
const riskFoDayConflict = getRequiredElement<HTMLElement>("#riskFoDayConflict");
const riskCardHrd = getRequiredElement<HTMLElement>("#riskCardHrd");
const riskHrdValidation = getRequiredElement<HTMLElement>("#riskHrdValidation");
const riskCardHoliday = getRequiredElement<HTMLElement>("#riskCardHoliday");
const riskHolidayApplied = getRequiredElement<HTMLElement>("#riskHolidayApplied");

const cohortSelect = getRequiredElement<HTMLSelectElement>("#cohort");
const cohortInfo = getRequiredElement<HTMLElement>("#cohortInfo");
const downloadButton = getRequiredElement<HTMLButtonElement>("#download");
const hrdValidationPanel = getRequiredElement<HTMLElement>("#hrdValidationPanel");
const hrdValidationList = getRequiredElement<HTMLUListElement>("#hrdValidationList");

const timelineRange = getRequiredElement<HTMLElement>("#timelineRange");
const timelineEmpty = getRequiredElement<HTMLElement>("#timelineEmpty");
const timelineViewTypeSelect = getRequiredElement<HTMLSelectElement>("#timelineViewTypeSelect");
const assigneeTimelineControls = getRequiredElement<HTMLElement>("#assigneeTimelineControls");
const assigneeModeInstructorButton = getRequiredElement<HTMLButtonElement>("#assigneeModeInstructor");
const assigneeModeStaffButton = getRequiredElement<HTMLButtonElement>("#assigneeModeStaff");
const weekGridControls = getRequiredElement<HTMLElement>("#weekGridControls");
const weekPrevButton = getRequiredElement<HTMLButtonElement>("#weekPrevButton");
const weekNextButton = getRequiredElement<HTMLButtonElement>("#weekNextButton");
const weekLabel = getRequiredElement<HTMLElement>("#weekLabel");
const monthCalendarControls = getRequiredElement<HTMLElement>("#monthCalendarControls");
const monthPrevButton = getRequiredElement<HTMLButtonElement>("#monthPrevButton");
const monthNextButton = getRequiredElement<HTMLButtonElement>("#monthNextButton");
const monthLabel = getRequiredElement<HTMLElement>("#monthLabel");
const timelineDetailPanel = getRequiredElement<HTMLElement>("#timelineDetailPanel");
const timelineList = getRequiredElement<HTMLElement>("#timelineList");
const notificationStatusList = getRequiredElement<HTMLElement>("#notificationStatusList");

const scheduleCohortInput = getRequiredElement<HTMLInputElement>("#scheduleCohort");
const scheduleStartDateInput = getRequiredElement<HTMLInputElement>("#scheduleStartDate");
const scheduleTotalHoursInput = getRequiredElement<HTMLInputElement>("#scheduleTotalHours");
const dayTemplateTable = getRequiredElement<HTMLTableElement>("#dayTemplateTable");
const scheduleTemplateSelect = getRequiredElement<HTMLSelectElement>("#scheduleTemplateSelect");
const scheduleTemplateNameInput = getRequiredElement<HTMLInputElement>("#scheduleTemplateName");
const loadScheduleTemplateButton = getRequiredElement<HTMLButtonElement>("#loadScheduleTemplateButton");
const saveScheduleTemplateButton = getRequiredElement<HTMLButtonElement>("#saveScheduleTemplateButton");
const deleteScheduleTemplateButton = getRequiredElement<HTMLButtonElement>("#deleteScheduleTemplateButton");
const scheduleTemplateStatus = getRequiredElement<HTMLElement>("#scheduleTemplateStatus");

const holidayDateInput = getRequiredElement<HTMLInputElement>("#holidayDateInput");
const addHolidayButton = getRequiredElement<HTMLButtonElement>("#addHolidayButton");
const loadPublicHolidaysButton = getRequiredElement<HTMLButtonElement>("#loadPublicHolidaysButton");
const clearHolidaysButton = getRequiredElement<HTMLButtonElement>("#clearHolidaysButton");
const dedupeHolidaysButton = getRequiredElement<HTMLButtonElement>("#dedupeHolidaysButton");
const holidayLoadStatus = getRequiredElement<HTMLElement>("#holidayLoadStatus");
const holidayLoadSpinner = getRequiredElement<HTMLElement>("#holidayLoadSpinner");
const holidayList = getRequiredElement<HTMLUListElement>("#holidayList");

const customBreakDateInput = getRequiredElement<HTMLInputElement>("#customBreakDateInput");
const addCustomBreakButton = getRequiredElement<HTMLButtonElement>("#addCustomBreakButton");
const customBreakList = getRequiredElement<HTMLUListElement>("#customBreakList");

const scheduleInstructorCodeInput = getRequiredElement<HTMLInputElement>("#scheduleInstructorCode");
const scheduleClassroomCodeInput = getRequiredElement<HTMLInputElement>("#scheduleClassroomCode");
const scheduleSubjectCodeInput = getRequiredElement<HTMLInputElement>("#scheduleSubjectCode");

const generateScheduleButton = getRequiredElement<HTMLButtonElement>("#generateScheduleButton");
const pushScheduleToConflicts = getRequiredElement<HTMLInputElement>("#pushScheduleToConflicts");
const appendScheduleButton = getRequiredElement<HTMLButtonElement>("#appendScheduleButton");

const scheduleError = getRequiredElement<HTMLElement>("#scheduleError");
const scheduleResult = getRequiredElement<HTMLElement>("#scheduleResult");
const scheduleSummary = getRequiredElement<HTMLElement>("#scheduleSummary");
const scheduleSkippedSummary = getRequiredElement<HTMLElement>("#scheduleSkippedSummary");
const scheduleSkippedDetails = getRequiredElement<HTMLElement>("#scheduleSkippedDetails");
const scheduleDaysInfo = getRequiredElement<HTMLElement>("#scheduleDaysInfo");
const scheduleDaysPreview = getRequiredElement<HTMLUListElement>("#scheduleDaysPreview");
const scheduleAppendStatus = getRequiredElement<HTMLElement>("#scheduleAppendStatus");

const staffingStatus = getRequiredElement<HTMLElement>("#staffingStatus");
const staffingModeSelect = getRequiredElement<HTMLSelectElement>("#staffingModeSelect");
const staffingModeHint = getRequiredElement<HTMLElement>("#staffingModeHint");
const staffP1WeeksInput = getRequiredElement<HTMLInputElement>("#staffP1Weeks");
const staff365WeeksInput = getRequiredElement<HTMLInputElement>("#staff365Weeks");
const staffAutoFillButton = getRequiredElement<HTMLButtonElement>("#staffAutoFill");
const staffRefreshButton = getRequiredElement<HTMLButtonElement>("#staffRefresh");
const staffExportCsvButton = getRequiredElement<HTMLButtonElement>("#staffExportCsv");
const staffExportModeSelect = getRequiredElement<HTMLSelectElement>("#staffExportMode");
const staffExportIncludeDetails = getRequiredElement<HTMLInputElement>("#staffExportIncludeDetails");
const staffExportModeHint = getRequiredElement<HTMLElement>("#staffExportModeHint");
const staffExportWarningsAgree = getRequiredElement<HTMLInputElement>("#staffExportWarningsAgree");
const staffExportValidationPanel = getRequiredElement<HTMLElement>("#staffExportValidationPanel");
const staffExportValidationList = getRequiredElement<HTMLUListElement>("#staffExportValidationList");
const staffModuleManagerContainer = getRequiredElement<HTMLElement>("#staffModuleManagerContainer");
const staffModuleManagerContainerAdmin = getRequiredElement<HTMLElement>("#staffModuleManagerContainerAdmin");
const staffAdvancedContainer = getRequiredElement<HTMLElement>("#staffAdvancedContainer");
const staffMatrixContainer = getRequiredElement<HTMLElement>("#staffMatrixContainer");
const staffCohortGantt = getRequiredElement<HTMLElement>("#staffCohortGantt");
const staffAssigneeGantt = getRequiredElement<HTMLElement>("#staffAssigneeGantt");
const staffKpiBody = getRequiredElement<HTMLTableSectionElement>("#staffKpiBody");
const staffDetailContainer = getRequiredElement<HTMLElement>("#staffDetailContainer");

const errorCount = getRequiredElement<HTMLElement>("#errorCount");
const errorList = getRequiredElement<HTMLUListElement>("#errorList");
const errorEmpty = getRequiredElement<HTMLElement>("#errorEmpty");

const confCount = getRequiredElement<HTMLElement>("#confCount");
const confTableBody = getRequiredElement<HTMLTableSectionElement>("#confTable tbody");
const computeConflictsButton = getRequiredElement<HTMLButtonElement>("#computeConflicts");
const keySearchInput = getRequiredElement<HTMLInputElement>("#keySearch");
const downloadTimeConflictsButton = getRequiredElement<HTMLButtonElement>("#downloadTimeConflicts");
const confRenderNotice = getRequiredElement<HTMLElement>("#confRenderNotice");

const tabTimeConflicts = getRequiredElement<HTMLButtonElement>("#tabTimeConflicts");
const tabInstructorDayConflicts = getRequiredElement<HTMLButtonElement>("#tabInstructorDayConflicts");
const tabFoDayConflicts = getRequiredElement<HTMLButtonElement>("#tabFoDayConflicts");
const timeConflictPanel = getRequiredElement<HTMLElement>("#timeConflictPanel");
const instructorDayConflictPanel = getRequiredElement<HTMLElement>("#instructorDayConflictPanel");
const foDayConflictPanel = getRequiredElement<HTMLElement>("#foDayConflictPanel");
const instructorDaySearchInput = getRequiredElement<HTMLInputElement>("#instructorDaySearch");
const foDaySearchInput = getRequiredElement<HTMLInputElement>("#foDaySearch");
const downloadInstructorDayConflictsButton = getRequiredElement<HTMLButtonElement>("#downloadInstructorDayConflicts");
const downloadFoDayConflictsButton = getRequiredElement<HTMLButtonElement>("#downloadFoDayConflicts");
const instructorDayOverlapCount = getRequiredElement<HTMLElement>("#instructorDayOverlapCount");
const instructorDayOverlapBody = getRequiredElement<HTMLTableSectionElement>("#instructorDayOverlapBody");
const instructorDayRenderNotice = getRequiredElement<HTMLElement>("#instructorDayRenderNotice");
const foOverlapCount = getRequiredElement<HTMLElement>("#foOverlapCount");
const foOverlapBody = getRequiredElement<HTMLTableSectionElement>("#foOverlapBody");
const foDayRenderNotice = getRequiredElement<HTMLElement>("#foDayRenderNotice");

const saveProjectButton = getRequiredElement<HTMLButtonElement>("#saveProjectButton");
const loadProjectButton = getRequiredElement<HTMLButtonElement>("#loadProjectButton");
const resetProjectButton = getRequiredElement<HTMLButtonElement>("#resetProjectButton");
const printReportButton = getRequiredElement<HTMLButtonElement>("#printReportButton");
const loadProjectInput = getRequiredElement<HTMLInputElement>("#loadProjectInput");
const stateStorageStatus = getRequiredElement<HTMLElement>("#stateStorageStatus");
const stateStorageWarning = getRequiredElement<HTMLElement>("#stateStorageWarning");

const demoSampleSection = getRequiredElement<HTMLElement>("#demoSampleSection");
const demoSampleSelect = getRequiredElement<HTMLSelectElement>("#demoSampleSelect");
const loadDemoSampleButton = getRequiredElement<HTMLButtonElement>("#loadDemoSampleButton");
const restorePreviousStateButton = getRequiredElement<HTMLButtonElement>("#restorePreviousStateButton");
const demoSampleBanner = getRequiredElement<HTMLElement>("#demoSampleBanner");

const opsChecklistList = getRequiredElement<HTMLUListElement>("#opsChecklistList");

const printReportCard = getRequiredElement<HTMLElement>("#printReportCard");
const printReportMeta = getRequiredElement<HTMLElement>("#printReportMeta");
const printCohortGantt = getRequiredElement<HTMLElement>("#printCohortGantt");
const printAssigneeGantt = getRequiredElement<HTMLElement>("#printAssigneeGantt");
const printKpiContainer = getRequiredElement<HTMLElement>("#printKpiContainer");
const printConflictTitle = getRequiredElement<HTMLElement>("#printConflictTitle");
const printConflictContainer = getRequiredElement<HTMLElement>("#printConflictContainer");

const instructorCodeInput = getRequiredElement<HTMLInputElement>("#instructorCodeInput");
const instructorNameInput = getRequiredElement<HTMLInputElement>("#instructorNameInput");
const instructorMemoInput = getRequiredElement<HTMLInputElement>("#instructorMemoInput");
const upsertInstructorButton = getRequiredElement<HTMLButtonElement>("#upsertInstructorButton");
const instructorDirectoryBody = getRequiredElement<HTMLTableSectionElement>("#instructorDirectoryBody");
const courseIdInput = getRequiredElement<HTMLInputElement>("#courseIdInput");
const courseNameInput = getRequiredElement<HTMLInputElement>("#courseNameInput");
const courseMemoInput = getRequiredElement<HTMLInputElement>("#courseMemoInput");
const upsertCourseButton = getRequiredElement<HTMLButtonElement>("#upsertCourseButton");
const courseRegistryBody = getRequiredElement<HTMLTableSectionElement>("#courseRegistryBody");
const subjectCourseSelect = getRequiredElement<HTMLSelectElement>("#subjectCourseSelect");
const mappingCourseSelect = getRequiredElement<HTMLSelectElement>("#mappingCourseSelect");
const courseTemplateCourseSelect = getRequiredElement<HTMLSelectElement>("#courseTemplateCourseSelect");
const courseTemplateNameInput = getRequiredElement<HTMLInputElement>("#courseTemplateNameInput");
const courseTemplateSelect = getRequiredElement<HTMLSelectElement>("#courseTemplateSelect");
const saveCourseTemplateButton = getRequiredElement<HTMLButtonElement>("#saveCourseTemplateButton");
const loadCourseTemplateButton = getRequiredElement<HTMLButtonElement>("#loadCourseTemplateButton");
const deleteCourseTemplateButton = getRequiredElement<HTMLButtonElement>("#deleteCourseTemplateButton");
const courseTemplateStatus = getRequiredElement<HTMLElement>("#courseTemplateStatus");
const subjectCodeInput = getRequiredElement<HTMLInputElement>("#subjectCodeInput");
const subjectNameInput = getRequiredElement<HTMLInputElement>("#subjectNameInput");
const subjectMemoInput = getRequiredElement<HTMLInputElement>("#subjectMemoInput");
const upsertSubjectButton = getRequiredElement<HTMLButtonElement>("#upsertSubjectButton");
const subjectDirectoryBody = getRequiredElement<HTMLTableSectionElement>("#subjectDirectoryBody");
const applySubjectMappingsButton = getRequiredElement<HTMLButtonElement>("#applySubjectMappingsButton");
const subjectMappingContainer = getRequiredElement<HTMLElement>("#subjectMappingContainer");
const instructorTabCourse = getRequiredElement<HTMLButtonElement>("#instructorTabCourse");
const instructorTabRegister = getRequiredElement<HTMLButtonElement>("#instructorTabRegister");
const instructorTabMapping = getRequiredElement<HTMLButtonElement>("#instructorTabMapping");
const instructorTabSubject = getRequiredElement<HTMLButtonElement>("#instructorTabSubject");
const instructorCoursePanel = getRequiredElement<HTMLElement>("#instructorCoursePanel");
const instructorRegisterPanel = getRequiredElement<HTMLElement>("#instructorRegisterPanel");
const instructorMappingPanel = getRequiredElement<HTMLElement>("#instructorMappingPanel");
const instructorSubjectPanel = getRequiredElement<HTMLElement>("#instructorSubjectPanel");

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Required element is missing: ${selector}`);
  }
  return element as T;
}

function isCloudAccessAllowed(): boolean {
  return isAuthVerified;
}

function applyAuthGate(authenticated: boolean): void {
  isAuthVerified = authenticated;
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
  if (!isCloudAccessAllowed() || hasAppBootstrapped) {
    return;
  }

  hasAppBootstrapped = true;
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

function parseCompactDate(value: string): Date | null {
  if (!/^\d{8}$/.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10);
  const day = Number.parseInt(value.slice(6, 8), 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return validDate ? date : null;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return validDate ? date : null;
}

function addDaysToIso(value: string, amount: number): string {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    throw new Error(`날짜 형식이 올바르지 않습니다: ${value}`);
  }
  const next = new Date(parsed.getTime() + amount * DAY_MS);
  return formatDate(next);
}

function formatCompactDate(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toCompactDateFromIso(value: string): string {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return value;
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseCourseGroupFromCohortName(cohortName: string): { course: string; cohortLabel: string } {
  const trimmed = cohortName.trim();
  const matched = trimmed.match(/^(.*?)(\d+기)$/);
  if (!matched) {
    return { course: trimmed, cohortLabel: trimmed };
  }

  const course = matched[1]?.trim() || trimmed;
  const cohortLabel = matched[2]?.trim() || trimmed;
  return { course, cohortLabel };
}

function normalizeCourseId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function toCourseSubjectKey(courseId: string, subjectCode: string): string {
  const normalizedCourseId = normalizeCourseId(courseId);
  const normalizedSubjectCode = normalizeSubjectCode(subjectCode).toUpperCase();
  return `${normalizedCourseId}|||${normalizedSubjectCode}`;
}

function parseCourseSubjectKey(key: string): { courseId: string; subjectCode: string } {
  const [courseIdRaw, subjectRaw] = key.split("|||");
  return {
    courseId: normalizeCourseId(courseIdRaw ?? ""),
    subjectCode: normalizeSubjectCode(subjectRaw ?? "").toUpperCase()
  };
}

function formatHours(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatHHMM(value: string): string {
  const normalized = normalizeHHMM(value);
  if (!normalized) {
    return value;
  }
  return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
}

function normalizeTimeInputToHHMM(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(":");
    return normalizeHHMM(`${h}${m}`);
  }

  return normalizeHHMM(trimmed);
}

function getTodayCompactDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getTodayIsoDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function csvEscape(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[\r\n,"]/.test(escaped) ? `"${escaped}"` : escaped;
}

function createCsvBlob(csvText: string): Blob {
  const normalized = toCsvDownloadText(csvText);
  return new Blob([normalized], { type: "text/csv;charset=utf-8" });
}

function downloadCsvFile(fileName: string, columns: readonly string[], rows: string[][]): void {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(row.map((value) => csvEscape(value ?? "")).join(","));
  }

  const csv = lines.join("\r\n");
  const blob = createCsvBlob(csv);
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

function downloadCsvText(fileName: string, csv: string): void {
  const blob = createCsvBlob(csv);
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

function toDayConflictRow(overlap: StaffOverlap): string[] {
  return [
    overlap.assignee,
    overlap.resourceType,
    overlap.assignmentA.cohort,
    overlap.assignmentA.phase,
    overlap.assignmentA.startDate,
    overlap.assignmentA.endDate,
    overlap.assignmentB.cohort,
    overlap.assignmentB.phase,
    overlap.assignmentB.startDate,
    overlap.assignmentB.endDate,
    String(overlap.overlapDays)
  ];
}

function getOverlapRangeLabel(overlap: StaffOverlap): string {
  if (overlap.overlapStartDate === overlap.overlapEndDate) {
    return overlap.overlapStartDate;
  }
  return `${overlap.overlapStartDate}~${overlap.overlapEndDate}`;
}

function isDateInsideRange(date: string, start: string, end: string): boolean {
  if (!parseIsoDate(date) || !parseIsoDate(start) || !parseIsoDate(end)) {
    return false;
  }
  return date >= start && date <= end;
}

function setRenderNotice(element: HTMLElement, total: number, rendered: number): void {
  if (total === 0) {
    element.textContent = "";
    return;
  }

  if (total > rendered) {
    element.textContent = `총 ${total}건 중 상위 ${rendered}건만 표시됩니다. CSV 내보내기에는 전체 건수가 포함됩니다.`;
    return;
  }

  element.textContent = `총 ${total}건 표시 중`;
}

function createClickableCell(value: string, onClick: () => void): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = value;
  td.classList.add("clickable-cell");
  td.title = "클릭 시 간트에서 강조됩니다.";
  td.addEventListener("click", onClick);
  return td;
}

function buildModuleAssignSummaries(): ModuleAssignSummary[] {
  const ranges = deriveModuleRangesFromSessions(sessions);
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

  if (!hasComputedConflicts) {
    return keys;
  }

  for (const conflict of allConflicts) {
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
  allConflicts = detectConflicts(sessions, { resourceTypes: ["INSTRUCTOR"] });
  hasComputedConflicts = true;
  computeConflictsButton.textContent = RECOMPUTE_LABEL;
  applyConflictFilters();
}

function applyInstructorToModuleSummary(summary: ModuleAssignSummary, rawInstructorCode: string): void {
  const normalizedCode = normalizeInstructorCode(rawInstructorCode);
  if (!normalizedCode) {
    setStaffingStatus(`❌ ${summary.moduleKey}: 강사코드를 입력해 주세요.`, true);
    return;
  }

  const beforeTargets = sessions.filter(
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

  sessions = assignInstructorToModule({
    sessions,
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
    if (!hasComputedConflicts) {
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
  if (courseRegistry.length > 0) {
    return;
  }

  const inferred = new Set<string>();
  for (const session of sessions) {
    const parsed = parseCourseGroupFromCohortName(session.과정기수);
    const normalizedCourseId = normalizeCourseId(parsed.course);
    if (normalizedCourseId) {
      inferred.add(normalizedCourseId);
    }
  }

  if (inferred.size === 0) {
    return;
  }

  courseRegistry = Array.from(inferred).map((courseId) => ({ courseId, courseName: courseId, memo: "" }));
}

function renderCourseSelectOptions(): void {
  const sortedCourses = [...courseRegistry].sort((a, b) => a.courseId.localeCompare(b.courseId));
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

  const sorted = [...courseRegistry].sort((a, b) => a.courseId.localeCompare(b.courseId));
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
      courseRegistry = courseRegistry.filter((item) => item.courseId !== entry.courseId);
      subjectDirectory = subjectDirectory.filter((item) => item.courseId !== entry.courseId);
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

  const existing = courseRegistry.find((item) => item.courseId === courseId);
  if (existing) {
    existing.courseName = courseName;
    existing.memo = memo;
  } else {
    courseRegistry.push({ courseId, courseName, memo });
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

  const sorted = [...instructorDirectory].sort((a, b) => a.instructorCode.localeCompare(b.instructorCode));
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
      instructorDirectory = instructorDirectory.filter((item) => item.instructorCode !== removedCode);
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
    instructorDirectoryCloudWarning =
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
    instructorDirectoryCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    instructorDirectoryCloudWarning =
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
    managementCloudWarning = "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    renderGlobalWarnings();
    return;
  }

  try {
    await createCourse({ courseId: entry.courseId, courseName: entry.courseName });
    managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    managementCloudWarning = `과정 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

async function syncSubjectDirectoryCloud(entry: SubjectDirectoryEntry): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    managementCloudWarning = "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    renderGlobalWarnings();
    return;
  }

  try {
    await createSubject({
      courseId: entry.courseId,
      subjectCode: entry.subjectCode,
      subjectName: entry.subjectName
    });
    managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    managementCloudWarning = `교과목 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

async function syncCourseTemplateCloud(template: CourseTemplate): Promise<void> {
  if (!isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    managementCloudWarning = "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
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
    managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    managementCloudWarning = `템플릿 동기화 실패: ${message}`;
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
    managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    managementCloudWarning = `템플릿 삭제 동기화 실패: ${message}`;
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
    if (courseRegistry.length === 0) {
      const cloudCourses = await listCourses();
      if (cloudCourses.length > 0) {
        courseRegistry = cloudCourses.map((item) => ({
          courseId: normalizeCourseId(item.courseId),
          courseName: item.courseName,
          memo: ""
        }));
        hasChanged = true;
      }
    }

    if (subjectDirectory.length === 0 && courseRegistry.length > 0) {
      const byCourse = await Promise.all(courseRegistry.map((course) => listSubjects(course.courseId)));
      const merged = byCourse.flat();
      if (merged.length > 0) {
        subjectDirectory = merged.map((item) => ({
          courseId: normalizeCourseId(item.courseId),
          subjectCode: normalizeSubjectCode(item.subjectCode).toUpperCase(),
          subjectName: item.subjectName,
          memo: ""
        }));
        hasChanged = true;
      }
    }

    if (courseTemplates.length === 0) {
      const cloudTemplates = await listCourseTemplates();
      if (cloudTemplates.length > 0) {
        courseTemplates = cloudTemplates.map(toCourseTemplateFromCloudRecord);
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

    managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    managementCloudWarning = `클라우드 관리 데이터 동기화 실패: ${message}`;
  } finally {
    renderGlobalWarnings();
  }
}

function renderSubjectDirectory(): void {
  subjectDirectoryBody.innerHTML = "";
  const selectedCourseId = normalizeCourseId(subjectCourseSelect.value);
  const rows = subjectDirectory
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
      subjectDirectory = subjectDirectory.filter(
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
  const existing = subjectDirectory.find((item) => item.courseId === courseId && item.subjectCode === subjectCode);
  if (existing) {
    existing.subjectName = subjectName;
    existing.memo = memo;
  } else {
    subjectDirectory.push({ courseId, subjectCode, subjectName, memo });
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
    const subjectEntry = subjectDirectory.find(
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
    for (const entry of instructorDirectory) {
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
    select.value = instructorDirectory.some((item) => item.instructorCode === current) ? current : "";

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
  const existing = instructorDirectory.find((item) => item.instructorCode === instructorCode);
  if (existing) {
    existing.name = name;
    existing.memo = memo;
  } else {
    instructorDirectory.push({ instructorCode, name, memo });
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

  const courseSubjects = subjectDirectory.filter((item) => item.courseId === selectedCourseId);
  const subjectDirectoryCodes = new Set(courseSubjects.map((item) => item.subjectCode));
  const cohortSessionSubjects = new Set(
    sessions
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
    sessions,
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

  sessions = applyResult.sessions.map((session) => ({
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
  return recentActionLogs.map((log) => ({
    id: log.id,
    severity: log.severity,
    source: "HRD_VALIDATION",
    title: log.severity === "ERROR" ? "오류" : log.severity === "WARNING" ? "경고" : "정보",
    message: log.message
  }));
}

function refreshNotificationItems(): NotificationItem[] {
  notificationItems = buildNotifications();
  return notificationItems;
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
  const logs = [...recentActionLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
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
  recentActionLogs = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      severity,
      message,
      focusSectionId,
      createdAt: new Date().toISOString()
    },
    ...recentActionLogs
  ].slice(0, 5);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function estimateUtf8SizeBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function dedupeAndSortDates(values: string[]): string[] {
  const normalized = new Set<string>();

  for (const value of values) {
    const parsed = parseIsoDate(value);
    if (!parsed) {
      continue;
    }
    normalized.add(formatDate(parsed));
  }

  return Array.from(normalized).sort((a, b) => a.localeCompare(b));
}

function normalizePolicyDays(days: number[]): number[] {
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort(
    (a, b) => a - b
  );
}

function getPolicyForTrack(trackType: TrackType): number[] {
  return [...POLICY_BY_TRACK[trackType]];
}

function getPolicyLabel(days: number[]): string {
  const normalized = normalizePolicyDays(days);
  if (normalized.join(",") === "1,2,3,4,5") {
    return "월~금";
  }
  if (normalized.join(",") === "1,2,3,4,5,6") {
    return "월~토";
  }

  const dayName = ["일", "월", "화", "수", "목", "금", "토"];
  return normalized.map((day) => dayName[day] ?? `D${day}`).join(",");
}

function isTrackType(value: unknown): value is TrackType {
  return value === "UNEMPLOYED" || value === "EMPLOYED";
}

function isResourceType(value: unknown): value is ResourceType {
  return value === "INSTRUCTOR" || value === "FACILITATOR" || value === "OPERATION";
}

function isPhase(value: unknown): value is Phase {
  return value === "P1" || value === "P2" || value === "365";
}

function getConflictTabLabel(tab: ConflictTab): string {
  if (tab === "time") {
    return "강사 시간 충돌";
  }
  if (tab === "instructor_day") {
    return "강사 배치(일) 충돌";
  }
  return "퍼실/운영 배치(일) 충돌";
}

function applyViewMode(mode: ViewMode): void {
  viewMode = mode;
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
  showAdvanced = enabled;
  document.body.classList.toggle("admin-mode", enabled);
  if (!enabled && !hasPrunedBasicModeSections) {
    removeBasicModeSections(document);
    hasPrunedBasicModeSections = true;
  }
  if (adminModeToggle) {
    adminModeToggle.checked = enabled;
  }
}

function resolveManagementInlineMode(): boolean {
  return true;
}

function applyManagementInlineMode(): void {
  managementInlineMode = resolveManagementInlineMode();
  document.body.classList.toggle("management-inline-mode", managementInlineMode);

  if (managementInlineMode) {
    instructorDrawer.classList.add("open");
    instructorDrawer.setAttribute("aria-hidden", "false");
    drawerBackdrop.classList.remove("open");
    if (activeDrawer === "instructor") {
      activeDrawer = null;
    }
    return;
  }

  if (activeDrawer !== "instructor") {
    instructorDrawer.classList.remove("open");
    instructorDrawer.setAttribute("aria-hidden", "true");
  }
}

function renderHeaderRuntimeStatus(): void {
  headerCurrentTime.textContent = new Date().toLocaleTimeString("ko-KR", { hour12: false });

  const cloudEnabled = isInstructorCloudEnabled();
  const hasWarning = instructorDirectoryCloudWarning.trim().length > 0;
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
  activeDrawer = null;
  drawerBackdrop.classList.remove("open");
  notificationDrawer.classList.remove("open");
  notificationDrawer.setAttribute("aria-hidden", "true");

  if (managementInlineMode) {
    instructorDrawer.classList.add("open");
    instructorDrawer.setAttribute("aria-hidden", "false");
    return;
  }

  instructorDrawer.classList.remove("open");
  instructorDrawer.setAttribute("aria-hidden", "true");
}

function openDrawer(target: "notification" | "instructor"): void {
  closeDrawers();
  activeDrawer = target;
  if (target === "notification") {
    drawerBackdrop.classList.add("open");
    notificationDrawer.classList.add("open");
    notificationDrawer.setAttribute("aria-hidden", "false");
    return;
  }

  instructorDrawer.classList.add("open");
  instructorDrawer.setAttribute("aria-hidden", "false");
  if (!managementInlineMode) {
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
  if (managementInlineMode) {
    instructorDrawer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setNotificationFocus(focus: { cohort?: string; assignee?: string; date?: string } | null): void {
  notificationFocus = focus;
}

function setTimelineViewType(nextView: TimelineViewType): void {
  timelineViewType = TIMELINE_VIEW_ORDER.includes(nextView) ? nextView : "COHORT_TIMELINE";
  timelineViewTypeSelect.value = timelineViewType;
  assigneeTimelineControls.style.display = timelineViewType === "ASSIGNEE_TIMELINE" ? "block" : "none";
  weekGridControls.style.display = timelineViewType === "WEEK_GRID" ? "block" : "none";
  monthCalendarControls.style.display = timelineViewType === "MONTH_CALENDAR" ? "block" : "none";
}

function parseTimelineViewType(value: string): TimelineViewType {
  return TIMELINE_VIEW_ORDER.includes(value as TimelineViewType)
    ? (value as TimelineViewType)
    : "COHORT_TIMELINE";
}

function renderTimelineDetail(title: string, details: string[]): void {
  if (details.length === 0) {
    timelineDetailPanel.style.display = "none";
    timelineDetailPanel.textContent = "";
    return;
  }

  timelineDetailPanel.style.display = "block";
  timelineDetailPanel.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = title;
  timelineDetailPanel.appendChild(strong);

  const list = document.createElement("ul");
  list.className = "error-list";
  for (const detail of details.slice(0, 12)) {
    const li = document.createElement("li");
    li.textContent = detail;
    list.appendChild(li);
  }
  timelineDetailPanel.appendChild(list);
}

function startOfWeekIso(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    return isoDate;
  }
  const utcDay = parsed.getUTCDay();
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
  return formatDate(new Date(parsed.getTime() + mondayOffset * DAY_MS));
}

function applyStaffingMode(mode: StaffingMode): void {
  staffingMode = mode;
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
      management: config.labels.management,
      generator: config.labels.generator,
      reports: config.labels.reports,
      settings: config.labels.settings
    },
    icons: {
      timeline: config.icons.timeline,
      management: config.icons.management,
      generator: config.icons.generator,
      reports: config.icons.reports,
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
      management: normalizeSidebarMenuLabel("management", config.labels.management),
      generator: normalizeSidebarMenuLabel("generator", config.labels.generator),
      reports: normalizeSidebarMenuLabel("reports", config.labels.reports),
      settings: normalizeSidebarMenuLabel("settings", config.labels.settings)
    },
    icons: {
      timeline: normalizeSidebarMenuIcon("timeline", config.icons.timeline),
      management: normalizeSidebarMenuIcon("management", config.icons.management),
      generator: normalizeSidebarMenuIcon("generator", config.icons.generator),
      reports: normalizeSidebarMenuIcon("reports", config.icons.reports),
      settings: normalizeSidebarMenuIcon("settings", config.icons.settings)
    }
  };
}

function getDefaultSidebarMenuConfig(): SidebarMenuConfig {
  return {
    order: [...PRIMARY_SIDEBAR_NAV_KEYS],
    labels: {
      timeline: DEFAULT_PRIMARY_SIDEBAR_LABELS.timeline,
      management: DEFAULT_PRIMARY_SIDEBAR_LABELS.management,
      generator: DEFAULT_PRIMARY_SIDEBAR_LABELS.generator,
      reports: DEFAULT_PRIMARY_SIDEBAR_LABELS.reports,
      settings: DEFAULT_PRIMARY_SIDEBAR_LABELS.settings
    },
    icons: {
      timeline: DEFAULT_PRIMARY_SIDEBAR_ICONS.timeline,
      management: DEFAULT_PRIMARY_SIDEBAR_ICONS.management,
      generator: DEFAULT_PRIMARY_SIDEBAR_ICONS.generator,
      reports: DEFAULT_PRIMARY_SIDEBAR_ICONS.reports,
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
      management: normalizeSidebarMenuLabel(
        "management",
        typeof parsed.labels?.management === "string"
          ? parsed.labels.management
          : fallback.labels.management
      ),
      generator: normalizeSidebarMenuLabel(
        "generator",
        typeof parsed.labels?.generator === "string"
          ? parsed.labels.generator
          : fallback.labels.generator
      ),
      reports: normalizeSidebarMenuLabel(
        "reports",
        typeof parsed.labels?.reports === "string"
          ? parsed.labels.reports
          : fallback.labels.reports
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
      management: normalizeSidebarMenuIcon(
        "management",
        typeof parsed.icons?.management === "string"
          ? parsed.icons.management
          : fallback.icons.management
      ),
      generator: normalizeSidebarMenuIcon(
        "generator",
        typeof parsed.icons?.generator === "string"
          ? parsed.icons.generator
          : fallback.icons.generator
      ),
      reports: normalizeSidebarMenuIcon(
        "reports",
        typeof parsed.icons?.reports === "string"
          ? parsed.icons.reports
          : fallback.icons.reports
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

  setJibbleSidebarActive(activePrimarySidebarPage);
}

function moveSidebarMenuDraft(navKey: PrimarySidebarNavKey, direction: -1 | 1): void {
  const currentIndex = sidebarMenuDraft.order.indexOf(navKey);
  if (currentIndex < 0) {
    return;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= sidebarMenuDraft.order.length) {
    return;
  }

  const nextOrder = [...sidebarMenuDraft.order];
  const [moved] = nextOrder.splice(currentIndex, 1);
  nextOrder.splice(nextIndex, 0, moved);
  sidebarMenuDraft = {
    ...sidebarMenuDraft,
    order: nextOrder
  };

  applySidebarMenuConfigToSidebar(sidebarMenuDraft);
  renderSidebarMenuConfigEditor();
  menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
}

function renderSidebarMenuConfigEditor(): void {
  menuConfigList.innerHTML = "";

  const total = sidebarMenuDraft.order.length;
  for (const [index, navKey] of sidebarMenuDraft.order.entries()) {
    const row = document.createElement("div");
    row.className = "menu-config-row";

    const icon = document.createElement("span");
    icon.className = "menu-config-icon";
    icon.textContent = normalizeSidebarMenuIcon(navKey, sidebarMenuDraft.icons[navKey]);
    row.appendChild(icon);

    const iconInput = document.createElement("input");
    iconInput.className = "menu-config-icon-input";
    iconInput.type = "text";
    iconInput.maxLength = 4;
    iconInput.value = sidebarMenuDraft.icons[navKey];
    iconInput.setAttribute("aria-label", `${navKey} 아이콘`);
    iconInput.addEventListener("input", () => {
      sidebarMenuDraft.icons[navKey] = iconInput.value;
      icon.textContent = normalizeSidebarMenuIcon(navKey, iconInput.value);
      applySidebarMenuConfigToSidebar(sidebarMenuDraft);
      menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
    });
    row.appendChild(iconInput);

    const input = document.createElement("input");
    input.className = "menu-config-input";
    input.type = "text";
    input.maxLength = 20;
    input.value = sidebarMenuDraft.labels[navKey];
    input.addEventListener("input", () => {
      sidebarMenuDraft.labels[navKey] = input.value;
      applySidebarMenuConfigToSidebar(sidebarMenuDraft);
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
  activePrimarySidebarPage = navKey;
  setJibbleSidebarActive(navKey);
  setPageGroupVisibility(navKey);

  const showManagement = navKey === "management";
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
  if (isPrimarySidebarNavKey(pageGroup) && pageGroup !== activePrimarySidebarPage) {
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
        openManagementTab: navKeyRaw === "management"
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
}

function getTrackTypeMissingCohorts(): string[] {
  return summaries
    .map((summary) => summary.과정기수)
    .filter((cohort) => !isTrackType(cohortTrackType.get(cohort)));
}

function getUnassignedInstructorModules(): string[] {
  if (staffingMode === "manager") {
    return buildModuleAssignSummaries()
      .filter((item) => !isModuleInstructorApplied(item))
      .map((item) => item.moduleKey)
      .sort((a, b) => a.localeCompare(b));
  }

  const missing = new Set<string>();

  const sessionCohorts = new Set(sessions.map((session) => session.과정기수));
  for (const cohort of sessionCohorts) {
    const hasInstructorAssignee = staffingAssignments.some(
      (assignment) =>
        assignment.cohort === cohort &&
        assignment.resourceType === "INSTRUCTOR" &&
        assignment.assignee.trim().length > 0
    );
    if (!hasInstructorAssignee) {
      missing.add(`${cohort} (강사 미배정)`);
    }
  }

  for (const range of staffingCohortRanges) {
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
  return hasLoadedPublicHoliday || holidayDates.length > 0;
}

function isHrdChecklistPassed(): boolean {
  return (
    sessions.length > 0 &&
    Boolean(cohortSelect.value) &&
    hrdValidationErrors.length === 0 &&
    hasComputedConflicts &&
    allConflicts.length === 0 &&
    instructorDayOverlaps.length === 0 &&
    facilitatorOperationOverlaps.length === 0 &&
    isHolidayApplied() &&
    getTrackTypeMissingCohorts().length === 0 &&
    getUnassignedInstructorModules().length === 0
  );
}

function renderGlobalWarnings(): void {
  const warnings: string[] = [];
  const trackTypeMissing = getTrackTypeMissingCohorts();
  const unassignedModules = getUnassignedInstructorModules();
  const cloudWarning = instructorDirectoryCloudWarning.trim();
  const managementWarning = managementCloudWarning.trim();

  if (trackTypeMissing.length > 0) {
    warnings.push(`trackType 미설정 코호트: ${trackTypeMissing.join(", ")}`);
  }

  if (unassignedModules.length > 0) {
    const preview = unassignedModules.slice(0, 6).join(", ");
    const suffix = unassignedModules.length > 6 ? ` 외 ${unassignedModules.length - 6}건` : "";
    warnings.push(`강사 배정 안된 모듈/코호트: ${preview}${suffix}`);
  }

  if (hasComputedConflicts && allConflicts.length > 0) {
    warnings.push(`강사 시간 충돌 ${allConflicts.length}건`);
  }

  if (cohortSelect.value && hrdValidationErrors.length > 0) {
    warnings.push(`HRD 검증 오류 ${hrdValidationErrors.length}건 (기수: ${cohortSelect.value})`);
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
  if (!hasComputedConflicts) {
    setRiskCardState(riskCardTime, riskTimeConflict, "0 / 미계산", "warn");
  } else {
    setRiskCardState(
      riskCardTime,
      riskTimeConflict,
      `0 / ${allConflicts.length}`,
      allConflicts.length === 0 ? "ok" : "error"
    );
  }

  if (staffingAssignments.length === 0) {
    setRiskCardState(riskCardInstructorDay, riskInstructorDayConflict, "0 / 미계산", "warn");
    setRiskCardState(riskCardFoDay, riskFoDayConflict, "0 / 미계산", "warn");
  } else {
    setRiskCardState(
      riskCardInstructorDay,
      riskInstructorDayConflict,
      `0 / ${instructorDayOverlaps.length}`,
      instructorDayOverlaps.length === 0 ? "ok" : "error"
    );
    setRiskCardState(
      riskCardFoDay,
      riskFoDayConflict,
      `0 / ${facilitatorOperationOverlaps.length}`,
      facilitatorOperationOverlaps.length === 0 ? "ok" : "error"
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

  const instructorCount = instructorDirectory.length;
  const cohortCount = summaries.length;
  const conflictCount = hasComputedConflicts ? allConflicts.length : -1;
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

  if (!hasComputedConflicts) {
    jibbleOpsStatus.textContent = "분석대기";
    jibbleOpsSummary.textContent = `${cohortSelect.value} · 시간 충돌 계산 전`;
    return;
  }

  if (isHrdChecklistPassed()) {
    jibbleOpsStatus.textContent = "안정";
    jibbleOpsSummary.textContent = `${cohortSelect.value} · HRD 점검 통과 준비 완료`;
    return;
  }

  if (allConflicts.length > 0 || instructorDayOverlaps.length > 0 || unassignedCount > 0) {
    jibbleOpsStatus.textContent = "점검필요";
    jibbleOpsSummary.textContent =
      `${cohortSelect.value} · 시간충돌 ${allConflicts.length}건 / 일충돌 ${instructorDayOverlaps.length}건 / 미배정 ${unassignedCount}건`;
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

  if (ganttHighlightTimer !== undefined) {
    window.clearTimeout(ganttHighlightTimer);
  }
  ganttHighlightTimer = window.setTimeout(() => clearGanttHighlights(), 3500);
}

function collectTemplateRowsState(): TemplateRowState[] {
  const rows = Array.from(dayTemplateTable.querySelectorAll<HTMLTableRowElement>("tbody tr"));

  return rows
    .map((row) => {
      const weekday = Number.parseInt(row.dataset.weekday ?? "", 10);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return null;
      }

      return {
        weekday,
        start: row.querySelector<HTMLInputElement>(".tpl-start")?.value ?? "",
        end: row.querySelector<HTMLInputElement>(".tpl-end")?.value ?? "",
        breakStart: row.querySelector<HTMLInputElement>(".tpl-break-start")?.value ?? "",
        breakEnd: row.querySelector<HTMLInputElement>(".tpl-break-end")?.value ?? ""
      };
    })
    .filter((item): item is TemplateRowState => item !== null)
    .sort((a, b) => a.weekday - b.weekday);
}

function applyTemplateRowsState(rows: TemplateRowState[] | undefined): void {
  if (!rows || rows.length === 0) {
    return;
  }

  const map = new Map<number, TemplateRowState>();
  for (const row of rows) {
    if (Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6) {
      map.set(row.weekday, row);
    }
  }

  const domRows = Array.from(dayTemplateTable.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  for (const domRow of domRows) {
    const weekday = Number.parseInt(domRow.dataset.weekday ?? "", 10);
    const state = map.get(weekday);
    if (!state) {
      continue;
    }

    const startInput = domRow.querySelector<HTMLInputElement>(".tpl-start");
    const endInput = domRow.querySelector<HTMLInputElement>(".tpl-end");
    const breakStartInput = domRow.querySelector<HTMLInputElement>(".tpl-break-start");
    const breakEndInput = domRow.querySelector<HTMLInputElement>(".tpl-break-end");

    if (startInput) {
      startInput.value = state.start;
    }
    if (endInput) {
      endInput.value = state.end;
    }
    if (breakStartInput) {
      breakStartInput.value = state.breakStart;
    }
    if (breakEndInput) {
      breakEndInput.value = state.breakEnd;
    }
  }
}

function saveScheduleTemplatesToLocalStorage(): void {
  try {
    localStorage.setItem(SCHEDULE_TEMPLATE_STORAGE_KEY, JSON.stringify(scheduleTemplates));
  } catch {
    scheduleTemplateStatus.textContent = "템플릿 저장 실패: 브라우저 저장소를 확인해 주세요.";
  }
}

function loadScheduleTemplatesFromLocalStorage(): void {
  const raw = localStorage.getItem(SCHEDULE_TEMPLATE_STORAGE_KEY);
  if (!raw) {
    scheduleTemplates = createDefaultScheduleTemplates();
    saveScheduleTemplatesToLocalStorage();
    return;
  }

  try {
    scheduleTemplates = mergeScheduleTemplates(JSON.parse(raw) as unknown);
  } catch {
    scheduleTemplates = createDefaultScheduleTemplates();
    saveScheduleTemplatesToLocalStorage();
  }
}

function renderScheduleTemplateOptions(preferredName = ""): void {
  const previous = preferredName || scheduleTemplateSelect.value;
  scheduleTemplateSelect.innerHTML = "";

  for (const preset of scheduleTemplates) {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.builtIn ? `${preset.name} (기본)` : preset.name;
    scheduleTemplateSelect.appendChild(option);
  }

  if (scheduleTemplates.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "저장된 템플릿 없음";
    scheduleTemplateSelect.appendChild(option);
    scheduleTemplateSelect.value = "";
    deleteScheduleTemplateButton.disabled = true;
    return;
  }

  const selected = scheduleTemplates.some((item) => item.name === previous)
    ? previous
    : scheduleTemplates[0].name;
  scheduleTemplateSelect.value = selected;
  const selectedTemplate = findScheduleTemplate(scheduleTemplates, selected);
  deleteScheduleTemplateButton.disabled = Boolean(selectedTemplate?.builtIn);
  updateActionStates();
}

function applySelectedScheduleTemplate(): void {
  const selected = findScheduleTemplate(scheduleTemplates, scheduleTemplateSelect.value);
  if (!selected) {
    scheduleTemplateStatus.textContent = "선택한 템플릿을 찾을 수 없습니다.";
    return;
  }

  applyTemplateRowsState(selected.rows);
  scheduleTemplateStatus.textContent = `템플릿 불러오기 완료: ${selected.name}`;
  pushRecentActionLog("INFO", `시간 템플릿 적용 완료: ${selected.name}`, "sectionScheduleGenerate");
  scheduleAutoSave();
}

function saveCurrentScheduleTemplate(): void {
  const name = scheduleTemplateNameInput.value.trim();
  if (!name) {
    scheduleTemplateStatus.textContent = "저장할 템플릿 이름을 입력해 주세요.";
    return;
  }

  const rows = collectTemplateRowsState();
  scheduleTemplates = upsertScheduleTemplate(scheduleTemplates, name, rows);
  saveScheduleTemplatesToLocalStorage();
  renderScheduleTemplateOptions(name);
  scheduleTemplateNameInput.value = "";
  scheduleTemplateStatus.textContent = `템플릿 저장 완료: ${name}`;
  pushRecentActionLog("INFO", `시간 템플릿 저장 완료: ${name}`, "sectionScheduleGenerate");
}

function deleteSelectedScheduleTemplate(): void {
  const selected = scheduleTemplateSelect.value;
  const template = findScheduleTemplate(scheduleTemplates, selected);
  if (!template) {
    scheduleTemplateStatus.textContent = "삭제할 템플릿을 찾을 수 없습니다.";
    return;
  }

  if (template.builtIn) {
    scheduleTemplateStatus.textContent = "기본 템플릿은 삭제할 수 없습니다.";
    return;
  }

  scheduleTemplates = removeScheduleTemplate(scheduleTemplates, template.name);
  saveScheduleTemplatesToLocalStorage();
  renderScheduleTemplateOptions();
  scheduleTemplateStatus.textContent = `템플릿 삭제 완료: ${template.name}`;
  pushRecentActionLog("INFO", `시간 템플릿 삭제 완료: ${template.name}`, "sectionScheduleGenerate");
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

  const templates = courseTemplates
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

  const subjectList = subjectDirectory
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
    holidays: [...holidayDates],
    customBreaks: [...customBreakDates],
    subjectList,
    subjectInstructorMapping
  };

  const existingIndex = courseTemplates.findIndex((item) => item.courseId === courseId && item.name === name);
  if (existingIndex >= 0) {
    courseTemplates[existingIndex] = template;
  } else {
    courseTemplates.push(template);
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
  const template = courseTemplates.find(
    (item) => item.courseId === selected.courseId && item.name === selected.name
  );
  if (!template) {
    courseTemplateStatus.textContent = "불러올 템플릿을 찾을 수 없습니다.";
    return;
  }

  const applied = applyCourseTemplateToState({
    subjectDirectory,
    subjectInstructorMappings: Array.from(subjectInstructorMappings.entries()).map(([key, instructorCode]) => ({
      key,
      instructorCode
    })),
    template
  });

  applyTemplateRowsState(applied.dayTemplates);
  holidayDates = dedupeAndSortDates(applied.holidays);
  customBreakDates = dedupeAndSortDates(applied.customBreaks);
  renderHolidayAndBreakLists();
  subjectDirectory = applied.subjectDirectory;
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

  const nextTemplates = courseTemplates.filter(
    (item) => !(item.courseId === selected.courseId && item.name === selected.name)
  );
  if (nextTemplates.length === courseTemplates.length) {
    courseTemplateStatus.textContent = "삭제할 템플릿을 찾지 못했습니다.";
    return;
  }

  courseTemplates = nextTemplates;
  renderCourseTemplateOptions();
  courseTemplateStatus.textContent = `템플릿 삭제 완료: ${selected.courseId} / ${selected.name}`;
  scheduleAutoSave();
  void syncDeleteCourseTemplateCloud(selected.courseId, selected.name);
}

function collectSavedStaffingCells(): SavedStaffCell[] {
  const cells: SavedStaffCell[] = [];

  for (const range of staffingCohortRanges) {
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
  const cloudWarning = instructorDirectoryCloudWarning;
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
    instructorDirectoryCloudWarning =
      "클라우드 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 설정을 확인해 주세요.";
    return localInstructors;
  }

  try {
    const cloudInstructors = await loadInstructorDirectoryFromCloud();
    if (cloudInstructors.length > 0) {
      instructorDirectoryCloudWarning = localInstructors.length > 0
        ? "클라우드 강사 목록을 병합했습니다."
        : "클라우드 강사 목록을 가져와 적용했습니다.";
    } else {
      instructorDirectoryCloudWarning = localInstructors.length > 0
        ? ""
        : "클라우드에 저장된 강사 목록이 없습니다. 로컬 데이터를 사용합니다.";
    }
    return mergeWithLocalInstructorDirectory(localInstructors, cloudInstructors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    instructorDirectoryCloudWarning = `클라우드 강사 목록 동기화 실패: ${message}. 로컬 데이터를 사용합니다.`;
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
    sessions,
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
      holidays: [...holidayDates],
      customBreaks: [...customBreakDates],
      generatedResult: generatedScheduleResult,
      generatedCohort: generatedScheduleCohort,
      publicHolidayLoaded: hasLoadedPublicHoliday
    },
    staffingCells: collectSavedStaffingCells(),
    instructorDirectory,
    instructorRegistry: instructorDirectory,
    courseRegistry,
    subjectDirectory,
    subjectRegistryByCourse: subjectDirectory.map((item) => ({
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
    courseTemplates,
    ui: {
      activeConflictTab,
      viewMode,
      timelineViewType,
      showAdvanced,
      keySearch: keySearchInput.value,
      instructorDaySearch: instructorDaySearchInput.value,
      foDaySearch: foDaySearchInput.value,
      sidebarMenu: normalizeSidebarMenuConfig(sidebarMenuDraft)
    }
  };
}

function scheduleAutoSave(): void {
  if (isApplyingProjectState) {
    return;
  }

  if (autoSaveTimer !== undefined) {
    window.clearTimeout(autoSaveTimer);
  }

  autoSaveTimer = window.setTimeout(() => {
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

  isApplyingProjectState = true;
  try {
    sessions = Array.isArray(state.sessions) ? (state.sessions as Session[]) : [];
    moduleInstructorDraft.clear();
    subjectInstructorMappingDraft.clear();
    parseErrors = [];

    const scheduleState = state.scheduleGenerator;
    holidayDates = dedupeAndSortDates(Array.isArray(scheduleState?.holidays) ? scheduleState.holidays : []);
    customBreakDates = dedupeAndSortDates(Array.isArray(scheduleState?.customBreaks) ? scheduleState.customBreaks : []);
    generatedScheduleResult = (scheduleState?.generatedResult as GenerateScheduleResult | null | undefined) ?? null;
    generatedScheduleCohort = scheduleState?.generatedCohort ?? "";
    hasLoadedPublicHoliday = Boolean(scheduleState?.publicHolidayLoaded);

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
    instructorDirectory = instructorSource
      .map((item) => ({
        instructorCode: normalizeInstructorCode(item.instructorCode),
        name: item.name ?? "",
        memo: item.memo ?? ""
      }))
      .filter((item) => item.instructorCode.length > 0)
      .sort((a, b) => a.instructorCode.localeCompare(b.instructorCode));

    courseRegistry = Array.isArray(state.courseRegistry)
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
    subjectDirectory = rawSubjects.map((item) => ({
          courseId: normalizeCourseId(item.courseId ?? ""),
          subjectCode: normalizeSubjectCode(item.subjectCode).toUpperCase(),
          subjectName: item.subjectName ?? "",
          memo: item.memo ?? ""
        }));
    subjectDirectory = subjectDirectory.filter((item) => item.courseId.length > 0 && item.subjectCode.length > 0);
    for (const courseId of new Set(subjectDirectory.map((item) => item.courseId))) {
      if (!courseRegistry.some((item) => item.courseId === courseId)) {
        courseRegistry.push({ courseId, courseName: courseId, memo: "" });
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
    courseTemplates = Array.isArray(state.courseTemplates) ? state.courseTemplates : [];

    regenerateSummariesAndTimeline();
    resetConflictsBeforeCompute();
    computeConflictsButton.textContent = DEFAULT_COMPUTE_LABEL;

    const ui = state.ui;
    const loadedSidebarMenu = ui?.sidebarMenu;
    if (loadedSidebarMenu) {
      sidebarMenuConfig = normalizeSidebarMenuConfig({
        order: loadedSidebarMenu.order,
        labels: loadedSidebarMenu.labels,
        icons: loadedSidebarMenu.icons
      });
    } else {
      sidebarMenuConfig = getDefaultSidebarMenuConfig();
    }
    sidebarMenuDraft = cloneSidebarMenuConfig(sidebarMenuConfig);
    applySidebarMenuConfigToSidebar(sidebarMenuConfig);
    saveSidebarMenuConfig(sidebarMenuConfig);

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

    uploadStatus.textContent = sessions.length > 0 ? `현재 수업시간표 ${sessions.length}건` : "대기중";
    stateStorageStatus.textContent = `프로젝트 불러오기 완료 (${new Date().toLocaleTimeString()})`;
  } finally {
    isApplyingProjectState = false;
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
  renderTimeline();
  renderErrors();
  renderHrdValidationErrors();
  renderTimeConflicts();
  renderStaffingSection();
  setConflictTab("time");
  updateActionStates();
}

function getDefaultTrackTypeForCohort(cohort: string): TrackType {
  const hasSaturday = sessions.some((session) => {
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

function setConflictTab(tab: ConflictTab): void {
  activeConflictTab = tab;

  const isTime = tab === "time";
  const isInstructorDay = tab === "instructor_day";

  tabTimeConflicts.classList.toggle("active", isTime);
  tabInstructorDayConflicts.classList.toggle("active", isInstructorDay);
  tabFoDayConflicts.classList.toggle("active", tab === "fo_day");

  timeConflictPanel.style.display = isTime ? "block" : "none";
  instructorDayConflictPanel.style.display = isInstructorDay ? "block" : "none";
  foDayConflictPanel.style.display = tab === "fo_day" ? "block" : "none";
  scheduleAutoSave();
}

function setUploadProcessingState(processing: boolean): void {
  isUploadProcessing = processing;
  uploadStatus.textContent = processing ? "처리중..." : uploadStatus.textContent;

  if (processing) {
    downloadButton.textContent = "처리중...";
  } else {
    downloadButton.textContent = DEFAULT_DOWNLOAD_LABEL;
  }

  updateActionStates();
}

function setHolidayLoadingState(loading: boolean): void {
  isHolidayLoading = loading;
  holidayLoadSpinner.style.display = loading ? "inline-block" : "none";
  loadPublicHolidaysButton.textContent = loading ? "불러오는 중..." : "공휴일 불러오기(대한민국)";
  updateActionStates();
}

function updateActionStates(): void {
  const hasSessions = sessions.length > 0;
  const canComputeConflicts = hasSessions && !isUploadProcessing;
  const canUseConflictControls = hasComputedConflicts && !isConflictComputing && !isUploadProcessing;
  const isBusy = isUploadProcessing || isConflictComputing || isHolidayLoading;
  const advancedMode = staffingMode === "advanced";
  const canDownloadHrd = hasSessions && !isUploadProcessing;

  fileInput.disabled = isUploadProcessing;
  cohortSelect.disabled = !hasSessions || isUploadProcessing;
  downloadButton.disabled = !canDownloadHrd;

  computeConflictsButton.disabled = !canComputeConflicts || isConflictComputing;
  keySearchInput.disabled = !canUseConflictControls;
  downloadTimeConflictsButton.disabled = !canUseConflictControls || visibleConflicts.length === 0;
  downloadInstructorDayConflictsButton.disabled = isBusy || visibleInstructorDayOverlaps.length === 0;
  downloadFoDayConflictsButton.disabled = isBusy || visibleFoDayOverlaps.length === 0;

  generateScheduleButton.disabled = isBusy;
  addHolidayButton.disabled = isBusy;
  loadPublicHolidaysButton.disabled = isBusy;
  clearHolidaysButton.disabled = isBusy;
  dedupeHolidaysButton.disabled = isBusy;
  addCustomBreakButton.disabled = isBusy;
  scheduleTemplateSelect.disabled = isBusy;
  scheduleTemplateNameInput.disabled = isBusy;
  loadScheduleTemplateButton.disabled = isBusy || scheduleTemplates.length === 0;
  saveScheduleTemplateButton.disabled = isBusy;
  if (isBusy) {
    deleteScheduleTemplateButton.disabled = true;
  } else {
    const selectedTemplate = findScheduleTemplate(scheduleTemplates, scheduleTemplateSelect.value);
    deleteScheduleTemplateButton.disabled = Boolean(selectedTemplate?.builtIn) || scheduleTemplates.length === 0;
  }

  staffAutoFillButton.disabled = isBusy || staffingCohortRanges.length === 0 || !advancedMode;
  staffRefreshButton.disabled = isBusy || !advancedMode;
  const strictCheck = staffExportModeSelect.value === "v7e_strict" ? isV7eStrictReady() : { ok: true };
  const strictReady = strictCheck.ok;
  staffExportCsvButton.disabled = isBusy || staffingCohortRanges.length === 0 || !strictReady || !advancedMode;
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
  restorePreviousStateButton.disabled = isBusy || previousStateBeforeSampleLoad === null;
  upsertCourseButton.disabled = isBusy;
  upsertInstructorButton.disabled = isBusy;
  upsertSubjectButton.disabled = isBusy;
  applySubjectMappingsButton.disabled = isBusy || sessions.length === 0;

  const canAppendSchedule =
    generatedScheduleResult !== null &&
    generatedScheduleResult.days.length > 0 &&
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
  const summary = summaries.find((item) => item.과정기수 === cohort);

  if (!summary) {
  cohortInfo.textContent = "기간:  ~  / 훈련일수: 0 / 수업시간표 건수: 0";
    hrdValidationErrors = [];
    hrdValidationWarnings = [];
    renderHrdValidationErrors();
    updateActionStates();
    return;
  }

  cohortInfo.textContent = `기간: ${summary.시작일} ~ ${summary.종료일} / 훈련일수: ${summary.훈련일수} / 수업시간표 건수: ${summary.세션수}`;
  refreshHrdValidation();
  scheduleAutoSave();
}

function appendTimelineNotice(message: string): void {
  const notice = document.createElement("div");
  notice.className = "muted";
  notice.textContent = message;
  notice.style.marginBottom = "6px";
  timelineList.appendChild(notice);
}

function formatShortDateFromCompact(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(4, 6)}/${value.slice(6, 8)}`;
}

function formatShortDateFromIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return `${value.slice(5, 7)}/${value.slice(8, 10)}`;
}

type MonthAxisItem = {
  key: string;
  label: string;
  leftPercent: number;
};

function getReadableTextColorFromCssColor(value: string | undefined): string {
  if (!value) {
    return "#ffffff";
  }
  const match = value.match(/#([0-9a-fA-F]{6})/);
  if (!match) {
    return "#ffffff";
  }
  const hex = match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.65 ? "#0f172a" : "#ffffff";
}

function buildMonthAxis(globalStart: number, globalEnd: number): MonthAxisItem[] {
  const span = Math.max(globalEnd - globalStart, 1);
  const axis: MonthAxisItem[] = [];
  const startDate = new Date(globalStart);
  const endDate = new Date(globalEnd);
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

  while (cursor.getTime() <= endDate.getTime()) {
    const leftPercent = ((cursor.getTime() - globalStart) / span) * 100;
    const safeLeft = Math.max(0, Math.min(100, leftPercent));
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    axis.push({
      key: `${year}-${month}`,
      label: `${year}-${month}`,
      leftPercent: safeLeft
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return axis;
}

function renderTimelineMonthAxis(globalStart: number, globalEnd: number): MonthAxisItem[] {
  const axis = buildMonthAxis(globalStart, globalEnd);
  if (axis.length === 0) {
    return axis;
  }

  const axisWrap = document.createElement("div");
  axisWrap.className = "timeline-axis";

  const line = document.createElement("div");
  line.className = "timeline-axis-line";
  axisWrap.appendChild(line);

  for (const item of axis) {
    const tick = document.createElement("div");
    tick.className = "timeline-axis-tick";
    tick.style.left = `${item.leftPercent}%`;
    tick.textContent = item.label;
    axisWrap.appendChild(tick);
  }

  timelineList.appendChild(axisWrap);
  return axis;
}

function buildCohortTimelineItems(): Array<{ summary: CohortSummary; startDate: Date; endDate: Date }> {
  return summaries
    .map((summary) => ({
      summary,
      startDate: parseCompactDate(summary.시작일),
      endDate: parseCompactDate(summary.종료일)
    }))
    .filter(
      (item): item is { summary: CohortSummary; startDate: Date; endDate: Date } =>
        item.startDate !== null && item.endDate !== null
    )
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

function appendTimelineBarRow(params: {
  label: string;
  startDate: Date;
  endDate: Date;
  globalStart: number;
  globalEnd: number;
  title: string;
  barText?: string;
  barDateText?: string;
  barColor?: string;
  badgeText?: string;
  onBadgeClick?: () => void;
  onBarClick?: () => void;
  monthAxis?: MonthAxisItem[];
}): void {
  const span = Math.max(params.globalEnd - params.globalStart, 1);
  const startMs = params.startDate.getTime();
  const endMs = params.endDate.getTime();

  const leftPercent = ((startMs - params.globalStart) / span) * 100;
  const widthPercent = params.globalEnd === params.globalStart ? 100 : Math.max(((endMs - startMs) / span) * 100, 1.2);
  const safeLeft = Math.max(0, Math.min(100, leftPercent));
  const safeWidth = Math.max(0, Math.min(100 - safeLeft, widthPercent));

  const row = document.createElement("div");
  row.className = "timeline-row";

  const label = document.createElement("div");
  label.className = "timeline-label";
  const text = document.createElement("span");
  text.textContent = params.label;
  label.appendChild(text);

  if (params.badgeText && params.onBadgeClick) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "timeline-cohort-filter";
    badge.textContent = params.badgeText;
    badge.addEventListener("click", params.onBadgeClick);
    label.appendChild(badge);
  }

  const track = document.createElement("div");
  track.className = "timeline-track";
  if (params.monthAxis) {
    for (const month of params.monthAxis) {
      const line = document.createElement("span");
      line.className = "timeline-month-line";
      line.style.left = `${month.leftPercent}%`;
      track.appendChild(line);
    }
  }
  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = "timeline-bar";
  bar.style.left = `${safeLeft}%`;
  bar.style.width = `${safeWidth}%`;
  if (params.barColor) {
    bar.style.background = params.barColor;
  }
  bar.style.color = getReadableTextColorFromCssColor(params.barColor);

  const barMain = document.createElement("span");
  barMain.className = "timeline-bar-main";
  barMain.textContent = params.barText ?? "";
  bar.appendChild(barMain);

  if (params.barDateText) {
    const datePill = document.createElement("span");
    datePill.className = "timeline-date-pill";
    datePill.textContent = params.barDateText;
    bar.appendChild(datePill);
  }
  bar.title = params.title;
  if (params.onBarClick) {
    bar.addEventListener("click", params.onBarClick);
  }

  track.appendChild(bar);
  row.appendChild(label);
  row.appendChild(track);
  timelineList.appendChild(row);
}

function renderCohortTimelineView(
  items: Array<{ summary: CohortSummary; startDate: Date; endDate: Date }>,
  cohortNotificationMap: Map<string, { warning: number; error: number }>,
  cohortInstructorMetaMap: ReturnType<typeof buildCohortInstructorMetaMap>
): void {
  const limited = items.slice(0, TIMELINE_RENDER_LIMIT);
  if (items.length > limited.length) {
    appendTimelineNotice(`기수 ${items.length}건 중 상위 ${limited.length}건만 표시합니다.`);
  }

  const globalStart = limited.reduce((min, item) => Math.min(min, item.startDate.getTime()), Number.POSITIVE_INFINITY);
  const globalEnd = limited.reduce((max, item) => Math.max(max, item.endDate.getTime()), Number.NEGATIVE_INFINITY);
  const monthAxis = renderTimelineMonthAxis(globalStart, globalEnd);

  for (const item of limited) {
    const counts = cohortNotificationMap.get(item.summary.과정기수) ?? { warning: 0, error: 0 };
    const badgeText = counts.warning + counts.error > 0 ? `⚠ ${counts.warning} · ❗ ${counts.error}` : undefined;
    const instructorMeta = cohortInstructorMetaMap.get(item.summary.과정기수);
    const instructorText = instructorMeta?.instructorLabel ?? "강사: 미지정";
    const instructorTooltip = instructorMeta?.instructorTooltip ?? "강사 정보 없음";

    appendTimelineBarRow({
      label: item.summary.과정기수,
      startDate: item.startDate,
      endDate: item.endDate,
      globalStart,
      globalEnd,
      title: `시작일: ${formatCompactDate(item.summary.시작일)}\n종료일: ${formatCompactDate(item.summary.종료일)}\n훈련일수: ${item.summary.훈련일수}\n수업시간표 건수: ${item.summary.세션수}\n${instructorText}\n전체 강사: ${instructorTooltip}`,
      barText: `${formatShortDateFromCompact(item.summary.시작일)} -> ${formatShortDateFromCompact(item.summary.종료일)}`,
      barDateText: `${formatShortDateFromCompact(item.summary.시작일)} -> ${formatShortDateFromCompact(item.summary.종료일)}`,
      barColor: instructorMeta?.barColor,
      monthAxis,
      badgeText,
      onBadgeClick: () => {
        setNotificationFocus({ cohort: item.summary.과정기수 });
        openDrawer("notification");
        renderNotificationCenter();
      },
      onBarClick: () => {
        setNotificationFocus({ cohort: item.summary.과정기수 });
        openDrawer("notification");
        renderNotificationCenter();
      }
    });
  }

  timelineRange.textContent = `기간: ${formatDate(new Date(globalStart))} ~ ${formatDate(new Date(globalEnd))}`;
}

function renderCourseGroupedTimelineView(
  items: Array<{ summary: CohortSummary; startDate: Date; endDate: Date }>,
  cohortNotificationMap: Map<string, { warning: number; error: number }>,
  cohortInstructorMetaMap: ReturnType<typeof buildCohortInstructorMetaMap>
): void {
  const groupMap = new Map<string, Array<{ summary: CohortSummary; startDate: Date; endDate: Date; cohortLabel: string }>>();
  for (const item of items) {
    const parsed = parseCourseGroupFromCohortName(item.summary.과정기수);
    const list = groupMap.get(parsed.course) ?? [];
    list.push({ ...item, cohortLabel: parsed.cohortLabel });
    groupMap.set(parsed.course, list);
  }

  const groupNames = Array.from(groupMap.keys()).sort((a, b) => a.localeCompare(b));
  let renderedCount = 0;

  for (const groupName of groupNames) {
    const rows = (groupMap.get(groupName) ?? []).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    if (rows.length === 0) {
      continue;
    }

    const groupCard = document.createElement("div");
    groupCard.className = "timeline-group";

    const header = document.createElement("div");
    header.className = "timeline-group-header";

    const title = document.createElement("strong");
    title.textContent = groupName;
    header.appendChild(title);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small-btn";
    const collapsed = collapsedCourseGroups.has(groupName);
    toggle.textContent = collapsed ? "펼치기" : "접기";
    header.appendChild(toggle);
    groupCard.appendChild(header);

    const container = document.createElement("div");
    container.style.display = collapsed ? "none" : "block";
    groupCard.appendChild(container);

    toggle.addEventListener("click", () => {
      const isCollapsed = collapsedCourseGroups.has(groupName);
      if (isCollapsed) {
        collapsedCourseGroups.delete(groupName);
      } else {
        collapsedCourseGroups.add(groupName);
      }
      renderTimeline();
    });

    timelineList.appendChild(groupCard);

    if (collapsed) {
      continue;
    }

    const maxRenderCount = TIMELINE_RENDER_LIMIT - renderedCount;
    const limitedRows = rows.slice(0, Math.max(0, maxRenderCount));
    renderedCount += limitedRows.length;

    if (limitedRows.length === 0) {
      continue;
    }

    const groupStart = limitedRows.reduce((min, item) => Math.min(min, item.startDate.getTime()), Number.POSITIVE_INFINITY);
    const groupEnd = limitedRows.reduce((max, item) => Math.max(max, item.endDate.getTime()), Number.NEGATIVE_INFINITY);
    const monthAxis = buildMonthAxis(groupStart, groupEnd);

    for (const item of limitedRows) {
      const rowHost = document.createElement("div");
      rowHost.className = "timeline-row";

      const label = document.createElement("div");
      label.className = "timeline-label";
      label.textContent = `${item.cohortLabel}`;
      rowHost.appendChild(label);

      const track = document.createElement("div");
      track.className = "timeline-track";
      for (const month of monthAxis) {
        const line = document.createElement("span");
        line.className = "timeline-month-line";
        line.style.left = `${month.leftPercent}%`;
        track.appendChild(line);
      }
      const bar = document.createElement("button");
      bar.type = "button";
      bar.className = "timeline-bar";
      const span = Math.max(groupEnd - groupStart, 1);
      const left = ((item.startDate.getTime() - groupStart) / span) * 100;
      const width = groupEnd === groupStart ? 100 : Math.max(((item.endDate.getTime() - item.startDate.getTime()) / span) * 100, 1.2);
      const safeLeft = Math.max(0, Math.min(100, left));
      const safeWidth = Math.max(0, Math.min(100 - safeLeft, width));
      bar.style.left = `${safeLeft}%`;
      bar.style.width = `${safeWidth}%`;
      const instructorMeta = cohortInstructorMetaMap.get(item.summary.과정기수);
      const instructorText = instructorMeta?.instructorLabel ?? "강사: 미지정";
      const instructorTooltip = instructorMeta?.instructorTooltip ?? "강사 정보 없음";
      if (instructorMeta?.barColor) {
        bar.style.background = instructorMeta.barColor;
      }
      bar.style.color = getReadableTextColorFromCssColor(instructorMeta?.barColor);
      const barMain = document.createElement("span");
      barMain.className = "timeline-bar-main";
      barMain.textContent = `${item.cohortLabel}`;
      bar.appendChild(barMain);

      const datePill = document.createElement("span");
      datePill.className = "timeline-date-pill";
      datePill.textContent = `${formatShortDateFromCompact(item.summary.시작일)} -> ${formatShortDateFromCompact(item.summary.종료일)}`;
      bar.appendChild(datePill);
      bar.title = `${groupName} / ${item.summary.과정기수}\n${instructorText}\n전체 강사: ${instructorTooltip}`;
      bar.addEventListener("click", () => {
        setNotificationFocus({ cohort: item.summary.과정기수 });
        openDrawer("notification");
        renderNotificationCenter();
      });
      track.appendChild(bar);
      rowHost.appendChild(track);

      const counts = cohortNotificationMap.get(item.summary.과정기수) ?? { warning: 0, error: 0 };
      if (counts.warning + counts.error > 0) {
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = "timeline-cohort-filter";
        badge.textContent = `⚠ ${counts.warning} · ❗ ${counts.error}`;
        badge.addEventListener("click", () => {
          setNotificationFocus({ cohort: item.summary.과정기수 });
          openDrawer("notification");
          renderNotificationCenter();
        });
        label.appendChild(badge);
      }

      container.appendChild(rowHost);
    }

    if (renderedCount >= TIMELINE_RENDER_LIMIT) {
      appendTimelineNotice(`렌더 안전을 위해 상위 ${TIMELINE_RENDER_LIMIT}개 항목까지만 표시합니다.`);
      break;
    }
  }

  const globalStart = items.reduce((min, item) => Math.min(min, item.startDate.getTime()), Number.POSITIVE_INFINITY);
  const globalEnd = items.reduce((max, item) => Math.max(max, item.endDate.getTime()), Number.NEGATIVE_INFINITY);
  timelineRange.textContent = `기간: ${formatDate(new Date(globalStart))} ~ ${formatDate(new Date(globalEnd))}`;
}

function getSessionIsoDate(session: Session): string | null {
  if (session.normalizedDate && parseIsoDate(session.normalizedDate)) {
    return session.normalizedDate;
  }

  const parsed = parseCompactDate(session.훈련일자);
  if (!parsed) {
    return null;
  }
  return formatDate(parsed);
}

function renderAssigneeTimelineView(): void {
  type AssigneeRow = {
    key: string;
    startDate: string;
    endDate: string;
    count: number;
    conflictCount: number;
    conflictComputed: boolean;
  };
  const rows: AssigneeRow[] = [];

  if (assigneeTimelineKind === "INSTRUCTOR") {
    const byInstructor = new Map<string, { startDate: string; endDate: string; count: number }>();
    for (const session of sessions) {
      const instructor = normalizeInstructorCode(session.훈련강사코드);
      const iso = getSessionIsoDate(session);
      if (!instructor || !iso) {
        continue;
      }
      const prev = byInstructor.get(instructor);
      if (!prev) {
        byInstructor.set(instructor, { startDate: iso, endDate: iso, count: 1 });
        continue;
      }
      prev.startDate = prev.startDate < iso ? prev.startDate : iso;
      prev.endDate = prev.endDate > iso ? prev.endDate : iso;
      prev.count += 1;
    }

    const conflictMap = new Map<string, number>();
    for (const conflict of allConflicts) {
      const key = normalizeInstructorCode(conflict.키);
      if (!key) {
        continue;
      }
      conflictMap.set(key, (conflictMap.get(key) ?? 0) + 1);
    }

    for (const [key, value] of byInstructor.entries()) {
      rows.push({
        key,
        startDate: value.startDate,
        endDate: value.endDate,
        count: value.count,
        conflictCount: conflictMap.get(key) ?? 0,
        conflictComputed: hasComputedConflicts
      });
    }
  } else {
    const byAssignee = new Map<string, { startDate: string; endDate: string; count: number }>();
    for (const assignment of staffingAssignments) {
      const assignee = assignment.assignee.trim();
      if (!assignee || !parseIsoDate(assignment.startDate) || !parseIsoDate(assignment.endDate)) {
        continue;
      }
      const prev = byAssignee.get(assignee);
      if (!prev) {
        byAssignee.set(assignee, { startDate: assignment.startDate, endDate: assignment.endDate, count: 1 });
        continue;
      }
      prev.startDate = prev.startDate < assignment.startDate ? prev.startDate : assignment.startDate;
      prev.endDate = prev.endDate > assignment.endDate ? prev.endDate : assignment.endDate;
      prev.count += 1;
    }

    const overlapMap = new Map<string, number>();
    for (const overlap of [...instructorDayOverlaps, ...facilitatorOperationOverlaps]) {
      const assignee = overlap.assignee.trim();
      if (!assignee) {
        continue;
      }
      overlapMap.set(assignee, (overlapMap.get(assignee) ?? 0) + 1);
    }

    for (const [key, value] of byAssignee.entries()) {
      rows.push({
        key,
        startDate: value.startDate,
        endDate: value.endDate,
        count: value.count,
        conflictCount: overlapMap.get(key) ?? 0,
        conflictComputed: true
      });
    }
  }

  rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.key.localeCompare(b.key));
  const limited = rows.slice(0, TIMELINE_RENDER_LIMIT);
  if (rows.length > limited.length) {
    appendTimelineNotice(`담당 항목 ${rows.length}건 중 상위 ${limited.length}건만 표시합니다.`);
  }

  if (limited.length === 0) {
    timelineRange.textContent = "기간: -";
    timelineEmpty.style.display = "block";
    timelineEmpty.textContent = assigneeTimelineKind === "INSTRUCTOR" ? "강사 기준 데이터가 없습니다." : "담당자 기준 데이터가 없습니다.";
    return;
  }

  timelineEmpty.style.display = "none";
  timelineEmpty.textContent = "수업시간표를 불러오면 타임라인이 생성됩니다.";

  const globalStart = limited.reduce((min, item) => Math.min(min, parseIsoDate(item.startDate)?.getTime() ?? min), Number.POSITIVE_INFINITY);
  const globalEnd = limited.reduce((max, item) => Math.max(max, parseIsoDate(item.endDate)?.getTime() ?? max), Number.NEGATIVE_INFINITY);
  const monthAxis = renderTimelineMonthAxis(globalStart, globalEnd);

  for (const row of limited) {
    const startDate = parseIsoDate(row.startDate);
    const endDate = parseIsoDate(row.endDate);
    if (!startDate || !endDate) {
      continue;
    }

    appendTimelineBarRow({
      label: row.key,
      startDate,
      endDate,
      globalStart,
      globalEnd,
      title: `${row.key}\n시작: ${row.startDate}\n종료: ${row.endDate}\n대상 건수: ${row.count}`,
      barText: row.key,
      barDateText: `${formatShortDateFromIso(row.startDate)} -> ${formatShortDateFromIso(row.endDate)}`,
      monthAxis,
      badgeText: !row.conflictComputed ? "미계산" : row.conflictCount > 0 ? `❗ ${row.conflictCount}` : undefined,
      onBadgeClick: () => {
        setNotificationFocus({ assignee: row.key });
        openDrawer("notification");
        renderNotificationCenter();
      },
      onBarClick: () => {
        setNotificationFocus({ assignee: row.key });
        openDrawer("notification");
        renderNotificationCenter();
      }
    });
  }

  timelineRange.textContent = `기간: ${formatDate(new Date(globalStart))} ~ ${formatDate(new Date(globalEnd))}`;
}

function renderWeekGridView(): void {
  const start = startOfWeekIso(weekGridStartDate);
  weekGridStartDate = start;

  const dayNames = ["월", "화", "수", "목", "금", "토", "일"];
  const days = Array.from({ length: 7 }, (_, index) => addDaysToIso(start, index));
  weekLabel.textContent = `${days[0]} ~ ${days[6]}`;
  timelineRange.textContent = `기간: ${days[0]} ~ ${days[6]}`;

  const grid = document.createElement("div");
  grid.className = "timeline-grid";

  for (const [index, day] of days.entries()) {
    const sessionsOnDay = sessions.filter((session) => getSessionIsoDate(session) === day);
    const cell = document.createElement("div");
    cell.className = "timeline-grid-cell";
    if (sessionsOnDay.length > 0) {
      cell.classList.add("has-class");
    }
    if (holidayDates.includes(day) || customBreakDates.includes(day)) {
      cell.classList.add("holiday");
      const holidayName = holidayNameByDate.get(day);
      const dayType = holidayName ? `공휴일: ${holidayName}` : customBreakDates.includes(day) ? "자체휴강" : "공휴일";
      cell.title = `${day} ${dayType}`;
    }

    const title = document.createElement("div");
    title.className = "timeline-grid-title";
    title.textContent = `${dayNames[index]} ${day}`;
    cell.appendChild(title);

    const body = document.createElement("div");
    body.textContent = sessionsOnDay.length > 0 ? `수업 ${sessionsOnDay.length}건` : "수업 없음";
    cell.appendChild(body);

    cell.addEventListener("click", () => {
      const details = sessionsOnDay.map(
        (session) => `${session.과정기수} / ${session["교과목(및 능력단위)코드"]} / ${formatHHMM(session.훈련시작시간)}-${formatHHMM(session.훈련종료시간)}`
      );
      renderTimelineDetail(`${day} 수업시간표`, details);
      if (sessionsOnDay.length > 0) {
        setNotificationFocus({ date: toCompactDateFromIso(day) });
      }
    });

    grid.appendChild(cell);
  }

  timelineList.appendChild(grid);
}

function renderMonthCalendarView(): void {
  const parsedMonth = monthCalendarCursor.match(/^(\d{4})-(\d{2})$/);
  if (!parsedMonth) {
    monthCalendarCursor = getTodayIsoDate().slice(0, 7);
  }
  const [year, month] = monthCalendarCursor.split("-").map((value) => Number.parseInt(value, 10));
  const first = new Date(Date.UTC(year, (month || 1) - 1, 1));
  const monthLabelText = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}`;
  monthCalendarCursor = monthLabelText;
  monthLabel.textContent = monthLabelText;

  const firstIso = formatDate(first);
  const start = startOfWeekIso(firstIso);
  const weekdayHeader = document.createElement("div");
  weekdayHeader.className = "timeline-weekday-header";
  const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
  for (const [index, labelText] of weekdayLabels.entries()) {
    const cell = document.createElement("div");
    cell.className = `timeline-weekday-cell${index >= 5 ? " weekend" : ""}`;
    cell.textContent = labelText;
    weekdayHeader.appendChild(cell);
  }
  timelineList.appendChild(weekdayHeader);

  const grid = document.createElement("div");
  grid.className = "timeline-grid";

  for (let i = 0; i < 42; i += 1) {
    const day = addDaysToIso(start, i);
    const sessionsOnDay = sessions.filter((session) => getSessionIsoDate(session) === day);
    const inCurrentMonth = day.slice(0, 7) === monthCalendarCursor;
    const dayOfWeek = parseIsoDate(day)?.getUTCDay() ?? 1;

    const cell = document.createElement("div");
    cell.className = "timeline-grid-cell";
    if (sessionsOnDay.length > 0) {
      cell.classList.add("has-class");
    }
    if (holidayDates.includes(day) || customBreakDates.includes(day)) {
      cell.classList.add("holiday");
      const holidayName = holidayNameByDate.get(day);
      const dayType = holidayName ? `공휴일: ${holidayName}` : customBreakDates.includes(day) ? "자체휴강" : "공휴일";
      cell.title = `${day} ${dayType}`;
    }
    if (!inCurrentMonth) {
      cell.style.opacity = "0.55";
    }
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      cell.classList.add("weekend");
    }
    if (day === getTodayIsoDate()) {
      cell.classList.add("today");
    }

    const title = document.createElement("div");
    title.className = "timeline-grid-title";
    title.textContent = day;
    const holidayName = holidayNameByDate.get(day);
    if (holidayName) {
      const holidayBadge = document.createElement("span");
      holidayBadge.className = "holiday-name-badge";
      holidayBadge.textContent = holidayName;
      holidayBadge.title = holidayName;
      title.appendChild(holidayBadge);
    }
    cell.appendChild(title);

    const body = document.createElement("div");
    body.textContent = sessionsOnDay.length > 0 ? `수업 ${sessionsOnDay.length}건` : "-";
    cell.appendChild(body);

    cell.addEventListener("click", () => {
      const details = sessionsOnDay.map(
        (session) => `${session.과정기수} / ${session["교과목(및 능력단위)코드"]} / ${formatHHMM(session.훈련시작시간)}-${formatHHMM(session.훈련종료시간)}`
      );
      renderTimelineDetail(`${day} 요약`, details);
      if (sessionsOnDay.length > 0) {
        setNotificationFocus({ date: toCompactDateFromIso(day) });
      }
    });

    grid.appendChild(cell);
  }

  timelineRange.textContent = `월: ${monthCalendarCursor}`;
  timelineList.appendChild(grid);
}

function renderTimeline(): void {
  timelineList.innerHTML = "";
  const cohortNotificationMap = getCohortNotificationCountMap(refreshNotificationItems());
  const cohortInstructorMetaMap = buildCohortInstructorMetaMap(sessions);
  const timelineItems = buildCohortTimelineItems();

  timelineDetailPanel.style.display = "none";
  timelineDetailPanel.textContent = "";

  if (timelineItems.length === 0 && (timelineViewType === "COHORT_TIMELINE" || timelineViewType === "COURSE_GROUPED")) {
    timelineRange.textContent = "기간: -";
    timelineEmpty.style.display = "block";
    return;
  }

  timelineEmpty.style.display = "none";
  timelineEmpty.textContent = "수업시간표를 불러오면 타임라인이 생성됩니다.";

  if (timelineViewType === "COHORT_TIMELINE") {
    renderCohortTimelineView(timelineItems, cohortNotificationMap, cohortInstructorMetaMap);
    return;
  }

  if (timelineViewType === "COURSE_GROUPED") {
    renderCourseGroupedTimelineView(timelineItems, cohortNotificationMap, cohortInstructorMetaMap);
    return;
  }

  if (timelineViewType === "ASSIGNEE_TIMELINE") {
    renderAssigneeTimelineView();
    return;
  }

  if (timelineViewType === "WEEK_GRID") {
    renderWeekGridView();
    return;
  }

  renderMonthCalendarView();
}

function renderErrors(): void {
  errorCount.textContent = `총 ${parseErrors.length}건`;
  errorList.innerHTML = "";

  if (parseErrors.length === 0) {
    errorEmpty.style.display = "block";
    return;
  }

  errorEmpty.style.display = "none";

  const topErrors = parseErrors.slice(0, 10);
  for (const item of topErrors) {
    const li = document.createElement("li");
    li.textContent = `[행 ${item.rowIndex}] ${item.message}`;
    errorList.appendChild(li);
  }
}

function renderHrdValidationErrors(): void {
  hrdValidationList.innerHTML = "";

  if (hrdValidationErrors.length === 0 && hrdValidationWarnings.length === 0) {
    hrdValidationPanel.style.display = "none";
    return;
  }

  hrdValidationPanel.style.display = "block";

  for (const message of hrdValidationErrors) {
    const li = document.createElement("li");
    li.textContent = `[ERROR] ${message}`;
    hrdValidationList.appendChild(li);
  }

  for (const message of hrdValidationWarnings) {
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
  const hasStandardizedData = sessions.length > 0 || (generatedScheduleResult?.days.length ?? 0) > 0;
  standardizeStatus.style.display = hasStandardizedData ? "block" : "none";
}

function renderStateMigrationWarnings(): void {
  stateMigrationList.innerHTML = "";

  if (stateMigrationWarnings.length === 0) {
    stateMigrationBanner.style.display = "none";
    return;
  }

  stateMigrationBanner.style.display = "block";

  for (const warning of stateMigrationWarnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    stateMigrationList.appendChild(li);
  }
}

function setStateMigrationWarnings(warnings: string[]): void {
  stateMigrationWarnings = [...warnings];
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
  previousStateBeforeSampleLoad = serializeProjectState();

  const response = await fetch(`samples/${fileName}`);
  if (!response.ok) {
    throw new Error(`샘플 파일을 불러오지 못했습니다. (${response.status})`);
  }

  const sampleState = (await response.json()) as unknown;
  applyLoadedProjectState(sampleState);
  restorePreviousStateButton.disabled = previousStateBeforeSampleLoad === null;
  setDemoSampleBanner(`샘플 로드됨: ${fileName}`);
  scheduleAutoSave();
}

function restoreStateBeforeSampleLoad(): void {
  if (!previousStateBeforeSampleLoad) {
    return;
  }

  applyLoadedProjectState(previousStateBeforeSampleLoad);
  previousStateBeforeSampleLoad = null;
  restorePreviousStateButton.disabled = true;
  setDemoSampleBanner("샘플 적용 전 상태로 복원했습니다.");
  scheduleAutoSave();
}

function validateHrdExportForCohortWithWarnings(cohort: string): { errors: string[]; warnings: string[] } {
  const subjectCodes = new Set(subjectDirectory.map((item) => item.subjectCode));
  return validateHrdExportForCohortDetailed(sessions, cohort, holidayDates, holidayNameByDate, subjectCodes);
}

function refreshHrdValidation(): void {
  const cohort = cohortSelect.value;
  const validation = cohort
    ? validateHrdExportForCohortWithWarnings(cohort)
    : { errors: [], warnings: [] };
  hrdValidationErrors = validation.errors;
  hrdValidationWarnings = validation.warnings;
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
    (staffingCohortRanges.length === 0 ||
      staffingCohortRanges.every((range) => isTrackType(range.trackType) && getPolicyForTrack(range.trackType).length > 0));

  const items: Array<{ label: string; ok: boolean; warn?: boolean }> = [
    {
      label: `HRD CSV 다운로드 검증 ${hrdPass ? "통과" : "미통과"}`,
      ok: hrdPass,
      warn: true
    },
    {
      label: hasComputedConflicts
        ? `강사 시간 충돌 ${allConflicts.length === 0 ? "0건" : `${allConflicts.length}건`}`
        : "강사 시간 충돌 미계산",
      ok: hasComputedConflicts && allConflicts.length === 0,
      warn: true
    },
    {
      label: `강사 배치(일) 충돌 ${instructorDayOverlaps.length === 0 ? "0건" : `${instructorDayOverlaps.length}건`}`,
      ok: instructorDayOverlaps.length === 0,
      warn: staffingAssignments.length > 0
    },
    {
      label: `퍼실/운영 배치(일) 충돌 ${facilitatorOperationOverlaps.length === 0 ? "0건" : `${facilitatorOperationOverlaps.length}건`}`,
      ok: facilitatorOperationOverlaps.length === 0,
      warn: staffingAssignments.length > 0
    },
    {
      label: `공휴일 자동 로드 ${hasLoadedPublicHoliday ? "적용" : "미적용"}`,
      ok: hasLoadedPublicHoliday,
      warn: true
    },
    {
      label: `trackType 설정 ${trackTypeComplete ? "완료" : "누락"}`,
      ok: trackTypeComplete,
      warn: staffingCohortRanges.length > 0
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

function renderTimeConflicts(): void {
  confTableBody.innerHTML = "";

  if (!hasComputedConflicts) {
    confCount.textContent = "계산 대기";
    confRenderNotice.textContent = "";
    return;
  }

  confCount.textContent = `총 ${visibleConflicts.length}건`;

  const preview = visibleConflicts.slice(0, TABLE_RENDER_LIMIT);
  setRenderNotice(confRenderNotice, visibleConflicts.length, preview.length);

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
        tr.appendChild(createClickableCell(value, () => highlightGanttByCohortModule(conflict.과정A)));
        continue;
      }
      if (index === 6) {
        tr.appendChild(createClickableCell(value, () => highlightGanttByCohortModule(conflict.과정B)));
        continue;
      }

      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    confTableBody.appendChild(tr);
  }
}

function applyConflictFilters(): void {
  if (!hasComputedConflicts) {
    visibleConflicts = [];
    renderTimeConflicts();
    updateActionStates();
    return;
  }

  const keyQuery = keySearchInput.value.trim().toLowerCase();

  visibleConflicts = allConflicts
    .filter((conflict) => (keyQuery.length === 0 ? true : conflict.키.toLowerCase().includes(keyQuery)))
    .sort(
      (a, b) =>
        a.일자.localeCompare(b.일자) ||
        a.기준.localeCompare(b.기준) ||
        a.키.localeCompare(b.키) ||
        a.과정A.localeCompare(b.과정A)
    );

  renderTimeConflicts();
  updateActionStates();
}

function resetConflictsBeforeCompute(): void {
  allConflicts = [];
  visibleConflicts = [];
  hasComputedConflicts = false;

  keySearchInput.value = "";
  renderTimeConflicts();
  updateActionStates();
}

async function computeConflicts(): Promise<void> {
  if (sessions.length === 0 || isConflictComputing) {
    return;
  }

  isConflictComputing = true;
  computeConflictsButton.textContent = "계산중...";
  confCount.textContent = "계산중...";
  updateActionStates();

  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), 0);
  });

  if (sessions.length >= 10000) {
    console.warn(`[conflict-calc] 세션 수가 많습니다: ${sessions.length}건`);
  }

  console.time("conflict-calc");
  try {
    allConflicts = detectConflicts(sessions, { resourceTypes: ["INSTRUCTOR"] });
    hasComputedConflicts = true;
  } finally {
    console.timeEnd("conflict-calc");
  }

  isConflictComputing = false;
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
  hrdValidationErrors = validation.errors;
  hrdValidationWarnings = validation.warnings;
  renderHrdValidationErrors();
  if (validation.errors.length > 0) {
    updateActionStates();
    return;
  }

  const generatedDays =
    cohort === generatedScheduleCohort && generatedScheduleResult ? generatedScheduleResult.days : undefined;
  const { csv, rowWarning } = exportHrdCsvForCohort(sessions, cohort, { generatedDays });
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

function downloadVisibleTimeConflictsCsv(): void {
  if (visibleConflicts.length === 0) {
    return;
  }

  const rows = visibleConflicts.map((conflict) => [
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

function downloadVisibleInstructorDayConflictsCsv(): void {
  if (visibleInstructorDayOverlaps.length === 0) {
    return;
  }

  const rows = visibleInstructorDayOverlaps.map((overlap) => toDayConflictRow(overlap));
  downloadCsvFile(`conflicts_instructor_day_${getTodayCompactDate()}.csv`, DAY_CONFLICT_COLUMNS, rows);
}

function downloadVisibleFoDayConflictsCsv(): void {
  if (visibleFoDayOverlaps.length === 0) {
    return;
  }

  const rows = visibleFoDayOverlaps.map((overlap) => toDayConflictRow(overlap));
  downloadCsvFile(`conflicts_facil_ops_day_${getTodayCompactDate()}.csv`, DAY_CONFLICT_COLUMNS, rows);
}

function renderConflictDetailModalContent(): void {
  conflictDetailContent.innerHTML = "";
  conflictDetailTitle.textContent = "충돌 상세";

  const sections: Array<{ label: string; columns: readonly string[]; rows: string[][] }> = [
    {
      label: "강사 시간 충돌",
      columns: CONFLICT_COLUMNS,
      rows: allConflicts.map((conflict) => [
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
      rows: instructorDayOverlaps.map((overlap) => toDayConflictRow(overlap))
    },
    {
      label: "퍼실/운영 배치(일) 충돌",
      columns: DAY_CONFLICT_COLUMNS,
      rows: facilitatorOperationOverlaps.map((overlap) => toDayConflictRow(overlap))
    }
  ];

  const hasAnyConflict = sections.some((section) => section.rows.length > 0);
  if (!hasAnyConflict) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "현재 감지된 충돌 상세가 없습니다.";
    conflictDetailContent.appendChild(empty);
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
      conflictDetailContent.appendChild(wrap);
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

    conflictDetailContent.appendChild(wrap);
  }
}

function openConflictDetailModal(): void {
  renderConflictDetailModalContent();
  if (!conflictDetailModal.open) {
    conflictDetailModal.showModal();
  }
}

function closeConflictDetailModal(): void {
  if (conflictDetailModal.open) {
    conflictDetailModal.close();
  }
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

function createTableElement(columns: readonly string[], rows: string[][]): HTMLTableElement {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return table;
}

function buildPrintReport(): void {
  printReportMeta.textContent = `생성시각: ${new Date().toLocaleString()} / 선택 탭: ${getConflictTabLabel(activeConflictTab)}`;
  printCohortGantt.innerHTML = staffCohortGantt.innerHTML;
  printAssigneeGantt.innerHTML = staffAssigneeGantt.innerHTML;

  const sourceKpiTable = document.querySelector<HTMLTableElement>("#staffKpiTable");
  printKpiContainer.innerHTML = "";
  if (sourceKpiTable) {
    printKpiContainer.appendChild(sourceKpiTable.cloneNode(true));
  }

  let conflictColumns: readonly string[];
  let conflictRows: string[][];

  if (activeConflictTab === "time") {
    conflictColumns = CONFLICT_COLUMNS;
    conflictRows = visibleConflicts.slice(0, PRINT_CONFLICT_LIMIT).map((conflict) => [
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
  } else if (activeConflictTab === "instructor_day") {
    conflictColumns = DAY_CONFLICT_COLUMNS;
    conflictRows = visibleInstructorDayOverlaps.slice(0, PRINT_CONFLICT_LIMIT).map((item) => toDayConflictRow(item));
  } else {
    conflictColumns = DAY_CONFLICT_COLUMNS;
    conflictRows = visibleFoDayOverlaps.slice(0, PRINT_CONFLICT_LIMIT).map((item) => toDayConflictRow(item));
  }

  printConflictTitle.textContent = `${getConflictTabLabel(activeConflictTab)} 상위 ${PRINT_CONFLICT_LIMIT}건`;
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
  listElement.innerHTML = "";

  if (values.length === 0) {
    const li = document.createElement("li");
    li.textContent = "없음";
    listElement.appendChild(li);
    return;
  }

  for (const value of values) {
    const li = document.createElement("li");

    const text = document.createElement("span");
    text.textContent = toLabel(value);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "small-btn";
    removeButton.textContent = "삭제";
    removeButton.addEventListener("click", () => {
      onRemove(value);
    });

    li.appendChild(text);
    li.appendChild(removeButton);
    listElement.appendChild(li);
  }
}

function getHolidayDisplayLabel(date: string): string {
  const holidayName = holidayNameByDate.get(date);
  return holidayName ? `${date} (${holidayName})` : date;
}

function renderHolidayAndBreakLists(): void {
  renderDateList(holidayList, holidayDates, (value) => {
    return getHolidayDisplayLabel(value);
  }, (value) => {
    holidayDates = holidayDates.filter((item) => item !== value);
    renderHolidayAndBreakLists();
  });

  renderDateList(customBreakList, customBreakDates, (value) => {
    return value;
  }, (value) => {
    customBreakDates = customBreakDates.filter((item) => item !== value);
    renderHolidayAndBreakLists();
  });

  refreshHrdValidation();
  scheduleAutoSave();
}

function addDateToList(input: HTMLInputElement, target: "holiday" | "customBreak"): void {
  const value = input.value.trim();
  const parsed = parseIsoDate(value);
  if (!parsed) {
    setScheduleError("날짜를 선택해 주세요.");
    return;
  }

  const normalized = formatDate(parsed);
  const source = target === "holiday" ? holidayDates : customBreakDates;
  if (source.includes(normalized)) {
    setScheduleError("이미 추가된 날짜입니다.");
    return;
  }

  source.push(normalized);
  source.sort((a, b) => a.localeCompare(b));

  input.value = "";
  setScheduleError(null);
  renderHolidayAndBreakLists();
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
    const breakStartInput = row.querySelector<HTMLInputElement>(".tpl-break-start");
    const breakEndInput = row.querySelector<HTMLInputElement>(".tpl-break-end");

    if (!startInput || !endInput || !breakStartInput || !breakEndInput) {
      throw new Error(`${weekdayLabel} 템플릿 입력 요소를 찾을 수 없습니다.`);
    }

    const startValue = startInput.value.trim();
    const endValue = endInput.value.trim();
    const breakStartValue = breakStartInput.value.trim();
    const breakEndValue = breakEndInput.value.trim();

    const hasClassRange = startValue.length > 0 || endValue.length > 0;
    const hasBreakRange = breakStartValue.length > 0 || breakEndValue.length > 0;

    if (!hasClassRange && !hasBreakRange) {
      continue;
    }

    if (!hasClassRange && hasBreakRange) {
      throw new Error(`${weekdayLabel}은 break만 입력할 수 없습니다. 수업 시작/종료를 입력해 주세요.`);
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
    if (hasBreakRange) {
      if (!breakStartValue || !breakEndValue) {
        throw new Error(`${weekdayLabel} break 시작/종료 시간을 모두 입력해 주세요.`);
      }

      const breakStartHHMM = normalizeTimeInputToHHMM(breakStartValue);
      const breakEndHHMM = normalizeTimeInputToHHMM(breakEndValue);

      if (!breakStartHHMM || !breakEndHHMM) {
        throw new Error(`${weekdayLabel} break 시간 형식이 올바르지 않습니다.`);
      }

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
      holidays: [...holidayDates],
      customBreaks: [...customBreakDates],
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
  if (!generatedScheduleResult) {
    scheduleResult.style.display = "none";
    scheduleSummary.textContent = "";
    scheduleSkippedSummary.textContent = "";
    scheduleSkippedDetails.innerHTML = "";
    scheduleDaysInfo.textContent = "";
    scheduleDaysPreview.innerHTML = "";
    return;
  }

  scheduleResult.style.display = "block";

  const skippedSummary = summarizeSkipped(generatedScheduleResult.skipped);
  const previewDays = generatedScheduleResult.days.slice(-20);

  scheduleSummary.textContent = `종강일: ${generatedScheduleResult.endDate} / 총 수업일수: ${generatedScheduleResult.totalDays} / 계획 총시간: ${formatHours(generatedScheduleResult.totalHoursPlanned)}시간`;
  scheduleSkippedSummary.textContent = `스킵 요약 - 공휴일: ${skippedSummary.holiday}, 자체휴강: ${skippedSummary.customBreak}, 요일제외: ${skippedSummary.weekdayExcluded}`;
  renderSkippedDetails(generatedScheduleResult.skipped);

  scheduleDaysInfo.textContent = `생성된 수업일 ${generatedScheduleResult.days.length}건 중 최근 ${previewDays.length}건 미리보기`;

  scheduleDaysPreview.innerHTML = "";
  for (const day of previewDays) {
    const li = document.createElement("li");
    const dayTrainingHours = formatHours(day.netMinutes / 60);
    li.textContent = `${day.date} / 일 훈련시간 ${dayTrainingHours}h`;
    scheduleDaysPreview.appendChild(li);
  }
}

function getHolidayFetchYears(startDate: string): number[] {
  const parsed = parseIsoDate(startDate);
  if (!parsed) {
    throw new Error("개강일을 먼저 입력해 주세요.");
  }

  const end = new Date(parsed.getTime());
  end.setUTCMonth(end.getUTCMonth() + 18);

  const years: number[] = [];
  for (let year = parsed.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    years.push(year);
  }

  return years;
}

function mergeFetchedHolidays(holidays: Holiday[]): number {
  const existing = new Set(holidayDates);
  const before = existing.size;

  for (const holiday of holidays) {
    const parsed = parseIsoDate(holiday.date);
    if (!parsed) {
      continue;
    }

    const date = formatDate(parsed);
    existing.add(date);
    holidayNameByDate.set(date, holiday.localName || holiday.name);
  }

  holidayDates = Array.from(existing).sort((a, b) => a.localeCompare(b));
  return holidayDates.length - before;
}

async function loadPublicHolidays(): Promise<void> {
  let years: number[];
  try {
    years = getHolidayFetchYears(scheduleStartDateInput.value);
  } catch (error) {
    if (error instanceof Error) {
      setScheduleError(error.message);
    } else {
      setScheduleError("공휴일 조회 기준 연도를 계산할 수 없습니다.");
    }
    return;
  }

  setHolidayLoadingState(true);
  holidayLoadStatus.textContent = `${years.join(", ")}년 공휴일 조회 중...`;
  setScheduleError(null);

  try {
    const responses = await Promise.all(years.map((year) => fetchPublicHolidaysKR(year)));
    const holidays = responses.flat();
    const added = mergeFetchedHolidays(holidays);
    hasLoadedPublicHoliday = holidays.length > 0;

    renderHolidayAndBreakLists();
    holidayLoadStatus.textContent = `${years.join(", ")}년 공휴일 ${holidays.length}건 조회, ${added}건 추가`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "공휴일 조회 중 알 수 없는 오류";
    setScheduleError(`${reason} 재시도해 주세요.`);
    holidayLoadStatus.textContent = "공휴일 불러오기 실패";
  } finally {
    setHolidayLoadingState(false);
  }
}

function clearHolidayList(): void {
  holidayDates = [];
  holidayNameByDate.clear();
  hasLoadedPublicHoliday = false;
  renderHolidayAndBreakLists();
  holidayLoadStatus.textContent = "공휴일 목록을 초기화했습니다.";
}

function dedupeHolidayList(): void {
  const before = holidayDates.length;
  holidayDates = dedupeAndSortDates(holidayDates);
  renderHolidayAndBreakLists();

  const removed = before - holidayDates.length;
  holidayLoadStatus.textContent = removed > 0 ? `중복 ${removed}건 제거` : "중복된 날짜가 없습니다.";
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

function rebuildStaffingCohortRanges(): void {
  const rangeMap = new Map<string, Omit<CohortRange, "trackType">>();

  for (const summary of summaries) {
    const startDate = compactToIso(summary.시작일);
    const endDate = compactToIso(summary.종료일);
    if (!startDate || !endDate) {
      continue;
    }

    upsertCohortRange(rangeMap, {
      cohort: summary.과정기수,
      startDate,
      endDate
    });
  }

  for (const range of generatedCohortRanges.values()) {
    upsertCohortRange(rangeMap, range);
  }

  const mergedRanges = Array.from(rangeMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));

  staffingCohortRanges = mergedRanges.map((range) => {
    const existingTrack = cohortTrackType.get(range.cohort);
    const trackType = existingTrack ?? getDefaultTrackTypeForCohort(range.cohort);
    cohortTrackType.set(range.cohort, trackType);
    return { ...range, trackType };
  });

  for (const range of staffingCohortRanges) {
    for (const phase of PHASES) {
      const key = staffCellKey(range.cohort, phase);
      if (!staffingCellState.has(key)) {
        staffingCellState.set(key, { assignee: "", startDate: "", endDate: "", resourceType: "FACILITATOR" });
      }
    }
  }
}

function renderStaffingMatrix(): void {
  staffMatrixContainer.innerHTML = "";

  if (staffingCohortRanges.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "코호트 데이터가 없어 배치표를 표시할 수 없습니다.";
    staffMatrixContainer.appendChild(empty);
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

  for (const range of staffingCohortRanges) {
    const tr = document.createElement("tr");

    const cohortCell = document.createElement("td");
    cohortCell.textContent = range.cohort;
    tr.appendChild(cohortCell);

    const trackCell = document.createElement("td");
    const trackSelect = document.createElement("select");
    const currentTrack = range.trackType ?? cohortTrackType.get(range.cohort) ?? getDefaultTrackTypeForCohort(range.cohort);

    for (const trackType of TRACK_TYPES) {
      const option = document.createElement("option");
      option.value = trackType;
      option.textContent = `${TRACK_LABEL[trackType]} (${getPolicyLabel(getPolicyForTrack(trackType))})`;
      trackSelect.appendChild(option);
    }
    trackSelect.value = currentTrack;
    trackSelect.addEventListener("change", () => {
      const nextTrack = trackSelect.value as TrackType;
      cohortTrackType.set(range.cohort, nextTrack);
      const nextRange = staffingCohortRanges.find((item) => item.cohort === range.cohort);
      if (nextRange) {
        nextRange.trackType = nextTrack;
      }
      refreshStaffingAnalytics(true);
      scheduleAutoSave();
    });

    trackCell.appendChild(trackSelect);
    tr.appendChild(trackCell);

    const startCell = document.createElement("td");
    startCell.textContent = range.startDate;
    tr.appendChild(startCell);

    const endCell = document.createElement("td");
    endCell.textContent = range.endDate;
    tr.appendChild(endCell);

    for (const phase of PHASES) {
      const state = getStaffCellState(range.cohort, phase);

      const td = document.createElement("td");
      const wrapper = document.createElement("div");
      wrapper.className = "phase-cell";

      const resourceBox = document.createElement("div");
      const resourceLabel = document.createElement("div");
      resourceLabel.className = "phase-field-label";
      resourceLabel.textContent = "유형";
      const resourceSelect = document.createElement("select");
      for (const resourceType of MATRIX_RESOURCE_TYPES) {
        const option = document.createElement("option");
        option.value = resourceType;
        option.textContent = RESOURCE_TYPE_LABEL[resourceType];
        resourceSelect.appendChild(option);
      }
      resourceSelect.value =
        state.resourceType === "INSTRUCTOR" ? "FACILITATOR" : state.resourceType;
      resourceSelect.addEventListener("change", () => {
        setStaffCellState(range.cohort, phase, {
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
      const assigneeInput = document.createElement("input");
      assigneeInput.type = "text";
      assigneeInput.value = state.assignee;
      assigneeInput.addEventListener("input", () => {
        setStaffCellState(range.cohort, phase, {
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
      const startInput = document.createElement("input");
      startInput.type = "date";
      startInput.value = state.startDate;
      startInput.addEventListener("input", () => {
        setStaffCellState(range.cohort, phase, {
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
      const endInput = document.createElement("input");
      endInput.type = "date";
      endInput.value = state.endDate;
      endInput.addEventListener("input", () => {
        setStaffCellState(range.cohort, phase, {
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
  staffMatrixContainer.appendChild(table);
}

function collectStaffingInputs(): StaffAssignmentInput[] {
  const inputs: StaffAssignmentInput[] = [];

  for (const range of staffingCohortRanges) {
    const trackType = range.trackType ?? cohortTrackType.get(range.cohort) ?? getDefaultTrackTypeForCohort(range.cohort);

    for (const phase of PHASES) {
      const state = getStaffCellState(range.cohort, phase);
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

function renderInstructorDayOverlapPanel(): void {
  instructorDayOverlapBody.innerHTML = "";
  instructorDayOverlapCount.textContent = `총 ${visibleInstructorDayOverlaps.length}건`;
  const preview = visibleInstructorDayOverlaps.slice(0, TABLE_RENDER_LIMIT);
  setRenderNotice(instructorDayRenderNotice, visibleInstructorDayOverlaps.length, preview.length);

  if (visibleInstructorDayOverlaps.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "겹침이 없습니다.";
    tr.appendChild(td);
    instructorDayOverlapBody.appendChild(tr);
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
        highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentA.phase, () =>
        highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
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
        highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentB.phase, () =>
        highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
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

    instructorDayOverlapBody.appendChild(tr);
  }
}

function renderFoDayOverlapPanel(): void {
  foOverlapBody.innerHTML = "";
  foOverlapCount.textContent = `총 ${visibleFoDayOverlaps.length}건`;
  const preview = visibleFoDayOverlaps.slice(0, TABLE_RENDER_LIMIT);
  setRenderNotice(foDayRenderNotice, visibleFoDayOverlaps.length, preview.length);

  if (visibleFoDayOverlaps.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "겹침이 없습니다.";
    tr.appendChild(td);
    foOverlapBody.appendChild(tr);
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
        highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentA.phase, () =>
        highlightGanttByCohortModule(overlap.assignmentA.cohort, overlap.assignmentA.phase)
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
        highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
      )
    );
    tr.appendChild(
      createClickableCell(overlap.assignmentB.phase, () =>
        highlightGanttByCohortModule(overlap.assignmentB.cohort, overlap.assignmentB.phase)
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

    foOverlapBody.appendChild(tr);
  }
}

function applyInstructorDayFilters(): void {
  const query = instructorDaySearchInput.value.trim().toLowerCase();

  visibleInstructorDayOverlaps = instructorDayOverlaps
    .filter((overlap) => (query.length === 0 ? true : overlapToSearchText(overlap).includes(query)))
    .sort(
      (a, b) =>
        a.assignee.localeCompare(b.assignee) ||
        a.overlapStartDate.localeCompare(b.overlapStartDate) ||
        a.assignmentA.cohort.localeCompare(b.assignmentA.cohort)
    );

  renderInstructorDayOverlapPanel();
  updateActionStates();
}

function applyFoDayFilters(): void {
  const query = foDaySearchInput.value.trim().toLowerCase();

  visibleFoDayOverlaps = facilitatorOperationOverlaps
    .filter((overlap) => (query.length === 0 ? true : overlapToSearchText(overlap).includes(query)))
    .sort(
      (a, b) =>
        a.resourceType.localeCompare(b.resourceType) ||
        a.assignee.localeCompare(b.assignee) ||
        a.overlapStartDate.localeCompare(b.overlapStartDate)
    );

  renderFoDayOverlapPanel();
  updateActionStates();
}

function renderStaffGantt(
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

function buildOverlapDayMapByAssignment(): Map<StaffAssignment, number> {
  const map = new Map<StaffAssignment, Set<string>>();

  for (const overlap of [...instructorDayOverlaps, ...facilitatorOperationOverlaps]) {
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

function getPolicyLabelsForAssignee(assignee: string, resourceType: ResourceType): string[] {
  if (resourceType === "INSTRUCTOR") {
    return [];
  }

  const set = new Set<string>();

  for (const assignment of staffingAssignments) {
    if (assignment.assignee !== assignee || assignment.resourceType !== resourceType) {
      continue;
    }
    set.add(getPolicyLabel(assignment.includeWeekdays));
  }

  return Array.from(set).sort();
}

function renderStaffKpiAndDetails(): void {
  staffKpiBody.innerHTML = "";

  const kpiRows = [...instructorSummaries, ...staffingSummaries].sort(
    (a, b) =>
      RESOURCE_TYPE_ORDER[a.resourceType] - RESOURCE_TYPE_ORDER[b.resourceType] ||
      a.assignee.localeCompare(b.assignee)
  );

  if (kpiRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "배치 데이터가 없습니다.";
    tr.appendChild(td);
    staffKpiBody.appendChild(tr);
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

      staffKpiBody.appendChild(tr);
    }
  }

  staffDetailContainer.innerHTML = "";
  const overlapDayMap = buildOverlapDayMapByAssignment();

  for (const summary of instructorSummaries) {
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

    staffDetailContainer.appendChild(group);
  }

  for (const summary of staffingSummaries) {
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
    const rows = staffingAssignments
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

      values.forEach((value, index) => {
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
    staffDetailContainer.appendChild(group);
  }
}

function refreshStaffingAnalytics(showStatus = true): void {
  try {
    const inputs = collectStaffingInputs();
    staffingAssignments = buildAssignments(inputs);
    const allOverlaps = detectStaffOverlaps(staffingAssignments);
    instructorDayOverlaps = allOverlaps.filter((item) => item.resourceType === "INSTRUCTOR");
    facilitatorOperationOverlaps = allOverlaps.filter((item) => item.resourceType !== "INSTRUCTOR");

    const allSummaries = summarizeWorkload(staffingAssignments);
    instructorSummaries = allSummaries.filter((item) => item.resourceType === "INSTRUCTOR");
    staffingSummaries = allSummaries.filter((item) => item.resourceType !== "INSTRUCTOR");

    applyInstructorDayFilters();
    applyFoDayFilters();

    const byCohort = new Map<string, StaffAssignment[]>();
    for (const assignment of staffingAssignments) {
      if (!byCohort.has(assignment.cohort)) {
        byCohort.set(assignment.cohort, []);
      }
      byCohort.get(assignment.cohort)?.push(assignment);
    }
    renderStaffGantt(
      staffCohortGantt,
      Array.from(byCohort.entries()).map(([label, assignments]) => ({ label, assignments })),
      (assignment) => `${assignment.phase} ${assignment.assignee}`
    );

    const byAssignee = new Map<string, StaffAssignment[]>();
    for (const assignment of staffingAssignments) {
      if (!byAssignee.has(assignment.assignee)) {
        byAssignee.set(assignment.assignee, []);
      }
      byAssignee.get(assignment.assignee)?.push(assignment);
    }
    renderStaffGantt(
      staffAssigneeGantt,
      Array.from(byAssignee.entries()).map(([label, assignments]) => ({ label, assignments })),
      (assignment) => `${assignment.cohort} ${assignment.phase}`
    );

    renderStaffKpiAndDetails();

    if (showStatus) {
      const kpiTarget = instructorSummaries.length + staffingSummaries.length;
      setStaffingStatus(
        `배치 ${staffingAssignments.length}건 / 강사 일충돌 ${instructorDayOverlaps.length}건 / 퍼실·운영 일충돌 ${facilitatorOperationOverlaps.length}건 / KPI ${kpiTarget}명`
      );
    }

    staffExportWarningsAgree.checked = false;
    renderStaffExportValidation([], []);
  } catch (error) {
    staffingAssignments = [];
    facilitatorOperationOverlaps = [];
    instructorDayOverlaps = [];
    visibleInstructorDayOverlaps = [];
    visibleFoDayOverlaps = [];
    staffingSummaries = [];
    instructorSummaries = [];

    renderInstructorDayOverlapPanel();
    renderFoDayOverlapPanel();
    renderStaffGantt(staffCohortGantt, [], () => "");
    renderStaffGantt(staffAssigneeGantt, [], () => "");
    renderStaffKpiAndDetails();

    if (showStatus) {
      const message = error instanceof Error ? error.message : "배치 계산 중 오류가 발생했습니다.";
      setStaffingStatus(message, true);
    }

    staffExportWarningsAgree.checked = false;
    renderStaffExportValidation([], []);
  }
}

function renderStaffingSection(): void {
  rebuildStaffingCohortRanges();
  renderStaffModuleManagerTable(false);
  renderStaffingMatrix();
  refreshStaffingAnalytics(false);

  if (staffingMode === "manager") {
    const moduleRows = buildModuleAssignSummaries();
    if (moduleRows.length === 0) {
      setStaffingStatus("수업시간표가 없어 운영매니저 교과목 배치표를 표시할 수 없습니다.");
    } else {
      setStaffingStatus(`모듈 ${moduleRows.length}건 기준으로 강사 자동 배정을 관리합니다.`);
    }
    return;
  }

  if (staffingCohortRanges.length === 0) {
    setStaffingStatus("코호트 데이터가 없어 고급 배치표를 표시할 수 없습니다.");
  } else {
    setStaffingStatus(`코호트 ${staffingCohortRanges.length}개를 기준으로 배치표를 구성했습니다.`);
  }
}

function autoFillStaffingFromCohorts(): void {
  if (staffingCohortRanges.length === 0) {
    setStaffingStatus("자동 채울 코호트가 없습니다.", true);
    return;
  }

  const p1Weeks = Number.parseInt(staffP1WeeksInput.value, 10);
  const d365Weeks = Number.parseInt(staff365WeeksInput.value, 10);

  if (!Number.isInteger(p1Weeks) || p1Weeks <= 0 || !Number.isInteger(d365Weeks) || d365Weeks <= 0) {
    setStaffingStatus("P1/365 기본 주수는 1 이상의 정수여야 합니다.", true);
    return;
  }

  for (const range of staffingCohortRanges) {
    const p1EndCandidate = addDaysToIso(range.startDate, p1Weeks * 7 - 1);
    const p1End = p1EndCandidate < range.endDate ? p1EndCandidate : range.endDate;

    const p2StartCandidate = addDaysToIso(p1End, 1);
    const hasP2 = p2StartCandidate <= range.endDate;

    const d365Start = range.endDate;
    const d365End = addDaysToIso(d365Start, d365Weeks * 7 - 1);

    const p1State = getStaffCellState(range.cohort, "P1");
    const p2State = getStaffCellState(range.cohort, "P2");
    const d365State = getStaffCellState(range.cohort, "365");

    setStaffCellState(range.cohort, "P1", {
      assignee: p1State.assignee,
      startDate: range.startDate,
      endDate: p1End,
      resourceType: p1State.resourceType
    });

    setStaffCellState(range.cohort, "P2", {
      assignee: p2State.assignee,
      startDate: hasP2 ? p2StartCandidate : "",
      endDate: hasP2 ? range.endDate : "",
      resourceType: p2State.resourceType
    });

    setStaffCellState(range.cohort, "365", {
      assignee: d365State.assignee,
      startDate: d365Start,
      endDate: d365End,
      resourceType: d365State.resourceType
    });
  }

  renderStaffingMatrix();
  refreshStaffingAnalytics(true);
  setStaffingStatus("코호트 일정 기준으로 P1/P2/365 기간을 자동 반영했습니다.");
  scheduleAutoSave();
}

function isV7eStrictReady(): { ok: boolean; reason?: string } {
  if (staffingCohortRanges.length === 0) {
    return { ok: false, reason: "코호트 데이터가 없습니다." };
  }

  const p1Weeks = Number.parseInt(staffP1WeeksInput.value, 10);
  const d365Weeks = Number.parseInt(staff365WeeksInput.value, 10);
  if (!Number.isInteger(p1Weeks) || !Number.isInteger(d365Weeks) || p1Weeks <= 0 || d365Weeks <= 0) {
    return { ok: false, reason: "P1/365 기본 주수가 올바르지 않습니다." };
  }

  for (const range of staffingCohortRanges) {
    const p1State = getStaffCellState(range.cohort, "P1");
    const p2State = getStaffCellState(range.cohort, "P2");
    const d365State = getStaffCellState(range.cohort, "365");

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

function buildStrictExportRecords(): InternalV7ERecord[] {
  const records: InternalV7ERecord[] = [];

  for (const range of staffingCohortRanges) {
    const p1 = getStaffCellState(range.cohort, "P1");
    const p2 = getStaffCellState(range.cohort, "P2");
    const d365 = getStaffCellState(range.cohort, "365");

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

function buildModulesGenericExportRecords(): InternalV7ERecord[] {
  const moduleRanges = deriveModuleRangesFromSessions(sessions);

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

function downloadStaffingCsv(): void {
  if (staffingCohortRanges.length === 0) {
    setStaffingStatus("내보낼 배치 데이터가 없습니다.", true);
    return;
  }

  const mode: ExportFormatKey =
    staffExportModeSelect.value === "modules_generic" ? "modules_generic" : "v7e_strict";

  if (mode === "v7e_strict") {
    const strictReady = isV7eStrictReady();
    if (!strictReady.ok) {
      setStaffingStatus(
        `v7e_strict는 P1/P2/365 프리셋 적용 상태에서만 내보낼 수 있습니다. (${strictReady.reason})`,
        true
      );
      return;
    }
  }

  const records = mode === "v7e_strict" ? buildStrictExportRecords() : buildModulesGenericExportRecords();
  const validation = validateRecordsForFormat(mode, records);
  renderStaffExportValidation(validation.errors, validation.warnings);

  if (validation.errors.length > 0) {
    setStaffingStatus("내보내기 검증 오류가 있어 진행할 수 없습니다.", true);
    return;
  }

  if (validation.warnings.length > 0 && !staffExportWarningsAgree.checked) {
    setStaffingStatus("경고를 확인한 뒤 체크박스를 선택하면 내보내기를 진행할 수 있습니다.", true);
    return;
  }

  const csv = mode === "v7e_strict" ? exportV7eStrictCsv(records) : exportWithMapping("modules_generic", records);
  const fileName =
    mode === "v7e_strict"
      ? `staffing_v7e_strict_${getTodayCompactDate()}.csv`
      : `staffing_modules_generic_${getTodayCompactDate()}.csv`;
  downloadCsvText(fileName, csv);

  if (mode === "v7e_strict" && staffExportIncludeDetails.checked) {
    const detailRows = staffingAssignments
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

  setStaffingStatus(`${mode} 내보내기를 완료했습니다.`);
}

function regenerateSummariesAndTimeline(preferredCohort = ""): void {
  summaries = buildCohortSummaries(sessions);
  setCohortOptions(summaries, preferredCohort);
  renderTimeline();
  renderStaffingSection();
}

function generateScheduleFromUi(): void {
  const prepared = readScheduleConfigFromUi();
  if (!prepared) {
    return;
  }

  try {
    generatedScheduleResult = generateSchedule(prepared.config);
    generatedScheduleCohort = prepared.cohort;
    scheduleAppendStatus.textContent = "";
    skipExpanded.holiday = false;
    skipExpanded.custom_break = false;
    skipExpanded.weekday_excluded = false;

    if (generatedScheduleResult.days.length > 0) {
      generatedCohortRanges.set(generatedScheduleCohort, {
        cohort: generatedScheduleCohort,
        startDate: generatedScheduleResult.days[0].date,
        endDate: generatedScheduleResult.endDate
      });
      renderStaffingSection();
    }

    setScheduleError(null);
    renderGeneratedScheduleResult();
    pushRecentActionLog(
      "INFO",
      `일정 생성 완료: ${generatedScheduleCohort} (종강 ${generatedScheduleResult.endDate})`,
      "sectionScheduleGenerate"
    );
    updateActionStates();
    scheduleAutoSave();
  } catch (error) {
    generatedScheduleResult = null;
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
  if (!generatedScheduleResult || generatedScheduleResult.days.length === 0) {
    setScheduleError("먼저 일정을 생성해 주세요.");
    return;
  }

  if (!pushScheduleToConflicts.checked) {
    setScheduleError("충돌 계산에 올리기 체크박스를 선택해 주세요.");
    return;
  }

  try {
    const createdSessions = fromScheduleDaysToSessions({
      cohort: generatedScheduleCohort,
      days: generatedScheduleResult.days,
      instructorCode: scheduleInstructorCodeInput.value,
      classroomCode: scheduleClassroomCodeInput.value,
      subjectCode: scheduleSubjectCodeInput.value
    });

    sessions = [...sessions, ...createdSessions];
    moduleInstructorDraft.clear();
    subjectInstructorMappingDraft.clear();
    regenerateSummariesAndTimeline(generatedScheduleCohort);

    resetConflictsBeforeCompute();
    computeConflictsButton.textContent = DEFAULT_COMPUTE_LABEL;

    uploadStatus.textContent = `현재 수업시간표 ${sessions.length}건 (CSV + 생성 일정 합산)`;
    scheduleAppendStatus.textContent = `${generatedScheduleCohort} 일정 ${createdSessions.length}건을 충돌 검토 대상에 추가했습니다.`;
    setScheduleError(null);
    pushRecentActionLog(
      "INFO",
      `일정 반영 완료: ${generatedScheduleCohort} ${createdSessions.length}건 추가`,
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

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  setUploadProcessingState(true);

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    const built = buildSessions(rows);

    sessions = built.sessions;
    moduleInstructorDraft.clear();
    subjectInstructorMappingDraft.clear();
    parseErrors = built.errors;

    regenerateSummariesAndTimeline();
    resetConflictsBeforeCompute();
    computeConflictsButton.textContent = DEFAULT_COMPUTE_LABEL;

    renderErrors();
    uploadStatus.textContent = `처리 완료: 수업시간표 ${sessions.length}건 / 에러 ${parseErrors.length}건`;

    if (parseErrors.length > 0) {
      console.warn("CSV 파싱 중 오류가 발견되었습니다.", parseErrors);
    }

    scheduleAutoSave();
  } finally {
    setUploadProcessingState(false);
  }
});

cohortSelect.addEventListener("change", updateCohortInfo);
downloadButton.addEventListener("click", downloadCohortCSV);

openNotificationDrawerButton.addEventListener("click", () => {
  openDrawer("notification");
  renderNotificationCenter();
});
openConflictDetailModalButton.addEventListener("click", openConflictDetailModal);
closeConflictDetailModalButton.addEventListener("click", closeConflictDetailModal);
conflictDetailModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeConflictDetailModal();
});
conflictDetailModal.addEventListener("click", (event) => {
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
});
openInstructorDrawerButton.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("course");
});
quickNavCourseButton.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("course");
});
quickNavSubjectButton.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("subject");
});
quickNavInstructorButton.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("register");
});
quickNavMappingButton.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  openInstructorDrawerWithTab("mapping");
});
timelineViewTypeSelect.addEventListener("change", () => {
  setTimelineViewType(parseTimelineViewType(timelineViewTypeSelect.value));
  renderTimeline();
  scheduleAutoSave();
});
assigneeModeInstructorButton.addEventListener("click", () => {
  assigneeTimelineKind = "INSTRUCTOR";
  assigneeModeInstructorButton.classList.add("active");
  assigneeModeStaffButton.classList.remove("active");
  renderTimeline();
  scheduleAutoSave();
});
assigneeModeStaffButton.addEventListener("click", () => {
  assigneeTimelineKind = "STAFF";
  assigneeModeStaffButton.classList.add("active");
  assigneeModeInstructorButton.classList.remove("active");
  renderTimeline();
  scheduleAutoSave();
});
weekPrevButton.addEventListener("click", () => {
  weekGridStartDate = addDaysToIso(startOfWeekIso(weekGridStartDate), -7);
  renderTimeline();
});
weekNextButton.addEventListener("click", () => {
  weekGridStartDate = addDaysToIso(startOfWeekIso(weekGridStartDate), 7);
  renderTimeline();
});
monthPrevButton.addEventListener("click", () => {
  const parsed = monthCalendarCursor.match(/^(\d{4})-(\d{2})$/);
  if (!parsed) {
    monthCalendarCursor = getTodayIsoDate().slice(0, 7);
  }
  const [year, month] = monthCalendarCursor.split("-").map((value) => Number.parseInt(value, 10));
  const prev = new Date(Date.UTC(year, (month || 1) - 2, 1));
  monthCalendarCursor = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  renderTimeline();
});
monthNextButton.addEventListener("click", () => {
  const parsed = monthCalendarCursor.match(/^(\d{4})-(\d{2})$/);
  if (!parsed) {
    monthCalendarCursor = getTodayIsoDate().slice(0, 7);
  }
  const [year, month] = monthCalendarCursor.split("-").map((value) => Number.parseInt(value, 10));
  const next = new Date(Date.UTC(year, month || 1, 1));
  monthCalendarCursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  renderTimeline();
});
drawerBackdrop.addEventListener("click", closeDrawers);
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-close-drawer]"))) {
  button.addEventListener("click", closeDrawers);
}
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeDrawer) {
    closeDrawers();
  }
});
window.addEventListener("resize", applyManagementInlineMode);

computeConflictsButton.addEventListener("click", () => {
  void computeConflicts();
});

keySearchInput.addEventListener("input", () => {
  if (keySearchTimer !== undefined) {
    window.clearTimeout(keySearchTimer);
  }

  keySearchTimer = window.setTimeout(() => {
    applyConflictFilters();
    scheduleAutoSave();
  }, 300);
});

instructorDaySearchInput.addEventListener("input", () => {
  if (instructorDaySearchTimer !== undefined) {
    window.clearTimeout(instructorDaySearchTimer);
  }

  instructorDaySearchTimer = window.setTimeout(() => {
    applyInstructorDayFilters();
    scheduleAutoSave();
  }, 300);
});

foDaySearchInput.addEventListener("input", () => {
  if (foDaySearchTimer !== undefined) {
    window.clearTimeout(foDaySearchTimer);
  }

  foDaySearchTimer = window.setTimeout(() => {
    applyFoDayFilters();
    scheduleAutoSave();
  }, 300);
});

downloadTimeConflictsButton.addEventListener("click", downloadVisibleTimeConflictsCsv);
downloadInstructorDayConflictsButton.addEventListener("click", downloadVisibleInstructorDayConflictsCsv);
downloadFoDayConflictsButton.addEventListener("click", downloadVisibleFoDayConflictsCsv);

tabTimeConflicts.addEventListener("click", () => {
  setConflictTab("time");
});

tabInstructorDayConflicts.addEventListener("click", () => {
  setConflictTab("instructor_day");
});

tabFoDayConflicts.addEventListener("click", () => {
  setConflictTab("fo_day");
});

addHolidayButton.addEventListener("click", () => {
  addDateToList(holidayDateInput, "holiday");
});

loadPublicHolidaysButton.addEventListener("click", () => {
  void loadPublicHolidays();
});

clearHolidaysButton.addEventListener("click", clearHolidayList);
dedupeHolidaysButton.addEventListener("click", dedupeHolidayList);

addCustomBreakButton.addEventListener("click", () => {
  addDateToList(customBreakDateInput, "customBreak");
});

scheduleTemplateSelect.addEventListener("change", () => {
  const selectedTemplate = findScheduleTemplate(scheduleTemplates, scheduleTemplateSelect.value);
  deleteScheduleTemplateButton.disabled = Boolean(selectedTemplate?.builtIn);
});
loadScheduleTemplateButton.addEventListener("click", applySelectedScheduleTemplate);
saveScheduleTemplateButton.addEventListener("click", saveCurrentScheduleTemplate);
deleteScheduleTemplateButton.addEventListener("click", deleteSelectedScheduleTemplate);

generateScheduleButton.addEventListener("click", generateScheduleFromUi);
appendScheduleButton.addEventListener("click", appendGeneratedScheduleToSessions);
pushScheduleToConflicts.addEventListener("change", () => {
  updateActionStates();
  scheduleAutoSave();
});

staffAutoFillButton.addEventListener("click", autoFillStaffingFromCohorts);
staffRefreshButton.addEventListener("click", () => {
  refreshStaffingAnalytics(true);
  scheduleAutoSave();
});
staffingModeSelect.addEventListener("change", () => {
  applyStaffingMode(staffingModeSelect.value === "advanced" ? "advanced" : "manager");
  renderStaffingSection();
  updateActionStates();
  scheduleAutoSave();
});
if (adminModeToggle) {
  adminModeToggle.addEventListener("change", () => {
    applyShowAdvancedMode(resolveShowAdvanced(adminModeToggle.checked));
    scheduleAutoSave();
  });
}

saveMenuConfigButton.addEventListener("click", () => {
  sidebarMenuConfig = normalizeSidebarMenuConfig(sidebarMenuDraft);
  sidebarMenuDraft = cloneSidebarMenuConfig(sidebarMenuConfig);
  applySidebarMenuConfigToSidebar(sidebarMenuConfig);
  saveSidebarMenuConfig(sidebarMenuConfig);
  renderSidebarMenuConfigEditor();
  menuConfigStatus.textContent = `메뉴 설정 저장 완료 (${new Date().toLocaleTimeString()})`;
});

resetMenuConfigButton.addEventListener("click", () => {
  sidebarMenuConfig = getDefaultSidebarMenuConfig();
  sidebarMenuDraft = cloneSidebarMenuConfig(sidebarMenuConfig);
  applySidebarMenuConfigToSidebar(sidebarMenuConfig);
  saveSidebarMenuConfig(sidebarMenuConfig);
  renderSidebarMenuConfigEditor();
  menuConfigStatus.textContent = "기본 메뉴 설정으로 복원했습니다.";
});

jibbleSubCourseButton?.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("course");
  openInstructorDrawerWithTab("course");
});

jibbleSubSubjectButton?.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("subject");
  openInstructorDrawerWithTab("subject");
});

jibbleSubInstructorButton?.addEventListener("click", () => {
  activatePrimarySidebarPage("management", {
    scrollToTop: false,
    openManagementTab: false
  });
  setJibbleManagementSubmenuVisible(true);
  setJibbleManagementSubmenuActive("instructor");
  openInstructorDrawerWithTab("register");
});

instructorTabCourse.addEventListener("click", () => switchInstructorDrawerTab("course"));
instructorTabRegister.addEventListener("click", () => switchInstructorDrawerTab("register"));
instructorTabMapping.addEventListener("click", () => switchInstructorDrawerTab("mapping"));
instructorTabSubject.addEventListener("click", () => switchInstructorDrawerTab("subject"));
upsertCourseButton.addEventListener("click", upsertCourseRegistryEntry);
upsertInstructorButton.addEventListener("click", upsertInstructorDirectoryEntry);
upsertSubjectButton.addEventListener("click", upsertSubjectDirectoryEntry);
applySubjectMappingsButton.addEventListener("click", applySubjectMappingsToSessions);
subjectCourseSelect.addEventListener("change", () => {
  renderSubjectDirectory();
  scheduleAutoSave();
});
mappingCourseSelect.addEventListener("change", () => {
  renderSubjectMappingTable();
  scheduleAutoSave();
});
courseTemplateCourseSelect.addEventListener("change", () => {
  renderCourseTemplateOptions();
  scheduleAutoSave();
});
saveCourseTemplateButton.addEventListener("click", saveCurrentCourseTemplate);
loadCourseTemplateButton.addEventListener("click", applySelectedCourseTemplate);
deleteCourseTemplateButton.addEventListener("click", deleteSelectedCourseTemplate);
staffExportCsvButton.addEventListener("click", downloadStaffingCsv);
staffExportModeSelect.addEventListener("change", () => {
  staffExportWarningsAgree.checked = false;
  renderStaffExportValidation([], []);
  scheduleAutoSave();
  updateActionStates();
});
staffExportIncludeDetails.addEventListener("change", scheduleAutoSave);
staffExportWarningsAgree.addEventListener("change", updateActionStates);

saveProjectButton.addEventListener("click", downloadProjectStateJson);
loadProjectButton.addEventListener("click", () => {
  loadProjectInput.click();
});
loadProjectInput.addEventListener("change", async () => {
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
});
resetProjectButton.addEventListener("click", resetAllStateWithConfirm);
printReportButton.addEventListener("click", printReport);

loadDemoSampleButton.addEventListener("click", async () => {
  try {
    await loadDemoSampleState();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    setDemoSampleBanner(`샘플 로드 실패: ${message}`);
  }
});

restorePreviousStateButton.addEventListener("click", restoreStateBeforeSampleLoad);
authLoginButton.addEventListener("click", submitAuthCode);
authCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitAuthCode();
  }
});

const scheduleInputsForAutoSave: Array<HTMLInputElement> = [
  scheduleCohortInput,
  scheduleStartDateInput,
  scheduleTotalHoursInput,
  scheduleInstructorCodeInput,
  scheduleClassroomCodeInput,
  scheduleSubjectCodeInput,
  staffP1WeeksInput,
  staff365WeeksInput
];

for (const input of scheduleInputsForAutoSave) {
  input.addEventListener("input", scheduleAutoSave);
}

dayTemplateTable.addEventListener("input", scheduleAutoSave);
dayTemplateTable.addEventListener("input", () => {
  scheduleTemplateStatus.textContent = "현재 템플릿이 수정되었습니다. 필요 시 저장해 주세요.";
});

window.addEventListener("afterprint", () => {
  printReportCard.style.display = "none";
});

if (!scheduleStartDateInput.value) {
  scheduleStartDateInput.value = getTodayIsoDate();
}

applyManagementInlineMode();
renderHeaderRuntimeStatus();
window.setInterval(renderHeaderRuntimeStatus, 1000);

applyViewMode("full");
setTimelineViewType("COHORT_TIMELINE");
applyStaffingMode(staffingModeSelect.value === "advanced" ? "advanced" : "manager");
applyShowAdvancedMode(resolveShowAdvanced(false));
sidebarMenuConfig = normalizeSidebarMenuConfig(sidebarMenuConfig);
sidebarMenuDraft = cloneSidebarMenuConfig(sidebarMenuConfig);
applySidebarMenuConfigToSidebar(sidebarMenuConfig);
renderSidebarMenuConfigEditor();
menuConfigStatus.textContent = "메뉴 이모지/이름/순서를 변경한 뒤 저장할 수 있습니다.";
switchInstructorDrawerTab("course");
setupJibbleSidebarNavigation();

const hasAuthSession = sessionStorage.getItem(AUTH_SESSION_KEY) === "verified";
applyAuthGate(hasAuthSession);

if (hasAuthSession) {
  void bootstrapAppAfterAuthLogin();
}
