import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/core/csv";

describe("parseCsv — 파서 엣지 케이스", () => {
  it("큰따옴표 내부의 이중 따옴표(`\"\"`)를 하나의 따옴표로 파싱한다", () => {
    const csv = 'name,desc\n"홍길동","소개: ""안녕하세요"""\n';
    const records = parseCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe("홍길동");
    expect(records[0].desc).toBe('소개: "안녕하세요"');
  });

  it("큰따옴표로 감싸진 셀 안의 쉼표는 구분자로 처리하지 않는다", () => {
    const csv = 'a,b,c\n"값1,값2",중간,끝\n';
    const records = parseCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].a).toBe("값1,값2");
    expect(records[0].b).toBe("중간");
    expect(records[0].c).toBe("끝");
  });

  it("UTF-8 BOM(\\uFEFF)이 첫 번째 헤더 컬럼 앞에 있어도 올바르게 파싱한다", () => {
    const csv = "\uFEFF훈련일자,훈련강사코드\n20260101,TCH_001\n";
    const records = parseCsv(csv);
    expect(records).toHaveLength(1);
    // BOM이 제거되어 '훈련일자' 키로 접근 가능해야 한다
    expect(records[0]["훈련일자"]).toBe("20260101");
    expect(records[0]["훈련강사코드"]).toBe("TCH_001");
  });

  it("CRLF(\\r\\n) 줄바꿈이 포함된 CSV를 올바르게 파싱한다", () => {
    const csv = "col1,col2\r\n값A,값B\r\n값C,값D\r\n";
    const records = parseCsv(csv);
    expect(records).toHaveLength(2);
    expect(records[0].col1).toBe("값A");
    expect(records[1].col2).toBe("값D");
  });

  it("파일 끝의 빈 행은 결과에 포함되지 않는다", () => {
    const csv = "이름,코드\n홍길동,A001\n\n\n";
    const records = parseCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].이름).toBe("홍길동");
  });

  it("큰따옴표로 감싸진 셀 안의 줄바꿈은 구분자로 처리하지 않는다", () => {
    const csv = 'title,body\n제목,"첫째 줄\n둘째 줄"\n';
    const records = parseCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe("제목");
    expect(records[0].body).toBe("첫째 줄\n둘째 줄");
  });
});
