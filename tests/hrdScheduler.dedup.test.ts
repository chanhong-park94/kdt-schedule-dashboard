// @vitest-environment jsdom
/**
 * Regression test: Slack 자동 알림 당일 중복 발송
 *
 * 탭 복귀 시 visibilitychange + focus 이벤트가 거의 동시에 발화해
 * checkAndSend()가 동시에 2번 진입하면, lastSentDate가 발송 파이프라인
 * "완료 후"에만 기록되던 구조 때문에 두 호출 모두 중복 체크를 통과해
 * 같은 날 Slack 리포트가 2건 발송되는 회귀.
 *
 * 수정: ① isSending 재진입 가드 ② lastSentDate를 발송 시작 전에 선점 기록.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

// ─── 외부 의존성 mock (네트워크 차단) ───────────────────────
vi.mock("../src/hrd/hrdApi", () => ({
  fetchRoster: vi.fn(async () => {
    // 수집 단계가 실제로는 수십초~수분 걸리는 것을 모사
    await new Promise((r) => setTimeout(r, 20));
    return [{ trneeCstmrNm: "홍길동", trneeSttusNm: "훈련중" }];
  }),
  fetchDailyAttendance: vi.fn(async () => []),
}));
vi.mock("../src/core/holidays", () => ({
  fetchPublicHolidaysKR: vi.fn(async () => []),
}));
vi.mock("../src/auth/assistantAuth", () => ({
  getAssistantSession: vi.fn(() => null),
}));
vi.mock("../src/hrd/hrdSlack", () => ({
  buildConsolidatedSlackMessage: vi.fn(() => "통합 리포트"),
  sendSlackReportDirect: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 20));
  }),
}));

import { checkAndSend } from "../src/hrd/hrdScheduler";
import { saveHrdConfig, loadHrdConfig } from "../src/hrd/hrdConfig";
import { sendSlackReportDirect } from "../src/hrd/hrdSlack";

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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function seedConfig(lastSentDate?: string): void {
  saveHrdConfig({
    authKey: "test",
    proxy: "",
    slackWebhookUrl: "https://hooks.slack.com/services/TEST",
    slackSchedule: {
      enabled: true,
      hour: 0, // 00:00 예약 → 항상 "예약 시각 도달" 상태
      minute: 0,
      weekdaysOnly: false,
      targetCourses: [],
      headerText: "",
      footerText: "",
      ...(lastSentDate ? { lastSentDate } : {}),
    },
    courses: [
      {
        name: "테스트과정",
        trainPrId: "TESTPR001",
        degrs: ["1"],
        startDate: "", // 날짜 미설정 → 운영중 판별에서 포함
        totalDays: 10,
        endTime: "",
        category: "실업자",
        trainingHoursPerDay: 8,
      },
    ],
  });
}

describe("Slack 스케줄러 당일 중복 발송 방지", () => {
  beforeEach(() => {
    setupLocalStorage();
    localStorage.clear();
    vi.clearAllMocks();
  });

  test("동시 진입(visibilitychange+focus 동시 발화) 시 1건만 발송", async () => {
    seedConfig();

    // 탭 복귀 시 두 이벤트가 같은 tick에 발화하는 상황 재현
    await Promise.all([checkAndSend(), checkAndSend()]);

    expect(sendSlackReportDirect).toHaveBeenCalledTimes(1);
  });

  test("발송 후 같은 날 재호출은 차단된다", async () => {
    seedConfig();

    await checkAndSend();
    expect(sendSlackReportDirect).toHaveBeenCalledTimes(1);

    await checkAndSend(); // 60초 후 interval 재호출 모사
    expect(sendSlackReportDirect).toHaveBeenCalledTimes(1);
  });

  test("발송 시작 즉시 lastSentDate가 선점 기록된다 (다른 탭 차단용)", async () => {
    seedConfig();

    const sendPromise = checkAndSend();
    // 수집 단계(첫 await) 직후 — 발송 완료 전 시점
    await new Promise((r) => setTimeout(r, 5));
    const midFlight = loadHrdConfig().slackSchedule?.lastSentDate;
    await sendPromise;

    expect(midFlight).toBe(todayStr());
  });

  test("이미 오늘 발송 기록이 있으면 발송하지 않는다", async () => {
    seedConfig(todayStr());

    await checkAndSend();

    expect(sendSlackReportDirect).not.toHaveBeenCalled();
  });
});
