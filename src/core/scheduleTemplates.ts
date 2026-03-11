import { TemplateRowState } from "./state";

export const SCHEDULE_TEMPLATE_STORAGE_KEY = "academic_schedule_manager_schedule_templates_v1";

export type NamedScheduleTemplate = {
  name: string;
  rows: TemplateRowState[];
  builtIn: boolean;
};

function normalizeRows(rows: TemplateRowState[]): TemplateRowState[] {
  return rows
    .filter((row) => Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6)
    .map((row) => ({
      weekday: row.weekday,
      start: row.start ?? "",
      end: row.end ?? "",
      breakStart: row.breakStart ?? "",
      breakEnd: row.breakEnd ?? "",
    }))
    .sort((a, b) => a.weekday - b.weekday);
}

function normalizeTemplateName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function createDefaultScheduleTemplates(): NamedScheduleTemplate[] {
  return [
    {
      name: "재직자 기본",
      builtIn: true,
      rows: normalizeRows([
        { weekday: 2, start: "20:00", end: "22:30", breakStart: "", breakEnd: "" },
        { weekday: 3, start: "20:00", end: "22:30", breakStart: "", breakEnd: "" },
        { weekday: 4, start: "20:00", end: "22:30", breakStart: "", breakEnd: "" },
        { weekday: 5, start: "20:00", end: "22:30", breakStart: "", breakEnd: "" },
        { weekday: 6, start: "10:00", end: "18:00", breakStart: "13:00", breakEnd: "14:00" },
      ]),
    },
    {
      name: "실업자 기본",
      builtIn: true,
      rows: normalizeRows([
        { weekday: 1, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" },
        { weekday: 2, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" },
        { weekday: 3, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" },
        { weekday: 4, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" },
        { weekday: 5, start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" },
      ]),
    },
  ];
}

export function mergeScheduleTemplates(raw: unknown): NamedScheduleTemplate[] {
  const defaults = createDefaultScheduleTemplates();
  if (!Array.isArray(raw)) {
    return defaults;
  }

  const merged = new Map<string, NamedScheduleTemplate>();
  for (const preset of defaults) {
    merged.set(preset.name, preset);
  }

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { name?: unknown; rows?: unknown; builtIn?: unknown };
    const name = normalizeTemplateName(typeof row.name === "string" ? row.name : "");
    if (!name || !Array.isArray(row.rows)) {
      continue;
    }

    const normalizedRows = normalizeRows(
      row.rows.map((entry) => {
        const source = (entry ?? {}) as Partial<TemplateRowState>;
        return {
          weekday: Number(source.weekday),
          start: typeof source.start === "string" ? source.start : "",
          end: typeof source.end === "string" ? source.end : "",
          breakStart: typeof source.breakStart === "string" ? source.breakStart : "",
          breakEnd: typeof source.breakEnd === "string" ? source.breakEnd : "",
        };
      }),
    );

    if (normalizedRows.length === 0) {
      continue;
    }

    merged.set(name, {
      name,
      rows: normalizedRows,
      builtIn: Boolean(row.builtIn),
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertScheduleTemplate(
  templates: NamedScheduleTemplate[],
  name: string,
  rows: TemplateRowState[],
): NamedScheduleTemplate[] {
  const normalizedName = normalizeTemplateName(name);
  const normalizedRows = normalizeRows(rows);
  if (!normalizedName || normalizedRows.length === 0) {
    return templates;
  }

  const next = templates.filter((item) => item.name !== normalizedName);
  const previous = templates.find((item) => item.name === normalizedName);
  next.push({
    name: normalizedName,
    rows: normalizedRows,
    builtIn: previous?.builtIn ?? false,
  });

  return next.sort((a, b) => a.name.localeCompare(b.name));
}

export function removeScheduleTemplate(templates: NamedScheduleTemplate[], name: string): NamedScheduleTemplate[] {
  const normalizedName = normalizeTemplateName(name);
  const target = templates.find((item) => item.name === normalizedName);
  if (!target || target.builtIn) {
    return templates;
  }
  return templates.filter((item) => item.name !== normalizedName).sort((a, b) => a.name.localeCompare(b.name));
}

export function findScheduleTemplate(
  templates: NamedScheduleTemplate[],
  name: string,
): NamedScheduleTemplate | undefined {
  const normalizedName = normalizeTemplateName(name);
  return templates.find((item) => item.name === normalizedName);
}
