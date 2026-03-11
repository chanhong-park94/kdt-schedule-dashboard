import { buildHrdRowsForCohort, checkHrdRowLimit } from "./hrdRows";
import { HRD_EXPORT_COLUMNS, ScheduleDay, Session } from "./types";
import { normalizeClassroomCode, normalizeInstructorCode, normalizeSubjectCode } from "./standardize";

function escapeCsv(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[\r\n,"]/.test(escaped) ? `"${escaped}"` : escaped;
}

type ExportHrdOptions = {
  generatedDays?: ScheduleDay[];
};

export type ExportHrdResult = { csv: string; rowWarning: string | null };

export function exportHrdCsvForCohort(
  sessions: Session[],
  cohort: string,
  options?: ExportHrdOptions,
): ExportHrdResult {
  const rows = buildHrdRowsForCohort({
    sessions,
    cohort,
    generatedDays: options?.generatedDays,
  });
  const header = HRD_EXPORT_COLUMNS.join(",");

  const lines = rows.map((row) => {
    const normalized = {
      ...row,
      훈련강사코드: normalizeInstructorCode(row.훈련강사코드),
      "교육장소(강의실)코드": normalizeClassroomCode(row["교육장소(강의실)코드"]),
      "교과목(및 능력단위)코드": normalizeSubjectCode(row.교과목코드),
    };

    return HRD_EXPORT_COLUMNS.map((column) => {
      return escapeCsv(normalized[column] ?? "");
    }).join(",");
  });

  return { csv: [header, ...lines].join("\r\n"), rowWarning: checkHrdRowLimit(rows) };
}
