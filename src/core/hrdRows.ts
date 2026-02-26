import { hhmmToMinutes, normalizeHHMM } from "./normalize";
import { normalizeClassroomCode, normalizeInstructorCode, normalizeSubjectCode } from "./standardize";
import { ScheduleDay, Session } from "./types";

export type HrdRow = {
  훈련일자: string;
  훈련시작시간: string;
  훈련종료시간: string;
  "방학/원격여부": string;
  시작시간: string;
  시간구분: "1" | "2";
  훈련강사코드: string;
  "교육장소(강의실)코드": string;
  교과목코드: string;
};

type HrdRowsBuildInput = {
  sessions: Session[];
  cohort: string;
  generatedDays?: ScheduleDay[];
};

type DayCodeContext = {
  remoteType: string;
  instructorCode: string;
  classroomCode: string;
  subjectCode: string;
};

function toHHMM(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
}

function toCompactDate(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  return isoDate.replace(/-/g, "");
}

function dedupeRows(rows: HrdRow[]): HrdRow[] {
  const map = new Map<string, HrdRow>();
  for (const row of rows) {
    const key = `${row.훈련일자}|${row.시작시간}|${row.시간구분}`;
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function sortRows(rows: HrdRow[]): HrdRow[] {
  return [...rows].sort((a, b) => {
    const dateCompare = a.훈련일자.localeCompare(b.훈련일자);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    const timeCompare = a.시작시간.localeCompare(b.시작시간);
    if (timeCompare !== 0) {
      return timeCompare;
    }
    return a.시간구분.localeCompare(b.시간구분);
  });
}

function resolveDayCodeContext(daySessions: Session[]): DayCodeContext {
  const source = daySessions.find((session) => session.시간구분 !== "2") ?? daySessions[0];
  return {
    remoteType: source?.["방학/원격여부"] ?? "",
    instructorCode: normalizeInstructorCode(source?.훈련강사코드 ?? ""),
    classroomCode: normalizeClassroomCode(source?.["교육장소(강의실)코드"] ?? ""),
    subjectCode: normalizeSubjectCode(source?.["교과목(및 능력단위)코드"] ?? "")
  };
}

function expandHourlyStarts(startHHMM: string, endHHMM: string): string[] {
  const startMin = hhmmToMinutes(startHHMM);
  const endMin = hhmmToMinutes(endHHMM);
  if (startMin === null || endMin === null || startMin >= endMin) {
    return [];
  }

  const starts: string[] = [];
  for (let minute = startMin; minute < endMin; minute += 60) {
    starts.push(toHHMM(minute));
  }
  return starts;
}

function buildRowsFromGeneratedDay(
  compactDate: string,
  day: ScheduleDay,
  context: DayCodeContext
): HrdRow[] {
  const rangePoints: number[] = [];
  const breakRanges: Array<{ startMin: number; endMin: number; startHHMM: string }> = [];

  for (const block of day.blocks) {
    const start = hhmmToMinutes(block.startHHMM);
    const end = hhmmToMinutes(block.endHHMM);
    if (start === null || end === null || start >= end) {
      continue;
    }
    rangePoints.push(start, end);
  }

  for (const breakRange of day.breaks) {
    const start = hhmmToMinutes(breakRange.startHHMM);
    const end = hhmmToMinutes(breakRange.endHHMM);
    if (start === null || end === null || start >= end) {
      continue;
    }
    rangePoints.push(start, end);
    breakRanges.push({ startMin: start, endMin: end, startHHMM: toHHMM(start) });
  }

  if (rangePoints.length === 0) {
    return [];
  }

  const dayStart = toHHMM(Math.min(...rangePoints));
  const dayEnd = toHHMM(Math.max(...rangePoints));

  const rows: HrdRow[] = [];

  for (const block of day.blocks) {
    const slotStarts = expandHourlyStarts(block.startHHMM, block.endHHMM);
    for (const slotStart of slotStarts) {
      const slotMinute = hhmmToMinutes(slotStart);
      if (slotMinute === null) {
        continue;
      }
      const inBreak = breakRanges.some((range) => slotMinute >= range.startMin && slotMinute < range.endMin);
      if (inBreak) {
        continue;
      }
      rows.push({
        훈련일자: compactDate,
        훈련시작시간: dayStart,
        훈련종료시간: dayEnd,
        "방학/원격여부": context.remoteType,
        시작시간: slotStart,
        시간구분: "1",
        훈련강사코드: context.instructorCode,
        "교육장소(강의실)코드": context.classroomCode,
        교과목코드: context.subjectCode
      });
    }
  }

  for (const breakRange of breakRanges) {
    rows.push({
      훈련일자: compactDate,
      훈련시작시간: dayStart,
      훈련종료시간: dayEnd,
      "방학/원격여부": context.remoteType,
      시작시간: breakRange.startHHMM,
      시간구분: "2",
      훈련강사코드: "",
      "교육장소(강의실)코드": "",
      교과목코드: ""
    });
  }

  return sortRows(dedupeRows(rows));
}

function buildRowsFromSessions(compactDate: string, daySessions: Session[]): HrdRow[] {
  const context = resolveDayCodeContext(daySessions);
  const rows: HrdRow[] = [];

  const rangePoints: number[] = [];
  for (const session of daySessions) {
    const start = hhmmToMinutes(session.훈련시작시간);
    const end = hhmmToMinutes(session.훈련종료시간);
    if (start !== null) {
      rangePoints.push(start);
    }
    if (end !== null) {
      rangePoints.push(end);
    }
  }

  if (rangePoints.length === 0) {
    return [];
  }

  const dayStart = toHHMM(Math.min(...rangePoints));
  const dayEnd = toHHMM(Math.max(...rangePoints));

  for (const session of daySessions) {
    const startHHMM = normalizeHHMM(session.시작시간 || session.훈련시작시간);
    if (!startHHMM) {
      continue;
    }

    if (session.시간구분 === "2") {
      rows.push({
        훈련일자: compactDate,
        훈련시작시간: dayStart,
        훈련종료시간: dayEnd,
        "방학/원격여부": session["방학/원격여부"] ?? "",
        시작시간: startHHMM,
        시간구분: "2",
        훈련강사코드: "",
        "교육장소(강의실)코드": "",
        교과목코드: ""
      });
      continue;
    }

    rows.push({
      훈련일자: compactDate,
      훈련시작시간: dayStart,
      훈련종료시간: dayEnd,
      "방학/원격여부": session["방학/원격여부"] ?? "",
      시작시간: startHHMM,
      시간구분: "1",
      훈련강사코드: normalizeInstructorCode(session.훈련강사코드 || context.instructorCode),
      "교육장소(강의실)코드": normalizeClassroomCode(session["교육장소(강의실)코드"] || context.classroomCode),
      교과목코드: normalizeSubjectCode(session["교과목(및 능력단위)코드"] || context.subjectCode)
    });
  }

  return sortRows(dedupeRows(rows));
}

export function buildHrdRowsForCohort(input: HrdRowsBuildInput): HrdRow[] {
  const cohortSessions = input.sessions.filter((session) => session.과정기수 === input.cohort);
  const sessionsByDate = new Map<string, Session[]>();

  for (const session of cohortSessions) {
    const key = session.훈련일자;
    const bucket = sessionsByDate.get(key) ?? [];
    bucket.push(session);
    sessionsByDate.set(key, bucket);
  }

  const generatedDayByCompactDate = new Map<string, ScheduleDay>();
  for (const day of input.generatedDays ?? []) {
    const compact = toCompactDate(day.date);
    if (!compact) {
      continue;
    }
    generatedDayByCompactDate.set(compact, day);
  }

  const dates = new Set<string>([
    ...Array.from(sessionsByDate.keys()),
    ...Array.from(generatedDayByCompactDate.keys())
  ]);

  const allRows: HrdRow[] = [];
  const sortedDates = Array.from(dates).sort((a, b) => a.localeCompare(b));

  for (const compactDate of sortedDates) {
    const daySessions = sessionsByDate.get(compactDate) ?? [];
    const generatedDay = generatedDayByCompactDate.get(compactDate);
    if (generatedDay) {
      const context = resolveDayCodeContext(daySessions);
      allRows.push(...buildRowsFromGeneratedDay(compactDate, generatedDay, context));
      continue;
    }

    if (daySessions.length > 0) {
      allRows.push(...buildRowsFromSessions(compactDate, daySessions));
      continue;
    }
  }

  return sortRows(dedupeRows(allRows));
}
