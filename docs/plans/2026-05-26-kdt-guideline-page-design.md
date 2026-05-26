# 26년도 KDT 운영지침 매뉴얼 페이지 설계서

작성일: 2026-05-26
대상 PDF: `26년도 KDT 운영지침.pdf` (22 페이지, 시행일 2026.2.19~)

## 1. 배경

운영자가 일선 업무 중 운영지침을 빠르게 확인해야 하는 상황(출석률·자부담·재해보험·변경신고 등)에서, 매번 PDF를 열어 검색하는 비용이 크다. 대시보드 안에 구조화·검색 가능한 매뉴얼 페이지를 신설하여 의사결정 지연을 줄인다.

## 2. 의사결정 요약

| 결정 항목 | 선택 | 비고 |
|---|---|---|
| 배치 | 사이드바 새 탭 + 전역 단축키 | 발견성·접근성 모두 |
| 데이터 저장 | TypeScript 상수 구조체 | 타입 안전 / 번들 임베드 |
| 검색 깊이 | 텍스트 매칭 + 하이라이트 | Fuse.js 불필요 |
| PDF 원본 | 미포함 (구조화 매뉴얼만) | 번들 경량화 |

## 3. 카테고리 분류 (12개)

| ID | 명칭 | PDF 출처 |
|---|---|---|
| `overview` | 사업 개요 | Ⅰ~Ⅲ, 훈련유형 6종, 지원단가 |
| `selection` | 훈련과정 선정 | Ⅳ-1, 심평원·고용센터 의견수렴 |
| `contract` | 위탁계약 체결 | Ⅳ-2, 관할/시설면적/온라인 유의 |
| `contractChange` | 위탁계약 변경 | Ⅳ-3, 변경불가/비대면 대체/정원/교강사 |
| `trainee` | 훈련생 선발·계좌 | Ⅳ-4, 자율선발/내일배움카드/개인정보 |
| `execution` | 훈련 실시 | Ⅳ-5, 실시·확정자신고/재해보험/시간표 |
| `attendance` | 출결관리 | Ⅳ-6, 출석·결석·인정 기준/제적 |
| `payment` | 훈련비·장려금·수당 | Ⅳ-7, 단가/선지급/정산/특별훈련수당 |
| `reporting` | 결과 보고 | Ⅳ-8, 수료/취업률 산정 |
| `supervision` | 지도감독·모니터링 | Ⅳ-9, 점검 항목/부정 사례/성과평가 |
| `shortTerm` | 단기과정 | Ⅳ-10, 심화/재직자 도약/사업주 신기술 |
| `annex` | 부록 (붙임 1~13) | 서식·위임장·변경인정 보완지침 |

## 4. 파일 구조

```
src/guideline/
├── guidelineData.ts        # 12개 카테고리 본문 (구조화 TS 상수)
├── guidelineInit.ts        # lazy-load 진입점 (탭 클릭 시 1회)
├── guidelineView.ts        # DOM 렌더 + 카테고리/카드/검색 UI
└── guidelineSearch.ts      # 토큰 매칭 + <mark> 하이라이트

docs/plans/
└── 2026-05-26-kdt-guideline-page-design.md  # 본 문서
```

## 5. 데이터 모델

```ts
export type GuidelineCategory =
  | "overview" | "selection" | "contract" | "contractChange"
  | "trainee" | "execution" | "attendance" | "payment"
  | "reporting" | "supervision" | "shortTerm" | "annex";

export interface GuidelineItem {
  id: string;                // ex. "attendance.absence-criteria"
  category: GuidelineCategory;
  title: string;             // "결석 기준"
  body: string;              // 본문 (PDF 원문 가공)
  tags?: string[];           // ["출결", "결석", "지각", "조퇴"]
  refs?: string[];           // PDF 페이지 ex. ["p.24"]
  highlight?: "critical" | "info";
}

export interface GuidelineSection {
  id: GuidelineCategory;
  title: string;             // "출결관리"
  icon: string;              // 이모지
  summary?: string;          // 카테고리 1줄 설명
  items: GuidelineItem[];
}
```

## 6. UI 레이아웃

### 데스크탑
- 좌측 12개 카테고리 사이드 (sticky)
- 우측 메인: 검색창 + 결과/카테고리 카드 리스트
- 검색 결과 0건일 때 추천 검색어 안내

### 모바일 (< 768px)
- 카테고리: 상단 가로 스크롤 chip 으로 전환
- 검색창 sticky top

### 카드
- 기본: 접힘(제목 + 1줄 요약)
- 클릭 시 본문 펼침 (다중 펼침 허용)
- `critical` 항목은 왼쪽 빨간 보더 (제적/부정 사례)

## 7. 검색 동작

```ts
function searchGuideline(query: string, sections: GuidelineSection[]) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return sections;

  return sections
    .map(section => ({
      ...section,
      items: section.items.filter(item => {
        const haystack = `${item.title} ${item.body} ${(item.tags ?? []).join(" ")}`.toLowerCase();
        return tokens.every(t => haystack.includes(t));
      }),
    }))
    .filter(section => section.items.length > 0);
}

function highlight(text: string, query: string): string {
  // <mark> 래핑, escapeHtml 적용
}
```

- debounce 200ms
- 검색어 비우면 전체 표시
- 매칭 수 배지: "총 N건"

## 8. 전역 단축키

- `Alt+G` (또는 `Shift+?`) → 빠른 검색 모달 오픈
- 모달 내 검색창 + 결과 카드 최대 10개
- 결과 클릭 또는 Enter → 매뉴얼 탭 전환 + 해당 항목 `scrollIntoView`
- ESC → 모달 닫힘
- 입력 요소가 포커스된 경우 단축키 비활성 (기존 input 충돌 방지)

## 9. 통합 절차

1. `src/ui/appState.ts` — `AppSidebarNavKey`에 `"guideline"` 추가
2. `src/ui/tabRegistry.ts` — `guideline` lazy 로더 등록
3. `src/index.html` — `<section id="guidelinePage">` placeholder 추가
4. 사이드바 메뉴 정의에 항목 추가, `SIDEBAR_MENU_VERSION` v6→v7 (1회 reset)
5. `src/main.ts` — 전역 단축키 핸들러 등록 (또는 events.ts)
6. `src/style.css` — `.guideline-*` 클래스 (CSS 변수 사용, 라이트 모드)

## 10. YAGNI (의도적으로 뺀 것)

- Fuse.js fuzzy 검색
- PDF.js 임베드 / PDF 다운로드 버튼
- 백엔드 동기화 / Supabase 저장
- 즐겨찾기·메모·공유
- 카테고리별 진행률·체크리스트

## 11. 회귀 방지

- 출결현황·hrdApi·Supabase 클라이언트와 무관한 영역 → ATTENDANCE_CRITICAL 체크리스트는 미해당
- 사이드바 메뉴 버전 v7 마이그레이션 — 사용자 커스텀 메뉴는 1회 리셋
- `npm run build` 통과 + `tsc --noEmit` 통과 (신규 파일 한정)

## 12. 검증 계획

| 항목 | 방법 |
|---|---|
| 빌드 | `npm run build` |
| 타입 | `tsc --noEmit` (신규 파일) |
| 수동 | 사이드바 클릭 / 카테고리 점프 / 검색 / Alt+G / 모바일 |

## 13. 향후 확장 (별도 작업)

- 운영지침 변경 시 diff 표시 (PDF 버전 비교)
- 운영자별 즐겨찾기 (Supabase)
- 항목별 체크리스트화 (예: "출결 점검 체크" 같은 자가점검 도구 연계)
