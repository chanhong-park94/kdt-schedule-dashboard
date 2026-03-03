import modulesGenericRaw from "../public/mappings/modules_generic.json";
import v7eLegacyRaw from "../public/mappings/v7e_legacy.json";
import v7eStrictRaw from "../public/mappings/v7e_strict.json";
import mappingSchemaRaw from "./mapping.schema.json";
import { InternalV7ERecord } from "./schema";
import { isDevRuntime } from "./env";

export type ExportFormatKey = "v7e_strict" | "v7e_legacy" | "modules_generic";

type MappingColumn = {
  key: string;
  label: string;
};

type RawMappingConfig = {
  formatKey: string;
  header: string[];
  columns: MappingColumn[];
  headerAliases?: Record<string, string>;
};

type JsonSchemaLike = {
  required?: string[];
  properties?: Record<string, { type?: string; items?: { type?: string }; minItems?: number }>;
};

type MappingDefinition = {
  formatKey: ExportFormatKey;
  header: string[];
  columns: MappingColumn[];
  headerAliases: Record<string, string>;
  map: (record: InternalV7ERecord) => string[];
};

function escapeCsv(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[\r\n,"]/.test(escaped) ? `"${escaped}"` : escaped;
}

function validateAgainstJsonSchema(raw: unknown, fileName: string): string[] {
  const errors: string[] = [];
  const schema = mappingSchemaRaw as JsonSchemaLike;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [`[mapping:${fileName}] JSON 루트는 객체여야 합니다.`];
  }

  const input = raw as Record<string, unknown>;
  const required = schema.required ?? [];
  for (const key of required) {
    if (!(key in input)) {
      errors.push(`[mapping:${fileName}] 필수 필드 누락: ${key}`);
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, config] of Object.entries(properties)) {
    if (!(key in input)) {
      continue;
    }
    const value = input[key];

    if (config.type === "string" && typeof value !== "string") {
      errors.push(`[mapping:${fileName}] ${key}는 string이어야 합니다.`);
    }

    if (config.type === "array") {
      if (!Array.isArray(value)) {
        errors.push(`[mapping:${fileName}] ${key}는 array여야 합니다.`);
        continue;
      }

      if (typeof config.minItems === "number" && value.length < config.minItems) {
        errors.push(`[mapping:${fileName}] ${key}는 최소 ${config.minItems}개 이상이어야 합니다.`);
      }

      if (config.items?.type === "string") {
        if (value.some((item) => typeof item !== "string")) {
          errors.push(`[mapping:${fileName}] ${key} 배열은 string 원소만 허용합니다.`);
        }
      }
    }
  }

  return errors;
}

function ensureFormatKey(value: string, fileName: string): ExportFormatKey {
  if (value === "v7e_strict" || value === "v7e_legacy" || value === "modules_generic") {
    return value;
  }
  throw new Error(`[mapping:${fileName}] 지원하지 않는 formatKey 입니다: ${value}`);
}

function ensureHeader(header: unknown, fileName: string): string[] {
  if (!Array.isArray(header) || header.length === 0) {
    throw new Error(`[mapping:${fileName}] header는 비어있지 않은 문자열 배열이어야 합니다.`);
  }

  const parsed = header.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (parsed.some((item) => item.length === 0)) {
    throw new Error(`[mapping:${fileName}] header에 빈 값이 포함되어 있습니다.`);
  }

  return parsed;
}

function ensureColumns(columns: unknown, fileName: string): MappingColumn[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error(`[mapping:${fileName}] columns는 비어있지 않은 배열이어야 합니다.`);
  }

  const parsed = columns.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error(`[mapping:${fileName}] columns 항목 형식이 올바르지 않습니다.`);
    }

    const row = item as Partial<MappingColumn>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!key || !label) {
      throw new Error(`[mapping:${fileName}] columns.key/label은 필수입니다.`);
    }

    return { key, label };
  });

  return parsed;
}

function ensureHeaderAliases(
  aliases: unknown,
  header: string[],
  fileName: string
): Record<string, string> {
  if (aliases === undefined) {
    return {};
  }

  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    throw new Error(`[mapping:${fileName}] headerAliases는 객체여야 합니다.`);
  }

  const canonicalSet = new Set(header);
  const result: Record<string, string> = {};

  for (const [alias, canonical] of Object.entries(aliases as Record<string, unknown>)) {
    const aliasLabel = typeof alias === "string" ? alias.trim() : "";
    const canonicalLabel = typeof canonical === "string" ? canonical.trim() : "";
    if (!aliasLabel || !canonicalLabel) {
      throw new Error(`[mapping:${fileName}] headerAliases에 빈 alias/canonical 값이 있습니다.`);
    }

    if (!canonicalSet.has(canonicalLabel)) {
      throw new Error(
        `[mapping:${fileName}] headerAliases canonical 값(${canonicalLabel})이 header에 존재하지 않습니다.`
      );
    }

    result[aliasLabel] = canonicalLabel;
  }

  return result;
}

function parseMappingConfig(raw: unknown, fileName: string): MappingDefinition {
  if (isDevRuntime()) {
    const schemaErrors = validateAgainstJsonSchema(raw, fileName);
    if (schemaErrors.length > 0) {
      throw new Error(`매핑 JSON 스키마 검증 실패:\n- ${schemaErrors.join("\n- ")}`);
    }
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`[mapping:${fileName}] JSON 루트는 객체여야 합니다.`);
  }

  const input = raw as Partial<RawMappingConfig>;
  const formatKey = ensureFormatKey(typeof input.formatKey === "string" ? input.formatKey : "", fileName);
  const header = ensureHeader(input.header, fileName);
  const columns = ensureColumns(input.columns, fileName);
  const headerAliases = ensureHeaderAliases(input.headerAliases, header, fileName);

  if (header.length !== columns.length) {
    throw new Error(`[mapping:${fileName}] header 길이와 columns 길이가 다릅니다.`);
  }

  const labels = columns.map((column) => column.label);
  const headerMismatch = header.some((label, index) => label !== labels[index]);
  if (headerMismatch) {
    throw new Error(`[mapping:${fileName}] header와 columns.label 순서가 일치하지 않습니다.`);
  }

  return {
    formatKey,
    header,
    columns,
    headerAliases,
    map: (record) => {
      const row = record as Record<string, unknown>;
      return columns.map((column) => {
        const value = row[column.key];
        return value === undefined || value === null ? "" : String(value);
      });
    }
  };
}

const parsedMappings = [
  parseMappingConfig(v7eStrictRaw, "v7e_strict.json"),
  parseMappingConfig(v7eLegacyRaw, "v7e_legacy.json"),
  parseMappingConfig(modulesGenericRaw, "modules_generic.json")
];

const mappingMap = new Map<ExportFormatKey, MappingDefinition>();
for (const mapping of parsedMappings) {
  mappingMap.set(mapping.formatKey, mapping);
}

function requireMapping(formatKey: ExportFormatKey): MappingDefinition {
  const mapping = mappingMap.get(formatKey);
  if (!mapping) {
    throw new Error(`포맷 매핑을 찾을 수 없습니다: ${formatKey}`);
  }
  return mapping;
}

export const HEADER_MAPPINGS: Record<ExportFormatKey, MappingDefinition> = {
  v7e_strict: requireMapping("v7e_strict"),
  v7e_legacy: requireMapping("v7e_legacy"),
  modules_generic: requireMapping("modules_generic")
};

export function normalizeHeaderLabel(formatKey: ExportFormatKey, label: string): string {
  const mapping = requireMapping(formatKey);
  const trimmed = label.trim();
  return mapping.headerAliases[trimmed] ?? trimmed;
}

export function normalizeHeaderRow(formatKey: ExportFormatKey, headers: string[]): string[] {
  return headers.map((header) => normalizeHeaderLabel(formatKey, header));
}

export function exportWithMapping(
  formatKey: ExportFormatKey,
  records: InternalV7ERecord[],
  options?: { useAliasHeader?: boolean }
): string {
  const mapping = requireMapping(formatKey);

  let header = mapping.header;
  if (options?.useAliasHeader) {
    const reverseAliases = new Map<string, string>();
    for (const [alias, canonical] of Object.entries(mapping.headerAliases)) {
      if (!reverseAliases.has(canonical)) {
        reverseAliases.set(canonical, alias);
      }
    }
    header = mapping.header.map((label) => reverseAliases.get(label) ?? label);
  }

  const lines = [header.join(",")];
  for (const record of records) {
    lines.push(mapping.map(record).map((value) => escapeCsv(value)).join(","));
  }

  return lines.join("\r\n");
}
