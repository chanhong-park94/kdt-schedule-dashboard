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
    name: "Claude Opus 4.6",
    role: "AI · 리드 개발자",
    desc: "프론트엔드/백엔드 전체 아키텍처 설계 및 구현을 담당합니다. TypeScript, Vite, Supabase, CSS 전반을 커버합니다.",
    tags: ["풀스택 개발", "아키텍처", "코드 리뷰", "디버깅"],
  },
  {
    avatar: "🔍",
    name: "Explore Agent",
    role: "AI · 코드베이스 탐색 전문가",
    desc: "대규모 코드베이스에서 패턴, 파일 구조, 의존성을 빠르게 파악합니다. 새 기능 구현 전 기존 코드 분석을 담당합니다.",
    tags: ["코드 분석", "패턴 탐색", "의존성 추적"],
  },
  {
    avatar: "🌐",
    name: "Chrome Automation",
    role: "AI · QA 엔지니어",
    desc: "배포된 웹 대시보드에 직접 접속하여 UI 테스트, 데이터 입력, API 설정을 수행합니다. Supabase/GitHub 설정도 브라우저에서 직접 처리합니다.",
    tags: ["E2E 테스트", "브라우저 자동화", "배포 검증"],
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
    desc: "SMS 문자 발송(솔라피), 이메일 발송, Slack 프록시 등 서버사이드 로직을 Deno 런타임에서 실행합니다.",
    tags: ["SMS 발송", "이메일", "CORS 프록시"],
  },
  {
    avatar: "💡",
    name: "Brainstorming Agent",
    role: "AI · 기획/설계 컨설턴트",
    desc: "새 기능 구현 전 요구사항을 탐색하고, 여러 접근법의 트레이드오프를 분석하여 최적의 설계안을 제시합니다.",
    tags: ["요구사항 분석", "설계 리뷰", "대안 제시"],
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
