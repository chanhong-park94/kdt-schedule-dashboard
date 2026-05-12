-- ═══════════════════════════════════════════════════════════════
-- 강사 대시보드 RLS 강화 Phase 1 (2026-05-12)
-- ═══════════════════════════════════════════════════════════════
-- 목적: 008로 생성된 4개 테이블의 anon_all (FOR ALL) 정책을 분리하여
--   ① DELETE 차단 (앱이 사용 안 함, 공격자가 대량 삭제 못 하게)
--   ② INSERT/UPDATE에 입력 검증 추가 (점수 범위, 길이 제한)
--   ③ SELECT는 운영 호환성을 위해 유지 (운매·강사 모두 anon)
--
-- ⚠️ 한계:
--   강사(보조강사 코드 로그인)와 운매(Google 로그인)가 동일 anon 키를 쓰는
--   현재 구조에서는 RLS만으로 "운매만 채점 가능" 같은 분리 불가능.
--   진정한 분리는 다음 phase에서 Supabase Auth 익명 가입(anonymous sign-in)
--   으로 강사에게도 JWT를 부여하고 그 JWT의 claims로 RLS를 거는 방식 필요.
--
--   이 008b는 그 전까지의 임시 강화책 — 입력 오염 + 대량 삭제 차단만 보장.
--
-- 적용 전제: 008_create_instructor_dashboard.sql 실행 완료
-- 영향 테이블: project_evaluations, project_rewards, operation_diagnosis, instructor_diagnosis
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. 기존 anon_all 정책 제거 ─────────────────────────────
DROP POLICY IF EXISTS "anon_all" ON project_evaluations;
DROP POLICY IF EXISTS "anon_all" ON project_rewards;
DROP POLICY IF EXISTS "anon_all" ON operation_diagnosis;
DROP POLICY IF EXISTS "anon_all" ON instructor_diagnosis;

-- ═══════════════════════════════════════════════════════════════
-- project_evaluations
-- ═══════════════════════════════════════════════════════════════
CREATE POLICY "read_all" ON project_evaluations
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "insert_validated" ON project_evaluations
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(train_pr_id) > 0 AND length(train_pr_id) < 50
    AND length(degr) > 0 AND length(degr) < 10
    AND length(trainee_name) > 0 AND length(trainee_name) < 100
    AND project_number BETWEEN 1 AND 4
    AND score >= 0 AND score <= 100
    AND length(coalesce(feedback, '')) <= 5000
    AND length(coalesce(evaluated_by, '')) <= 100
  );

CREATE POLICY "update_validated" ON project_evaluations
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (
    project_number BETWEEN 1 AND 4
    AND score >= 0 AND score <= 100
    AND length(coalesce(feedback, '')) <= 5000
    AND length(coalesce(evaluated_by, '')) <= 100
  );

-- DELETE 정책 없음 → 전원 차단

-- ═══════════════════════════════════════════════════════════════
-- project_rewards (운매 전용 — 입력 더 엄격)
-- ═══════════════════════════════════════════════════════════════
CREATE POLICY "read_all" ON project_rewards
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "insert_validated" ON project_rewards
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(train_pr_id) > 0 AND length(train_pr_id) < 50
    AND length(degr) > 0 AND length(degr) < 10
    AND length(trainee_name) > 0 AND length(trainee_name) < 100
    AND project_number BETWEEN 1 AND 4
    AND score >= 0 AND score <= 100
    AND length(coalesce(execution_date, '')) <= 20
    AND length(coalesce(executed_by, '')) <= 100
  );

CREATE POLICY "update_validated" ON project_rewards
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (
    project_number BETWEEN 1 AND 4
    AND score >= 0 AND score <= 100
    AND length(coalesce(execution_date, '')) <= 20
    AND length(coalesce(executed_by, '')) <= 100
  );

-- DELETE 차단

-- ═══════════════════════════════════════════════════════════════
-- operation_diagnosis
-- ═══════════════════════════════════════════════════════════════
CREATE POLICY "read_all" ON operation_diagnosis
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "insert_validated" ON operation_diagnosis
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(train_pr_id) > 0 AND length(train_pr_id) < 50
    AND length(degr) > 0 AND length(degr) < 10
    AND length(trainee_name) > 0 AND length(trainee_name) < 100
    AND unit_number BETWEEN 1 AND 12
    AND length(diagnosis_date) > 0 AND length(diagnosis_date) < 20
    AND attendance_score IN (0, 5, 10)
    AND attitude_score IN (0, 5, 10)
    AND communication_score IN (0, 5, 10)
    AND length(coalesce(diagnosed_by, '')) <= 100
  );

CREATE POLICY "update_validated" ON operation_diagnosis
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (
    unit_number BETWEEN 1 AND 12
    AND attendance_score IN (0, 5, 10)
    AND attitude_score IN (0, 5, 10)
    AND communication_score IN (0, 5, 10)
    AND length(coalesce(diagnosed_by, '')) <= 100
  );

-- DELETE 차단

-- ═══════════════════════════════════════════════════════════════
-- instructor_diagnosis
-- ═══════════════════════════════════════════════════════════════
CREATE POLICY "read_all" ON instructor_diagnosis
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "insert_validated" ON instructor_diagnosis
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(train_pr_id) > 0 AND length(train_pr_id) < 50
    AND length(degr) > 0 AND length(degr) < 10
    AND length(trainee_name) > 0 AND length(trainee_name) < 100
    AND unit_number BETWEEN 1 AND 12
    AND first_score >= 0 AND first_score <= 5
    AND second_score >= 0 AND second_score <= 5
    AND length(coalesce(diagnosed_by, '')) <= 100
  );

CREATE POLICY "update_validated" ON instructor_diagnosis
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (
    unit_number BETWEEN 1 AND 12
    AND first_score >= 0 AND first_score <= 5
    AND second_score >= 0 AND second_score <= 5
    AND length(coalesce(diagnosed_by, '')) <= 100
  );

-- DELETE 차단

-- ═══════════════════════════════════════════════════════════════
-- 검증 쿼리
-- ═══════════════════════════════════════════════════════════════
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE tablename IN ('project_evaluations', 'project_rewards', 'operation_diagnosis', 'instructor_diagnosis')
-- ORDER BY tablename, cmd;
--
-- 예상: 각 테이블당 3개 정책 (read_all SELECT, insert_validated INSERT, update_validated UPDATE)
-- DELETE 정책 없음 → DELETE 시도 시 RLS로 차단됨
-- ═══════════════════════════════════════════════════════════════
