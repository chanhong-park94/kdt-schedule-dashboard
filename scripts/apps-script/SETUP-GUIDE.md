# 공가 신청/증빙자료 Slack 알림 설정 가이드

## 개요

Google Forms로 공가 신청서 또는 증빙자료가 제출되면:
1. **Supabase**에 자동 저장 (대시보드 공결 탭에서 조회 가능)
2. **Slack 전용 채널**에 알림 발송 (담당 매니저 태깅 포함)

## 설정 순서

### 1단계: Apps Script 열기

각 응답 시트에서 **별도로** 설정해야 합니다 (총 2회).

1. **공가 신청서 응답 시트** 열기
2. 메뉴 → `확장 프로그램` → `Apps Script` 클릭
3. `Code.gs` 내용을 `excused-absence-notify.gs`로 교체
4. 저장 (Ctrl+S)

### 2단계: 스크립트 속성 설정

Apps Script 에디터에서:
`프로젝트 설정` (⚙️) → `스크립트 속성` → `스크립트 속성 추가`

#### 공가 신청서 시트용:

| 속성 키 | 값 | 설명 |
|---------|-----|------|
| `FORM_TYPE` | `application` | 신청서 구분 |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/services/...` | 공결신청 전용 채널 Webhook |
| `SUPABASE_URL` | `https://ltywspfpyjhrmkgiarti.supabase.co` | Supabase URL |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Supabase Anon Key |
| `COURSE_MANAGERS` | `{"재직자 LLM":"U12345","AI 활용":"U67890"}` | 과정별 매니저 Slack ID |
| `FOOTER_TEXT` | `📍 모두의연구소 HRD 운영팀` | (선택) 푸터 텍스트 |

#### 증빙자료 시트용:

| 속성 키 | 값 |
|---------|-----|
| `FORM_TYPE` | `evidence` |
| 나머지 | 위와 동일 |

### 3단계: 트리거 등록

1. Apps Script 에디터에서 `setupTrigger` 함수 선택
2. ▶️ 실행 클릭
3. Google 계정 권한 승인
4. 로그에 "✅ onFormSubmit 트리거가 등록되었습니다." 확인

### 4단계: 테스트

1. `testSlackMessage` 함수 실행 → Slack 채널에 테스트 알림 도착 확인
2. 실제 Google Forms에서 테스트 제출 → 알림 + Supabase 저장 확인

## COURSE_MANAGERS 매핑 형식

```json
{
  "재직자 LLM": "U12345,U67890",
  "AI 활용 서비스": "U11111",
  "데이터 기반 의사결정": "U22222,U33333",
  "데이터사이언티스트": "U44444",
  "데이터분석": "U55555",
  "아이펠딥러닝": "U66666"
}
```

- **키**: 과정명 (부분 매칭 지원 — "재직자 LLM"은 "재직자 LLM 6기"에 매칭)
- **값**: Slack 멤버 ID (쉼표 구분으로 여러 명 지정 가능)

### Slack 멤버 ID 확인 방법

1. Slack에서 멤버 프로필 클릭
2. `⋮` 더보기 → `멤버 ID 복사` 클릭
3. `U` 로 시작하는 ID 사용 (예: `U05N8PQ1234`)

## Slack 알림 예시

### 📋 공가 신청 알림
```
📋 *[공가 신청 알림]*
━━━━━━━━━━━━━━━━━
👤 *신청자:* 홍길동
🎓 *과정:* 재직자 LLM 6기
📅 *신청일:* 2026-03-24
📌 *사유:* 병원 진료
👤 *담당:* @박찬홍

⚠️ 증빙자료 제출을 확인해주세요.
━━━━━━━━━━━━━━━━━
📍 모두의연구소 HRD 운영팀
```

### 📎 증빙자료 제출 알림
```
📎 *[공가 증빙자료 제출 알림]*
━━━━━━━━━━━━━━━━━
👤 *제출자:* 홍길동
🎓 *과정:* 재직자 LLM 6기
📄 *증빙자료:* 제출 완료 ✅
👤 *담당:* @박찬홍

✅ 증빙자료가 확인되었습니다. 공결 처리를 진행해주세요.
━━━━━━━━━━━━━━━━━
📍 모두의연구소 HRD 운영팀
```

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 알림이 안 옴 | 트리거 미등록 | `setupTrigger()` 재실행 |
| 403 에러 | Webhook URL 오류 | Slack 앱 설정에서 URL 재확인 |
| Supabase 401 | Anon Key 오류 | SUPABASE_ANON_KEY 재설정 |
| 매니저 미지정 표시 | 매핑 누락 | COURSE_MANAGERS에 해당 과정 추가 |
| 두 폼 모두 같은 타입 | FORM_TYPE 동일 | 각 시트별로 다른 값 설정 확인 |
