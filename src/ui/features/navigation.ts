import { appState, type PrimarySidebarNavKey } from "../appState";
import { domRefs } from "../domRefs";
import { isPrimarySidebarNavKey } from "./sidebarMenu";

export type ActivatePrimaryPageOptions = {
  scrollToTop?: boolean;
  openManagementTab?: boolean;
};

type NavigationDeps = {
  renderHeaderRuntimeStatus: () => void;
  getTrackTypeMissingCohorts: () => string[];
  getUnassignedInstructorModules: () => string[];
  isHolidayApplied: () => boolean;
  isHrdChecklistPassed: () => boolean;
};

const defaultDeps: NavigationDeps = {
  renderHeaderRuntimeStatus: () => {},
  getTrackTypeMissingCohorts: () => [],
  getUnassignedInstructorModules: () => [],
  isHolidayApplied: () => false,
  isHrdChecklistPassed: () => false,
};

let deps: NavigationDeps = defaultDeps;

export function initNavigationFeature(nextDeps: NavigationDeps): void {
  deps = nextDeps;
}

export function closeDrawers(): void {
  appState.activeDrawer = null;
  domRefs.drawerBackdrop.classList.remove("open");
  domRefs.notificationDrawer.classList.remove("open");
  domRefs.notificationDrawer.setAttribute("aria-hidden", "true");

  if (appState.managementInlineMode) {
    domRefs.instructorDrawer.classList.add("open");
    domRefs.instructorDrawer.setAttribute("aria-hidden", "false");
    return;
  }

  domRefs.instructorDrawer.classList.remove("open");
  domRefs.instructorDrawer.setAttribute("aria-hidden", "true");
}

export function openDrawer(target: "notification" | "instructor"): void {
  closeDrawers();
  appState.activeDrawer = target;
  if (target === "notification") {
    domRefs.drawerBackdrop.classList.add("open");
    domRefs.notificationDrawer.classList.add("open");
    domRefs.notificationDrawer.setAttribute("aria-hidden", "false");
    return;
  }

  domRefs.instructorDrawer.classList.add("open");
  domRefs.instructorDrawer.setAttribute("aria-hidden", "false");
  if (!appState.managementInlineMode) {
    domRefs.drawerBackdrop.classList.add("open");
  }
}

export function switchInstructorDrawerTab(tab: "course" | "register" | "mapping" | "subject"): void {
  const course = tab === "course";
  const register = tab === "register";
  const mapping = tab === "mapping";
  const subject = tab === "subject";
  domRefs.instructorTabCourse.classList.toggle("active", course);
  domRefs.instructorTabRegister.classList.toggle("active", register);
  domRefs.instructorTabMapping.classList.toggle("active", mapping);
  domRefs.instructorTabSubject.classList.toggle("active", subject);
  domRefs.quickNavCourseButton.classList.toggle("is-active", course);
  domRefs.quickNavSubjectButton.classList.toggle("is-active", subject);
  domRefs.quickNavInstructorButton.classList.toggle("is-active", register);
  domRefs.quickNavMappingButton.classList.toggle("is-active", mapping);
  domRefs.instructorCoursePanel.style.display = course ? "block" : "none";
  domRefs.instructorRegisterPanel.style.display = register ? "block" : "none";
  domRefs.instructorMappingPanel.style.display = mapping ? "block" : "none";
  domRefs.instructorSubjectPanel.style.display = subject ? "block" : "none";

  if (course) {
    setJibbleManagementSubmenuActive("course");
  } else if (subject) {
    setJibbleManagementSubmenuActive("subject");
  } else if (register) {
    setJibbleManagementSubmenuActive("instructor");
  }
}

export function openInstructorDrawerWithTab(tab: "course" | "register" | "mapping" | "subject"): void {
  openDrawer("instructor");
  switchInstructorDrawerTab(tab);
  if (appState.managementInlineMode) {
    domRefs.instructorDrawer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export function setNotificationFocus(focus: { cohort?: string; assignee?: string; date?: string } | null): void {
  appState.notificationFocus = focus;
}

export function setPageGroupVisibility(activePage: PrimarySidebarNavKey): void {
  for (const element of domRefs.jibblePageGroupElements) {
    const group = element.dataset.pageGroup?.trim() ?? "";
    if (!group) {
      continue;
    }

    element.classList.toggle("jibble-page-hidden", group !== activePage);
  }
}

export function activatePrimarySidebarPage(navKey: PrimarySidebarNavKey, options: ActivatePrimaryPageOptions = {}): void {
  appState.activePrimarySidebarPage = navKey;
  setJibbleSidebarActive(navKey);
  setPageGroupVisibility(navKey);

  // 설정 페이지에 과정 정보입력(management) 콘텐츠가 통합됨
  const showManagement = navKey === "settings";
  setJibbleManagementSubmenuVisible(showManagement);
  if (showManagement && options.openManagementTab !== false) {
    setJibbleManagementSubmenuActive("course");
    openInstructorDrawerWithTab("course");
  }

  if (options.scrollToTop !== false) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

export function scrollToSection(sectionId: string): void {
  const target = document.getElementById(sectionId);
  if (!target) {
    return;
  }

  const pageGroup = target.dataset.pageGroup?.trim() ?? "";
  if (isPrimarySidebarNavKey(pageGroup) && pageGroup !== appState.activePrimarySidebarPage) {
    activatePrimarySidebarPage(pageGroup, { scrollToTop: false, openManagementTab: false });
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function setJibbleManagementSubmenuVisible(visible: boolean): void {
  if (!domRefs.jibbleManagementSubmenu) {
    return;
  }

  domRefs.jibbleManagementSubmenu.classList.toggle("u-hidden", !visible);
}

export function setJibbleManagementSubmenuActive(tab: "course" | "subject" | "instructor"): void {
  domRefs.jibbleSubCourseButton?.classList.toggle("is-active", tab === "course");
  domRefs.jibbleSubSubjectButton?.classList.toggle("is-active", tab === "subject");
  domRefs.jibbleSubInstructorButton?.classList.toggle("is-active", tab === "instructor");
}

export function setJibbleSidebarActive(navKey: PrimarySidebarNavKey): void {
  for (const button of domRefs.jibblePrimaryNavButtons) {
    const currentKey = button.dataset.navKey?.trim() ?? "";
    button.classList.toggle("is-active", currentKey === navKey);
  }
}

export function setupJibbleSidebarNavigation(): void {
  if (domRefs.jibblePrimaryNavButtons.length === 0) {
    return;
  }

  for (const button of domRefs.jibblePrimaryNavButtons) {
    button.addEventListener("click", () => {
      const navKeyRaw = button.dataset.navKey?.trim() ?? "";
      if (!isPrimarySidebarNavKey(navKeyRaw)) {
        return;
      }

      activatePrimarySidebarPage(navKeyRaw, {
        scrollToTop: true,
        openManagementTab: navKeyRaw === "settings",
      });
    });
  }

  for (const button of domRefs.jibbleSubNavButtons) {
    button.addEventListener("click", () => {
      const targetId = button.dataset.scrollTarget?.trim() ?? "";
      if (!targetId) {
        return;
      }

      scrollToSection(targetId);
    });
  }

  const activeButton =
    domRefs.jibblePrimaryNavButtons.find((button) => button.classList.contains("is-active")) || domRefs.jibblePrimaryNavButtons[0];
  const initialNavKeyRaw = activeButton?.dataset.navKey?.trim() ?? "timeline";
  const initialNavKey = isPrimarySidebarNavKey(initialNavKeyRaw) ? initialNavKeyRaw : "timeline";

  activatePrimarySidebarPage(initialNavKey, {
    scrollToTop: false,
    openManagementTab: false,
  });

  // Mobile bottom nav
  const mobileNavButtons = document.querySelectorAll<HTMLButtonElement>("[data-mobile-nav]");
  for (const btn of mobileNavButtons) {
    btn.addEventListener("click", () => {
      const navKeyRaw = btn.dataset.mobileNav?.trim() ?? "";
      if (!isPrimarySidebarNavKey(navKeyRaw)) {
        return;
      }
      // Update mobile active state
      for (const b of mobileNavButtons) b.classList.remove("is-active");
      btn.classList.add("is-active");
      // Also sync desktop sidebar
      activatePrimarySidebarPage(navKeyRaw, {
        scrollToTop: true,
        openManagementTab: navKeyRaw === "settings",
      });
    });
  }
}

export function renderGlobalWarnings(): void {
  const warnings: string[] = [];
  const trackTypeMissing = deps.getTrackTypeMissingCohorts();
  const unassignedModules = deps.getUnassignedInstructorModules();
  const cloudWarning = appState.instructorDirectoryCloudWarning.trim();
  const managementWarning = appState.managementCloudWarning.trim();

  if (trackTypeMissing.length > 0) {
    warnings.push(`trackType 미설정 코호트: ${trackTypeMissing.join(", ")}`);
  }

  if (unassignedModules.length > 0) {
    const preview = unassignedModules.slice(0, 6).join(", ");
    const suffix = unassignedModules.length > 6 ? ` 외 ${unassignedModules.length - 6}건` : "";
    warnings.push(`강사 배정 안된 모듈/코호트: ${preview}${suffix}`);
  }

  if (appState.hasComputedConflicts && appState.allConflicts.length > 0) {
    warnings.push(`강사 시간 충돌 ${appState.allConflicts.length}건`);
  }

  if (domRefs.cohortSelect.value && appState.hrdValidationErrors.length > 0) {
    warnings.push(`HRD 검증 오류 ${appState.hrdValidationErrors.length}건 (기수: ${domRefs.cohortSelect.value})`);
  }

  if (cloudWarning) {
    warnings.push(`강사 동기화: ${cloudWarning}`);
  }

  if (managementWarning) {
    warnings.push(`관리 데이터 동기화: ${managementWarning}`);
  }

  domRefs.globalWarningList.innerHTML = "";

  if (warnings.length === 0) {
    domRefs.globalWarningPanel.style.display = "none";
    deps.renderHeaderRuntimeStatus();
    return;
  }

  domRefs.globalWarningPanel.style.display = "block";
  for (const warning of warnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    domRefs.globalWarningList.appendChild(li);
  }
  deps.renderHeaderRuntimeStatus();
}

export function setRiskCardState(
  card: HTMLElement,
  valueElement: HTMLElement,
  text: string,
  tone: "ok" | "warn" | "error",
): void {
  card.classList.remove("risk-ok", "risk-warn", "risk-error");
  card.classList.add(tone === "ok" ? "risk-ok" : tone === "warn" ? "risk-warn" : "risk-error");
  valueElement.textContent = text;
}

export function renderRiskSummary(): void {
  if (!appState.hasComputedConflicts) {
    setRiskCardState(domRefs.riskCardTime, domRefs.riskTimeConflict, "0 / 미계산", "warn");
  } else {
    setRiskCardState(
      domRefs.riskCardTime,
      domRefs.riskTimeConflict,
      `0 / ${appState.allConflicts.length}`,
      appState.allConflicts.length === 0 ? "ok" : "error",
    );
  }

  if (appState.staffingAssignments.length === 0) {
    setRiskCardState(domRefs.riskCardInstructorDay, domRefs.riskInstructorDayConflict, "0 / 미계산", "warn");
    setRiskCardState(domRefs.riskCardFoDay, domRefs.riskFoDayConflict, "0 / 미계산", "warn");
  } else {
    setRiskCardState(
      domRefs.riskCardInstructorDay,
      domRefs.riskInstructorDayConflict,
      `0 / ${appState.instructorDayOverlaps.length}`,
      appState.instructorDayOverlaps.length === 0 ? "ok" : "error",
    );
    setRiskCardState(
      domRefs.riskCardFoDay,
      domRefs.riskFoDayConflict,
      `0 / ${appState.facilitatorOperationOverlaps.length}`,
      appState.facilitatorOperationOverlaps.length === 0 ? "ok" : "error",
    );
  }

  if (!domRefs.cohortSelect.value) {
    setRiskCardState(domRefs.riskCardHrd, domRefs.riskHrdValidation, "대상 없음", "warn");
  } else {
    setRiskCardState(
      domRefs.riskCardHrd,
      domRefs.riskHrdValidation,
      deps.isHrdChecklistPassed() ? "통과" : "미통과",
      deps.isHrdChecklistPassed() ? "ok" : "warn",
    );
  }

  setRiskCardState(
    domRefs.riskCardHoliday,
    domRefs.riskHolidayApplied,
    deps.isHolidayApplied() ? "적용" : "미적용",
    deps.isHolidayApplied() ? "ok" : "warn",
  );
}

export function renderJibbleRightRail(): void {
  if (
    !domRefs.jibbleRightMemberText ||
    !domRefs.jibbleRightStatInstructor ||
    !domRefs.jibbleRightStatCohort ||
    !domRefs.jibbleRightStatConflict ||
    !domRefs.jibbleOpsStatus ||
    !domRefs.jibbleOpsSummary
  ) {
    return;
  }

  const instructorCount = appState.instructorDirectory.length;
  const cohortCount = appState.summaries.length;
  const conflictCount = appState.hasComputedConflicts ? appState.allConflicts.length : -1;
  const unassignedCount = deps.getUnassignedInstructorModules().length;

  domRefs.jibbleRightMemberText.textContent = `강사 ${instructorCount}명 등록`;
  domRefs.jibbleRightStatInstructor.textContent = String(instructorCount);
  domRefs.jibbleRightStatCohort.textContent = String(cohortCount);
  domRefs.jibbleRightStatConflict.textContent = conflictCount >= 0 ? String(conflictCount) : "-";

  if (!domRefs.cohortSelect.value) {
    domRefs.jibbleOpsStatus.textContent = "검토중";
    domRefs.jibbleOpsSummary.textContent = "기수를 선택하면 운영 상태를 계산합니다.";
    return;
  }

  if (!appState.hasComputedConflicts) {
    domRefs.jibbleOpsStatus.textContent = "분석대기";
    domRefs.jibbleOpsSummary.textContent = `${domRefs.cohortSelect.value} · 시간 충돌 계산 전`;
    return;
  }

  if (deps.isHrdChecklistPassed()) {
    domRefs.jibbleOpsStatus.textContent = "안정";
    domRefs.jibbleOpsSummary.textContent = `${domRefs.cohortSelect.value} · HRD 점검 통과 준비 완료`;
    return;
  }

  if (appState.allConflicts.length > 0 || appState.instructorDayOverlaps.length > 0 || unassignedCount > 0) {
    domRefs.jibbleOpsStatus.textContent = "점검필요";
    domRefs.jibbleOpsSummary.textContent = `${domRefs.cohortSelect.value} · 시간충돌 ${appState.allConflicts.length}건 / 일충돌 ${appState.instructorDayOverlaps.length}건 / 미배정 ${unassignedCount}건`;
    return;
  }

  domRefs.jibbleOpsStatus.textContent = "검토중";
  domRefs.jibbleOpsSummary.textContent = `${domRefs.cohortSelect.value} · 운영 체크리스트 점검 중`;
}

export function clearGanttHighlights(): void {
  const highlighted = document.querySelectorAll<HTMLElement>(".staff-gantt-bar.gantt-highlight");
  for (const element of highlighted) {
    element.classList.remove("gantt-highlight");
  }
}

export function highlightGanttByCohortModule(cohort: string, module?: string): void {
  clearGanttHighlights();

  const bars = document.querySelectorAll<HTMLElement>(
    "#staffCohortGantt .staff-gantt-bar, #staffAssigneeGantt .staff-gantt-bar",
  );
  const matched: HTMLElement[] = [];

  for (const bar of bars) {
    const barCohort = bar.dataset.cohort ?? "";
    const barPhase = bar.dataset.phase ?? "";
    if (barCohort !== cohort) {
      continue;
    }
    if (module && barPhase !== module) {
      continue;
    }
    bar.classList.add("gantt-highlight");
    matched.push(bar);
  }

  if (matched.length > 0) {
    matched[0].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }

  if (appState.ganttHighlightTimer !== undefined) {
    window.clearTimeout(appState.ganttHighlightTimer);
  }
  appState.ganttHighlightTimer = window.setTimeout(() => clearGanttHighlights(), 3500);
}
