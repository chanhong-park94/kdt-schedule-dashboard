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
├── instructor/    # 강사 대시보드 (재직자 교육관리)
│   ├── projectEvalInit.ts    # 프로젝트 평가 (lazy-load)
│   ├── projectRewardInit.ts  # 프로젝트 보상 (운매 전용)
│   ├── operationDiagInit.ts  # 운영 진단
│   └── instructorDiagInit.ts # 교강사 진단
├── kpi/           # KPI 리포트 + PDF
│   └── kpiInit.ts            # KPI 탭 초기화 (lazy-load 진입점)
├── ui/            # UI 레이어 (domRefs, events, appState, features/)
│   ├── tabLoader.ts          # createTabLoader() — 캐시 기반 lazy load 헬퍼
│   └── tabRegistry.ts        # ensureTabLoaded() — 탭별 dynamic import 매핑
├── reports/       # 보고서
│   └── reportsInit.ts        # 주간보고팩 초기화 (lazy-load 진입점)
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
- 새 탭 추가 시 lazy-load 패턴: ① `src/[module]/[name]Init.ts` 생성 → ② `tabRegistry.ts`에 `createTabLoader()` 항목 등록 → ③ main.ts에 정적 import 추가 금지

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

## 🔄 작업 현황 (마지막 업데이트: 2026-04-17)

### ✅ 완료 (v3.4.0) — 강사 대시보드
- 보조강사/교강사 모드에 4개 탭 추가: 프로젝트 평가, 프로젝트 보상, 운영 진단, 교강사 진단
- **프로젝트 평가**: 프로젝트 1~4 점수(100점)+피드백, 루브릭 표시, 중도탈락 회색 처리
- **프로젝트 보상** (운매 전용): 달성 자동 판정(점수+PERCENTRANK), 집행일 입력, CSV 다운로드
- **운영 진단**: 유닛 1~12 일자별 출석/태도/소통(0/5/10점), 주계·환산 자동 계산, 진단 기준표
- **교강사 진단**: 유닛 1~12 1차/2차 진단(5점 척도), 평균·환산 자동 계산, 페이지 전환
- Supabase 4개 테이블: `project_evaluations`, `project_rewards`, `operation_diagnosis`, `instructor_diagnosis`
- DB 스키마: `spec/sql/008_create_instructor_dashboard.sql` (⚠️ Supabase SQL Editor에서 실행 필요)
- 상단+하단 저장 버튼, 미저장 페이지 이동 경고(beforeunload)
- 강사 모드 명칭: "보조강사" → "강사 대시보드"
- 설계서: `docs/plans/2026-04-17-instructor-dashboard-design.md`

### ✅ 완료 (v3.3.0) — 매출 탭 강화
- 매출상세표: 엑셀 통합템플릿(01_매출관리+02_매출상세) 양식 대응
- 엑셀 업로드: 기존 교육사업관리 엑셀 → 일별 매출 자동 파싱 (SheetJS)
- 과정/기수 멀티 관리: 드롭다운 전환, localStorage 저장
- 요일별 훈련시간: 월~토 개별 체크+시간, 공휴일 자동 제외 (2025~2027)
- 시나리오 예측: 100/80/75/70% 자동 산출
- 예상/실일매출 수정 가능, v1→v2 마이그레이션

### ✅ 완료 (v2.9.0~v3.2.0)
- 운영 UX 개선 18항목, 캐시 시점 표시, Alt+1~9 단축키, 오프라인 감지
- 학업성취도 Excel 내보내기, Skeleton 로딩, 모바일 탭 11px
- 문서자동화 탭 (출석입력요청대장 HWPX), 공결 신청 조회, 관리자 서명
- Google Workspace 로그인 (@modulabs.co.kr), 매출 탭 신설
- 코드 스플리팅: 탭별 동적 import, tabLoader + tabRegistry 패턴

### ✅ 완료 (v2.7.0~v2.8.0)
- 학업성취도(실업자/재직자), 문의응대(Airtable), 만족도, 하차방어율
- 출결현황, 훈련생분석, 훈련생이력, SMS 발송
- 보안(CORS, XSS, PAT 난독화), 패치노트, 업무 가이드, AI 팀소개

### 🔒 보안 감사 (2026-04-16~17)
- HRD-Net API 이중 경로: Edge Function 프록시 우선 → CORS 프록시 폴백
  - `supabase/functions/hrd-proxy/index.ts` (Deno.env로 authKey 관리)
  - Edge Function 미배포 시 `cors.eu.org` 경유 자동 폴백
  - `edgeFunctionAvailable` 캐시: 세션 중 1회만 시도 후 결정
  - ⚠️ `corsproxy.io` 유료 전환됨 (2순위 프록시 사용 불가)
- `src/core/escape.ts` escapeHtml 유틸 추가
- `spec/sql/007_security_phase_a.sql` — `excused_absence_requests` anon DELETE 차단
- ⚠️ **사용자 미완료 조치**:
  - Edge Function 배포: `supabase/functions/hrd-proxy/DEPLOY.md` 참고
  - `007_security_phase_a.sql` SQL Editor 실행
  - `008_create_instructor_dashboard.sql` SQL Editor 실행

### 🔜 다음 작업
1. **강사 대시보드 Phase 6** — 종합 진단 (기술60%+운영40% 합산, 경험치) 자동 조회 탭
2. **[보안 Phase B] Supabase 클라이언트 세션 통합** — 10+곳 `createClient` 중복 → 싱글톤, RLS 강화
3. **[보안] 218개 innerHTML에 escapeHtml 일괄 적용**
4. **main.ts 추가 분리** — 700KB → 500KB 이하
5. **HWPX 내보내기** — 한글 공문서 (훈련 보고서, 훈련일지)
6. **재직자 유닛리포트 API** — 팀장님 API URL 제공 대기 중
7. **이메일 발송** — Google SMTP 계정 확보 후 연동
8. **CI 타입 체크 수정** — 기존 코드 tsc --noEmit 에러 정리

### 📌 주요 URL
- 배포: https://chanhong-park94.github.io/kdt-schedule-dashboard/
- 대시보드용 DB 시트: https://docs.google.com/spreadsheets/d/1jwFQ6M-ZHCBoYkGSoT7u8GhNM2ssBZwjfYXvt_FvGGw/edit
- 스키마 시트: https://docs.google.com/spreadsheets/d/1FO_U99xts2OEaFOniPDaS0Qfz9Stx3iO66zdQRnK0IE/edit
- Supabase: https://supabase.com/dashboard/project/ltywspfpyjhrmkgiarti
