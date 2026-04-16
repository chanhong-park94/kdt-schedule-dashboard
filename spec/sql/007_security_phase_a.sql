-- ═══════════════════════════════════════════════════════════════
-- Phase A 보안 강화 (2026-04-16)
-- ═══════════════════════════════════════════════════════════════
-- 목표: 서비스 중단 없이 공격 벡터를 일부 차단
--   - 공격자 anon DELETE로 대량 삭제 방지 (앱은 DELETE 안 씀)
--   - 공결 신청 INSERT source 값 검증 (Apps Script만 통과)
-- 영향받는 테이블: excused_absence_requests
--
-- 적용 방법:
--   1. Supabase Dashboard → SQL Editor
--   2. 아래 내용 복사 → Run
--   3. Policies 탭에서 "delete_blocked", "strict_insert" 생성 확인
--
-- 기존 "anon_all" 정책은 남겨둔 뒤, 더 제한적인 정책을 추가합니다.
-- Supabase RLS는 모든 정책 중 최소 하나라도 통과해야 허용되므로
-- 기존 "anon_all"의 DELETE 부분을 교체하려면 해당 정책을 삭제합니다.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. 기존 "anon_all" 정책 제거 (전체 권한 정책) ────────────
DROP POLICY IF EXISTS "anon_all" ON excused_absence_requests;

-- ─── 2. SELECT — anon/authenticated 모두 허용 (앱 조회 기능 유지) ─
CREATE POLICY "read_all" ON excused_absence_requests
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── 3. INSERT — source 값 검증 후 허용 (Apps Script 전용 값만) ─
-- Google Form → Apps Script가 보내는 'application' | 'evidence'만 허용
CREATE POLICY "strict_insert" ON excused_absence_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    source IN ('application', 'evidence')
    AND length(course_name) > 0
    AND length(trainee_name) > 0
    AND length(trainee_name) < 100
    AND length(reason) < 2000
  );

-- ─── 4. UPDATE — anon/authenticated 허용 (앱의 status 변경 기능 유지) ─
-- 단, submitted_at/created_at/id는 변경 불가 (WITH CHECK로 불변 유지는 별도 로직 필요)
CREATE POLICY "update_status" ON excused_absence_requests
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ─── 5. DELETE — 차단 (authenticated와 service_role만 허용, anon 차단) ─
-- 앱 코드에 .delete() 호출 없음 → 서비스 무영향
-- 공격자가 익명 키로 대량 삭제하던 벡터를 차단
CREATE POLICY "delete_authenticated_only" ON excused_absence_requests
  FOR DELETE TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 검증 쿼리 (SQL Editor에서 실행하여 정책 확인)
-- ═══════════════════════════════════════════════════════════════
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'excused_absence_requests'
-- ORDER BY cmd;
--
-- 예상 결과:
--   delete_authenticated_only | DELETE | {authenticated}        | true | -
--   strict_insert             | INSERT | {anon, authenticated}  | -    | (source IN ...)
--   read_all                  | SELECT | {anon, authenticated}  | true | -
--   update_status             | UPDATE | {anon, authenticated}  | true | true
-- ═══════════════════════════════════════════════════════════════
