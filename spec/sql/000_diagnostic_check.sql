-- ═══════════════════════════════════════════════════════════════
-- Supabase 현황 진단 (2026-05-12)
-- ═══════════════════════════════════════════════════════════════
-- 목적: SQL 적용 전 현재 테이블/정책 상태를 정확히 파악
-- 영향: 읽기 전용 — 데이터/스키마 변경 없음
--
-- 실행 방법:
--   1. Supabase Dashboard → SQL Editor
--   2. 아래 4개 쿼리를 순차 실행 (또는 한 번에)
--   3. 결과를 캡처해서 다음 단계 판단
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. 보안 대상 테이블 존재 여부 ──────────────────────────
SELECT
  t.table_name,
  CASE WHEN c.relrowsecurity THEN 'ENABLED' ELSE 'DISABLED' END AS rls_status,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
  (SELECT count(*) FROM pg_policies WHERE tablename = t.table_name AND schemaname = 'public') AS policy_count
FROM information_schema.tables t
JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'excused_absence_requests',
    'project_evaluations',
    'project_rewards',
    'operation_diagnosis',
    'instructor_diagnosis',
    'course_cohort_notes',
    'trainee_contacts'
  )
ORDER BY t.table_name;

-- ─── 2. 현재 RLS 정책 전체 조회 ─────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual AS using_clause,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'excused_absence_requests',
    'project_evaluations',
    'project_rewards',
    'operation_diagnosis',
    'instructor_diagnosis',
    'course_cohort_notes',
    'trainee_contacts'
  )
ORDER BY tablename, cmd;

-- ─── 3. 익명 접근 위험도 평가 ───────────────────────────────
-- "anon_all" 정책이 남아있는 테이블 = 즉시 강화 필요
SELECT
  tablename,
  COUNT(*) FILTER (WHERE 'anon' = ANY(roles)) AS anon_policies,
  COUNT(*) FILTER (WHERE 'authenticated' = ANY(roles)) AS auth_policies,
  COUNT(*) FILTER (WHERE policyname = 'anon_all') AS legacy_anon_all
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'excused_absence_requests',
    'project_evaluations',
    'project_rewards',
    'operation_diagnosis',
    'instructor_diagnosis',
    'course_cohort_notes',
    'trainee_contacts'
  )
GROUP BY tablename
ORDER BY legacy_anon_all DESC, anon_policies DESC;

-- ─── 4. 강사 4종 테이블 데이터 건수 (테이블이 있는 경우만) ──
-- 데이터가 이미 있다면 운영 중 — 스키마 변경 신중
DO $$
DECLARE
  rec RECORD;
  cnt INTEGER;
BEGIN
  FOR rec IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('project_evaluations', 'project_rewards', 'operation_diagnosis', 'instructor_diagnosis', 'course_cohort_notes', 'trainee_contacts', 'excused_absence_requests')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', rec.table_name) INTO cnt;
    RAISE NOTICE '% : % rows', rec.table_name, cnt;
  END LOOP;
END $$;
