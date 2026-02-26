import { describe, expect, it } from "vitest";

import { assignInstructorToModule } from "../src/core/autoAssignInstructor";
import { detectConflicts } from "../src/core/conflicts";
import { Session } from "../src/core/types";

function makeSession(overrides: Partial<Session>): Session {
  return {
    훈련일자: "20260314",
    훈련시작시간: "0900",
    훈련종료시간: "1000",
    "방학/원격여부": "",
    시작시간: "0900",
    시간구분: "정규",
    훈련강사코드: "TCH-OLD",
    "교육장소(강의실)코드": "ROOM-01",
    "교과목(및 능력단위)코드": "SUBJ-01",
    과정기수: "KDT-1기",
    normalizedDate: "2026-03-14",
    startMin: 540,
    endMin: 600,
    ...overrides
  };
}

describe("assignInstructorToModule", () => {
  it("moduleKey에 해당하는 세션만 강사코드를 변경한다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "A", "교과목(및 능력단위)코드": " MOD-01 " }),
      makeSession({ 과정기수: "A", "교과목(및 능력단위)코드": "MOD-02" })
    ];

    const updated = assignInstructorToModule({
      sessions,
      moduleKey: "MOD-01",
      instructorCode: "  inst-9001 "
    });

    expect(updated[0]?.훈련강사코드).toBe("inst_9001");
    expect(updated[1]?.훈련강사코드).toBe("TCH-OLD");
  });

  it("다른 모듈 세션은 영향이 없다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "A", "교과목(및 능력단위)코드": "MOD-A", 훈련강사코드: "A1" }),
      makeSession({ 과정기수: "B", "교과목(및 능력단위)코드": "MOD-B", 훈련강사코드: "B1" })
    ];

    const updated = assignInstructorToModule({
      sessions,
      moduleKey: "MOD-A",
      instructorCode: "A2"
    });

    expect(updated[0]?.훈련강사코드).toBe("A2");
    expect(updated[1]?.훈련강사코드).toBe("B1");
  });

  it("cohort|||moduleKey 형식이면 해당 코호트 모듈만 변경한다", () => {
    const sessions: Session[] = [
      makeSession({ 과정기수: "A", "교과목(및 능력단위)코드": "MOD-C", 훈련강사코드: "A-CODE" }),
      makeSession({ 과정기수: "B", "교과목(및 능력단위)코드": "MOD-C", 훈련강사코드: "B-CODE" })
    ];

    const updated = assignInstructorToModule({
      sessions,
      moduleKey: "A|||MOD-C",
      instructorCode: "A-NEW"
    });

    expect(updated[0]?.훈련강사코드).toBe("A_NEW");
    expect(updated[1]?.훈련강사코드).toBe("B-CODE");
  });

  it("변경 후 detectConflicts가 정상 동작한다", () => {
    const sessions: Session[] = [
      makeSession({
        과정기수: "A",
        "교과목(및 능력단위)코드": "MOD-X",
        훈련강사코드: "INST-A",
        훈련시작시간: "0900",
        훈련종료시간: "1100",
        startMin: 540,
        endMin: 660
      }),
      makeSession({
        과정기수: "B",
        "교과목(및 능력단위)코드": "MOD-X",
        훈련강사코드: "INST-B",
        훈련시작시간: "1000",
        훈련종료시간: "1200",
        startMin: 600,
        endMin: 720
      })
    ];

    const before = detectConflicts(sessions, { resourceTypes: ["INSTRUCTOR"] });
    expect(before).toHaveLength(0);

    const updated = assignInstructorToModule({
      sessions,
      moduleKey: "MOD-X",
      instructorCode: "INST-CONFLICT"
    });

    const after = detectConflicts(updated, { resourceTypes: ["INSTRUCTOR"] });
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((item) => item.resourceType === "INSTRUCTOR")).toBe(true);
  });
});
