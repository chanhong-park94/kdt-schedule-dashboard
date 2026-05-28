/**
 * 교퍼팀 일정 데이터 — 정적 임베드
 * 출처: https://ee-aicampus.netlify.app/ (v7-L)
 * 마지막 동기화: 2026-05-28
 *
 * 외부 const DATA = {...}를 그대로 임베드. 변경 사항은 "업데이트 확인" 버튼으로 비교.
 */

export type FacilitatorPhaseId = "P1" | "P2" | "P3(365)";

export interface FacilitatorPhase {
  ph: FacilitatorPhaseId;
  s: string; // ISO yyyy-mm-dd
  e: string;
  person: string;
}

export interface FacilitatorCourse {
  name: string;
  type: string; // "리서처" | "엔지니어" | "AI데이터" | "AI에이전트" | "피지컬AI" | "프라이빗AI" | "데싸" | "프데분"
  section: "existing" | "new";
  phases: FacilitatorPhase[];
}

export interface FacilitatorPair {
  title: string;
  sub: string;
  color: string;
  p1: string;
  p2: string;
}

export interface FacilitatorData {
  courses: FacilitatorCourse[];
  colors: Record<string, [string, string]>; // [bg, fg]
  pairs: FacilitatorPair[];
  holidays: string[];
  personOrder: string[];
  skipPersons: string[];
}

export const FACILITATOR_META = {
  source: "https://ee-aicampus.netlify.app/",
  version: "v7-L",
  fetchedAt: "2026-05-28",
  title: "AI Campus 2026 교퍼팀 대시보드",
} as const;

export const TYPE_COLORS: Record<string, string> = {
  리서처: "#3498DB",
  엔지니어: "#9B59B6",
  AI데이터: "#2ECC71",
  AI에이전트: "#E74C3C",
  피지컬AI: "#F39C12",
  프라이빗AI: "#1ABC9C",
  데싸: "#6495ED",
  프데분: "#3CB371",
};

export const FACILITATOR_DATA: FacilitatorData = {
  courses: [
    { name: "데싸 6기", type: "데싸", section: "existing", phases: [{ ph: "P3(365)", s: "2026-02-20", e: "2026-03-16", person: "차정은" }] },
    { name: "데싸 7기", type: "데싸", section: "existing", phases: [
      { ph: "P2", s: "2026-02-20", e: "2026-03-12", person: "박형철" },
      { ph: "P3(365)", s: "2026-03-13", e: "2026-05-07", person: "이준희" },
    ] },
    { name: "데싸 8기", type: "데싸", section: "existing", phases: [
      { ph: "P1", s: "2026-02-20", e: "2026-03-19", person: "박기웅" },
      { ph: "P2", s: "2026-03-20", e: "2026-04-16", person: "박형철" },
      { ph: "P3(365)", s: "2026-04-17", e: "2026-06-15", person: "박기웅" },
    ] },
    { name: "프데분 4기", type: "프데분", section: "existing", phases: [{ ph: "P3(365)", s: "2026-02-20", e: "2026-04-10", person: "이준희" }] },
    { name: "프데분 5기", type: "프데분", section: "existing", phases: [
      { ph: "P1", s: "2026-02-20", e: "2026-02-24", person: "김지성" },
      { ph: "P2", s: "2026-02-25", e: "2026-04-27", person: "이진영" },
      { ph: "P3(365)", s: "2026-04-28", e: "2026-06-24", person: "이준희" },
    ] },
    { name: "리서처 15기", type: "리서처", section: "existing", phases: [{ ph: "P3(365)", s: "2026-02-20", e: "2026-03-18", person: "조해창" }] },
    { name: "리서처 16기", type: "리서처", section: "existing", phases: [
      { ph: "P1", s: "2026-02-20", e: "2026-04-27", person: "나융" },
      { ph: "P3(365)", s: "2026-04-28", e: "2026-06-24", person: "조해창" },
    ] },
    { name: "엔지니어 1기", type: "엔지니어", section: "existing", phases: [
      { ph: "P1", s: "2026-02-20", e: "2026-04-23", person: "박광석" },
      { ph: "P3(365)", s: "2026-04-24", e: "2026-06-24", person: "조해창" },
    ] },
    { name: "엔지니어 2기", type: "엔지니어", section: "existing", phases: [
      { ph: "P1", s: "2026-03-11", e: "2026-05-07", person: "김성훈" },
      { ph: "P2", s: "2026-05-08", e: "2026-07-06", person: "김지성" },
      { ph: "P3(365)", s: "2026-07-07", e: "2026-09-09", person: "이준희" },
    ] },
    { name: "리서처 17기", type: "리서처", section: "existing", phases: [
      { ph: "P1", s: "2026-03-11", e: "2026-05-07", person: "조웅제" },
      { ph: "P2", s: "2026-05-08", e: "2026-07-06", person: "박형철" },
      { ph: "P3(365)", s: "2026-07-07", e: "2026-09-09", person: "이준희" },
    ] },
    { name: "리서처 18기", type: "리서처", section: "new", phases: [
      { ph: "P1", s: "2026-05-11", e: "2026-07-07", person: "차정은" },
      { ph: "P2", s: "2026-07-08", e: "2026-09-10", person: "신규인력2" },
      { ph: "P3(365)", s: "2026-09-11", e: "2026-11-11", person: "신규인력5" },
    ] },
    { name: "엔지니어 3기", type: "엔지니어", section: "new", phases: [
      { ph: "P1", s: "2026-05-11", e: "2026-07-07", person: "신규인력1" },
      { ph: "P2", s: "2026-07-08", e: "2026-09-10", person: "박광석" },
      { ph: "P3(365)", s: "2026-09-11", e: "2026-11-11", person: "신규인력5" },
    ] },
    { name: "AI데이터 1기", type: "AI데이터", section: "new", phases: [
      { ph: "P1", s: "2026-06-24", e: "2026-08-27", person: "이진영" },
      { ph: "P2", s: "2026-08-28", e: "2026-10-28", person: "김지성" },
      { ph: "P3(365)", s: "2026-10-29", e: "2026-12-23", person: "이준희" },
    ] },
    { name: "AI에이전트 1기", type: "AI에이전트", section: "new", phases: [
      { ph: "P1", s: "2026-06-24", e: "2026-08-27", person: "조해창" },
      { ph: "P2", s: "2026-08-28", e: "2026-10-28", person: "차정은" },
      { ph: "P3(365)", s: "2026-10-29", e: "2026-12-23", person: "이준희" },
    ] },
    { name: "리서처 19기", type: "리서처", section: "new", phases: [
      { ph: "P1", s: "2026-07-01", e: "2026-09-03", person: "조웅제" },
      { ph: "P2", s: "2026-09-04", e: "2026-11-04", person: "박형철" },
      { ph: "P3(365)", s: "2026-11-05", e: "2026-12-31", person: "신규인력4" },
    ] },
    { name: "엔지니어 4기", type: "엔지니어", section: "new", phases: [
      { ph: "P1", s: "2026-07-01", e: "2026-09-03", person: "김성훈" },
      { ph: "P2", s: "2026-09-04", e: "2026-11-04", person: "박기웅" },
      { ph: "P3(365)", s: "2026-11-05", e: "2026-12-31", person: "신규인력4" },
    ] },
    { name: "피지컬AI 1기", type: "피지컬AI", section: "new", phases: [
      { ph: "P1", s: "2026-08-19", e: "2026-10-19", person: "외부리소스" },
      { ph: "P2", s: "2026-10-20", e: "2026-12-14", person: "외부리소스" },
      { ph: "P3(365)", s: "2026-12-15", e: "2027-02-12", person: "신규인력5" },
    ] },
    { name: "프라이빗AI 1기", type: "프라이빗AI", section: "new", phases: [
      { ph: "P1", s: "2026-08-19", e: "2026-10-19", person: "외부리소스" },
      { ph: "P2", s: "2026-10-20", e: "2026-12-14", person: "외부리소스" },
      { ph: "P3(365)", s: "2026-12-15", e: "2027-02-12", person: "신규인력5" },
    ] },
    { name: "리서처 20기", type: "리서처", section: "new", phases: [
      { ph: "P1", s: "2026-09-02", e: "2026-11-02", person: "신규인력3" },
      { ph: "P2", s: "2026-11-03", e: "2026-12-29", person: "신규인력2" },
      { ph: "P3(365)", s: "2026-12-30", e: "2027-02-26", person: "이준희" },
    ] },
    { name: "엔지니어 5기", type: "엔지니어", section: "new", phases: [
      { ph: "P1", s: "2026-09-02", e: "2026-11-02", person: "신규인력1" },
      { ph: "P2", s: "2026-11-03", e: "2026-12-29", person: "박광석" },
      { ph: "P3(365)", s: "2026-12-30", e: "2027-02-26", person: "이준희" },
    ] },
    { name: "AI데이터 2기", type: "AI데이터", section: "new", phases: [
      { ph: "P1", s: "2026-10-07", e: "2026-12-02", person: "이진영" },
      { ph: "P2", s: "2026-12-03", e: "2027-01-29", person: "김지성" },
      { ph: "P3(365)", s: "2027-02-01", e: "2027-03-31", person: "신규인력4" },
    ] },
    { name: "AI에이전트 2기", type: "AI에이전트", section: "new", phases: [
      { ph: "P1", s: "2026-10-07", e: "2026-12-02", person: "조해창" },
      { ph: "P2", s: "2026-12-03", e: "2027-01-29", person: "차정은" },
      { ph: "P3(365)", s: "2027-02-01", e: "2027-03-31", person: "신규인력4" },
    ] },
    { name: "리서처 21기", type: "리서처", section: "new", phases: [
      { ph: "P1", s: "2026-11-04", e: "2026-12-30", person: "조웅제" },
      { ph: "P2", s: "2026-12-31", e: "2027-03-02", person: "박형철" },
      { ph: "P3(365)", s: "2027-03-03", e: "2027-04-27", person: "신규인력5" },
    ] },
    { name: "엔지니어 6기", type: "엔지니어", section: "new", phases: [
      { ph: "P1", s: "2026-11-04", e: "2026-12-30", person: "김성훈" },
      { ph: "P2", s: "2026-12-31", e: "2027-03-02", person: "박기웅" },
      { ph: "P3(365)", s: "2027-03-03", e: "2027-04-27", person: "신규인력5" },
    ] },
    { name: "피지컬AI 2기", type: "피지컬AI", section: "new", phases: [
      { ph: "P1", s: "2026-12-02", e: "2027-01-28", person: "외부리소스" },
      { ph: "P2", s: "2027-01-29", e: "2027-03-30", person: "외부리소스" },
      { ph: "P3(365)", s: "2027-03-31", e: "2027-05-27", person: "이준희" },
    ] },
    { name: "프라이빗AI 2기", type: "프라이빗AI", section: "new", phases: [
      { ph: "P1", s: "2026-12-02", e: "2027-01-28", person: "외부리소스" },
      { ph: "P2", s: "2027-01-29", e: "2027-03-30", person: "외부리소스" },
      { ph: "P3(365)", s: "2027-03-31", e: "2027-05-27", person: "이준희" },
    ] },
  ],
  colors: {
    조웅제: ["#5DADE2", "#000"],
    나융: ["#6FA8DC", "#000"],
    김성훈: ["#9B59B6", "#fff"],
    박광석: ["#F5A623", "#000"],
    이진영: ["#6ABF69", "#000"],
    김지성: ["#F7DC6F", "#000"],
    차정은: ["#F9E79F", "#000"],
    박기웅: ["#82E0AA", "#000"],
    박형철: ["#C39BD3", "#000"],
    이준희: ["#F1948A", "#000"],
    조해창: ["#E59866", "#000"],
    신규인력1: ["#A3E4D7", "#000"],
    신규인력2: ["#D5DBDB", "#000"],
    신규인력3: ["#D4E6F1", "#000"],
    신규인력5: ["#E8DAEF", "#000"],
    외부리소스: ["#BFC9CE", "#000"],
    신규인력4: ["#FFCC99", "#000"],
  },
  pairs: [
    { title: "리서처 홀수", sub: "17·19·21기", color: "#3498DB", p1: "조웅제", p2: "박형철" },
    { title: "리서처 짝수(18기)", sub: "P1:차정은", color: "#2980B9", p1: "차정은", p2: "신규인력2" },
    { title: "리서처 짝수(20기~)", sub: "P1:신규인력3", color: "#2980B9", p1: "신규인력3", p2: "신규인력2" },
    { title: "엔지니어 홀수", sub: "3·5기", color: "#9B59B6", p1: "신규인력1", p2: "박광석" },
    { title: "엔지니어 짝수", sub: "4·6기", color: "#8E44AD", p1: "김성훈", p2: "박기웅" },
    { title: "AI에이전트", sub: "1·2기", color: "#E74C3C", p1: "조해창", p2: "차정은" },
    { title: "AI데이터", sub: "1·2기", color: "#2ECC71", p1: "이진영", p2: "김지성" },
  ],
  holidays: [
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02",
    "2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-07-17",
    "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
    "2026-08-17", "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09",
    "2026-12-25",
    "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09",
    "2027-03-01", "2027-05-05", "2027-05-13", "2027-06-07", "2027-08-02",
    "2027-08-03", "2027-08-04", "2027-08-05", "2027-08-06", "2027-08-16",
    "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-11",
    "2028-01-03", "2028-01-25", "2028-01-26", "2028-01-27", "2028-03-01",
    "2028-05-02", "2028-05-05",
  ],
  personOrder: [
    "조웅제", "박형철", "차정은", "박기웅", "김성훈", "박광석",
    "이진영", "김지성", "조해창", "이준희",
    "신규인력1", "신규인력2", "신규인력3", "신규인력4", "신규인력5",
  ],
  skipPersons: ["외부리소스", "나융"],
};

// 타임라인 범위 (간트차트 X축 기준)
export const FACILITATOR_TIMELINE_START = "2026-02-01";
export const FACILITATOR_TIMELINE_END = "2027-08-01";
