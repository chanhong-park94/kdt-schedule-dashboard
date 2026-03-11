import { appState, subjectInstructorMappings, type CourseTemplate } from "../appState";
import { domRefs } from "../domRefs";
import { normalizeCourseId, parseCourseSubjectKey } from "../utils/format";
import { dedupeAndSortDates } from "../utils/date";
import { applyCourseTemplateToState } from "../../core/courseTemplateApply";
import { pushRecentActionLog } from "./notifications";
import type { TemplateRowState } from "../../core/state";

type CourseTemplatesDeps = {
  scheduleAutoSave: () => void;
  collectTemplateRowsState: () => TemplateRowState[];
  applyTemplateRowsState: (rows: TemplateRowState[]) => void;
  renderHolidayAndBreakLists: () => void;
  renderSubjectDirectory: () => void;
  renderSubjectMappingTable: () => void;
  syncCourseTemplateCloud: (template: CourseTemplate) => Promise<void>;
  syncDeleteCourseTemplateCloud: (courseId: string, name: string) => Promise<void>;
};

const defaultDeps: CourseTemplatesDeps = {
  scheduleAutoSave: () => {},
  collectTemplateRowsState: () => [],
  applyTemplateRowsState: () => {},
  renderHolidayAndBreakLists: () => {},
  renderSubjectDirectory: () => {},
  renderSubjectMappingTable: () => {},
  syncCourseTemplateCloud: async () => {},
  syncDeleteCourseTemplateCloud: async () => {},
};

let deps: CourseTemplatesDeps = defaultDeps;

export function initCourseTemplatesFeature(nextDeps: CourseTemplatesDeps): void {
  deps = nextDeps;
}

export function buildCourseTemplateOptionValue(template: CourseTemplate): string {
  return `${template.courseId}|||${template.name}`;
}

export function parseCourseTemplateOptionValue(value: string): { courseId: string; name: string } {
  const [courseIdRaw, nameRaw] = value.split("|||");
  return {
    courseId: normalizeCourseId(courseIdRaw ?? ""),
    name: (nameRaw ?? "").trim(),
  };
}

export function renderCourseTemplateOptions(preferredValue = ""): void {
  const courseTemplateCourseSelect = domRefs.courseTemplateCourseSelect;
  const courseTemplateSelect = domRefs.courseTemplateSelect;
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
  courseTemplateSelect.value = hasPrevious ? previous : buildCourseTemplateOptionValue(templates[0]);
}

export function saveCurrentCourseTemplate(): void {
  const courseTemplateCourseSelect = domRefs.courseTemplateCourseSelect;
  const courseTemplateNameInput = domRefs.courseTemplateNameInput;
  const courseTemplateStatus = domRefs.courseTemplateStatus;
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
    dayTemplates: deps.collectTemplateRowsState(),
    holidays: [...appState.holidayDates],
    customBreaks: [...appState.customBreakDates],
    subjectList,
    subjectInstructorMapping,
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
  deps.scheduleAutoSave();
  void deps.syncCourseTemplateCloud(template);
}

export function applySelectedCourseTemplate(): void {
  const courseTemplateCourseSelect = domRefs.courseTemplateCourseSelect;
  const courseTemplateSelect = domRefs.courseTemplateSelect;
  const courseTemplateStatus = domRefs.courseTemplateStatus;
  const subjectCourseSelect = domRefs.subjectCourseSelect;
  const mappingCourseSelect = domRefs.mappingCourseSelect;
  const selected = parseCourseTemplateOptionValue(courseTemplateSelect.value);
  const template = appState.courseTemplates.find(
    (item) => item.courseId === selected.courseId && item.name === selected.name,
  );
  if (!template) {
    courseTemplateStatus.textContent = "불러올 템플릿을 찾을 수 없습니다.";
    return;
  }

  const applied = applyCourseTemplateToState({
    subjectDirectory: appState.subjectDirectory,
    subjectInstructorMappings: Array.from(subjectInstructorMappings.entries()).map(([key, instructorCode]) => ({
      key,
      instructorCode,
    })),
    template,
  });

  deps.applyTemplateRowsState(applied.dayTemplates);
  appState.holidayDates = dedupeAndSortDates(applied.holidays);
  appState.customBreakDates = dedupeAndSortDates(applied.customBreaks);
  deps.renderHolidayAndBreakLists();
  appState.subjectDirectory = applied.subjectDirectory;
  subjectInstructorMappings.clear();
  for (const row of applied.subjectInstructorMappings) {
    subjectInstructorMappings.set(row.key, row.instructorCode);
  }

  subjectCourseSelect.value = template.courseId;
  mappingCourseSelect.value = template.courseId;
  courseTemplateCourseSelect.value = template.courseId;
  renderCourseTemplateOptions(buildCourseTemplateOptionValue(template));
  deps.renderSubjectDirectory();
  deps.renderSubjectMappingTable();
  courseTemplateStatus.textContent =
    `템플릿 적용 완료: ${template.courseId} ` +
    `(교과목 ${applied.overwrite.subjectEntriesReplaced}개/매핑 ${applied.overwrite.mappingEntriesReplaced}개 overwrite)`;
  pushRecentActionLog("INFO", `템플릿 적용 완료: ${template.courseId}`, "sectionScheduleGenerate");
  deps.scheduleAutoSave();
}

export function deleteSelectedCourseTemplate(): void {
  const courseTemplateSelect = domRefs.courseTemplateSelect;
  const courseTemplateStatus = domRefs.courseTemplateStatus;
  const selected = parseCourseTemplateOptionValue(courseTemplateSelect.value);
  if (!selected.courseId || !selected.name) {
    courseTemplateStatus.textContent = "삭제할 템플릿을 선택해 주세요.";
    return;
  }

  const nextTemplates = appState.courseTemplates.filter(
    (item) => !(item.courseId === selected.courseId && item.name === selected.name),
  );
  if (nextTemplates.length === appState.courseTemplates.length) {
    courseTemplateStatus.textContent = "삭제할 템플릿을 찾지 못했습니다.";
    return;
  }

  appState.courseTemplates = nextTemplates;
  renderCourseTemplateOptions();
  courseTemplateStatus.textContent = `템플릿 삭제 완료: ${selected.courseId} / ${selected.name}`;
  deps.scheduleAutoSave();
  void deps.syncDeleteCourseTemplateCloud(selected.courseId, selected.name);
}
