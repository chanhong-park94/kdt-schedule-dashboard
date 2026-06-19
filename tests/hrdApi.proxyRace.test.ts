import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRoster } from "../src/hrd/hrdApi";
import type { HrdConfig } from "../src/hrd/hrdTypes";

/**
 * 출결조회 프록시 폴백 회귀 가드.
 *
 * 배경(2026-06): Edge Function 미배포 상태에서 공개 CORS 프록시 체인이 "순차"였기 때문에
 * 첫 프록시(cors.eu.org)가 레이트리밋/지연되면 전체 조회가 "모든 프록시 실패: signal is
 * aborted"로 죽었다. 또 프록시가 200으로 비-HRD 응답(레이트리밋 HTML/빈 래퍼)을 주면
 * parseResponse 가 빈 배열을 반환해 "훈련생 0명"처럼 조용히 실패했다.
 *
 * 수정: 프록시를 "병렬 레이스" + "응답 형태 검증"으로 전환.
 *  - 건강한 프록시 한 곳만 있으면 즉시 성공
 *  - 200 이지만 HRD 형태가 아닌 응답은 채택하지 않고 다른 프록시로 넘어감
 */

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function makeRes(opts: { status?: number; json?: unknown; jsonThrows?: boolean; text?: string }): FakeResponse {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (opts.jsonThrows) throw new SyntaxError("Unexpected token < in JSON");
      return opts.json;
    },
    text: async () => opts.text ?? "",
  };
}

const VALID_ROSTER = {
  returnJSON: JSON.stringify({ totTrneeCo: 1, trneList: [{ trneeCstmrNm: "홍길동", tracseTme: 1 }] }),
};

const config: HrdConfig = { authKey: "TESTKEY" } as unknown as HrdConfig;

/** URL 패턴별로 응답을 라우팅하는 mock fetch 를 설치한다. */
function installFetch(route: (url: string) => FakeResponse) {
  const spy = vi.fn(async (input: unknown) => route(String(input)) as unknown as Response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  // Edge Function 은 미배포(404)로 가정 → 항상 CORS 프록시 폴백 경로를 탄다.
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchRoster 프록시 병렬 레이스", () => {
  it("첫 프록시가 레이트리밋(JSON 파싱 실패)이어도 건강한 프록시의 데이터를 반환한다", async () => {
    installFetch((url) => {
      if (url.includes("/functions/v1/hrd-proxy")) return makeRes({ status: 404 });
      if (url.includes("cors.eu.org")) return makeRes({ status: 200, jsonThrows: true }); // Cloudflare 레이트리밋 HTML
      if (url.includes("allorigins.win/raw")) return makeRes({ status: 200, json: VALID_ROSTER });
      return makeRes({ status: 500 }); // 나머지 프록시 장애
    });

    const roster = await fetchRoster(config, "AIG20240000498389", "1");
    expect(roster).toHaveLength(1);
    expect((roster[0] as { trneeCstmrNm: string }).trneeCstmrNm).toBe("홍길동");
  });

  it("프록시가 200 으로 비-HRD JSON(빈 래퍼)을 줘도 조용히 빈 결과를 채택하지 않고 실제 데이터를 찾는다", async () => {
    installFetch((url) => {
      if (url.includes("/functions/v1/hrd-proxy")) return makeRes({ status: 404 });
      // cors.eu.org: 200 이지만 HRD 형태가 아닌 응답 (과거엔 이게 parseResponse→[] 로 조용히 통과)
      if (url.includes("cors.eu.org")) return makeRes({ status: 200, json: { contents: null, status: { http_code: 500 } } });
      if (url.includes("allorigins.win/raw")) return makeRes({ status: 200, json: VALID_ROSTER });
      return makeRes({ status: 500 });
    });

    const roster = await fetchRoster(config, "AIG20240000498389", "1");
    expect(roster).toHaveLength(1); // 빈 배열이 아니라 실제 데이터여야 한다
  });

  it("모든 프록시가 실패하면 '모든 프록시 실패' 에러를 던진다", async () => {
    installFetch((url) => {
      if (url.includes("/functions/v1/hrd-proxy")) return makeRes({ status: 404 });
      return makeRes({ status: 503 }); // 전 프록시 장애
    });

    await expect(fetchRoster(config, "AIG20240000498389", "1")).rejects.toThrow("모든 프록시 실패");
  });
});
