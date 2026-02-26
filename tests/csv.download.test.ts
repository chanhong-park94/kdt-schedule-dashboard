import { describe, expect, it } from "vitest";

import { toCsvDownloadText } from "../src/core/csvDownload";

describe("csv download text", () => {
  it("다운로드 문자열은 UTF-8 BOM으로 시작한다", () => {
    const csv = "A,B\n1,2\n3,4";
    const output = toCsvDownloadText(csv);
    expect(output.startsWith("\ufeff")).toBe(true);
    expect(output).toContain("\r\n");
    expect(output).not.toContain("1,2\n3,4");
  });
});
