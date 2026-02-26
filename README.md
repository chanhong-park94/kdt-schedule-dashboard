# 학사일정관리 (Vite + TypeScript)

기존 HTML 프로토타입을 Vite + TypeScript 기반 정적 웹 프로젝트로 전환한 초기 템플릿입니다.

## 프로젝트 구조

```text
.
├─ src/
│  ├─ core/
│  ├─ ui/
│  ├─ index.html
│  ├─ main.ts
│  └─ style.css
├─ tests/
├─ package.json
├─ tsconfig.json
└─ vite.config.mts
```

## 설치

```bash
npm install
```

## 환경 변수 설정

Supabase 동기화를 사용하려면 아래 값을 설정하세요.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

예시: `.env.example`을 복사해서 `.env`를 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

## 런타임 정책

- 팀 배포 기준 Node: LTS 라인만 사용 (`22.x` 권장, `24.x` 허용)
- 저장소 엔진 정책: `package.json`의 `engines.node = ^22.0.0 || ^24.0.0`

## 실행

- 개발 서버: `npm run dev`
- 프로덕션 빌드: `npm run build`
- 빌드 결과 미리보기: `npm run preview`
- 테스트 실행: `npm run test` (Vitest가 `tests/**/*.test.ts`를 실제 실행)

### 강사 동기화 검증 체크리스트

1. `.env`에 Supabase 키를 넣고 `npm run dev`로 실행
2. 강사 등록 후 저장 버튼 클릭
3. 브라우저 네트워크 탭에서 `instructors` 테이블 요청(POST/DELETE) 확인
4. Supabase Studio 또는 SQL Editor에서 아래 쿼리로 반영 확인

```sql
select *
from instructors
order by instructor_code
limit 20;
```

5. 같은 `instructor_code` 재등록 시 기존 값이 upsert로 갱신되는지 확인
6. 강사 삭제 시 해당 row가 삭제되는지 확인

### 강사 동기화가 404(PGRST205)로 실패할 때

`Could not find the table 'public.instructors' in the schema cache` 오류가 보이면,
Supabase SQL Editor에서 `spec/sql/001_create_instructors.sql`을 1회 실행해 테이블/정책을 생성하세요.

## 타임라인 보기 방식 (View)

- `COHORT_TIMELINE` (기본): 기수별 바 형태로 전체 기간을 확인
- `COURSE_GROUPED`: 과정별 그룹 아래에 기수 바를 묶어 확인 (접기/펼치기 지원)
- `ASSIGNEE_TIMELINE`: 강사/담당자 관점으로 일정 기간과 충돌 요약 확인
- `WEEK_GRID`: 주간(월~일) 그리드에서 일자별 수업 여부 확인
- `MONTH_CALENDAR`: 월간 캘린더에서 수업일/휴일을 함께 확인

타임라인 바/셀 클릭 시 알림 드로어와 연동되어 관련 상태를 빠르게 점검할 수 있습니다.

## 배포 방법

1. `npm run build` 실행
2. `dist` 폴더 생성 확인
3. 정적 파일 업로드 방식으로 배포
   - Vercel / Netlify / 사내 S3 / 일반 웹서버(Nginx, Apache)
   - 핵심은 `dist` 전체를 정적 호스팅 루트에 업로드하는 것

### dist 배포 패키지(zip) 생성

- 릴리즈 산출물 파일명 규칙: `academic-schedule-manager_v0.1.0_dist.zip`
- Windows PowerShell:

```powershell
Compress-Archive -Path "dist\*" -DestinationPath "academic-schedule-manager_v0.1.0_dist.zip" -Force
```

- macOS/Linux:

```bash
cd dist && zip -r ../academic-schedule-manager_v0.1.0_dist.zip .
```

로컬 개발 실행은 `npm run dev`를 사용합니다.

데이터 저장은 서버가 아닌 **로컬(localStorage + 파일 저장/불러오기)** 방식입니다.

데모 샘플 로더는 `?demo=1` 쿼리일 때만 노출됩니다.
예: `http://localhost:5173/?demo=1`

## 참고

- Vite 루트는 `src`로 설정되어 있습니다.
- 기존 프로토타입 HTML은 `src/index.html`로 이동되었고, 스크립트는 `src/main.ts`에서 시작합니다.

## 명세 문서

- 요구사항: [`spec/requirements.md`](spec/requirements.md)
- 데이터 계약: [`spec/data_contract.md`](spec/data_contract.md)
- 충돌 규칙: [`spec/conflict_rules.md`](spec/conflict_rules.md)
- 공휴일 전략: [`spec/holidays.md`](spec/holidays.md)
- staffing 모델: [`spec/staffing.md`](spec/staffing.md)
- 상태 저장 스키마: [`spec/state_schema.md`](spec/state_schema.md)
- 코드 표준화 규칙: [`spec/standardize.md`](spec/standardize.md)

## HRD CSV 안정성 정책

- HRD CSV 컬럼 스키마(헤더 순서/컬럼 수/포맷)는 계약으로 취급합니다.
- HRD CSV 스키마를 변경해야 할 경우 **major bump**를 수행합니다.

## v7e_strict 헤더 고정 정책

- `v7e_strict` CSV 헤더 문자열/컬럼 순서는 교퍼팀 v7-E 표준과 1:1 고정입니다.
- 헤더 문자열이 바뀌는 경우 **major bump**를 수행합니다.

## 새 포맷 추가 방법

1. `src/public/mappings/<format>.json` 파일을 추가/수정합니다.
2. `header`, `columns(key/label)`, 필요 시 `headerAliases`를 정의합니다.
3. 내부 표준 레코드(`src/core/schema.ts`의 `InternalV7ERecord`) 키를 `columns[].key`에 매핑합니다.
4. `tests/v7e.strict.export.snapshot.test.ts` 등 회귀 테스트를 실행해 기존 포맷 영향이 없는지 확인합니다.

## SemVer 정책

- 스키마 변경(상태 스키마/내부 표준 스키마/고정 export 헤더 변경): **major**
- export 포맷 추가(기존 포맷 호환 유지): **minor**
- 내부 버그 수정/안정화(외부 계약 불변): **patch**

## 릴리즈 태그 준비

1. `npm run build`, `npm test -- --run`, `npx tsc --noEmit` 통과 확인
2. `CHANGELOG.md`에 릴리즈 변경사항 반영
3. `academic-schedule-manager_v0.1.0_dist.zip` 생성 및 보관
4. 버전 확인(`package.json`: `0.1.0` 유지)
5. 태그 생성 예시
   - `git tag -a v0.1.0 -m "Release v0.1.0"`
   - `git push origin v0.1.0`

## 보안 알림 (v0.1.0)

- 현재 `npm audit` 결과: `moderate 5건`
- 본 릴리즈에서는 기능 배포 마감 우선으로 진행하며, 취약점 처리는 **보안 업데이트 전용 PR**에서 별도로 수행 권장

## 운영 문서

- 문제 해결 가이드: [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
- 변경 이력: [`CHANGELOG.md`](CHANGELOG.md)
- 릴리즈 점검표: [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)
- 팀 배포 가이드: [`TEAM_DEPLOY.md`](TEAM_DEPLOY.md)

## 정책 차이 (실업자/재직자)

- `UNEMPLOYED`(실업자): 업무일수 산정 `월~금` (`[1,2,3,4,5]`)
- `EMPLOYED`(재직자): 업무일수 산정 `월~토` (`[1,2,3,4,5,6]`)
- 정책은 코호트별 `trackType`으로 고정되고, 퍼실/운영 배치 일수/겹침 계산에 반영됩니다.

## 리소스 타입 차이 (시간 vs 일)

- `INSTRUCTOR`
  - 시간 충돌: 세션 기반(강사 시간 구간 겹침)
  - 일 충돌: Staffing 배치 기반(`resourceType=INSTRUCTOR`)
- `FACILITATOR` / `OPERATION`
  - 시간 충돌 대상 아님
  - 일 충돌: Staffing 배치 기반(`resourceType`별 독립 계산)

## 추천 운영 플로우 (1~8)

1. 세션 CSV 업로드 후 파싱 에러를 확인/수정한다.
2. 코호트별 `trackType`(실업자/재직자)을 확인한다.
3. 공휴일 자동 로드를 실행하고 필요 시 자체휴강을 추가한다.
4. 일정 생성기/append로 필요한 세션을 보강한다.
5. Staffing 배치표(P1/P2/365, resourceType, 담당자, 기간)를 입력/자동채움한다.
6. 충돌 탭 3종(강사 시간, 강사 일, 퍼실/운영 일)을 각각 점검하고 CSV로 내보낸다.
7. 운영 체크리스트에서 필수 항목(검증/충돌/정책/공휴일)을 확인한다.
8. 프린트(PDF) 리포트를 생성해 간트/KPI/선택 충돌 상위 50건을 공유한다.

## 역할별 운영 시나리오

- 운영매니저
  1. `기수 일정 생성기`에서 개강일/시간표 템플릿으로 일정 생성
  2. 공휴일/자체휴강 반영 후 충돌 계산
  3. `강사 시간 충돌`과 `강사 배치(일) 충돌`을 우선 정리
  4. HRD 검증 통과 후 `선택한 기수 CSV 다운로드`

- 교퍼팀장
  1. `Staffing 배치관리`에서 P1/P2/365 자동채우기 실행
  2. 코호트별 trackType(실업자/재직자) 확인
  3. 강사/퍼실/운영 일충돌 탭 확인 후 담당자 재배치
  4. 필요 시 `v7e_strict` 또는 `modules_generic` 배치 CSV 내보내기

- 사업팀 팀장
  1. 상단 `리스크 요약 카드`에서 충돌/HRD/공휴일 상태를 한 번에 확인
  2. `운영 체크리스트` 통과 여부와 누락 경고를 점검
  3. 프린트(PDF) 리포트로 간트/KPI/충돌 요약 공유
