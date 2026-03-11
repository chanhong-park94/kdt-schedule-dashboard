import { Session } from "./types";

export type CohortInstructorMeta = {
  representativeInstructor: string | null;
  representativeCount: number;
  instructorCount: number;
  instructorLabel: string;
  instructorTooltip: string;
  barColor: string;
};

function hashToHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function instructorCodeToStableHsl(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    return "hsl(210 14% 56%)";
  }
  const hue = hashToHue(trimmed);
  return `hsl(${hue} 62% 46%)`;
}

export function buildCohortInstructorMetaMap(sessions: Session[]): Map<string, CohortInstructorMeta> {
  const counterByCohort = new Map<string, Map<string, number>>();

  for (const session of sessions) {
    const cohort = session.과정기수.trim();
    const instructor = session.훈련강사코드.trim();
    if (!cohort || !instructor) {
      continue;
    }
    const byInstructor = counterByCohort.get(cohort) ?? new Map<string, number>();
    byInstructor.set(instructor, (byInstructor.get(instructor) ?? 0) + 1);
    counterByCohort.set(cohort, byInstructor);
  }

  const result = new Map<string, CohortInstructorMeta>();

  for (const [cohort, byInstructor] of counterByCohort.entries()) {
    const ranked = Array.from(byInstructor.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const representativeInstructor = ranked[0]?.[0] ?? null;
    const representativeCount = ranked[0]?.[1] ?? 0;
    const instructorCount = ranked.length;
    const others = Math.max(0, instructorCount - 1);
    const instructorLabel = representativeInstructor
      ? `강사: ${representativeInstructor}${others > 0 ? ` (외 ${others}명)` : ""}`
      : "강사: 미지정";
    const instructorTooltip = ranked.map(([code, count]) => `${code} (${count}건)`).join(", ");

    result.set(cohort, {
      representativeInstructor,
      representativeCount,
      instructorCount,
      instructorLabel,
      instructorTooltip,
      barColor: instructorCodeToStableHsl(representativeInstructor ?? ""),
    });
  }

  return result;
}
