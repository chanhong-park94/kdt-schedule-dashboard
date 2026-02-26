import { describe, expect, it } from "vitest";

import { INTERNAL_V7E_RECORD_KEYS } from "../src/core/schema";

type MappingJson = {
  formatKey?: unknown;
  header?: unknown;
  columns?: unknown;
  headerAliases?: unknown;
};

const mappingModules = import.meta.glob("../src/public/mappings/*.json", {
  eager: true,
  import: "default"
}) as Record<string, unknown>;

describe("mapping schema contract", () => {
  it("모든 mapping JSON이 계약을 만족한다", () => {
    const files = Object.entries(mappingModules);
    expect(files.length).toBeGreaterThan(0);

    const internalKeySet = new Set<string>(INTERNAL_V7E_RECORD_KEYS);
    const allowedFormats = new Set(["v7e_strict", "v7e_legacy", "modules_generic"]);

    for (const [filePath, parsedRaw] of files) {
      const fileName = filePath.split("/").pop() ?? filePath;
      const parsed = parsedRaw as MappingJson;

      expect(typeof parsed.formatKey, `${fileName}: formatKey`).toBe("string");
      expect(allowedFormats.has(String(parsed.formatKey)), `${fileName}: formatKey 값`).toBe(true);

      expect(Array.isArray(parsed.header), `${fileName}: header`).toBe(true);
      expect(Array.isArray(parsed.columns), `${fileName}: columns`).toBe(true);

      const header = parsed.header as unknown[];
      const columns = parsed.columns as unknown[];
      expect(header.length, `${fileName}: header length`).toBeGreaterThan(0);
      expect(columns.length, `${fileName}: columns length`).toBeGreaterThan(0);
      expect(header.length, `${fileName}: header/columns length`).toBe(columns.length);

      for (const [index, column] of columns.entries()) {
        expect(typeof column, `${fileName}: columns[${index}] type`).toBe("object");
        expect(column).not.toBeNull();

        const row = column as { key?: unknown; label?: unknown };
        expect(typeof row.key, `${fileName}: columns[${index}].key`).toBe("string");
        expect(typeof row.label, `${fileName}: columns[${index}].label`).toBe("string");

        const key = String(row.key);
        expect(internalKeySet.has(key), `${fileName}: columns[${index}].key(${key})`).toBe(true);
      }

      if (parsed.headerAliases !== undefined) {
        expect(typeof parsed.headerAliases, `${fileName}: headerAliases`).toBe("object");
        expect(parsed.headerAliases).not.toBeNull();
        expect(Array.isArray(parsed.headerAliases), `${fileName}: headerAliases array 금지`).toBe(false);
      }
    }
  });
});
