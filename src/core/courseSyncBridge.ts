/**
 * 과정 데이터 동기화 브릿지
 *
 * HRD 과정등록(System A) → 정보입력 courseRegistry(System B) 단방향 동기화.
 * HRD 과정을 courseRegistry에 자동 추가하여 시간표 생성에서 사용 가능하게 합니다.
 */
import type { HrdCourse } from "../hrd/hrdTypes";
import type { CourseRegistryEntry } from "../ui/appState";
import { appState } from "../ui/appState";
import { loadHrdConfig } from "../hrd/hrdConfig";

/** HrdCourse → CourseRegistryEntry 변환 */
function hrdCourseToRegistryEntry(course: HrdCourse): CourseRegistryEntry {
  return {
    courseId: course.name.trim(),
    courseName: course.name.trim(),
    memo: "",
    hrdTrainPrId: course.trainPrId,
  };
}

/** 전체 HRD 과정을 courseRegistry에 동기화 (additive, 기존 수기 항목 유지) */
export function syncHrdCoursesToRegistry(): number {
  const config = loadHrdConfig();
  let added = 0;

  for (const course of config.courses) {
    const exists = appState.courseRegistry.some(
      (e) => e.hrdTrainPrId === course.trainPrId || e.courseId === course.name.trim(),
    );
    if (!exists) {
      appState.courseRegistry.push(hrdCourseToRegistryEntry(course));
      added++;
    } else {
      // 기존 항목에 hrdTrainPrId가 없으면 보강
      const existing = appState.courseRegistry.find((e) => e.courseId === course.name.trim());
      if (existing && !existing.hrdTrainPrId) {
        existing.hrdTrainPrId = course.trainPrId;
      }
    }
  }

  return added;
}

/** 단건 HRD 과정 동기화 (과정 추가 시 호출) */
export function syncSingleHrdCourse(course: HrdCourse): boolean {
  const exists = appState.courseRegistry.some(
    (e) => e.hrdTrainPrId === course.trainPrId || e.courseId === course.name.trim(),
  );
  if (!exists) {
    appState.courseRegistry.push(hrdCourseToRegistryEntry(course));
    return true;
  }
  return false;
}

/** HRD 과정 삭제 시 registry에서 hrdTrainPrId 제거 (항목 자체는 유지) */
export function unlinkHrdCourse(trainPrId: string): void {
  const entry = appState.courseRegistry.find((e) => e.hrdTrainPrId === trainPrId);
  if (entry) {
    entry.hrdTrainPrId = undefined;
  }
}
