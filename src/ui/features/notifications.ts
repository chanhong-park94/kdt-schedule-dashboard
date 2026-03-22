import { appState, type NotificationItem } from "../appState";
import { domRefs } from "../domRefs";
import { formatRelativeTime } from "../../hrd/hrdCacheUtils";

type NotificationsDeps = {
  scrollToSection: (sectionId: string) => void;
  closeDrawers: () => void;
};

const defaultDeps: NotificationsDeps = {
  scrollToSection: () => {},
  closeDrawers: () => {},
};

let deps: NotificationsDeps = defaultDeps;

export function initNotificationsFeature(nextDeps: NotificationsDeps): void {
  deps = nextDeps;
}

export function buildNotifications(): NotificationItem[] {
  return appState.recentActionLogs.map((log) => ({
    id: log.id,
    severity: log.severity,
    source: "HRD_VALIDATION",
    title: log.severity === "ERROR" ? "오류" : log.severity === "WARNING" ? "경고" : "정보",
    message: log.message,
  }));
}

export function refreshNotificationItems(): NotificationItem[] {
  appState.notificationItems = buildNotifications();
  return appState.notificationItems;
}

export function getCohortNotificationCountMap(
  items: NotificationItem[],
): Map<string, { warning: number; error: number }> {
  const map = new Map<string, { warning: number; error: number }>();
  void items;
  return map;
}

export function renderNotificationCenter(): void {
  refreshNotificationItems();
  const notificationStatusList = domRefs.notificationStatusList;
  notificationStatusList.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "notification-list";
  const logs = [...appState.recentActionLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  if (logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "최근 작업 로그가 없습니다.";
    wrap.appendChild(empty);
  }

  for (const row of logs) {
    const card = document.createElement("div");
    card.className = `notification-item ${
      row.severity === "ERROR" ? "error" : row.severity === "WARNING" ? "warning" : "info"
    }`;
    if (row.focusSectionId) {
      card.role = "button";
      card.tabIndex = 0;
      card.addEventListener("click", () => {
        deps.scrollToSection(row.focusSectionId ?? "sectionTimeline");
        deps.closeDrawers();
      });
    }

    const head = document.createElement("div");
    head.innerHTML = `<strong>${row.severity}</strong> · ${formatRelativeTime(row.createdAt)}`;
    card.appendChild(head);

    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = row.message;
    card.appendChild(msg);

    wrap.appendChild(card);
  }

  notificationStatusList.appendChild(wrap);
}

export function pushRecentActionLog(
  severity: "INFO" | "WARNING" | "ERROR",
  message: string,
  focusSectionId?: string,
): void {
  appState.recentActionLogs = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      severity,
      message,
      focusSectionId,
      createdAt: new Date().toISOString(),
    },
    ...appState.recentActionLogs,
  ].slice(0, 5);
}
