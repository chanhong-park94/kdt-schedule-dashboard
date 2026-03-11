import {
  AssigneeSummary,
  Phase,
  ResourceType,
  Session,
  StaffAssignment,
  StaffAssignmentInput,
  StaffingConfig,
  StaffOverlap,
  TrackType,
} from "./types";
import { exportWithMapping } from "./exportMapping";
import { InternalV7ERecord } from "./schema";
import { normalizeClassroomCode, normalizeInstructorCode, normalizeSubjectCode } from "./standardize";

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_POLICY_BY_TRACK: Record<TrackType, number[]> = {
  UNEMPLOYED: [1, 2, 3, 4, 5],
  EMPLOYED: [1, 2, 3, 4, 5, 6],
};

const INSTRUCTOR_INCLUDE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export type ModuleRange = {
  cohort: string;
  module: string;
  instructorCode: string;
  classroomCode: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
};

export const V7E_STRICT_DETAIL_HEADER = [
  "담당자",
  "리소스타입",
  "과정",
  "모듈",
  "시작",
  "종료",
  "업무일수",
  "산정기준",
] as const;

export function exportV7eStrictCsv(rows: InternalV7ERecord[]): string {
  return exportWithMapping("v7e_strict", rows);
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  return validDate ? date : null;
}

function parseCompactDate(value: string): Date | null {
  if (!/^\d{8}$/.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10);
  const day = Number.parseInt(value.slice(6, 8), 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  return validDate ? date : null;
}

function formatIsoDate(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextDate(date: Date): Date {
  return new Date(date.getTime() + DAY_MS);
}

function validatePhase(value: string): value is Phase {
  return value === "P1" || value === "P2" || value === "365";
}

function validateResourceType(value: string): value is ResourceType {
  return value === "INSTRUCTOR" || value === "FACILITATOR" || value === "OPERATION";
}

function validateTrackType(value: string): value is TrackType {
  return value === "UNEMPLOYED" || value === "EMPLOYED";
}

function normalizeIncludeWeekdays(values: number[], context: string): number[] {
  const set = new Set<number>();

  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error(`${context}: includeWeekdays 값은 0~6 정수여야 합니다.`);
    }
    set.add(value);
  }

  if (set.size === 0) {
    throw new Error(`${context}: includeWeekdays가 비어 있습니다.`);
  }

  return Array.from(set).sort((a, b) => a - b);
}

function normalizeConfig(config?: StaffingConfig): Record<TrackType, number[]> {
  return {
    UNEMPLOYED: normalizeIncludeWeekdays(
      config?.unemployedIncludeWeekdays ?? DEFAULT_POLICY_BY_TRACK.UNEMPLOYED,
      "UNEMPLOYED 정책",
    ),
    EMPLOYED: normalizeIncludeWeekdays(
      config?.employedIncludeWeekdays ?? DEFAULT_POLICY_BY_TRACK.EMPLOYED,
      "EMPLOYED 정책",
    ),
  };
}

function shouldCountDate(date: Date, includeWeekdays: number[]): boolean {
  return includeWeekdays.includes(date.getUTCDay());
}

function countDays(startDate: Date, endDate: Date, includeWeekdays: number[]): number {
  if (endDate.getTime() < startDate.getTime()) {
    return 0;
  }

  let count = 0;
  let current = new Date(startDate.getTime());

  while (current.getTime() <= endDate.getTime()) {
    if (shouldCountDate(current, includeWeekdays)) {
      count += 1;
    }
    current = nextDate(current);
  }

  return count;
}

function intersectWeekdays(left: number[], right: number[]): number[] {
  const rightSet = new Set<number>(right);
  return left.filter((day) => rightSet.has(day));
}

function resolveTrackType(item: StaffAssignmentInput, context: string): TrackType | undefined {
  if (item.resourceType === "INSTRUCTOR") {
    return undefined;
  }

  if (!item.trackType) {
    throw new Error(`${context}: ${item.resourceType} 배치는 cohort.trackType이 필요합니다.`);
  }

  if (!validateTrackType(item.trackType)) {
    throw new Error(`${context}: trackType 값이 올바르지 않습니다 (${item.trackType}).`);
  }

  return item.trackType;
}

function resolveIncludeWeekdays(
  item: StaffAssignmentInput,
  trackPolicies: Record<TrackType, number[]>,
  context: string,
): number[] {
  if (item.resourceType === "INSTRUCTOR") {
    return [...INSTRUCTOR_INCLUDE_WEEKDAYS];
  }

  const trackType = resolveTrackType(item, context);
  if (!trackType) {
    throw new Error(`${context}: trackType을 확인할 수 없습니다.`);
  }

  const policy = trackPolicies[trackType];
  return normalizeIncludeWeekdays(policy, `${context}(${trackType})`);
}

export function buildAssignments(input: StaffAssignmentInput[], config?: StaffingConfig): StaffAssignment[] {
  const trackPolicies = normalizeConfig(config);

  return input.map((item, index) => {
    const context = `배치 입력 ${index + 1}`;
    const cohort = item.cohort.trim();
    const assignee = item.assignee.trim();
    const phase = item.phase;

    if (!cohort) {
      throw new Error(`${context}: 과정기수가 비어 있습니다.`);
    }

    if (!validatePhase(phase)) {
      throw new Error(`${context}: phase 값이 올바르지 않습니다 (${item.phase}).`);
    }

    if (!validateResourceType(item.resourceType)) {
      throw new Error(`${context}: resourceType 값이 올바르지 않습니다 (${item.resourceType}).`);
    }

    if (!assignee) {
      throw new Error(`${context}: 담당자가 비어 있습니다.`);
    }

    const startDate = parseIsoDate(item.startDate);
    const endDate = parseIsoDate(item.endDate);

    if (!startDate || !endDate) {
      throw new Error(`${context}: 시작일/종료일 형식이 올바르지 않습니다.`);
    }

    if (endDate.getTime() < startDate.getTime()) {
      throw new Error(`${context}: 종료일이 시작일보다 빠릅니다.`);
    }

    const trackType = resolveTrackType(item, context);
    const includeWeekdays = resolveIncludeWeekdays(item, trackPolicies, context);

    return {
      cohort,
      phase,
      assignee,
      startDate: formatIsoDate(startDate),
      endDate: formatIsoDate(endDate),
      resourceType: item.resourceType,
      trackType,
      includeWeekdays,
      workDays: countDays(startDate, endDate, includeWeekdays),
    };
  });
}

export function detectStaffOverlaps(assignments: StaffAssignment[]): StaffOverlap[] {
  const byAssignee = new Map<string, StaffAssignment[]>();

  for (const assignment of assignments) {
    if (!byAssignee.has(assignment.assignee)) {
      byAssignee.set(assignment.assignee, []);
    }
    byAssignee.get(assignment.assignee)?.push(assignment);
  }

  const overlaps: StaffOverlap[] = [];

  for (const [assignee, rows] of byAssignee.entries()) {
    const sorted = [...rows].sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.endDate.localeCompare(b.endDate) ||
        a.cohort.localeCompare(b.cohort),
    );

    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const left = sorted[i];
        const right = sorted[j];

        if (left.resourceType !== right.resourceType) {
          continue;
        }

        if (left.cohort === right.cohort && left.phase === right.phase) {
          continue;
        }

        if (right.startDate > left.endDate) {
          break;
        }

        if (!(left.startDate <= right.endDate && right.startDate <= left.endDate)) {
          continue;
        }

        const overlapStart = left.startDate > right.startDate ? left.startDate : right.startDate;
        const overlapEnd = left.endDate < right.endDate ? left.endDate : right.endDate;
        const startDate = parseIsoDate(overlapStart);
        const endDate = parseIsoDate(overlapEnd);

        if (!startDate || !endDate) {
          continue;
        }

        const overlapPolicy = intersectWeekdays(left.includeWeekdays, right.includeWeekdays);
        if (overlapPolicy.length === 0) {
          continue;
        }

        const overlapDays = countDays(startDate, endDate, overlapPolicy);
        if (overlapDays <= 0) {
          continue;
        }

        overlaps.push({
          assignee,
          resourceType: left.resourceType,
          assignmentA: left,
          assignmentB: right,
          overlapStartDate: overlapStart,
          overlapEndDate: overlapEnd,
          overlapDays,
        });
      }
    }
  }

  return overlaps.sort(
    (a, b) =>
      a.resourceType.localeCompare(b.resourceType) ||
      a.assignee.localeCompare(b.assignee) ||
      a.overlapStartDate.localeCompare(b.overlapStartDate) ||
      a.assignmentA.cohort.localeCompare(b.assignmentA.cohort),
  );
}

export function summarizeWorkload(assignments: StaffAssignment[]): AssigneeSummary[] {
  const byAssigneeAndType = new Map<
    string,
    { assignee: string; resourceType: ResourceType; rows: StaffAssignment[] }
  >();

  for (const assignment of assignments) {
    const key = `${assignment.resourceType}|||${assignment.assignee}`;
    if (!byAssigneeAndType.has(key)) {
      byAssigneeAndType.set(key, {
        assignee: assignment.assignee,
        resourceType: assignment.resourceType,
        rows: [],
      });
    }
    byAssigneeAndType.get(key)?.rows.push(assignment);
  }

  const summaries: AssigneeSummary[] = [];

  for (const group of byAssigneeAndType.values()) {
    const phaseWorkDays: Record<Phase, number> = { P1: 0, P2: 0, "365": 0 };
    let totalWorkDays = 0;

    for (const assignment of group.rows) {
      totalWorkDays += assignment.workDays;
      phaseWorkDays[assignment.phase] += assignment.workDays;
    }

    const dayLoad = new Map<string, number>();

    for (const assignment of group.rows) {
      const startDate = parseIsoDate(assignment.startDate);
      const endDate = parseIsoDate(assignment.endDate);
      if (!startDate || !endDate) {
        continue;
      }

      let current = new Date(startDate.getTime());
      while (current.getTime() <= endDate.getTime()) {
        if (shouldCountDate(current, assignment.includeWeekdays)) {
          const key = formatIsoDate(current);
          dayLoad.set(key, (dayLoad.get(key) ?? 0) + 1);
        }
        current = nextDate(current);
      }
    }

    const overlapDays = Array.from(dayLoad.values()).filter((count) => count >= 2).length;

    summaries.push({
      assignee: group.assignee,
      resourceType: group.resourceType,
      totalWorkDays,
      phaseWorkDays,
      overlapDays,
      assignmentCount: group.rows.length,
    });
  }

  return summaries.sort((a, b) => a.resourceType.localeCompare(b.resourceType) || a.assignee.localeCompare(b.assignee));
}

export function deriveModuleRangesFromSessions(sessions: Session[]): ModuleRange[] {
  const rangeMap = new Map<string, ModuleRange>();

  for (const session of sessions) {
    const cohort = session.과정기수.trim();
    const module = normalizeSubjectCode(session["교과목(및 능력단위)코드"]);
    const instructorCode = normalizeInstructorCode(session.훈련강사코드);
    const classroomCode = normalizeClassroomCode(session["교육장소(강의실)코드"]);
    const parsedDate = session.normalizedDate
      ? parseIsoDate(session.normalizedDate)
      : parseCompactDate(session.훈련일자);

    if (!cohort || !module || !parsedDate) {
      continue;
    }

    const date = formatIsoDate(parsedDate);
    const key = `${cohort}|||${module}|||${instructorCode}|||${classroomCode}`;

    const existing = rangeMap.get(key);
    if (!existing) {
      rangeMap.set(key, {
        cohort,
        module,
        instructorCode,
        classroomCode,
        startDate: date,
        endDate: date,
        sessionCount: 1,
      });
      continue;
    }

    existing.startDate = existing.startDate < date ? existing.startDate : date;
    existing.endDate = existing.endDate > date ? existing.endDate : date;
    existing.sessionCount += 1;
  }

  return Array.from(rangeMap.values()).sort(
    (a, b) =>
      a.cohort.localeCompare(b.cohort) || a.module.localeCompare(b.module) || a.startDate.localeCompare(b.startDate),
  );
}
