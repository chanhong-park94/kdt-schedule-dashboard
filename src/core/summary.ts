import { CohortSummary, Session } from "./types";

export function buildCohortSummaries(sessions: Session[]): CohortSummary[] {
  const byCohort = new Map<string, Session[]>();

  for (const session of sessions) {
    if (!session.과정기수) {
      continue;
    }

    if (!byCohort.has(session.과정기수)) {
      byCohort.set(session.과정기수, []);
    }
    byCohort.get(session.과정기수)?.push(session);
  }

  const summaries: CohortSummary[] = [];

  for (const [cohort, cohortSessions] of byCohort.entries()) {
    const dates = [...new Set(cohortSessions.map((session) => session.훈련일자).filter(Boolean))].sort();

    summaries.push({
      과정기수: cohort,
      시작일: dates[0] ?? "",
      종료일: dates[dates.length - 1] ?? "",
      훈련일수: dates.length,
      세션수: cohortSessions.length,
    });
  }

  return summaries.sort((a, b) => a.과정기수.localeCompare(b.과정기수));
}
