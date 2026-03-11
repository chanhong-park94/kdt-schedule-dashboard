import { Session } from "./types";

export type HrdValidationResult = {
  errors: string[];
  warnings: string[];
};

function parseCompactDate(value: string): string | null {
  if (!/^\d{8}$/.test(value)) {
    return null;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateHrdExportForCohort(
  sessions: Session[],
  cohort: string,
  holidayDates: string[],
  holidayNameByDate?: Map<string, string>,
): string[] {
  return validateHrdExportForCohortDetailed(sessions, cohort, holidayDates, holidayNameByDate).errors;
}

export function validateHrdExportForCohortDetailed(
  sessions: Session[],
  cohort: string,
  holidayDates: string[],
  holidayNameByDate?: Map<string, string>,
  subjectDirectoryCodes?: Set<string>,
): HrdValidationResult {
  const cohortSessions = sessions.filter((session) => session.과정기수 === cohort);
  if (cohortSessions.length === 0) {
    return {
      errors: ["선택한 기수에 세션이 없어 HRD CSV를 다운로드할 수 없습니다."],
      warnings: [],
    };
  }

  const errors = new Set<string>();
  const warnings = new Set<string>();
  const holidaySet = new Set<string>(holidayDates);
  const seenDateSubject = new Set<string>();
  const duplicateDateSubjects = new Set<string>();
  const missingInstructorModules = new Set<string>();
  const unregisteredSubjects = new Set<string>();

  for (const session of cohortSessions) {
    const normalizedDate = session.normalizedDate ?? parseCompactDate(session.훈련일자);
    const subjectCode = session["교과목(및 능력단위)코드"].trim();
    const instructorCode = session.훈련강사코드.trim();

    if (!normalizedDate || !isIsoDate(normalizedDate)) {
      errors.add(`[${session.훈련일자}] 날짜 형식이 올바르지 않아 다운로드할 수 없습니다.`);
    }

    if (!instructorCode) {
      if (subjectCode) {
        missingInstructorModules.add(subjectCode);
      }
      warnings.add(
        `[${session.훈련일자}] ${subjectCode || "교과목 미기재"}: 강사코드가 비어 있습니다. 다운로드는 가능하지만 업로드 전 보완이 필요합니다.`,
      );
    }
    if (!subjectCode) {
      warnings.add(
        `[${session.훈련일자}] 교과목 코드가 비어 있습니다. 다운로드는 가능하지만 업로드 전 보완이 필요합니다.`,
      );
    } else if (subjectDirectoryCodes && subjectDirectoryCodes.size > 0 && !subjectDirectoryCodes.has(subjectCode)) {
      unregisteredSubjects.add(subjectCode);
    }

    if (normalizedDate && subjectCode) {
      const dateSubjectKey = `${normalizedDate}|||${subjectCode}`;
      if (seenDateSubject.has(dateSubjectKey)) {
        duplicateDateSubjects.add(`${normalizedDate} / ${subjectCode}`);
      } else {
        seenDateSubject.add(dateSubjectKey);
      }
    }

    if (session.startMin === null || session.endMin === null) {
      errors.add(
        `[${session.훈련일자}] ${subjectCode || "교과목 미기재"}: 시작/종료 시간 형식이 올바르지 않아 다운로드할 수 없습니다.`,
      );
    } else {
      if (session.startMin === session.endMin) {
        warnings.add(
          `[${session.훈련일자}] ${subjectCode || "교과목 미기재"}: 시작시간과 종료시간이 동일한 세션이 있습니다.`,
        );
      }

      if (session.endMin < session.startMin) {
        warnings.add(
          `[${session.훈련일자}] ${subjectCode || "교과목 미기재"}: 종료시간이 시작시간보다 빠른 세션이 있습니다.`,
        );
      }
    }

    if (normalizedDate && holidaySet.has(normalizedDate)) {
      const holidayName = holidayNameByDate?.get(normalizedDate);
      warnings.add(
        `[${normalizedDate}] ${subjectCode || "교과목 미기재"}: 공휴일${holidayName ? `(${holidayName})` : ""} 세션이 포함되어 있습니다.`,
      );
    }
  }

  const sortedDuplicates = Array.from(duplicateDateSubjects).sort((a, b) => a.localeCompare(b));
  for (const duplicate of sortedDuplicates) {
    warnings.add(`${duplicate}: 동일 날짜/교과목 중복 row가 있습니다. 업로드 전 확인이 필요합니다.`);
  }

  if (missingInstructorModules.size > 0) {
    warnings.add(`강사 미배정 교과목 ${missingInstructorModules.size}개`);
  }
  if (unregisteredSubjects.size > 0) {
    warnings.add(`교과목 미등록 ${unregisteredSubjects.size}개`);
  }

  return {
    errors: Array.from(errors),
    warnings: Array.from(warnings),
  };
}
