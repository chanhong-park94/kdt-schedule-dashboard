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
    desc: "전체 과정의 훈련 일정을 타임라인으로 시각화. 상단 sub-tab으로 '기본 타임라인'과 '교퍼팀 일정' 두 화면 전환.",
    steps: [
      { icon: "1️⃣", text: "상단 sub-tab pill에서 🏠 기본 타임라인 / 👥 교퍼팀 일정 선택" },
      { icon: "2️⃣", text: "[기본] '보기 방식'에서 기수별/과정별/강사별/주간/월간 뷰 선택" },
      { icon: "3️⃣", text: "[기본] 타임라인 바를 클릭하면 해당 과정의 상세 일정 확인" },
      { icon: "4️⃣", text: "[교퍼팀] 4개 섹션: 오늘의 업무·이번 주 일정·과정별 간트차트·인력별 현황" },
      { icon: "5️⃣", text: "[교퍼팀] 🔄 업데이트 확인 버튼으로 외부 사이트(ee-aicampus.netlify.app)와 diff 비교" },
    ],
    tips: [
      "마지막 선택한 sub-tab은 localStorage에 자동 기억",
      "교퍼팀 데이터는 정적 임베드 (오프라인 OK). 변경 발견 시 운영자가 facilitatorData.ts 갱신 + PR로 영구 반영",
      "기본 타임라인이 비어있으면 설정 → 과정 등록에서 개강일을 입력해주세요",
      "간트차트 막대 호버 시 과정·페이즈·담당자·기간 tooltip 표시",
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
    desc: "상단 sub-tab으로 [💬 Airtable 문의]와 [🎮 디스코드 강의질의응답] 두 화면을 전환합니다.",
    steps: [
      { icon: "1️⃣", text: "[Airtable] '조회' → 통계 카드(총 문의·채널별·작성자별) + 질문 유형 분포 + 채널/작성자 필터" },
      { icon: "2️⃣", text: "[Airtable] 문의 행 클릭 시 상세 내용·응답 확인" },
      { icon: "3️⃣", text: "[디스코드] '🔄 메시지 동기화' → 기수별 강의질의응답 채널의 학생 문의 수집" },
      { icon: "4️⃣", text: "[디스코드] 키워드 자동 분류 → 카테고리 분포 막대 + 자주 묻는 문의 Top 5" },
      { icon: "5️⃣", text: "[디스코드] '미응답만' 필터로 답변 안 된 학생 질문 추적 / '📖 가이드'로 운영지침 점프" },
    ],
    tips: [
      "채널: 디스코드(보라), 채널톡(초록), 유선(파랑), zep(주황)으로 구분됩니다",
      "디스코드 연동은 GAS 프록시 방식 — 봇 토큰이 정적 사이트에 노출되지 않습니다 (배포 가이드: docs/apps-script/discord-proxy.gs)",
      "디스코드 카테고리는 운영지침 매뉴얼과 연결 — 자주 묻는 문의에 어떤 가이드를 줄지 바로 확인",
    ],
    setup: "설정 → API 연동 → Airtable(Base ID+PAT) / 디스코드(GAS URL+채널매핑+운영자ID) 설정",
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
  instructor: {
    title: "강사 대시보드",
    emoji: "👨‍🏫",
    desc: "재직자 교육관리 — 프로젝트 평가·보상, 운영 진단, 교강사 진단 4종 기능을 하나의 허브에서 sub-tab으로 사용합니다.",
    steps: [
      { icon: "1️⃣", text: "상단 가로 pill에서 sub-tab을 선택합니다: 🎯 프로젝트 평가 / 🏆 프로젝트 보상(운매 전용) / 📋 운영 진단 / 👨‍🏫 교강사 진단" },
      { icon: "2️⃣", text: "프로젝트 평가: 프로젝트 1~4 점수(0~100)+피드백 입력 — 루브릭 확인, 중도탈락은 회색 처리" },
      { icon: "3️⃣", text: "프로젝트 보상(운매 전용): 점수+PERCENTRANK로 달성 자동 판정, 집행일 입력 + CSV 다운로드" },
      { icon: "4️⃣", text: "운영 진단: 유닛 1~12 일자별 출석/태도/소통(0·5·10점) — 주계·환산 자동 계산, 미진단 셀은 빈 칸 '-'으로 표시" },
      { icon: "5️⃣", text: "교강사 진단: 유닛 1~12 1차/2차 진단(5점 척도) — 평균·환산 자동 계산. 12유닛 한 화면" },
      { icon: "6️⃣", text: "상단·하단 저장 버튼 모두 작동. 미저장 페이지 이동 시 beforeunload 경고" },
    ],
    tips: [
      "마지막으로 본 sub-tab은 localStorage에 자동 기억 — 다음 방문 시 같은 sub-tab으로 진입",
      "강사 모드(보조강사 코드 로그인)에서는 '프로젝트 보상' 탭은 자동으로 숨김",
      "운영 진단의 default 10점은 '미진단'과 구별 — 평가하지 않은 셀은 DB에 저장하지 않음",
      "보조강사가 매일 입력 → 운매가 주간 단위로 검토 권장",
    ],
    setup: "Supabase 4개 테이블(project_evaluations / project_rewards / operation_diagnosis / instructor_diagnosis) 권한 및 RLS 정책 필요",
  },
  guideline: {
    title: "26년도 KDT 운영지침",
    emoji: "📖",
    desc: "고용노동부 KDT 운영지침(2026.2.19 시행) + 운영규정 2종(2026.5.11 개정)을 검색·카테고리·즐겨찾기·메모로 빠르게 활용하는 매뉴얼 페이지입니다.",
    steps: [
      { icon: "1️⃣", text: "사이드바 📖 운영지침 또는 어디서나 Alt+G 단축키로 빠른 검색 모달 호출" },
      { icon: "2️⃣", text: "검색창에 키워드 입력 (예: '출석률', '재해보험', '제적', '자부담') — 200ms debounce + 노란색 하이라이트" },
      { icon: "3️⃣", text: "사이드바에서 카테고리 클릭 = 그 카테고리만 표시 (탭형). 검색어 있을 때만 전 카테고리 가로질러 매칭" },
      { icon: "4️⃣", text: "⭐ 별 아이콘 클릭으로 자주 보는 항목 즐겨찾기. 사이드바 맨 위 '내 즐겨찾기' 탭에 모임" },
      { icon: "5️⃣", text: "카드 펼치면 본문 아래 '📝 내 메모' 입력란 — 500ms 후 자동 저장 (브라우저에만 보관)" },
      { icon: "6️⃣", text: "출처 필터 — 검색창 아래 '운영지침 / 내배카 규정 / 직능 규정' 칩으로 표시 토글" },
      { icon: "7️⃣", text: "Alt+G 모달에서 ↑↓로 결과 이동 + Enter로 점프 + Esc로 닫기 (점프 시 해당 출처는 자동 ON)" },
    ],
    tips: [
      "카테고리 12개(운영지침 PDF)+2개(법령): ⚖️ 내일배움카드 운영규정 / 📜 현장 실무인재 양성 운영규정 — KDT 직접 관련 조항 약 40개",
      "빨간 좌측 보더(critical): 제적·부정훈련·재해보험 등 운영자 자주 실수하는 항목",
      "파란 좌측 보더(info): 자부담·장려금·특별수당·취업률 등 자주 참조 항목",
      "각 카드 우상단 p.24 / 직능 §14 등은 원문 페이지·조문 참조 — 분쟁 시 원문 확인 근거",
      "즐겨찾기·메모는 브라우저(localStorage)에만 저장됩니다 — 다른 기기·다른 사용자에게 공유되지 않음",
      "추천 검색어 12종: 출석률·훈련장려금·재해보험·제적 기준·변경신고·특별훈련수당·취업률·수료·선지급·자료보관·프로젝트·수강철회",
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
    { icon: "📖", text: "운영지침 확인: 사이드바 📖 운영지침 또는 Alt+G 단축키로 KDT 업무지침·운영규정 검색" },
  ],
  tips: [
    "좌측 사이드바에서 원하는 탭을 클릭하여 이동합니다",
    "📋 업데이트 버튼에서 최신 기능 업데이트를 확인할 수 있습니다",
    "📖 운영지침 매뉴얼 — 14개 카테고리/113개 항목 (KDT 업무지침 + 내일배움카드 운영규정 + 직업능력개발훈련 운영규정), 어디서나 Alt+G로 빠른 검색",
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
