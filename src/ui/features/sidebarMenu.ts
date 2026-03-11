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

const SIDEBAR_MENU_CONFIG_KEY = "academic_schedule_manager_sidebar_menu_v3";

export const PRIMARY_SIDEBAR_NAV_KEYS: PrimarySidebarNavKey[] = [
  "timeline",
  "generator",
  "kpi",
  "attendance",
  "analytics",
  "settings",
];

export const DEFAULT_PRIMARY_SIDEBAR_LABELS: Record<PrimarySidebarNavKey, string> = {
  timeline: "학사일정",
  generator: "HRD시간표 생성",
  kpi: "재직자 자율성과지표",
  attendance: "출결현황",
  analytics: "훈련생 분석",
  settings: "설정",
};

export const DEFAULT_PRIMARY_SIDEBAR_ICONS: Record<PrimarySidebarNavKey, string> = {
  timeline: "📅",
  generator: "🛠️",
  kpi: "📊",
  attendance: "📋",
  analytics: "📈",
  settings: "⚙️",
};

export function isPrimarySidebarNavKey(value: string): value is PrimarySidebarNavKey {
  return PRIMARY_SIDEBAR_NAV_KEYS.includes(value as PrimarySidebarNavKey);
}

export function normalizeSidebarMenuLabel(navKey: PrimarySidebarNavKey, value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PRIMARY_SIDEBAR_LABELS[navKey];
}

export function normalizeSidebarMenuIcon(navKey: PrimarySidebarNavKey, value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PRIMARY_SIDEBAR_ICONS[navKey];
}

export function cloneSidebarMenuConfig(config: SidebarMenuConfig): SidebarMenuConfig {
  return {
    order: [...config.order],
    labels: {
      timeline: config.labels.timeline,
      generator: config.labels.generator,
      kpi: config.labels.kpi,
      attendance: config.labels.attendance,
      analytics: config.labels.analytics,
      settings: config.labels.settings,
    },
    icons: {
      timeline: config.icons.timeline,
      generator: config.icons.generator,
      kpi: config.icons.kpi,
      attendance: config.icons.attendance,
      analytics: config.icons.analytics,
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
      timeline: normalizeSidebarMenuLabel("timeline", config.labels.timeline),
      generator: normalizeSidebarMenuLabel("generator", config.labels.generator),
      kpi: normalizeSidebarMenuLabel("kpi", config.labels.kpi),
      attendance: normalizeSidebarMenuLabel("attendance", config.labels.attendance),
      analytics: normalizeSidebarMenuLabel("analytics", config.labels.analytics),
      settings: normalizeSidebarMenuLabel("settings", config.labels.settings),
    },
    icons: {
      timeline: normalizeSidebarMenuIcon("timeline", config.icons.timeline),
      generator: normalizeSidebarMenuIcon("generator", config.icons.generator),
      kpi: normalizeSidebarMenuIcon("kpi", config.icons.kpi),
      attendance: normalizeSidebarMenuIcon("attendance", config.icons.attendance),
      analytics: normalizeSidebarMenuIcon("analytics", config.icons.analytics),
      settings: normalizeSidebarMenuIcon("settings", config.icons.settings),
    },
  };
}

export function getDefaultSidebarMenuConfig(): SidebarMenuConfig {
  return {
    order: [...PRIMARY_SIDEBAR_NAV_KEYS],
    labels: {
      timeline: DEFAULT_PRIMARY_SIDEBAR_LABELS.timeline,
      generator: DEFAULT_PRIMARY_SIDEBAR_LABELS.generator,
      kpi: DEFAULT_PRIMARY_SIDEBAR_LABELS.kpi,
      attendance: DEFAULT_PRIMARY_SIDEBAR_LABELS.attendance,
      analytics: DEFAULT_PRIMARY_SIDEBAR_LABELS.analytics,
      settings: DEFAULT_PRIMARY_SIDEBAR_LABELS.settings,
    },
    icons: {
      timeline: DEFAULT_PRIMARY_SIDEBAR_ICONS.timeline,
      generator: DEFAULT_PRIMARY_SIDEBAR_ICONS.generator,
      kpi: DEFAULT_PRIMARY_SIDEBAR_ICONS.kpi,
      attendance: DEFAULT_PRIMARY_SIDEBAR_ICONS.attendance,
      analytics: DEFAULT_PRIMARY_SIDEBAR_ICONS.analytics,
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
      timeline: normalizeSidebarMenuLabel(
        "timeline",
        typeof parsed.labels?.timeline === "string" ? parsed.labels.timeline : fallback.labels.timeline,
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
      settings: normalizeSidebarMenuLabel(
        "settings",
        typeof parsed.labels?.settings === "string" ? parsed.labels.settings : fallback.labels.settings,
      ),
    };

    const icons = {
      timeline: normalizeSidebarMenuIcon(
        "timeline",
        typeof parsed.icons?.timeline === "string" ? parsed.icons.timeline : fallback.icons.timeline,
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

export function applySidebarMenuConfigToSidebar(config: SidebarMenuConfig): void {
  const jibbleMainNav = domRefs.jibbleMainNav;
  if (jibbleMainNav) {
    for (const navKey of config.order) {
      const button = getPrimarySidebarButtonByKey(navKey);
      if (button) {
        jibbleMainNav.appendChild(button);
      }
    }
  }

  for (const navKey of PRIMARY_SIDEBAR_NAV_KEYS) {
    const button = getPrimarySidebarButtonByKey(navKey);
    if (!button) {
      continue;
    }

    const iconElement = button.querySelector<HTMLElement>(".jibble-nav-icon");
    const icon = normalizeSidebarMenuIcon(navKey, config.icons[navKey]);
    button.dataset.navIcon = icon;
    if (iconElement) {
      iconElement.textContent = icon;
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
