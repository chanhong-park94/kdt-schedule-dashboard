/**
 * AI 에이전트 팀소개
 *
 * 설정 페이지에서 이 프로젝트에 참여한 AI 에이전트들을 팀 소개 형식으로 표시합니다.
 */

interface AgentProfile {
  avatar: string;
  name: string;
  role: string;
  desc: string;
  tags: string[];
}

const TEAM: AgentProfile[] = [
  {
    avatar: "👨‍💻",
    name: "박찬홍 (PM)",
    role: "Human · 프로젝트 매니저",
    desc: "기획, 요구사항 정의, 의사결정, 품질 검수를 담당합니다. AI 에이전트들에게 방향을 제시하고 최종 승인을 합니다.",
    tags: ["기획", "의사결정", "품질관리", "도메인 전문가"],
  },
  {
    avatar: "🧠",
    name: "Claude Opus 4.7 (1M context)",
    role: "AI · 리드 개발자",
    desc: "프론트엔드/백엔드 전체 아키텍처 설계 및 구현을 담당합니다. TypeScript, Vite, Supabase, CSS 전반을 커버하며 1M 토큰 컨텍스트로 대규모 코드베이스를 한 번에 파악합니다.",
    tags: ["풀스택 개발", "아키텍처", "1M 컨텍스트", "Opus 4.7"],
  },
  {
    avatar: "🔍",
    name: "Explore Agent",
    role: "AI · 코드베이스 탐색 전문가",
    desc: "대규모 코드베이스에서 패턴, 파일 구조, 의존성을 빠르게 파악합니다. 새 기능 구현 전 기존 코드 분석을 담당합니다.",
    tags: ["코드 분석", "패턴 탐색", "의존성 추적"],
  },
  {
    avatar: "💡",
    name: "Brainstorming Agent",
    role: "AI · 기획/설계 컨설턴트",
    desc: "새 기능 구현 전 요구사항을 탐색하고, 여러 접근법의 트레이드오프를 분석하여 최적의 설계안을 제시합니다.",
    tags: ["요구사항 분석", "설계 리뷰", "대안 제시"],
  },
  {
    avatar: "🗺️",
    name: "Plan Agent",
    role: "AI · 구현 계획 설계자",
    desc: "요구사항을 받아 단계별 구현 계획을 작성합니다. 영향받는 파일, 아키텍처 트레이드오프, 검증 체크포인트를 포함한 실행 가능한 플랜을 제공합니다.",
    tags: ["구현 플랜", "단계 분해", "트레이드오프", "체크포인트"],
  },
  {
    avatar: "🧪",
    name: "TDD Agent",
    role: "AI · 테스트 주도 개발",
    desc: "기능 구현 전 먼저 실패하는 테스트를 작성하고, 테스트를 통과시키는 최소 코드를 구현한 뒤 리팩토링하는 Red-Green-Refactor 사이클을 수행합니다.",
    tags: ["TDD", "Vitest", "단위 테스트", "리팩토링"],
  },
  {
    avatar: "🐛",
    name: "Systematic Debugging Agent",
    role: "AI · 디버깅 전문가",
    desc: "버그 수정 전 반드시 근본 원인을 조사합니다. 4단계 프로세스(원인조사 → 패턴분석 → 가설검증 → 구현)로 증상이 아닌 루트 코즈를 해결합니다.",
    tags: ["근본 원인", "데이터 플로우", "재현", "가설 검증"],
  },
  {
    avatar: "👀",
    name: "Code Reviewer Agent",
    role: "AI · 코드 리뷰어",
    desc: "주요 단계 완료 시 원래 계획·코딩 표준 대비 구현을 검증합니다. 보안·성능·가독성 이슈를 식별하고 머지 전 개선안을 제시합니다.",
    tags: ["코드 리뷰", "표준 검증", "머지 게이트"],
  },
  {
    avatar: "🌳",
    name: "Git Worktree Agent",
    role: "AI · 격리 작업공간 관리자",
    desc: "기능 작업을 현재 워크스페이스와 격리된 git worktree에서 수행합니다. 메인 브랜치 충돌 없이 실험·구현이 가능하며, 안전 검증 후 자동 정리합니다.",
    tags: ["worktree", "격리 작업", "병렬 개발"],
  },
  {
    avatar: "🌐",
    name: "Chrome Automation",
    role: "AI · QA 엔지니어",
    desc: "배포된 웹 대시보드에 직접 접속하여 UI 테스트, 데이터 입력, API 설정을 수행합니다. Supabase/GitHub 설정도 브라우저에서 직접 처리합니다.",
    tags: ["E2E 테스트", "브라우저 자동화", "배포 검증"],
  },
  {
    avatar: "🖼️",
    name: "Claude Preview",
    role: "AI · 라이브 프리뷰 디버거",
    desc: "로컬 dev 서버를 띄워 모바일/데스크톱 뷰포트로 실시간 UI 검증을 수행합니다. 콘솔 로그, DOM 상태, 네트워크 요청을 실제 브라우저에서 확인합니다.",
    tags: ["dev 서버", "뷰포트 테스트", "콘솔/네트워크"],
  },
  {
    avatar: "📊",
    name: "Google Apps Script",
    role: "AI · 데이터 파이프라인",
    desc: "구글 시트와 대시보드 사이의 데이터 브릿지 역할을 합니다. 학업성취도, 만족도 데이터를 Web App API로 제공합니다.",
    tags: ["구글시트 연동", "데이터 변환", "Web App API"],
  },
  {
    avatar: "🗄️",
    name: "Supabase Edge Function",
    role: "AI · 서버리스 백엔드",
    desc: "SMS 문자 발송(솔라피), HRD-Net authKey 프록시, Slack Webhook 등 서버사이드 로직을 Deno 런타임에서 실행합니다.",
    tags: ["SMS 발송", "HRD 프록시", "CORS 우회"],
  },
  {
    avatar: "📅",
    name: "Google Calendar Agent",
    role: "AI · 학사일정 동기화",
    desc: "Google 캘린더 일정 조회/생성/수정/삭제를 수행합니다. 학사일정 타임라인과 개인 캘린더 간 동기화, 회의/교육 일정 자동 등록을 지원합니다.",
    tags: ["캘린더 연동", "일정 동기화", "다계정 지원"],
  },
  {
    avatar: "📋",
    name: "Session Wrap Agent",
    role: "AI · 문서화/기록 담당",
    desc: "세션 종료 시 작업 내역을 분석하고, CLAUDE.md 업데이트, 메모리 저장, 후속 작업 제안을 자동으로 수행합니다.",
    tags: ["문서화", "작업 추적", "컨텍스트 공유"],
  },
  {
    avatar: "🎨",
    name: "UX Review Agent",
    role: "AI · UI/UX 전문가",
    desc: "색상 대비·접근성(WCAG), 레이아웃 일관성, 모바일 반응형, 사용자 동선, 시각적 위계, 한국어 타이포그래피를 분석하고 개선안을 제시합니다.",
    tags: ["접근성", "반응형", "시각 위계", "타이포그래피"],
  },
  {
    avatar: "📈",
    name: "Data Analyst Agent",
    role: "AI · 데이터 분석가",
    desc: "출결률, 학업성취도, 만족도, 이탈률 등 교육 운영 데이터를 분석하고 인사이트를 도출합니다. 과정별 비교, 위험군 예측, 트렌드 분석을 수행합니다.",
    tags: ["통계 분석", "트렌드", "위험 예측", "KPI 리포트"],
  },
  {
    avatar: "📄",
    name: "Document Agent",
    role: "AI · 문서 전문가",
    desc: "HWPX(한글), PPTX(파워포인트), DOCX(워드), PDF, XLSX(엑셀) 문서를 생성·편집·변환합니다. 훈련 보고서, 공문서, 발표 자료 등 교육 운영 문서를 처리합니다.",
    tags: ["HWPX", "PPTX", "DOCX", "PDF", "보고서"],
  },
  {
    avatar: "🔒",
    name: "Security Agent",
    role: "AI · 보안/개인정보 감사",
    desc: "학생 PII(이름/연락처) 노출, API 키 하드코딩, localStorage 민감 데이터, XSS 취약점을 검사합니다. 커밋 전 시크릿 스캔을 수행합니다.",
    tags: ["PII 보호", "시크릿 스캔", "XSS 방어", "CORS"],
  },
  {
    avatar: "⚡",
    name: "Performance Agent",
    role: "AI · 성능 최적화",
    desc: "번들 크기 분석, 코드 스플리팅, lazy loading, 캐시 전략, 렌더링 성능을 최적화합니다. 현재 705KB → 500KB 이하 목표.",
    tags: ["번들 최적화", "코드 스플리팅", "캐시", "렌더링"],
  },
  {
    avatar: "✨",
    name: "Frontend Design Agent",
    role: "AI · 프론트엔드 디자인 전문가",
    desc: "Google Stitch 연동, DESIGN.md 기반 CSS 변수 동기화, 컴포넌트 디자인, 색상 팔레트, 레이아웃 시스템을 구현합니다.",
    tags: ["디자인 시스템", "Stitch", "CSS 변수", "컴포넌트"],
  },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function initAiTeam(): void {
  const grid = document.getElementById("aiTeamGrid");
  const toggleBtn = document.getElementById("aiTeamToggleBtn");
  const content = document.getElementById("aiTeamContent");
  if (!grid || !toggleBtn || !content) return;

  grid.innerHTML = TEAM.map(
    (agent) => `
    <div class="ai-team-card">
      <div class="ai-team-header">
        <div class="ai-team-avatar">${agent.avatar}</div>
        <div>
          <div class="ai-team-name">${esc(agent.name)}</div>
          <div class="ai-team-role">${esc(agent.role)}</div>
        </div>
      </div>
      <div class="ai-team-desc">${esc(agent.desc)}</div>
      <div class="ai-team-tasks">
        ${agent.tags.map((t) => `<span class="ai-team-tag">${esc(t)}</span>`).join("")}
      </div>
    </div>`,
  ).join("");

  toggleBtn.addEventListener("click", () => {
    const isOpen = content.style.display !== "none";
    content.style.display = isOpen ? "none" : "";
    toggleBtn.textContent = isOpen ? "펼치기" : "접기";
  });
}
