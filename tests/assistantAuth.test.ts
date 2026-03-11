import { vi, describe, expect, it, beforeEach } from "vitest";

// ─── Mock Supabase ──────────────────────────────────────────

let mockRows: Array<Record<string, unknown>> = [];

const mockChain = {
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(async () => ({
    data: mockRows.length > 0 ? mockRows[0] : null,
    error: null,
  })),
  upsert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

// After select().order() for loadAssistantCodes — resolves the promise
// We override the chain so that order() returns a thenable
const mockFrom = vi.fn(() => {
  const chain = { ...mockChain };

  // Make the chain thenable for loadAssistantCodes (select → order → await)
  chain.order = vi.fn(() => ({
    ...chain,
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: [...mockRows], error: null }),
  }));

  // upsert returns { error: null } when awaited
  chain.upsert = vi.fn(() => ({
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  }));

  // delete().eq() returns { error: null } when awaited
  chain.delete = vi.fn(() => ({
    eq: vi.fn(() => ({
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    })),
  }));

  // select().eq().maybeSingle() for findAssistantCode
  chain.select = vi.fn(() => ({
    order: vi.fn(() => ({
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: [...mockRows], error: null }),
    })),
    eq: vi.fn((col: string, val: string) => ({
      maybeSingle: vi.fn(async () => {
        const found = mockRows.find((r) => r[col] === val);
        return { data: found ?? null, error: null };
      }),
    })),
  }));

  return chain;
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

vi.mock("../src/core/env", () => ({
  readClientEnv: () => "https://mock.supabase.co",
}));

// ─── Import after mocks ────────────────────────────────────

const {
  loadAssistantCodes,
  saveAssistantCode,
  removeAssistantCode,
  findAssistantCode,
  validateAssistantCode,
} = await import("../src/auth/assistantAuth");

// ─── Helpers ────────────────────────────────────────────────

function makeRow(code: string, trainPrId: string, degr: string, courseName: string) {
  return { id: crypto.randomUUID(), code, train_pr_id: trainPrId, degr, course_name: courseName, created_at: new Date().toISOString() };
}

beforeEach(() => {
  mockRows = [];
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────

describe("loadAssistantCodes", () => {
  it("Supabase에서 코드 목록 조회", async () => {
    mockRows = [makeRow("kim-llm3", "T001", "3", "재직자 LLM")];
    const codes = await loadAssistantCodes();
    expect(codes).toHaveLength(1);
    expect(codes[0].code).toBe("kim-llm3");
    expect(codes[0].trainPrId).toBe("T001");
    expect(codes[0].degr).toBe("3");
  });

  it("빈 테이블이면 빈 배열 반환", async () => {
    mockRows = [];
    const codes = await loadAssistantCodes();
    expect(codes).toHaveLength(0);
  });
});

describe("saveAssistantCode", () => {
  it("Supabase upsert 호출", async () => {
    await saveAssistantCode({ code: "kim-llm3", trainPrId: "T001", degr: "3", courseName: "재직자 LLM" });
    expect(mockFrom).toHaveBeenCalledWith("assistant_codes");
  });
});

describe("removeAssistantCode", () => {
  it("Supabase delete 호출", async () => {
    await removeAssistantCode("kim-llm3");
    expect(mockFrom).toHaveBeenCalledWith("assistant_codes");
  });
});

describe("findAssistantCode", () => {
  it("코드로 매칭 검색", async () => {
    mockRows = [makeRow("kim-llm3", "T001", "3", "LLM")];
    const found = await findAssistantCode("kim-llm3");
    expect(found).not.toBeNull();
    expect(found!.trainPrId).toBe("T001");
  });

  it("없는 코드는 null 반환", async () => {
    mockRows = [];
    const found = await findAssistantCode("nonexistent");
    expect(found).toBeNull();
  });
});

describe("validateAssistantCode", () => {
  it("빈 문자열 거부", async () => {
    expect(await validateAssistantCode("")).toBe("코드를 입력하세요.");
  });

  it("관리자 코드 'v2' 충돌 거부", async () => {
    expect(await validateAssistantCode("v2")).toBe("관리자 인증코드와 동일한 코드는 사용할 수 없습니다.");
  });

  it("기존 코드 중복 거부", async () => {
    mockRows = [makeRow("existing", "T1", "1", "X")];
    expect(await validateAssistantCode("existing")).toBe("이미 사용 중인 코드입니다.");
  });

  it("유효한 코드는 null 반환 (에러 없음)", async () => {
    mockRows = [];
    expect(await validateAssistantCode("valid-code")).toBeNull();
  });
});
