-- 보조강사 인증코드 테이블
-- 2026-03-11: localStorage → Supabase 마이그레이션 (commit 22e173d)

CREATE TABLE IF NOT EXISTS public.assistant_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  train_pr_id text NOT NULL,
  degr text NOT NULL,
  course_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.assistant_codes ENABLE ROW LEVEL SECURITY;

-- anon 키로 접근 허용 (관리자 대시보드에서 사용)
CREATE POLICY assistant_codes_select ON public.assistant_codes
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY assistant_codes_insert ON public.assistant_codes
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY assistant_codes_update ON public.assistant_codes
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY assistant_codes_delete ON public.assistant_codes
  FOR DELETE TO anon, authenticated USING (true);
