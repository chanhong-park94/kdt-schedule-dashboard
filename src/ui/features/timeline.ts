import { buildCohortInstructorMetaMap } from "../../core/instructorTimeline";
import { normalizeInstructorCode } from "../../core/standardize";
import { type CohortSummary, type Session } from "../../core/types";
import { appState, collapsedCourseGroups, holidayNameByDate, type TimelineViewType } from "../appState";
import { domRefs } from "../domRefs";
import {
  DAY_MS,
  addDaysToIso,
  formatDate,
  formatShortDateFromCompact,
  formatShortDateFromIso,
  getTodayIsoDate,
  parseCompactDate,
  parseIsoDate,
  toCompactDateFromIso,
} from "../utils/date";
import { formatHHMM, getReadableTextColorFromCssColor, parseCourseGroupFromCohortName } from "../utils/format";

export type TimelineNotificationFocus = {
  cohort?: string;
  assignee?: string;
  date?: string;
};

type MonthAxisItem = {
  key: string;
  label: string;
  leftPercent: number;
};

const TIMELINE_VIEW_ORDER: TimelineViewType[] = [
  "COHORT_TIMELINE",
  "COURSE_GROUPED",
  "ASSIGNEE_TIMELINE",
  "WEEK_GRID",
  "MONTH_CALENDAR",
];
const TIMELINE_RENDER_LIMIT = 600;

let _getCohortNotificationMap: () => Map<string, { warning: number; error: number }> = () =>
  new Map<string, { warning: number; error: number }>();
let _focusNotification: (focus: TimelineNotificationFocus) => void = () => {};

export function initTimelineFeature(deps: {
  getCohortNotificationMap: () => Map<string, { warning: number; error: number }>;
  focusNotification: (focus: TimelineNotificationFocus) => void;
}): void {
  _getCohortNotificationMap = deps.getCohortNotificationMap;
  _focusNotification = deps.focusNotification;
}

export function setTimelineViewType(nextView: TimelineViewType): void {
  appState.timelineViewType = TIMELINE_VIEW_ORDER.includes(nextView) ? nextView : "COHORT_TIMELINE";
  domRefs.timelineViewTypeSelect.value = appState.timelineViewType;
  domRefs.assigneeTimelineControls.style.display = appState.timelineViewType === "ASSIGNEE_TIMELINE" ? "block" : "none";
  domRefs.weekGridControls.style.display = appState.timelineViewType === "WEEK_GRID" ? "block" : "none";
  domRefs.monthCalendarControls.style.display = appState.timelineViewType === "MONTH_CALENDAR" ? "block" : "none";
}

export function parseTimelineViewType(value: string): TimelineViewType {
  return TIMELINE_VIEW_ORDER.includes(value as TimelineViewType) ? (value as TimelineViewType) : "COHORT_TIMELINE";
}

export function renderTimelineDetail(title: string, details: string[]): void {
  if (details.length === 0) {
    domRefs.timelineDetailPanel.style.display = "none";
    domRefs.timelineDetailPanel.textContent = "";
    return;
  }

  domRefs.timelineDetailPanel.style.display = "block";
  domRefs.timelineDetailPanel.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = title;
  domRefs.timelineDetailPanel.appendChild(strong);

  const list = document.createElement("ul");
  list.className = "error-list";
  for (const detail of details.slice(0, 12)) {
    const li = document.createElement("li");
    li.textContent = detail;
    list.appendChild(li);
  }
  domRefs.timelineDetailPanel.appendChild(list);
}

export function startOfWeekIso(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    return isoDate;
  }
  const utcDay = parsed.getUTCDay();
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
  return formatDate(new Date(parsed.getTime() + mondayOffset * DAY_MS));
}

function appendTimelineNotice(message: string): void {
  const notice = document.createElement("div");
  notice.className = "muted";
  notice.textContent = message;
  notice.style.marginBottom = "6px";
  domRefs.timelineList.appendChild(notice);
}

function buildMonthAxis(globalStart: number, globalEnd: number): MonthAxisItem[] {
  const span = Math.max(globalEnd - globalStart, 1);
  const axis: MonthAxisItem[] = [];
  const startDate = new Date(globalStart);
  const endDate = new Date(globalEnd);
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

  // 전체 월 개수 계산하여 라벨 밀도 결정
  const totalMonths =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth()) +
    1;
  // 12개월 이하: 매월 표시, 13~24: 격월, 25+: 3개월 간격
  const step = totalMonths <= 12 ? 1 : totalMonths <= 24 ? 2 : 3;
  let idx = 0;

  while (cursor.getTime() <= endDate.getTime()) {
    const leftPercent = ((cursor.getTime() - globalStart) / span) * 100;
    const safeLeft = Math.max(0, Math.min(100, leftPercent));
    const year = cursor.getUTCFullYear();
    const monthNum = cursor.getUTCMonth() + 1;
    const month = String(monthNum).padStart(2, "0");

    // 라벨: 1월이면 "YYYY-01", 그 외 "MM" (밀도가 높을 때 축약)
    const showLabel = idx % step === 0;
    let label = "";
    if (showLabel) {
      label = monthNum === 1 || idx === 0 ? `${year}-${month}` : month;
    }

    axis.push({
      key: `${year}-${month}`,
      label,
      leftPercent: safeLeft,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    idx++;
  }

  return axis;
}

function renderTimelineMonthAxis(globalStart: number, globalEnd: number): MonthAxisItem[] {
  const axis = buildMonthAxis(globalStart, globalEnd);
  if (axis.length === 0) {
    return axis;
  }

  const axisWrap = document.createElement("div");
  axisWrap.className = "timeline-axis";

  const line = document.createElement("div");
  line.className = "timeline-axis-line";
  axisWrap.appendChild(line);

  for (const item of axis) {
    const tick = document.createElement("div");
    tick.className = "timeline-axis-tick";
    tick.style.left = `${item.leftPercent}%`;
    tick.textContent = item.label;
    axisWrap.appendChild(tick);
  }

  domRefs.timelineList.appendChild(axisWrap);
  return axis;
}

function buildCohortTimelineItems(): Array<{ summary: CohortSummary; startDate: Date; endDate: Date }> {
  return appState.summaries
    .map((summary) => ({
      summary,
      startDate: parseCompactDate(summary.시작일),
      endDate: parseCompactDate(summary.종료일),
    }))
    .filter(
      (item): item is { summary: CohortSummary; startDate: Date; endDate: Date } =>
        item.startDate !== null && item.endDate !== null,
    )
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

function appendTimelineBarRow(params: {
  label: string;
  startDate: Date;
  endDate: Date;
  globalStart: number;
  globalEnd: number;
  title: string;
  barText?: string;
  barDateText?: string;
  barColor?: string;
  badgeText?: string;
  onBadgeClick?: () => void;
  onBarClick?: () => void;
  monthAxis?: MonthAxisItem[];
}): void {
  const span = Math.max(params.globalEnd - params.globalStart, 1);
  const startMs = params.startDate.getTime();
  const endMs = params.endDate.getTime();

  const leftPercent = ((startMs - params.globalStart) / span) * 100;
  const widthPercent = params.globalEnd === params.globalStart ? 100 : Math.max(((endMs - startMs) / span) * 100, 1.2);
  const safeLeft = Math.max(0, Math.min(100, leftPercent));
  const safeWidth = Math.max(0, Math.min(100 - safeLeft, widthPercent));

  const row = document.createElement("div");
  row.className = "timeline-row";

  const label = document.createElement("div");
  label.className = "timeline-label";
  const text = document.createElement("span");
  text.textContent = params.label;
  label.appendChild(text);

  if (params.badgeText && params.onBadgeClick) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "timeline-cohort-filter";
    badge.textContent = params.badgeText;
    badge.addEventListener("click", params.onBadgeClick);
    label.appendChild(badge);
  }

  const track = document.createElement("div");
  track.className = "timeline-track";
  if (params.monthAxis) {
    for (const month of params.monthAxis) {
      const line = document.createElement("span");
      line.className = "timeline-month-line";
      line.style.left = `${month.leftPercent}%`;
      track.appendChild(line);
    }
  }
  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = "timeline-bar";
  bar.style.left = `${safeLeft}%`;
  bar.style.width = `${safeWidth}%`;
  if (params.barColor) {
    bar.style.background = params.barColor;
  }
  bar.style.color = getReadableTextColorFromCssColor(params.barColor);

  const barMain = document.createElement("span");
  barMain.className = "timeline-bar-main";
  barMain.textContent = params.barText ?? "";
  bar.appendChild(barMain);

  if (params.barDateText) {
    const datePill = document.createElement("span");
    datePill.className = "timeline-date-pill";
    datePill.textContent = params.barDateText;
    bar.appendChild(datePill);
  }
  bar.title = params.title;
  if (params.onBarClick) {
    bar.addEventListener("click", params.onBarClick);
  }

  track.appendChild(bar);
  row.appendChild(label);
  row.appendChild(track);
  domRefs.timelineList.appendChild(row);
}

function renderCohortTimelineView(
  items: Array<{ summary: CohortSummary; startDate: Date; endDate: Date }>,
  cohortNotificationMap: Map<string, { warning: number; error: number }>,
  cohortInstructorMetaMap: ReturnType<typeof buildCohortInstructorMetaMap>,
): void {
  const limited = items.slice(0, TIMELINE_RENDER_LIMIT);
  if (items.length > limited.length) {
    appendTimelineNotice(`기수 ${items.length}건 중 상위 ${limited.length}건만 표시합니다.`);
  }

  const globalStart = limited.reduce((min, item) => Math.min(min, item.startDate.getTime()), Number.POSITIVE_INFINITY);
  const globalEnd = limited.reduce((max, item) => Math.max(max, item.endDate.getTime()), Number.NEGATIVE_INFINITY);
  const monthAxis = renderTimelineMonthAxis(globalStart, globalEnd);

  for (const item of limited) {
    const counts = cohortNotificationMap.get(item.summary.과정기수) ?? { warning: 0, error: 0 };
    const badgeText = counts.warning + counts.error > 0 ? `⚠ ${counts.warning} · ❗ ${counts.error}` : undefined;
    const instructorMeta = cohortInstructorMetaMap.get(item.summary.과정기수);
    const instructorText = instructorMeta?.instructorLabel ?? "강사: 미지정";
    const instructorTooltip = instructorMeta?.instructorTooltip ?? "강사 정보 없음";

    appendTimelineBarRow({
      label: item.summary.과정기수,
      startDate: item.startDate,
      endDate: item.endDate,
      globalStart,
      globalEnd,
      title: `시작일: ${formatDate(item.startDate)}\n종료일: ${formatDate(item.endDate)}\n훈련일수: ${item.summary.훈련일수}\n수업시간표 건수: ${item.summary.세션수}\n${instructorText}\n전체 강사: ${instructorTooltip}`,
      barText: item.summary.훈련일수 > 0 ? `${item.summary.훈련일수}일` : "",
      barDateText: `${formatShortDateFromCompact(item.summary.시작일)} -> ${formatShortDateFromCompact(item.summary.종료일)}`,
      barColor: instructorMeta?.barColor,
      monthAxis,
      badgeText,
      onBadgeClick: () => {
        _focusNotification({ cohort: item.summary.과정기수 });
      },
      onBarClick: () => {
        _focusNotification({ cohort: item.summary.과정기수 });
      },
    });
  }

  domRefs.timelineRange.textContent = `기간: ${formatDate(new Date(globalStart))} ~ ${formatDate(new Date(globalEnd))}`;
}

function renderCourseGroupedTimelineView(
  items: Array<{ summary: CohortSummary; startDate: Date; endDate: Date }>,
  cohortNotificationMap: Map<string, { warning: number; error: number }>,
  cohortInstructorMetaMap: ReturnType<typeof buildCohortInstructorMetaMap>,
): void {
  const groupMap = new Map<
    string,
    Array<{ summary: CohortSummary; startDate: Date; endDate: Date; cohortLabel: string }>
  >();
  for (const item of items) {
    const parsed = parseCourseGroupFromCohortName(item.summary.과정기수);
    const list = groupMap.get(parsed.course) ?? [];
    list.push({ ...item, cohortLabel: parsed.cohortLabel });
    groupMap.set(parsed.course, list);
  }

  const groupNames = Array.from(groupMap.keys()).sort((a, b) => a.localeCompare(b));
  let renderedCount = 0;

  for (const groupName of groupNames) {
    const rows = (groupMap.get(groupName) ?? []).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    if (rows.length === 0) {
      continue;
    }

    const groupCard = document.createElement("div");
    groupCard.className = "timeline-group";

    const header = document.createElement("div");
    header.className = "timeline-group-header";

    const title = document.createElement("strong");
    title.textContent = groupName;
    header.appendChild(title);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small-btn";
    const collapsed = collapsedCourseGroups.has(groupName);
    toggle.textContent = collapsed ? "펼치기" : "접기";
    header.appendChild(toggle);
    groupCard.appendChild(header);

    const container = document.createElement("div");
    container.style.display = collapsed ? "none" : "block";
    groupCard.appendChild(container);

    toggle.addEventListener("click", () => {
      const isCollapsed = collapsedCourseGroups.has(groupName);
      if (isCollapsed) {
        collapsedCourseGroups.delete(groupName);
      } else {
        collapsedCourseGroups.add(groupName);
      }
      renderTimeline();
    });

    domRefs.timelineList.appendChild(groupCard);

    if (collapsed) {
      continue;
    }

    const maxRenderCount = TIMELINE_RENDER_LIMIT - renderedCount;
    const limitedRows = rows.slice(0, Math.max(0, maxRenderCount));
    renderedCount += limitedRows.length;

    if (limitedRows.length === 0) {
      continue;
    }

    const groupStart = limitedRows.reduce(
      (min, item) => Math.min(min, item.startDate.getTime()),
      Number.POSITIVE_INFINITY,
    );
    const groupEnd = limitedRows.reduce((max, item) => Math.max(max, item.endDate.getTime()), Number.NEGATIVE_INFINITY);
    const monthAxis = buildMonthAxis(groupStart, groupEnd);

    for (const item of limitedRows) {
      const rowHost = document.createElement("div");
      rowHost.className = "timeline-row";

      const label = document.createElement("div");
      label.className = "timeline-label";
      label.textContent = `${item.cohortLabel}`;
      rowHost.appendChild(label);

      const track = document.createElement("div");
      track.className = "timeline-track";
      for (const month of monthAxis) {
        const line = document.createElement("span");
        line.className = "timeline-month-line";
        line.style.left = `${month.leftPercent}%`;
        track.appendChild(line);
      }
      const bar = document.createElement("button");
      bar.type = "button";
      bar.className = "timeline-bar";
      const span = Math.max(groupEnd - groupStart, 1);
      const left = ((item.startDate.getTime() - groupStart) / span) * 100;
      const width =
        groupEnd === groupStart
          ? 100
          : Math.max(((item.endDate.getTime() - item.startDate.getTime()) / span) * 100, 1.2);
      const safeLeft = Math.max(0, Math.min(100, left));
      const safeWidth = Math.max(0, Math.min(100 - safeLeft, width));
      bar.style.left = `${safeLeft}%`;
      bar.style.width = `${safeWidth}%`;
      const instructorMeta = cohortInstructorMetaMap.get(item.summary.과정기수);
      const instructorText = instructorMeta?.instructorLabel ?? "강사: 미지정";
      const instructorTooltip = instructorMeta?.instructorTooltip ?? "강사 정보 없음";
      if (instructorMeta?.barColor) {
        bar.style.background = instructorMeta.barColor;
      }
      bar.style.color = getReadableTextColorFromCssColor(instructorMeta?.barColor);
      const barMain = document.createElement("span");
      barMain.className = "timeline-bar-main";
      barMain.textContent = `${item.cohortLabel}`;
      bar.appendChild(barMain);

      const datePill = document.createElement("span");
      datePill.className = "timeline-date-pill";
      datePill.textContent = `${formatShortDateFromCompact(item.summary.시작일)} -> ${formatShortDateFromCompact(item.summary.종료일)}`;
      bar.appendChild(datePill);
      bar.title = `${groupName} / ${item.summary.과정기수}\n${instructorText}\n전체 강사: ${instructorTooltip}`;
      bar.addEventListener("click", () => {
        _focusNotification({ cohort: item.summary.과정기수 });
      });
      track.appendChild(bar);
      rowHost.appendChild(track);

      const counts = cohortNotificationMap.get(item.summary.과정기수) ?? { warning: 0, error: 0 };
      if (counts.warning + counts.error > 0) {
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = "timeline-cohort-filter";
        badge.textContent = `⚠ ${counts.warning} · ❗ ${counts.error}`;
        badge.addEventListener("click", () => {
          _focusNotification({ cohort: item.summary.과정기수 });
        });
        label.appendChild(badge);
      }

      container.appendChild(rowHost);
    }

    if (renderedCount >= TIMELINE_RENDER_LIMIT) {
      appendTimelineNotice(`렌더 안전을 위해 상위 ${TIMELINE_RENDER_LIMIT}개 항목까지만 표시합니다.`);
      break;
    }
  }

  const globalStart = items.reduce((min, item) => Math.min(min, item.startDate.getTime()), Number.POSITIVE_INFINITY);
  const globalEnd = items.reduce((max, item) => Math.max(max, item.endDate.getTime()), Number.NEGATIVE_INFINITY);
  domRefs.timelineRange.textContent = `기간: ${formatDate(new Date(globalStart))} ~ ${formatDate(new Date(globalEnd))}`;
}

export function getSessionIsoDate(session: Session): string | null {
  if (session.normalizedDate && parseIsoDate(session.normalizedDate)) {
    return session.normalizedDate;
  }

  const parsed = parseCompactDate(session.훈련일자);
  if (!parsed) {
    return null;
  }
  return formatDate(parsed);
}

function renderAssigneeTimelineView(): void {
  type AssigneeRow = {
    key: string;
    startDate: string;
    endDate: string;
    count: number;
    conflictCount: number;
    conflictComputed: boolean;
  };
  const rows: AssigneeRow[] = [];

  if (appState.assigneeTimelineKind === "INSTRUCTOR") {
    const byInstructor = new Map<string, { startDate: string; endDate: string; count: number }>();
    for (const session of appState.sessions) {
      const instructor = normalizeInstructorCode(session.훈련강사코드);
      const iso = getSessionIsoDate(session);
      if (!instructor || !iso) {
        continue;
      }
      const prev = byInstructor.get(instructor);
      if (!prev) {
        byInstructor.set(instructor, { startDate: iso, endDate: iso, count: 1 });
        continue;
      }
      prev.startDate = prev.startDate < iso ? prev.startDate : iso;
      prev.endDate = prev.endDate > iso ? prev.endDate : iso;
      prev.count += 1;
    }

    const conflictMap = new Map<string, number>();
    for (const conflict of appState.allConflicts) {
      const key = normalizeInstructorCode(conflict.키);
      if (!key) {
        continue;
      }
      conflictMap.set(key, (conflictMap.get(key) ?? 0) + 1);
    }

    for (const [key, value] of byInstructor.entries()) {
      rows.push({
        key,
        startDate: value.startDate,
        endDate: value.endDate,
        count: value.count,
        conflictCount: conflictMap.get(key) ?? 0,
        conflictComputed: appState.hasComputedConflicts,
      });
    }
  } else {
    const byAssignee = new Map<string, { startDate: string; endDate: string; count: number }>();
    for (const assignment of appState.staffingAssignments) {
      const assignee = assignment.assignee.trim();
      if (!assignee || !parseIsoDate(assignment.startDate) || !parseIsoDate(assignment.endDate)) {
        continue;
      }
      const prev = byAssignee.get(assignee);
      if (!prev) {
        byAssignee.set(assignee, { startDate: assignment.startDate, endDate: assignment.endDate, count: 1 });
        continue;
      }
      prev.startDate = prev.startDate < assignment.startDate ? prev.startDate : assignment.startDate;
      prev.endDate = prev.endDate > assignment.endDate ? prev.endDate : assignment.endDate;
      prev.count += 1;
    }

    const overlapMap = new Map<string, number>();
    for (const overlap of [...appState.instructorDayOverlaps, ...appState.facilitatorOperationOverlaps]) {
      const assignee = overlap.assignee.trim();
      if (!assignee) {
        continue;
      }
      overlapMap.set(assignee, (overlapMap.get(assignee) ?? 0) + 1);
    }

    for (const [key, value] of byAssignee.entries()) {
      rows.push({
        key,
        startDate: value.startDate,
        endDate: value.endDate,
        count: value.count,
        conflictCount: overlapMap.get(key) ?? 0,
        conflictComputed: true,
      });
    }
  }

  rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.key.localeCompare(b.key));
  const limited = rows.slice(0, TIMELINE_RENDER_LIMIT);
  if (rows.length > limited.length) {
    appendTimelineNotice(`담당 항목 ${rows.length}건 중 상위 ${limited.length}건만 표시합니다.`);
  }

  if (limited.length === 0) {
    domRefs.timelineRange.textContent = "기간: -";
    domRefs.timelineEmpty.style.display = "block";
    domRefs.timelineEmpty.textContent =
      appState.assigneeTimelineKind === "INSTRUCTOR"
        ? "강사 기준 데이터가 없습니다."
        : "담당자 기준 데이터가 없습니다.";
    return;
  }

  domRefs.timelineEmpty.style.display = "none";
  domRefs.timelineEmpty.textContent = "수업시간표를 불러오면 타임라인이 생성됩니다.";

  const globalStart = limited.reduce(
    (min, item) => Math.min(min, parseIsoDate(item.startDate)?.getTime() ?? min),
    Number.POSITIVE_INFINITY,
  );
  const globalEnd = limited.reduce(
    (max, item) => Math.max(max, parseIsoDate(item.endDate)?.getTime() ?? max),
    Number.NEGATIVE_INFINITY,
  );
  const monthAxis = renderTimelineMonthAxis(globalStart, globalEnd);

  for (const row of limited) {
    const startDate = parseIsoDate(row.startDate);
    const endDate = parseIsoDate(row.endDate);
    if (!startDate || !endDate) {
      continue;
    }

    appendTimelineBarRow({
      label: row.key,
      startDate,
      endDate,
      globalStart,
      globalEnd,
      title: `${row.key}\n시작: ${row.startDate}\n종료: ${row.endDate}\n대상 건수: ${row.count}`,
      barText: row.key,
      barDateText: `${formatShortDateFromIso(row.startDate)} -> ${formatShortDateFromIso(row.endDate)}`,
      monthAxis,
      badgeText: !row.conflictComputed ? "미계산" : row.conflictCount > 0 ? `❗ ${row.conflictCount}` : undefined,
      onBadgeClick: () => {
        _focusNotification({ assignee: row.key });
      },
      onBarClick: () => {
        _focusNotification({ assignee: row.key });
      },
    });
  }

  domRefs.timelineRange.textContent = `기간: ${formatDate(new Date(globalStart))} ~ ${formatDate(new Date(globalEnd))}`;
}

function renderWeekGridView(): void {
  const start = startOfWeekIso(appState.weekGridStartDate);
  appState.weekGridStartDate = start;

  const dayNames = ["월", "화", "수", "목", "금", "토", "일"];
  const days = Array.from({ length: 7 }, (_, index) => addDaysToIso(start, index));
  domRefs.weekLabel.textContent = `${days[0]} ~ ${days[6]}`;
  domRefs.timelineRange.textContent = `기간: ${days[0]} ~ ${days[6]}`;

  const grid = document.createElement("div");
  grid.className = "timeline-grid";

  for (const [index, day] of days.entries()) {
    const sessionsOnDay = appState.sessions.filter((session) => getSessionIsoDate(session) === day);
    const cell = document.createElement("div");
    cell.className = "timeline-grid-cell";
    if (sessionsOnDay.length > 0) {
      cell.classList.add("has-class");
    }
    if (appState.holidayDates.includes(day) || appState.customBreakDates.includes(day)) {
      cell.classList.add("holiday");
      const holidayName = holidayNameByDate.get(day);
      const dayType = holidayName
        ? `공휴일: ${holidayName}`
        : appState.customBreakDates.includes(day)
          ? "자체휴강"
          : "공휴일";
      cell.title = `${day} ${dayType}`;
    }

    const title = document.createElement("div");
    title.className = "timeline-grid-title";
    title.textContent = `${dayNames[index]} ${day}`;
    cell.appendChild(title);

    const body = document.createElement("div");
    body.textContent = sessionsOnDay.length > 0 ? `수업 ${sessionsOnDay.length}건` : "수업 없음";
    cell.appendChild(body);

    cell.addEventListener("click", () => {
      const details = sessionsOnDay.map(
        (session) =>
          `${session.과정기수} / ${session["교과목(및 능력단위)코드"]} / ${formatHHMM(session.훈련시작시간)}-${formatHHMM(session.훈련종료시간)}`,
      );
      renderTimelineDetail(`${day} 수업시간표`, details);
      if (sessionsOnDay.length > 0) {
        _focusNotification({ date: toCompactDateFromIso(day) });
      }
    });

    grid.appendChild(cell);
  }

  domRefs.timelineList.appendChild(grid);
}

function renderMonthCalendarView(): void {
  const parsedMonth = appState.monthCalendarCursor.match(/^(\d{4})-(\d{2})$/);
  if (!parsedMonth) {
    appState.monthCalendarCursor = getTodayIsoDate().slice(0, 7);
  }
  const [year, month] = appState.monthCalendarCursor.split("-").map((value) => Number.parseInt(value, 10));
  const first = new Date(Date.UTC(year, (month || 1) - 1, 1));
  const monthLabelText = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}`;
  appState.monthCalendarCursor = monthLabelText;
  domRefs.monthLabel.textContent = monthLabelText;

  const firstIso = formatDate(first);
  const start = startOfWeekIso(firstIso);
  const weekdayHeader = document.createElement("div");
  weekdayHeader.className = "timeline-weekday-header";
  const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
  for (const [index, labelText] of weekdayLabels.entries()) {
    const cell = document.createElement("div");
    cell.className = `timeline-weekday-cell${index >= 5 ? " weekend" : ""}`;
    cell.textContent = labelText;
    weekdayHeader.appendChild(cell);
  }
  domRefs.timelineList.appendChild(weekdayHeader);

  const grid = document.createElement("div");
  grid.className = "timeline-grid";

  for (let i = 0; i < 42; i += 1) {
    const day = addDaysToIso(start, i);
    const sessionsOnDay = appState.sessions.filter((session) => getSessionIsoDate(session) === day);
    const inCurrentMonth = day.slice(0, 7) === appState.monthCalendarCursor;
    const dayOfWeek = parseIsoDate(day)?.getUTCDay() ?? 1;

    const cell = document.createElement("div");
    cell.className = "timeline-grid-cell";
    if (sessionsOnDay.length > 0) {
      cell.classList.add("has-class");
    }
    if (appState.holidayDates.includes(day) || appState.customBreakDates.includes(day)) {
      cell.classList.add("holiday");
      const holidayName = holidayNameByDate.get(day);
      const dayType = holidayName
        ? `공휴일: ${holidayName}`
        : appState.customBreakDates.includes(day)
          ? "자체휴강"
          : "공휴일";
      cell.title = `${day} ${dayType}`;
    }
    if (!inCurrentMonth) {
      cell.style.opacity = "0.55";
    }
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      cell.classList.add("weekend");
    }
    if (day === getTodayIsoDate()) {
      cell.classList.add("today");
    }

    const title = document.createElement("div");
    title.className = "timeline-grid-title";
    title.textContent = day;
    cell.appendChild(title);

    const body = document.createElement("div");
    body.textContent = sessionsOnDay.length > 0 ? `수업 ${sessionsOnDay.length}건` : "-";
    cell.appendChild(body);

    cell.addEventListener("click", () => {
      const details = sessionsOnDay.map(
        (session) =>
          `${session.과정기수} / ${session["교과목(및 능력단위)코드"]} / ${formatHHMM(session.훈련시작시간)}-${formatHHMM(session.훈련종료시간)}`,
      );
      renderTimelineDetail(`${day} 요약`, details);
      if (sessionsOnDay.length > 0) {
        _focusNotification({ date: toCompactDateFromIso(day) });
      }
    });

    grid.appendChild(cell);
  }

  domRefs.timelineRange.textContent = `월: ${appState.monthCalendarCursor}`;
  domRefs.timelineList.appendChild(grid);
}

export function renderTimeline(): void {
  domRefs.timelineList.innerHTML = "";
  const cohortNotificationMap = _getCohortNotificationMap();
  const cohortInstructorMetaMap = buildCohortInstructorMetaMap(appState.sessions);
  const timelineItems = buildCohortTimelineItems();

  domRefs.timelineDetailPanel.style.display = "none";
  domRefs.timelineDetailPanel.textContent = "";

  if (
    timelineItems.length === 0 &&
    (appState.timelineViewType === "COHORT_TIMELINE" || appState.timelineViewType === "COURSE_GROUPED")
  ) {
    domRefs.timelineRange.textContent = "기간: -";
    domRefs.timelineEmpty.style.display = "block";
    return;
  }

  domRefs.timelineEmpty.style.display = "none";
  domRefs.timelineEmpty.textContent = "수업시간표를 불러오면 타임라인이 생성됩니다.";

  if (appState.timelineViewType === "COHORT_TIMELINE") {
    renderCohortTimelineView(timelineItems, cohortNotificationMap, cohortInstructorMetaMap);
    return;
  }

  if (appState.timelineViewType === "COURSE_GROUPED") {
    renderCourseGroupedTimelineView(timelineItems, cohortNotificationMap, cohortInstructorMetaMap);
    return;
  }

  if (appState.timelineViewType === "ASSIGNEE_TIMELINE") {
    renderAssigneeTimelineView();
    return;
  }

  if (appState.timelineViewType === "WEEK_GRID") {
    renderWeekGridView();
    return;
  }

  renderMonthCalendarView();
}
