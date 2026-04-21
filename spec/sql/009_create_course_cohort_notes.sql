-- ═══════════════════════════════════════════════════════════════
-- 과정·기수별 담당자 메모 (2026-04-21)
-- ═══════════════════════════════════════════════════════════════
-- 목적: 훈련생분석 탭의 과정·기수 단위 메모 저장
--   - 평균출석률/남은결석가능일수는 자동 계산 (저장 X)
--   - 위험도 + 특이사항만 수동 입력 저장
--
-- 보안:
--   - anon 완전 차단 (민감 정보 포함 가능)
--   - @modulabs.co.kr 도메인만 접근
--   - updated_by_email은 서버(JWT)에서 강제 — 클라이언트 위조 불가
--   - DELETE 금지 (이력 보존)
--
-- 적용 방법:
--   1. Supabase Dashboard → SQL Editor
--   2. 아래 내용 복사 → Run
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.course_cohort_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_name text NOT NULL,
  degr text NOT NULL,
  risk_level text NOT NULL DEFAULT 'safe'
    CHECK (risk_level IN ('safe', 'caution', 'warning', 'danger')),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  updated_by_email text NOT NULL DEFAULT '',
  updated_by_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_name, degr)
);

CREATE INDEX IF NOT EXISTS idx_course_cohort_notes_lookup
  ON public.course_cohort_notes (course_name, degr);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.course_cohort_notes ENABLE ROW LEVEL SECURITY;

-- 기존 정책 제거 (재실행 시 안전)
DROP POLICY IF EXISTS "modulabs_select" ON public.course_cohort_notes;
DROP POLICY IF EXISTS "modulabs_insert" ON public.course_cohort_notes;
DROP POLICY IF EXISTS "modulabs_update" ON public.course_cohort_notes;

-- SELECT — 모듈러스 계정만
CREATE POLICY "modulabs_select" ON public.course_cohort_notes
  FOR SELECT TO authenticated
  USING (auth.jwt()->>'email' LIKE '%@modulabs.co.kr');

-- INSERT — 모듈러스 계정만 + updated_by_email 위조 방지
CREATE POLICY "modulabs_insert" ON public.course_cohort_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.jwt()->>'email' LIKE '%@modulabs.co.kr'
    AND updated_by_email = auth.jwt()->>'email'
  );

-- UPDATE — 모듈러스 계정만 + updated_by_email 위조 방지
CREATE POLICY "modulabs_update" ON public.course_cohort_notes
  FOR UPDATE TO authenticated
  USING (auth.jwt()->>'email' LIKE '%@modulabs.co.kr')
  WITH CHECK (
    auth.jwt()->>'email' LIKE '%@modulabs.co.kr'
    AND updated_by_email = auth.jwt()->>'email'
  );

-- DELETE 정책 없음 → 전원 차단 (이력 보존)

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.touch_course_cohort_notes_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_course_cohort_notes_touch ON public.course_cohort_notes;
CREATE TRIGGER trg_course_cohort_notes_touch
  BEFORE UPDATE ON public.course_cohort_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_course_cohort_notes_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 검증 쿼리
-- ═══════════════════════════════════════════════════════════════
-- SELECT policyname, cmd, roles
-- FROM pg_policies
-- WHERE tablename = 'course_cohort_notes'
-- ORDER BY cmd;
--
-- 예상 결과:
--   modulabs_insert | INSERT | {authenticated}
--   modulabs_select | SELECT | {authenticated}
--   modulabs_update | UPDATE | {authenticated}
-- ═══════════════════════════════════════════════════════════════
