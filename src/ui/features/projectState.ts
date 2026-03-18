import {
  CURRENT_SCHEMA_VERSION,
  migrateState,
  type AppStateVCurrent,
  type SavedStaffCell,
  type TemplateRowState,
} from "../../core/state";
import {
  isInstructorCloudEnabled,
  loadInstructorDirectoryFromCloud,
  mergeWithLocalInstructorDirectory,
} from "../../core/instructorSync";
import { normalizeInstructorCode, normalizeSubjectCode } from "../../core/standardize";
import { resolveShowAdvancedPolicy } from "../../core/showAdvancedPolicy";
import { isDevRuntime, isProdRuntime } from "../../core/env";
import {
  type GenerateScheduleResult,
  type InstructorDirectoryEntry,
  type Phase,
  type Session,
  type TrackType,
} from "../../core/types";
import { dedupeAndSortDates, getTodayCompactDate, parseIsoDate } from "../utils/date";
import {
  estimateUtf8SizeBytes,
  formatBytes,
  isPhase,
  isResourceType,
  isTrackType,
  normalizeCourseId,
  parseCourseGroupFromCohortName,
  parseCourseSubjectKey,
  toCourseSubjectKey,
} from "../utils/format";
import {
  appState,
  cohortTrackType,
  generatedCohortRanges,
  moduleInstructorDraft,
  staffingCellState,
  subjectInstructorMappingDraft,
  subjectInstructorMappings,
  type StaffCellState,
  type StaffingMode,
  type ViewMode,
} from "../appState";
import { domRefs } from "../domRefs";
import {
  normalizeSidebarMenuConfig,
  getDefaultSidebarMenuConfig,
  saveSidebarMenuConfig,
  cloneSidebarMenuConfig,
  applySidebarMenuConfigToSidebar,
} from "./sidebarMenu";
import {
  setConflictTab,
  resetConflictsBeforeCompute,
  applyConflictFilters,
  applyInstructorDayFilters,
  applyFoDayFilters,
} from "./conflicts";
import { setTimelineViewType } from "./timeline";
import { loadManagementDataFromCloudFallback } from "./registry";

// ---------------------------------------------------------------------------
// Constants (local to this module)
// ---------------------------------------------------------------------------

const PHASES: Phase[] = ["P1", "P2", "365"];
const STORAGE_KEY = "academic_schedule_manager_state_v1";
const STORAGE_WARN_BYTES = 4_500_000;
const AUTO_SAVE_DEBOUNCE_MS = 500;
const DEFAULT_COMPUTE_LABEL = "충돌 계산";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function staffCellKey(cohort: string, phase: Phase): string {
  return `${cohort}|||${phase}`;
}

function resolveShowAdvanced(savedShowAdvanced: boolean | undefined): boolean {
  return resolveShowAdvancedPolicy({
    savedShowAdvanced,
    search: window.location.search,
    isDev: isDevRuntime(),
    isProd: isProdRuntime(),
  });
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

type ProjectStateDeps = {
  getStaffCellState: (cohort: string, phase: Phase) => StaffCellState;
  renderInitialUiState: () => void;
  updateActionStates: () => void;
  regenerateSummariesAndTimeline: (preferredCohort?: string) => void;
  applyViewMode: (mode: ViewMode) => void;
  applyShowAdvancedMode: (enabled: boolean) => void;
  applyStaffingMode: (mode: StaffingMode) => void;
  setStateMigrationWarnings: (warnings: string[]) => void;
  refreshHrdValidation: () => void;
  renderHolidayAndBreakLists: () => void;
  renderGeneratedScheduleResult: () => void;
  renderErrors: () => void;
  renderHrdValidationErrors: () => void;
  renderTimeConflicts: () => void;
  collectTemplateRowsState: () => TemplateRowState[];
  applyTemplateRowsState: (rows: TemplateRowState[] | undefined) => void;
  renderScheduleTemplateOptions: (preferredName?: string) => void;
};

const defaultDeps: ProjectStateDeps = {
  getStaffCellState: () => ({ assignee: "", startDate: "", endDate: "", resourceType: "FACILITATOR" }),
  renderInitialUiState: () => {},
  updateActionStates: () => {},
  regenerateSummariesAndTimeline: () => {},
  applyViewMode: () => {},
  applyShowAdvancedMode: () => {},
  applyStaffingMode: () => {},
  setStateMigrationWarnings: () => {},
  refreshHrdValidation: () => {},
  renderHolidayAndBreakLists: () => {},
  renderGeneratedScheduleResult: () => {},
  renderErrors: () => {},
  renderHrdValidationErrors: () => {},
  renderTimeConflicts: () => {},
  collectTemplateRowsState: () => [],
  applyTemplateRowsState: () => {},
  renderScheduleTemplateOptions: () => {},
};

let deps: ProjectStateDeps = defaultDeps;

export function initProjectStateFeature(nextDeps: ProjectStateDeps): void {
  deps = nextDeps;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function collectSavedStaffingCells(): SavedStaffCell[] {
  const cells: SavedStaffCell[] = [];

  for (const range of appState.staffingCohortRanges) {
    for (const phase of PHASES) {
      const state = deps.getStaffCellState(range.cohort, phase);
      if (!state.assignee && !state.startDate && !state.endDate) {
        continue;
      }

      cells.push({
        cohort: range.cohort,
        phase,
        assignee: state.assignee,
        startDate: state.startDate,
        endDate: state.endDate,
        resourceType: state.resourceType,
      });
    }
  }

  return cells;
}

export function normalizeInstructorDirectoryEntries(rawInstructors: unknown): InstructorDirectoryEntry[] {
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
      memo: typeof record.memo === "string" ? record.memo.trim() : "",
    });
  }

  return entries;
}

export function mergeInstructorDirectoryWarning(sizeWarning: string): string {
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

export async function loadInstructorDirectoryWithCloudFallback(
  localInstructors: InstructorDirectoryEntry[],
): Promise<InstructorDirectoryEntry[]> {
  if (!appState.isAuthVerified) {
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
      appState.instructorDirectoryCloudWarning =
        localInstructors.length > 0
          ? "클라우드 강사 목록을 병합했습니다."
          : "클라우드 강사 목록을 가져와 적용했습니다.";
    } else {
      appState.instructorDirectoryCloudWarning =
        localInstructors.length > 0 ? "" : "클라우드에 저장된 강사 목록이 없습니다. 로컬 데이터를 사용합니다.";
    }
    return mergeWithLocalInstructorDirectory(localInstructors, cloudInstructors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.instructorDirectoryCloudWarning = `클라우드 강사 목록 동기화 실패: ${message}. 로컬 데이터를 사용합니다.`;
    return localInstructors;
  }
}

export function getStorageWarningMessage(bytes: number): string {
  if (bytes < STORAGE_WARN_BYTES) {
    return "";
  }

  return `저장 데이터가 큽니다 (${formatBytes(bytes)}). localStorage 용량 초과 가능성이 있으니 JSON 파일 백업을 권장합니다.`;
}

export function serializeProjectState(): AppStateVCurrent {
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
      cohort: domRefs.scheduleCohortInput.value,
      startDate: domRefs.scheduleStartDateInput.value,
      totalHours: domRefs.scheduleTotalHoursInput.value,
      instructorCode: domRefs.scheduleInstructorCodeInput.value,
      classroomCode: domRefs.scheduleClassroomCodeInput.value,
      subjectCode: domRefs.scheduleSubjectCodeInput.value,
      pushToConflicts: domRefs.pushScheduleToConflicts.checked,
      dayTemplates: deps.collectTemplateRowsState(),
      holidays: [...appState.holidayDates],
      customBreaks: [...appState.customBreakDates],
      generatedResult: appState.generatedScheduleResult,
      generatedCohort: appState.generatedScheduleCohort,
      publicHolidayLoaded: appState.hasLoadedPublicHoliday,
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
      memo: item.memo,
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
          instructorCode: normalizeInstructorCode(instructorCode),
        };
      })
      .filter((item) => item.courseId.length > 0 && item.moduleKey.length > 0 && item.instructorCode.length > 0),
    courseTemplates: appState.courseTemplates,
    ui: {
      activeConflictTab: appState.activeConflictTab,
      viewMode: appState.viewMode,
      timelineViewType: appState.timelineViewType,
      showAdvanced: appState.showAdvanced,
      keySearch: domRefs.keySearchInput.value,
      instructorDaySearch: domRefs.instructorDaySearchInput.value,
      foDaySearch: domRefs.foDaySearchInput.value,
      sidebarMenu: normalizeSidebarMenuConfig(appState.sidebarMenuDraft),
    },
  };
}

export function scheduleAutoSave(): void {
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

export function saveProjectToLocalStorage(showMessage = false): void {
  try {
    const state = serializeProjectState();
    const payload = JSON.stringify(state);
    const bytes = estimateUtf8SizeBytes(payload);

    localStorage.setItem(STORAGE_KEY, payload);
    domRefs.stateStorageWarning.textContent = getStorageWarningMessage(bytes);
    domRefs.stateStorageStatus.textContent = `자동저장 완료 (${new Date().toLocaleTimeString()}) / ${formatBytes(bytes)}`;
    if (showMessage) {
      domRefs.stateStorageStatus.textContent = `저장 완료 (${new Date().toLocaleTimeString()}) / ${formatBytes(bytes)}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    domRefs.stateStorageWarning.textContent = `자동저장 실패: ${message}`;
    domRefs.stateStorageStatus.textContent = "자동저장 실패";
  }
}

export function applyLoadedProjectState(raw: unknown, instructorDirectoryOverride?: InstructorDirectoryEntry[]): void {
  const migrated = migrateState(raw);
  const state = migrated.state;
  deps.setStateMigrationWarnings(migrated.warnings);

  appState.isApplyingProjectState = true;
  try {
    appState.sessions = Array.isArray(state.sessions) ? (state.sessions as Session[]) : [];
    moduleInstructorDraft.clear();
    subjectInstructorMappingDraft.clear();
    appState.parseErrors = [];

    const scheduleState = state.scheduleGenerator;
    appState.holidayDates = dedupeAndSortDates(Array.isArray(scheduleState?.holidays) ? scheduleState.holidays : []);
    appState.customBreakDates = dedupeAndSortDates(
      Array.isArray(scheduleState?.customBreaks) ? scheduleState.customBreaks : [],
    );
    appState.generatedScheduleResult =
      (scheduleState?.generatedResult as GenerateScheduleResult | null | undefined) ?? null;
    appState.generatedScheduleCohort = scheduleState?.generatedCohort ?? "";
    appState.hasLoadedPublicHoliday = Boolean(scheduleState?.publicHolidayLoaded);

    domRefs.scheduleCohortInput.value = scheduleState?.cohort ?? "";
    domRefs.scheduleStartDateInput.value = scheduleState?.startDate ?? domRefs.scheduleStartDateInput.value;
    domRefs.scheduleTotalHoursInput.value = scheduleState?.totalHours ?? domRefs.scheduleTotalHoursInput.value;
    domRefs.scheduleInstructorCodeInput.value = scheduleState?.instructorCode ?? "";
    domRefs.scheduleClassroomCodeInput.value = scheduleState?.classroomCode ?? "";
    domRefs.scheduleSubjectCodeInput.value = scheduleState?.subjectCode ?? "";
    domRefs.pushScheduleToConflicts.checked = Boolean(scheduleState?.pushToConflicts);

    deps.applyTemplateRowsState(Array.isArray(scheduleState?.dayTemplates) ? scheduleState.dayTemplates : undefined);
    deps.renderScheduleTemplateOptions();

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
          resourceType,
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
              : [],
        );
    appState.instructorDirectory = instructorSource
      .map((item) => ({
        instructorCode: normalizeInstructorCode(item.instructorCode),
        name: item.name ?? "",
        memo: item.memo ?? "",
      }))
      .filter((item) => item.instructorCode.length > 0)
      .sort((a, b) => a.instructorCode.localeCompare(b.instructorCode));

    appState.courseRegistry = Array.isArray(state.courseRegistry)
      ? state.courseRegistry.map((item) => ({
          courseId: normalizeCourseId(item.courseId),
          courseName: item.courseName ?? "",
          memo: item.memo ?? "",
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
      memo: item.memo ?? "",
    }));
    appState.subjectDirectory = appState.subjectDirectory.filter(
      (item) => item.courseId.length > 0 && item.subjectCode.length > 0,
    );
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

    deps.regenerateSummariesAndTimeline();
    resetConflictsBeforeCompute();
    domRefs.computeConflictsButton.textContent = DEFAULT_COMPUTE_LABEL;

    const ui = state.ui;
    const loadedSidebarMenu = ui?.sidebarMenu;
    // 마이그레이션: 이전 사이드바 설정(기수 일정 생성기, 설정 순서 등)이면 기본값으로 리셋
    const needsMigration =
      loadedSidebarMenu &&
      (loadedSidebarMenu.labels?.generator?.includes("기수") ||
        loadedSidebarMenu.order?.indexOf("settings") < loadedSidebarMenu.order?.indexOf("attendance"));
    if (loadedSidebarMenu && !needsMigration) {
      appState.sidebarMenuConfig = normalizeSidebarMenuConfig({
        order: loadedSidebarMenu.order,
        labels: loadedSidebarMenu.labels,
        icons: loadedSidebarMenu.icons,
      });
    } else {
      appState.sidebarMenuConfig = getDefaultSidebarMenuConfig();
    }
    appState.sidebarMenuDraft = cloneSidebarMenuConfig(appState.sidebarMenuConfig);
    applySidebarMenuConfigToSidebar(appState.sidebarMenuConfig);
    saveSidebarMenuConfig(appState.sidebarMenuConfig);

    deps.applyViewMode(ui?.viewMode === "simple" ? "simple" : "full");
    setTimelineViewType(ui?.timelineViewType ?? "COHORT_TIMELINE");
    deps.applyStaffingMode(domRefs.staffingModeSelect.value === "advanced" ? "advanced" : "manager");
    deps.applyShowAdvancedMode(resolveShowAdvanced(ui?.showAdvanced));
    domRefs.keySearchInput.value = ui?.keySearch ?? "";
    domRefs.instructorDaySearchInput.value = ui?.instructorDaySearch ?? "";
    domRefs.foDaySearchInput.value = ui?.foDaySearch ?? "";

    deps.renderHolidayAndBreakLists();
    deps.renderGeneratedScheduleResult();
    deps.renderErrors();
    deps.refreshHrdValidation();
    applyConflictFilters();
    applyInstructorDayFilters();
    applyFoDayFilters();

    const tab = ui?.activeConflictTab;
    setConflictTab(tab === "time" || tab === "instructor_day" || tab === "fo_day" ? tab : "time");

    domRefs.uploadStatus.textContent =
      appState.sessions.length > 0 ? `현재 수업시간표 ${appState.sessions.length}건` : "대기중";
    domRefs.stateStorageStatus.textContent = `프로젝트 불러오기 완료 (${new Date().toLocaleTimeString()})`;
  } finally {
    appState.isApplyingProjectState = false;
    deps.updateActionStates();
  }
}

export async function loadProjectStateFromLocalStorage(): Promise<void> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    domRefs.stateStorageStatus.textContent = "자동저장 대기";
    domRefs.stateStorageWarning.textContent = "";
    deps.setStateMigrationWarnings([]);
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
          : [],
    );
    const resolvedInstructorDirectory = await loadInstructorDirectoryWithCloudFallback(localInstructors);
    applyLoadedProjectState(parsed, resolvedInstructorDirectory);
    await loadManagementDataFromCloudFallback();
    const bytes = estimateUtf8SizeBytes(raw);
    const sizeWarning = getStorageWarningMessage(bytes);
    domRefs.stateStorageWarning.textContent = mergeInstructorDirectoryWarning(sizeWarning);
    domRefs.stateStorageStatus.textContent = `자동저장 상태 복원 (${formatBytes(bytes)})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    domRefs.stateStorageWarning.textContent = `저장 상태를 복원하지 못했습니다: ${message}`;
    domRefs.stateStorageStatus.textContent = "자동저장 복원 실패";
    deps.setStateMigrationWarnings([]);
    deps.renderInitialUiState();
  }
}

export function downloadProjectStateJson(): void {
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

export async function importProjectStateFromFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  applyLoadedProjectState(parsed);
  scheduleAutoSave();
}

export function resetAllStateWithConfirm(): void {
  const ok = window.confirm("저장된 프로젝트 상태와 현재 화면 데이터를 모두 초기화하시겠습니까?");
  if (!ok) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}
