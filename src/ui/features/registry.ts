import {
  appState,
  subjectInstructorMappings,
  subjectInstructorMappingDraft,
  moduleInstructorDraft,
  type CourseRegistryEntry,
  type CourseTemplate,
  type SubjectDirectoryEntry,
} from "../appState";
import { domRefs } from "../domRefs";
import {
  normalizeCourseId,
  parseCourseGroupFromCohortName,
  parseCourseSubjectKey,
  toCourseSubjectKey,
} from "../utils/format";
import { dedupeAndSortDates } from "../utils/date";
import { normalizeInstructorCode, normalizeSubjectCode } from "../../core/standardize";
import {
  upsertInstructorInCloud,
  deleteInstructorFromCloud,
  isInstructorCloudEnabled,
} from "../../core/instructorSync";
import {
  createCourse,
  createSubject,
  saveCourseTemplate,
  deleteCourseTemplate as deleteCloudCourseTemplate,
  listCourseTemplates,
  listCourses,
  listSubjects,
  isManagementCloudEnabled,
  type CourseTemplateRecord,
} from "../../core/supabaseManagement";
import { applyCourseSubjectInstructorMappingsToCohortSessions } from "../../core/subjectMapping";
import type { TemplateRowState } from "../../core/state";
import type { InstructorDirectoryEntry } from "../../core/types";
import { pushRecentActionLog } from "./notifications";
import { renderCourseTemplateOptions } from "./courseTemplates";

type RegistryDeps = {
  scheduleAutoSave: () => void;
  markQuickNavUpdated: (section: "course" | "subject" | "instructor" | "mapping") => void;
  renderGlobalWarnings: () => void;
  setStaffingStatus: (msg: string, isError?: boolean) => void;
  recomputeTimeConflictsImmediate: () => void;
  regenerateSummariesAndTimeline: (cohort?: string) => void;
  buildModuleAssignSummaries: () => Array<{
    moduleKey: string;
    cohort: string;
    module: string;
    startDate: string;
    endDate: string;
    sessionCount: number;
    instructorCodes: string[];
    missingInstructorSessions: number;
  }>;
  isCloudAccessAllowed: () => boolean;
};

const defaultDeps: RegistryDeps = {
  scheduleAutoSave: () => {},
  markQuickNavUpdated: () => {},
  renderGlobalWarnings: () => {},
  setStaffingStatus: () => {},
  recomputeTimeConflictsImmediate: () => {},
  regenerateSummariesAndTimeline: () => {},
  buildModuleAssignSummaries: () => [],
  isCloudAccessAllowed: () => false,
};

let deps: RegistryDeps = defaultDeps;

export function initRegistryFeature(nextDeps: RegistryDeps): void {
  deps = nextDeps;
}

export function ensureCourseRegistryDefaults(): void {
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

export function renderCourseSelectOptions(): void {
  const sortedCourses = [...appState.courseRegistry].sort((a, b) => a.courseId.localeCompare(b.courseId));
  const optionTargets = [domRefs.subjectCourseSelect, domRefs.mappingCourseSelect, domRefs.courseTemplateCourseSelect];

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

export function renderCourseRegistry(): void {
  ensureCourseRegistryDefaults();
  domRefs.courseRegistryBody.innerHTML = "";

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
      domRefs.courseIdInput.value = entry.courseId;
      domRefs.courseNameInput.value = entry.courseName;
      domRefs.courseMemoInput.value = entry.memo;
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
      deps.scheduleAutoSave();
    });

    actionTd.appendChild(editButton);
    actionTd.appendChild(removeButton);
    tr.appendChild(courseIdTd);
    tr.appendChild(nameTd);
    tr.appendChild(memoTd);
    tr.appendChild(actionTd);
    domRefs.courseRegistryBody.appendChild(tr);
  }
}

export function upsertCourseRegistryEntry(): void {
  const courseId = normalizeCourseId(domRefs.courseIdInput.value);
  const courseName = domRefs.courseNameInput.value.trim();
  const memo = domRefs.courseMemoInput.value.trim();

  if (!courseId || !courseName) {
    deps.setStaffingStatus("과정 ID와 과정명은 필수입니다.", true);
    return;
  }

  const existing = appState.courseRegistry.find((item) => item.courseId === courseId);
  if (existing) {
    existing.courseName = courseName;
    existing.memo = memo;
  } else {
    appState.courseRegistry.push({ courseId, courseName, memo });
  }

  domRefs.courseIdInput.value = "";
  domRefs.courseNameInput.value = "";
  domRefs.courseMemoInput.value = "";
  renderCourseRegistry();
  renderCourseSelectOptions();
  renderSubjectDirectory();
  renderSubjectMappingTable();
  deps.markQuickNavUpdated("course");
  deps.scheduleAutoSave();
  void syncCourseRegistryCloud({ courseId, courseName, memo });
}

export function renderInstructorDirectory(): void {
  domRefs.instructorDirectoryBody.innerHTML = "";

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
      domRefs.instructorCodeInput.value = entry.instructorCode;
      domRefs.instructorNameInput.value = entry.name;
      domRefs.instructorMemoInput.value = entry.memo;
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
      deps.scheduleAutoSave();
      await syncInstructorDirectoryCloud("delete", removedCode);
    });

    actionTd.appendChild(editButton);
    actionTd.appendChild(removeButton);
    tr.appendChild(codeTd);
    tr.appendChild(nameTd);
    tr.appendChild(memoTd);
    tr.appendChild(actionTd);
    domRefs.instructorDirectoryBody.appendChild(tr);
  }
}

export function upsertInstructorDirectoryEntry(): void {
  const instructorCode = normalizeInstructorCode(domRefs.instructorCodeInput.value);
  if (!instructorCode) {
    deps.setStaffingStatus("강사코드를 입력해 주세요.", true);
    return;
  }

  const name = domRefs.instructorNameInput.value.trim();
  const memo = domRefs.instructorMemoInput.value.trim();
  const existing = appState.instructorDirectory.find((item) => item.instructorCode === instructorCode);
  if (existing) {
    existing.name = name;
    existing.memo = memo;
  } else {
    appState.instructorDirectory.push({ instructorCode, name, memo });
  }

  domRefs.instructorCodeInput.value = "";
  domRefs.instructorNameInput.value = "";
  domRefs.instructorMemoInput.value = "";
  renderInstructorDirectory();
  renderSubjectMappingTable();
  deps.markQuickNavUpdated("instructor");
  deps.scheduleAutoSave();
  void syncInstructorDirectoryCloud("upsert", instructorCode, { instructorCode, name, memo });
}

export function renderSubjectDirectory(): void {
  domRefs.subjectDirectoryBody.innerHTML = "";
  const selectedCourseId = normalizeCourseId(domRefs.subjectCourseSelect.value);
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
      domRefs.subjectCourseSelect.value = entry.courseId;
      domRefs.subjectCodeInput.value = entry.subjectCode;
      domRefs.subjectNameInput.value = entry.subjectName;
      domRefs.subjectMemoInput.value = entry.memo;
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "삭제";
    deleteButton.addEventListener("click", () => {
      appState.subjectDirectory = appState.subjectDirectory.filter(
        (item) => !(item.courseId === entry.courseId && item.subjectCode === entry.subjectCode),
      );
      subjectInstructorMappings.delete(toCourseSubjectKey(entry.courseId, entry.subjectCode));
      renderSubjectDirectory();
      renderSubjectMappingTable();
      deps.scheduleAutoSave();
    });

    actionTd.appendChild(editButton);
    actionTd.appendChild(deleteButton);

    tr.appendChild(codeTd);
    tr.appendChild(nameTd);
    tr.appendChild(memoTd);
    tr.appendChild(actionTd);
    domRefs.subjectDirectoryBody.appendChild(tr);
  }
}

export function upsertSubjectDirectoryEntry(): void {
  const courseId = normalizeCourseId(domRefs.subjectCourseSelect.value);
  if (!courseId) {
    deps.setStaffingStatus("교과목을 저장할 과정을 먼저 선택해 주세요.", true);
    return;
  }

  const subjectCode = normalizeSubjectCode(domRefs.subjectCodeInput.value).toUpperCase();
  if (!subjectCode) {
    deps.setStaffingStatus("교과목코드를 입력해 주세요.", true);
    return;
  }

  const subjectName = domRefs.subjectNameInput.value.trim();
  const memo = domRefs.subjectMemoInput.value.trim();
  const existing = appState.subjectDirectory.find(
    (item) => item.courseId === courseId && item.subjectCode === subjectCode,
  );
  if (existing) {
    existing.subjectName = subjectName;
    existing.memo = memo;
  } else {
    appState.subjectDirectory.push({ courseId, subjectCode, subjectName, memo });
  }

  domRefs.subjectCodeInput.value = "";
  domRefs.subjectNameInput.value = "";
  domRefs.subjectMemoInput.value = "";
  renderSubjectDirectory();
  renderSubjectMappingTable();
  deps.markQuickNavUpdated("subject");
  deps.scheduleAutoSave();
  void syncSubjectDirectoryCloud({ courseId, subjectCode, subjectName, memo });
}

export function renderSubjectMappingTable(): void {
  domRefs.subjectMappingContainer.innerHTML = "";
  const selectedCourseId = normalizeCourseId(domRefs.mappingCourseSelect.value);
  if (!selectedCourseId) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "과정을 먼저 등록하고 선택하세요.";
    domRefs.subjectMappingContainer.appendChild(empty);
    return;
  }

  const summaries = deps.buildModuleAssignSummaries().filter(
    (summary) => normalizeCourseId(parseCourseGroupFromCohortName(summary.cohort).course) === selectedCourseId,
  );
  if (summaries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "선택한 과정의 수업시간표가 없습니다.";
    domRefs.subjectMappingContainer.appendChild(empty);
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
      (item) => item.courseId === selectedCourseId && item.subjectCode === summary.module,
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
  domRefs.subjectMappingContainer.appendChild(table);
}

export function applySubjectMappingsToSessions(): void {
  const selectedCohort = domRefs.cohortSelect.value.trim();
  if (!selectedCohort) {
    deps.setStaffingStatus("먼저 적용할 기수를 선택해 주세요.", true);
    return;
  }

  const cohortCourseId = normalizeCourseId(parseCourseGroupFromCohortName(selectedCohort).course);
  const selectedCourseId = normalizeCourseId(domRefs.mappingCourseSelect.value || cohortCourseId);
  if (selectedCourseId !== cohortCourseId) {
    deps.setStaffingStatus("선택 기수와 다른 과정이 선택되었습니다. 동일 과정으로 맞춰 주세요.", true);
    return;
  }

  const courseSubjects = appState.subjectDirectory.filter((item) => item.courseId === selectedCourseId);
  const subjectDirectoryCodes = new Set(courseSubjects.map((item) => item.subjectCode));
  const cohortSessionSubjects = new Set(
    appState.sessions
      .filter((session) => session.과정기수.trim() === selectedCohort)
      .map((session) => normalizeSubjectCode(session["교과목(및 능력단위)코드"]).toUpperCase())
      .filter((value) => value.length > 0),
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
      subjectInstructorMappingDraft.get(mappingKey) ?? subjectInstructorMappings.get(mappingKey) ?? "",
    );
    if (!selectedCode) {
      continue;
    }

    subjectInstructorMappings.set(mappingKey, selectedCode);
    normalizedMappings.push({
      cohort: selectedCohort,
      subjectCode: subject.subjectCode,
      instructorCode: selectedCode,
    });
  }

  const applyResult = applyCourseSubjectInstructorMappingsToCohortSessions(
    appState.sessions,
    selectedCohort,
    normalizedMappings.map((item) => ({
      courseId: selectedCourseId,
      subjectCode: item.subjectCode,
      instructorCode: item.instructorCode,
    })),
    subjectDirectoryCodes,
  );
  const updatedRows = applyResult.updatedRows;
  const overwriteRows = applyResult.overwrittenRows;

  if (updatedRows === 0) {
    deps.setStaffingStatus("적용할 교과목 매핑이 없습니다.", true);
    return;
  }

  appState.sessions = applyResult.sessions.map((session) => ({
    ...session,
    "교과목(및 능력단위)코드": normalizeSubjectCode(session["교과목(및 능력단위)코드"]).toUpperCase(),
  }));
  moduleInstructorDraft.clear();
  subjectInstructorMappingDraft.clear();
  deps.regenerateSummariesAndTimeline(selectedCohort);
  deps.recomputeTimeConflictsImmediate();
  deps.scheduleAutoSave();

  deps.setStaffingStatus(
    overwriteRows > 0
      ? `교과목 매핑 일괄 적용 완료: ${updatedRows}개 수업시간표 반영 (${overwriteRows}개 덮어씀)`
      : `교과목 매핑 일괄 적용 완료: ${updatedRows}개 수업시간표 반영`,
  );
  if (missingSubjectCount > 0) {
    pushRecentActionLog(
      "WARNING",
      `경고: 교과목 미등록 ${missingSubjectCount}개 (HRD 다운로드는 가능)`,
      "instructorDrawer",
    );
  }
  pushRecentActionLog("INFO", `강사 매핑 적용: 교과목 ${normalizedMappings.length}개 업데이트`, "instructorDrawer");
  deps.markQuickNavUpdated("mapping");
}

export async function syncInstructorDirectoryCloud(
  mode: "upsert" | "delete",
  instructorCode: string,
  payload?: InstructorDirectoryEntry,
): Promise<void> {
  if (!deps.isCloudAccessAllowed()) {
    return;
  }

  if (!isInstructorCloudEnabled()) {
    appState.instructorDirectoryCloudWarning =
      "클라우드 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 설정을 확인해 주세요.";
    deps.renderGlobalWarnings();
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
    deps.renderGlobalWarnings();
  }
}

export async function syncCourseRegistryCloud(entry: CourseRegistryEntry): Promise<void> {
  if (!deps.isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    appState.managementCloudWarning =
      "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    deps.renderGlobalWarnings();
    return;
  }

  try {
    await createCourse({ courseId: entry.courseId, courseName: entry.courseName });
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `과정 동기화 실패: ${message}`;
  } finally {
    deps.renderGlobalWarnings();
  }
}

export async function syncSubjectDirectoryCloud(entry: SubjectDirectoryEntry): Promise<void> {
  if (!deps.isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    appState.managementCloudWarning =
      "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    deps.renderGlobalWarnings();
    return;
  }

  try {
    await createSubject({
      courseId: entry.courseId,
      subjectCode: entry.subjectCode,
      subjectName: entry.subjectName,
    });
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `교과목 동기화 실패: ${message}`;
  } finally {
    deps.renderGlobalWarnings();
  }
}

export async function syncCourseTemplateCloud(template: CourseTemplate): Promise<void> {
  if (!deps.isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    appState.managementCloudWarning =
      "클라우드 관리 동기화 비활성화: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인해 주세요.";
    deps.renderGlobalWarnings();
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
        subjectInstructorMapping: template.subjectInstructorMapping,
      },
    });
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `템플릿 동기화 실패: ${message}`;
  } finally {
    deps.renderGlobalWarnings();
  }
}

export async function syncDeleteCourseTemplateCloud(courseId: string, templateName: string): Promise<void> {
  if (!deps.isCloudAccessAllowed()) {
    return;
  }

  if (!isManagementCloudEnabled()) {
    return;
  }

  try {
    await deleteCloudCourseTemplate(courseId, templateName);
    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `템플릿 삭제 동기화 실패: ${message}`;
  } finally {
    deps.renderGlobalWarnings();
  }
}

export function toCourseTemplateFromCloudRecord(record: CourseTemplateRecord): CourseTemplate {
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
        breakEnd: typeof row.breakEnd === "string" ? row.breakEnd : "",
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
      const subjectCode = normalizeSubjectCode(
        typeof row.subjectCode === "string" ? row.subjectCode : "",
      ).toUpperCase();
      if (!subjectCode) {
        continue;
      }
      rows.push({
        subjectCode,
        subjectName: typeof row.subjectName === "string" ? row.subjectName.trim() : "",
        memo: typeof row.memo === "string" ? row.memo.trim() : "",
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
    typeof sourceRecord.courseId === "string" ? sourceRecord.courseId : record.courseId,
  );

  return {
    name: record.templateName,
    version:
      typeof sourceRecord.version === "string" && sourceRecord.version.trim() ? sourceRecord.version.trim() : "v1",
    courseId: templateCourseId,
    dayTemplates: readTemplateRows(sourceRecord.dayTemplates),
    holidays: dedupeAndSortDates(readStringList(sourceRecord.holidays)),
    customBreaks: dedupeAndSortDates(readStringList(sourceRecord.customBreaks)),
    subjectList: readSubjectList(sourceRecord.subjectList),
    subjectInstructorMapping: readSubjectInstructorMapping(sourceRecord.subjectInstructorMapping),
  };
}

export async function loadManagementDataFromCloudFallback(): Promise<void> {
  if (!deps.isCloudAccessAllowed()) {
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
          memo: "",
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
          memo: "",
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
      deps.scheduleAutoSave();
      domRefs.stateStorageStatus.textContent = `클라우드 관리 데이터 동기화 완료 (${new Date().toLocaleTimeString()})`;
    }

    appState.managementCloudWarning = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appState.managementCloudWarning = `클라우드 관리 데이터 동기화 실패: ${message}`;
  } finally {
    deps.renderGlobalWarnings();
  }
}
