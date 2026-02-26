import { dedupByBasis } from "./dedup";
import { normalizeClassroomCode, normalizeInstructorCode } from "./standardize";
import { BasisKey, Conflict, ResourceType, Session } from "./types";

const ALL_RESOURCE_TYPES: ResourceType[] = ["INSTRUCTOR", "FACILITATOR", "OPERATION"];

const BASIS_CONFIG: Array<{ key: BasisKey; label: Conflict["기준"]; resourceType: ResourceType }> = [
  { key: "교육장소(강의실)코드", label: "강의실", resourceType: "OPERATION" },
  { key: "훈련강사코드", label: "강사", resourceType: "INSTRUCTOR" }
];

export type DetectConflictOptions = {
  resourceTypes?: ResourceType[];
};

export function detectConflicts(sessions: Session[], options: DetectConflictOptions = {}): Conflict[] {
  const conflicts: Conflict[] = [];
  const allowedResourceTypes = new Set<ResourceType>(options.resourceTypes ?? ALL_RESOURCE_TYPES);

  for (const basis of BASIS_CONFIG) {
    if (!allowedResourceTypes.has(basis.resourceType)) {
      continue;
    }

    const basisDeduped = dedupByBasis(sessions, basis.key);
    const buckets = new Map<string, Session[]>();

    for (const session of basisDeduped) {
      const basisValue =
        basis.key === "훈련강사코드"
          ? normalizeInstructorCode(session[basis.key])
          : normalizeClassroomCode(session[basis.key]);
      if (!session.훈련일자 || !basisValue || session.startMin === null || session.endMin === null) {
        continue;
      }

      const bucketId = `${session.훈련일자}|||${basisValue}`;
      if (!buckets.has(bucketId)) {
        buckets.set(bucketId, []);
      }
      buckets.get(bucketId)?.push(session);
    }

    for (const bucket of buckets.values()) {
      bucket.sort(
        (a, b) =>
          (a.startMin ?? Number.MAX_SAFE_INTEGER) - (b.startMin ?? Number.MAX_SAFE_INTEGER) ||
          (a.endMin ?? Number.MAX_SAFE_INTEGER) - (b.endMin ?? Number.MAX_SAFE_INTEGER) ||
          a.과정기수.localeCompare(b.과정기수)
      );

      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          const a = bucket[i];
          const b = bucket[j];

          if (a.과정기수 === b.과정기수) {
            continue;
          }

          if (a.startMin === null || a.endMin === null || b.startMin === null || b.endMin === null) {
            continue;
          }

          if (b.startMin >= a.endMin) {
            break;
          }

          if (a.startMin < b.endMin && b.startMin < a.endMin) {
            conflicts.push({
              기준: basis.label,
              resourceType: basis.resourceType,
              일자: a.훈련일자,
              키:
                basis.key === "훈련강사코드"
                  ? normalizeInstructorCode(a[basis.key])
                  : normalizeClassroomCode(a[basis.key]),
              과정A: a.과정기수,
              A시간: `${a.훈련시작시간}-${a.훈련종료시간}`,
              A교과목: a["교과목(및 능력단위)코드"],
              과정B: b.과정기수,
              B시간: `${b.훈련시작시간}-${b.훈련종료시간}`,
              B교과목: b["교과목(및 능력단위)코드"]
            });
          }
        }
      }
    }
  }

  return conflicts;
}
