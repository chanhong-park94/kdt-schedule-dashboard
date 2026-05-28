# 운영지침 매뉴얼 v2 설계서 — 카테고리 탭형 + 즐겨찾기 + 메모 + 출처 필터

작성일: 2026-05-28
이전 설계: `2026-05-26-kdt-guideline-page-design.md`

## 1. 배경

v1 출시 후 운영자 피드백:
1. 113개 카드가 한 페이지 세로 흐름 → **스크롤 5,000~6,000px**, 인지 부하 큼
2. 자주 보는 항목을 **표시할 수단 없음** — 매번 검색·스크롤 반복
3. 항목별 **개인 메모 부재** — 외부 노트 앱에 따로 정리해야 함

## 2. 결정 사항

| 영역 | 선택 옵션 |
|---|---|
| 정리 방식 | **A. 카테고리 탭형** — 한 번에 한 카테고리만 표시 |
| 즐겨찾기 | **A. 사이드바 맨 위 ⭐ 가상 카테고리** + 카드별 ⭐ 토글 |
| 메모 | **A. 카드 펼친 안 인라인 textarea** + 자동 저장 |
| 추가 | **출처 필터 칩 3개** (운영지침 PDF / 내배카 규정 / 직능 규정) |

## 3. UX 변경

### 사이드바 (변경)
```
⭐ 내 즐겨찾기 (N)    ← 신규 (0건이면 0 표시)
──────────────
1. 사업 개요
2. 훈련과정 선정
…
14. 직능 운영규정
```

### 메인 영역
- 검색어 없을 때: **활성 카테고리 한 개만 렌더**
- 검색어 있을 때: 출처 필터를 통과한 전 카테고리에서 매칭 결과 렌더 (현재 동작 유지)
- ⭐ 가상 카테고리 활성 시: 즐겨찾기에 추가된 카드만 표시

### 검색창 아래 (신규)
```
🔍 [검색창]                            검색 결과 N건
빠른 검색: 출석률 · 훈련장려금 …
출처: [📕 운영지침] [⚖️ 내배카 규정] [📜 직능 규정]   ← 신규
```

### 카드 (변경)
- 헤더 우측에 **⭐ 토글 버튼** 추가
- 펼친 영역 본문·태그 아래에 **📝 내 메모** textarea + "✓ 자동 저장됨" 표시

## 4. 데이터 모델

### localStorage 키
```ts
"kdt_guideline_favorites_v1": string[]                       // 카드 id 배열
"kdt_guideline_notes_v1": Record<string, string>              // id → 메모
"kdt_guideline_source_filter_v1": { manual; nbc; voc: boolean } // 출처 필터
```

### 출처 분류 (기존 category 활용)
```ts
const SOURCE_OF_CATEGORY: Record<GuidelineCategory, "manual" | "nbc" | "voc"> = {
  overview: "manual", selection: "manual", contract: "manual",
  contractChange: "manual", trainee: "manual", execution: "manual",
  attendance: "manual", payment: "manual", reporting: "manual",
  supervision: "manual", shortTerm: "manual", annex: "manual",
  regulationNbc: "nbc",
  regulationVoc: "voc",
};
```

### 가상 카테고리 `favorites`
- `GuidelineCategory` enum에 추가하지 않고 view 상태로만 처리
- `viewState.activeCategory: GuidelineCategory | "favorites"`
- 즐겨찾기 0건이면 "⭐ 아이콘으로 자주 보는 항목을 추가하세요" 안내

## 5. 파일 구조

```
src/guideline/
├── guidelineData.ts          # 변경 없음 (113개 항목 그대로)
├── guidelineStorage.ts       # 신규 — localStorage CRUD 헬퍼
├── guidelineSearch.ts        # 출처 필터 인자 추가
├── guidelineView.ts          # 큰 폭 개편
├── guidelineQuickSearch.ts   # 변경 없음
└── guidelineInit.ts          # 변경 없음
```

## 6. guidelineStorage.ts (신규)

```ts
const FAV_KEY = "kdt_guideline_favorites_v1";
const NOTES_KEY = "kdt_guideline_notes_v1";
const FILTER_KEY = "kdt_guideline_source_filter_v1";

export type GuidelineSource = "manual" | "nbc" | "voc";

export function loadFavorites(): Set<string>;
export function isFavorite(id: string): boolean;
export function toggleFavorite(id: string): boolean; // returns new state
export function loadNote(id: string): string;
export function saveNote(id: string, text: string): void;
export function loadAllNotes(): Record<string, string>;
export function loadSourceFilter(): Record<GuidelineSource, boolean>;
export function saveSourceFilter(filter: Record<GuidelineSource, boolean>): void;
export function getSourceOfCategory(cat: GuidelineCategory): GuidelineSource;
```

## 7. 검색 동작 (변경)

```ts
searchGuideline(query, sections, sourceFilter)
  → sections.filter(s => sourceFilter[sourceOf(s.id)]).map(filter items by tokens)
```

- 출처 필터에 의해 활성화된 출처의 섹션만 검색 대상
- 검색어 없을 때:
  - `activeCategory === "favorites"` → favorites set의 카드만, 전 카테고리 가로질러
  - 그 외 → 활성 카테고리 1개만, 출처 필터는 사이드바에도 적용 (필터 꺼진 출처의 카테고리는 사이드바 회색·비활성화)

## 8. 메모 자동 저장

```ts
const noteDebounce = new Map<string, number>();

function handleNoteInput(id: string, value: string) {
  if (noteDebounce.has(id)) window.clearTimeout(noteDebounce.get(id)!);
  noteDebounce.set(id, window.setTimeout(() => {
    saveNote(id, value);
    updateSavedIndicator(id);
  }, 500));
}
```

## 9. 마이그레이션

- localStorage 키는 모두 신규(`_v1`) — 기존 사용자에게 영향 없음 (초기값 모두 빈/true)
- v6 → v7 사이드바 메뉴 마이그레이션은 v1에서 이미 처리됨, 추가 마이그레이션 불필요

## 10. YAGNI

- 즐겨찾기 폴더 분류 / 색상 라벨
- 메모 검색 (지금은 본문·태그에서만 검색)
- 즐겨찾기·메모 Supabase 동기화 (1차에는 localStorage만)
- 카드 공유 URL anchor (다음 라운드)
- 인쇄 모드 (다음 라운드)

## 11. 검증 계획

| 항목 | 방법 |
|---|---|
| 빌드 | `npm run build` 통과 |
| 카테고리 탭형 | 사이드바 클릭 시 다른 카테고리 hide |
| ⭐ 즐겨찾기 | 토글 → 사이드바 카운트 변경 → 탭 클릭 시 즐겨찾기만 |
| 📝 메모 | textarea 입력 → 500ms 후 "✓ 자동 저장됨" → 새로고침 후 유지 |
| 출처 필터 | 칩 OFF 시 해당 출처의 카테고리·검색 결과 제외 |
| 모바일 | 사이드바 가로 chip + 검색·필터 sticky |

## 12. 패치노트 v3.9.0

- 카테고리 탭형 전환 — 한 번에 한 카테고리만 표시 (스크롤 80%↓)
- ⭐ 즐겨찾기 — 카드 ⭐ 토글, 사이드바 맨 위 가상 카테고리
- 📝 인라인 메모 — 카드 펼친 안 textarea, 500ms debounce 자동 저장
- 출처 필터 — 운영지침 / 내배카 / 직능 3개 칩으로 표시 토글
