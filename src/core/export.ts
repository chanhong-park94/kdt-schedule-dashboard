import { HRD_EXPORT_COLUMNS, Session } from "./types";
import { normalizeClassroomCode, normalizeInstructorCode, normalizeSubjectCode } from "./standardize";

function escapeCsv(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[\r\n,"]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function exportHrdCsvForCohort(sessions: Session[], cohort: string): string {
  const subset = sessions.filter((session) => session.과정기수 === cohort);
  const header = HRD_EXPORT_COLUMNS.join(",");

  const lines = subset.map((session) => {
    const normalized: Session = {
      ...session,
      훈련강사코드: normalizeInstructorCode(session.훈련강사코드),
      "교육장소(강의실)코드": normalizeClassroomCode(session["교육장소(강의실)코드"]),
      "교과목(및 능력단위)코드": normalizeSubjectCode(session["교과목(및 능력단위)코드"])
    };

    return HRD_EXPORT_COLUMNS.map((column) => escapeCsv(normalized[column] ?? "")).join(",");
  });

  return [header, ...lines].join("\r\n");
}
