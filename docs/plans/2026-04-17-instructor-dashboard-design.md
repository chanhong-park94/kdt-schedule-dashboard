# 재직자 교육관리 강사모드 대시보드 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 재직자 과정 교육 통합 관리 엑셀(프로젝트 평가/보상, 운영·교강사 진단, 종합진단)을 학사 운영 대시보드 강사모드에 통합하여, 기수 추가 시 템플릿 복제만으로 동일 구조가 자동 생성되게 함.

**Architecture:** 강사모드에 3개 서브탭(프로젝트 평가·보상, 운영 진단, 교강사 진단)을 추가. Supabase에 4개 테이블(project_evaluations, project_rewards, operation_diagnosis, instructor_diagnosis) 생성. 보조강사 코드로 과정/기수가 결정되므로, 해당 과정/기수의 데이터만 자동 로드. 운영매니저는 모든 과정/기수를 조회하며, 프로젝트 보상은 운매 전용.

**Tech Stack:** TypeScript, Supabase (RLS), Chart.js(종합진단 레이더), 기존 tabLoader/tabRegistry 패턴

---

## 참고: 원본 엑셀 데이터 구조

### 출석 기호 → 점수 변환
```
○ (출석) → 10점
◎ (공결) → 5점
▲ (지각) → 5점
× (결석) → 0점
- (미입력) → 0점
◐ (조퇴) → 0점
```

### 운영매니저 진단 구조 (유닛당)
```
일별: 출석(0/5/10) + 태도(=출석) + 소통(=출석) = 소계(30)
주계 = 유닛 내 모든 일별 소계 합
환산 = (주계 × 100) / 150
```

### 교강사 진단 구조 (유닛당)
```
1차 진단 + 2차 진단 → 평균 = AVERAGE(1차, 2차)
환산 = (평균 / 5) × 100
```

### 종합 진단
```
기술점수 = ROUND(교강사환산 × 0.6, 0)
운영점수 = ROUND(운매환산 × 0.4, 0)
소계 = 기술 + 운영
경험치 = 모든 유닛 합계의 총합
```

### 프로젝트 평가
```
5개 평가항목 (50/20/10/10/10점 배점, 합계 100)
프로젝트 1~4 각각 점수 + 피드백
```

### 프로젝트 보상
```
프로젝트 1: 1만원 (80점 달성, 상위 30%)
프로젝트 2: 3만원 (75점 달성, 상위 20%)
프로젝트 3: 5만원 (70점 달성, 상위 10%)
프로젝트 4: 8만원 (70점 달성, 상위 5%)
달성여부 = AND(점수 >= 기준, PERCENTRANK >= 비율)
```

---

## Phase 구조

### Phase 1: DB 스키마 + 기반 구조 (이번 세션)
- Supabase 테이블 4개 SQL 작성
- AppSidebarNavKey에 강사모드 탭 키 추가
- 강사모드 CSS에서 새 탭 표시 허용
- HTML 섹션 + 네비 버튼 추가
- tabRegistry에 lazy-load 등록

### Phase 2: 프로젝트 평가 탭
- 과정/기수별 평가기준(루브릭) 표시
- 학습자 목록 (출석부 기반, 중도탈락 회색 처리)
- 프로젝트 1~4 점수 입력 + 피드백 → Supabase 저장
- 마감일 상단 표시

### Phase 3: 프로젝트 보상 (운매 전용)
- 프로젝트 평가 점수 연동 → 달성 기준 판정
- 달성여부 자동 표시 (TRUE/FALSE + 색상)
- 집행일 운매 입력
- CSV 다운로드

### Phase 4: 운영 진단
- 상단: 진단 기준표 (출석/태도/소통 10점 기준)
- 유닛 1~12 서브탭 전환
- 유닛 클릭 시: 해당 유닛의 일자별 출석/태도/소통/소계
- 출석 점수: 출석부 기호 연동 자동 산정
- 태도/소통: 출석점수 기본값 → 수정 가능
- 주계 + 환산 자동 계산

### Phase 5: 교강사 진단
- 유닛 1~12 × 1차/2차 진단 입력
- 평균 + 환산(×20) 자동 계산
- 운영 진단과 동일 구조(레이아웃 재사용)

### Phase 6: 종합 진단 (자동 합산)
- 기술(교강사 60%) + 운영(운매 40%) 자동 합산
- 유닛별 소계/가점/합계/버프
- 경험치 = 전체 합계 총합
- 신호등 표시 (기존 hrdTypes의 신호등 기준 재사용)

---

## Phase 1 상세: DB 스키마 + 기반 구조

### Task 1: Supabase 테이블 SQL 작성

**Files:**
- Create: `spec/sql/008_create_instructor_dashboard.sql`

**내용:**
```sql
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
  project_number int NOT NULL,
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

-- RLS (Phase A 기준: anon 허용, Phase B에서 authenticated 전용으로 강화)
ALTER TABLE project_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_diagnosis ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_diagnosis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON project_evaluations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON project_rewards FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON operation_diagnosis FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON instructor_diagnosis FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
```

### Task 2: AppSidebarNavKey 확장

**Files:**
- Modify: `src/core/state.ts` — `AppSidebarNavKey` union에 추가

```typescript
// 추가할 키:
| "projectEval"      // 프로젝트 평가
| "projectReward"    // 프로젝트 보상 (운매 전용)
| "operationDiag"    // 운영 진단
| "instructorDiag"   // 교강사 진단
```

### Task 3: 강사모드 CSS 확장

**Files:**
- Modify: `src/style.css` — `.assistant-mode` 셀렉터

현재:
```css
.assistant-mode .jibble-nav-item:not([data-nav-key="attendance"]) {
  display: none !important;
}
```

변경:
```css
.assistant-mode .jibble-nav-item:not([data-nav-key="attendance"]):not([data-nav-key="projectEval"]):not([data-nav-key="operationDiag"]):not([data-nav-key="instructorDiag"]) {
  display: none !important;
}
```
→ 강사모드에서 출결 + 프로젝트평가 + 운영진단 + 교강사진단 표시
→ `projectReward`는 운매 전용이므로 포함하지 않음 (운매는 전체 탭 보임)

### Task 4: HTML 네비 버튼 + 섹션 추가

**Files:**
- Modify: `src/index.html`

네비 버튼 (설정 버튼 직전에 추가):
```html
<button class="jibble-nav-item" type="button"
  data-scroll-target="sectionProjectEval" data-nav-key="projectEval"
  data-nav-icon="project" data-default-label="프로젝트 평가">
  <span class="jibble-nav-emoji" aria-hidden="true">🎯</span>
  <span class="jibble-nav-label">프로젝트 평가</span>
</button>
<button class="jibble-nav-item" type="button"
  data-scroll-target="sectionProjectReward" data-nav-key="projectReward"
  data-nav-icon="reward" data-default-label="프로젝트 보상">
  <span class="jibble-nav-emoji" aria-hidden="true">🏆</span>
  <span class="jibble-nav-label">프로젝트 보상</span>
</button>
<button class="jibble-nav-item" type="button"
  data-scroll-target="sectionOperationDiag" data-nav-key="operationDiag"
  data-nav-icon="diagnosis" data-default-label="운영 진단">
  <span class="jibble-nav-emoji" aria-hidden="true">📋</span>
  <span class="jibble-nav-label">운영 진단</span>
</button>
<button class="jibble-nav-item" type="button"
  data-scroll-target="sectionInstructorDiag" data-nav-key="instructorDiag"
  data-nav-icon="teacher" data-default-label="교강사 진단">
  <span class="jibble-nav-emoji" aria-hidden="true">👨‍🏫</span>
  <span class="jibble-nav-label">교강사 진단</span>
</button>
```

섹션 (각각 별도 `data-page-group`):
```html
<!-- 프로젝트 평가 -->
<section id="sectionProjectEval" class="card card-span-12 u-mt-14" data-page-group="projectEval">
  <div class="card-header">
    <div class="card-header-left">
      <h2 class="card-title">🎯 프로젝트 평가</h2>
      <span class="card-subtitle" id="projEvalScope"></span>
    </div>
  </div>
  <div id="projEvalStatus" class="att-status u-mt-8"></div>
  <div id="projEvalContent"></div>
</section>

<!-- 프로젝트 보상 (운매 전용) -->
<section id="sectionProjectReward" class="card card-span-12 u-mt-14" data-page-group="projectReward">
  <!-- 운매 전용: CSS로 assistant-mode 시 숨김 -->
  <div class="card-header">
    <div class="card-header-left">
      <h2 class="card-title">🏆 프로젝트 보상</h2>
    </div>
    <div class="card-header-right">
      <button id="projRewardCsvBtn" class="btn btn-primary btn-sm">📥 CSV 다운로드</button>
    </div>
  </div>
  <div id="projRewardContent"></div>
</section>

<!-- 운영 진단 -->
<section id="sectionOperationDiag" class="card card-span-12 u-mt-14" data-page-group="operationDiag">
  <div class="card-header">
    <div class="card-header-left">
      <h2 class="card-title">📋 운영 진단</h2>
    </div>
  </div>
  <div id="opDiagContent"></div>
</section>

<!-- 교강사 진단 -->
<section id="sectionInstructorDiag" class="card card-span-12 u-mt-14" data-page-group="instructorDiag">
  <div class="card-header">
    <div class="card-header-left">
      <h2 class="card-title">👨‍🏫 교강사 진단</h2>
    </div>
  </div>
  <div id="instrDiagContent"></div>
</section>
```

### Task 5: tabRegistry 등록 + init 파일 스텁 생성

**Files:**
- Create: `src/instructor/projectEvalInit.ts`
- Create: `src/instructor/projectRewardInit.ts`
- Create: `src/instructor/operationDiagInit.ts`
- Create: `src/instructor/instructorDiagInit.ts`
- Modify: `src/ui/tabRegistry.ts`

각 init 파일 스텁:
```typescript
// src/instructor/projectEvalInit.ts
export function initProjectEval(): void {
  // Phase 2에서 구현
  console.log("[ProjectEval] initialized (stub)");
}
```

tabRegistry 등록:
```typescript
projectEval: createTabLoader(async () => {
  const { initProjectEval } = await import("../instructor/projectEvalInit");
  initProjectEval();
}),
projectReward: createTabLoader(async () => {
  const { initProjectReward } = await import("../instructor/projectRewardInit");
  initProjectReward();
}),
operationDiag: createTabLoader(async () => {
  const { initOperationDiag } = await import("../instructor/operationDiagInit");
  initOperationDiag();
}),
instructorDiag: createTabLoader(async () => {
  const { initInstructorDiag } = await import("../instructor/instructorDiagInit");
  initInstructorDiag();
}),
```

### Task 6: 강사모드 applyAssistantMode 수정

**Files:**
- Modify: `src/main.ts` — `applyAssistantMode` 함수

```typescript
// 기존: 출결현황 탭으로 강제 이동
// 변경: 출결현황 탭으로 이동 유지 (기본 진입점)
// 추가: 프로젝트평가/운영진단/교강사진단 탭에도 과정/기수 자동 세팅

// 헤더 텍스트 변경
headerEl.textContent = `📋 ${courseName} ${degr}기 — 강사 대시보드`;
```

### Task 7: 빌드 + 커밋

```bash
npm run build
git add -A
git commit -m "feat: 강사 대시보드 기반 구조 — 4개 탭 스텁 + DB 스키마 + 강사모드 확장"
```

---

## Phase 2~6: 다음 세션에서 진행

각 Phase는 독립적이며, Phase 1 완료 후 순차 진행합니다.
Phase별 상세 태스크는 구현 직전에 세부 계획을 작성합니다.

### 권한 모델 요약

| 메뉴 | 보조강사(교강사) | 운영매니저 |
|---|---|---|
| 프로젝트 평가 | ✅ 점수 입력 + 조회 | ✅ 점수 입력 + 조회 |
| 프로젝트 보상 | ❌ 안 보임 | ✅ 조회 + 집행일 입력 + CSV |
| 운영 진단 | ✅ 조회만 | ✅ 태도/소통 수정 |
| 교강사 진단 | ✅ 1차/2차 진단 입력 | ✅ 조회 |
| 종합 진단 | ✅ 조회 | ✅ 조회 |

### 데이터 흐름

```
[보조강사 코드 로그인]
    ↓
과정/기수 자동 결정 (assistant_codes 테이블)
    ↓
HRD-Net API → 훈련생 명단 로드
    ↓
각 탭에서 해당 과정/기수 데이터만 Supabase 조회/저장
    ↓
[운매 로그인 시] 과정/기수 드롭다운으로 전환 조회
```

### 기수 추가 시 운영 리소스
- 보조강사 코드 1개 생성 (설정 탭 → 기존 기능)
- 해당 과정의 HRD-Net trainPrId + degr 자동 매핑
- 새 기수로 진입하면 빈 테이블 → 데이터 입력 시작
- **별도 시트 복사/수정 불필요** — 구조가 코드에 내장됨
