/**
 * 패치노트 모듈
 *
 * 헤더의 📋 업데이트 버튼 클릭 시 드롭다운으로 패치노트를 표시합니다.
 * 새 버전이 있으면 뱃지를 표시하고, 확인하면 localStorage에 읽은 버전을 저장합니다.
 */

const SEEN_KEY = "kdt_patch_note_seen_v1";

interface PatchNote {
  version: string;
  date: string;
  items: { tag: "feat" | "fix" | "improve"; text: string }[];
}

// ─── 패치노트 데이터 (최신이 맨 위) ────────────────────────
const PATCH_NOTES: PatchNote[] = [
  {
    version: "v3.0.0",
    date: "2026-03-24",
    items: [
      { tag: "feat", text: "운영 회고 리포트 — 교차분석 탭 내 서브탭 추가 (과정/기수 선택 → 5개 지표 종합 대시보드)" },
      { tag: "feat", text: "회고 리포트 PDF 내보내기 — 6개 섹션 차트 포함 인쇄/저장" },
      { tag: "feat", text: "회고 리포트 5개 지표 — 출결, 성취도, 만족도, 문의응대, 하차방어 + 종합 레이더" },
      { tag: "feat", text: "기수 멀티셀렉트 — 전체/개별 기수 체크박스 선택" },
      { tag: "feat", text: "섹션별 자동 인사이트 — 데이터 기반 강점/개선점 자동 생성" },
      { tag: "improve", text: "데이터 부족 시 graceful degradation — 부족한 섹션 흐리게 + 다른 지표 강조" },
      { tag: "fix", text: "출결 알림 리포트 — 최신 기수만 → 전체 운영중 기수 전송 (재직자 LLM 5기 누락 해결)" },
      { tag: "fix", text: "재직자 기획/개발·데이터 과정 totalDays 0→60 (관리대상 분류 정상화)" },
    ],
  },
  {
    version: "v2.9.0",
    date: "2026-03-22 23:20",
    items: [
      { tag: "feat", text: "토스트 알림 시스템 — 작업 성공/실패 시 우상단 3초 팝업 (4종)" },
      { tag: "feat", text: "필터 초기화 버튼 — 출결·학업성취도·문의응대·만족도 5개 탭" },
      { tag: "feat", text: "캐시 관리 UI — 설정 탭에서 전체/개별 캐시 초기화" },
      { tag: "feat", text: "학업성취도 Excel 내보내기 — 📥 Excel 버튼 (xlsx)" },
      { tag: "feat", text: "키보드 단축키 — Alt+1~9로 탭 빠른 전환" },
      { tag: "feat", text: "오프라인 감지 — 네트워크 끊김 시 배너 자동 표시" },
      { tag: "improve", text: "API 타임아웃 — HRD 15초, Airtable/Apps Script 30초 (무한 대기 방지)" },
      { tag: "improve", text: "에러 메시지 통일 — 8가지 분류 (인증실패·권한부족·타임아웃 등)" },
      { tag: "improve", text: "캐시 시점 표시 — '82건 (캐시 · 3시간 전)' 형태" },
      { tag: "improve", text: "모바일 탭 라벨 가독성 향상 (11px + ellipsis)" },
      { tag: "improve", text: "필터 UI 통일 — .filter-bar 공통 클래스 적용" },
      { tag: "improve", text: "빈 상태 안내 통일 — 아이콘 + 설정 안내 메시지" },
      { tag: "fix", text: "문의응대 조회 버튼 캐시 무시 — 항상 최신 데이터 로드" },
      { tag: "fix", text: "CompGroup.category 타입 누락 수정" },
    ],
  },
  {
    version: "v2.8.0",
    date: "2026-03-22",
    items: [
      { tag: "feat", text: "교차분석 탭 신규 — 출결 × 성취도 × 만족도 상관관계 분석" },
      { tag: "feat", text: "학생 교차분석 — 산점도(출결률 vs 성취도) + 히트맵(출결구간×신호등) + Pearson 상관계수" },
      { tag: "feat", text: "기수 교차분석 — 레이더 차트(3축 비교) + 종합점수 비교 테이블 + 자동 인사이트" },
      { tag: "improve", text: "코드 스플리팅 — 교차분석 별도 청크(11.84KB) lazy-load" },
      { tag: "fix", text: "사이드바 메뉴 설정 가드에 누락 키(inquiry/satisfaction) 추가" },
    ],
  },
  {
    version: "v2.7.0",
    date: "2026-03-22",
    items: [
      { tag: "feat", text: "학업성취도(실업자) 필터 강화 — 훈련상태/신호등 필터 + 50명 페이지네이션" },
      { tag: "feat", text: "업무 가이드 모달 — 📖 12개 탭별 사용법·팁·설정 안내" },
      { tag: "feat", text: "하차방어율 이탈 위험 히트맵 + Top 10 리스트 (도넛 차트 교체)" },
      { tag: "fix", text: "훈련생분석 진행중/종강 분류 — 명단 훈련상태 기반 판단" },
      { tag: "fix", text: "주차별 출석률 추이 — 1주차부터 정확히 표시" },
      { tag: "improve", text: "훈련생이력 상세 패널 — 2열 레이아웃 (캘린더+차트)" },
      { tag: "improve", text: "주차별 출석률 차트 → CSS 바 차트 (스크롤 문제 해결)" },
    ],
  },
  {
    version: "v2.6.0",
    date: "2026-03-22",
    items: [
      { tag: "feat", text: "헤더 로그아웃 버튼 추가" },
      { tag: "feat", text: "AI 에이전트 팀소개 (설정 탭, 14명 팀)" },
      { tag: "feat", text: "하차방어율 '훈련중만' 필터 — 훈련상태 기반" },
      { tag: "fix", text: "데이터의사결정 4기 조회 누락 수정" },
      { tag: "fix", text: "Edge Function URL 더블 슬래시 방지" },
      { tag: "fix", text: "출결현황 뷰 모드(전체/월별/일별) 실제 필터 연결" },
      { tag: "improve", text: "기수별 하차방어율 추이 차트 확대 (전체 너비, 400px)" },
      { tag: "improve", text: "모바일 하단 네비 스크롤 + 문의응대/만족도 탭 추가" },
      { tag: "improve", text: "터치 타겟 44px (iOS 가이드라인)" },
    ],
  },
  {
    version: "v2.5.0",
    date: "2026-03-22",
    items: [
      { tag: "feat", text: "SMS 문자 발송 기능 추가 (솔라피 API 연동)" },
      { tag: "feat", text: "만족도 수기 입력 폼 추가 (NPS/강사/HRD 중간·최종)" },
      { tag: "feat", text: "패치노트 알림 뱃지 추가" },
      { tag: "improve", text: "만족도 탭 사이드바 네비게이션 추가" },
    ],
  },
  {
    version: "v2.4.0",
    date: "2026-03-20",
    items: [
      { tag: "feat", text: "학업성취도 실업자/재직자 서브탭 분리" },
      { tag: "feat", text: "재직자 유닛리포트 (유닛1~12 강사진단/운영진단 + 프로젝트1~4)" },
      { tag: "feat", text: "기수 코드 → 과정명 자동 매핑 (0-x: LLM, 1-x: 데이터, 2-x: 기획/개발)" },
      { tag: "improve", text: "학업성취도 이름 검색 기능 추가" },
    ],
  },
  {
    version: "v2.3.0",
    date: "2026-03-19",
    items: [
      { tag: "feat", text: "문의응대 대시보드 추가 (Airtable API 연동, 82건)" },
      { tag: "feat", text: "문의응대 통계카드 (총 문의, 채널별, 작성자별, 질문유형 분포)" },
      { tag: "feat", text: "API 연동 설정 통합 (학업성취도/문의응대/Slack → 설정 탭)" },
      { tag: "fix", text: "라이트 모드에서 통계 카드 텍스트 안 보이는 문제 수정" },
      { tag: "improve", text: "테이블 셀 색상 강화 (채널 배지, 신호등, 등급)" },
    ],
  },
  {
    version: "v2.2.0",
    date: "2026-03-18",
    items: [
      { tag: "feat", text: "학업성취도(실업자) 대시보드 추가 (Apps Script → 689명/45,574건)" },
      { tag: "feat", text: "과정/기수 필터 + 신호등 정렬 (🔴→🟡→🟢)" },
      { tag: "improve", text: "캐시 자동 복원 (새로고침 시 데이터 유지)" },
    ],
  },
];

// ─── 로직 ───────────────────────────────────────────────────
function getSeenVersion(): string {
  return localStorage.getItem(SEEN_KEY) || "";
}

function markAsSeen(): void {
  if (PATCH_NOTES.length > 0) {
    localStorage.setItem(SEEN_KEY, PATCH_NOTES[0].version);
  }
}

function hasNewUpdates(): boolean {
  return PATCH_NOTES.length > 0 && getSeenVersion() !== PATCH_NOTES[0].version;
}

function renderDropdown(): string {
  return PATCH_NOTES.map(
    (note) => `
    <div class="patch-note-version">
      <h4>${note.version}</h4>
      <div class="patch-date">${note.date}</div>
      <ul>
        ${note.items.map((item) => `<li><span class="patch-tag patch-tag--${item.tag}">${tagLabel(item.tag)}</span>${esc(item.text)}</li>`).join("")}
      </ul>
    </div>`,
  ).join("");
}

function tagLabel(tag: string): string {
  if (tag === "feat") return "신규";
  if (tag === "fix") return "수정";
  return "개선";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── 초기화 ─────────────────────────────────────────────────
export function initPatchNotes(): void {
  const btn = document.getElementById("patchNoteBtn");
  const dropdown = document.getElementById("patchNoteDropdown");
  const badge = document.getElementById("patchNoteBadge");

  if (!btn || !dropdown) return;

  // 새 업데이트 뱃지
  if (hasNewUpdates() && badge) {
    badge.style.display = "";
  }

  // 드롭다운 내용
  dropdown.innerHTML = renderDropdown();

  // 토글
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== "none";
    dropdown.style.display = isOpen ? "none" : "";
    if (!isOpen) {
      markAsSeen();
      if (badge) badge.style.display = "none";
    }
  });

  // 바깥 클릭 시 닫기
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target as Node) && e.target !== btn) {
      dropdown.style.display = "none";
    }
  });
}
