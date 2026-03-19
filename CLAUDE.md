# CLAUDE.md

## 프로젝트 개요
KDT(K-디지털 트레이닝) 교육과정 스케줄 관리 대시보드.
훈련 일정 타임라인, HRD 출결 분석, KPI 리포트, 훈련생 관리 기능을 제공하는 SPA.

**주요 탭**: 학사일정 / 대시보드 / HRD시간표 / 자율성과지표 / 출결현황 / 훈련생분석 / 훈련생이력 / 학업성취도(실업자·재직자) / 문의응대 / 만족도 / 설정

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
├── hrd/           # HRD 대시보드
│   ├── hrdAchievement*.ts    # 학업성취도 - 실업자 (Apps Script)
│   ├── hrdEmployed*.ts       # 학업성취도 - 재직자 유닛리포트
│   ├── hrdInquiry*.ts        # 문의응대 (Airtable API)
│   ├── hrdSatisfaction*.ts   # 만족도 (Apps Script)
│   └── hrd*.ts               # 출결, 분석, 이탈, Slack 알림 등
├── kpi/           # KPI 리포트 + PDF
├── ui/            # UI 레이어 (domRefs, events, appState, features/)
├── reports/       # 보고서
├── main.ts        # 앱 진입점
├── index.html     # SPA 메인 HTML
└── style.css      # 전역 스타일 (~7500줄, 라이트 모드 기본)
```

## 외부 API 연동

| 기능 | API | localStorage 키 |
|------|-----|-----------------|
| 학업성취도(실업자/재직자) | Google Apps Script Web App | `kdt_achievement_config_v1` |
| 만족도 | Google Apps Script Web App | `kdt_satisfaction_config_v1` |
| 문의응대 | Airtable REST API (Base ID + PAT) | `inquiry_airtable_config` |
| HRD 출결 | HRD-Net API (authKey + proxy) | `academic_schedule_manager_hrd_config_v1` |
| Slack 알림 | Slack Incoming Webhook | hrdConfig 내 포함 |

- 모든 API 설정은 **설정 탭 → API 연동**에서 통합 관리
- 캐시 TTL: 24시간 (localStorage), 앱 재시작 시 자동 복원

## 코딩 규칙
- 한국어 우선 응답 (AGENTS.md 참고)
- camelCase 함수/변수, 비즈니스 데이터는 한국어 키 사용
- 인터페이스: `Hrd` 접두사 (예: `HrdRawTrainee`, `HrdCourse`)
- 주석: 도메인 로직은 한국어, 코드 구조는 영어
- `as const` 패턴으로 타입 안전성 확보
- 기존 코드 패턴을 먼저 읽고 변경
- 재직자 기수 코드: 10의 자리=과정(0→LLM, 1→데이터, 2→기획/개발), 1의 자리=기수번호 (`parseCohortCode()` in `hrdEmployedApi.ts`)

## 빌드 & 배포
- Vite root: `src/`, base: `/kdt-schedule-dashboard/`
- GitHub Actions (`pages.yml`): main push → 테스트 → 빌드 → Pages 배포
- 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## 디자인 시스템
- **라이트 모드 기본** (ARC Sales Dashboard 스타일)
- **폰트**: Inter (Latin) + Pretendard (Korean)
- **색상 팔레트**: 연보라 배경 (#ede9f3), 흰색 카드 (#ffffff)
- **CSS 변수**: `:root`에 디자인 토큰 정의 (--text, --card-bg, --surface-hover 등)

## 주의사항
- style.css에 하드코딩된 색상 추가 금지 → CSS 변수 사용
- CSS fallback 값에 다크 모드 색상(#fafafa 등) 사용 금지 → :root 변수명 참조
- 커밋/푸시는 사용자 요청 시에만 수행
- 파괴적 git 명령 사용 전 반드시 확인

---

## 🔄 작업 현황 (마지막 업데이트: 2026-03-19)

### ✅ 완료
- 학업성취도(실업자): Apps Script → 689명/45,574건, 신호등 정렬, 캐시 복원
- 학업성취도(재직자): 서브탭 분리, 유닛1~12 강사/운영진단 + 프로젝트1~4, 등급 A~D
- 문의응대: Airtable API (응대+수강생+과정 3테이블 매핑), 82건, 통계카드+필터+검색
- 만족도: 스키마 시트 기반 (NPS/강사/중간/최종, 과정·기수·모듈 단위)
- 기수 코드 매핑: 0-x=LLM, 1-x=데이터, 2-x=기획/개발 (parseCohortCode)
- UI: 셀 색상 강화, 라이트 모드 호환, API 설정 통합, 캐시 자동 복원
- 스키마 시트 포맷팅 (헤더 남색, 줄무늬, 자동 열 너비)
- cmux 터미널 셋업: `scripts/cmux.sh` — macOS tmux 기반 Claude Code + Codex CLI 병렬 실행

### 🔧 개발 환경
- **소스 관리**: GitHub 단일 관리 (Windows + Mac 양쪽에서 git pull/push)
- **Google Drive**: 비코드 자료(회의록, 기획서, CSV 원본)만 보관
- **작업 전**: `git pull origin main` → 작업 → `npm run test` → commit → push
- **환경 통일**: Node.js 22+, `npm ci`로 정확한 의존성 설치

### 🔜 다음 작업
1. **재직자 유닛리포트 API** — 팀장님 API URL 제공 대기 중 → 직접 API 호출로 전환
2. **Apps Script 재배포** — schema_employed action 추가 필요
3. **스키마 시트 데이터 입력** — 학업성취도(재직자) CSV 붙여넣기, 만족도 수기 입력

### 📌 주요 URL
- 배포: https://chanhong-park94.github.io/kdt-schedule-dashboard/
- 대시보드용 DB 시트: https://docs.google.com/spreadsheets/d/1jwFQ6M-ZHCBoYkGSoT7u8GhNM2ssBZwjfYXvt_FvGGw/edit
- 스키마 시트: https://docs.google.com/spreadsheets/d/1FO_U99xts2OEaFOniPDaS0Qfz9Stx3iO66zdQRnK0IE/edit
- 재직자 CSV: trainee_reports (4).csv (543명, UUID+기수+유닛1~12 강사/운영진단)
