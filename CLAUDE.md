# CLAUDE.md

## 프로젝트 개요
KDT(K-디지털 트레이닝) 교육과정 스케줄 관리 대시보드.
훈련 일정 타임라인, HRD 출결 분석, KPI 리포트, 훈련생 관리 기능을 제공하는 SPA.

## 기술 스택
- **빌드**: Vite + TypeScript (strict)
- **런타임**: Node.js 22+
- **차트**: Chart.js 4.x
- **DB**: Supabase (supabase-js)
- **배포**: GitHub Pages (main push → Actions → gh-pages)
- **테스트**: Vitest
- **포매터**: Prettier (semi: true, singleQuote: false, tabWidth: 2, printWidth: 120)
- **린트**: ESLint + typescript-eslint

## 핵심 명령어
```bash
npm run dev          # Vite 개발 서버 (port 5173)
npm run build        # 프로덕션 빌드 → dist/
npm run test         # Vitest 전체 테스트
npm run lint:fix     # ESLint 자동 수정
npm run format       # Prettier 포맷
```

## 디렉토리 구조
```
src/
├── auth/          # 인증
├── core/          # 도메인 로직 (캘린더, CSV, 충돌검사, 검증 등)
├── hrd/           # HRD 대시보드 (출결, 분석, 이탈, 훈련생 이력)
├── kpi/           # KPI 리포트 + PDF
├── ui/            # UI 레이어 (domRefs, events, appState, features/)
├── reports/       # 보고서
├── main.ts        # 앱 진입점
├── index.html     # SPA 메인 HTML
└── style.css      # 전역 스타일 (~6000줄, 다크 모드 전용)
```

## 코딩 규칙
- 한국어 우선 응답 (AGENTS.md 참고)
- camelCase 함수/변수, 비즈니스 데이터는 한국어 키 사용
- 인터페이스: `Hrd` 접두사 (예: `HrdRawTrainee`, `HrdCourse`)
- 주석: 도메인 로직은 한국어, 코드 구조는 영어
- `as const` 패턴으로 타입 안전성 확보
- 기존 코드 패턴을 먼저 읽고 변경

## 빌드 & 배포
- Vite root: `src/`, base: `/kdt-schedule-dashboard/`
- GitHub Actions (`pages.yml`): main push → 테스트 → 빌드 → Pages 배포
- 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## 디자인 시스템
- **다크 모드 전용** (data-theme="dark")
- **폰트**: Inter (Latin) + Pretendard (Korean)
- **색상 팔레트**: 딥 블랙 (#09090b 배경, #111113 카드)
- **KPI 카드**: 보라/파랑/핑크 그라데이션 (Dribbble 레퍼런스 기반)
- **CSS 변수**: `:root`에 디자인 토큰 정의

## 주의사항
- style.css에 하드코딩된 색상 추가 금지 → CSS 변수 사용
- 커밋/푸시는 사용자 요청 시에만 수행
- 파괴적 git 명령 사용 전 반드시 확인
