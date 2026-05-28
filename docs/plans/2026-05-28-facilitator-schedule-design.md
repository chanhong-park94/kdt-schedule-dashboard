# 교퍼팀 일정 통합 설계서 — 학사일정 sub-tab

작성일: 2026-05-28
출처: https://ee-aicampus.netlify.app/ (v7-L)

## 1. 배경

교육퍼실리테이터(EE) 팀이 자체 제작·운영하는 일정 대시보드. 우리 학사일정 페이지 안에서 함께 확인할 수 있도록 통합.

## 2. 의사결정 요약

| 항목 | 선택 |
|---|---|
| 통합 방식 | **B. 정적 데이터 복제 + 자체 렌더링** |
| 가져올 섹션 | 4개 모두 (오늘 업무 / 이번 주 일정 / 간트차트 / 인력별 현황) |
| 배치 | **학사일정 페이지 내 sub-tab** (기본 타임라인 ↔ 교퍼팀 일정) |
| 동기화 | 정적 임베드 + "🔄 업데이트 확인" 버튼 (외부 fetch → 차이 비교) |

## 3. 외부 데이터 모델

```ts
interface FacilitatorPhase {
  ph: "P1" | "P2" | "P3(365)";
  s: string; // "2026-02-20"
  e: string;
  person: string;
}
interface FacilitatorCourse {
  name: string;          // "리서처 17기"
  type: "리서처" | "엔지니어" | "AI데이터" | "AI에이전트" | "피지컬AI" | "프라이빗AI" | "데싸" | "프데분";
  section: "existing" | "new";
  phases: FacilitatorPhase[];
}
interface FacilitatorData {
  courses: FacilitatorCourse[];        // 27개
  colors: Record<string, [string, string]>;  // 담당자 → [bg, fg]
  pairs: { title; sub; color; p1; p2 }[];
  holidays: string[];                   // 2026~2028 공휴일
  personOrder: string[];                // 15명
  skipPersons: string[];                // 인력별 현황에서 숨길 대상
}
```

현재 데이터: 27개 과정, P1/P2/P3 페이즈별 담당자 매핑, 2026.2~2027.7 기간.

## 4. 파일 구조

```
src/timeline/
├── facilitatorData.ts       # 정적 const DATA + version/fetchedAt
├── facilitatorStorage.ts    # localStorage 헬퍼 (마지막 확인 시각·차이 캐시)
├── facilitatorSync.ts       # 외부 사이트 fetch + diff 비교
├── facilitatorView.ts       # 4개 섹션 렌더 + 업데이트 확인 버튼
└── facilitatorInit.ts       # sub-tab lazy 진입점
```

## 5. UX 흐름

### 학사일정 페이지 진입 시
- 상단에 sub-tab pill: `🏠 기본 타임라인` ↔ `👥 교퍼팀 일정`
- 마지막 선택은 localStorage(`kdt_timeline_subtab_v1`) 기억

### 교퍼팀 sub-tab 활성화 시
```
┌─ 헤더 ─────────────────────────────────────────────────┐
│ 👥 교퍼팀 일정 (AI Campus 2026 v7-L)    [🔄 업데이트 확인] │
│ 출처: ee-aicampus.netlify.app · 마지막 동기화 N일 전     │
└──────────────────────────────────────────────────────────┘
┌─ 오늘의 업무 현황 ─┐
│ 진행 카드 N개 (담당자·과정·페이즈·진행률) │
└─────────────────────┘
┌─ 이번 주 주요 일정 ─┐
│ 시작/종료 이벤트 chip │
└──────────────────────┘
┌─ 과정별 간트차트 ───────────────────────────┐
│ 27개 과정 × P1/P2/P3 타임라인               │
└──────────────────────────────────────────────┘
┌─ 인력별 현황 ─────────────────────────────────┐
│ 담당자 15명 × 담당 과정 + 기간 (겹침 식별)    │
└────────────────────────────────────────────────┘
```

### 업데이트 확인 버튼
1. 클릭 → `fetch('https://ee-aicampus.netlify.app/')` (CORS 허용 가정)
2. HTML에서 `const DATA = (.+);` 정규식 추출
3. 우리 정적 데이터(`facilitatorData.ts`)와 비교
4. 결과 토스트/배너:
   - 일치: "✓ 최신 상태입니다"
   - 차이: "변경 발견 — 과정 +N / 변경 N / 삭제 N. 코드 PR로 영구 반영 필요"
5. CORS 실패 → "외부 사이트 직접 열기" 링크 + 안내

## 6. 동기화 전략

| 시점 | 동작 |
|---|---|
| 빌드 시점 | 정적 데이터(`facilitatorData.ts`)에서 가져옴 — 항상 동작 |
| 사용자 클릭 시 | 외부 fetch → diff만 보고. 코드 자체는 변경 X |
| 영구 반영 | 운영자가 `npm run sync:facilitator` 또는 직접 `facilitatorData.ts` 수정 후 PR (1차에는 수동) |

## 7. 알고리즘

### 오늘의 업무
```ts
const today = new Date(); today.setHours(0,0,0,0);
courses.flatMap(c => c.phases
  .filter(ph => parseDate(ph.s) <= today && today <= parseDate(ph.e))
  .map(ph => ({
    course: c.name, type: c.type, phase: ph.ph, person: ph.person,
    total: countBusinessDays(ph.s, ph.e),
    done: countBusinessDays(ph.s, today),
    pct: done / total * 100,
  })))
```

### 이번 주 주요 일정
- 월~일 기준, 시작/종료/페이즈 변경 이벤트 추출

### 간트차트
- 기간: 2026-02-01 ~ 2027-08-01 (외부 사이트 기본 범위, 가로 스크롤)
- 각 row = 과정, 그 안에 P1/P2/P3 막대 (담당자 색상)

### 인력별 현황
- `personOrder` 순서대로 row
- 각 row에 담당 과정·페이즈 시간순 나열
- 같은 일자에 두 과정 담당 시 빨간 표시 (overlap)

## 8. CSS 전략

- 외부 사이트는 `font-size: 12px` 기준. 우리 디자인은 보통 14px. 우리 기준으로 맞춤.
- 외부 색상 팔레트는 그대로 유지 (담당자별 색상은 식별용)
- CSS 변수 사용 (`--card-bg`, `--text`, `--border`, `--surface-hover`)
- 모바일: 간트차트는 가로 스크롤, 다른 섹션은 그리드 1단

## 9. YAGNI

- 자체 staffingCells와 자동 통합 (별도 데이터 소스)
- 변경 시 자동 코드 PR
- 실시간 polling
- 인력별 현황의 자동 충돌 검출은 외부에 있는 것만 (추가 안 함)
- 간트차트 줌·드래그

## 10. 검증 계획

| 항목 | 방법 |
|---|---|
| 빌드 | `npm run build` 통과 |
| sub-tab | 클릭 시 두 화면 전환 + localStorage 기억 |
| 오늘 업무 | 오늘 진행 중 페이즈 수 = 외부 사이트와 동일 |
| 이번 주 일정 | 월~일 이벤트 = 외부 사이트와 동일 |
| 간트차트 | 27개 과정 × P1/P2/P3 막대 정상 렌더 |
| 인력별 현황 | 담당자 15명 × 담당 과정 시간순 |
| 업데이트 확인 | 변경 없는 경우 "최신 상태" / fetch 실패 시 안내 |

## 11. 패치노트 v3.10.0

- 학사일정 페이지 sub-tab 신설 (기본 ↔ 교퍼팀)
- 교퍼팀 4개 섹션(오늘·주간·간트·인력) 통합
- 업데이트 확인 버튼 — 외부 사이트 diff 비교
- 데이터 27개 과정 × 15명 담당자
