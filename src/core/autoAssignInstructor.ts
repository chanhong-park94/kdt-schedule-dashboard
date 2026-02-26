import { normalizeInstructorCode, normalizeSubjectCode } from "./standardize";
import { Session } from "./types";

export type AssignInstructorToModuleParams = {
  sessions: Session[];
  moduleKey: string;
  instructorCode: string;
};

function parseModuleScope(moduleKey: string): { cohort: string | null; module: string } {
  const raw = moduleKey.trim();
  if (raw.includes("|||")) {
    const [cohortRaw, moduleRaw] = raw.split("|||");
    return {
      cohort: cohortRaw?.trim() || null,
      module: normalizeSubjectCode(moduleRaw ?? "")
    };
  }

  return {
    cohort: null,
    module: normalizeSubjectCode(raw)
  };
}

export function assignInstructorToModule(params: AssignInstructorToModuleParams): Session[] {
  const target = parseModuleScope(params.moduleKey);
  const normalizedInstructor = normalizeInstructorCode(params.instructorCode);

  if (!target.module) {
    return [...params.sessions];
  }

  return params.sessions.map((session) => {
    const sessionModule = normalizeSubjectCode(session["교과목(및 능력단위)코드"]);
    if (!sessionModule || sessionModule !== target.module) {
      return session;
    }

    if (target.cohort && session.과정기수.trim() !== target.cohort) {
      return session;
    }

    return {
      ...session,
      훈련강사코드: normalizedInstructor
    };
  });
}
