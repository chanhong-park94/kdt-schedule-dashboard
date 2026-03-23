/**
 * 설정 탭 초기화 — 토글 + HRD 설정 렌더링 + 이벤트 바인딩
 * tabRegistry.ts에서 lazy-load로 호출됨
 */

/** 접이식 섹션 토글 + 키보드 접근성 바인딩 */
function setupSettingsToggles(): void {
  document.querySelectorAll<HTMLElement>("[data-settings-toggle]").forEach((header) => {
    if (header.dataset.toggleBound) return;
    header.dataset.toggleBound = "1";

    header.addEventListener("click", () => {
      const body = header.nextElementSibling as HTMLElement | null;
      if (!body) return;
      const isExpanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", isExpanded ? "false" : "true");
      body.classList.toggle("is-collapsed", isExpanded);
    });
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        header.click();
      }
    });
  });
}

export async function initSettings(): Promise<void> {
  // 1) 접이식 토글 바인딩
  setupSettingsToggles();

  // 2) HRD 과정 목록 + Slack UI 렌더링 + 이벤트 핸들러 바인딩
  const { renderHrdSettingsSection, setupSettingsHandlers } = await import("./hrdAttendance");
  await renderHrdSettingsSection();
  setupSettingsHandlers();
}
