import { normalizeHHMM } from "../../core/normalize";
import { normalizeSubjectCode } from "../../core/standardize";
import { Phase, ResourceType, TrackType } from "../../core/types";

export type ConflictTab = "time" | "instructor_day" | "fo_day";

const POLICY_BY_TRACK: Record<TrackType, number[]> = {
  UNEMPLOYED: [1, 2, 3, 4, 5],
  EMPLOYED: [1, 2, 3, 4, 5, 6]
};

export function parseCourseGroupFromCohortName(cohortName: string): { course: string; cohortLabel: string } {
  const trimmed = cohortName.trim();
  const matched = trimmed.match(/^(.*?)(\d+기)$/);
  if (!matched) {
    return { course: trimmed, cohortLabel: trimmed };
  }

  const course = matched[1]?.trim() || trimmed;
  const cohortLabel = matched[2]?.trim() || trimmed;
  return { course, cohortLabel };
}

export function normalizeCourseId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function toCourseSubjectKey(courseId: string, subjectCode: string): string {
  const normalizedCourseId = normalizeCourseId(courseId);
  const normalizedSubjectCode = normalizeSubjectCode(subjectCode).toUpperCase();
  return `${normalizedCourseId}|||${normalizedSubjectCode}`;
}

export function parseCourseSubjectKey(key: string): { courseId: string; subjectCode: string } {
  const [courseIdRaw, subjectRaw] = key.split("|||");
  return {
    courseId: normalizeCourseId(courseIdRaw ?? ""),
    subjectCode: normalizeSubjectCode(subjectRaw ?? "").toUpperCase()
  };
}

export function formatHours(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function formatHHMM(value: string): string {
  const normalized = normalizeHHMM(value);
  if (!normalized) {
    return value;
  }
  return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
}

export function normalizeTimeInputToHHMM(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(":");
    return normalizeHHMM(`${h}${m}`);
  }

  return normalizeHHMM(trimmed);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function estimateUtf8SizeBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function normalizePolicyDays(days: number[]): number[] {
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort(
    (a, b) => a - b
  );
}

export function getPolicyForTrack(trackType: TrackType): number[] {
  return [...POLICY_BY_TRACK[trackType]];
}

export function getPolicyLabel(days: number[]): string {
  const normalized = normalizePolicyDays(days);
  if (normalized.join(",") === "1,2,3,4,5") {
    return "월~금";
  }
  if (normalized.join(",") === "1,2,3,4,5,6") {
    return "월~토";
  }

  const dayName = ["일", "월", "화", "수", "목", "금", "토"];
  return normalized.map((day) => dayName[day] ?? `D${day}`).join(",");
}

export function isTrackType(value: unknown): value is TrackType {
  return value === "UNEMPLOYED" || value === "EMPLOYED";
}

export function isResourceType(value: unknown): value is ResourceType {
  return value === "INSTRUCTOR" || value === "FACILITATOR" || value === "OPERATION";
}

export function isPhase(value: unknown): value is Phase {
  return value === "P1" || value === "P2" || value === "365";
}

export function getConflictTabLabel(tab: ConflictTab): string {
  if (tab === "time") {
    return "강사 시간 충돌";
  }
  if (tab === "instructor_day") {
    return "강사 배치(일) 충돌";
  }
  return "퍼실/운영 배치(일) 충돌";
}

export function getReadableTextColorFromCssColor(value: string | undefined): string {
  if (!value) {
    return "#ffffff";
  }
  const match = value.match(/#([0-9a-fA-F]{6})/);
  if (!match) {
    return "#ffffff";
  }
  const hex = match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.65 ? "#0f172a" : "#ffffff";
}
