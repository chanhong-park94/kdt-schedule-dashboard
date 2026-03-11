export const REQUIRED_INPUT_COLUMNS = [
  "훈련일자",
  "훈련시작시간",
  "훈련종료시간",
  "방학/원격여부",
  "시작시간",
  "시간구분",
  "훈련강사코드",
  "교육장소(강의실)코드",
  "교과목(및 능력단위)코드",
  "과정기수",
] as const;

export const HRD_EXPORT_COLUMNS = [
  "훈련일자",
  "훈련시작시간",
  "훈련종료시간",
  "방학/원격여부",
  "시작시간",
  "시간구분",
  "훈련강사코드",
  "교육장소(강의실)코드",
  "교과목(및 능력단위)코드",
] as const;

export type BasisKey = "훈련강사코드" | "교육장소(강의실)코드";

export type Session = {
  훈련일자: string;
  훈련시작시간: string;
  훈련종료시간: string;
  "방학/원격여부": string;
  시작시간: string;
  시간구분: string;
  훈련강사코드: string;
  "교육장소(강의실)코드": string;
  "교과목(및 능력단위)코드": string;
  과정기수: string;
  normalizedDate: string | null;
  startMin: number | null;
  endMin: number | null;
};

export type CohortSummary = {
  과정기수: string;
  시작일: string;
  종료일: string;
  훈련일수: number;
  세션수: number;
};

export type Conflict = {
  기준: "강의실" | "강사";
  resourceType: ResourceType;
  일자: string;
  키: string;
  과정A: string;
  A시간: string;
  A교과목: string;
  과정B: string;
  B시간: string;
  B교과목: string;
};

export type ParseErrorCode =
  | "missing_required_column"
  | "missing_required_value"
  | "invalid_date"
  | "invalid_time"
  | "invalid_time_range";

export type ParseError = {
  rowIndex: number;
  column: string;
  code: ParseErrorCode;
  value: string;
  message: string;
};

export type InstructorDirectoryEntry = {
  instructorCode: string;
  name: string;
  memo: string;
};

export type Holiday = {
  date: string;
  localName: string;
  name: string;
  fixed?: boolean;
  global?: boolean;
  counties?: string[] | null;
  launchYear?: number | null;
  types?: string[];
};

export type TimeRange = {
  startHHMM: string;
  endHHMM: string;
};

export type BreakRange = {
  startHHMM: string;
  endHHMM: string;
};

export type DayTimeTemplate = {
  weekday: number;
  blocks: TimeRange[];
  breaks?: BreakRange[];
};

export type ScheduleConfig = {
  startDate: string;
  totalHours: number;
  weekdays: number[];
  holidays: string[];
  customBreaks: string[];
  dayTemplates: DayTimeTemplate[];
  dateOverrides?: Record<string, DayTimeTemplate>;
};

export type ScheduleDay = {
  date: string;
  blocks: TimeRange[];
  breaks: BreakRange[];
  netMinutes: number;
};

export type SkippedDayReason = "weekday_excluded" | "holiday" | "custom_break";

export type SkippedDay = {
  date: string;
  reason: SkippedDayReason;
};

export type GenerateScheduleResult = {
  days: ScheduleDay[];
  endDate: string;
  totalHoursPlanned: number;
  totalDays: number;
  skipped: SkippedDay[];
};

export type FromScheduleDaysToSessionsParams = {
  cohort: string;
  days: ScheduleDay[];
  instructorCode?: string;
  classroomCode?: string;
  subjectCode?: string;
};

export type Phase = "P1" | "P2" | "365";

export type TrackType = "UNEMPLOYED" | "EMPLOYED";

export type ResourceType = "INSTRUCTOR" | "FACILITATOR" | "OPERATION";

export type WorkdayPolicy = {
  includeWeekdays: number[];
};

export type StaffAssignmentInput = {
  cohort: string;
  phase: Phase;
  assignee: string;
  startDate: string;
  endDate: string;
  resourceType: ResourceType;
  trackType?: TrackType;
};

export type StaffAssignment = StaffAssignmentInput & {
  trackType?: TrackType;
  includeWeekdays: number[];
  workDays: number;
};

export type StaffingConfig = {
  unemployedIncludeWeekdays?: number[];
  employedIncludeWeekdays?: number[];
};

export type StaffOverlap = {
  assignee: string;
  resourceType: ResourceType;
  assignmentA: StaffAssignment;
  assignmentB: StaffAssignment;
  overlapStartDate: string;
  overlapEndDate: string;
  overlapDays: number;
};

export type AssigneeSummary = {
  assignee: string;
  resourceType: ResourceType;
  totalWorkDays: number;
  phaseWorkDays: Record<Phase, number>;
  overlapDays: number;
  assignmentCount: number;
};
