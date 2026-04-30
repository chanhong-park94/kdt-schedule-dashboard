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
    version: "v3.5.2",
    date: "2026-04-30",
    items: [
      { tag: "feat", text: "출결안내 발송 모달 — 학생별 메시지 textarea 인라인 편집 + SMS/LMS 바이트 카운터 + '템플릿 복원' 버튼" },
      { tag: "feat", text: "발송 모달 상단 헤더 — SMS 발신번호(인라인 수정 + '과정 기본값으로 저장' 옵션) / 이메일 발신자 표시" },
      { tag: "feat", text: "발송 직전 최종 확인 다이얼로그 — 대상 수, 발신번호, SMS·LMS 분류, 솔라피 예상 비용 요약" },
      { tag: "feat", text: "발송 결과 상세 — 학생별 ✅/❌ 모달 하단 표시 + localStorage 발송 이력에 마스킹된 연락처 + '📜 최근 발송 이력 보기'" },
      { tag: "improve", text: "메시지/이메일 발신명 통일 — '운영팀' → '모두의연구소 KDT 운영팀' (SMS 템플릿 3종 + 이메일 제목 + Edge Function 기본값)" },
      { tag: "improve", text: "업무 가이드 — 출결현황 가이드에 '📱 관리대상 문자/이메일 발송' 서브섹션 신설 (단계 8개 + 팁 6개)" },
    ],
  },
  {
    version: "v3.5.1",
    date: "2026-04-29",
    items: [
      { tag: "fix", text: "[핫픽스] 출결현황 조회 실패 — Supabase 클라이언트 두 개가 OAuth 콜백을 동시 파싱하면서 토큰 storage 락이 충돌해 운매/강사 모드 모두에서 데이터 로드가 실패하던 문제 해결 (v3.5.0 회귀)" },
    ],
  },
  {
    version: "v3.5.0",
    date: "2026-04-29",
    items: [
      { tag: "fix", text: "강사 대시보드 가로 스크롤 — 운영진단/교강사진단/프로젝트보상 표가 카드 밖으로 잘리던 문제 해결 (.table-responsive CSS 신설)" },
      { tag: "fix", text: "강사 대시보드 컬럼 고정 — 가로 스크롤 시 #/학습자명 컬럼 sticky 좌측 고정으로 누구의 점수인지 항상 식별 가능" },
      { tag: "fix", text: "운영진단 미진단 표시 — default 10점이 미진단과 구별되지 않던 문제 해결, 빈 셀은 '-' 표시 + 환산 점수도 평가된 일자만 분모로 사용" },
      { tag: "fix", text: "운영진단 stale 데이터 차단 — 미진단 셀은 DB 저장 제외 (기존: 모든 셀 default 10점으로 자동 INSERT)" },
      { tag: "fix", text: "교강사진단 페이지네이션 제거 — 12유닛 한 화면 통합 + 페이지 전환 시 미저장 입력이 손실되던 버그 해결" },
      { tag: "fix", text: "프로젝트평가 점수 클램프 — 0~100 범위 강제 (기존: 음수/100 초과 저장 가능)" },
      { tag: "improve", text: "프로젝트평가 피드백 textarea — 한 줄 input → 2행 textarea (vertical resize)" },
      { tag: "improve", text: "강사 대시보드 입력 필드 — 점수 select/input 폭 50px → 64px (모바일 터치 영역 확보)" },
      { tag: "improve", text: "운영진단 강사모드 자동조회 — 다른 탭과 일관성 (기존: 매번 '조회' 클릭 필요)" },
      { tag: "fix", text: "[보안] 훈련생 연락처 RLS 강화 — anon key로 전체 phone/email 일괄 다운로드가 가능했던 정보노출 취약점 차단 (010_secure_trainee_contacts.sql 적용 필요)" },
      { tag: "fix", text: "[보안] 연락처 탭 XSS 방어 — name/phone/email/status innerHTML 주입 시 escapeHtml 적용 (악성 phone 값으로 stored XSS 가능했던 경로 차단)" },
      { tag: "feat", text: "[보안] 강사 모드 SMS/이메일 발송 차단 — 학습자 개인정보 발송은 운매(Google 로그인) 권한 전용. 보조강사 코드 로그인 사용자는 발송 함수/모달/자동 스케줄러 진입 자체 차단" },
      { tag: "improve", text: "Supabase 클라이언트 OAuth 세션 자동 복원 — persistSession 활성화로 RLS authenticated role 정상 동작" },
    ],
  },
  {
    version: "v3.4.0",
    date: "2026-04-17",
    items: [
      { tag: "feat", text: "강사 대시보드 — 보조강사/교강사 모드에 4개 탭 추가 (프로젝트 평가, 프로젝트 보상, 운영 진단, 교강사 진단)" },
      { tag: "feat", text: "프로젝트 평가 — 프로젝트 1~4 점수(100점)+피드백 입력, 평가기준(루브릭) 표시, 중도탈락 회색 처리" },
      { tag: "feat", text: "프로젝트 보상 (운매 전용) — 달성 자동 판정(점수+PERCENTRANK), 집행일 입력, CSV 다운로드" },
      { tag: "feat", text: "운영 진단 — 유닛 1~12 일자별 출석/태도/소통(0/5/10점), 주계·환산 자동 계산, 진단 기준표" },
      { tag: "feat", text: "교강사 진단 — 유닛 1~12 1차/2차 진단(5점 척도), 평균·환산 자동 계산, 페이지 전환" },
      { tag: "improve", text: "강사 모드 명칭 변경 — '보조강사 모드' → '강사 대시보드'" },
      { tag: "improve", text: "강사 모드 탭 확장 — 출결현황 외 프로젝트평가/운영진단/교강사진단 추가 표시" },
    ],
  },
  {
    version: "v3.3.0",
    date: "2026-04-17",
    items: [
      { tag: "feat", text: "매출 탭 매출상세표 — 엑셀 통합템플릿(01_매출관리+02_매출상세) 양식 대응" },
      { tag: "feat", text: "매출 엑셀 업로드 — 기존 교육사업관리 엑셀 업로드 시 일별 매출 자동 파싱" },
      { tag: "feat", text: "매출 과정/기수 멀티 관리 — 드롭다운 전환, 과정별 데이터 저장/삭제" },
      { tag: "feat", text: "매출 요일별 훈련시간 — 월~토 개별 체크박스+시간 설정, 공휴일 자동 제외" },
      { tag: "feat", text: "매출 시나리오 예측 — 예상매출 100/80/75/70% 자동 산출" },
      { tag: "feat", text: "매출 예상/실일매출 수정 가능 — 자동 계산값을 사용자가 덮어쓰기 가능" },
      { tag: "improve", text: "HRD API 이중 경로 — Edge Function 우선 → CORS 프록시 자동 폴백" },
      { tag: "improve", text: "Edge Function 캐시 — 세션 중 1회만 시도 후 즉시 폴백 전환" },
      { tag: "fix", text: "보조강사 출결 API 오류 — authKey 복원 + Edge Function 폴백 수정" },
      { tag: "fix", text: "escapeHtml 유틸 추가 — XSS 방어 (신규 양식 사용자 입력값)" },
    ],
  },
  {
    version: "v3.2.0",
    date: "2026-04-07",
    items: [
      { tag: "feat", text: "문서자동화 탭 신설 — 출석입력요청대장(별지 제14호) HWPX 자동 생성" },
      { tag: "feat", text: "공결 신청 조회 — Google Form 응답 시트 2종 연동 (신청서 + 증빙자료)" },
      { tag: "feat", text: "관리자 서명 — 이름 입력 Canvas 사인 생성 + 이미지 업로드" },
      { tag: "feat", text: "공결 체크 등록 — 전체 목록 조회 → 체크박스 선택 → 일괄 등록" },
      { tag: "feat", text: "HWPX 생성 엔진 — 15행/페이지 자동 페이징, 서명 이미지 삽입" },
      { tag: "improve", text: "테스트 데이터 자동 필터링 (테스트/test/Test 제외, 토글 가능)" },
      { tag: "improve", text: "학업성취도 2-tier 캐시 — 5MB quota 초과 해결 (교차분석 0명 매칭 수정)" },
      { tag: "fix", text: "학업성취도 조회 버튼 중복 클릭 방어 (isFetching + disabled)" },
      { tag: "fix", text: "교차분석 코호트 데이터 필터 범위 수정 (기수 누락 해소)" },
      { tag: "fix", text: "교차분석 필터 debounce 300ms + race condition 방지" },
      { tag: "fix", text: "재직자 시트 헤더 검증 + URL fallback 제거 (스키마 불일치 방지)" },
      { tag: "fix", text: "Excel 내보내기 현재 필터 적용 (전체→필터 데이터)" },
      { tag: "fix", text: "회고 리포트 데이터 로드 실패 시 경고 표시" },
    ],
  },
  {
    version: "v3.1.0",
    date: "2026-03-29",
    items: [
      { tag: "feat", text: "Google Workspace 로그인 — @modulabs.co.kr 계정으로 운영매니저 로그인 (보조강사 인증코드 유지)" },
      { tag: "feat", text: "매출 탭 신설 — 출결 기반 훈련비 자동 산정 (수기 일매출 작성 자동화)" },
      { tag: "feat", text: "매출 KPI 카드 — 총 매출 / 일매출 / 손실 매출 / 하차 손실" },
      { tag: "feat", text: "단위기간별 매출 추이 차트 — 실매출 vs 손실 스택 바 차트" },
      { tag: "feat", text: "과정·기수별 매출 테이블 — 훈련생수, 출석률, 매출, 손실, 합계" },
      { tag: "feat", text: "훈련생분석 위험등급 통합 — 대시보드와 동일 기준 (잔여결석일 비율)" },
      { tag: "feat", text: "훈련생분석 테이블 확장 — 성별·지각·조퇴·위험등급 컬럼 추가" },
      { tag: "fix", text: "누적 조퇴/지각 결석 환산 — HRD-Net 기준 지각3회=결석1일, 조퇴3회=결석1일" },
      { tag: "fix", text: "조기취업 출석률 70% 분기 — ≥70% 수료, <70% 미수료 하차" },
      { tag: "fix", text: "상태 배지 HRD 원본 표시 — 정상수료/80%이상수료/중도탈락 등 그대로 표시" },
      { tag: "fix", text: "성별 데이터 교차분석 연결 — fetchAllAttendanceData 성별 로딩 누락 수정" },
      { tag: "improve", text: "위험군 CSV에 성별·조퇴·위험등급 컬럼 추가" },
      { tag: "improve", text: "과정별 훈련시간 설정 — trainingHoursPerDay (기본 8시간)" },
    ],
  },
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
