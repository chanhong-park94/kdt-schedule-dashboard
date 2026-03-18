/** 주간 운영회의 보고팩 — 진입점 */
import type { KpiAllData } from "../kpi/kpiTypes";
import type { WeeklyOpsReportConfig } from "./weeklyOpsReportTypes";
import { collectWeeklyOpsReportData } from "./weeklyOpsReportSelectors";
import { buildWeeklyOpsReportHtml } from "./weeklyOpsReportPrint";

export { checkDataAvailability } from "./weeklyOpsReportSelectors";

/** ISO 주차 라벨 생성 (e.g. "2026년 제11주차 (3/10~3/14)") */
export function getWeekLabel(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  // Monday of this week
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  // Friday of this week
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const year = monday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayOfYear = Math.ceil((monday.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);

  const mM = monday.getMonth() + 1;
  const mD = monday.getDate();
  const fM = friday.getMonth() + 1;
  const fD = friday.getDate();

  return `${year}년 제${weekNum}주차 (${mM}/${mD}~${fM}/${fD})`;
}

/**
 * 보고팩 생성 및 새 창에서 인쇄
 * @param config 페이지 선택 + 날짜 설정
 * @param kpiData KPI 데이터 (null이면 Page 5 비활성)
 */
export function printWeeklyOpsReport(config: WeeklyOpsReportConfig, kpiData: KpiAllData | null): void {
  const data = collectWeeklyOpsReportData(config, kpiData);
  const html = buildWeeklyOpsReportHtml(data);

  if (!html) {
    alert("선택된 페이지가 없거나 데이터가 없습니다.");
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("팝업이 차단되었습니다. 팝업 차단을 해제한 뒤 다시 시도하세요.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}
