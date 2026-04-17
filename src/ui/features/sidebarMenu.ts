import { appState, type PrimarySidebarNavKey, type SidebarMenuConfig } from "../appState";
import { domRefs } from "../domRefs";

type SidebarMenuDeps = {
  setJibbleSidebarActive: (navKey: PrimarySidebarNavKey) => void;
};

const defaultDeps: SidebarMenuDeps = {
  setJibbleSidebarActive: () => {},
};

let deps: SidebarMenuDeps = defaultDeps;

export function initSidebarMenuFeature(nextDeps: SidebarMenuDeps): void {
  deps = nextDeps;
}

const SIDEBAR_MENU_CONFIG_KEY = "academic_schedule_manager_sidebar_menu_v5";

export const PRIMARY_SIDEBAR_NAV_KEYS: PrimarySidebarNavKey[] = [
  "dashboard",
  "timeline",
  "generator",
  "kpi",
  "dropout",
  "attendance",
  "analytics",
  "traineeHistory",
  "achievement",
  "inquiry",
  "satisfaction",
  "crossAnalysis",
  "revenue",
  "docAutomation",
  "projectEval",
  "projectReward",
  "operationDiag",
  "instructorDiag",
  "settings",
];

export const DEFAULT_PRIMARY_SIDEBAR_LABELS: Record<PrimarySidebarNavKey, string> = {
  dashboard: "대시보드",
  timeline: "학사일정",
  dropout: "하차방어율 (KPI)",
  generator: "HRD시간표 생성",
  kpi: "자율성과지표",
  attendance: "출결현황",
  analytics: "출결 리스크",
  traineeHistory: "훈련생 이력",
  achievement: "학업성취도",
  inquiry: "문의응대",
  satisfaction: "만족도",
  crossAnalysis: "교차분석",
  revenue: "매출",
  docAutomation: "문서자동화",
  projectEval: "프로젝트 평가",
  projectReward: "프로젝트 보상",
  operationDiag: "운영 진단",
  instructorDiag: "교강사 진단",
  settings: "설정",
};

export const DEFAULT_PRIMARY_SIDEBAR_ICONS: Record<PrimarySidebarNavKey, string> = {
  dashboard: "dashboard",
  timeline: "calendar",
  dropout: "shield",
  generator: "wrench",
  kpi: "chart",
  attendance: "clipboard",
  analytics: "analytics",
  traineeHistory: "user",
  achievement: "star",
  inquiry: "chat",
  satisfaction: "heart",
  crossAnalysis: "compare",
  revenue: "coin",
  docAutomation: "document",
  projectEval: "project",
  projectReward: "reward",
  operationDiag: "diagnosis",
  instructorDiag: "teacher",
  settings: "settings",
};

export function isPrimarySidebarNavKey(value: string): value is PrimarySidebarNavKey {
  return PRIMARY_SIDEBAR_NAV_KEYS.includes(value as PrimarySidebarNavKey);
}

export function normalizeSidebarMenuLabel(navKey: PrimarySidebarNavKey, value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PRIMARY_SIDEBAR_LABELS[navKey];
}

export function normalizeSidebarMenuIcon(navKey: PrimarySidebarNavKey, value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PRIMARY_SIDEBAR_ICONS[navKey];
}

export function cloneSidebarMenuConfig(config: SidebarMenuConfig): SidebarMenuConfig {
  return {
    order: [...config.order],
    labels: {
      dashboard: config.labels.dashboard,
      timeline: config.labels.timeline,
      dropout: config.labels.dropout,
      generator: config.labels.generator,
      kpi: config.labels.kpi,
      attendance: config.labels.attendance,
      analytics: config.labels.analytics,
      traineeHistory: config.labels.traineeHistory,
      achievement: config.labels.achievement,
      inquiry: config.labels.inquiry,
      satisfaction: config.labels.satisfaction,
      crossAnalysis: config.labels.crossAnalysis,
      revenue: config.labels.revenue,
      docAutomation: config.labels.docAutomation,
      projectEval: config.labels.projectEval,
      projectReward: config.labels.projectReward,
      operationDiag: config.labels.operationDiag,
      instructorDiag: config.labels.instructorDiag,
      settings: config.labels.settings,
    },
    icons: {
      dashboard: config.icons.dashboard,
      timeline: config.icons.timeline,
      dropout: config.icons.dropout,
      generator: config.icons.generator,
      kpi: config.icons.kpi,
      attendance: config.icons.attendance,
      analytics: config.icons.analytics,
      traineeHistory: config.icons.traineeHistory,
      achievement: config.icons.achievement,
      inquiry: config.icons.inquiry,
      satisfaction: config.icons.satisfaction,
      crossAnalysis: config.icons.crossAnalysis,
      revenue: config.icons.revenue,
      docAutomation: config.icons.docAutomation,
      projectEval: config.icons.projectEval,
      projectReward: config.icons.projectReward,
      operationDiag: config.icons.operationDiag,
      instructorDiag: config.icons.instructorDiag,
      settings: config.icons.settings,
    },
  };
}

export function normalizeSidebarMenuOrder(orderValue: unknown): PrimarySidebarNavKey[] {
  if (!Array.isArray(orderValue)) {
    return [...PRIMARY_SIDEBAR_NAV_KEYS];
  }

  const deduped: PrimarySidebarNavKey[] = [];
  for (const value of orderValue) {
    if (typeof value !== "string") {
      continue;
    }

    if (!isPrimarySidebarNavKey(value) || deduped.includes(value)) {
      continue;
    }

    deduped.push(value);
  }

  for (const navKey of PRIMARY_SIDEBAR_NAV_KEYS) {
    if (!deduped.includes(navKey)) {
      deduped.push(navKey);
    }
  }

  return deduped;
}

export function normalizeSidebarMenuConfig(config: SidebarMenuConfig): SidebarMenuConfig {
  return {
    order: normalizeSidebarMenuOrder(config.order),
    labels: {
      dashboard: normalizeSidebarMenuLabel("dashboard", config.labels.dashboard),
      timeline: normalizeSidebarMenuLabel("timeline", config.labels.timeline),
      dropout: normalizeSidebarMenuLabel("dropout", config.labels.dropout),
      generator: normalizeSidebarMenuLabel("generator", config.labels.generator),
      kpi: normalizeSidebarMenuLabel("kpi", config.labels.kpi),
      attendance: normalizeSidebarMenuLabel("attendance", config.labels.attendance),
      analytics: normalizeSidebarMenuLabel("analytics", config.labels.analytics),
      traineeHistory: normalizeSidebarMenuLabel("traineeHistory", config.labels.traineeHistory),
      achievement: normalizeSidebarMenuLabel("achievement", config.labels.achievement),
      inquiry: normalizeSidebarMenuLabel("inquiry", config.labels.inquiry),
      satisfaction: normalizeSidebarMenuLabel("satisfaction", config.labels.satisfaction),
      crossAnalysis: normalizeSidebarMenuLabel("crossAnalysis", config.labels.crossAnalysis),
      revenue: normalizeSidebarMenuLabel("revenue", config.labels.revenue),
      docAutomation: normalizeSidebarMenuLabel("docAutomation", config.labels.docAutomation),
      projectEval: normalizeSidebarMenuLabel("projectEval", config.labels.projectEval),
      projectReward: normalizeSidebarMenuLabel("projectReward", config.labels.projectReward),
      operationDiag: normalizeSidebarMenuLabel("operationDiag", config.labels.operationDiag),
      instructorDiag: normalizeSidebarMenuLabel("instructorDiag", config.labels.instructorDiag),
      settings: normalizeSidebarMenuLabel("settings", config.labels.settings),
    },
    icons: {
      dashboard: normalizeSidebarMenuIcon("dashboard", config.icons.dashboard),
      timeline: normalizeSidebarMenuIcon("timeline", config.icons.timeline),
      dropout: normalizeSidebarMenuIcon("dropout", config.icons.dropout),
      generator: normalizeSidebarMenuIcon("generator", config.icons.generator),
      kpi: normalizeSidebarMenuIcon("kpi", config.icons.kpi),
      attendance: normalizeSidebarMenuIcon("attendance", config.icons.attendance),
      analytics: normalizeSidebarMenuIcon("analytics", config.icons.analytics),
      traineeHistory: normalizeSidebarMenuIcon("traineeHistory", config.icons.traineeHistory),
      achievement: normalizeSidebarMenuIcon("achievement", config.icons.achievement),
      inquiry: normalizeSidebarMenuIcon("inquiry", config.icons.inquiry),
      satisfaction: normalizeSidebarMenuIcon("satisfaction", config.icons.satisfaction),
      crossAnalysis: normalizeSidebarMenuIcon("crossAnalysis", config.icons.crossAnalysis),
      revenue: normalizeSidebarMenuIcon("revenue", config.icons.revenue),
      docAutomation: normalizeSidebarMenuIcon("docAutomation", config.icons.docAutomation),
      projectEval: normalizeSidebarMenuIcon("projectEval", config.icons.projectEval),
      projectReward: normalizeSidebarMenuIcon("projectReward", config.icons.projectReward),
      operationDiag: normalizeSidebarMenuIcon("operationDiag", config.icons.operationDiag),
      instructorDiag: normalizeSidebarMenuIcon("instructorDiag", config.icons.instructorDiag),
      settings: normalizeSidebarMenuIcon("settings", config.icons.settings),
    },
  };
}

export function getDefaultSidebarMenuConfig(): SidebarMenuConfig {
  return {
    order: [...PRIMARY_SIDEBAR_NAV_KEYS],
    labels: {
      dashboard: DEFAULT_PRIMARY_SIDEBAR_LABELS.dashboard,
      timeline: DEFAULT_PRIMARY_SIDEBAR_LABELS.timeline,
      dropout: DEFAULT_PRIMARY_SIDEBAR_LABELS.dropout,
      generator: DEFAULT_PRIMARY_SIDEBAR_LABELS.generator,
      kpi: DEFAULT_PRIMARY_SIDEBAR_LABELS.kpi,
      attendance: DEFAULT_PRIMARY_SIDEBAR_LABELS.attendance,
      analytics: DEFAULT_PRIMARY_SIDEBAR_LABELS.analytics,
      traineeHistory: DEFAULT_PRIMARY_SIDEBAR_LABELS.traineeHistory,
      achievement: DEFAULT_PRIMARY_SIDEBAR_LABELS.achievement,
      inquiry: DEFAULT_PRIMARY_SIDEBAR_LABELS.inquiry,
      satisfaction: DEFAULT_PRIMARY_SIDEBAR_LABELS.satisfaction,
      crossAnalysis: DEFAULT_PRIMARY_SIDEBAR_LABELS.crossAnalysis,
      revenue: DEFAULT_PRIMARY_SIDEBAR_LABELS.revenue,
      docAutomation: DEFAULT_PRIMARY_SIDEBAR_LABELS.docAutomation,
      projectEval: DEFAULT_PRIMARY_SIDEBAR_LABELS.projectEval,
      projectReward: DEFAULT_PRIMARY_SIDEBAR_LABELS.projectReward,
      operationDiag: DEFAULT_PRIMARY_SIDEBAR_LABELS.operationDiag,
      instructorDiag: DEFAULT_PRIMARY_SIDEBAR_LABELS.instructorDiag,
      settings: DEFAULT_PRIMARY_SIDEBAR_LABELS.settings,
    },
    icons: {
      dashboard: DEFAULT_PRIMARY_SIDEBAR_ICONS.dashboard,
      timeline: DEFAULT_PRIMARY_SIDEBAR_ICONS.timeline,
      dropout: DEFAULT_PRIMARY_SIDEBAR_ICONS.dropout,
      generator: DEFAULT_PRIMARY_SIDEBAR_ICONS.generator,
      kpi: DEFAULT_PRIMARY_SIDEBAR_ICONS.kpi,
      attendance: DEFAULT_PRIMARY_SIDEBAR_ICONS.attendance,
      analytics: DEFAULT_PRIMARY_SIDEBAR_ICONS.analytics,
      traineeHistory: DEFAULT_PRIMARY_SIDEBAR_ICONS.traineeHistory,
      achievement: DEFAULT_PRIMARY_SIDEBAR_ICONS.achievement,
      inquiry: DEFAULT_PRIMARY_SIDEBAR_ICONS.inquiry,
      satisfaction: DEFAULT_PRIMARY_SIDEBAR_ICONS.satisfaction,
      crossAnalysis: DEFAULT_PRIMARY_SIDEBAR_ICONS.crossAnalysis,
      revenue: DEFAULT_PRIMARY_SIDEBAR_ICONS.revenue,
      docAutomation: DEFAULT_PRIMARY_SIDEBAR_ICONS.docAutomation,
      projectEval: DEFAULT_PRIMARY_SIDEBAR_ICONS.projectEval,
      projectReward: DEFAULT_PRIMARY_SIDEBAR_ICONS.projectReward,
      operationDiag: DEFAULT_PRIMARY_SIDEBAR_ICONS.operationDiag,
      instructorDiag: DEFAULT_PRIMARY_SIDEBAR_ICONS.instructorDiag,
      settings: DEFAULT_PRIMARY_SIDEBAR_ICONS.settings,
    },
  };
}

export function loadSidebarMenuConfig(): SidebarMenuConfig {
  const fallback = getDefaultSidebarMenuConfig();
  const raw = localStorage.getItem(SIDEBAR_MENU_CONFIG_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as {
      order?: unknown;
      labels?: Record<string, unknown>;
      icons?: Record<string, unknown>;
    };

    const order = normalizeSidebarMenuOrder(parsed.order);
    const labels = {
      dashboard: normalizeSidebarMenuLabel(
        "dashboard",
        typeof parsed.labels?.dashboard === "string" ? parsed.labels.dashboard : fallback.labels.dashboard,
      ),
      timeline: normalizeSidebarMenuLabel(
        "timeline",
        typeof parsed.labels?.timeline === "string" ? parsed.labels.timeline : fallback.labels.timeline,
      ),
      dropout: normalizeSidebarMenuLabel(
        "dropout",
        typeof parsed.labels?.dropout === "string" ? parsed.labels.dropout : fallback.labels.dropout,
      ),
      generator: normalizeSidebarMenuLabel(
        "generator",
        typeof parsed.labels?.generator === "string" ? parsed.labels.generator : fallback.labels.generator,
      ),
      kpi: normalizeSidebarMenuLabel(
        "kpi",
        typeof parsed.labels?.kpi === "string" ? parsed.labels.kpi : fallback.labels.kpi,
      ),
      attendance: normalizeSidebarMenuLabel(
        "attendance",
        typeof parsed.labels?.attendance === "string" ? parsed.labels.attendance : fallback.labels.attendance,
      ),
      analytics: normalizeSidebarMenuLabel(
        "analytics",
        typeof parsed.labels?.analytics === "string" ? parsed.labels.analytics : fallback.labels.analytics,
      ),
      traineeHistory: normalizeSidebarMenuLabel(
        "traineeHistory",
        typeof parsed.labels?.traineeHistory === "string"
          ? parsed.labels.traineeHistory
          : fallback.labels.traineeHistory,
      ),
      achievement: normalizeSidebarMenuLabel(
        "achievement",
        typeof parsed.labels?.achievement === "string" ? parsed.labels.achievement : fallback.labels.achievement,
      ),
      inquiry: normalizeSidebarMenuLabel(
        "inquiry",
        typeof parsed.labels?.inquiry === "string" ? parsed.labels.inquiry : fallback.labels.inquiry,
      ),
      satisfaction: normalizeSidebarMenuLabel(
        "satisfaction",
        typeof parsed.labels?.satisfaction === "string" ? parsed.labels.satisfaction : fallback.labels.satisfaction,
      ),
      crossAnalysis: normalizeSidebarMenuLabel(
        "crossAnalysis",
        typeof parsed.labels?.crossAnalysis === "string" ? parsed.labels.crossAnalysis : fallback.labels.crossAnalysis,
      ),
      revenue: normalizeSidebarMenuLabel(
        "revenue",
        typeof parsed.labels?.revenue === "string" ? parsed.labels.revenue : fallback.labels.revenue,
      ),
      docAutomation: normalizeSidebarMenuLabel(
        "docAutomation",
        typeof parsed.labels?.docAutomation === "string" ? parsed.labels.docAutomation : fallback.labels.docAutomation,
      ),
      projectEval: normalizeSidebarMenuLabel(
        "projectEval",
        typeof parsed.labels?.projectEval === "string" ? parsed.labels.projectEval : fallback.labels.projectEval,
      ),
      projectReward: normalizeSidebarMenuLabel(
        "projectReward",
        typeof parsed.labels?.projectReward === "string" ? parsed.labels.projectReward : fallback.labels.projectReward,
      ),
      operationDiag: normalizeSidebarMenuLabel(
        "operationDiag",
        typeof parsed.labels?.operationDiag === "string" ? parsed.labels.operationDiag : fallback.labels.operationDiag,
      ),
      instructorDiag: normalizeSidebarMenuLabel(
        "instructorDiag",
        typeof parsed.labels?.instructorDiag === "string"
          ? parsed.labels.instructorDiag
          : fallback.labels.instructorDiag,
      ),
      settings: normalizeSidebarMenuLabel(
        "settings",
        typeof parsed.labels?.settings === "string" ? parsed.labels.settings : fallback.labels.settings,
      ),
    };

    const icons = {
      dashboard: normalizeSidebarMenuIcon(
        "dashboard",
        typeof parsed.icons?.dashboard === "string" ? parsed.icons.dashboard : fallback.icons.dashboard,
      ),
      timeline: normalizeSidebarMenuIcon(
        "timeline",
        typeof parsed.icons?.timeline === "string" ? parsed.icons.timeline : fallback.icons.timeline,
      ),
      dropout: normalizeSidebarMenuIcon(
        "dropout",
        typeof parsed.icons?.dropout === "string" ? parsed.icons.dropout : fallback.icons.dropout,
      ),
      generator: normalizeSidebarMenuIcon(
        "generator",
        typeof parsed.icons?.generator === "string" ? parsed.icons.generator : fallback.icons.generator,
      ),
      kpi: normalizeSidebarMenuIcon(
        "kpi",
        typeof parsed.icons?.kpi === "string" ? parsed.icons.kpi : fallback.icons.kpi,
      ),
      attendance: normalizeSidebarMenuIcon(
        "attendance",
        typeof parsed.icons?.attendance === "string" ? parsed.icons.attendance : fallback.icons.attendance,
      ),
      analytics: normalizeSidebarMenuIcon(
        "analytics",
        typeof parsed.icons?.analytics === "string" ? parsed.icons.analytics : fallback.icons.analytics,
      ),
      traineeHistory: normalizeSidebarMenuIcon(
        "traineeHistory",
        typeof parsed.icons?.traineeHistory === "string" ? parsed.icons.traineeHistory : fallback.icons.traineeHistory,
      ),
      achievement: normalizeSidebarMenuIcon(
        "achievement",
        typeof parsed.icons?.achievement === "string" ? parsed.icons.achievement : fallback.icons.achievement,
      ),
      inquiry: normalizeSidebarMenuIcon(
        "inquiry",
        typeof parsed.icons?.inquiry === "string" ? parsed.icons.inquiry : fallback.icons.inquiry,
      ),
      satisfaction: normalizeSidebarMenuIcon(
        "satisfaction",
        typeof parsed.icons?.satisfaction === "string" ? parsed.icons.satisfaction : fallback.icons.satisfaction,
      ),
      crossAnalysis: normalizeSidebarMenuIcon(
        "crossAnalysis",
        typeof parsed.icons?.crossAnalysis === "string" ? parsed.icons.crossAnalysis : fallback.icons.crossAnalysis,
      ),
      revenue: normalizeSidebarMenuIcon(
        "revenue",
        typeof parsed.icons?.revenue === "string" ? parsed.icons.revenue : fallback.icons.revenue,
      ),
      docAutomation: normalizeSidebarMenuIcon(
        "docAutomation",
        typeof parsed.icons?.docAutomation === "string" ? parsed.icons.docAutomation : fallback.icons.docAutomation,
      ),
      projectEval: normalizeSidebarMenuIcon(
        "projectEval",
        typeof parsed.icons?.projectEval === "string" ? parsed.icons.projectEval : fallback.icons.projectEval,
      ),
      projectReward: normalizeSidebarMenuIcon(
        "projectReward",
        typeof parsed.icons?.projectReward === "string" ? parsed.icons.projectReward : fallback.icons.projectReward,
      ),
      operationDiag: normalizeSidebarMenuIcon(
        "operationDiag",
        typeof parsed.icons?.operationDiag === "string" ? parsed.icons.operationDiag : fallback.icons.operationDiag,
      ),
      instructorDiag: normalizeSidebarMenuIcon(
        "instructorDiag",
        typeof parsed.icons?.instructorDiag === "string" ? parsed.icons.instructorDiag : fallback.icons.instructorDiag,
      ),
      settings: normalizeSidebarMenuIcon(
        "settings",
        typeof parsed.icons?.settings === "string" ? parsed.icons.settings : fallback.icons.settings,
      ),
    };

    return { order, labels, icons };
  } catch {
    return fallback;
  }
}

export function saveSidebarMenuConfig(config: SidebarMenuConfig): void {
  localStorage.setItem(SIDEBAR_MENU_CONFIG_KEY, JSON.stringify(config));
}

export function getPrimarySidebarButtonByKey(navKey: PrimarySidebarNavKey): HTMLButtonElement | undefined {
  return domRefs.jibblePrimaryNavButtons.find((button) => button.dataset.navKey?.trim() === navKey);
}

// Section group definitions for sidebar nav
const NAV_SECTION_GROUPS: { label: string; keys: PrimarySidebarNavKey[] }[] = [
  { label: "메인", keys: ["dashboard", "timeline"] },
  { label: "HRD 운영", keys: ["generator", "kpi", "dropout"] },
  { label: "훈련생 관리", keys: ["attendance", "analytics", "traineeHistory"] },
];

// Cache original SVG innerHTML per nav-key so we can restore default icons
const originalIconHTML = new Map<string, string>();

function cacheOriginalIcons(): void {
  if (originalIconHTML.size > 0) return;
  for (const navKey of PRIMARY_SIDEBAR_NAV_KEYS) {
    const button = getPrimarySidebarButtonByKey(navKey);
    if (!button) continue;
    const iconEl = button.querySelector<HTMLElement>(".jibble-nav-icon");
    if (iconEl) {
      originalIconHTML.set(navKey, iconEl.innerHTML);
    }
  }
}

export function applySidebarMenuConfigToSidebar(config: SidebarMenuConfig): void {
  const jibbleMainNav = domRefs.jibbleMainNav;

  // Cache original SVG icons on first run
  cacheOriginalIcons();

  if (jibbleMainNav) {
    // Remove all existing section labels and flex spacers
    jibbleMainNav
      .querySelectorAll(".nav-section-label, .nav-spacer, [style*='flex:1'], [style*='flex: 1']")
      .forEach((el) => el.remove());

    // Build a lookup: navKey → section index + label
    const keyToSectionIdx = new Map<PrimarySidebarNavKey, number>();
    for (let i = 0; i < NAV_SECTION_GROUPS.length; i++) {
      for (const key of NAV_SECTION_GROUPS[i].keys) {
        keyToSectionIdx.set(key, i);
      }
    }

    // Group ordered keys by their section, preserving section order from NAV_SECTION_GROUPS
    const sectionBuckets: PrimarySidebarNavKey[][] = NAV_SECTION_GROUPS.map(() => []);
    const unsectioned: PrimarySidebarNavKey[] = [];
    for (const navKey of config.order) {
      if (navKey === "settings") continue;
      const idx = keyToSectionIdx.get(navKey);
      if (idx !== undefined) {
        sectionBuckets[idx].push(navKey);
      } else {
        unsectioned.push(navKey);
      }
    }

    // Re-append buttons grouped by section, inserting section labels
    const settingsButton = getPrimarySidebarButtonByKey("settings");

    for (let i = 0; i < NAV_SECTION_GROUPS.length; i++) {
      const bucket = sectionBuckets[i];
      if (bucket.length === 0) continue;

      const label = document.createElement("div");
      label.className = "nav-section-label";
      label.textContent = NAV_SECTION_GROUPS[i].label;
      jibbleMainNav.appendChild(label);

      for (const navKey of bucket) {
        const button = getPrimarySidebarButtonByKey(navKey);
        if (button) jibbleMainNav.appendChild(button);
      }
    }

    // Append any unsectioned items
    for (const navKey of unsectioned) {
      const button = getPrimarySidebarButtonByKey(navKey);
      if (button) jibbleMainNav.appendChild(button);
    }

    // Add flex spacer and settings button at bottom
    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    jibbleMainNav.appendChild(spacer);
    if (settingsButton) {
      jibbleMainNav.appendChild(settingsButton);
    }
  }

  for (const navKey of PRIMARY_SIDEBAR_NAV_KEYS) {
    const button = getPrimarySidebarButtonByKey(navKey);
    if (!button) continue;

    // Update icon: restore original SVG if using default, otherwise set custom text
    const iconElement = button.querySelector<HTMLElement>(".jibble-nav-icon");
    const icon = normalizeSidebarMenuIcon(navKey, config.icons[navKey]);
    button.dataset.navIcon = icon;
    if (iconElement) {
      const defaultIcon = DEFAULT_PRIMARY_SIDEBAR_ICONS[navKey];
      if (icon === defaultIcon && originalIconHTML.has(navKey)) {
        // Restore original SVG icon
        iconElement.innerHTML = originalIconHTML.get(navKey)!;
      } else {
        // Custom icon (emoji etc.)
        iconElement.textContent = icon;
      }
    }

    const labelElement = button.querySelector<HTMLElement>(".jibble-nav-label");
    const label = normalizeSidebarMenuLabel(navKey, config.labels[navKey]);
    if (labelElement) {
      labelElement.textContent = label;
    }
  }

  deps.setJibbleSidebarActive(appState.activePrimarySidebarPage);
}

export function moveSidebarMenuDraft(navKey: PrimarySidebarNavKey, direction: -1 | 1): void {
  const currentIndex = appState.sidebarMenuDraft.order.indexOf(navKey);
  if (currentIndex < 0) {
    return;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= appState.sidebarMenuDraft.order.length) {
    return;
  }

  const nextOrder = [...appState.sidebarMenuDraft.order];
  const [moved] = nextOrder.splice(currentIndex, 1);
  nextOrder.splice(nextIndex, 0, moved);
  appState.sidebarMenuDraft = {
    ...appState.sidebarMenuDraft,
    order: nextOrder,
  };

  applySidebarMenuConfigToSidebar(appState.sidebarMenuDraft);
  renderSidebarMenuConfigEditor();
  domRefs.menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
}

export function renderSidebarMenuConfigEditor(): void {
  const menuConfigList = domRefs.menuConfigList;
  const menuConfigStatus = domRefs.menuConfigStatus;
  menuConfigList.innerHTML = "";

  const total = appState.sidebarMenuDraft.order.length;
  for (const [index, navKey] of appState.sidebarMenuDraft.order.entries()) {
    const row = document.createElement("div");
    row.className = "menu-config-row";

    const icon = document.createElement("span");
    icon.className = "menu-config-icon";
    icon.textContent = normalizeSidebarMenuIcon(navKey, appState.sidebarMenuDraft.icons[navKey]);
    row.appendChild(icon);

    const iconInput = document.createElement("input");
    iconInput.className = "menu-config-icon-input";
    iconInput.type = "text";
    iconInput.maxLength = 4;
    iconInput.value = appState.sidebarMenuDraft.icons[navKey];
    iconInput.setAttribute("aria-label", `${navKey} 아이콘`);
    iconInput.addEventListener("input", () => {
      appState.sidebarMenuDraft.icons[navKey] = iconInput.value;
      icon.textContent = normalizeSidebarMenuIcon(navKey, iconInput.value);
      applySidebarMenuConfigToSidebar(appState.sidebarMenuDraft);
      menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
    });
    row.appendChild(iconInput);

    const input = document.createElement("input");
    input.className = "menu-config-input";
    input.type = "text";
    input.maxLength = 20;
    input.value = appState.sidebarMenuDraft.labels[navKey];
    input.addEventListener("input", () => {
      appState.sidebarMenuDraft.labels[navKey] = input.value;
      applySidebarMenuConfigToSidebar(appState.sidebarMenuDraft);
      menuConfigStatus.textContent = "메뉴 설정이 변경되었습니다. 저장 버튼을 눌러 반영하세요.";
    });
    row.appendChild(input);

    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "menu-config-move";
    upButton.textContent = "↑";
    upButton.disabled = index === 0;
    upButton.addEventListener("click", () => moveSidebarMenuDraft(navKey, -1));
    row.appendChild(upButton);

    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "menu-config-move";
    downButton.textContent = "↓";
    downButton.disabled = index === total - 1;
    downButton.addEventListener("click", () => moveSidebarMenuDraft(navKey, 1));
    row.appendChild(downButton);

    menuConfigList.appendChild(row);
  }
}
