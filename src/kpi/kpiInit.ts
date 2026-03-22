import { fetchKpiData, testKpiConnection, loadKpiConfig, saveKpiConfig } from "./kpiSheets";
import { renderKpiDashboard, populateFilters, initKpiTabs, resetKpiDashboard } from "./kpiReport";
import { printKpiReport } from "./kpiPdf";
import type { KpiAllData, KpiConfig } from "./kpiTypes";

export function initKpiSection(): void {
  let kpiData: KpiAllData | null = null;
  const statusEl = document.getElementById("kpiUploadStatus");
  const connectStatusEl = document.getElementById("kpiConnectStatus");
  const connectUrlInput = document.getElementById("kpiConnectUrl") as HTMLInputElement | null;
  const connectModeSelect = document.getElementById("kpiConnectMode") as HTMLSelectElement | null;

  // KPI 탭 전환 초기화
  initKpiTabs();

  function setStatus(el: HTMLElement | null, msg: string, type: "success" | "error" | "loading" = "loading") {
    if (!el) return;
    el.textContent = msg;
    el.className = `kpi-connect-status ${type}`;
  }

  // 저장된 설정 로드 & UI 반영
  const savedConfig = loadKpiConfig();
  if (connectUrlInput && savedConfig.webAppUrl) {
    connectUrlInput.value = savedConfig.webAppUrl;
    if (connectModeSelect) connectModeSelect.value = "appsscript";
  } else if (connectUrlInput && savedConfig.spreadsheetId) {
    connectUrlInput.value = savedConfig.spreadsheetId;
    if (connectModeSelect) connectModeSelect.value = "published";
  }

  function getConfigFromForm(): KpiConfig {
    const mode = connectModeSelect?.value ?? "appsscript";
    const val = connectUrlInput?.value.trim() ?? "";
    if (mode === "appsscript") {
      return { webAppUrl: val, spreadsheetId: "" };
    } else {
      // URL에서 스프레드시트 ID 추출
      const match = val.match(/\/d\/([a-zA-Z0-9_-]+)/);
      return { webAppUrl: "", spreadsheetId: match ? match[1] : val };
    }
  }

  // 연결 테스트
  document.getElementById("kpiConnectTestBtn")?.addEventListener("click", async () => {
    const config = getConfigFromForm();
    setStatus(connectStatusEl, "연결 테스트 중...", "loading");
    const result = await testKpiConnection(config);
    setStatus(connectStatusEl, result.message, result.ok ? "success" : "error");
  });

  // 저장 후 불러오기
  document.getElementById("kpiConnectSaveBtn")?.addEventListener("click", async () => {
    const config = getConfigFromForm();
    if (!config.webAppUrl && !config.spreadsheetId) {
      setStatus(connectStatusEl, "URL 또는 스프레드시트 ID를 입력하세요.", "error");
      return;
    }
    saveKpiConfig(config);
    setStatus(connectStatusEl, "설정 저장됨. 데이터 불러오는 중...", "loading");
    await loadKpiDataAndRender(config);
  });

  // 데이터 불러오기 버튼
  document.getElementById("kpiLoadBtn")?.addEventListener("click", async () => {
    const config = loadKpiConfig();
    if (!config.webAppUrl && !config.spreadsheetId) {
      if (statusEl) statusEl.textContent = "⚠️ Google Sheets 연결 설정을 먼저 해주세요.";
      return;
    }
    if (statusEl) statusEl.textContent = "데이터 불러오는 중...";
    await loadKpiDataAndRender(config);
  });

  // PDF 리포트
  document.getElementById("kpiPdfBtn")?.addEventListener("click", () => {
    if (!kpiData) {
      alert("데이터를 먼저 불러오세요.");
      return;
    }
    const course = (document.getElementById("kpiFilterCourse") as HTMLSelectElement)?.value ?? "all";
    const cohort = (document.getElementById("kpiFilterCohort") as HTMLSelectElement)?.value ?? "all";
    printKpiReport(kpiData, course, cohort);
  });

  // 초기화
  document.getElementById("kpiClearBtn")?.addEventListener("click", () => {
    kpiData = null;
    window.__kpiAllData = null;
    resetKpiDashboard();
    if (statusEl) statusEl.textContent = "";
  });

  // 필터 변경
  document.getElementById("kpiFilterCourse")?.addEventListener("change", () => applyFilters());
  document.getElementById("kpiFilterCohort")?.addEventListener("change", () => applyFilters());

  function applyFilters() {
    if (!kpiData) return;
    const course = (document.getElementById("kpiFilterCourse") as HTMLSelectElement)?.value ?? "all";
    const cohort = (document.getElementById("kpiFilterCohort") as HTMLSelectElement)?.value ?? "all";
    renderKpiDashboard(kpiData, course, cohort);
  }

  async function loadKpiDataAndRender(config: KpiConfig) {
    try {
      kpiData = await fetchKpiData(config);
      window.__kpiAllData = kpiData;
      populateFilters(kpiData);
      renderKpiDashboard(kpiData);
      if (statusEl) statusEl.textContent = `✅ ${kpiData.achievement.length}명 학습자 데이터 로드 완료`;
      setStatus(connectStatusEl, `✅ 연결 완료! ${kpiData.achievement.length}명 데이터 로드`, "success");
    } catch (e) {
      const msg = `❌ 데이터 로드 실패: ${(e as Error).message}`;
      if (statusEl) statusEl.textContent = msg;
      setStatus(connectStatusEl, msg, "error");
    }
  }

  // 저장된 설정이 있으면 자동 로드
  if (savedConfig.webAppUrl || savedConfig.spreadsheetId) {
    void loadKpiDataAndRender(savedConfig);
  }
}
