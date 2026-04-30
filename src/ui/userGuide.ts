/**
 * 업무 가이드 모듈
 *
 * 헤더의 📖 가이드 버튼 클릭 시 현재 활성 탭에 맞는
 * 업무 가이드를 모달로 표시합니다.
 */

interface GuideStep {
  icon: string;
  text: string;
}

interface GuideSubsection {
  title: string;
  emoji: string;
  steps: GuideStep[];
  tips?: string[];
}

interface GuideSection {
  title: string;
  emoji: string;
  desc: string;
  steps: GuideStep[];
  tips: string[];
  setup?: string; // 필요한 사전 설정
  subsections?: GuideSubsection[]; // 추가 세부 가이드
}

// ─── 탭별 가이드 데이터 ──────────────────────────────────────
const GUIDES: Record<string, GuideSection> = {
  dashboard: {
    title: "운영 현황 대시보드",
    emoji: "📊",
    desc: "훈련 중인 과정의 핵심 KPI를 한눈에 확인하는 메인 화면입니다.",
    steps: [
      { icon: "1️⃣", text: "로그인 후 자동으로 대시보드가 표시됩니다" },
      { icon: "2️⃣", text: "하차방어율, 재적 현황, 관리대상 카드를 확인합니다" },
      { icon: "3️⃣", text: "관리대상 학생 목록에서 위험군을 빠르게 파악합니다" },
      { icon: "4️⃣", text: "각 항목을 클릭하면 해당 상세 탭으로 이동합니다" },
    ],
    tips: [
      "대시보드는 출결 데이터 조회 후 자동 업데이트됩니다",
      "관리대상은 제적위험(🔴), 경고(🟠), 주의(🟡) 3단계로 표시됩니다",
    ],
  },
  timeline: {
    title: "학사일정 타임라인",
    emoji: "📅",
    desc: "전체 과정의 훈련 일정을 타임라인으로 시각화합니다.",
    steps: [
      { icon: "1️⃣", text: "'보기 방식'에서 기수별/과정별/강사별/주간/월간 뷰를 선택합니다" },
      { icon: "2️⃣", text: "타임라인 바를 클릭하면 해당 과정의 상세 일정을 확인합니다" },
      { icon: "3️⃣", text: "마우스를 올리면 시작일/종료일/훈련일수가 표시됩니다" },
    ],
    tips: [
      "과정이 표시되지 않으면 설정 → 과정 등록에서 개강일을 입력해주세요",
      "타임라인은 과정 등록 정보를 기반으로 자동 생성됩니다",
    ],
  },
  generator: {
    title: "HRD 시간표 생성",
    emoji: "🛠️",
    desc: "HRD-Net 제출용 훈련 시간표를 자동 생성합니다.",
    steps: [
      { icon: "1️⃣", text: "과정명과 개강일을 입력합니다" },
      { icon: "2️⃣", text: "총 훈련시간과 일일 시간 템플릿을 설정합니다" },
      { icon: "3️⃣", text: "강사/교실/교과목 코드를 입력합니다" },
      { icon: "4️⃣", text: "'시간표 생성' 버튼을 클릭합니다" },
      { icon: "5️⃣", text: "결과를 확인하고 충돌 분석에 반영합니다" },
    ],
    tips: [
      "교과목과 강사 정보는 설정 → 정보 입력에서 미리 등록해두면 편리합니다",
      "공휴일은 자동으로 건너뛰어 계산됩니다",
    ],
    setup: "설정 → 정보 입력에서 과정/교과목/강사 등록 필요",
  },
  kpi: {
    title: "자율성과지표 (KPI)",
    emoji: "📈",
    desc: "훈련생 학습 성과를 사전·사후 평가, 형성평가, 현장적용도로 분석합니다.",
    steps: [
      { icon: "1️⃣", text: "조회 버튼을 클릭하여 KPI 데이터를 불러옵니다" },
      { icon: "2️⃣", text: "과정/기수 필터로 원하는 범위를 선택합니다" },
      { icon: "3️⃣", text: "차트와 테이블에서 성과 지표를 확인합니다" },
    ],
    tips: [
      "데이터는 구글 시트에서 관리되며 24시간 캐시됩니다",
    ],
    setup: "설정 → API 연동 → 자율성과지표에서 구글 시트 URL 설정 필요",
  },
  dropout: {
    title: "하차방어율 (KPI)",
    emoji: "🛡️",
    desc: "과정별 이탈률을 모니터링하고 KPI 목표(재직자 75%, 실업자 85%) 달성 여부를 추적합니다.",
    steps: [
      { icon: "1️⃣", text: "'훈련중만' 체크 시 현재 운영 중인 과정만 조회합니다" },
      { icon: "2️⃣", text: "'전체 조회' 버튼을 클릭합니다" },
      { icon: "3️⃣", text: "상단 카드에서 전체/재직자/실업자 방어율을 확인합니다" },
      { icon: "4️⃣", text: "히트맵에서 과정×기수별 위험도를 한눈에 파악합니다" },
      { icon: "5️⃣", text: "이탈 위험 Top 10에서 즉시 조치가 필요한 기수를 확인합니다" },
      { icon: "6️⃣", text: "하단 탭(과정별/기수별/연도별 등)에서 상세 분석합니다" },
    ],
    tips: [
      "목표선(점선)보다 아래에 있는 과정이 관리 대상입니다",
      "스파크라인(미니 그래프)으로 기수별 추이를 빠르게 파악할 수 있습니다",
      "조회 결과는 주간 운영회의 보고팩에 자동 반영됩니다",
    ],
    setup: "설정 → API 연동 → HRD-Net API 키 설정 필요",
  },
  attendance: {
    title: "출결현황",
    emoji: "✅",
    desc: "HRD-Net에서 훈련생 출결 데이터를 실시간으로 조회하고 관리합니다.",
    steps: [
      { icon: "1️⃣", text: "과정과 기수를 선택합니다" },
      { icon: "2️⃣", text: "뷰 모드를 선택합니다: 전체(월 누적) / 월별 / 일별" },
      { icon: "3️⃣", text: "'조회' 버튼을 클릭합니다" },
      { icon: "4️⃣", text: "훈련생 테이블에서 출석률과 위험 등급을 확인합니다" },
      { icon: "5️⃣", text: "훈련생 이름을 클릭하면 상세 출결 기록을 볼 수 있습니다" },
      { icon: "6️⃣", text: "위험군 학생에게 SMS/이메일 알림을 발송할 수 있습니다 (아래 '📱 관리대상 문자/이메일 발송' 섹션 참고)" },
    ],
    tips: [
      "위험 등급: 🔴 제적위험(잔여 ≤15%) → 🟠 경고(잔여 ≤30%) → 🟡 주의(잔여 ≤60%) — 허용 결석일 대비 비율",
      "Slack 자동 알림을 설정하면 매일 지정 시간에 관리대상 리포트가 전송됩니다",
      "공결 처리는 출결 테이블 하단 '공결 관리' 섹션에서 가능합니다",
    ],
    setup: "설정 → API 연동 → HRD-Net API 키 + 과정 등록 필요",
    subsections: [
      {
        title: "관리대상 문자/이메일 발송",
        emoji: "📱",
        steps: [
          { icon: "1️⃣", text: "과정/기수 조회 후 출결 테이블 상단의 '📱 안내 발송' 버튼을 클릭합니다" },
          { icon: "2️⃣", text: "발송 방식 선택: 문자(SMS) / 이메일 / 둘 다 — 위험군 학생이 자동으로 추출됩니다" },
          { icon: "3️⃣", text: "상단 헤더에서 SMS 발신번호와 이메일 발신자를 확인합니다 — 발신번호는 즉석 수정 + '과정 기본값으로 저장' 가능" },
          { icon: "4️⃣", text: "각 학생의 메시지 textarea를 직접 편집할 수 있습니다 — 우측 카운터로 SMS(≤90B) / LMS(≤2000B) 분류 확인" },
          { icon: "5️⃣", text: "수정 후 원래 템플릿으로 되돌리려면 '템플릿 복원' 버튼 클릭" },
          { icon: "6️⃣", text: "체크박스로 발송할 학생만 선별합니다" },
          { icon: "7️⃣", text: "'📱 N명에게 발송' 클릭 → 발신번호/대상 수/예상 비용 확인 다이얼로그 → 확인 시 발송" },
          { icon: "8️⃣", text: "발송 직후 모달 하단에 학생별 ✅/❌ 결과가 표시됩니다 — '📜 최근 발송 이력 보기'로 과거 발송 상세 조회" },
        ],
        tips: [
          "메시지 템플릿은 위험 등급별 3종(긴급/경고/주의)으로 자동 적용 — 발신명은 모두 '모두의연구소 KDT 운영팀'으로 통일됩니다",
          "솔라피 SMS 비용: SMS 약 8.4원, LMS 약 31.9원 — 발송 전 확인 다이얼로그에 합계가 표시됩니다",
          "발신번호는 솔라피 콘솔에 사전 등록된 번호여야 발송이 성공합니다",
          "이메일 발신자(Apps Script SMTP 계정)는 환경변수 VITE_NOTIFY_EMAIL_FROM 으로 표시값을 바꿀 수 있습니다",
          "강사 모드(보조강사 코드 로그인)에서는 개인정보 보호를 위해 발송이 차단됩니다 — 운매(Google 로그인) 권한에서만 가능",
          "발송 이력 최근 20건은 localStorage에 자동 저장되며, 연락처는 마스킹된 형태로 보존됩니다",
        ],
      },
    ],
  },
  analytics: {
    title: "출결 리스크",
    emoji: "🔍",
    desc: "전체 훈련생의 인구통계, 출결 패턴, 위험군을 종합 분석합니다.",
    steps: [
      { icon: "1️⃣", text: "'전체 조회' 버튼을 클릭합니다 (첫 조회 시 시간 소요)" },
      { icon: "2️⃣", text: "상단 필터에서 '진행중' / '종강' / '전체'를 선택합니다" },
      { icon: "3️⃣", text: "[개요] 탭에서 전체 요약 통계를 확인합니다" },
      { icon: "4️⃣", text: "[리스크 분석] 탭에서 위험군 상세 인사이트를 봅니다" },
      { icon: "5️⃣", text: "[상세 데이터] 탭에서 개별 훈련생 데이터를 확인합니다" },
    ],
    tips: [
      "기본 필터는 '진행중'으로 설정되어 종료된 기수는 자동 제외됩니다",
      "조회 결과는 캐시되어 다음 방문 시 즉시 표시됩니다",
      "연령대별, 성별 출결 패턴 분석이 가능합니다",
    ],
    setup: "설정 → API 연동 → HRD-Net API 키 + Supabase 연결 필요",
  },
  traineeHistory: {
    title: "훈련생 이력",
    emoji: "👤",
    desc: "개별 훈련생의 출결 이력, 캘린더, 주간 추이를 상세 조회합니다.",
    steps: [
      { icon: "1️⃣", text: "과정과 기수를 선택합니다" },
      { icon: "2️⃣", text: "'조회' 버튼을 클릭합니다" },
      { icon: "3️⃣", text: "훈련생 목록에서 이름을 클릭합니다" },
      { icon: "4️⃣", text: "출결 캘린더에서 날짜별 출석/결석/지각 상태를 확인합니다" },
      { icon: "5️⃣", text: "주간 추이 차트에서 출석률 변화를 모니터링합니다" },
    ],
    tips: [
      "캘린더의 색상: 🟢 출석 / 🔴 결석 / 🟡 지각 / ⚪ 공결",
      "훈련생 검색으로 빠르게 찾을 수 있습니다",
    ],
    setup: "설정 → API 연동 → HRD-Net API 키 필요",
  },
  achievement: {
    title: "학업성취도",
    emoji: "🎓",
    desc: "실업자(퀘스트/노드)와 재직자(유닛리포트) 학업성취도를 조회합니다.",
    steps: [
      { icon: "1️⃣", text: "상단에서 '실업자' 또는 '재직자' 서브탭을 선택합니다" },
      { icon: "2️⃣", text: "'조회' 버튼을 클릭합니다" },
      { icon: "3️⃣", text: "과정/기수 필터로 범위를 좁힙니다" },
      { icon: "4️⃣", text: "이름 검색으로 특정 훈련생을 찾을 수 있습니다" },
      { icon: "5️⃣", text: "훈련생 행을 클릭하면 노드/퀘스트 상세를 볼 수 있습니다" },
    ],
    tips: [
      "실업자: 신호등(🔴🟡🟢)으로 위험군 우선 정렬됩니다",
      "재직자: 등급(A~D)으로 종합 평가되며, D등급부터 관리 대상입니다",
      "데이터는 24시간 캐시되어 빠르게 로드됩니다",
    ],
    setup: "설정 → API 연동 → Apps Script URL 설정 필요",
  },
  inquiry: {
    title: "문의응대",
    emoji: "💬",
    desc: "훈련생 문의 내역을 Airtable에서 조회하고 통계를 분석합니다.",
    steps: [
      { icon: "1️⃣", text: "'조회' 버튼을 클릭합니다" },
      { icon: "2️⃣", text: "상단 통계 카드에서 총 문의, 채널별, 작성자별 현황을 봅니다" },
      { icon: "3️⃣", text: "질문 유형 분포에서 어떤 문의가 많은지 파악합니다" },
      { icon: "4️⃣", text: "채널/작성자 필터로 원하는 문의만 필터링합니다" },
      { icon: "5️⃣", text: "문의 행을 클릭하면 상세 내용과 응답을 볼 수 있습니다" },
    ],
    tips: [
      "채널: 디스코드(보라), 채널톡(초록), 유선(파랑), zep(주황)으로 구분됩니다",
      "검색창에서 이름, 질문 내용, 과정명으로 검색 가능합니다",
    ],
    setup: "설정 → API 연동 → Airtable Base ID + PAT 설정 필요",
  },
  satisfaction: {
    title: "만족도",
    emoji: "😊",
    desc: "과정별 NPS, 강사만족도, HRD 중간/최종 만족도를 관리합니다.",
    steps: [
      { icon: "1️⃣", text: "'📝 입력' 버튼으로 만족도 데이터를 수기 입력합니다" },
      { icon: "2️⃣", text: "과정명, 기수, 모듈명, NPS, 각 만족도 점수를 입력합니다" },
      { icon: "3️⃣", text: "'추가' 버튼을 클릭하면 즉시 통계에 반영됩니다" },
      { icon: "4️⃣", text: "통계 카드에서 전체 NPS/강사/중간/최종 평균을 확인합니다" },
      { icon: "5️⃣", text: "과정/기수 행을 클릭하면 모듈별 상세 NPS를 볼 수 있습니다" },
    ],
    tips: [
      "NPS 점수: 50 이상(🟢 우수), 0~49(🟡 보통), 0 미만(🔴 개선 필요)",
      "만족도는 1~5점 척도이며, 0은 미입력으로 평균에서 제외됩니다",
      "수기 입력한 데이터는 로컬에 저장되어 새로고침해도 유지됩니다",
    ],
  },
  settings: {
    title: "설정",
    emoji: "⚙️",
    desc: "API 연동, 과정 등록, Slack 알림 등 대시보드의 모든 설정을 관리합니다.",
    steps: [
      { icon: "1️⃣", text: "🔑 API 연동: HRD-Net, Airtable, Apps Script URL을 입력하고 연결 테스트합니다" },
      { icon: "2️⃣", text: "📋 과정 등록: 운영 중인 과정의 ID, 기수, 개강일을 등록합니다" },
      { icon: "3️⃣", text: "💬 Slack 알림: 웹훅 URL과 전송 시간을 설정합니다" },
      { icon: "4️⃣", text: "📊 주간 보고팩: 출결/하차방어율/KPI 보고서를 생성합니다" },
    ],
    tips: [
      "각 API 연동 후 반드시 '연결 테스트'를 실행해주세요",
      "과정 등록 시 '총 훈련일수'를 입력해야 출석률이 정확히 계산됩니다",
      "Slack 알림은 브라우저가 열려있을 때만 자동 전송됩니다",
      "프로젝트 상태 → JSON 다운로드로 백업할 수 있습니다",
    ],
  },
};

// 전체 가이드 (탭 미선택 시)
const OVERVIEW_GUIDE: GuideSection = {
  title: "KDT 교육운영 대시보드 사용 가이드",
  emoji: "📖",
  desc: "이 대시보드는 KDT(K-디지털 트레이닝) 교육과정의 운영을 지원하는 종합 도구입니다.",
  steps: [
    { icon: "🔑", text: "처음 사용 시: 설정 → API 연동에서 HRD-Net API 키를 입력합니다" },
    { icon: "📋", text: "과정 등록: 설정 → 과정 등록에서 운영 중인 과정을 등록합니다" },
    { icon: "✅", text: "출결 확인: 출결현황 탭에서 일일 출결을 조회합니다" },
    { icon: "🛡️", text: "이탈 관리: 하차방어율에서 KPI 달성 여부를 모니터링합니다" },
    { icon: "🔍", text: "분석: 훈련생분석에서 위험군을 사전 파악합니다" },
    { icon: "📱", text: "알림: 위험군 학생에게 SMS/이메일 알림을 발송합니다" },
  ],
  tips: [
    "좌측 사이드바에서 원하는 탭을 클릭하여 이동합니다",
    "📋 업데이트 버튼에서 최신 기능 업데이트를 확인할 수 있습니다",
    "모든 데이터는 24시간 캐시되어 빠르게 로드됩니다",
    "궁금한 점은 각 탭에서 📖 가이드 버튼을 클릭하면 사용법을 볼 수 있습니다",
  ],
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── 현재 활성 탭 감지 ──────────────────────────────────────
function getActiveTabKey(): string {
  // 사이드바 active 버튼
  const active = document.querySelector(".jibble-nav-item.is-active, .jibble-nav-item[aria-current='page']") as HTMLElement | null;
  if (active?.dataset.navKey) return active.dataset.navKey;
  // 모바일 active 버튼
  const mobileActive = document.querySelector(".mobile-bottom-nav-item.is-active") as HTMLElement | null;
  if (mobileActive?.dataset.mobileNav) return mobileActive.dataset.mobileNav;
  return "";
}

// ─── 모달 렌더링 ────────────────────────────────────────────
function renderGuideModal(guide: GuideSection): string {
  return `
    <div class="guide-modal-header">
      <span class="guide-modal-emoji">${guide.emoji}</span>
      <div>
        <h3 class="guide-modal-title">${esc(guide.title)}</h3>
        <p class="guide-modal-desc">${esc(guide.desc)}</p>
      </div>
    </div>
    ${guide.setup ? `<div class="guide-setup-banner">⚙️ 사전 설정: ${esc(guide.setup)}</div>` : ""}
    <div class="guide-section">
      <h4>📌 사용 방법</h4>
      <div class="guide-steps">
        ${guide.steps.map((s) => `<div class="guide-step"><span class="guide-step-icon">${s.icon}</span><span>${esc(s.text)}</span></div>`).join("")}
      </div>
    </div>
    <div class="guide-section">
      <h4>💡 알아두면 좋은 팁</h4>
      <ul class="guide-tips">
        ${guide.tips.map((t) => `<li>${esc(t)}</li>`).join("")}
      </ul>
    </div>
    ${
      guide.subsections && guide.subsections.length > 0
        ? guide.subsections
            .map(
              (sub) => `
      <div class="guide-subsection">
        <h4>${sub.emoji} ${esc(sub.title)}</h4>
        <div class="guide-steps">
          ${sub.steps.map((s) => `<div class="guide-step"><span class="guide-step-icon">${s.icon}</span><span>${esc(s.text)}</span></div>`).join("")}
        </div>
        ${
          sub.tips && sub.tips.length > 0
            ? `<ul class="guide-tips">${sub.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
            : ""
        }
      </div>`,
            )
            .join("")
        : ""
    }`;
}

// ─── 초기화 ─────────────────────────────────────────────────
export function initUserGuide(): void {
  const btn = document.getElementById("guideBtn");
  const modal = document.getElementById("guideModal");
  const backdrop = document.getElementById("guideBackdrop");
  const closeBtn = document.getElementById("guideCloseBtn");
  const body = document.getElementById("guideModalBody");

  if (!btn || !modal || !body) return;

  btn.addEventListener("click", () => {
    const tabKey = getActiveTabKey();
    const guide = GUIDES[tabKey] || OVERVIEW_GUIDE;
    body.innerHTML = renderGuideModal(guide);
    modal.style.display = "";
  });

  closeBtn?.addEventListener("click", () => { modal.style.display = "none"; });
  backdrop?.addEventListener("click", () => { modal.style.display = "none"; });

  // ESC 키로 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") modal.style.display = "none";
  });
}
