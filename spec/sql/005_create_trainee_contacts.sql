-- 훈련생 연락처 관리 테이블
-- 과정/기수별 훈련생 전화번호, 이메일을 수기 등록하여 출결 안내 문자/이메일 발송에 활용

CREATE TABLE IF NOT EXISTS trainee_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  train_pr_id text NOT NULL,
  degr text NOT NULL,
  trainee_name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(train_pr_id, degr, trainee_name)
);

ALTER TABLE trainee_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON trainee_contacts
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- updated_at 자동 갱신 트리거
CREATE TRIGGER set_trainee_contacts_updated_at
  BEFORE UPDATE ON trainee_contacts
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);
