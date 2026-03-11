import { hhmmToMinutes, normalizeDateYYYYMMDD, normalizeHHMM } from "./normalize";
import { normalizeClassroomCode, normalizeInstructorCode, normalizeSubjectCode } from "./standardize";
import { ParseError, REQUIRED_INPUT_COLUMNS, Session } from "./types";

const NA_PATTERN = /^(na|n\/a|null|-)$/i;

function sanitizeCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || NA_PATTERN.test(trimmed)) {
    return "";
  }
  return trimmed;
}

function pushError(
  errors: ParseError[],
  rowIndex: number,
  column: string,
  code: ParseError["code"],
  value: string,
  message: string,
): void {
  errors.push({ rowIndex, column, code, value, message });
}

export function buildSessions(rows: Record<string, string>[]): { sessions: Session[]; errors: ParseError[] } {
  const sessions: Session[] = [];
  const errors: ParseError[] = [];

  const availableColumns = new Set<string>(Object.keys(rows[0] ?? {}));
  const missingColumns = REQUIRED_INPUT_COLUMNS.filter((column) => !availableColumns.has(column));

  for (const column of missingColumns) {
    pushError(errors, 1, column, "missing_required_column", "", `필수 컬럼 누락: ${column}`);
  }

  if (missingColumns.length > 0) {
    return { sessions, errors };
  }

  rows.forEach((row, index) => {
    const rowIndex = index + 2;

    const trainingDate = sanitizeCell(row["훈련일자"] ?? "");
    const trainingStartTimeRaw = sanitizeCell(row["훈련시작시간"] ?? "");
    const trainingEndTimeRaw = sanitizeCell(row["훈련종료시간"] ?? "");
    const cohort = sanitizeCell(row["과정기수"] ?? "");

    let hasError = false;

    if (!trainingDate) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "훈련일자",
        "missing_required_value",
        row["훈련일자"] ?? "",
        "훈련일자 값이 비어 있습니다.",
      );
    }

    if (!trainingStartTimeRaw) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "훈련시작시간",
        "missing_required_value",
        row["훈련시작시간"] ?? "",
        "훈련시작시간 값이 비어 있습니다.",
      );
    }

    if (!trainingEndTimeRaw) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "훈련종료시간",
        "missing_required_value",
        row["훈련종료시간"] ?? "",
        "훈련종료시간 값이 비어 있습니다.",
      );
    }

    if (!cohort) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "과정기수",
        "missing_required_value",
        row["과정기수"] ?? "",
        "과정기수 값이 비어 있습니다.",
      );
    }

    const normalizedDate = normalizeDateYYYYMMDD(trainingDate);
    if (trainingDate && !normalizedDate) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "훈련일자",
        "invalid_date",
        trainingDate,
        "훈련일자 형식이 올바르지 않습니다. (YYYYMMDD)",
      );
    }

    const normalizedStart = normalizeHHMM(trainingStartTimeRaw);
    if (trainingStartTimeRaw && !normalizedStart) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "훈련시작시간",
        "invalid_time",
        trainingStartTimeRaw,
        "훈련시작시간 형식이 올바르지 않습니다. (HHMM)",
      );
    }

    const normalizedEnd = normalizeHHMM(trainingEndTimeRaw);
    if (trainingEndTimeRaw && !normalizedEnd) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "훈련종료시간",
        "invalid_time",
        trainingEndTimeRaw,
        "훈련종료시간 형식이 올바르지 않습니다. (HHMM)",
      );
    }

    const startMin = normalizedStart ? hhmmToMinutes(normalizedStart) : null;
    const endMin = normalizedEnd ? hhmmToMinutes(normalizedEnd) : null;

    if (startMin !== null && endMin !== null && startMin >= endMin) {
      hasError = true;
      pushError(
        errors,
        rowIndex,
        "훈련시작시간/훈련종료시간",
        "invalid_time_range",
        `${normalizedStart}-${normalizedEnd}`,
        "훈련시작시간은 훈련종료시간보다 빨라야 합니다.",
      );
    }

    if (hasError) {
      return;
    }

    const normalizedOriginStart = normalizeHHMM(sanitizeCell(row["시작시간"] ?? ""));

    sessions.push({
      훈련일자: trainingDate,
      훈련시작시간: normalizedStart ?? "",
      훈련종료시간: normalizedEnd ?? "",
      "방학/원격여부": sanitizeCell(row["방학/원격여부"] ?? ""),
      시작시간: normalizedOriginStart ?? sanitizeCell(row["시작시간"] ?? ""),
      시간구분: sanitizeCell(row["시간구분"] ?? ""),
      훈련강사코드: normalizeInstructorCode(sanitizeCell(row["훈련강사코드"] ?? "")),
      "교육장소(강의실)코드": normalizeClassroomCode(sanitizeCell(row["교육장소(강의실)코드"] ?? "")),
      "교과목(및 능력단위)코드": normalizeSubjectCode(sanitizeCell(row["교과목(및 능력단위)코드"] ?? "")),
      과정기수: cohort,
      normalizedDate,
      startMin,
      endMin,
    });
  });

  return { sessions, errors };
}
