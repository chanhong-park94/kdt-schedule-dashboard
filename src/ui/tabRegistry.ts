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
  revenue: createTabLoader(async () => {
    const { initRevenue } = await import("../hrd/hrdRevenueInit");
    initRevenue();
  }),
  docAutomation: createTabLoader(async () => {
    const { initDocAutomation } = await import("../docAutomation/docAutomationInit");
    initDocAutomation();
  }),
  projectEval: createTabLoader(async () => {
    const { initProjectEval } = await import("../instructor/projectEvalInit");
    initProjectEval();
  }),
  projectReward: createTabLoader(async () => {
    const { initProjectReward } = await import("../instructor/projectRewardInit");
    initProjectReward();
  }),
  operationDiag: createTabLoader(async () => {
    const { initOperationDiag } = await import("../instructor/operationDiagInit");
    initOperationDiag();
  }),
  instructorDiag: createTabLoader(async () => {
    const { initInstructorDiag } = await import("../instructor/instructorDiagInit");
    initInstructorDiag();
  }),
  settings: createTabLoader(async () => {
    const { initSettings } = await import("../hrd/settingsInit");
    await initSettings();
  }),
};

export async function ensureTabLoaded(navKey: PrimarySidebarNavKey): Promise<void> {
  const loader = tabLoaders[navKey];
  if (loader) {
    await loader();
  }
}
