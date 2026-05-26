import { renderGuidelinePage } from "./guidelineView";

export async function initGuideline(): Promise<void> {
  const container = document.getElementById("guidelinePage");
  if (!container) {
    console.warn("[guideline] #guidelinePage container not found");
    return;
  }
  if (container.dataset.initialized === "true") return;
  renderGuidelinePage(container);
  container.dataset.initialized = "true";
}

export { focusGuidelineItem } from "./guidelineView";
