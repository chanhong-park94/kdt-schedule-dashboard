import { hhmmToMinutes, normalizeHHMM } from "./normalize";
import { DayTimeTemplate, GenerateScheduleResult, ScheduleConfig, ScheduleDay, SkippedDay, TimeRange } from "./types";

const MAX_ITERATION_DAYS = 1000;

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

function formatIsoDate(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function toValidDateSet(values: string[], label: string): Set<string> {
  const result = new Set<string>();

  for (const value of values) {
    const parsed = parseIsoDate(value);
    if (!parsed) {
      throw new Error(`${label} 날짜 형식이 올바르지 않습니다: ${value}`);
    }
    result.add(formatIsoDate(parsed));
  }

  return result;
}

function toWeekdaySet(weekdays: number[]): Set<number> {
  const result = new Set<number>();

  for (const value of weekdays) {
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error(`요일 값은 0~6 정수여야 합니다: ${value}`);
    }
    result.add(value);
  }

  return result;
}

function normalizeTimeRange(
  range: TimeRange,
  label: string,
  context: string,
): { startHHMM: string; endHHMM: string; startMin: number; endMin: number } {
  const normalizedStart = normalizeHHMM(range.startHHMM);
  const normalizedEnd = normalizeHHMM(range.endHHMM);

  if (!normalizedStart || !normalizedEnd) {
    throw new Error(`${context} ${label} 형식이 올바르지 않습니다.`);
  }

  const startMin = hhmmToMinutes(normalizedStart);
  const endMin = hhmmToMinutes(normalizedEnd);

  if (startMin === null || endMin === null || startMin >= endMin) {
    throw new Error(`${context} ${label} 시작/종료 시간이 올바르지 않습니다.`);
  }

  return {
    startHHMM: normalizedStart,
    endHHMM: normalizedEnd,
    startMin,
    endMin,
  };
}

function normalizeTemplate(
  template: DayTimeTemplate,
  context: string,
): {
  weekday: number;
  blocks: Array<{ startHHMM: string; endHHMM: string; startMin: number; endMin: number }>;
  breaks: Array<{ startHHMM: string; endHHMM: string; startMin: number; endMin: number }>;
} {
  if (!Number.isInteger(template.weekday) || template.weekday < 0 || template.weekday > 6) {
    throw new Error(`${context} weekday 값은 0~6 정수여야 합니다.`);
  }

  if (!Array.isArray(template.blocks) || template.blocks.length === 0) {
    throw new Error(`${context} blocks는 1개 이상이어야 합니다.`);
  }

  const normalizedBlocks = template.blocks.map((block, index) =>
    normalizeTimeRange(block, `blocks[${index}]`, context),
  );

  const normalizedBreaks = (template.breaks ?? []).map((breakRange, index) =>
    normalizeTimeRange(breakRange, `breaks[${index}]`, context),
  );

  return {
    weekday: template.weekday,
    blocks: normalizedBlocks,
    breaks: normalizedBreaks,
  };
}

function sumBlockMinutes(
  blocks: Array<{ startMin: number; endMin: number }>,
  breaks: Array<{ startMin: number; endMin: number }>,
): number {
  let total = 0;

  for (const block of blocks) {
    total += block.endMin - block.startMin;

    const overlaps: Array<{ start: number; end: number }> = [];
    for (const breakRange of breaks) {
      const overlapStart = Math.max(block.startMin, breakRange.startMin);
      const overlapEnd = Math.min(block.endMin, breakRange.endMin);
      if (overlapStart < overlapEnd) {
        overlaps.push({ start: overlapStart, end: overlapEnd });
      }
    }

    if (overlaps.length === 0) {
      continue;
    }

    overlaps.sort((a, b) => a.start - b.start || a.end - b.end);

    let mergedStart = overlaps[0].start;
    let mergedEnd = overlaps[0].end;

    for (let i = 1; i < overlaps.length; i += 1) {
      const current = overlaps[i];
      if (current.start <= mergedEnd) {
        mergedEnd = Math.max(mergedEnd, current.end);
      } else {
        total -= mergedEnd - mergedStart;
        mergedStart = current.start;
        mergedEnd = current.end;
      }
    }

    total -= mergedEnd - mergedStart;
  }

  return total;
}

export function generateSchedule(config: ScheduleConfig): GenerateScheduleResult {
  if (!Number.isFinite(config.totalHours) || config.totalHours <= 0) {
    throw new Error("총 훈련시간은 0보다 커야 합니다.");
  }

  const startDate = parseIsoDate(config.startDate);
  if (!startDate) {
    throw new Error(`개강일 형식이 올바르지 않습니다: ${config.startDate}`);
  }

  const weekdaySet = toWeekdaySet(config.weekdays);
  if (weekdaySet.size === 0) {
    throw new Error("수업 요일이 비어 있습니다.");
  }

  if (!Array.isArray(config.dayTemplates) || config.dayTemplates.length === 0) {
    throw new Error("dayTemplates가 비어 있습니다.");
  }

  const holidaySet = toValidDateSet(config.holidays, "공휴일");
  const customBreakSet = toValidDateSet(config.customBreaks, "자체휴강일");

  const weekdayTemplateMap = new Map<
    number,
    {
      weekday: number;
      blocks: Array<{ startHHMM: string; endHHMM: string; startMin: number; endMin: number }>;
      breaks: Array<{ startHHMM: string; endHHMM: string; startMin: number; endMin: number }>;
    }
  >();

  for (const template of config.dayTemplates) {
    const normalized = normalizeTemplate(template, `dayTemplates[weekday=${template.weekday}]`);
    if (weekdayTemplateMap.has(normalized.weekday)) {
      throw new Error(`요일(${normalized.weekday}) 템플릿이 중복되었습니다.`);
    }
    weekdayTemplateMap.set(normalized.weekday, normalized);
  }

  for (const weekday of weekdaySet.values()) {
    if (!weekdayTemplateMap.has(weekday)) {
      throw new Error(`weekdays에 포함된 요일(${weekday})의 템플릿이 없습니다.`);
    }
  }

  const overrideTemplateMap = new Map<
    string,
    {
      weekday: number;
      blocks: Array<{ startHHMM: string; endHHMM: string; startMin: number; endMin: number }>;
      breaks: Array<{ startHHMM: string; endHHMM: string; startMin: number; endMin: number }>;
    }
  >();

  const overrides = config.dateOverrides ?? {};
  for (const [dateText, template] of Object.entries(overrides)) {
    const parsed = parseIsoDate(dateText);
    if (!parsed) {
      throw new Error(`dateOverrides 날짜 형식이 올바르지 않습니다: ${dateText}`);
    }
    const normalizedDate = formatIsoDate(parsed);
    const normalizedTemplate = normalizeTemplate(template, `dateOverrides[${normalizedDate}]`);
    overrideTemplateMap.set(normalizedDate, normalizedTemplate);
  }

  const days: ScheduleDay[] = [];
  const skipped: SkippedDay[] = [];

  const totalTargetMinutes = Math.round(config.totalHours * 60);
  let totalPlannedMinutes = 0;
  let currentDate = startDate;

  for (let i = 0; i < MAX_ITERATION_DAYS; i += 1) {
    const dateText = formatIsoDate(currentDate);
    const weekday = currentDate.getUTCDay();

    if (!weekdaySet.has(weekday)) {
      skipped.push({ date: dateText, reason: "weekday_excluded" });
    } else if (holidaySet.has(dateText)) {
      skipped.push({ date: dateText, reason: "holiday" });
    } else if (customBreakSet.has(dateText)) {
      skipped.push({ date: dateText, reason: "custom_break" });
    } else {
      const template = overrideTemplateMap.get(dateText) ?? weekdayTemplateMap.get(weekday);
      if (!template) {
        throw new Error(`수업일(${dateText})의 템플릿을 찾을 수 없습니다.`);
      }

      const netMinutes = sumBlockMinutes(template.blocks, template.breaks);
      if (netMinutes <= 0) {
        throw new Error(`수업일(${dateText})의 순수 수업 시간이 0분 이하입니다.`);
      }

      const scheduleDay: ScheduleDay = {
        date: dateText,
        blocks: template.blocks.map((block) => ({
          startHHMM: block.startHHMM,
          endHHMM: block.endHHMM,
        })),
        breaks: template.breaks.map((breakRange) => ({
          startHHMM: breakRange.startHHMM,
          endHHMM: breakRange.endHHMM,
        })),
        netMinutes,
      };

      days.push(scheduleDay);
      totalPlannedMinutes += netMinutes;

      if (totalPlannedMinutes >= totalTargetMinutes) {
        return {
          days,
          endDate: dateText,
          totalHoursPlanned: totalPlannedMinutes / 60,
          totalDays: days.length,
          skipped,
        };
      }
    }

    currentDate = addDays(currentDate, 1);
  }

  throw new Error(`최대 반복일수(${MAX_ITERATION_DAYS}일)를 초과했습니다.`);
}
