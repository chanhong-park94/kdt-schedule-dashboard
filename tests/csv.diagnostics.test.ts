import { describe, expect, it } from "vitest";
import { parseCsvWithDiagnostics } from "../src/core/csv";

describe("parseCsvWithDiagnostics", () => {
  it("정상 CSV는 경고 없이 파싱한다", () => {
    const csv = "이름,나이\n홍길동,30\n김철수,25";
    const { records, warnings } = parseCsvWithDiagnostics(csv);
    expect(records).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("헤더보다 짧은 행에 대해 경고를 생성한다", () => {
    const csv = "이름,나이,주소\n홍길동,30";
    const { records, warnings } = parseCsvWithDiagnostics(csv);
    expect(records).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].row).toBe(2);
    expect(warnings[0].message).toContain("3");
    expect(warnings[0].message).toContain("2");
  });

  it("여러 행이 짧으면 각각 경고를 생성한다", () => {
    const csv = "A,B,C\nx\ny,1";
    const { records, warnings } = parseCsvWithDiagnostics(csv);
    expect(records).toHaveLength(2);
    expect(warnings).toHaveLength(2);
    expect(warnings[0].row).toBe(2);
    expect(warnings[1].row).toBe(3);
  });

  it("빈 CSV는 빈 결과와 경고 없음을 반환한다", () => {
    const { records, warnings } = parseCsvWithDiagnostics("");
    expect(records).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("경고가 있어도 파싱된 레코드에는 빈 문자열로 채운다", () => {
    const csv = "이름,나이\n홍길동";
    const { records } = parseCsvWithDiagnostics(csv);
    expect(records[0]["이름"]).toBe("홍길동");
    expect(records[0]["나이"]).toBe("");
  });
});
