/**
 * 강사 허브 — 4개 강사 기능 (프로젝트 평가/보상, 운영 진단, 교강사 진단)을
 * 하나의 sub-tab UI로 통합.
 *
 * IA 단순화 Phase 1 — 19개 메인 탭 → 16개로 축소.
 * 설계: docs/plans/2026-05-12-tab-consolidation-phase1.md
 *
 * 동작:
 *  - 처음 강사 탭 진입 → 마지막 sub-tab(localStorage) 또는 기본값(projectEval) 활성화
 *  - sub-tab 클릭 → 해당 섹션만 표시, 나머지 숨김
 *  - 각 sub-tab은 처음 활성화 시 1회만 init (lazy load)
 *  - assistant-mode에서 projectReward sub-tab은 CSS로 숨김 (기존 운매 전용 정책 유지)
 */

const SUBTAB_STORAGE_KEY = "kdt_instructor_hub_subtab_v1";

type InstructorSubTabKey = "projectEval" | "projectReward" | "operationDiag" | "instructorDiag";

const SUBTAB_KEYS: readonly InstructorSubTabKey[] = ["projectEval", "projectReward", "operationDiag", "instructorDiag"] as const;

const SUBTAB_TO_SECTION_ID: Record<InstructorSubTabKey, string> = {
  projectEval: "sectionProjectEval",
  projectReward: "sectionProjectReward",
  operationDiag: "sectionOperationDiag",
  instructorDiag: "sectionInstructorDiag",
};

const initialized: Record<InstructorSubTabKey, boolean> = {
  projectEval: false,
  projectReward: false,
  operationDiag: false,
  instructorDiag: false,
};

let bound = false;

export async function initInstructorHub(): Promise<void> {
  bindSubTabs();
  // 초기 sub-tab 활성화
  const saved = loadSavedSubTab();
  const start = saved ?? getFirstVisibleSubTab();
  await activateSubTab(start);
}

function bindSubTabs(): void {
  if (bound) return;
  const buttons = document.querySelectorAll<HTMLButtonElement>(".instructor-tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.subTab as InstructorSubTabKey | undefined;
      if (!key || !SUBTAB_KEYS.includes(key)) return;
      void activateSubTab(key);
    });
  });
  bound = true;
}

async function activateSubTab(key: InstructorSubTabKey): Promise<void> {
  // assistant-mode에서 projectReward 차단 (안전장치)
  if (key === "projectReward" && document.body.classList.contains("assistant-mode")) {
    key = "projectEval"; // fallback
  }

  // 버튼 active 상태 토글
  const buttons = document.querySelectorAll<HTMLButtonElement>(".instructor-tab-btn");
  buttons.forEach((b) => {
    const isActive = b.dataset.subTab === key;
    b.classList.toggle("is-active", isActive);
    b.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  // 섹션 표시/숨김
  for (const k of SUBTAB_KEYS) {
    const sec = document.getElementById(SUBTAB_TO_SECTION_ID[k]);
    if (sec) sec.style.display = k === key ? "" : "none";
  }

  // localStorage 저장
  try {
    localStorage.setItem(SUBTAB_STORAGE_KEY, key);
  } catch {
    /* private mode 등 무시 */
  }

  // lazy init (최초 1회)
  if (!initialized[key]) {
    initialized[key] = true;
    try {
      switch (key) {
        case "projectEval": {
          const mod = await import("./projectEvalInit");
          mod.initProjectEval();
          break;
        }
        case "projectReward": {
          const mod = await import("./projectRewardInit");
          mod.initProjectReward();
          break;
        }
        case "operationDiag": {
          const mod = await import("./operationDiagInit");
          mod.initOperationDiag();
          break;
        }
        case "instructorDiag": {
          const mod = await import("./instructorDiagInit");
          mod.initInstructorDiag();
          break;
        }
      }
    } catch (e) {
      console.warn(`[InstructorHub] ${key} 초기화 실패:`, e);
      initialized[key] = false; // 재시도 가능하도록
    }
  }
}

function loadSavedSubTab(): InstructorSubTabKey | null {
  try {
    const v = localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (v && (SUBTAB_KEYS as readonly string[]).includes(v)) {
      return v as InstructorSubTabKey;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getFirstVisibleSubTab(): InstructorSubTabKey {
  // assistant-mode에서는 projectReward 제외하고 첫 번째
  if (document.body.classList.contains("assistant-mode")) {
    return "projectEval";
  }
  return "projectEval";
}
