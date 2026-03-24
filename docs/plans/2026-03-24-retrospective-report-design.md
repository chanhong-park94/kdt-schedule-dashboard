# 운영 회고 리포트 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 교차분석 탭 내 "운영 회고 리포트" 서브탭 추가. 과정/기수 선택 후 5개 지표(출결, 성취도, 만족도, 문의응대, 하차방어) 종합 대시보드 + PDF 내보내기.

**Architecture:** crossAnalysis 모듈 내 새 파일 3개 추가 (types, data, init). 기존 crossAnalysisInit.ts의 setupSubTabs()에 3번째 탭 연결. PDF는 기존 kpiPdf.ts 패턴(window.print + Chart.js offscreen canvas → base64)을 따름.

**Tech Stack:** TypeScript, Chart.js 4.x (bar/donut/line/radar), window.print() PDF

---

### Task 1: 타입 정의

**Files:**
- Create: `src/crossAnalysis/retrospectiveTypes.ts`

**Step 1: 타입 파일 작성**

```typescript
/**
 * 운영 회고 리포트 타입 정의
 */

/** 리포트 대상 선택 */
export interface RetrospectiveFilter {
  courseName: string;
  trainPrId: string;
  selectedDegrs: string[]; // 선택된 기수 배열
}

/** 각 섹션별 데이터 존재 여부 */
export interface DataAvailability {
  attendance: boolean;
  achievement: boolean;
  satisfaction: boolean;
  inquiry: boolean;
  dropout: boolean;
}

/** 출결 섹션 데이터 */
export interface AttendanceSectionData {
  avgRate: number;
  defenseRate: number;
  riskCounts: { danger: number; warning: number; caution: number; safe: number };
  absentTop3: { name: string; absentDays: number; rate: number }[];
  rateDistribution: { label: string; count: number }[]; // 90%+, 80~90%, 등
  totalStudents: number;
  activeStudents: number;
  dropoutStudents: number;
}

/** 성취도 섹션 데이터 */
export interface AchievementSectionData {
  greenRate: number;
  yellowRate: number;
  redRate: number;
  avgNodeRate: number;
  avgQuestRate: number;
  avgComposite: number;
  signalDistribution: { signal: string; count: number }[];
  totalMatched: number;
}

/** 만족도 섹션 데이터 */
export interface SatisfactionSectionData {
  NPS: number;
  강사만족도: number;
  HRD만족도: number;
  추천의향: number;
  itemScores: { label: string; score: number }[];
}

/** 문의응대 섹션 데이터 */
export interface InquirySectionData {
  totalCount: number;
  channelBreakdown: { channel: string; count: number }[];
  topCategory: string;
  categoryBreakdown: { category: string; count: number }[];
}

/** 하차방어 섹션 데이터 */
export interface DropoutSectionData {
  finalDefenseRate: number;
  totalStudents: number;
  dropoutCount: number;
  earlyEmployment: number;
  targetRate: number;
}

/** 종합 리포트 데이터 */
export interface RetrospectiveReportData {
  filter: RetrospectiveFilter;
  availability: DataAvailability;
  attendance: AttendanceSectionData | null;
  achievement: AchievementSectionData | null;
  satisfaction: SatisfactionSectionData | null;
  inquiry: InquirySectionData | null;
  dropout: DropoutSectionData | null;
  generatedAt: string; // ISO timestamp
}

/** 섹션별 인사이트 */
export interface SectionInsight {
  section: string;
  emoji: string;
  text: string;
  level: "positive" | "neutral" | "negative";
}
```

**Step 2: 커밋**

```bash
git add src/crossAnalysis/retrospectiveTypes.ts
git commit -m "feat: 운영 회고 리포트 타입 정의"
```

---

### Task 2: 데이터 수집 및 집계 모듈

**Files:**
- Create: `src/crossAnalysis/retrospectiveData.ts`

**Step 1: 데이터 수집 + 집계 함수 작성**

이 파일은 5개 데이터 소스에서 선택된 과정/기수에 해당하는 데이터를 수집하고 각 섹션별 구조체로 변환합니다.

```typescript
/**
 * 운영 회고 리포트 데이터 수집 및 집계
 *
 * 5개 데이터 소스 (출결, 성취도, 만족도, 문의응대, 하차방어)에서
 * 선택된 과정/기수에 해당하는 데이터를 수집하고 섹션별로 집계합니다.
 */

import type { AttendanceStudent } from "../hrd/hrdTypes";
import type { UnifiedRecord } from "../hrd/hrdAchievementTypes";
import type { SatisfactionRecord } from "../hrd/hrdSatisfactionTypes";
import type { InquiryRecord } from "../hrd/hrdInquiryTypes";
import { loadAchievementCache, summarizeByTrainee } from "../hrd/hrdAchievementApi";
import { loadSatisfactionCache, summarizeByCohort } from "../hrd/hrdSatisfactionApi";
import { loadInquiryCache, calcInquiryStats } from "../hrd/hrdInquiryApi";
import type {
  RetrospectiveFilter,
  RetrospectiveReportData,
  DataAvailability,
  AttendanceSectionData,
  AchievementSectionData,
  SatisfactionSectionData,
  InquirySectionData,
  DropoutSectionData,
  SectionInsight,
} from "./retrospectiveTypes";

// ── 출결 데이터 로드 ──

async function loadAttendanceStudents(): Promise<AttendanceStudent[]> {
  try {
    const mod = await import("../hrd/hrdAttendance");
    if (typeof mod.getCachedAttendanceStudents === "function") {
      return mod.getCachedAttendanceStudents();
    }
  } catch { /* 미로드 시 무시 */ }
  return [];
}

// ── 과정/기수 필터 유틸 ──

function filterAttendanceByDegrs(
  students: AttendanceStudent[],
  _filter: RetrospectiveFilter,
  selectedDegrs: string[],
): AttendanceStudent[] {
  // 출결 데이터에는 과정/기수 구분이 직접 없으므로
  // 현재 로드된 과정의 학생 전체를 사용 (출결현황 탭에서 과정/기수 선택 후 로드된 상태)
  // 실제로는 getCachedAttendanceStudents()가 마지막 조회된 과정/기수 데이터를 반환
  return students;
}

// ── 섹션별 집계 ──

function buildAttendanceSection(students: AttendanceStudent[]): AttendanceSectionData | null {
  if (students.length === 0) return null;

  const active = students.filter((s) => !s.dropout);
  const dropouts = students.filter((s) => s.dropout);
  const rates = active.map((s) => s.attendanceRate);
  const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  const riskCounts = { danger: 0, warning: 0, caution: 0, safe: 0 };
  for (const s of active) {
    riskCounts[s.riskLevel as keyof typeof riskCounts]++;
  }

  // 결석 Top 3
  const absentTop3 = [...active]
    .sort((a, b) => b.absentDays - a.absentDays)
    .slice(0, 3)
    .map((s) => ({ name: s.name, absentDays: s.absentDays, rate: s.attendanceRate }));

  // 출결률 분포
  const brackets = [
    { label: "90%+", min: 90, max: 101 },
    { label: "80~90%", min: 80, max: 90 },
    { label: "70~80%", min: 70, max: 80 },
    { label: "70% 미만", min: 0, max: 70 },
  ];
  const rateDistribution = brackets.map((b) => ({
    label: b.label,
    count: active.filter((s) => s.attendanceRate >= b.min && s.attendanceRate < b.max).length,
  }));

  const defenseRate = students.length > 0 ? (active.length / students.length) * 100 : 100;

  return {
    avgRate: Math.round(avgRate * 10) / 10,
    defenseRate: Math.round(defenseRate * 10) / 10,
    riskCounts,
    absentTop3,
    rateDistribution,
    totalStudents: students.length,
    activeStudents: active.length,
    dropoutStudents: dropouts.length,
  };
}

function buildAchievementSection(
  records: UnifiedRecord[],
  filter: RetrospectiveFilter,
): AchievementSectionData | null {
  // 선택된 기수에 해당하는 레코드 필터링
  const filtered = records.filter((r) => {
    const matchCourse = !filter.courseName || (r.과정 || "").includes(filter.courseName);
    const matchDegr = filter.selectedDegrs.length === 0 || filter.selectedDegrs.includes(r.기수 || "");
    return matchCourse && matchDegr;
  });
  if (filtered.length === 0) return null;

  const summaries = summarizeByTrainee(filtered, "", "");
  if (summaries.length === 0) return null;

  let green = 0, yellow = 0, red = 0;
  let totalNode = 0, totalQuest = 0, totalNodeSubmit = 0, totalQuestPass = 0;

  for (const s of summaries) {
    if (s.신호등 === "green") green++;
    else if (s.신호등 === "yellow") yellow++;
    else red++;
    totalNode += s.총노드수;
    totalQuest += s.총퀘스트수;
    totalNodeSubmit += s.제출노드수;
    totalQuestPass += s.패스퀘스트수;
  }

  const n = summaries.length;
  const avgNodeRate = totalNode > 0 ? (totalNodeSubmit / totalNode) * 100 : 0;
  const avgQuestRate = totalQuest > 0 ? (totalQuestPass / totalQuest) * 100 : 0;
  const avgComposite = avgNodeRate * 0.4 + avgQuestRate * 0.6;

  return {
    greenRate: Math.round((green / n) * 100 * 10) / 10,
    yellowRate: Math.round((yellow / n) * 100 * 10) / 10,
    redRate: Math.round((red / n) * 100 * 10) / 10,
    avgNodeRate: Math.round(avgNodeRate * 10) / 10,
    avgQuestRate: Math.round(avgQuestRate * 10) / 10,
    avgComposite: Math.round(avgComposite * 10) / 10,
    signalDistribution: [
      { signal: "green", count: green },
      { signal: "yellow", count: yellow },
      { signal: "red", count: red },
    ],
    totalMatched: n,
  };
}

function buildSatisfactionSection(
  records: SatisfactionRecord[],
  filter: RetrospectiveFilter,
): SatisfactionSectionData | null {
  const summaries = summarizeByCohort(records, "", "");
  // 선택된 과정/기수 매칭
  const matched = summaries.filter((s) => {
    const matchCourse = !filter.courseName || s.과정명.includes(filter.courseName);
    const matchDegr = filter.selectedDegrs.length === 0 || filter.selectedDegrs.includes(s.기수);
    return matchCourse && matchDegr;
  });
  if (matched.length === 0) return null;

  // 평균 산출
  const avgNPS = matched.reduce((a, s) => a + s.NPS평균, 0) / matched.length;
  const avg강사 = matched.reduce((a, s) => a + s.강사만족도평균, 0) / matched.length;

  // 나머지 항목은 개별 레코드에서 추출 (있는 경우)
  // summarizeByCohort 결과에서 접근 가능한 항목 사용
  return {
    NPS: Math.round(avgNPS),
    강사만족도: Math.round(avg강사 * 10) / 10,
    HRD만족도: 0, // 향후 확장
    추천의향: 0,   // 향후 확장
    itemScores: [
      { label: "NPS", score: Math.round(avgNPS) },
      { label: "강사만족도", score: Math.round(avg강사 * 10) / 10 },
    ],
  };
}

function buildInquirySection(
  records: InquiryRecord[],
  filter: RetrospectiveFilter,
): InquirySectionData | null {
  // 과정명으로 필터링
  const filtered = records.filter((r) => {
    if (!filter.courseName) return true;
    return (r.과정명 || "").includes(filter.courseName);
  });
  if (filtered.length === 0) return null;

  const stats = calcInquiryStats(filtered);

  const channelBreakdown = Object.entries(stats.채널별)
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  const categoryBreakdown = Object.entries(stats.유형별)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalCount: stats.총건수,
    channelBreakdown,
    topCategory: categoryBreakdown[0]?.category || "-",
    categoryBreakdown,
  };
}

function buildDropoutSection(
  students: AttendanceStudent[],
  filter: RetrospectiveFilter,
): DropoutSectionData | null {
  if (students.length === 0) return null;

  const total = students.length;
  const dropouts = students.filter((s) => s.dropout);
  const active = total - dropouts.length;
  const defenseRate = total > 0 ? (active / total) * 100 : 100;

  // 조기취업 카운트 (dropout 중 상태에 "조기취업" 포함)
  // dropout 상태는 hrdAttendance에서 이미 판정됨, 상세 구분은 어려우므로 0
  const earlyEmployment = 0;

  const targetRate = filter.courseName?.includes("재직자") ? 75 : 85;

  return {
    finalDefenseRate: Math.round(defenseRate * 10) / 10,
    totalStudents: total,
    dropoutCount: dropouts.length,
    earlyEmployment,
    targetRate,
  };
}

// ── 인사이트 생성 ──

export function generateRetrospectiveInsights(data: RetrospectiveReportData): SectionInsight[] {
  const insights: SectionInsight[] = [];

  // 출결 인사이트
  if (data.attendance) {
    const att = data.attendance;
    const level = att.avgRate >= 90 ? "positive" : att.avgRate >= 80 ? "neutral" : "negative";
    insights.push({
      section: "출결",
      emoji: level === "positive" ? "✅" : level === "neutral" ? "⚠️" : "🔴",
      text: `평균 출결률 ${att.avgRate}%. 위험군 ${att.riskCounts.danger + att.riskCounts.warning}명, 주의군 ${att.riskCounts.caution}명.`,
      level,
    });
    if (att.riskCounts.danger > 0) {
      insights.push({
        section: "출결",
        emoji: "🚨",
        text: `제적위험 ${att.riskCounts.danger}명 발생. 결석 최다: ${att.absentTop3[0]?.name || "-"} (${att.absentTop3[0]?.absentDays || 0}일).`,
        level: "negative",
      });
    }
  }

  // 성취도 인사이트
  if (data.achievement) {
    const ach = data.achievement;
    const level = ach.greenRate >= 70 ? "positive" : ach.greenRate >= 50 ? "neutral" : "negative";
    insights.push({
      section: "성취도",
      emoji: level === "positive" ? "🟢" : level === "neutral" ? "🟡" : "🔴",
      text: `Green 비율 ${ach.greenRate}% (${ach.totalMatched}명 중). 노드제출률 ${ach.avgNodeRate}%, 퀘스트패스률 ${ach.avgQuestRate}%.`,
      level,
    });
  }

  // 만족도 인사이트
  if (data.satisfaction) {
    const sat = data.satisfaction;
    const level = sat.NPS >= 50 ? "positive" : sat.NPS >= 0 ? "neutral" : "negative";
    insights.push({
      section: "만족도",
      emoji: level === "positive" ? "😊" : level === "neutral" ? "😐" : "😞",
      text: `NPS ${sat.NPS}점, 강사만족도 ${sat.강사만족도}/5.0.`,
      level,
    });
  }

  // 문의응대 인사이트
  if (data.inquiry) {
    const inq = data.inquiry;
    insights.push({
      section: "문의응대",
      emoji: "💬",
      text: `총 ${inq.totalCount}건 응대. 주요 유형: ${inq.topCategory}. 채널: ${inq.channelBreakdown[0]?.channel || "-"}(${inq.channelBreakdown[0]?.count || 0}건).`,
      level: "neutral",
    });
  }

  // 하차방어 인사이트
  if (data.dropout) {
    const dr = data.dropout;
    const level = dr.finalDefenseRate >= dr.targetRate ? "positive" : "negative";
    insights.push({
      section: "하차방어",
      emoji: level === "positive" ? "🛡️" : "⚠️",
      text: `하차방어율 ${dr.finalDefenseRate}% (목표 ${dr.targetRate}%). 하차 ${dr.dropoutCount}명 / 전체 ${dr.totalStudents}명.`,
      level,
    });
  }

  return insights;
}

// ── 메인 데이터 수집 함수 ──

export async function collectRetrospectiveData(
  filter: RetrospectiveFilter,
): Promise<RetrospectiveReportData> {
  // 병렬 데이터 로드
  const [attendanceStudents, achievementRecords, satisfactionRecords, inquiryRecords] =
    await Promise.all([
      loadAttendanceStudents(),
      Promise.resolve(loadAchievementCache() ?? []),
      Promise.resolve(loadSatisfactionCache() ?? []),
      Promise.resolve(loadInquiryCache() ?? []),
    ]);

  const availability: DataAvailability = {
    attendance: attendanceStudents.length > 0,
    achievement: (achievementRecords as UnifiedRecord[]).length > 0,
    satisfaction: (satisfactionRecords as SatisfactionRecord[]).length > 0,
    inquiry: (inquiryRecords as InquiryRecord[]).length > 0,
    dropout: attendanceStudents.length > 0, // 출결 데이터에서 파생
  };

  return {
    filter,
    availability,
    attendance: buildAttendanceSection(attendanceStudents),
    achievement: buildAchievementSection(achievementRecords as UnifiedRecord[], filter),
    satisfaction: buildSatisfactionSection(satisfactionRecords as SatisfactionRecord[], filter),
    inquiry: buildInquirySection(inquiryRecords as InquiryRecord[], filter),
    dropout: buildDropoutSection(attendanceStudents, filter),
    generatedAt: new Date().toISOString(),
  };
}
```

**Step 2: 커밋**

```bash
git add src/crossAnalysis/retrospectiveData.ts
git commit -m "feat: 운영 회고 리포트 데이터 수집/집계 모듈"
```

---

### Task 3: HTML 서브탭 + 리포트 패널 추가

**Files:**
- Modify: `src/index.html:2471-2474` (서브탭 바에 버튼 추가)
- Modify: `src/index.html:2599` (기수 교차분석 패널 뒤에 회고 패널 추가)

**Step 1: 서브탭 바에 "운영 회고 리포트" 버튼 추가**

`src/index.html` 라인 2473 뒤에 추가:
```html
<button class="sub-tab" id="crossTabRetrospective" data-cross-tab="retrospective">운영 회고 리포트</button>
```

**Step 2: 기수 교차분석 패널 닫는 div (라인 2599) 뒤에 회고 패널 HTML 추가**

```html
<!-- ── 운영 회고 리포트 패널 ── -->
<div id="crossPanelRetrospective" class="sub-tab-panel" style="display:none">
  <!-- 필터 -->
  <div class="filter-bar" style="flex-wrap:wrap;gap:8px;align-items:flex-start">
    <select id="retroFilterCourse"><option value="">과정 선택</option></select>
    <div id="retroDegrCheckboxes" class="retro-degr-checkboxes" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
      <!-- JS에서 동적 생성 -->
    </div>
    <button class="btn btn-primary" id="retroGenerateBtn">리포트 생성</button>
    <button class="btn btn-secondary" id="retroPdfBtn" style="display:none">PDF 내보내기</button>
  </div>
  <p id="retroStatus" class="section-desc"></p>

  <!-- 리포트 영역 -->
  <div id="retroReportContainer" style="display:none">
    <!-- 헤더 -->
    <div class="retro-header card">
      <h3 id="retroTitle" class="card-title"></h3>
      <p id="retroSubtitle" class="section-desc"></p>
    </div>

    <!-- ① 출결 현황 -->
    <div id="retroSectionAttendance" class="retro-section card">
      <h3 class="card-title">📋 출결 현황</h3>
      <div class="stat-cards" id="retroAttendanceStats"></div>
      <div class="cross-charts-grid">
        <div><canvas id="retroAttDistChart" height="250"></canvas></div>
        <div><canvas id="retroRiskDonut" height="250"></canvas></div>
      </div>
      <div class="retro-insight" id="retroAttendanceInsight"></div>
    </div>

    <!-- ② 학업성취도 -->
    <div id="retroSectionAchievement" class="retro-section card">
      <h3 class="card-title">📚 학업성취도</h3>
      <div class="stat-cards" id="retroAchievementStats"></div>
      <div class="cross-charts-grid">
        <div><canvas id="retroSignalDonut" height="250"></canvas></div>
        <div><canvas id="retroNodeQuestBar" height="250"></canvas></div>
      </div>
      <div class="retro-insight" id="retroAchievementInsight"></div>
    </div>

    <!-- ③ 만족도 -->
    <div id="retroSectionSatisfaction" class="retro-section card">
      <h3 class="card-title">😊 만족도</h3>
      <div class="stat-cards" id="retroSatisfactionStats"></div>
      <div style="max-width:500px;margin:0 auto"><canvas id="retroNpsBar" height="250"></canvas></div>
      <div class="retro-insight" id="retroSatisfactionInsight"></div>
    </div>

    <!-- ④ 문의응대 -->
    <div id="retroSectionInquiry" class="retro-section card">
      <h3 class="card-title">💬 문의응대</h3>
      <div class="stat-cards" id="retroInquiryStats"></div>
      <div style="max-width:500px;margin:0 auto"><canvas id="retroChannelDonut" height="250"></canvas></div>
      <div class="retro-insight" id="retroInquiryInsight"></div>
    </div>

    <!-- ⑤ 하차방어 -->
    <div id="retroSectionDropout" class="retro-section card">
      <h3 class="card-title">🛡️ 하차방어</h3>
      <div class="stat-cards" id="retroDropoutStats"></div>
      <div class="retro-insight" id="retroDropoutInsight"></div>
    </div>

    <!-- ⑥ 종합 요약 -->
    <div id="retroSectionSummary" class="retro-section card">
      <h3 class="card-title">📊 종합 요약</h3>
      <div style="max-width:500px;margin:0 auto"><canvas id="retroSummaryRadar" height="350"></canvas></div>
      <div id="retroInsightsList" class="retro-insights-list"></div>
    </div>
  </div>
</div>
```

**Step 3: 커밋**

```bash
git add src/index.html
git commit -m "feat: 운영 회고 리포트 HTML 패널 추가"
```

---

### Task 4: 메인 초기화 + 렌더링 + PDF 모듈

**Files:**
- Create: `src/crossAnalysis/retrospectiveInit.ts`

**Step 1: 초기화 + 렌더링 + PDF 내보내기 작성**

이 파일의 핵심 구조:

1. `initRetrospective()` — 과정 드롭다운 채우기, 기수 체크박스 동적 생성, 이벤트 바인딩
2. `generateReport()` — `collectRetrospectiveData()` 호출 후 각 섹션 렌더링
3. `renderSection*()` — 각 섹션별 KPI 카드 + Chart.js 차트 + 인사이트 렌더링
4. `exportPdf()` — Chart.js → base64 변환 후 window.print() HTML 조립

핵심 패턴:
- 데이터 없는 섹션: "데이터 없음" 카드 + 차트 숨김
- 데이터 있는 섹션: KPI 카드 + 차트 + 인사이트 강조
- Chart.js 인스턴스는 배열로 관리, 리포트 재생성 시 전부 destroy

```typescript
// 주요 함수 시그니처 (전체 구현은 Step 1에서)

export function initRetrospective(): void
// - 과정 드롭다운 채우기 (loadHrdConfig().courses에서)
// - 과정 변경 시 기수 체크박스 동적 생성 (전체 선택 토글 포함)
// - "리포트 생성" 버튼 → generateReport()
// - "PDF 내보내기" 버튼 → exportPdf()

async function generateReport(): Promise<void>
// - 선택된 과정/기수 수집
// - collectRetrospectiveData(filter) 호출
// - 6개 섹션 렌더링
// - 인사이트 생성 + 렌더링
// - PDF 버튼 표시

function renderEmptySection(sectionId: string): void
// - "데이터가 부족하여 분석을 생략합니다" 표시
// - 차트 canvas 숨김

function renderAttendanceSection(data: AttendanceSectionData): void
function renderAchievementSection(data: AchievementSectionData): void
function renderSatisfactionSection(data: SatisfactionSectionData): void
function renderInquirySection(data: InquirySectionData): void
function renderDropoutSection(data: DropoutSectionData): void
function renderSummarySection(data: RetrospectiveReportData): void

function exportPdf(data: RetrospectiveReportData): void
// - kpiPdf.ts 패턴 따름: offscreen canvas → Chart.js → base64
// - 6개 섹션 HTML 조립 (인라인 스타일)
// - 새 창 열기 + window.print()
```

**Step 2: 커밋**

```bash
git add src/crossAnalysis/retrospectiveInit.ts
git commit -m "feat: 운영 회고 리포트 렌더링 + PDF 내보내기 모듈"
```

---

### Task 5: crossAnalysisInit.ts에 서브탭 연결

**Files:**
- Modify: `src/crossAnalysis/crossAnalysisInit.ts:65-79` (setupSubTabs 함수)

**Step 1: setupSubTabs에 retrospective 패널 토글 추가**

기존 setupSubTabs()에서 `crossPanelRetrospective` 패널 표시/숨김 처리 + retrospective 탭 클릭 시 lazy init 호출.

```typescript
// setupSubTabs() 수정: 3개 패널 토글
function setupSubTabs(): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>("[data-cross-tab]");
  let retroInitialized = false;

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.crossTab;
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const studentPanel = $("crossPanelStudent");
      const cohortPanel = $("crossPanelCohort");
      const retroPanel = $("crossPanelRetrospective");
      if (studentPanel) studentPanel.style.display = target === "student" ? "" : "none";
      if (cohortPanel) cohortPanel.style.display = target === "cohort" ? "" : "none";
      if (retroPanel) retroPanel.style.display = target === "retrospective" ? "" : "none";

      // lazy init: 처음 열 때만 초기화
      if (target === "retrospective" && !retroInitialized) {
        retroInitialized = true;
        const { initRetrospective } = await import("./retrospectiveInit");
        initRetrospective();
      }
    });
  });
}
```

**Step 2: 커밋**

```bash
git add src/crossAnalysis/crossAnalysisInit.ts
git commit -m "feat: 교차분석 서브탭에 운영 회고 리포트 연결"
```

---

### Task 6: CSS 스타일 추가

**Files:**
- Modify: `src/style.css` (하단에 운영 회고 리포트 전용 스타일 추가)

**Step 1: 회고 리포트 전용 CSS 추가**

```css
/* ── 운영 회고 리포트 ── */
.retro-degr-checkboxes label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--surface-hover);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.retro-degr-checkboxes label:hover {
  background: var(--primary-light);
}
.retro-degr-checkboxes input[type="checkbox"]:checked + span {
  font-weight: 600;
  color: var(--primary);
}
.retro-section {
  margin-top: 16px;
}
.retro-section[data-empty="true"] {
  opacity: 0.5;
}
.retro-section[data-empty="true"] .cross-charts-grid,
.retro-section[data-empty="true"] canvas {
  display: none;
}
.retro-insight {
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--surface-hover);
  border-radius: 8px;
  border-left: 4px solid var(--primary);
  font-size: 14px;
  line-height: 1.6;
}
.retro-insight[data-level="positive"] { border-left-color: #22c55e; }
.retro-insight[data-level="negative"] { border-left-color: #ef4444; }
.retro-insights-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.retro-header {
  text-align: center;
  padding: 24px;
}
```

**Step 2: 커밋**

```bash
git add src/style.css
git commit -m "feat: 운영 회고 리포트 CSS 스타일"
```

---

### Task 7: 통합 테스트 + 빌드 검증

**Step 1: 빌드 확인**

```bash
npm run build
```

Expected: 빌드 성공, retrospectiveInit chunk 생성

**Step 2: dev 서버에서 확인**

1. 교차분석 탭 → "운영 회고 리포트" 서브탭 클릭
2. 과정 드롭다운에서 과정 선택 → 기수 체크박스 표시 확인
3. 기수 선택 후 "리포트 생성" → 각 섹션 렌더링 확인
4. 데이터 없는 섹션 graceful degradation 확인
5. "PDF 내보내기" → 새 창 열림 + 인쇄 대화상자 확인

**Step 3: 최종 커밋**

```bash
git add -A
git commit -m "feat: 운영 회고 리포트 통합 완료"
```

---

## 파일 요약

| 파일 | 액션 | 설명 |
|------|------|------|
| `src/crossAnalysis/retrospectiveTypes.ts` | 생성 | 타입 정의 |
| `src/crossAnalysis/retrospectiveData.ts` | 생성 | 데이터 수집/집계/인사이트 |
| `src/crossAnalysis/retrospectiveInit.ts` | 생성 | UI 렌더링 + PDF 내보내기 |
| `src/index.html` | 수정 | 서브탭 버튼 + 리포트 패널 HTML |
| `src/crossAnalysis/crossAnalysisInit.ts` | 수정 | setupSubTabs에 3번째 탭 연결 |
| `src/style.css` | 수정 | 회고 리포트 전용 CSS |
