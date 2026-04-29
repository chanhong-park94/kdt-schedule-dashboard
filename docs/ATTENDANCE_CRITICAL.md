# 출결조회 핵심기능 — 회귀 방지 가이드

> ⚠️ **출결조회는 이 앱의 핵심 기능입니다.** 운매/강사 모두 매일 사용하며, 한 번 깨지면
> 전체 운영이 멈춥니다. 기능 개선 / 리팩토링 / 의존성 변경 시 반드시 이 문서를 먼저
> 읽고, 마지막의 [회귀 방지 체크리스트](#회귀-방지-체크리스트)를 통과시킨 후 머지하세요.

---

## 1. 데이터 흐름 (운매 / 강사 공통)

```
[출결현황 탭 진입]
     │
     ▼
[과정/기수 선택 + "조회" 클릭]   ← 강사 모드는 자동 트리거
     │
     ▼
src/hrd/hrdAttendance.ts (또는 features/attendance.ts)
     │
     ▼
src/hrd/hrdApi.ts
  ├─ fetchRoster(config, trainPrId, degr)
  └─ fetchAttendance(config, trainPrId, degr, dates)
     │
     ▼
[1순위] Supabase Edge Function: hrd-proxy
   └─ supabase/functions/hrd-proxy/index.ts (Deno.env 로 authKey 보호)
     │
     ▼ (Edge Function 미배포 / 5xx 시 폴백)
[2순위] CORS 프록시 fallback
   └─ cors.eu.org (※ corsproxy.io 는 2026-04 부터 유료 전환되어 사용 불가)
     │
     ▼
HRD-Net API
```

**캐시:** `edgeFunctionAvailable` 플래그가 세션 1회만 시도 → 결정. fallback 폭주 방지.

---

## 2. 인증 모드별 동작 차이

| 항목 | 운매 (Google Workspace) | 강사 (assistant_codes) |
|---|---|---|
| 로그인 방식 | Google OAuth (`@modulabs.co.kr`) | 코드 입력 (`assistant_codes` 테이블 검증) |
| Supabase role | `authenticated` (OAuth JWT) | `anon` (anon key only) |
| 과정/기수 선택 | 드롭다운 자유 선택 | 강제 고정 (세션의 trainPrId/degr) |
| 출결현황 진입 | 수동 탭 이동 | 강제 자동 이동 (`applyAssistantMode()`) |
| 자동 조회 | 수동 클릭 | 진입 시 자동 (`populateFilter()` 내 `void loadData()`) |
| SMS/이메일 발송 | 가능 | **차단** (개인정보 보호, [hrdNotify.ts:172](../src/hrd/hrdNotify.ts:172)) |
| 연락처 조회/저장 | 가능 (현재는 anon RLS, 향후 RLS 적용 예정) | RLS 적용 후 차단 예정 |

---

## 3. 위험 영역 — 만지면 출결조회 깨지는 곳

### 🔴 A. Supabase 클라이언트 OAuth 콜백 충돌 (이력 v3.5.0 → v3.5.1 회귀)

**규칙: 같은 `SUPABASE_URL` 로 만든 `createClient()` 호출 중 `persistSession:true + detectSessionInUrl:true` 를 둘 다 가진 인스턴스는 단 하나여야 한다.**

- 현재 OAuth 콜백 파싱 단독 책임자: [src/auth/assistantAuth.ts:32-34](../src/auth/assistantAuth.ts:32) `authClient`
- 다른 클라이언트들은 모두 다음 중 하나여야 함:
  - `persistSession: false` + `detectSessionInUrl: false` (anon 전용)
  - 또는 `getClient()` 류의 **lazy 초기화** 패턴 (모듈 import 시점에 createClient 호출 안 함)

**이유:** 두 인스턴스가 default storage key (`sb-<project_ref>-auth-token`)를 공유한다. 부팅 시 둘 다 `window.location.hash`를 파싱하려 하면 토큰 storage 락이 충돌해서 OAuth 토큰이 corrupt/wipe 됨. 이후 모든 fetch 가 401 또는 무한 로딩.

**최근 사례:**
- `0deb11f` 커밋이 [hrdContacts.ts:19](../src/hrd/hrdContacts.ts:19) 를 `persistSession:true` 로 변경 → 운매/강사 양쪽 출결조회 실패
- `e428258` 핫픽스로 원복

**검사 명령:**
```bash
grep -n "persistSession\|detectSessionInUrl" $(find src -name "*.ts" -exec grep -l "createClient(" {} \;)
```
→ `persistSession:true`가 즉시-실행 (모듈 최상위) 클라이언트에 한 곳만 있어야 함.

---

### 🔴 B. HRD-Net 프록시 체인

- [src/hrd/hrdApi.ts](../src/hrd/hrdApi.ts) 의 fallback 우선순위는 **Edge Function → cors.eu.org** 순.
- `corsproxy.io`는 **유료 전환되어 동작하지 않음** (2026-04 이후). 코드에 부활시키지 말 것.
- `authKey` 는 절대 클라이언트 번들에 하드코딩 금지. Edge Function `Deno.env` 로만 보관.
- Edge Function 배포 상태 확인: `supabase/functions/hrd-proxy/DEPLOY.md`

---

### 🔴 C. 모듈 import 사이드이펙트

- 출결현황은 `main.ts` 부팅 시 거치는 모듈들에 의존. 강사 대시보드 / 연락처 / 보상 등 다른 탭의 모듈 init 코드가 Supabase 클라이언트, sessionStorage, OAuth 콜백에 부작용을 주면 출결조회까지 영향.
- **새 모듈 추가 시:**
  - `createClient()` 호출은 `getClient()` 래퍼로 lazy 초기화
  - 모듈 최상위에서 `sessionStorage.setItem`, `location.hash` 파싱 금지
  - `getAssistantSession()` 같은 read-only 호출만 OK

---

### 🟡 D. RLS 정책 변경

- `trainee_contacts` 테이블의 RLS가 **현재 `anon_all` 상태**임 (010 SQL 미적용).
- 010 SQL을 적용하기 전에 반드시 [hrdContacts.ts](../src/hrd/hrdContacts.ts) 가 `assistantAuth.ts` 의 `authClient` 를 공유하도록 리팩토링 PR 머지가 선행되어야 함. 그렇지 않으면 운매도 연락처 탭에서 401.

---

## 4. 회귀 방지 체크리스트

PR 머지 전 다음을 모두 통과해야 출결현황 영향 변경으로 분류된 PR을 머지할 수 있습니다.

### 📋 사전 점검
- [ ] **검사 1**: `grep -rn "createClient(" src/ | grep -v test` 결과의 모든 호출 지점 확인. `persistSession:true + detectSessionInUrl:true` 가 즉시-실행되는 곳이 정확히 1개(`assistantAuth.ts authClient`) 인가?
- [ ] **검사 2**: 새로 추가된 모듈이 모듈 최상위에서 `createClient()` 호출하는지 확인. 했다면 `getClient()` lazy 패턴으로 전환했는가?
- [ ] **검사 3**: 새로 추가된 모듈이 `sessionStorage.setItem` 또는 `location.hash` 파싱을 모듈 최상위에서 하는가? (금지)

### 📋 빌드/테스트
- [ ] `npm run build` 성공
- [ ] `npm run test -- --run` 모두 통과
- [ ] `dist/assets/index-*.js` 에서 `grep -oE "persistSession:[!a-z0]+" | sort -u` 결과가 `persistSession:!` (false), `persistSession:!0` (true) 둘 다 포함하면 OK. 만약 `persistSession:!0` 만 여러 개 보이면 충돌 위험.

### 📋 라이브 검증 (배포 후 필수)
- [ ] **운매 모드**: Google 로그인 → 출결현황 → 과정/기수 선택 → 조회 → 명단·출결 정상 표시
- [ ] **강사 모드**: 보조강사 코드 로그인 → 출결현황 자동 진입 → 명단·출결 정상 표시
- [ ] 두 모드 모두 콘솔 에러 0건
- [ ] localStorage 에 `sb-` 시작 키가 깨진 형태(빈 객체, "Invalid Refresh Token") 없음

### 📋 OAuth 토큰 의심 시 복구 절차
1. DevTools → Application → Storage → Clear site data
2. 페이지 새로고침
3. Google 로그인 다시 진행
4. 그래도 실패면 시크릿 창에서 재시도

---

## 5. 변경 이력 (출결조회 영향)

| 날짜 | 커밋 | 변경 | 결과 |
|---|---|---|---|
| 2026-04-29 | e428258 | hrdContacts.ts persistSession:false 복귀 | ✅ 회귀 핫픽스 |
| 2026-04-29 | 0deb11f | hrdContacts.ts persistSession:true 적용 | ❌ 양쪽 모드 출결조회 실패 |
| 2026-04-16 | (사례없음) | corsproxy.io 유료 전환 | ⚠️ 2순위 프록시 사용 불가 |
| 2026-03-29 | - | Google Workspace 로그인 도입 | OAuth 클라이언트 신규 |

---

## 6. 관련 코드 빠른 링크

- 출결조회 UI 핸들러: [src/hrd/hrdAttendance.ts](../src/hrd/hrdAttendance.ts)
- HRD-Net API 호출: [src/hrd/hrdApi.ts](../src/hrd/hrdApi.ts)
- Edge Function: [supabase/functions/hrd-proxy/index.ts](../supabase/functions/hrd-proxy/index.ts)
- OAuth 클라이언트: [src/auth/assistantAuth.ts](../src/auth/assistantAuth.ts)
- 강사 모드 진입: [src/main.ts `applyAssistantMode()`](../src/main.ts)
- 연락처 모듈 (출결조회와 분리 유지 필수): [src/hrd/hrdContacts.ts](../src/hrd/hrdContacts.ts)
- SMS 발송 가드: [src/hrd/hrdNotify.ts `isAssistantBlocked()`](../src/hrd/hrdNotify.ts)
