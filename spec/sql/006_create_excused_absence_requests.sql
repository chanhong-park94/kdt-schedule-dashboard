-- 공가(공결) 신청 데이터 테이블
-- Google Form → Apps Script → Supabase insert로 자동 동기화

CREATE TABLE IF NOT EXISTS excused_absence_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL DEFAULT 'application',  -- 'application' | 'evidence'
  course_name text NOT NULL,
  trainee_name text NOT NULL,
  birth_date text DEFAULT '',
  reason text DEFAULT '',
  request_date text DEFAULT '',
  file_link text DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  reviewed_by text DEFAULT '',
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE excused_absence_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON excused_absence_requests
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
