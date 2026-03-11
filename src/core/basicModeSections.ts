export const BASIC_MODE_HIDDEN_SELECTORS = [
  "#sectionRiskSummary",
  "#sectionStaffingAssign",
  "#sectionParseErrors",
  "#sectionConflicts",
  "#sectionStateManagement",
  "#sectionChecklist",
  "#standardizeHelp",
  "#standardizeStatus",
  "#staffModuleManagerContainer",
] as const;

export function removeBasicModeSections(root: ParentNode): void {
  for (const selector of BASIC_MODE_HIDDEN_SELECTORS) {
    root.querySelector(selector)?.remove();
  }
}
