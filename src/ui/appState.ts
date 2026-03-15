import { getTodayIsoDate } from "./utils/date";
import {
  CohortSummary,
  Conflict,
  GenerateScheduleResult,
  ParseError,
  ResourceType,
  Session,
  SkippedDay,
  StaffAssignment,
  StaffOverlap,
  TrackType,
  type InstructorDirectoryEntry,
} from "../core/types";
import {
  type AppSidebarMenuConfig,
  type AppSidebarNavKey,
  type AppStateVCurrent,
  type AppTimelineViewType,
  type AppViewMode,
  type TemplateRowState,
} from "../core/state";
import { NamedScheduleTemplate } from "../core/scheduleTemplates";
import { ConflictTab } from "./utils/format";

export type { ConflictTab };

export type ViewMode = AppViewMode;
export type TimelineViewType = AppTimelineViewType;
export type StaffingMode = "manager" | "advanced";
export type AssigneeTimelineKind = "INSTRUCTOR" | "STAFF";
export type PrimarySidebarNavKey = AppSidebarNavKey;
export type SidebarMenuConfig = AppSidebarMenuConfig;

export type NotificationSeverity = "INFO" | "WARNING" | "ERROR";
export type NotificationSource = "PARSE_ERROR" | "CONFLICT_TIME" | "HRD_VALIDATION" | "MISSING_INSTRUCTOR";

export type NotificationItem = {
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

export type SubjectDirectoryEntry = {
  courseId: string;
  subjectCode: string;
  subjectName: string;
  memo: string;
};

export type CourseRegistryEntry = {
  courseId: string;
  courseName: string;
  memo: string;
};

export type RecentActionLog = {
  id: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  focusSectionId?: string;
  createdAt: string;
};

export type CourseTemplate = {
  name: string;
  version: string;
  courseId: string;
  dayTemplates: TemplateRowState[];
  holidays: string[];
  customBreaks: string[];
  subjectList: Array<{ subjectCode: string; subjectName: string; memo: string }>;
  subjectInstructorMapping: Array<{ key: string; instructorCode: string }>;
};

export type CohortRange = {
  cohort: string;
  startDate: string;
  endDate: string;
  trackType: TrackType;
};

export type StaffCellState = {
  assignee: string;
  startDate: string;
  endDate: string;
  resourceType: ResourceType;
};

export const appState = {
  // Session/summary/error state
  sessions: [] as Session[],
  summaries: [] as CohortSummary[],
  parseErrors: [] as ParseError[],
  hrdValidationErrors: [] as string[],
  hrdValidationWarnings: [] as string[],

  // Conflict state
  allConflicts: [] as Conflict[],
  visibleConflicts: [] as Conflict[],

  // Schedule generation
  generatedScheduleResult: null as GenerateScheduleResult | null,
  generatedScheduleCohort: "",

  // Holiday/break
  holidayDates: [] as string[],
  customBreakDates: [] as string[],

  // Staffing
  staffingCohortRanges: [] as CohortRange[],
  staffingAssignments: [] as StaffAssignment[],
  facilitatorOperationOverlaps: [] as StaffOverlap[],
  instructorDayOverlaps: [] as StaffOverlap[],
  visibleInstructorDayOverlaps: [] as StaffOverlap[],
  visibleFoDayOverlaps: [] as StaffOverlap[],
  staffingSummaries: [] as AssigneeSummary[],
  instructorSummaries: [] as AssigneeSummary[],

  // Flags/timers
  hasLoadedPublicHoliday: false,
  stateMigrationWarnings: [] as string[],
  autoSaveTimer: undefined as number | undefined,
  isApplyingProjectState: false,
  previousStateBeforeSampleLoad: null as AppStateVCurrent | null,

  // UI state
  viewMode: "full" as ViewMode,
  timelineViewType: "COHORT_TIMELINE" as TimelineViewType,
  assigneeTimelineKind: "INSTRUCTOR" as AssigneeTimelineKind,
  weekGridStartDate: getTodayIsoDate(),
  monthCalendarCursor: getTodayIsoDate().slice(0, 7),
  ganttHighlightTimer: undefined as number | undefined,
  activeConflictTab: "time" as ConflictTab,
  staffingMode: "manager" as StaffingMode,
  showAdvanced: false,
  hasPrunedBasicModeSections: false,
  activeDrawer: null as "notification" | "instructor" | null,
  managementInlineMode: false,

  // Cloud/auth
  instructorDirectoryCloudWarning: "",
  managementCloudWarning: "",
  isAuthVerified: false,
  hasAppBootstrapped: false,
  activePrimarySidebarPage: "timeline" as PrimarySidebarNavKey,
  sidebarMenuConfig: {} as SidebarMenuConfig,
  sidebarMenuDraft: {} as SidebarMenuConfig,

  // Processing flags
  isUploadProcessing: false,
  isConflictComputing: false,
  hasComputedConflicts: false,
  isHolidayLoading: false,
  keySearchTimer: undefined as number | undefined,
  instructorDaySearchTimer: undefined as number | undefined,
  foDaySearchTimer: undefined as number | undefined,

  // Directories/registries
  instructorDirectory: [] as InstructorDirectoryEntry[],
  courseRegistry: [] as CourseRegistryEntry[],
  subjectDirectory: [] as SubjectDirectoryEntry[],
  notificationItems: [] as NotificationItem[],
  scheduleTemplates: [] as NamedScheduleTemplate[],
  recentActionLogs: [] as RecentActionLog[],
  courseTemplates: [] as CourseTemplate[],
  notificationFocus: null as { cohort?: string; assignee?: string; date?: string } | null,
};

export const holidayNameByDate = new Map<string, string>();
export const skipExpanded: Record<SkippedDay["reason"], boolean> = {
  holiday: false,
  custom_break: false,
  weekday_excluded: false,
};
export const staffingCellState = new Map<string, StaffCellState>();
export const cohortTrackType = new Map<string, TrackType>();
export const generatedCohortRanges = new Map<string, { cohort: string; startDate: string; endDate: string }>();
export const moduleInstructorDraft = new Map<string, string>();
export const subjectInstructorMappingDraft = new Map<string, string>();
export const subjectInstructorMappings = new Map<string, string>();
export const collapsedCourseGroups = new Set<string>();
