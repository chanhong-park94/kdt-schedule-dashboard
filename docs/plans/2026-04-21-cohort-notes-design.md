# 과정·기수별 담당자 메모 기능 설계

**작성일**: 2026-04-21
**대상 탭**: 훈련생분석 (analytics)
**관련 파일**:
- `src/hrd/hrdAnalyticsNotes.ts` (신규)
- `src/hrd/hrdAnalytics.ts` (수정)
- `src/style.css` (추가)
- `spec/sql/009_create_course_cohort_notes.sql` (신규)

## 배경

훈련생분석 탭의 과정·기수 현황표에서 담당자가 현황을 조회할 때, 자동 계산 지표
(평균출석률/남은결석가능일수)와 수동 입력 메모(위험도/특이사항)를 한 화면에서
관리할 필요가 있다.

## 결정 요약

| 항목 | 결정 |
|---|---|
| 저장 위치 | Supabase `course_cohort_notes` 테이블 + localStorage 폴백(위험도만) |
| UI | 모든 필터(전체/진행중/종강) 행 클릭 시 확장 패널에 표시 |
| 자동/수동 | 평균출석률·남은결석가능일수는 자동, 위험도·특이사항만 수동 입력 |
| 위험도 | 4단계 (🟢 안전 / 🟡 주의 / 🟠 경고 / 🔴 위험) |
| 남은결석가능일수 | 최소값 + 임박(≤3일) 학생 수 |
| 작성자 표시 | 로그인 이메일 로컬파트(예: `ch.park`) + 수정일시 |

## 보안 설계

### 리스크
1. **특이사항에 학생 PII/민감정보 기입 가능성** — 가장 큰 위험
2. **Supabase anon key로 외부 조회 가능성** — 기존 테이블 다수가 `anon_all` 상태
3. **localStorage 평문 저장** — 로컬 디스크/백업 유출

### 완화책
- **A. DB RLS** — `@modulabs.co.kr` 도메인만 SELECT/INSERT/UPDATE 허용, anon 완전 차단,
  DELETE 전원 금지(이력 보존)
- **A-2. 위조 방지** — INSERT/UPDATE 시 `updated_by_email = auth.jwt()->>'email'`을 RLS에서 강제
- **B. PII 감지** — 저장 직전 regex 검사(휴대폰/주민번호/실명+호칭/이메일) → confirm
- **B-2. Placeholder 경고문** — "학생 실명·연락처·건강정보 입력 금지"
- **B-3. 1000자 제한** — textarea maxlength + DB CHECK
- **C. localStorage 폴백 축소** — 위험도만 로컬 저장, 특이사항은 DB 실패 시 저장하지 않음

## 데이터 모델

```sql
CREATE TABLE course_cohort_notes (
  id uuid PK,
  course_name text NOT NULL,
  degr text NOT NULL,
  risk_level text CHECK (safe|caution|warning|danger),
  notes text CHECK (length <= 1000),
  updated_by_email text,
  updated_by_name text,
  updated_at timestamptz (trigger로 자동 갱신),
  created_at timestamptz,
  UNIQUE (course_name, degr)
);
```

## UI 흐름

1. 훈련생분석 탭 → 과정·기수별 현황표에서 행 클릭
2. 확장 패널 펼침 (모든 필터 공통)
3. 확장 시 `hydrateCohortNoteSection` 호출 → Supabase 조회
4. 자동 계산 블록 + 편집 폼 렌더
5. 저장 버튼 클릭 → PII 감지 → upsert → 성공/실패 상태 표시

## 의존성

사용자 조치 필요:
- `spec/sql/009_create_course_cohort_notes.sql`을 Supabase SQL Editor에서 실행
- Google OAuth로 로그인된 상태여야 저장 가능 (특이사항)
