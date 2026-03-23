/**
 * 설정 탭 초기화 — 접이식 섹션 토글 바인딩
 * tabRegistry.ts에서 lazy-load로 호출됨
 */

/** 접이식 섹션 토글 + 키보드 접근성 바인딩 */
function setupSettingsToggles(): void {
  document.querySelectorAll<HTMLElement>("[data-settings-toggle]").forEach((header) => {
    // 이미 바인딩된 경우 중복 방지
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

export function initSettings(): void {
  setupSettingsToggles();
}
