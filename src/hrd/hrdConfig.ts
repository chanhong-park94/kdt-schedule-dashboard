/** HRD 설정 관리 (localStorage) */
import type { HrdConfig, HrdCourse } from "./hrdTypes";

const STORAGE_KEY = "academic_schedule_manager_hrd_config_v1";

// HRD-Net authKey 관리 전략:
// - Edge Function(hrd-proxy) 배포 시: Deno.env('HRD_AUTH_KEY')로 서버에서 관리 (클라이언트 미사용)
// - Edge Function 미배포 시: localStorage의 authKey로 직접 CORS 프록시 경유 (폴백)
// - 기본값은 Edge Function 배포 후 제거 예정
const DEFAULT_KEY = "";

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
    degrs: ["1", "2", "3", "4", "5"],
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
      // 기존 저장된 과정의 totalDays/category를 DEFAULT_COURSES 기준으로 동기화
      let updated = false;
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
