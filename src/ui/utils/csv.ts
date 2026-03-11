import { toCsvDownloadText } from "../../core/csvDownload";
import { StaffOverlap } from "../../core/types";

export function csvEscape(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[\r\n,"]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function createCsvBlob(csvText: string): Blob {
  const normalized = toCsvDownloadText(csvText);
  return new Blob([normalized], { type: "text/csv;charset=utf-8" });
}

export function downloadCsvFile(fileName: string, columns: readonly string[], rows: string[][]): void {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(row.map((value) => csvEscape(value ?? "")).join(","));
  }

  const csv = lines.join("\r\n");
  const blob = createCsvBlob(csv);
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

export function downloadCsvText(fileName: string, csv: string): void {
  const blob = createCsvBlob(csv);
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

export function toDayConflictRow(overlap: StaffOverlap): string[] {
  return [
    overlap.assignee,
    overlap.resourceType,
    overlap.assignmentA.cohort,
    overlap.assignmentA.phase,
    overlap.assignmentA.startDate,
    overlap.assignmentA.endDate,
    overlap.assignmentB.cohort,
    overlap.assignmentB.phase,
    overlap.assignmentB.startDate,
    overlap.assignmentB.endDate,
    String(overlap.overlapDays),
  ];
}

export function getOverlapRangeLabel(overlap: StaffOverlap): string {
  if (overlap.overlapStartDate === overlap.overlapEndDate) {
    return overlap.overlapStartDate;
  }
  return `${overlap.overlapStartDate}~${overlap.overlapEndDate}`;
}
