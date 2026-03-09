import { fetchPublicHolidaysKR } from "../../core/holidays";
import { type Holiday } from "../../core/types";
import { appState, holidayNameByDate } from "../appState";
import { domRefs } from "../domRefs";
import { dedupeAndSortDates, formatDate, parseIsoDate } from "../utils/date";

type HolidaysFeatureDeps = {
  refreshHrdValidation: () => void;
  scheduleAutoSave: () => void;
  setHolidayLoadingState: (loading: boolean) => void;
  setScheduleError: (message: string | null) => void;
};

const defaultDeps: HolidaysFeatureDeps = {
  refreshHrdValidation: () => {},
  scheduleAutoSave: () => {},
  setHolidayLoadingState: () => {},
  setScheduleError: () => {}
};

let deps: HolidaysFeatureDeps = defaultDeps;

export function initHolidaysFeature(nextDeps: HolidaysFeatureDeps): void {
  deps = nextDeps;
}

export function renderDateList(
  listElement: HTMLUListElement,
  values: string[],
  toLabel: (value: string) => string,
  onRemove: (value: string) => void
): void {
  listElement.innerHTML = "";

  if (values.length === 0) {
    const li = document.createElement("li");
    li.textContent = "없음";
    listElement.appendChild(li);
    return;
  }

  for (const value of values) {
    const li = document.createElement("li");

    const text = document.createElement("span");
    text.textContent = toLabel(value);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "small-btn";
    removeButton.textContent = "삭제";
    removeButton.addEventListener("click", () => {
      onRemove(value);
    });

    li.appendChild(text);
    li.appendChild(removeButton);
    listElement.appendChild(li);
  }
}

export function getHolidayDisplayLabel(date: string): string {
  const holidayName = holidayNameByDate.get(date);
  return holidayName ? `${date} (${holidayName})` : date;
}

export function renderHolidayAndBreakLists(): void {
  renderDateList(domRefs.holidayList, appState.holidayDates, (value) => {
    return getHolidayDisplayLabel(value);
  }, (value) => {
    appState.holidayDates = appState.holidayDates.filter((item) => item !== value);
    renderHolidayAndBreakLists();
  });

  renderDateList(domRefs.customBreakList, appState.customBreakDates, (value) => {
    return value;
  }, (value) => {
    appState.customBreakDates = appState.customBreakDates.filter((item) => item !== value);
    renderHolidayAndBreakLists();
  });

  deps.refreshHrdValidation();
  deps.scheduleAutoSave();
}

export function addDateToList(input: HTMLInputElement, target: "holiday" | "customBreak"): void {
  const value = input.value.trim();
  const parsed = parseIsoDate(value);
  if (!parsed) {
    deps.setScheduleError("날짜를 선택해 주세요.");
    return;
  }

  const normalized = formatDate(parsed);
  const source = target === "holiday" ? appState.holidayDates : appState.customBreakDates;
  if (source.includes(normalized)) {
    deps.setScheduleError("이미 추가된 날짜입니다.");
    return;
  }

  source.push(normalized);
  source.sort((a, b) => a.localeCompare(b));

  input.value = "";
  deps.setScheduleError(null);
  renderHolidayAndBreakLists();
}

export function getHolidayFetchYears(startDate: string): number[] {
  const parsed = parseIsoDate(startDate);
  if (!parsed) {
    throw new Error("개강일을 먼저 입력해 주세요.");
  }

  const end = new Date(parsed.getTime());
  end.setUTCMonth(end.getUTCMonth() + 18);

  const years: number[] = [];
  for (let year = parsed.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    years.push(year);
  }

  return years;
}

export function mergeFetchedHolidays(holidays: Holiday[]): number {
  const existing = new Set(appState.holidayDates);
  const before = existing.size;

  for (const holiday of holidays) {
    const parsed = parseIsoDate(holiday.date);
    if (!parsed) {
      continue;
    }

    const date = formatDate(parsed);
    existing.add(date);
    holidayNameByDate.set(date, holiday.localName || holiday.name);
  }

  appState.holidayDates = Array.from(existing).sort((a, b) => a.localeCompare(b));
  return appState.holidayDates.length - before;
}

export async function loadPublicHolidays(): Promise<void> {
  let years: number[];
  try {
    years = getHolidayFetchYears(domRefs.scheduleStartDateInput.value);
  } catch (error) {
    if (error instanceof Error) {
      deps.setScheduleError(error.message);
    } else {
      deps.setScheduleError("공휴일 조회 기준 연도를 계산할 수 없습니다.");
    }
    return;
  }

  deps.setHolidayLoadingState(true);
  domRefs.holidayLoadStatus.textContent = `${years.join(", ")}년 공휴일 조회 중...`;
  deps.setScheduleError(null);

  try {
    const responses = await Promise.all(years.map((year) => fetchPublicHolidaysKR(year)));
    const holidays = responses.flat();
    const added = mergeFetchedHolidays(holidays);
    appState.hasLoadedPublicHoliday = holidays.length > 0;

    renderHolidayAndBreakLists();
    domRefs.holidayLoadStatus.textContent = `${years.join(", ")}년 공휴일 ${holidays.length}건 조회, ${added}건 추가`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "공휴일 조회 중 알 수 없는 오류";
    deps.setScheduleError(`${reason} 재시도해 주세요.`);
    domRefs.holidayLoadStatus.textContent = "공휴일 불러오기 실패";
  } finally {
    deps.setHolidayLoadingState(false);
  }
}

export function clearHolidayList(): void {
  appState.holidayDates = [];
  holidayNameByDate.clear();
  appState.hasLoadedPublicHoliday = false;
  renderHolidayAndBreakLists();
  domRefs.holidayLoadStatus.textContent = "공휴일 목록을 초기화했습니다.";
}

export function dedupeHolidayList(): void {
  const before = appState.holidayDates.length;
  appState.holidayDates = dedupeAndSortDates(appState.holidayDates);
  renderHolidayAndBreakLists();

  const removed = before - appState.holidayDates.length;
  domRefs.holidayLoadStatus.textContent = removed > 0 ? `중복 ${removed}건 제거` : "중복된 날짜가 없습니다.";
}

export function handleAddHoliday(): void {
  addDateToList(domRefs.holidayDateInput, "holiday");
}

export function handleLoadPublicHolidays(): void {
  void loadPublicHolidays();
}

export function handleAddCustomBreak(): void {
  addDateToList(domRefs.customBreakDateInput, "customBreak");
}
