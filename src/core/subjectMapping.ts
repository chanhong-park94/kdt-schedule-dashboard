import { normalizeInstructorCode, normalizeSubjectCode } from "./standardize";
import { Session } from "./types";

export type CohortSubjectInstructorMapping = {
  cohort: string;
  subjectCode: string;
  instructorCode: string;
};

export type CourseSubjectInstructorMapping = {
  courseId: string;
  subjectCode: string;
  instructorCode: string;
};

export function toCohortSubjectKey(cohort: string, subjectCode: string): string {
  return `${cohort.trim()}|||${normalizeSubjectCode(subjectCode).toUpperCase()}`;
}

export function parseCohortSubjectKey(key: string): { cohort: string; subjectCode: string } {
  const [cohortRaw, subjectRaw] = key.split("|||");
  return {
    cohort: (cohortRaw ?? "").trim(),
    subjectCode: normalizeSubjectCode(subjectRaw ?? "").toUpperCase()
  };
}

function normalizeCourseId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseCourseFromCohortName(cohortName: string): string {
  const trimmed = cohortName.trim();
  const matched = trimmed.match(/^(.*?)(\d+기)$/);
  const course = matched?.[1]?.trim() || trimmed;
  return normalizeCourseId(course);
}

function toCourseSubjectKey(courseId: string, subjectCode: string): string {
  return `${normalizeCourseId(courseId)}|||${normalizeSubjectCode(subjectCode).toUpperCase()}`;
}

export function applyCohortSubjectInstructorMappingsToSessions(
  sessions: Session[],
  mappings: CohortSubjectInstructorMapping[],
  subjectDirectoryCodes?: Set<string>
): { sessions: Session[]; updatedRows: number; overwrittenRows: number } {
  const normalizedDirectoryCodes = subjectDirectoryCodes
    ? new Set(Array.from(subjectDirectoryCodes).map((code) => normalizeSubjectCode(code).toUpperCase()))
    : undefined;
  const mappingByKey = new Map<string, string>();
  for (const mapping of mappings) {
    const key = toCohortSubjectKey(mapping.cohort, mapping.subjectCode);
    const parsed = parseCohortSubjectKey(key);
    if (normalizedDirectoryCodes && !normalizedDirectoryCodes.has(parsed.subjectCode)) {
      continue;
    }
    const instructorCode = normalizeInstructorCode(mapping.instructorCode);
    if (!key || !instructorCode) {
      continue;
    }
    mappingByKey.set(key, instructorCode);
  }

  let updatedRows = 0;
  let overwrittenRows = 0;

  const nextSessions = sessions.map((session) => {
    const cohort = session.과정기수.trim();
    const subjectCode = normalizeSubjectCode(session["교과목(및 능력단위)코드"]).toUpperCase();
    if (!cohort || !subjectCode) {
      return session;
    }

    const key = toCohortSubjectKey(cohort, subjectCode);
    const mappedInstructor = mappingByKey.get(key);
    if (!mappedInstructor) {
      return session;
    }

    const prevInstructor = normalizeInstructorCode(session.훈련강사코드);
    if (prevInstructor && prevInstructor !== mappedInstructor) {
      overwrittenRows += 1;
    }
    updatedRows += 1;

    return {
      ...session,
      훈련강사코드: mappedInstructor,
      "교과목(및 능력단위)코드": subjectCode
    };
  });

  return {
    sessions: nextSessions,
    updatedRows,
    overwrittenRows
  };
}

export function applyCourseSubjectInstructorMappingsToCohortSessions(
  sessions: Session[],
  targetCohort: string,
  mappings: CourseSubjectInstructorMapping[],
  subjectDirectoryCodes?: Set<string>
): { sessions: Session[]; updatedRows: number; overwrittenRows: number } {
  const target = targetCohort.trim();
  const normalizedDirectoryCodes = subjectDirectoryCodes
    ? new Set(Array.from(subjectDirectoryCodes).map((code) => normalizeSubjectCode(code).toUpperCase()))
    : undefined;
  const mapByKey = new Map<string, string>();

  for (const mapping of mappings) {
    const key = toCourseSubjectKey(mapping.courseId, mapping.subjectCode);
    const subjectCode = normalizeSubjectCode(mapping.subjectCode).toUpperCase();
    if (normalizedDirectoryCodes && !normalizedDirectoryCodes.has(subjectCode)) {
      continue;
    }
    const instructorCode = normalizeInstructorCode(mapping.instructorCode);
    if (!key || !instructorCode) {
      continue;
    }
    mapByKey.set(key, instructorCode);
  }

  let updatedRows = 0;
  let overwrittenRows = 0;
  const nextSessions = sessions.map((session) => {
    if (session.과정기수.trim() !== target) {
      return session;
    }

    const subjectCode = normalizeSubjectCode(session["교과목(및 능력단위)코드"]).toUpperCase();
    const courseId = parseCourseFromCohortName(session.과정기수);
    if (!courseId || !subjectCode) {
      return session;
    }

    const mappedInstructor = mapByKey.get(toCourseSubjectKey(courseId, subjectCode));
    if (!mappedInstructor) {
      return session;
    }

    const prevInstructor = normalizeInstructorCode(session.훈련강사코드);
    if (prevInstructor && prevInstructor !== mappedInstructor) {
      overwrittenRows += 1;
    }
    updatedRows += 1;

    return {
      ...session,
      훈련강사코드: mappedInstructor,
      "교과목(및 능력단위)코드": subjectCode
    };
  });

  return { sessions: nextSessions, updatedRows, overwrittenRows };
}
