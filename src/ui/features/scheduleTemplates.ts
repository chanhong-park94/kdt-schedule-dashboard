import {
  createDefaultScheduleTemplates,
  findScheduleTemplate,
  mergeScheduleTemplates,
  removeScheduleTemplate,
  SCHEDULE_TEMPLATE_STORAGE_KEY,
  upsertScheduleTemplate
} from "../../core/scheduleTemplates";
import { type TemplateRowState } from "../../core/state";
import { appState } from "../appState";
import { domRefs } from "../domRefs";

type ScheduleTemplatesFeatureDeps = {
  scheduleAutoSave: () => void;
  updateActionStates: () => void;
  pushRecentActionLog: (severity: "INFO" | "WARNING" | "ERROR", message: string, focusSectionId?: string) => void;
};

const defaultDeps: ScheduleTemplatesFeatureDeps = {
  scheduleAutoSave: () => {},
  updateActionStates: () => {},
  pushRecentActionLog: () => {}
};

let deps: ScheduleTemplatesFeatureDeps = defaultDeps;

export function initScheduleTemplatesFeature(nextDeps: ScheduleTemplatesFeatureDeps): void {
  deps = nextDeps;
}

export function collectTemplateRowsState(): TemplateRowState[] {
  const rows = Array.from(domRefs.dayTemplateTable.querySelectorAll<HTMLTableRowElement>("tbody tr"));

  return rows
    .map((row) => {
      const weekday = Number.parseInt(row.dataset.weekday ?? "", 10);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return null;
      }

      return {
        weekday,
        start: row.querySelector<HTMLInputElement>(".tpl-start")?.value ?? "",
        end: row.querySelector<HTMLInputElement>(".tpl-end")?.value ?? "",
        breakStart: row.querySelector<HTMLInputElement>(".tpl-break-start")?.value ?? "",
        breakEnd: row.querySelector<HTMLInputElement>(".tpl-break-end")?.value ?? ""
      };
    })
    .filter((item): item is TemplateRowState => item !== null)
    .sort((a, b) => a.weekday - b.weekday);
}

export function applyTemplateRowsState(rows: TemplateRowState[] | undefined): void {
  if (!rows || rows.length === 0) {
    return;
  }

  const map = new Map<number, TemplateRowState>();
  for (const row of rows) {
    if (Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6) {
      map.set(row.weekday, row);
    }
  }

  const domRows = Array.from(domRefs.dayTemplateTable.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  for (const domRow of domRows) {
    const weekday = Number.parseInt(domRow.dataset.weekday ?? "", 10);
    const state = map.get(weekday);
    if (!state) {
      continue;
    }

    const startInput = domRow.querySelector<HTMLInputElement>(".tpl-start");
    const endInput = domRow.querySelector<HTMLInputElement>(".tpl-end");
    const breakStartInput = domRow.querySelector<HTMLInputElement>(".tpl-break-start");
    const breakEndInput = domRow.querySelector<HTMLInputElement>(".tpl-break-end");

    if (startInput) {
      startInput.value = state.start;
    }
    if (endInput) {
      endInput.value = state.end;
    }
    if (breakStartInput) {
      breakStartInput.value = state.breakStart;
    }
    if (breakEndInput) {
      breakEndInput.value = state.breakEnd;
    }
  }
}

export function saveScheduleTemplatesToLocalStorage(): void {
  try {
    localStorage.setItem(SCHEDULE_TEMPLATE_STORAGE_KEY, JSON.stringify(appState.scheduleTemplates));
  } catch {
    domRefs.scheduleTemplateStatus.textContent = "템플릿 저장 실패: 브라우저 저장소를 확인해 주세요.";
  }
}

export function loadScheduleTemplatesFromLocalStorage(): void {
  const raw = localStorage.getItem(SCHEDULE_TEMPLATE_STORAGE_KEY);
  if (!raw) {
    appState.scheduleTemplates = createDefaultScheduleTemplates();
    saveScheduleTemplatesToLocalStorage();
    return;
  }

  try {
    appState.scheduleTemplates = mergeScheduleTemplates(JSON.parse(raw) as unknown);
  } catch {
    appState.scheduleTemplates = createDefaultScheduleTemplates();
    saveScheduleTemplatesToLocalStorage();
  }
}

export function renderScheduleTemplateOptions(preferredName = ""): void {
  const previous = preferredName || domRefs.scheduleTemplateSelect.value;
  domRefs.scheduleTemplateSelect.innerHTML = "";

  for (const preset of appState.scheduleTemplates) {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.builtIn ? `${preset.name} (기본)` : preset.name;
    domRefs.scheduleTemplateSelect.appendChild(option);
  }

  if (appState.scheduleTemplates.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "저장된 템플릿 없음";
    domRefs.scheduleTemplateSelect.appendChild(option);
    domRefs.scheduleTemplateSelect.value = "";
    domRefs.deleteScheduleTemplateButton.disabled = true;
    return;
  }

  const selected = appState.scheduleTemplates.some((item) => item.name === previous)
    ? previous
    : appState.scheduleTemplates[0].name;
  domRefs.scheduleTemplateSelect.value = selected;
  const selectedTemplate = findScheduleTemplate(appState.scheduleTemplates, selected);
  domRefs.deleteScheduleTemplateButton.disabled = Boolean(selectedTemplate?.builtIn);
  deps.updateActionStates();
}

export function applySelectedScheduleTemplate(): void {
  const selected = findScheduleTemplate(appState.scheduleTemplates, domRefs.scheduleTemplateSelect.value);
  if (!selected) {
    domRefs.scheduleTemplateStatus.textContent = "선택한 템플릿을 찾을 수 없습니다.";
    return;
  }

  applyTemplateRowsState(selected.rows);
  domRefs.scheduleTemplateStatus.textContent = `템플릿 불러오기 완료: ${selected.name}`;
  deps.pushRecentActionLog("INFO", `시간 템플릿 적용 완료: ${selected.name}`, "sectionScheduleGenerate");
  deps.scheduleAutoSave();
}

export function saveCurrentScheduleTemplate(): void {
  const name = domRefs.scheduleTemplateNameInput.value.trim();
  if (!name) {
    domRefs.scheduleTemplateStatus.textContent = "저장할 템플릿 이름을 입력해 주세요.";
    return;
  }

  const rows = collectTemplateRowsState();
  appState.scheduleTemplates = upsertScheduleTemplate(appState.scheduleTemplates, name, rows);
  saveScheduleTemplatesToLocalStorage();
  renderScheduleTemplateOptions(name);
  domRefs.scheduleTemplateNameInput.value = "";
  domRefs.scheduleTemplateStatus.textContent = `템플릿 저장 완료: ${name}`;
  deps.pushRecentActionLog("INFO", `시간 템플릿 저장 완료: ${name}`, "sectionScheduleGenerate");
}

export function deleteSelectedScheduleTemplate(): void {
  const selected = domRefs.scheduleTemplateSelect.value;
  const template = findScheduleTemplate(appState.scheduleTemplates, selected);
  if (!template) {
    domRefs.scheduleTemplateStatus.textContent = "삭제할 템플릿을 찾을 수 없습니다.";
    return;
  }

  if (template.builtIn) {
    domRefs.scheduleTemplateStatus.textContent = "기본 템플릿은 삭제할 수 없습니다.";
    return;
  }

  appState.scheduleTemplates = removeScheduleTemplate(appState.scheduleTemplates, template.name);
  saveScheduleTemplatesToLocalStorage();
  renderScheduleTemplateOptions();
  domRefs.scheduleTemplateStatus.textContent = `템플릿 삭제 완료: ${template.name}`;
  deps.pushRecentActionLog("INFO", `시간 템플릿 삭제 완료: ${template.name}`, "sectionScheduleGenerate");
}
