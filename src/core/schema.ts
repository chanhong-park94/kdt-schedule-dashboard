export type InternalV7ERecord = {
  cohort: string;
  startDate: string;
  endDate: string;
  p1Assignee?: string;
  p1Range?: string;
  p2Assignee?: string;
  p2Range?: string;
  p365Assignee?: string;
  p365Range?: string;
  moduleKey?: string;
  instructorCode?: string;
  classroomCode?: string;
  sessionCount?: string;
  start?: string;
  end?: string;
};

export const INTERNAL_V7E_RECORD_KEYS = [
  "cohort",
  "startDate",
  "endDate",
  "p1Assignee",
  "p1Range",
  "p2Assignee",
  "p2Range",
  "p365Assignee",
  "p365Range",
  "moduleKey",
  "instructorCode",
  "classroomCode",
  "sessionCount",
  "start",
  "end",
] as const satisfies ReadonlyArray<keyof InternalV7ERecord>;
