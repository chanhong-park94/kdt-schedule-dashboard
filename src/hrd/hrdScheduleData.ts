/**
 * 2026년도 KDT 학사일정 데이터
 * 출처: 26년도 KDT 최종 학사일정.xlsx
 *
 * 타임라인 렌더링용 CohortSummary 및 강사 배치 데이터
 */
import type { CohortSummary } from "../core/types";
import type { TrackType } from "../core/types";

export type KdtInstructorPhase = {
  assignee: string;
  startDate: string; // YYYYMMDD
  endDate: string;   // YYYYMMDD
};

export type KdtCourseSchedule = {
  cohort: string;
  startDate: string;  // YYYYMMDD
  endDate: string;    // YYYYMMDD
  trackType: TrackType;
  manager: string;
  selectionManager: string;
  instructors: KdtInstructorPhase[];
};

/** 2026년도 KDT 전체 학사일정 */
export const KDT_SCHEDULE_2026: KdtCourseSchedule[] = [
  // ─── 현재 훈련중 ───
  {
    cohort: "재직자기획/개발4기",
    startDate: "20251222", endDate: "20260324",
    trackType: "EMPLOYED", manager: "정다윤", selectionManager: "",
    instructors: [{ assignee: "박성훈", startDate: "20251222", endDate: "20260324" }],
  },
  {
    cohort: "재직자LLM5기",
    startDate: "20260203", endDate: "20260502",
    trackType: "EMPLOYED", manager: "김한샘", selectionManager: "",
    instructors: [{ assignee: "오승환", startDate: "20260203", endDate: "20260502" }],
  },
  {
    cohort: "재직자LLM6기",
    startDate: "20260310", endDate: "20260613",
    trackType: "EMPLOYED", manager: "김한샘", selectionManager: "",
    instructors: [{ assignee: "이상호", startDate: "20260310", endDate: "20260613" }],
  },
  {
    cohort: "리서치17기",
    startDate: "20260311", endDate: "20260909",
    trackType: "UNEMPLOYED", manager: "김한샘", selectionManager: "",
    instructors: [
      { assignee: "조웅제", startDate: "20260311", endDate: "20260507" },
      { assignee: "나융", startDate: "20260508", endDate: "20260706" },
      { assignee: "이준희", startDate: "20260707", endDate: "20260909" },
    ],
  },
  {
    cohort: "엔지니어2기",
    startDate: "20260311", endDate: "20260909",
    trackType: "UNEMPLOYED", manager: "최지영", selectionManager: "",
    instructors: [
      { assignee: "김성훈", startDate: "20260311", endDate: "20260507" },
      { assignee: "박광석", startDate: "20260508", endDate: "20260706" },
      { assignee: "이준희", startDate: "20260707", endDate: "20260909" },
    ],
  },
  {
    cohort: "재직자데이터5기",
    startDate: "20260317", endDate: "20260523",
    trackType: "EMPLOYED", manager: "김재철", selectionManager: "",
    instructors: [{ assignee: "채종훈", startDate: "20260317", endDate: "20260523" }],
  },
  // ─── 2026 상반기 개강 예정 ───
  {
    cohort: "재직자기획/개발5기",
    startDate: "20260324", endDate: "20260627",
    trackType: "EMPLOYED", manager: "정다윤", selectionManager: "",
    instructors: [{ assignee: "박병준", startDate: "20260324", endDate: "20260627" }],
  },
  {
    cohort: "재직자데이터6기",
    startDate: "20260414", endDate: "20260627",
    trackType: "EMPLOYED", manager: "김재철", selectionManager: "정다윤",
    instructors: [{ assignee: "NEW", startDate: "20260414", endDate: "20260627" }],
  },
  {
    cohort: "재직자기획/개발6기",
    startDate: "20260421", endDate: "20260725",
    trackType: "EMPLOYED", manager: "정다윤", selectionManager: "최지영",
    instructors: [{ assignee: "김태현", startDate: "20260421", endDate: "20260725" }],
  },
  {
    cohort: "리서치18기",
    startDate: "20260511", endDate: "20261111",
    trackType: "UNEMPLOYED", manager: "김한샘", selectionManager: "김재철",
    instructors: [
      { assignee: "NEW1", startDate: "20260511", endDate: "20260707" },
      { assignee: "박형철", startDate: "20260708", endDate: "20260910" },
      { assignee: "이준희", startDate: "20260911", endDate: "20261111" },
    ],
  },
  {
    cohort: "엔지니어3기",
    startDate: "20260511", endDate: "20261111",
    trackType: "UNEMPLOYED", manager: "최지영", selectionManager: "김한샘",
    instructors: [
      { assignee: "김성훈", startDate: "20260511", endDate: "20260707" },
      { assignee: "박광석", startDate: "20260708", endDate: "20260910" },
      { assignee: "이준희", startDate: "20260911", endDate: "20261111" },
    ],
  },
  {
    cohort: "재직자LLM7기",
    startDate: "20260526", endDate: "20260829",
    trackType: "EMPLOYED", manager: "김한샘", selectionManager: "한진아",
    instructors: [{ assignee: "오승환", startDate: "20260526", endDate: "20260829" }],
  },
  // ─── 2026 하반기 ───
  {
    cohort: "재직자데이터7기",
    startDate: "20260609", endDate: "20260808",
    trackType: "EMPLOYED", manager: "김재철", selectionManager: "TBC",
    instructors: [{ assignee: "채종훈", startDate: "20260609", endDate: "20260808" }],
  },
  {
    cohort: "AI데이터1기",
    startDate: "20260610", endDate: "20261209",
    trackType: "UNEMPLOYED", manager: "TBC", selectionManager: "TBC",
    instructors: [
      { assignee: "이진영", startDate: "20260610", endDate: "20260812" },
      { assignee: "김지성", startDate: "20260813", endDate: "20261014" },
      { assignee: "조해창", startDate: "20261015", endDate: "20261209" },
    ],
  },
  {
    cohort: "AI에이전트1기",
    startDate: "20260610", endDate: "20261209",
    trackType: "UNEMPLOYED", manager: "TBC", selectionManager: "TBC",
    instructors: [
      { assignee: "차정은", startDate: "20260610", endDate: "20260812" },
      { assignee: "NEW3", startDate: "20260813", endDate: "20261014" },
      { assignee: "조해창", startDate: "20261015", endDate: "20261209" },
    ],
  },
  {
    cohort: "재직자LLM8기",
    startDate: "20260623", endDate: "20260919",
    trackType: "EMPLOYED", manager: "김한샘", selectionManager: "TBC",
    instructors: [{ assignee: "김동욱", startDate: "20260623", endDate: "20260919" }],
  },
  {
    cohort: "리서치19기",
    startDate: "20260701", endDate: "20261231",
    trackType: "UNEMPLOYED", manager: "김한샘", selectionManager: "TBC",
    instructors: [
      { assignee: "조웅제", startDate: "20260701", endDate: "20260903" },
      { assignee: "나융", startDate: "20260904", endDate: "20261104" },
      { assignee: "NEW3", startDate: "20261105", endDate: "20261231" },
    ],
  },
  {
    cohort: "엔지니어4기",
    startDate: "20260701", endDate: "20261231",
    trackType: "UNEMPLOYED", manager: "최지영", selectionManager: "TBC",
    instructors: [
      { assignee: "NEW2", startDate: "20260701", endDate: "20260903" },
      { assignee: "박기웅", startDate: "20260904", endDate: "20261104" },
      { assignee: "NEW3", startDate: "20261105", endDate: "20261231" },
    ],
  },
  {
    cohort: "재직자기획/개발7기",
    startDate: "20260714", endDate: "20261024",
    trackType: "EMPLOYED", manager: "정다윤", selectionManager: "TBC",
    instructors: [{ assignee: "박병준", startDate: "20260714", endDate: "20261024" }],
  },
  {
    cohort: "재직자데이터8기",
    startDate: "20260714", endDate: "20260919",
    trackType: "EMPLOYED", manager: "김재철", selectionManager: "TBC",
    instructors: [{ assignee: "NEW", startDate: "20260714", endDate: "20260919" }],
  },
  {
    cohort: "재직자기획/개발8기",
    startDate: "20260818", endDate: "20261121",
    trackType: "EMPLOYED", manager: "정다윤", selectionManager: "TBC",
    instructors: [{ assignee: "김태현", startDate: "20260818", endDate: "20261121" }],
  },
  {
    cohort: "프라이빗AI1기",
    startDate: "20260819", endDate: "20270212",
    trackType: "UNEMPLOYED", manager: "TBC", selectionManager: "TBC",
    instructors: [
      { assignee: "외부강사1", startDate: "20260819", endDate: "20261014" },
      { assignee: "외부강사2", startDate: "20261015", endDate: "20261214" },
      { assignee: "이준희", startDate: "20261215", endDate: "20270212" },
    ],
  },
  {
    cohort: "피지컬AI1기",
    startDate: "20260819", endDate: "20270212",
    trackType: "UNEMPLOYED", manager: "TBC", selectionManager: "TBC",
    instructors: [
      { assignee: "외부강사1", startDate: "20260819", endDate: "20261014" },
      { assignee: "외부강사2", startDate: "20261015", endDate: "20261214" },
      { assignee: "이준희", startDate: "20261215", endDate: "20270212" },
    ],
  },
  {
    cohort: "리서치20기",
    startDate: "20260902", endDate: "20270226",
    trackType: "UNEMPLOYED", manager: "김한샘", selectionManager: "TBC",
    instructors: [
      { assignee: "NEW1", startDate: "20260902", endDate: "20261102" },
      { assignee: "박형철", startDate: "20261103", endDate: "20261229" },
      { assignee: "조해창", startDate: "20261230", endDate: "20270226" },
    ],
  },
  {
    cohort: "엔지니어5기",
    startDate: "20260902", endDate: "20270226",
    trackType: "UNEMPLOYED", manager: "최지영", selectionManager: "TBC",
    instructors: [
      { assignee: "김성훈", startDate: "20260902", endDate: "20261102" },
      { assignee: "박광석", startDate: "20261103", endDate: "20261229" },
      { assignee: "조해창", startDate: "20261230", endDate: "20270226" },
    ],
  },
  {
    cohort: "재직자LLM9기",
    startDate: "20260908", endDate: "20261212",
    trackType: "EMPLOYED", manager: "김한샘", selectionManager: "TBC",
    instructors: [{ assignee: "오승환", startDate: "20260908", endDate: "20261212" }],
  },
  {
    cohort: "AI데이터2기",
    startDate: "20261007", endDate: "20270331",
    trackType: "UNEMPLOYED", manager: "TBC", selectionManager: "TBC",
    instructors: [
      { assignee: "이진영", startDate: "20261007", endDate: "20261202" },
      { assignee: "김지성", startDate: "20261203", endDate: "20270129" },
      { assignee: "NEW3", startDate: "20270201", endDate: "20270331" },
    ],
  },
  {
    cohort: "AI에이전트2기",
    startDate: "20261007", endDate: "20270331",
    trackType: "UNEMPLOYED", manager: "TBC", selectionManager: "TBC",
    instructors: [
      { assignee: "차정은", startDate: "20261007", endDate: "20261202" },
      { assignee: "김성훈", startDate: "20261203", endDate: "20270129" },
      { assignee: "NEW3", startDate: "20270201", endDate: "20270331" },
    ],
  },
  {
    cohort: "재직자LLM10기",
    startDate: "20261013", endDate: "20270109",
    trackType: "EMPLOYED", manager: "김한샘", selectionManager: "TBC",
    instructors: [{ assignee: "김동욱", startDate: "20261013", endDate: "20270109" }],
  },
  {
    cohort: "재직자데이터9기",
    startDate: "20261013", endDate: "20261212",
    trackType: "EMPLOYED", manager: "김재철", selectionManager: "TBC",
    instructors: [{ assignee: "채종훈", startDate: "20261013", endDate: "20261212" }],
  },
  {
    cohort: "리서치21기",
    startDate: "20261104", endDate: "20270427",
    trackType: "UNEMPLOYED", manager: "김한샘", selectionManager: "TBC",
    instructors: [
      { assignee: "조웅제", startDate: "20261104", endDate: "20261230" },
      { assignee: "나융", startDate: "20261231", endDate: "20270302" },
      { assignee: "이준희", startDate: "20270303", endDate: "20270427" },
    ],
  },
  {
    cohort: "엔지니어6기",
    startDate: "20261104", endDate: "20270427",
    trackType: "UNEMPLOYED", manager: "최지영", selectionManager: "TBC",
    instructors: [
      { assignee: "NEW2", startDate: "20261104", endDate: "20261230" },
      { assignee: "박기웅", startDate: "20261231", endDate: "20270302" },
      { assignee: "이준희", startDate: "20270303", endDate: "20270427" },
    ],
  },
  {
    cohort: "재직자기획/개발9기",
    startDate: "20261110", endDate: "20270213",
    trackType: "EMPLOYED", manager: "정다윤", selectionManager: "TBC",
    instructors: [{ assignee: "박병준", startDate: "20261110", endDate: "20270213" }],
  },
  {
    cohort: "재직자데이터10기",
    startDate: "20261110", endDate: "20270116",
    trackType: "EMPLOYED", manager: "김재철", selectionManager: "TBC",
    instructors: [{ assignee: "NEW", startDate: "20261110", endDate: "20270116" }],
  },
];

/** KDT 학사일정 → 타임라인용 CohortSummary 변환 */
export function getKdtScheduleSummaries(): CohortSummary[] {
  return KDT_SCHEDULE_2026.map((s) => ({
    과정기수: s.cohort,
    시작일: s.startDate,
    종료일: s.endDate,
    훈련일수: estimateTrainingDays(s.startDate, s.endDate, s.trackType),
    세션수: 0,
  }));
}

/** 훈련일수 추정 (수업 요일 기반) */
function estimateTrainingDays(startStr: string, endStr: string, trackType: TrackType): number {
  const start = parseYYYYMMDD(startStr);
  const end = parseYYYYMMDD(endStr);
  if (!start || !end) return 0;
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    if (trackType === "EMPLOYED") {
      // 재직자: 화~토 (2~6)
      if (dow >= 2 && dow <= 6) count++;
    } else {
      // 실업자: 월~금 (1~5)
      if (dow >= 1 && dow <= 5) count++;
    }
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function parseYYYYMMDD(s: string): Date | null {
  if (s.length !== 8) return null;
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10) - 1;
  const day = parseInt(s.slice(6, 8), 10);
  return new Date(y, m, day);
}
