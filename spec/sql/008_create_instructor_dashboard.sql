-- 재직자 교육관리 강사 대시보드 테이블 (2026-04-17)

-- 1. 프로젝트 평가
CREATE TABLE IF NOT EXISTS project_evaluations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  train_pr_id text NOT NULL,
  degr text NOT NULL,
  trainee_name text NOT NULL,
  project_number int NOT NULL CHECK (project_number BETWEEN 1 AND 4),
  score int DEFAULT 0,
  feedback text DEFAULT '',
  evaluated_by text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(train_pr_id, degr, trainee_name, project_number)
);

-- 2. 프로젝트 보상
CREATE TABLE IF NOT EXISTS project_rewards (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  train_pr_id text NOT NULL,
  degr text NOT NULL,
  trainee_name text NOT NULL,
  project_number int NOT NULL CHECK (project_number BETWEEN 1 AND 4),
  score int DEFAULT 0,
  achieved boolean DEFAULT false,
  execution_date text DEFAULT '',
  executed_by text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(train_pr_id, degr, trainee_name, project_number)
);

-- 3. 운영매니저 진단
CREATE TABLE IF NOT EXISTS operation_diagnosis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  train_pr_id text NOT NULL,
  degr text NOT NULL,
  trainee_name text NOT NULL,
  unit_number int NOT NULL CHECK (unit_number BETWEEN 1 AND 12),
  diagnosis_date text NOT NULL,
  attendance_score int DEFAULT 10 CHECK (attendance_score IN (0, 5, 10)),
  attitude_score int DEFAULT 10 CHECK (attitude_score IN (0, 5, 10)),
  communication_score int DEFAULT 10 CHECK (communication_score IN (0, 5, 10)),
  diagnosed_by text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(train_pr_id, degr, trainee_name, unit_number, diagnosis_date)
);

-- 4. 교강사 진단
CREATE TABLE IF NOT EXISTS instructor_diagnosis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  train_pr_id text NOT NULL,
  degr text NOT NULL,
  trainee_name text NOT NULL,
  unit_number int NOT NULL CHECK (unit_number BETWEEN 1 AND 12),
  first_score numeric(3,2) DEFAULT 0,
  second_score numeric(3,2) DEFAULT 0,
  diagnosed_by text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(train_pr_id, degr, trainee_name, unit_number)
);

-- RLS
ALTER TABLE project_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_diagnosis ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_diagnosis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON project_evaluations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON project_rewards FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON operation_diagnosis FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON instructor_diagnosis FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
