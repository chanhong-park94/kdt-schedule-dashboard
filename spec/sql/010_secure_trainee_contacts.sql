-- ═══════════════════════════════════════════════════════════════
-- 훈련생 연락처 RLS 강화 (2026-04-29)
-- ═══════════════════════════════════════════════════════════════
-- 목표: anon 키로 전체 훈련생 phone/email 일괄 다운로드 가능한
--       정보 노출 취약점 차단 (개인정보보호법 제29조 안전성 확보 조치)
--
-- 영향받는 테이블: trainee_contacts
-- 영향: Google Workspace 로그인(authenticated)한 운매만 CRUD 가능.
--       익명(anon) 및 보조강사 코드 로그인 사용자는 접근 차단.
--
-- 적용 방법:
--   1. Supabase Dashboard → SQL Editor
--   2. 아래 내용 복사 → Run
--   3. Policies 탭에서 "trainee_contacts_authenticated_*" 4개 정책 확인
--
-- 코드 측 의존: src/hrd/hrdContacts.ts 의 Supabase 클라이언트가
--   persistSession: true 로 설정되어 Google OAuth JWT를 전달해야 함.
--   (별도 커밋에서 변경 완료 — `010` SQL 적용 전 코드 배포 시 운매도
--    일시적으로 연락처 조회 불가능. SQL 적용 후 정상화.)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. 기존 anon_all 정책 제거 ─────────────────────────────────
DROP POLICY IF EXISTS "anon_all" ON trainee_contacts;

-- ─── 2. SELECT — Google 로그인 운매만 ──────────────────────────
-- 보조강사 코드 로그인은 anon role이라 자동 차단됨
CREATE POLICY "trainee_contacts_authenticated_select" ON trainee_contacts
  FOR SELECT TO authenticated
  USING (true);

-- ─── 3. INSERT — Google 로그인 운매만 ──────────────────────────
-- 입력 길이 검증으로 데이터 오염 방지
CREATE POLICY "trainee_contacts_authenticated_insert" ON trainee_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    length(trainee_name) > 0
    AND length(trainee_name) < 100
    AND length(coalesce(phone, '')) < 50
    AND length(coalesce(email, '')) < 200
  );

-- ─── 4. UPDATE — Google 로그인 운매만 ──────────────────────────
CREATE POLICY "trainee_contacts_authenticated_update" ON trainee_contacts
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    length(trainee_name) > 0
    AND length(trainee_name) < 100
    AND length(coalesce(phone, '')) < 50
    AND length(coalesce(email, '')) < 200
  );

-- ─── 5. DELETE — Google 로그인 운매만 ──────────────────────────
-- 향후 보존기간 경과 시 일괄 파기에 사용
CREATE POLICY "trainee_contacts_authenticated_delete" ON trainee_contacts
  FOR DELETE TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 검증 쿼리
-- ═══════════════════════════════════════════════════════════════
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'trainee_contacts'
-- ORDER BY cmd;
--
-- 예상 결과 (4개 정책, 모두 {authenticated} only):
--   trainee_contacts_authenticated_delete | DELETE | {authenticated}
--   trainee_contacts_authenticated_insert | INSERT | {authenticated}
--   trainee_contacts_authenticated_select | SELECT | {authenticated}
--   trainee_contacts_authenticated_update | UPDATE | {authenticated}
--
-- 익명 접근 차단 확인 (anon key로 직접 호출 시 빈 결과/권한 에러 반환):
--   curl -H "apikey: <anon_key>" \
--     "<supabase_url>/rest/v1/trainee_contacts?select=*"
--   → []  (RLS로 0건 반환, 데이터 보호됨)
-- ═══════════════════════════════════════════════════════════════
