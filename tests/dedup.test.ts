import { describe, expect, it } from "vitest";

import { dedupByBasis } from "../src/core/dedup";
import { Session } from "../src/core/types";

function makeSession(overrides: Partial<Session>): Session {
  return {
    훈련일자: "20260310",
    훈련시작시간: "0900",
    훈련종료시간: "1100",
    "방학/원격여부": "",
    시작시간: "0900",
    시간구분: "정규",
    훈련강사코드: "TCH-1001",
    "교육장소(강의실)코드": "ROOM-01",
    "교과목(및 능력단위)코드": "SUBJ-01",
    과정기수: "KDT-1기",
    normalizedDate: "2026-03-10",
    startMin: 540,
    endMin: 660,
    ...overrides
  };
}

describe("dedupByBasis", () => {
  it("동일 시그니처는 1건으로 dedup된다", () => {
    const sessions: Session[] = [
      makeSession({ "교과목(및 능력단위)코드": "SUBJ-A" }),
      makeSession({ "교과목(및 능력단위)코드": "SUBJ-B" })
    ];

    const deduped = dedupByBasis(sessions, "교육장소(강의실)코드");

    expect(deduped).toHaveLength(1);
  });
});
