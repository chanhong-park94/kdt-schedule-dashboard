# 상태 저장 스키마 (`schemaVersion: 2`)

로컬 저장/파일 저장에서 사용하는 프로젝트 상태 JSON 구조입니다.

## 최상위

```ts
type AppStateV2 = {
  schemaVersion: 2;
  savedAt: string; // ISO datetime
  sessions: Session[];
  cohortTrackTypes: Record<string, "UNEMPLOYED" | "EMPLOYED">;
  generatedCohortRanges: Array<{ cohort: string; startDate: string; endDate: string }>;
  scheduleGenerator: {
    cohort: string;
    startDate: string; // YYYY-MM-DD
    totalHours: string;
    instructorCode: string;
    classroomCode: string;
    subjectCode: string;
    pushToConflicts: boolean;
    dayTemplates: Array<{
      weekday: number; // 0~6
      start: string; // HH:mm | ""
      end: string; // HH:mm | ""
      breakStart: string; // HH:mm | ""
      breakEnd: string; // HH:mm | ""
    }>;
    holidays: string[]; // YYYY-MM-DD
    customBreaks: string[]; // YYYY-MM-DD
    generatedResult: GenerateScheduleResult | null;
    generatedCohort: string;
    publicHolidayLoaded: boolean;
  };
  staffingCells: Array<{
    cohort: string;
    phase: "P1" | "P2" | "365";
    assignee: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    resourceType: "INSTRUCTOR" | "FACILITATOR" | "OPERATION";
  }>;
  courseRegistry: Array<{
    courseId: string;
    courseName: string;
    memo: string;
  }>;
  instructorDirectory: Array<{
    instructorCode: string;
    name: string;
    memo: string;
  }>;
  instructorRegistry: Array<{
    instructorCode: string;
    name: string;
    memo: string;
  }>;
  subjectDirectory: Array<{
    courseId: string;
    subjectCode: string;
    subjectName: string;
    memo: string;
  }>;
  subjectRegistryByCourse: Array<{
    courseId: string;
    subjectCode: string;
    subjectName: string;
    memo: string;
  }>;
  subjectInstructorMappings: Array<{
    moduleKey: string; // "courseId|||subject"
    instructorCode: string;
  }>;
  courseSubjectInstructorMapping: Array<{
    courseId: string;
    moduleKey: string; // "courseId|||subject"
    instructorCode: string;
  }>;
  courseTemplates: Array<{
    name: string;
    version: string;
    courseId: string;
    dayTemplates: AppStateV2["scheduleGenerator"]["dayTemplates"];
    holidays: string[];
    customBreaks: string[];
    subjectList: Array<{
      subjectCode: string;
      subjectName: string;
      memo: string;
    }>;
    subjectInstructorMapping: Array<{
      key: string; // "courseId|||subject"
      instructorCode: string;
    }>;
  }>;
  ui: {
    activeConflictTab: "time" | "instructor_day" | "fo_day";
    viewMode: "simple" | "full";
    timelineViewType:
      | "COHORT_TIMELINE"
      | "COURSE_GROUPED"
      | "ASSIGNEE_TIMELINE"
      | "WEEK_GRID"
      | "MONTH_CALENDAR";
    adminMode: boolean;
    keySearch: string;
    instructorDaySearch: string;
    foDaySearch: string;
  };
};
```

## 마이그레이션 정책

- 현재 버전: `2`
- `schemaVersion` 누락: `v1`로 간주 후 `v2`로 마이그레이션
- `schemaVersion: 1`: `migrateV1ToV2` 경로로 변환
- `schemaVersion: 2`: 그대로 사용(필드 정규화/기본값 보정만 수행)
- 알 수 없는 버전: 사용자 친화적 에러로 로드 차단

## 호환성 / 기본값 / 폐기 필드 처리

- 유효하지 않은 `phase`/`resourceType`/`trackType` 항목은 무시
- 잘못된 구조(배열/객체 불일치)는 빈값으로 대체
- 누락 필드는 기본값 적용
  - 문자열: `""`
  - 배열: `[]`
  - 불리언: `false`
  - `generatedResult`: `null`
- 정의되지 않은 추가 필드(폐기 예정/알 수 없는 필드)는 무시

## 저장 전략

- 자동저장: `localStorage` (`academic_schedule_manager_state_v1`)에 500ms debounce 저장
- 수동저장: JSON 다운로드
- 수동불러오기: JSON 파일 업로드
- 용량 경고: UTF-8 기준 약 4.5MB 이상이면 localStorage 초과 가능성 경고 표시
