import { BasisKey, Session } from "./types";
import { normalizeClassroomCode, normalizeInstructorCode } from "./standardize";

export function dedupByBasis(sessions: Session[], basisKey: BasisKey): Session[] {
  const seen = new Set<string>();
  const result: Session[] = [];

  for (const session of sessions) {
    const basisValue =
      basisKey === "훈련강사코드"
        ? normalizeInstructorCode(session[basisKey])
        : normalizeClassroomCode(session[basisKey]);

    const signature = [session.훈련일자, session.과정기수, basisValue, session.훈련시작시간, session.훈련종료시간].join(
      "|||",
    );

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    result.push(session);
  }

  return result;
}
