import { printWeeklyOpsReport, checkDataAvailability, getWeekLabel } from "./weeklyOpsReport";

export function initWeeklyReport(): void {
  const generateBtn = document.getElementById("weeklyReportGenerateBtn");
  const statusEl = document.getElementById("weeklyReportStatus");
  const dataStatusEl = document.getElementById("weeklyReportDataStatus");
  const page3Check = document.getElementById("weeklyReportPage3") as HTMLInputElement | null;
  const page4Check = document.getElementById("weeklyReportPage4") as HTMLInputElement | null;
  const page5Check = document.getElementById("weeklyReportPage5") as HTMLInputElement | null;

  function updateDataStatus(): void {
    if (!dataStatusEl) return;
    const avail = checkDataAvailability();
    const kpiLoaded = window.__kpiAllData != null;
    const indicator = (ok: boolean, label: string) =>
      `<div class="weekly-report-indicator ${ok ? "is-ok" : "is-missing"}">${ok ? "✅" : "⚠️"} ${label} ${ok ? "준비됨" : "없음"}</div>`;
    dataStatusEl.innerHTML = [
      indicator(avail.hasAttendance, "출결 데이터"),
      indicator(avail.hasDropout, "하차방어율 데이터"),
      indicator(avail.hasAnalytics, "훈련생 분석 데이터"),
      indicator(kpiLoaded, "KPI 데이터"),
    ].join("");
  }

  const header = document.querySelector("#settingsWeeklyReport .settings-section-header");
  header?.addEventListener("click", () => setTimeout(updateDataStatus, 50));

  generateBtn?.addEventListener("click", () => {
    updateDataStatus();
    const config = {
      includePage3: page3Check?.checked ?? true,
      includePage4: page4Check?.checked ?? true,
      includePage5: page5Check?.checked ?? false,
      reportDate: new Date().toISOString().slice(0, 10),
      reportWeekLabel: getWeekLabel(new Date()),
    };
    if (!config.includePage3 && !config.includePage4 && !config.includePage5) {
      if (statusEl) statusEl.textContent = "⚠️ 최소 1개 페이지를 선택하세요.";
      return;
    }
    if (statusEl) statusEl.textContent = "보고팩 생성 중...";
    printWeeklyOpsReport(config, window.__kpiAllData ?? null);
    if (statusEl) statusEl.textContent = `✅ 보고팩 생성 완료 (${new Date().toLocaleTimeString()})`;
  });
}
