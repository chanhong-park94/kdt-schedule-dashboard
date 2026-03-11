import { describe, expect, it, beforeEach } from "vitest";
import {
  loadAssistantCodes,
  saveAssistantCode,
  removeAssistantCode,
  findAssistantCode,
  validateAssistantCode,
} from "../src/auth/assistantAuth";

// Polyfill localStorage for Node test environment (Node 22+ has a
// built-in localStorage that lacks .clear(), so we always override)
function createMockStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

Object.defineProperty(globalThis, "localStorage", {
  value: createMockStorage(),
  writable: true,
  configurable: true,
});

beforeEach(() => {
  localStorage.clear();
});

describe("saveAssistantCode", () => {
  it("코드 저장 후 조회 가능", () => {
    saveAssistantCode({ code: "kim-llm3", trainPrId: "T001", degr: "3", courseName: "재직자 LLM" });
    const codes = loadAssistantCodes();
    expect(codes).toHaveLength(1);
    expect(codes[0].code).toBe("kim-llm3");
    expect(codes[0].trainPrId).toBe("T001");
    expect(codes[0].degr).toBe("3");
  });
});

describe("removeAssistantCode", () => {
  it("코드 삭제", () => {
    saveAssistantCode({ code: "a", trainPrId: "T1", degr: "1", courseName: "X" });
    saveAssistantCode({ code: "b", trainPrId: "T2", degr: "2", courseName: "Y" });
    removeAssistantCode("a");
    const codes = loadAssistantCodes();
    expect(codes).toHaveLength(1);
    expect(codes[0].code).toBe("b");
  });
});

describe("findAssistantCode", () => {
  it("코드로 매칭 검색", () => {
    saveAssistantCode({ code: "kim-llm3", trainPrId: "T001", degr: "3", courseName: "LLM" });
    const found = findAssistantCode("kim-llm3");
    expect(found).not.toBeNull();
    expect(found!.trainPrId).toBe("T001");
  });

  it("없는 코드는 null 반환", () => {
    expect(findAssistantCode("nonexistent")).toBeNull();
  });
});

describe("validateAssistantCode", () => {
  it("빈 문자열 거부", () => {
    expect(validateAssistantCode("")).toBe("코드를 입력하세요.");
  });

  it("관리자 코드 'v2' 충돌 거부", () => {
    expect(validateAssistantCode("v2")).toBe("관리자 인증코드와 동일한 코드는 사용할 수 없습니다.");
  });

  it("기존 코드 중복 거부", () => {
    saveAssistantCode({ code: "existing", trainPrId: "T1", degr: "1", courseName: "X" });
    expect(validateAssistantCode("existing")).toBe("이미 사용 중인 코드입니다.");
  });

  it("유효한 코드는 null 반환 (에러 없음)", () => {
    expect(validateAssistantCode("valid-code")).toBeNull();
  });
});
