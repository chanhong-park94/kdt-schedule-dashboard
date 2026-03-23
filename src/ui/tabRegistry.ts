import { createTabLoader } from "./tabLoader";
import type { PrimarySidebarNavKey } from "./appState";

const tabLoaders: Partial<Record<PrimarySidebarNavKey, () => Promise<void>>> = {
  attendance: createTabLoader(async () => {
    const { initAttendanceDashboard } = await import("../hrd/hrdAttendance");
    initAttendanceDashboard();
  }),
  analytics: createTabLoader(async () => {
    const { initAnalytics } = await import("../hrd/hrdAnalytics");
    initAnalytics();
  }),
  dropout: createTabLoader(async () => {
    const { initDropoutDashboard } = await import("../hrd/hrdDropout");
    initDropoutDashboard();
  }),
  dashboard: createTabLoader(async () => {
    const { initDashboard } = await import("../hrd/hrdDashboard");
    await initDashboard();
  }),
  traineeHistory: createTabLoader(async () => {
    const { initTraineeHistory } = await import("../hrd/hrdTraineeHistory");
    initTraineeHistory();
  }),
  achievement: createTabLoader(async () => {
    const { initAchievement } = await import("../hrd/hrdAchievement");
    initAchievement();
  }),
  inquiry: createTabLoader(async () => {
    const { initInquiry } = await import("../hrd/hrdInquiry");
    initInquiry();
  }),
  satisfaction: createTabLoader(async () => {
    const { initSatisfaction } = await import("../hrd/hrdSatisfaction");
    initSatisfaction();
  }),
  kpi: createTabLoader(async () => {
    const { initKpiSection } = await import("../kpi/kpiInit");
    initKpiSection();
  }),
  crossAnalysis: createTabLoader(async () => {
    const { initCrossAnalysis } = await import("../crossAnalysis/crossAnalysisInit");
    initCrossAnalysis();
  }),
  settings: createTabLoader(async () => {
    const { initSettings } = await import("../hrd/settingsInit");
    initSettings();
  }),
};

export async function ensureTabLoaded(navKey: PrimarySidebarNavKey): Promise<void> {
  const loader = tabLoaders[navKey];
  if (loader) {
    await loader();
  }
}
