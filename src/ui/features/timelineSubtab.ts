/**
 * 학사일정 페이지 sub-tab 전환 (기본 타임라인 ↔ 교퍼팀 일정)
 *
 * - data-timeline-subtab-btn="default|facilitator" pill 클릭 시 토글
 * - data-timeline-subtab="default|facilitator" 카드 표시/숨김
 * - 마지막 선택은 localStorage에 저장
 * - 'facilitator' 첫 활성화 시 facilitatorInit lazy load
 */

const STORAGE_KEY = "kdt_timeline_subtab_v1";

export type TimelineSubtab = "default" | "facilitator";

function loadSubtab(): TimelineSubtab {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "facilitator") return "facilitator";
    return "default";
  } catch {
    return "default";
  }
}

function saveSubtab(v: TimelineSubtab): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
}

let facilitatorInitialized = false;

async function applySubtab(target: TimelineSubtab): Promise<void> {
  document.querySelectorAll<HTMLButtonElement>("[data-timeline-subtab-btn]").forEach((btn) => {
    const matches = btn.dataset.timelineSubtabBtn === target;
    btn.classList.toggle("is-active", matches);
    btn.setAttribute("aria-selected", matches ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>("[data-timeline-subtab]").forEach((card) => {
    const matches = card.dataset.timelineSubtab === target;
    card.style.display = matches ? "" : "none";
  });
  if (target === "facilitator" && !facilitatorInitialized) {
    facilitatorInitialized = true;
    try {
      const mod = await import("../../timeline/facilitatorInit");
      mod.initFacilitator();
    } catch (e) {
      console.warn("[timelineSubtab] facilitator init failed", e);
    }
  }
}

export function setupTimelineSubtab(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-timeline-subtab-btn]");
  if (buttons.length === 0) return;
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = (btn.dataset.timelineSubtabBtn ?? "default") as TimelineSubtab;
      saveSubtab(v);
      void applySubtab(v);
    });
  });
  // 초기 상태
  void applySubtab(loadSubtab());
}
