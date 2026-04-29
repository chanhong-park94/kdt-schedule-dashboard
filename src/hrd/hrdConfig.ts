/** HRD 설정 관리 (localStorage) */
import type { HrdConfig, HrdCourse } from "./hrdTypes";

const STORAGE_KEY = "academic_schedule_manager_hrd_config_v1";

// HRD-Net authKey 관리 전략:
// - Edge Function(hrd-proxy) 배포 시: Deno.env('HRD_AUTH_KEY')로 서버에서 관리 (클라이언트 미사용)
// - Edge Function 미배포 시: localStorage의 authKey로 직접 CORS 프록시 경유 (폴백)
// ⚠️ Edge Function 배포 완료 후 이 기본값을 ""로 변경할 것
const DEFAULT_KEY = "gL1rEteJnyrvfy3KmafcvPfrhT2E7rgz";

/** 기본 운영 과정 목록 (API 확인 완료) */
export const DEFAULT_COURSES: HrdCourse[] = [
  // ─── 재직자 과정 ───
  {
    name: "재직자 LLM",
    trainPrId: "AIG20240000498389",
    degrs: ["1", "2", "3", "4", "5", "6"],
    startDate: "",
    totalDays: 60,
    endTime: "18:00",
    category: "재직자",
    trainingHoursPerDay: 8,
  },
  {
    name: "AI 활용 서비스 기획/개발",
    trainPrId: "AIG20250000501545",
    degrs: ["1", "2", "3", "4", "5", "6"],
    startDate: "",
    totalDays: 60,
    endTime: "18:00",
    category: "재직자",
    trainingHoursPerDay: 8,
  },
  {
    name: "데이터 기반 의사결정",
    trainPrId: "AIG20250000501393",
    degrs: ["1", "2", "3", "4", "5"],
    startDate: "",
    totalDays: 45,
    endTime: "18:00",
    category: "재직자",
    trainingHoursPerDay: 8,
  },
  // ─── 실업자 과정 ───
  {
    name: "데이터사이언티스트",
    trainPrId: "AIG20230000455611",
    degrs: ["1", "2", "3", "4", "5", "6", "7", "8"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
    trainingHoursPerDay: 8,
  },
  {
    name: "데이터분석",
    trainPrId: "AIG20240000498265",
    degrs: ["1", "2", "3", "4", "5"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
    trainingHoursPerDay: 8,
  },
  {
    name: "[아이펠]딥러닝 개발자 도약 과정",
    trainPrId: "AIG20240000459187",
    degrs: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
    trainingHoursPerDay: 8,
  },
  {
    name: "AI 기반 지능형 서비스 개발 전문가 과정",
    trainPrId: "AIG20250000501638",
    degrs: ["1", "2"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
    trainingHoursPerDay: 8,
  },
];

export function loadHrdConfig(): HrdConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const config = JSON.parse(raw) as HrdConfig;
      // 저장된 과정이 없으면 기본 과정 사용
      if (config.courses.length === 0) {
        config.courses = [...DEFAULT_COURSES];
      }
      let updated = false;

      // 같은 trainPrId가 중복 등록된 경우 첫 항목만 유지하고 degrs는 합집합으로 병합
      // (과거 등록 + 신규 추가 충돌 방지 — dropdown/설정 카드 중복 표시 회귀 가드)
      const seen = new Map<string, HrdCourse>();
      for (const c of config.courses) {
        const existing = seen.get(c.trainPrId);
        if (existing) {
          const merged = Array.from(new Set([...existing.degrs, ...c.degrs])).sort(
            (a, b) => (parseInt(a) || 0) - (parseInt(b) || 0),
          );
          existing.degrs = merged;
          updated = true;
        } else {
          seen.set(c.trainPrId, c);
        }
      }
      if (updated) config.courses = Array.from(seen.values());

      // 기존 저장된 과정의 totalDays/category를 DEFAULT_COURSES 기준으로 동기화
      for (const course of config.courses) {
        const def = DEFAULT_COURSES.find((d) => d.trainPrId === course.trainPrId);
        if (def) {
          // totalDays: 미설정이면 기본값 적용, DEFAULT 값이 변경된 경우에도 동기화
          if (def.totalDays > 0 && course.totalDays !== def.totalDays) {
            course.totalDays = def.totalDays;
            updated = true;
          }
          if (!course.category && def.category) {
            course.category = def.category;
            updated = true;
          }
          if (!course.trainingHoursPerDay && def.trainingHoursPerDay) {
            course.trainingHoursPerDay = def.trainingHoursPerDay;
            updated = true;
          }
          // DEFAULT에 새 기수가 추가된 경우 사용자 저장본에도 합집합으로 반영
          // (사용자가 직접 추가한 기수는 보존)
          const missingDegrs = def.degrs.filter((d) => !course.degrs.includes(d));
          if (missingDegrs.length > 0) {
            course.degrs = Array.from(new Set([...course.degrs, ...missingDegrs])).sort(
              (a, b) => (parseInt(a) || 0) - (parseInt(b) || 0),
            );
            updated = true;
          }
        }
      }
      // DEFAULT_COURSES에 있지만 저장된 config에 없는 과정 자동 추가
      for (const def of DEFAULT_COURSES) {
        if (!config.courses.find((c) => c.trainPrId === def.trainPrId)) {
          config.courses.push({ ...def, degrs: [...def.degrs] });
          updated = true;
        }
      }
      if (updated) saveHrdConfig(config);
      return config;
    }
  } catch {
    /* ignore */
  }
  return { authKey: DEFAULT_KEY, proxy: "", courses: [...DEFAULT_COURSES] };
}

export function saveHrdConfig(config: HrdConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function addCourse(course: HrdCourse): void {
  const config = loadHrdConfig();
  config.courses.push(course);
  saveHrdConfig(config);
}

export function updateCourse(index: number, course: HrdCourse): void {
  const config = loadHrdConfig();
  if (index >= 0 && index < config.courses.length) {
    config.courses[index] = course;
    saveHrdConfig(config);
  }
}

export function removeCourse(index: number): void {
  const config = loadHrdConfig();
  if (index >= 0 && index < config.courses.length) {
    config.courses.splice(index, 1);
    saveHrdConfig(config);
  }
}

export function getDefaultAuthKey(): string {
  return DEFAULT_KEY;
}

/**
 * 보조강사 세션(Supabase 공유)의 과정·기수를 로컬 hrdConfig에 보장.
 *
 * 배경:
 *  - `hrdConfig.courses`는 브라우저 localStorage 전용이라 새 기수(degr)가
 *    관리자 기기에서만 업데이트되면 보조강사 쪽 dropdown에는 안 뜬다.
 *  - select 요소의 표준 동작상 존재하지 않는 value를 세팅하면 조용히 빈 문자열이
 *    되어 "과정과 기수를 선택해주세요" 오류가 발생한다.
 *
 * 이 함수는:
 *  - 과정이 없으면 세션 정보로 최소 스펙을 만들어 추가
 *  - 과정은 있지만 해당 기수가 degrs에 없으면 추가
 *  - DEFAULT_COURSES에 동일 trainPrId가 있으면 속성(totalDays 등)을 상속
 *
 * @returns 변경되었는지 여부 (호출자가 filter 재렌더 결정용)
 */
export function ensureCourseAndDegr(trainPrId: string, degr: string, courseName: string): boolean {
  if (!trainPrId || !degr) return false;
  const config = loadHrdConfig();
  let updated = false;

  let course = config.courses.find((c) => c.trainPrId === trainPrId);
  if (!course) {
    // 과정 자체가 없으면 최소 정보로 신규 추가 (DEFAULT_COURSES 속성 상속)
    const def = DEFAULT_COURSES.find((d) => d.trainPrId === trainPrId);
    const newCourse: HrdCourse = def
      ? { ...def, degrs: [...def.degrs] }
      : {
          name: courseName || "(신규 과정)",
          trainPrId,
          degrs: [],
          startDate: "",
          totalDays: 120,
          endTime: "18:00",
          category: "실업자",
          trainingHoursPerDay: 8,
        };
    if (!newCourse.degrs.includes(degr)) newCourse.degrs.push(degr);
    newCourse.degrs.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    config.courses.push(newCourse);
    updated = true;
  } else if (!course.degrs.includes(degr)) {
    // 과정은 있으나 해당 기수가 없으면 추가
    course.degrs.push(degr);
    course.degrs.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    updated = true;
  }

  if (updated) saveHrdConfig(config);
  return updated;
}
