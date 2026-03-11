import { hhmmToMinutes, normalizeHHMM } from "./normalize";
import { normalizeClassroomCode, normalizeInstructorCode, normalizeSubjectCode } from "./standardize";
import { FromScheduleDaysToSessionsParams, Session } from "./types";

function toCompactDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`일정 날짜 형식이 올바르지 않습니다: ${value}`);
  }

  return value.replace(/-/g, "");
}

function sanitizeOptionalCode(
  value: string | undefined,
  fallback: string,
  normalizer: (raw: string) => string,
): string {
  const trimmed = (value ?? "").trim();
  return normalizer(trimmed.length > 0 ? trimmed : fallback);
}

type NormalizedBlock = {
  startHHMM: string;
  endHHMM: string;
  startMin: number;
  endMin: number;
};

function normalizeBlock(startValue: string, endValue: string, context: string): NormalizedBlock {
  const startHHMM = normalizeHHMM(startValue);
  const endHHMM = normalizeHHMM(endValue);

  if (!startHHMM || !endHHMM) {
    throw new Error(`${context} 블록 시간 형식이 올바르지 않습니다. (HHMM)`);
  }

  const startMin = hhmmToMinutes(startHHMM);
  const endMin = hhmmToMinutes(endHHMM);

  if (startMin === null || endMin === null || startMin >= endMin) {
    throw new Error(`${context} 블록 시작시간은 종료시간보다 빨라야 합니다.`);
  }

  return {
    startHHMM,
    endHHMM,
    startMin,
    endMin,
  };
}

export function fromScheduleDaysToSessions(params: FromScheduleDaysToSessionsParams): Session[] {
  const cohort = params.cohort.trim();
  if (!cohort) {
    throw new Error("과정기수명이 비어 있습니다.");
  }

  const instructorCode = sanitizeOptionalCode(params.instructorCode, "AUTO-INSTR", normalizeInstructorCode);
  const classroomCode = sanitizeOptionalCode(params.classroomCode, "AUTO-ROOM", normalizeClassroomCode);
  const subjectCode = sanitizeOptionalCode(params.subjectCode, "AUTO-SUBJECT", normalizeSubjectCode);

  const sessions: Session[] = [];

  params.days.forEach((day, dayIndex) => {
    const context = `days[${dayIndex}](${day.date})`;
    const normalizedDate = day.date;
    const trainingDate = toCompactDate(normalizedDate);

    if (!Array.isArray(day.blocks) || day.blocks.length === 0) {
      throw new Error(`${context} blocks가 비어 있습니다.`);
    }

    const normalizedBlocks = day.blocks
      .map((block, blockIndex) => normalizeBlock(block.startHHMM, block.endHHMM, `${context}.blocks[${blockIndex}]`))
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

    const dayStart = normalizedBlocks[0];
    const dayEnd = normalizedBlocks[normalizedBlocks.length - 1];

    normalizedBlocks.forEach((block, blockIndex) => {
      sessions.push({
        훈련일자: trainingDate,
        훈련시작시간: dayStart.startHHMM,
        훈련종료시간: dayEnd.endHHMM,
        "방학/원격여부": "",
        시작시간: block.startHHMM,
        시간구분: String(blockIndex + 1),
        훈련강사코드: instructorCode,
        "교육장소(강의실)코드": classroomCode,
        "교과목(및 능력단위)코드": subjectCode,
        과정기수: cohort,
        normalizedDate,
        startMin: dayStart.startMin,
        endMin: dayEnd.endMin,
      });
    });
  });

  return sessions;
}
