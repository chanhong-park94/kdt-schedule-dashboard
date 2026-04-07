import { normalizeClassroomCode, normalizeInstructorCode, normalizeSubjectCode } from "./standardize";
import { GenerateScheduleResult, Phase, ResourceType, Session, TrackType } from "./types";

export const CURRENT_SCHEMA_VERSION = 2 as const;

export type AppConflictTab = "time" | "instructor_day" | "fo_day";
export type AppViewMode = "simple" | "full";
export type AppTimelineViewType =
  | "COHORT_TIMELINE"
  | "COURSE_GROUPED"
  | "ASSIGNEE_TIMELINE"
  | "WEEK_GRID"
  | "MONTH_CALENDAR";

export type AppSidebarNavKey =
  | "dashboard"
  | "timeline"
  | "dropout"
  | "generator"
  | "kpi"
  | "attendance"
  | "analytics"
  | "traineeHistory"
  | "achievement"
  | "inquiry"
  | "satisfaction"
  | "crossAnalysis"
  | "revenue"
  | "docAutomation"
  | "settings";

export type AppSidebarMenuConfig = {
  order: AppSidebarNavKey[];
  labels: Record<AppSidebarNavKey, string>;
  icons: Record<AppSidebarNavKey, string>;
};

export type TemplateRowState = {
  weekday: number;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
};

export type SavedStaffCell = {
  cohort: string;
  phase: Phase;
  assignee: string;
  startDate: string;
  endDate: string;
  resourceType: ResourceType;
};

type AppStateShared = {
  savedAt: string;
  sessions: Session[];
  cohortTrackTypes: Record<string, TrackType>;
  generatedCohortRanges: Array<{ cohort: string; startDate: string; endDate: string }>;
  scheduleGenerator: {
    cohort: string;
    startDate: string;
    totalHours: string;
    instructorCode: string;
    classroomCode: string;
    subjectCode: string;
    pushToConflicts: boolean;
    dayTemplates: TemplateRowState[];
    holidays: string[];
    customBreaks: string[];
    generatedResult: GenerateScheduleResult | null;
    generatedCohort: string;
    publicHolidayLoaded: boolean;
  };
  staffingCells: SavedStaffCell[];
  courseRegistry: Array<{ courseId: string; courseName: string; memo: string }>;
  instructorDirectory: Array<{ instructorCode: string; name: string; memo: string }>;
  instructorRegistry: Array<{ instructorCode: string; name: string; memo: string }>;
  subjectDirectory: Array<{ courseId: string; subjectCode: string; subjectName: string; memo: string }>;
  subjectRegistryByCourse: Array<{ courseId: string; subjectCode: string; subjectName: string; memo: string }>;
  subjectInstructorMappings: Array<{ moduleKey: string; instructorCode: string }>;
  courseSubjectInstructorMapping: Array<{ courseId: string; moduleKey: string; instructorCode: string }>;
  courseTemplates: Array<{
    name: string;
    version: string;
    courseId: string;
    dayTemplates: TemplateRowState[];
    holidays: string[];
    customBreaks: string[];
    subjectList: Array<{ subjectCode: string; subjectName: string; memo: string }>;
    subjectInstructorMapping: Array<{ key: string; instructorCode: string }>;
  }>;
  ui: {
    activeConflictTab: AppConflictTab;
    viewMode: AppViewMode;
    timelineViewType: AppTimelineViewType;
    showAdvanced: boolean;
    keySearch: string;
    instructorDaySearch: string;
    foDaySearch: string;
    sidebarMenu: AppSidebarMenuConfig | null;
  };
};

export type AppStateV1 = AppStateShared & {
  schemaVersion?: 1;
};

export type AppStateV2 = AppStateShared & {
  schemaVersion: 2;
};

export type AppStateVCurrent = AppStateV2;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("불러온 상태 파일 형식이 올바르지 않습니다. JSON 객체를 기대합니다.");
  }
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toBooleanValue(value: unknown): boolean {
  return Boolean(value);
}

function isTrackType(value: unknown): value is TrackType {
  return value === "UNEMPLOYED" || value === "EMPLOYED";
}

function isPhase(value: unknown): value is Phase {
  return value === "P1" || value === "P2" || value === "365";
}

function isResourceType(value: unknown): value is ResourceType {
  return value === "INSTRUCTOR" || value === "FACILITATOR" || value === "OPERATION";
}

function toConflictTab(value: unknown): AppConflictTab {
  if (value === "instructor_day" || value === "fo_day") {
    return value;
  }
  return "time";
}

function toViewMode(value: unknown): AppViewMode {
  if (value === "simple") {
    return "simple";
  }
  return "full";
}

function toTimelineViewType(value: unknown): AppTimelineViewType {
  if (
    value === "COHORT_TIMELINE" ||
    value === "COURSE_GROUPED" ||
    value === "ASSIGNEE_TIMELINE" ||
    value === "WEEK_GRID" ||
    value === "MONTH_CALENDAR"
  ) {
    return value;
  }
  return "COHORT_TIMELINE";
}

function isSidebarNavKey(value: unknown): value is AppSidebarNavKey {
  return (
    value === "dashboard" ||
    value === "timeline" ||
    value === "dropout" ||
    value === "generator" ||
    value === "kpi" ||
    value === "attendance" ||
    value === "analytics" ||
    value === "traineeHistory" ||
    value === "achievement" ||
    value === "inquiry" ||
    value === "satisfaction" ||
    value === "crossAnalysis" ||
    value === "revenue" ||
    value === "docAutomation" ||
    value === "settings"
  );
}

function toSidebarLabel(value: unknown, fallback: string): string {
  const normalized = toStringValue(value).trim();
  return normalized.length > 0 ? normalized : fallback;
}

function toSidebarIcon(value: unknown, fallback: string): string {
  const normalized = toStringValue(value).trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeSidebarMenuConfig(value: unknown): AppSidebarMenuConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as {
    order?: unknown;
    labels?: Record<string, unknown>;
    icons?: Record<string, unknown>;
  };

  const defaultOrder: AppSidebarNavKey[] = [
    "dashboard",
    "timeline",
    "dropout",
    "generator",
    "kpi",
    "attendance",
    "analytics",
    "traineeHistory",
    "achievement",
    "inquiry",
    "satisfaction",
    "crossAnalysis",
    "revenue",
    "docAutomation",
    "settings",
  ];

  const order: AppSidebarNavKey[] = [];
  if (Array.isArray(row.order)) {
    for (const item of row.order) {
      if (!isSidebarNavKey(item) || order.includes(item)) {
        continue;
      }
      order.push(item);
    }
  }

  for (const navKey of defaultOrder) {
    if (!order.includes(navKey)) {
      order.push(navKey);
    }
  }

  const labelsSource = row.labels ?? {};
  const iconsSource = row.icons ?? {};

  return {
    order,
    labels: {
      dashboard: toSidebarLabel(labelsSource.dashboard, "대시보드"),
      timeline: toSidebarLabel(labelsSource.timeline, "학사일정"),
      dropout: toSidebarLabel(labelsSource.dropout, "하차방어율"),
      generator: toSidebarLabel(labelsSource.generator, "HRD시간표 생성"),
      kpi: toSidebarLabel(labelsSource.kpi, "재직자 자율성과지표"),
      attendance: toSidebarLabel(labelsSource.attendance, "출결현황"),
      analytics: toSidebarLabel(labelsSource.analytics, "출결 리스크"),
      traineeHistory: toSidebarLabel(labelsSource.traineeHistory, "훈련생 이력"),
      achievement: toSidebarLabel(labelsSource.achievement, "학업성취도"),
      inquiry: toSidebarLabel(labelsSource.inquiry, "문의응대"),
      satisfaction: toSidebarLabel(labelsSource.satisfaction, "만족도"),
      crossAnalysis: toSidebarLabel(labelsSource.crossAnalysis, "교차분석"),
      settings: toSidebarLabel(labelsSource.settings, "설정"),
    },
    icons: {
      dashboard: toSidebarIcon(iconsSource.dashboard, "🏠"),
      timeline: toSidebarIcon(iconsSource.timeline, "📅"),
      dropout: toSidebarIcon(iconsSource.dropout, "🛡️"),
      generator: toSidebarIcon(iconsSource.generator, "🛠️"),
      kpi: toSidebarIcon(iconsSource.kpi, "📊"),
      attendance: toSidebarIcon(iconsSource.attendance, "📋"),
      analytics: toSidebarIcon(iconsSource.analytics, "📈"),
      traineeHistory: toSidebarIcon(iconsSource.traineeHistory, "👤"),
      achievement: toSidebarIcon(iconsSource.achievement, "🎓"),
      inquiry: toSidebarIcon(iconsSource.inquiry, "💬"),
      satisfaction: toSidebarIcon(iconsSource.satisfaction, "❤️"),
      crossAnalysis: toSidebarIcon(iconsSource.crossAnalysis, "📊"),
      settings: toSidebarIcon(iconsSource.settings, "⚙️"),
    },
  };
}

function normalizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const row = raw as Partial<Session>;

  return {
    훈련일자: toStringValue(row.훈련일자),
    훈련시작시간: toStringValue(row.훈련시작시간),
    훈련종료시간: toStringValue(row.훈련종료시간),
    "방학/원격여부": toStringValue(row["방학/원격여부"]),
    시작시간: toStringValue(row.시작시간),
    시간구분: toStringValue(row.시간구분),
    훈련강사코드: normalizeInstructorCode(toStringValue(row.훈련강사코드)),
    "교육장소(강의실)코드": normalizeClassroomCode(toStringValue(row["교육장소(강의실)코드"])),
    "교과목(및 능력단위)코드": normalizeSubjectCode(toStringValue(row["교과목(및 능력단위)코드"])).toUpperCase(),
    과정기수: toStringValue(row.과정기수),
    normalizedDate: typeof row.normalizedDate === "string" ? row.normalizedDate : null,
    startMin: typeof row.startMin === "number" ? row.startMin : null,
    endMin: typeof row.endMin === "number" ? row.endMin : null,
  };
}

function normalizeTemplateRows(raw: unknown): TemplateRowState[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: TemplateRowState[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Partial<TemplateRowState>;
    const weekday = typeof row.weekday === "number" ? row.weekday : Number.NaN;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      continue;
    }

    rows.push({
      weekday,
      start: toStringValue(row.start),
      end: toStringValue(row.end),
      breakStart: toStringValue(row.breakStart),
      breakEnd: toStringValue(row.breakEnd),
    });
  }

  return rows;
}

function normalizeStaffingCells(raw: unknown): SavedStaffCell[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const cells: SavedStaffCell[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Partial<SavedStaffCell>;
    if (!isPhase(row.phase) || !isResourceType(row.resourceType)) {
      continue;
    }

    cells.push({
      cohort: toStringValue(row.cohort),
      phase: row.phase,
      assignee: toStringValue(row.assignee),
      startDate: toStringValue(row.startDate),
      endDate: toStringValue(row.endDate),
      resourceType: row.resourceType,
    });
  }

  return cells;
}

function normalizeTrackTypeMap(raw: unknown): Record<string, TrackType> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const map: Record<string, TrackType> = {};
  for (const [cohort, trackType] of Object.entries(raw as Record<string, unknown>)) {
    if (!cohort || !isTrackType(trackType)) {
      continue;
    }
    map[cohort] = trackType;
  }

  return map;
}

function normalizeGeneratedRanges(raw: unknown): Array<{ cohort: string; startDate: string; endDate: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const ranges: Array<{ cohort: string; startDate: string; endDate: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as { cohort?: unknown; startDate?: unknown; endDate?: unknown };
    const cohort = toStringValue(row.cohort);
    const startDate = toStringValue(row.startDate);
    const endDate = toStringValue(row.endDate);
    if (!cohort || !startDate || !endDate) {
      continue;
    }

    ranges.push({ cohort, startDate, endDate });
  }

  return ranges;
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}

function normalizeInstructorDirectory(raw: unknown): Array<{ instructorCode: string; name: string; memo: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: Array<{ instructorCode: string; name: string; memo: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { instructorCode?: unknown; name?: unknown; memo?: unknown };
    const instructorCode = normalizeInstructorCode(toStringValue(row.instructorCode));
    if (!instructorCode) {
      continue;
    }
    rows.push({
      instructorCode,
      name: toStringValue(row.name),
      memo: toStringValue(row.memo),
    });
  }

  return rows;
}

function normalizeCourseRegistry(raw: unknown): Array<{ courseId: string; courseName: string; memo: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: Array<{ courseId: string; courseName: string; memo: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as { courseId?: unknown; courseName?: unknown; memo?: unknown };
    const courseId = toStringValue(row.courseId).trim();
    if (!courseId) {
      continue;
    }
    rows.push({
      courseId,
      courseName: toStringValue(row.courseName),
      memo: toStringValue(row.memo),
    });
  }

  return rows;
}

function normalizeSubjectDirectory(
  raw: unknown,
): Array<{ courseId: string; subjectCode: string; subjectName: string; memo: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: Array<{ courseId: string; subjectCode: string; subjectName: string; memo: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { courseId?: unknown; subjectCode?: unknown; subjectName?: unknown; memo?: unknown };
    const courseId = toStringValue(row.courseId).trim() || "UNASSIGNED";
    const subjectCode = normalizeSubjectCode(toStringValue(row.subjectCode)).toUpperCase();
    if (!subjectCode) {
      continue;
    }
    rows.push({
      courseId,
      subjectCode,
      subjectName: toStringValue(row.subjectName),
      memo: toStringValue(row.memo),
    });
  }

  return rows;
}

function normalizeSubjectInstructorMappings(raw: unknown): Array<{ moduleKey: string; instructorCode: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: Array<{ moduleKey: string; instructorCode: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { moduleKey?: unknown; instructorCode?: unknown };
    const moduleKey = toStringValue(row.moduleKey).trim();
    const instructorCode = normalizeInstructorCode(toStringValue(row.instructorCode));
    if (!moduleKey || !instructorCode) {
      continue;
    }
    rows.push({ moduleKey, instructorCode });
  }

  return rows;
}

function normalizeCourseSubjectInstructorMapping(
  raw: unknown,
): Array<{ courseId: string; moduleKey: string; instructorCode: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: Array<{ courseId: string; moduleKey: string; instructorCode: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { courseId?: unknown; moduleKey?: unknown; instructorCode?: unknown };
    const courseId = toStringValue(row.courseId).trim();
    const moduleKey = toStringValue(row.moduleKey).trim();
    const instructorCode = normalizeInstructorCode(toStringValue(row.instructorCode));
    if (!courseId || !moduleKey || !instructorCode) {
      continue;
    }
    rows.push({ courseId, moduleKey, instructorCode });
  }

  return rows;
}

function normalizeCourseTemplates(raw: unknown): AppStateShared["courseTemplates"] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: AppStateShared["courseTemplates"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = toStringValue(row.name);
    const courseId = toStringValue(row.courseId).trim();
    if (!name || !courseId) {
      continue;
    }
    const subjectListRaw = Array.isArray(row.subjectList) ? row.subjectList : [];
    const subjectList = subjectListRaw
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        subjectCode: normalizeSubjectCode(toStringValue(v.subjectCode)).toUpperCase(),
        subjectName: toStringValue(v.subjectName),
        memo: toStringValue(v.memo),
      }))
      .filter((v) => v.subjectCode.length > 0);
    const mappingRaw = Array.isArray(row.subjectInstructorMapping) ? row.subjectInstructorMapping : [];
    const subjectInstructorMapping = mappingRaw
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        key: toStringValue(v.key).trim(),
        instructorCode: normalizeInstructorCode(toStringValue(v.instructorCode)),
      }))
      .filter((v) => v.key.length > 0 && v.instructorCode.length > 0);

    rows.push({
      name,
      version: toStringValue(row.version) || "v1",
      courseId,
      dayTemplates: normalizeTemplateRows(row.dayTemplates),
      holidays: normalizeStringArray(row.holidays),
      customBreaks: normalizeStringArray(row.customBreaks),
      subjectList,
      subjectInstructorMapping,
    });
  }

  return rows;
}

function normalizeStateLike(input: Record<string, unknown>): AppStateV1 {
  const scheduleGeneratorRaw =
    input.scheduleGenerator && typeof input.scheduleGenerator === "object" && !Array.isArray(input.scheduleGenerator)
      ? (input.scheduleGenerator as Record<string, unknown>)
      : {};

  const uiRaw =
    input.ui && typeof input.ui === "object" && !Array.isArray(input.ui) ? (input.ui as Record<string, unknown>) : {};
  const normalizedSubjectDirectory = normalizeSubjectDirectory(input.subjectDirectory);
  const normalizedSubjectRegistryByCourse = normalizeSubjectDirectory(input.subjectRegistryByCourse);
  const normalizedInstructorDirectory = normalizeInstructorDirectory(input.instructorDirectory);
  const normalizedInstructorRegistry = normalizeInstructorDirectory(input.instructorRegistry);

  const sessions = Array.isArray(input.sessions)
    ? input.sessions.map((item) => normalizeSession(item)).filter((item): item is Session => item !== null)
    : [];

  return {
    schemaVersion: input.schemaVersion === 1 ? 1 : undefined,
    savedAt: toStringValue(input.savedAt),
    sessions,
    cohortTrackTypes: normalizeTrackTypeMap(input.cohortTrackTypes),
    generatedCohortRanges: normalizeGeneratedRanges(input.generatedCohortRanges),
    scheduleGenerator: {
      cohort: toStringValue(scheduleGeneratorRaw.cohort),
      startDate: toStringValue(scheduleGeneratorRaw.startDate),
      totalHours: toStringValue(scheduleGeneratorRaw.totalHours),
      instructorCode: normalizeInstructorCode(toStringValue(scheduleGeneratorRaw.instructorCode)),
      classroomCode: normalizeClassroomCode(toStringValue(scheduleGeneratorRaw.classroomCode)),
      subjectCode: normalizeSubjectCode(toStringValue(scheduleGeneratorRaw.subjectCode)).toUpperCase(),
      pushToConflicts: toBooleanValue(scheduleGeneratorRaw.pushToConflicts),
      dayTemplates: normalizeTemplateRows(scheduleGeneratorRaw.dayTemplates),
      holidays: normalizeStringArray(scheduleGeneratorRaw.holidays),
      customBreaks: normalizeStringArray(scheduleGeneratorRaw.customBreaks),
      generatedResult: (scheduleGeneratorRaw.generatedResult as GenerateScheduleResult | null | undefined) ?? null,
      generatedCohort: toStringValue(scheduleGeneratorRaw.generatedCohort),
      publicHolidayLoaded: toBooleanValue(scheduleGeneratorRaw.publicHolidayLoaded),
    },
    staffingCells: normalizeStaffingCells(input.staffingCells),
    courseRegistry: normalizeCourseRegistry(input.courseRegistry),
    instructorDirectory: normalizedInstructorDirectory,
    instructorRegistry:
      normalizedInstructorRegistry.length > 0 ? normalizedInstructorRegistry : normalizedInstructorDirectory,
    subjectDirectory: normalizedSubjectDirectory,
    subjectRegistryByCourse:
      normalizedSubjectRegistryByCourse.length > 0 ? normalizedSubjectRegistryByCourse : normalizedSubjectDirectory,
    subjectInstructorMappings: normalizeSubjectInstructorMappings(input.subjectInstructorMappings),
    courseSubjectInstructorMapping: normalizeCourseSubjectInstructorMapping(input.courseSubjectInstructorMapping),
    courseTemplates: normalizeCourseTemplates(input.courseTemplates),
    ui: {
      activeConflictTab: toConflictTab(uiRaw.activeConflictTab),
      viewMode: toViewMode(uiRaw.viewMode),
      timelineViewType: toTimelineViewType(uiRaw.timelineViewType),
      showAdvanced: toBooleanValue(uiRaw.showAdvanced),
      keySearch: toStringValue(uiRaw.keySearch),
      instructorDaySearch: toStringValue(uiRaw.instructorDaySearch),
      foDaySearch: toStringValue(uiRaw.foDaySearch),
      sidebarMenu: normalizeSidebarMenuConfig(uiRaw.sidebarMenu),
    },
  };
}

export function migrateV1ToV2(state: AppStateV1): AppStateV2 {
  return {
    ...state,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

export function migrateState(state: unknown): { state: AppStateVCurrent; warnings: string[] } {
  const warnings: string[] = [];
  const input = asObject(state);

  const rawVersion = input.schemaVersion;

  if (rawVersion === undefined) {
    warnings.push("schemaVersion이 없어 v1 형식으로 간주하고 마이그레이션했습니다.");
    const normalizedV1 = normalizeStateLike(input);
    return { state: migrateV1ToV2(normalizedV1), warnings };
  }

  if (rawVersion === 1) {
    warnings.push("v1 상태 파일을 v2로 마이그레이션했습니다.");
    const normalizedV1 = normalizeStateLike(input);
    normalizedV1.schemaVersion = 1;
    return { state: migrateV1ToV2(normalizedV1), warnings };
  }

  if (rawVersion === CURRENT_SCHEMA_VERSION) {
    const normalizedV1 = normalizeStateLike(input);
    return {
      state: {
        ...normalizedV1,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      },
      warnings,
    };
  }

  throw new Error(
    `지원하지 않는 schemaVersion(${String(rawVersion)})입니다. 지원 가능한 버전: 1, ${CURRENT_SCHEMA_VERSION}`,
  );
}
