// @vitest-environment jsdom
/**
 * Regression test: 보조강사 출결조회 버그
 *
 * 관리자가 Supabase assistant_codes에 새 기수 코드를 생성했지만
 * 보조강사 브라우저의 localStorage hrdConfig에 해당 degr가 없으면
 * select dropdown이 silent-fail해서 "과정과 기수를 선택해주세요" 오류가 발생했다.
 *
 * 수정: ensureCourseAndDegr()로 세션의 과정·기수를 localStorage에 upsert한다.
 */
import { describe, test, expect, beforeEach } from "vitest";
import { ensureCourseAndDegr, loadHrdConfig, saveHrdConfig } from "../src/hrd/hrdConfig";

// localStorage가 환경에 따라 정의되지 않을 수 있어 명시적으로 폴리필
function setupLocalStorage(): void {
  if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.clear !== "function") {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = String(v);
        },
        removeItem: (k: string) => {
          delete store[k];
        },
        clear: () => {
          for (const k of Object.keys(store)) delete store[k];
        },
        key: (i: number) => Object.keys(store)[i] ?? null,
        get length() {
          return Object.keys(store).length;
        },
      },
      writable: true,
      configurable: true,
    });
  }
}

describe("ensureCourseAndDegr", () => {
  beforeEach(() => {
    setupLocalStorage();
    localStorage.clear();
  });

  test("기존 과정에 없는 기수를 추가", () => {
    saveHrdConfig({
      authKey: "test",
      proxy: "",
      courses: [
        {
          name: "AI 활용 서비스 기획/개발",
          trainPrId: "AIG20250000501545",
          degrs: ["1", "2", "3", "4", "5"],
          startDate: "",
          totalDays: 60,
          endTime: "18:00",
          category: "재직자",
          trainingHoursPerDay: 8,
        },
      ],
    });

    const updated = ensureCourseAndDegr("AIG20250000501545", "6", "AI 활용 서비스 기획/개발");
    expect(updated).toBe(true);

    const config = loadHrdConfig();
    const course = config.courses.find((c) => c.trainPrId === "AIG20250000501545");
    expect(course?.degrs).toContain("6");
    expect(course?.degrs).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  test("이미 존재하는 기수는 중복 추가하지 않음", () => {
    saveHrdConfig({
      authKey: "test",
      proxy: "",
      courses: [
        {
          name: "테스트",
          trainPrId: "TEST123",
          degrs: ["1", "2"],
          startDate: "",
          totalDays: 60,
          endTime: "18:00",
          category: "실업자",
          trainingHoursPerDay: 8,
        },
      ],
    });

    const updated = ensureCourseAndDegr("TEST123", "2", "테스트");
    expect(updated).toBe(false);

    const config = loadHrdConfig();
    const course = config.courses.find((c) => c.trainPrId === "TEST123");
    expect(course?.degrs).toEqual(["1", "2"]);
  });

  test("과정 자체가 없으면 신규 생성 (DEFAULT_COURSES에 있는 trainPrId는 속성 상속)", () => {
    saveHrdConfig({ authKey: "test", proxy: "", courses: [] });

    const updated = ensureCourseAndDegr("AIG20250000501545", "7", "AI 활용 서비스 기획/개발");
    expect(updated).toBe(true);

    const config = loadHrdConfig();
    const course = config.courses.find((c) => c.trainPrId === "AIG20250000501545");
    expect(course).toBeDefined();
    expect(course?.degrs).toContain("7");
    expect(course?.category).toBe("재직자");
    expect(course?.totalDays).toBe(60);
  });

  test("과정 자체가 없고 DEFAULT에도 없으면 최소 정보로 생성", () => {
    saveHrdConfig({ authKey: "test", proxy: "", courses: [] });

    const updated = ensureCourseAndDegr("UNKNOWN_TID", "1", "신규 커스텀 과정");
    expect(updated).toBe(true);

    const config = loadHrdConfig();
    const course = config.courses.find((c) => c.trainPrId === "UNKNOWN_TID");
    expect(course).toBeDefined();
    expect(course?.name).toBe("신규 커스텀 과정");
    expect(course?.degrs).toEqual(["1"]);
    expect(course?.totalDays).toBe(120);
  });

  test("trainPrId 또는 degr가 비어있으면 false 리턴 + 변경 없음", () => {
    expect(ensureCourseAndDegr("", "1", "test")).toBe(false);
    expect(ensureCourseAndDegr("TID", "", "test")).toBe(false);
    // (loadHrdConfig는 빈 courses를 DEFAULT_COURSES로 자동 채우므로 length 검증은 부적절)
    const config = loadHrdConfig();
    expect(config.courses.find((c) => c.trainPrId === "TID")).toBeUndefined();
  });

  test("기수 정렬: 문자열이지만 숫자로 정렬", () => {
    saveHrdConfig({
      authKey: "test",
      proxy: "",
      courses: [
        {
          name: "테스트",
          trainPrId: "TEST",
          degrs: ["1", "2", "10"],
          startDate: "",
          totalDays: 60,
          endTime: "18:00",
          category: "실업자",
          trainingHoursPerDay: 8,
        },
      ],
    });

    ensureCourseAndDegr("TEST", "3", "테스트");

    const config = loadHrdConfig();
    const course = config.courses.find((c) => c.trainPrId === "TEST");
    // 숫자 정렬: 1, 2, 3, 10 (문자열 정렬이면 1, 10, 2, 3이 됨)
    expect(course?.degrs).toEqual(["1", "2", "3", "10"]);
  });
});
