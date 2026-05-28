import { renderFacilitatorPage } from "./facilitatorView";

export function initFacilitator(): void {
  const container = document.getElementById("facilitatorPage");
  if (!container) {
    console.warn("[facilitator] #facilitatorPage container not found");
    return;
  }
  if (container.dataset.initialized === "true") return;
  renderFacilitatorPage(container);
  container.dataset.initialized = "true";
}
