import { type TemplateRowState } from "./state";
import { normalizeInstructorCode, normalizeSubjectCode } from "./standardize";

export type CourseSubjectEntry = {
  courseId: string;
  subjectCode: string;
  subjectName: string;
  memo: string;
};

export type CourseSubjectInstructorEntry = {
  key: string;
  instructorCode: string;
};

export type CourseTemplateApplyModel = {
  courseId: string;
  dayTemplates: TemplateRowState[];
  holidays: string[];
  customBreaks: string[];
  subjectList: Array<{ subjectCode: string; subjectName: string; memo: string }>;
  subjectInstructorMapping: CourseSubjectInstructorEntry[];
};

function normalizeCourseId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseCourseSubjectKey(key: string): { courseId: string; subjectCode: string } {
  const [courseIdRaw, subjectRaw] = key.split("|||");
  return {
    courseId: normalizeCourseId(courseIdRaw ?? ""),
    subjectCode: normalizeSubjectCode(subjectRaw ?? "").toUpperCase(),
  };
}

function toCourseSubjectKey(courseId: string, subjectCode: string): string {
  return `${normalizeCourseId(courseId)}|||${normalizeSubjectCode(subjectCode).toUpperCase()}`;
}

export function applyCourseTemplateToState(params: {
  subjectDirectory: CourseSubjectEntry[];
  subjectInstructorMappings: CourseSubjectInstructorEntry[];
  template: CourseTemplateApplyModel;
}): {
  dayTemplates: TemplateRowState[];
  holidays: string[];
  customBreaks: string[];
  subjectDirectory: CourseSubjectEntry[];
  subjectInstructorMappings: CourseSubjectInstructorEntry[];
  overwrite: { subjectEntriesReplaced: number; mappingEntriesReplaced: number };
} {
  const targetCourseId = normalizeCourseId(params.template.courseId);

  const keptSubjects = params.subjectDirectory.filter((item) => normalizeCourseId(item.courseId) !== targetCourseId);
  const replacedSubjectCount = params.subjectDirectory.length - keptSubjects.length;
  const nextSubjects = params.template.subjectList
    .map((item) => ({
      courseId: targetCourseId,
      subjectCode: normalizeSubjectCode(item.subjectCode).toUpperCase(),
      subjectName: item.subjectName ?? "",
      memo: item.memo ?? "",
    }))
    .filter((item) => item.subjectCode.length > 0);

  const keptMappings = params.subjectInstructorMappings.filter((item) => {
    const parsed = parseCourseSubjectKey(item.key);
    return parsed.courseId !== targetCourseId;
  });
  const replacedMappingCount = params.subjectInstructorMappings.length - keptMappings.length;
  const nextMappings = params.template.subjectInstructorMapping
    .map((item) => {
      const parsed = parseCourseSubjectKey(item.key);
      return {
        key: toCourseSubjectKey(targetCourseId, parsed.subjectCode),
        instructorCode: normalizeInstructorCode(item.instructorCode),
      };
    })
    .filter((item) => item.key.length > 0 && item.instructorCode.length > 0);

  return {
    dayTemplates: params.template.dayTemplates,
    holidays: [...params.template.holidays],
    customBreaks: [...params.template.customBreaks],
    subjectDirectory: [...keptSubjects, ...nextSubjects],
    subjectInstructorMappings: [...keptMappings, ...nextMappings],
    overwrite: {
      subjectEntriesReplaced: replacedSubjectCount,
      mappingEntriesReplaced: replacedMappingCount,
    },
  };
}
