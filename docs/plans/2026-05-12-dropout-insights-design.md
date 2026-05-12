# 하차방어율 개선 인사이트 — 설계 문서

**작성일**: 2026-05-12  
**작성자**: 박찬홍 + Claude  
**배경**: 그룹회의 피드백 — "대시보드 도입으로 어떻게 개선되었는지", "관리할 수 있는 지표"가 명확히 보여야 한다. 현재 하차방어율 탭이 복잡/불명확하다는 의견.

## 목표

기존 하차방어율 탭 ([index.html:1544](../../src/index.html)) 최상단에 **"개선 인사이트" 섹션** 신설.  
회의 청중과 운영 매니저 양쪽 모두를 만족시키는 단일 화면.

## 결정 사항

| 항목 | 결정 | 사유 |
|------|------|------|
| **청중** | C — 임팩트 카드 + 액션 패널 통합 | 회의·운영 양쪽 만족 |
| **비교 단위** | A 기수(코호트) primary + B 시계열 데이터 기반 동시 마련 | KDT 기수 단위 운영, 표본 누적 후 시계열 확장 |
| **cutoff 분류** | A+B 조합: 사용자 단일 날짜 입력 → `startDate >= cutoff`면 "도입 후" 자동 분류 | 단순·자동화·조정 자유 |
| **cutoff default** | `2026-03-01` (설정 탭에서 조정 가능) | 본격 활용 시작 시점 |
| **Leading 지표** | 4개 — 위험군 회복률, 신규 위험군 발생률, 연속결석 끊기 성공률, NPS 평균 변화 | 액션 가능성 + 데이터 가용성 |

## 화면 레이아웃

```
┌── 📈 개선 인사이트 (대시보드 도입 효과) ────────────────┐
│  cutoff: 2026-03-01 [수정] | 도입 후 N기수 / 전 M기수    │
├─────────────────────────────────────────────────────────┤
│ ╔═══ Hero Card ════════════════════════════════════╗    │
│ ║   방어율 78% → 92%  (+14p)                       ║    │
│ ║   📊 NPS 보조: +18  강사만족도: +0.3             ║    │
│ ║   💡 추정 절감 하차 인원: 약 N명                 ║    │
│ ║   ⚠️ 표본 N: 도입 후 3기수 / 도입 전 4기수       ║    │
│ ╚══════════════════════════════════════════════════╝    │
│                                                         │
│ Leading 미니 카드 4개:                                  │
│ ┌─────────┬─────────┬─────────┬─────────┐               │
│ │ 위험군  │ 신규    │ 연속결석│ NPS     │               │
│ │ 회복률  │ 위험군  │ 끊기    │ 평균    │               │
│ │ 65%↑    │ 22%↓    │ 78%↑    │ +18 ↑   │               │
│ │ vs 42%  │ vs 35%  │ vs 55%  │ vs +12  │               │
│ └─────────┴─────────┴─────────┴─────────┘               │
│                                                         │
│ ▶ 시계열 추이 보기 (펼치기 — Phase 2 기반)              │
│ ⚠️ 만족도 누락 기수: 재직자기획/개발4기 (NPS 미입력)    │
└─────────────────────────────────────────────────────────┘
```

## 데이터 layer

### 신규: `src/hrd/hrdDropoutInsights.ts`

```ts
// cutoff 설정
export const INSIGHTS_CONFIG_KEY = "kdt_dropout_insights_config_v1";
export interface DropoutInsightsConfig { cutoffDate: string; }
export function loadInsightsConfig(): DropoutInsightsConfig;
export function saveInsightsConfig(c: DropoutInsightsConfig): void;

// 분류
export function classifyCohort(
  entry: { startDate: string },
  cutoff: string,
): "before" | "after" | "unknown";

// 임팩트 (Hero 카드)
export interface ImpactMetrics {
  beforeAvgRate: number;
  afterAvgRate: number;
  deltaPp: number;
  beforeN: number;     // 기수 수
  afterN: number;
  beforeTotalStudents: number;
  afterTotalStudents: number;
  estimatedSavedHeadcount: number; // (deltaPp/100) * afterTotalStudents
}
export function computeImpactMetrics(
  entries: DropoutRosterEntry[],
  cutoff: string,
): ImpactMetrics;

// Leading 지표 4개
export interface LeadingMetric {
  label: string;
  beforeValue: number;
  afterValue: number;
  delta: number;
  unit: "%" | "p" | "건";
  betterDirection: "up" | "down"; // 개선 방향
  beforeN: number;
  afterN: number;
}
export interface LeadingMetrics {
  riskRecovery: LeadingMetric;       // 위험군 회복률 (up이 좋음)
  riskOccurrence: LeadingMetric;     // 신규 위험군 발생률 (down이 좋음)
  consecAbsentBreak: LeadingMetric;  // 연속결석 끊기 (up이 좋음)
  npsChange: LeadingMetric;          // NPS 평균 (up이 좋음)
}
export function computeLeadingMetrics(
  dropoutEntries: DropoutRosterEntry[],
  analysisData: TraineeAnalysis[],
  satRecords: SatisfactionRecord[],
  cutoff: string,
): LeadingMetrics;

// 시계열 (Phase 2 — 토글 펼치기)
export interface TrendPoint { month: string; defenseRate: number; cohortCount: number; }
export function computeMonthlyTrend(
  entries: DropoutRosterEntry[],
): TrendPoint[];

// 진단
export interface InsightsDiagnostics {
  beforeCohorts: string[];   // "재직자LLM4기" 형태
  afterCohorts: string[];
  missingNpsCohorts: string[]; // NPS 매칭 실패
  insufficientSample: boolean; // before<2 또는 after<2 일 때 true
  warnings: string[];
}
export function buildDiagnostics(...): InsightsDiagnostics;
```

### 계산 정의

| 지표 | 계산식 |
|------|--------|
| **방어율 평균** | cohort별 `defenseRate` 단순평균 (총 인원 가중평균은 작은 cohort 묻힘 방지) |
| **위험군 회복률** | cohort별: `maxConsecutiveAbsent>=3 학생 중 dropout=false 비율` 평균 |
| **신규 위험군 발생률** | cohort별: `maxConsecutiveAbsent>=3 학생 / 전체 학생` 평균 |
| **연속결석 끊기 성공률** | cohort별: `maxConsecutiveAbsent>=5 학생 중 dropout=false 비율` 평균 |
| **NPS 평균 변화** | cohort별 NPS평균을 다시 평균 (응답수 가중X — 단순화) |
| **추정 절감 인원** | `(deltaPp/100) * 도입 후 총 학생 수` — "현재 운영 규모에서 N명 더 살림" |

### 조인 키 정규화

`crossAnalysisData.ts:204-211` 패턴 그대로:
- 만족도 시트: `과정명="재직자LLM"` + `기수="5기"`
- DropoutRosterEntry: `courseName="재직자LLM5기"` + `degr="5"`
- 정규화: courseName에서 `\d+기$` 분리하거나, 만족도쪽에 `${과정명}${기수}` 결합 후 매칭

## 신규 + 수정 파일

| 종류 | 파일 | 역할 |
|------|------|------|
| 🆕 | `src/hrd/hrdDropoutInsights.ts` | 계산 로직 |
| 🆕 | `src/hrd/hrdDropoutInsightsView.ts` | DOM 렌더링 |
| 🆕 | `tests/hrdDropoutInsights.test.ts` | 모든 계산 함수 단위테스트 |
| ✏️ | `src/index.html` | `#sectionDropoutInsights` 섹션 + 설정 탭 cutoff 입력 |
| ✏️ | `src/hrd/hrdDropout.ts` | `renderDropoutInsights()` 호출 — 전체조회 후 자동 |
| ✏️ | `src/hrd/hrdConfig.ts` | (필요 시) cutoff load/save 헬퍼 export |
| ✏️ | `src/hrd/settingsInit.ts` | cutoff 입력 UI 바인딩 |
| ✏️ | `src/style.css` | `.di-hero`, `.di-mini-card`, `.di-trend` 등 |

## 회귀 방지 체크리스트

- [ ] 기존 하차방어율 탭 7개 detail 탭 (course/degr/yearly/employed/unemployed/monthly/weekly) 동작 확인
- [ ] 기존 하차방어율 차트 4개 정상 렌더 (course/heatmap/risk-top10/degr-trend)
- [ ] 출결확인 강사 모드 미영향 (관계 없음)
- [ ] 주간보고팩 Page 4 (이전 작업) 미영향 (`crossAnalysisData.ts`만 import할 뿐 수정 X)
- [ ] 만족도 데이터 0건일 때 NPS 카드 정상 처리 (skeleton/dash)
- [ ] cutoff 미설정 default `2026-03-01` 적용
- [ ] 모든 신규 코드에 한국어 주석, camelCase, `as const` 패턴
- [ ] 기존 테스트 148개 통과
- [ ] 신규 테스트 추가
- [ ] 빌드 통과 (`npm run build`)

## Phase 2 (이번 작업 외)

- 시계열 라인 차트 실제 렌더링 (지금은 데이터만 마련)
- NPS-방어율 산점도 (#8)
- NPS 위험구간(<-30) 기수 비율 (#9)
- SMS 발송 → 출석 회복률 (#5) — SMS timestamp 데이터 가용성 확인 후
- 기존 7개 detail 탭 통폐합 (피드백의 "복잡함" 정리)
