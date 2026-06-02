# KDT 대시보드 운영 안정화 코드리뷰 (2026-06-02)

> 운영 안정화 단계 진입에 맞춘 전체 코드리뷰. 4개 관점(기능 인벤토리 / 중복·통합 / 데드코드·저활용 / 코드품질·리스크)을 병렬 분석 후 교차검증·종합.
> 측정 기준: `~44,100줄 TS(141파일)` + `11,937줄 CSS` + `4,097줄 HTML`, 사이드바 nav 키 17개, 테스트 200건(36파일).

## 0. 총평

**44k LOC 규모 대비 코드 위생은 상위권으로 건강하다.** 안정화 단계에서 코드를 갈아엎을 필요는 없고, 몇 개의 핀포인트 리스크 차단 + 기능 통합(IA 정리)에 집중하면 된다.

| 위생 지표 | 수치 | 평가 |
|---|---|---|
| `any` 사용 | 5개(실사용 2) | 탁월 |
| `@ts-ignore` / `eslint-disable` | 0 / 0 | 탁월 |
| 완전 빈 `catch {}` | 0 | 양호 |
| 테스트 | 200건 100% 통과 | 양호 |
| `vite build` | ✓ 4.58s 성공 | 정상 |
| `tsc --noEmit` | **23 에러** | 정비 필요(아래 4-④) |
| `persistSession:true` 인스턴스 | **1개(정상)** | v3.5.0 회귀 가드 유지 |

**가장 먼저 막을 것 2가지**(둘 다 출결조회를 깨지 않고 적용 가능):
1. HRD-Net authKey 공개 노출 (1-①)
2. 죽은 `corsproxy.io`가 출결 fallback에 잔존 (1-②)

**가장 큰 구조적 기회**: 사이드바 17탭 → 9탭 통합 (2장). "페이지가 너무 많다"는 체감의 실제 원인은 *출결 데이터를 4개 탭이 관점만 바꿔 반복*하는 것.

---

## 1. 🔴 안정성 리스크 (출결 / Supabase / 인증) — 안정화 1순위

### ① [높음] HRD-Net authKey 공개 노출 — 3중 노출
- [src/hrd/hrdConfig.ts:10](src/hrd/hrdConfig.ts:10) `const DEFAULT_KEY = "gL1rEteJ...";` (실제 출결 API 키), `:241`·`:271`에서 fallback 사용 → 클라이언트 번들에 포함.
- **검증**: ① 빌드 산출물 `dist/assets/index-*.js`에서 키 문자열 검출, ② GitHub Pages로 공개 서빙, ③ git-tracked `academic-schedule-manager_dist_0.1.0.zip` 내부에도 포함(히스토리 잔존).
- 자기 모순: 9행 주석에 "배포 후 ""로 변경할 것"이라 적혀있으나 미실행. [ATTENDANCE_CRITICAL.md](docs/ATTENDANCE_CRITICAL.md) §B "authKey 클라이언트 하드코딩 금지" 위반.
- **조치 순서(중요 — 순서 틀리면 출결 깨짐)**:
  1. HRD-Net에서 **키 로테이션**(신규 키 발급) — *사용자 액션*
  2. `supabase/functions/hrd-proxy` **배포**(키를 `Deno.env`로 서버 보관) — *사용자 액션, [DEPLOY.md](supabase/functions/hrd-proxy/DEPLOY.md) 참고*
  3. 그 후에야 `DEFAULT_KEY=""`로 비우기 — *코드 변경(내가 가능)*. Edge Function 배포 전에 먼저 비우면 출결조회 실패.
  4. `*.zip` git 추적 해제 + `.gitignore` 추가 — *코드 변경(내가 가능)*

### ② [높음] 죽은 corsproxy.io가 출결 fallback에 #2로 잔존
- [src/hrd/hrdApi.ts:110](src/hrd/hrdApi.ts:110) `{ prefix: "https://corsproxy.io/?url=", encode: true }` — 출결 API fallback 배열에 존재(cors.eu.org 다음 순위). 동일: [kpiSheets.ts:29](src/kpi/kpiSheets.ts:29), [facilitatorSync.ts:40](src/timeline/facilitatorSync.ts:40).
- [ATTENDANCE_CRITICAL.md:83](docs/ATTENDANCE_CRITICAL.md:83) "corsproxy.io는 유료 전환되어 동작 안 함. **코드에 부활시키지 말 것**"과 정면 충돌.
- 영향: Edge Function 미배포 시 출결 조회가 죽은 프록시로 한 번 왕복 실패 후에야 다음 프록시로 넘어감 → 간헐 지연/실패.
- **조치**: 세 곳에서 corsproxy.io 항목 제거(저위험, 내가 가능).

### ③ [중간] Supabase 데이터 클라이언트 10개가 모듈 최상위 eager 생성 — 잠복 회귀
- `createClient` 전수 12곳 중 `persistSession:true`는 [assistantAuth.ts:33](src/auth/assistantAuth.ts:33) **단 1곳(정상)**. 현재 회귀 위험 없음.
- 그러나 데이터 전용 10곳([hrdAttendance.ts:50](src/hrd/hrdAttendance.ts:50), [hrdAnalytics.ts:32](src/hrd/hrdAnalytics.ts:32), [hrdAssistantCheck.ts:18](src/hrd/hrdAssistantCheck.ts:18), [hrdExcusedAbsence.ts:12](src/hrd/hrdExcusedAbsence.ts:12), [instructorSync.ts:104](src/core/instructorSync.ts:104), [supabaseManagement.ts:102](src/core/supabaseManagement.ts:102), instructor 4종)이 전부 모듈 import 시점 즉시 생성.
- 동일 URL로 11개 GoTrueClient → "Multiple GoTrueClient instances" 경고. **누군가 이 중 하나를 persistSession:true로 바꾸면 v3.5.0 즉시 재현**. 가드가 "관례+주석"에만 의존.
- **조치**: 단일 lazy 싱글톤 `getDataClient()`로 통합(read-only만, OAuth 클라이언트는 단일 유지). CLAUDE.md 로드맵 "Phase B 잔여 8곳"과 동일.
- 참고: [hrdContacts.ts:18](src/hrd/hrdContacts.ts:18)·hrdAnalyticsNotes는 이미 `getSharedAuthClient()` 재사용(정상).

### ④ [확인 필요] admin-mode 미활성 → 충돌검사·강사배치 패널 숨김
- `data-page-group="reports"` 섹션 3개(`sectionStaffingAssign`·`sectionParseErrors`·`sectionConflicts`)는 프로덕션에서 [basicModeSections.ts](src/core/basicModeSections.ts)의 `removeBasicModeSections`로 DOM 삭제됨(admin-mode=false일 때). 설계상 dev/admin 전용.
- 그러나 CLAUDE.md 로드맵 #5 "Google JWT 세션 있으나 body.admin-mode 미활성 사례"가 사실이면, **관리자에게 보여야 할 충돌검사가 안 보이는 상태**일 수 있음 → admin-mode 트리거 점검 필요(별도 진단).

---

## 2. 🗂️ 기능 통합 지도 — "페이지가 너무 많다"

### 현재 17개 탭 인벤토리
| nav키 | 라벨 | 목적 | 데이터 소스 |
|---|---|---|---|
| dashboard | 대시보드 | 과정별 KPI 요약 | HRD-Net + Apps Script(교차) |
| timeline | 학사일정 | CSV 타임라인·강사배치·HRD검증 | localStorage/HRD-Net |
| generator | HRD시간표 | 시간표 생성→CSV | localStorage |
| dropout | 하차방어율 | 방어율 KPI + 인사이트 + 주차트래커 | HRD-Net |
| kpi | 자율성과지표 | 재직자 KPI·PDF | Apps Script(독립 도메인) |
| attendance | 출결현황 | 전원 출결 상세·공결·Slack | HRD-Net + Supabase |
| analytics | 출결 리스크 | 인구통계·요일패턴·탈락요인 | HRD-Net + Supabase |
| traineeHistory | 훈련생 이력 | 개인 1명 드릴다운 | HRD-Net |
| achievement | 학업성취도 | 실업자/재직자 성취도 | Apps Script |
| inquiry | 문의응대 | Airtable + 디스코드 분류 | Airtable + Discord |
| satisfaction | 만족도 | NPS·점수 | Apps Script |
| crossAnalysis | 교차분석 | 출결×성취×만족 + 회고리포트 | 타 탭 캐시 조인 |
| revenue | 매출 | 훈련비 매출·엑셀업로드 | HRD-Net + Excel |
| docAutomation | 문서자동화 | 공결·HWPX·서명·인센티브 | Supabase + HWPX |
| instructor | 강사 | 평가·보상·운영진단·교강사진단 4종 허브 | Supabase 4테이블 |
| guideline | 운영지침 | 26년도 매뉴얼 검색·메모 | 정적 + localStorage |
| settings | 설정 | 과정·API·Slack·메뉴·보고팩 | localStorage 등 |

### 실제 중복 클러스터 (겹침도 순)

**A. 출결 데이터 4-탭 클러스터 — 겹침도 상(上) [통합 1순위]**
- attendance / analytics / traineeHistory / dropout 4개 모두 **같은 HRD 출결 데이터를 각자 독립 호출**하고, 관점만 다르게 보여줌.
- 제적위험 분류 공식이 글자 그대로 복제됨: [hrdAttendance.ts:218](src/hrd/hrdAttendance.ts:218) `getRiskLevel()` ≡ [hrdTraineeHistory.ts:19](src/hrd/hrdTraineeHistory.ts:19) ≡ [hrdAnalytics.ts:320](src/hrd/hrdAnalytics.ts:320) 인라인 ≡ [hrdDashboard.ts:42](src/hrd/hrdDashboard.ts:42).
- 거의 동일한 결과 타입 4종(AttendanceStudent/TraineeAnalysis/DashTrainee/DropoutRosterEntry).
- **권장**: 단일 "출결·리스크" 탭 + sub-tab(현황 / 리스크분석 / 개인이력 / 하차방어). 사이드바 −3.
- **선행조건**: student-level 집계를 `hrdAttendanceCore`(가칭) 1곳으로 추출(B-차트/B-위험도/B-종강날짜 공유). 안 하면 탭만 합쳐지고 코드 중복 잔존.

**B. 분석/집계 상하위 클러스터 — 겹침도 상(上)**
- crossAnalysis(+회고)가 최상위 집계자, dashboard가 그 축소판: [hrdDashboard.ts:9](src/hrd/hrdDashboard.ts:9)이 `crossAnalysisData`의 `loadCachedAchievementRecords`/`loadCachedSatisfactionRecords`를 재사용.
- 종합점수·하차방어율·NPS·출결률이 dashboard/crossAnalysis/retrospective/reports에서 각각 재계산.
- **권장**: dashboard를 crossAnalysis의 "요약(Overview)" sub-tab으로 흡수하거나, dashboard를 홈으로 두고 crossAnalysis 분석을 dashboard sub-tab으로 병합. **결정 필요**: dashboard의 "홈" 역할 여부(현재 기본 진입은 timeline — [appState.ts:155](src/ui/appState.ts:155)).

**C. 학습품질 클러스터 — 겹침도 하(下), 그룹화만**
- achievement/satisfaction/inquiry는 데이터 소스·목적이 전부 다름 → **데이터 통합은 비권장**. 단 사이드바 정리를 위해 "학습품질" 상위 그룹 + 내부 pill로 3→1. 기능 손실 없이 메뉴만 −2.

**D. reports(주간보고팩) / kpi — 통합 부적절**
- reports는 사이드바 탭이 아니라 설정 내부 출력 기능. kpi는 Google Sheets 독립 도메인(HRD 출결 무관). 둘 다 IA 통합 대상 아님(코드 중복만 정리, 4장).

### 제안: 사이드바 17 → 9

| 통합 후 탭 | ← 흡수하는 현재 탭 | 형태 |
|---|---|---|
| 학사일정 | timeline | 유지(핵심) |
| **출결·리스크** | attendance + analytics + traineeHistory + dropout | **sub-tab 통합** |
| **분석 허브** | dashboard + crossAnalysis(+회고) | sub-tab 통합 *(결정 필요)* |
| **학습품질** | achievement + satisfaction + inquiry | 그룹화(pill) |
| 자율성과지표 | kpi | 유지(독립 도메인) |
| **운영도구** | generator + revenue + docAutomation | 그룹화 *(대상 결정 필요)* |
| 강사 | instructor | 유지(이미 허브) |
| 운영지침 | guideline | 유지 |
| 설정 | settings | 유지 |

→ **9탭**. CLAUDE.md "16→9" 목표와 일치(기준 16은 guideline 신설 전 카운트, 실제는 17→9).

### 결정이 필요한 항목
1. **출결 4탭 통합** 진행 여부(매일 쓰는 핵심 화면이라 동선 영향 큼).
2. **dashboard ↔ crossAnalysis**: 병합 vs dashboard를 홈으로 유지?
3. **운영도구 묶음**: generator + revenue + docAutomation 3개가 맞나? (데이터 소스 제각각이라 "그룹화"지 "통합" 아님)

---

## 3. 🧹 제거 / 수정 후보 (안 쓰는 기능 + 데드코드)

| 항목 | 종류 | 위험도 | 권장 조치 |
|---|---|---|---|
| `app/{layout,page,LegacyBootstrap}.tsx` + `next.config.mjs` + `next-env.d.ts` | 중단된 Vite→Next 마이그레이션 잔해(react/next 미설치, 배포는 vite만 사용) | 낮 | **삭제** → tsc 에러 23건 중 13건 즉시 해소 |
| `academic-schedule-manager_dist_0.1.0.zip` | 커밋된 빌드 산출물(키 포함) | 낮 | **추적 해제** + `.gitignore` |
| `showSkeleton`/`clearSkeleton` ([hrdCacheUtils.ts:68](src/hrd/hrdCacheUtils.ts:68)) | 미사용 export | 낮 | 삭제 |
| `KdtInstructorPhase`/`KdtCourseSchedule` ([hrdScheduleData.ts:10](src/hrd/hrdScheduleData.ts:10)) | 미사용 타입 export | 낮 | export 제거 |
| `renderTimelineDetail`/`getSessionIsoDate` ([timeline.ts:64](src/ui/features/timeline.ts:64)) | 불필요한 public | 낮 | 내부 함수화 |
| `calcRevenueSummary` 기수별 루프 ([hrdRevenue.ts:197](src/hrd/hrdRevenue.ts:197)) | **기능 결함** — `return true` + `void students`로 집계가 무동작 | 중 | **완성 또는 단순화** (매출 집계 정확도 영향) |
| `send-notification` Edge Function | SMS/이메일 — 코드 완성, **배포 미확인** | 높(미동작) | 배포 확인 또는 UI에서 비활성 표시 |
| `hrdDropoutWeeklySeed.ts` 257건 시드 | 하드코딩 임시 데이터(갱신마다 재배포) | 중 | 폼/엑셀 업로드로 전환 |
| `data-page-group="reports"` 3개 섹션 | dev/admin 전용(프로덕션 DOM 삭제) | 낮 | 보류(④ admin-mode 점검과 함께) |
| `src/kpi/appsScript.js` | Vite 빌드 제외 참조용 | 낮 | 보류(문서화) |
| 회고리포트 / 데모샘플 로드 | 저활용 의심(완성도 높음) | 중 | 보류(사용빈도 확인 후) |

> 외부 의존 대기로 알려진 "재직자 유닛리포트 API"는 실제로 [hrdEmployedApi.ts](src/hrd/hrdEmployedApi.ts) 코드 완성 + 설정 입력란 존재 → **스텁 아님, 제거 후보 아님**(URL만 미설정).

---

## 4. 🔧 코드품질 부채 (점진 개선)

**① 코드 중복(DRY) — 통합 quick-win**
- **종강 추정 날짜** `end = start + ceil(totalDays/5*7)` 6+곳 복붙([hrdDashboard.ts:91](src/hrd/hrdDashboard.ts:91), hrdAnalytics×3, hrdAttendance.ts:999, hrdScheduler.ts:298, weeklyOpsReportSelectors.ts:45) → `core/estimateCourseEndDate()`.
- **localStorage 24h 캐시** 8+곳 복붙 → `hrdCacheUtils.ts`에 `loadTtlCache<T>`/`saveTtlCache<T>` 추가(현재 제네릭 헬퍼 부재가 원인).
- **CORS 프록시 fallback** 3곳([hrdApi.ts:108](src/hrd/hrdApi.ts:108), kpiSheets.ts, facilitatorSync.ts) → `core/corsProxy.ts`(corsproxy.io 제거와 함께).
- **CSV 파서** 정본 [core/csv.ts](src/core/csv.ts) vs 복사본 [kpiSheets.ts:48](src/kpi/kpiSheets.ts:48); **`esc()` HTML escape** 정본 [core/escape.ts:15](src/core/escape.ts:15) 두고 6곳 로컬 재정의; **차트 destroyCharts/팔레트** 6곳·5곳 복붙 → `core/chartTheme.ts`.

**② main.ts 2,423줄 분해**
- 최대 덩어리는 **학사일정 도메인(~1,400줄)이 main.ts에 인라인** → 713 kB eager 번들의 주범.
- 제안: 학사일정 도메인 → `src/schedule/scheduleTabInit.ts`로 추출 + tabRegistry lazy-load 등록(기존 패턴) → index 번들 500 kB 이하 진입. 이벤트 핸들러 래퍼 ~50개 → `main.handlers.ts`. 인증 게이트는 부팅 임계경로라 잔류.

**③ XSS escape — 레거시 대형 파일 미적용**
- innerHTML 264회 vs escapeHtml 152회. 신규 모듈은 escape 정상, 레거시 출결/분석은 미적용. 예: [hrdAttendance.ts:542](src/hrd/hrdAttendance.ts:542) `${s.name}` un-escaped(데이터 출처가 정부 API 실명이라 심각도 낮으나 defense-in-depth 공백). CLAUDE.md "218 innerHTML escape" 백로그의 실체.

**④ tsc 23 에러 → CI 타입체크 부재**
- 10건 `app/` 죽은코드(3장 삭제로 해소), 11건 src(staffing.ts 인덱싱 5, hrdDashboard 타입중복 3, appState 미정의 2, hrdRevenueInit 1), 2건 test fixture.
- 제안: `app/` 제거 → src 11건 수정 → CI `pages.yml`에 `tsc --noEmit` 추가(회귀를 타입단에서 차단).

**⑤ CSS 디자인토큰 위반**
- 하드코딩 색상 ~1,048개(hex 887 + rgba 161) vs `--` 변수 94개. CLAUDE.md "하드코딩 색상 금지" 위반(시각 정상, 유지보수 부채). 신규 코드부터 변수 강제 + 점진 토큰화.

**⑥ 기타**: silent catch 9곳(대부분 의도적, console.warn 권장), 거대 render 함수(hrdAnalytics `renderOverviewTab` ~450줄, hrdAttendance `setupSettingsHandlers` ~479줄) 분할.

---

## 5. 테스트 갭

- **잘 커버됨**: `core/` 순수 도메인 로직 집중 + weeklyOpsReport(27)·hrdDropoutInsights(23)·assistantAuth(인증).
- **0 테스트 대형 영역**: instructor/(Supabase CRUD), crossAnalysis/(retrospective 1,152줄), docAutomation/(hwpxGenerator), 그리고 **앱 핵심인 출결조회 본체(hrdAttendance/hrdApi/hrdAnalytics)** 자동 테스트 없음 → 회귀 방어를 ATTENDANCE_CRITICAL.md 수동 체크리스트에만 의존.
- 제안: hrdApi fallback 우선순위(corsproxy.io 포함 여부 가드!)·parseResponse·위험도 계산 단위테스트 추가.

---

## 6. 우선순위 로드맵

| Phase | 내용 | 영향 | 작업량 | 출결 영향 |
|---|---|---|---|---|
| **0. 핫픽스(즉시)** | corsproxy.io 제거(1-②) · `app/`+zip 정리(3장, tsc −13) · authKey 비우기는 Edge Function 배포 후(1-①) | 안정성↑ | 낮 | 없음(순서 준수 시) |
| **1. 코어 추출** | 출결 student-level 코어 단일화(위험도/종강/캐시/차트) + Supabase 싱글톤(1-③) | 높 | 중 | 회귀주의(체크리스트) |
| **2. IA 통합** | 출결 4→1 sub-tab · 학습품질 3→1 그룹 · 분석 허브 정리 | 높(체감) | 중~높 | 동선변경 |
| **3. 정비** | tsc 11건+CI · main.ts 분해(번들↓) · 출결 단위테스트 · XSS escape | 중 | 중 | 없음 |

**미해결/확인 필요**: ① dashboard "홈" 역할 여부 ② 운영도구 묶음 대상 3개 ③ admin-mode 미활성 사례(④) ④ send-notification 배포 상태.
