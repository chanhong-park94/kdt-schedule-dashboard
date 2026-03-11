import { ExportFormatKey } from "./exportMapping";
import { InternalV7ERecord } from "./schema";

type ValidationResult = {
  errors: string[];
  warnings: string[];
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getValue(record: InternalV7ERecord, key: string): string {
  const row = record as Record<string, unknown>;
  const value = row[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

function validateV7eStrict(records: InternalV7ERecord[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  records.forEach((record, index) => {
    const rowName = `${index + 1}행`;
    const cohort = getValue(record, "cohort");
    const startDate = getValue(record, "startDate");
    const endDate = getValue(record, "endDate");

    if (!cohort) {
      errors.push(`${rowName}: cohort(과정)가 비어 있습니다.`);
    }

    if (!startDate || !endDate) {
      errors.push(`${rowName}: startDate/endDate(개강/종강)가 비어 있습니다.`);
    } else {
      if (!ISO_DATE_PATTERN.test(startDate) || !ISO_DATE_PATTERN.test(endDate)) {
        errors.push(`${rowName}: 날짜 형식은 현재 시스템 기준 YYYY-MM-DD로 고정됩니다.`);
      }
    }

    const phaseEmpty = [
      [getValue(record, "p1Assignee"), getValue(record, "p1Range")],
      [getValue(record, "p2Assignee"), getValue(record, "p2Range")],
      [getValue(record, "p365Assignee"), getValue(record, "p365Range")],
    ].filter(([assignee, range]) => !assignee || !range).length;

    if (phaseEmpty > 0) {
      warnings.push(`${rowName}: P1/P2/365 일부가 비어 있습니다.`);
    }
  });

  return { errors, warnings };
}

function validateModulesGeneric(records: InternalV7ERecord[]): ValidationResult {
  const errors: string[] = [];

  records.forEach((record, index) => {
    const rowName = `${index + 1}행`;
    const cohort = getValue(record, "cohort");
    const moduleKey = getValue(record, "moduleKey");
    const start = getValue(record, "start") || getValue(record, "startDate");
    const end = getValue(record, "end") || getValue(record, "endDate");

    if (!cohort) {
      errors.push(`${rowName}: cohort(과정)가 비어 있습니다.`);
    }
    if (!moduleKey) {
      errors.push(`${rowName}: moduleKey(모듈키)가 비어 있습니다.`);
    }
    if (!start || !end) {
      errors.push(`${rowName}: start/end(시작/종료)이 비어 있습니다.`);
    } else if (!ISO_DATE_PATTERN.test(start) || !ISO_DATE_PATTERN.test(end)) {
      errors.push(`${rowName}: modules_generic 날짜 형식은 YYYY-MM-DD여야 합니다.`);
    }
  });

  return { errors, warnings: [] };
}

export function validateRecordsForFormat(formatKey: ExportFormatKey, records: InternalV7ERecord[]): ValidationResult {
  if (records.length === 0) {
    return { errors: ["내보낼 데이터가 없습니다."], warnings: [] };
  }

  if (formatKey === "v7e_strict") {
    return validateV7eStrict(records);
  }

  if (formatKey === "modules_generic") {
    return validateModulesGeneric(records);
  }

  return { errors: [], warnings: [] };
}
