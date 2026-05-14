# KDT 교육과정 운영 대시보드

> K-디지털 트레이닝(KDT) 교육과정의 일정 / 출결 / 학업성취도 / 만족도 / 매출 / 문의응대를 통합 관리하는 SPA 대시보드

[![Deploy](https://img.shields.io/badge/deploy-GitHub%20Pages-181717?logo=github)](https://chanhong-park94.github.io/kdt-schedule-dashboard/)
![Version](https://img.shields.io/badge/version-v3.6.0-blue)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase)

🚀 **배포**: <https://chanhong-park94.github.io/kdt-schedule-dashboard/>

---

## 📌 개요

모듈러스 KDT 교육사업의 운영 데이터를 한 곳에서 다루기 위한 내부용 대시보드입니다.
HRD-Net · Google Apps Script · Airtable · Supabase · Slack 등 외부 데이터 소스를 통합해
일정 수립 → 출결 모니터링 → 학업성취도/만족도 분석 → 매출 산정 → Slack 자동 리포트까지 한 화면에서 처리합니다.

## ✨ 주요 기능 (v3.6.0)

| 영역 | 설명 |
|------|------|
| 📅 **학사일정 / HRD 시간표** | 코호트·과정·강사·주간·월간 5종 타임라인, 충돌 검사(시간/일/staffing) |
| 👥 **출결현황 / 훈련생 분석** | HRD-Net API 기반 출석률, 위험등급, 조퇴/지각 자동 환산 |
| 🎯 **하차방어율 인사이트** | 도입 전/후 비교 + 위험군 회복/발생/연속결석/NPS 4종 leading 지표 + 추정 절감 인원 |
| 📊 **학업성취도 (실업자/재직자)** | Apps Script 기반 유닛 리포트, Excel 내보내기 |
| 😊 **만족도** | 모듈/프로젝트별 7점 척도 분석, HRD 중간만족도 연동 |
| 💬 **문의응대** | Airtable 기반 티켓 관리 |
| 💰 **매출 관리** | 출결 기반 훈련비 자동 산정, 100/80/75/70% 시나리오 예측 |
| 👨‍🏫 **강사 대시보드** | 프로젝트 평가/보상, 운영·교강사 진단 4종 통합 sub-tab |
| 📄 **문서자동화** | 출석입력요청대장 / 장려금 확인서 HWPX 자동 생성 |
| 📨 **Slack 자동 알림** | 출결 리포트 + 위험학생 SMS 에스컬레이션 + 일매출 리포트 |
| 📰 **주간보고팩** | 진행중/종강 자동 분류, 데이터 자동 조회 |

> 전체 패치 노트는 [CHANGELOG.md](CHANGELOG.md), 작업 현황은 [CLAUDE.md](CLAUDE.md) 참고.

## 🛠 기술 스택

- **빌드**: Vite 5 + TypeScript (strict)
- **런타임**: Node.js 22.x (LTS) — 24.x 허용
- **차트**: Chart.js 4.x
- **DB / 인증**: Supabase (PostgREST + RLS + Edge Functions)
- **외부 API**: HRD-Net, Google Apps Script, Airtable
- **배포**: GitHub Actions → GitHub Pages
- **테스트**: Vitest
- **포매터/린터**: Prettier + ESLint (typescript-eslint)
- **인증**: Google Workspace SSO (`@modulabs.co.kr`)

## 🚀 시작하기

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env 에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 입력

# 3. 개발 서버 실행 (port 5173)
npm run dev
```

### 핵심 명령어

| 명령 | 설명 |
|------|------|
| `npm run dev` | Vite 개발 서버 (port 5173) |
| `npm run build` | 프로덕션 빌드 → `dist/` |
| `npm run preview` | 빌드 결과 로컬 미리보기 |
| `npm run test` | Vitest 전체 테스트 |
| `npm run lint:fix` | ESLint 자동 수정 |
| `npm run format` | Prettier 포맷 |

## 📁 디렉토리 구조

```
src/
├── auth/          # Google Workspace 로그인
├── core/          # 도메인 로직 (캘린더, CSV, 충돌검사, 검증)
├── hrd/           # HRD 대시보드 (출결, 학업성취도, 만족도, 문의응대, 하차방어율, Slack)
├── instructor/    # 강사 대시보드 (4종 sub-tab)
├── kpi/           # KPI 리포트 + PDF
├── reports/       # 주간보고팩
├── ui/            # UI 레이어 (lazy-load tabRegistry)
├── main.ts        # 앱 진입점
├── index.html     # SPA 메인 HTML
└── style.css      # 전역 스타일 (라이트 모드, ARC 스타일)

docs/              # 운영 가이드 + Apps Script 원본 + 설계서
spec/              # 요구사항/스키마/충돌 규칙 + Supabase SQL 마이그레이션
supabase/          # Edge Functions (HRD-Net 프록시 등)
```

## 🔐 외부 API 연동

| 기능 | API | 인증 방식 |
|------|-----|----------|
| 학업성취도 (실업자/재직자) | Google Apps Script Web App | URL 토큰 |
| 만족도 | Google Apps Script Web App | URL 토큰 |
| 문의응대 | Airtable REST API | Personal Access Token |
| HRD 출결 | HRD-Net API | authKey (Supabase Edge Function 프록시) |
| Slack 알림 | Slack Incoming Webhook | Webhook URL |

> 모든 API 키는 **설정 탭 → API 연동**에서 통합 관리되며, Supabase RLS + Edge Function으로 격리됩니다.

## 🚢 배포

`main` 브랜치 푸시 시 GitHub Actions(`pages.yml`)가 자동으로:

1. `npm run test` 통과 확인
2. `npm run build` → `dist/`
3. GitHub Pages로 배포 (`/kdt-schedule-dashboard/` base)

수동 zip 패키지:

```powershell
# Windows PowerShell
Compress-Archive -Path "dist\*" -DestinationPath "academic-schedule-manager_v3.6.0_dist.zip" -Force
```

## 🎭 역할별 운영 시나리오

### 운영매니저
1. 기수 일정 생성기에서 개강일/시간표 템플릿으로 일정 생성
2. 공휴일/자체휴강 반영 후 충돌 계산
3. 강사 시간/배치 충돌 우선 정리
4. HRD 검증 통과 후 선택 기수 CSV 다운로드

### 교퍼팀장
1. Staffing 배치관리에서 P1/P2/365 자동채우기 실행
2. 코호트별 trackType(실업자/재직자) 확인
3. 강사/퍼실/운영 일충돌 탭 확인 후 담당자 재배치
4. v7e_strict / modules_generic 배치 CSV 내보내기

### 사업팀 팀장
1. 상단 리스크 요약 카드에서 충돌/HRD/공휴일 상태 확인
2. 운영 체크리스트 통과 여부 점검
3. 프린트(PDF) 리포트로 간트/KPI/충돌 요약 공유

## 📜 정책 / 규약

- **HRD CSV 스키마** — 헤더 순서/컬럼 수/포맷은 계약. 변경 시 **major bump**
- **`v7e_strict` 헤더** — 교퍼팀 v7-E 표준과 1:1 고정. 변경 시 **major bump**
- **SemVer** — 스키마 변경 = major / 포맷 추가 = minor / 버그 수정 = patch
- **trackType 정책**:
  - `UNEMPLOYED` (실업자): 업무일수 월~금
  - `EMPLOYED` (재직자): 업무일수 월~토
- **리소스 타입 분리**:
  - `INSTRUCTOR`: 시간 충돌(세션) + 일 충돌(staffing)
  - `FACILITATOR` / `OPERATION`: 일 충돌만(staffing, 독립 계산)

## 🔒 보안

- Supabase RLS 적용 (`007`/`008b`/`010` 마이그레이션)
- HRD-Net authKey Edge Function 프록시 격리
- XSS 방어: `escapeHtml` 유틸 일괄 적용 중
- Google Workspace SSO (`@modulabs.co.kr`)

> 출결 관련 변경 작업은 [docs/ATTENDANCE_CRITICAL.md](docs/ATTENDANCE_CRITICAL.md)의 회귀 방지 체크리스트 통과 필수.

## 📚 문서

- 📋 [CLAUDE.md](CLAUDE.md) — 프로젝트 컨텍스트 + 작업 현황
- 🔧 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — 문제 해결 가이드
- 📝 [CHANGELOG.md](CHANGELOG.md) — 전체 패치 노트
- ✅ [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — 릴리즈 점검표
- 👥 [TEAM_DEPLOY.md](TEAM_DEPLOY.md) — 팀 배포 가이드
- ⚠️ [docs/ATTENDANCE_CRITICAL.md](docs/ATTENDANCE_CRITICAL.md) — 출결조회 핵심 가드
- 🤖 [AGENTS.md](AGENTS.md) — AI 협업 가이드

---

🤖 _개발 협업: Claude Code (Opus 4.7) — see [AGENTS.md](AGENTS.md)_
