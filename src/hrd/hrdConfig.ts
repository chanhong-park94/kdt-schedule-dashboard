/** HRD 설정 관리 (localStorage) */
import type { HrdConfig, HrdCourse } from "./hrdTypes";

const STORAGE_KEY = "academic_schedule_manager_hrd_config_v1";
const DEFAULT_KEY = "";  // API key is set at runtime via settings UI only

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
  },
  {
    name: "AI 활용 서비스 기획/개발",
    trainPrId: "AIG20250000501545",
    degrs: ["1", "2", "3", "4", "5"],
    startDate: "",
    totalDays: 0,
    endTime: "18:00",
    category: "재직자",
  },
  {
    name: "데이터 기반 의사결정",
    trainPrId: "AIG20250000501393",
    degrs: ["1", "2", "3", "5"],
    startDate: "",
    totalDays: 0,
    endTime: "18:00",
    category: "재직자",
  },
  // ─── 실업자 과정 ───
  {
    name: "데이터사이언티스트",
    trainPrId: "AIG20230000455611",
    degrs: ["1", "2", "3"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
  },
  {
    name: "데이터분석",
    trainPrId: "AIG20240000498265",
    degrs: ["1", "2", "3"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
  },
  {
    name: "[아이펠]딥러닝 개발자 도약 과정",
    trainPrId: "AIG20240000459187",
    degrs: ["1", "2", "3", "4"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
  },
  {
    name: "AI 기반 지능형 서비스 개발 전문가 과정",
    trainPrId: "AIG20250000501638",
    degrs: ["1", "2"],
    startDate: "",
    totalDays: 120,
    endTime: "18:00",
    category: "실업자",
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
      // 기존 저장된 과정의 totalDays/category가 없으면 DEFAULT_COURSES에서 병합
      let updated = false;
      for (const course of config.courses) {
        const def = DEFAULT_COURSES.find((d) => d.trainPrId === course.trainPrId);
        if (def) {
          if ((course.totalDays === 0 || course.totalDays === undefined) && def.totalDays > 0) {
            course.totalDays = def.totalDays;
            updated = true;
          }
          if (!course.category && def.category) {
            course.category = def.category;
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
  } catch { /* ignore */ }
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
