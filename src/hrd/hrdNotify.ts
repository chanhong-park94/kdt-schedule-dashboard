/** 출결 관리대상 문자/이메일 발송 모듈 */
import { readClientEnv } from "../core/env";
import { getContact } from "./hrdContacts";
import { loadHrdConfig } from "./hrdConfig";
import { getAssistantSession } from "../auth/assistantAuth";
import type { AttendanceStudent } from "./hrdTypes";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Edge Function URL ──────────────────────────────────────
const _sbUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const _sbKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const NOTIFY_FUNCTION_URL =
  typeof _sbUrl === "string" && _sbUrl.trim()
    ? `${_sbUrl.trim().replace(/\/+$/, "")}/functions/v1/send-notification`
    : "";
const SUPABASE_ANON_KEY = typeof _sbKey === "string" ? _sbKey.trim() : "";

// ─── 템플릿 ────────────────────────────────────────────────
const TEMPLATE_STORAGE_KEY = "kdt_notify_templates_v1";

export interface NotifyTemplate {
  danger: string;
  warning: string;
  caution: string;
}

const DEFAULT_TEMPLATES: NotifyTemplate = {
  danger: `[KDT 출결 긴급안내] {name}님, 현재 결석 {absences}회로 제적 위험 상태입니다. 잔여 허용 결석일이 {remaining}일 남았습니다. 즉시 출석 관리가 필요합니다. 문의: 운영팀`,
  warning: `[KDT 출결안내] {name}님, 현재 결석 {absences}회입니다. 잔여 허용 결석일 {remaining}일입니다. 출석에 유의해주세요. 문의: 운영팀`,
  caution: `[KDT 출결안내] {name}님, 결석일이 {absences}회 누적되었습니다. 지속적인 출석 관리 부탁드립니다. 문의: 운영팀`,
};

export function loadTemplates(): NotifyTemplate {
  try {
    const stored = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (stored) return { ...DEFAULT_TEMPLATES, ...JSON.parse(stored) };
  } catch {
    /* fallback */
  }
  return { ...DEFAULT_TEMPLATES };
}

export function saveTemplates(templates: NotifyTemplate): void {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

// ─── 발송 이력 (최근 발송 타임스탬프) ───────────────────────
const SEND_HISTORY_KEY = "kdt_notify_history_v1";

interface SendHistoryEntry {
  timestamp: string; // ISO
  method: NotifyMethod;
  successCount: number;
  failCount: number;
  courseName: string;
}

function loadSendHistory(): SendHistoryEntry[] {
  try {
    const stored = localStorage.getItem(SEND_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveSendEntry(entry: SendHistoryEntry): void {
  const history = loadSendHistory();
  history.unshift(entry);
  // 최근 20건만 유지
  if (history.length > 20) history.length = 20;
  localStorage.setItem(SEND_HISTORY_KEY, JSON.stringify(history));
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getLastSendSummary(): string {
  const history = loadSendHistory();
  if (history.length === 0) return "";
  const last = history[0];
  const methodLabel = last.method === "sms" ? "SMS" : last.method === "email" ? "이메일" : "SMS+이메일";
  return `최근 발송: ${formatTimestamp(last.timestamp)} | ${methodLabel} ${last.successCount}건 (${last.courseName})`;
}

export function resetTemplates(): NotifyTemplate {
  localStorage.removeItem(TEMPLATE_STORAGE_KEY);
  return { ...DEFAULT_TEMPLATES };
}

/** 템플릿 변수 치환 */
export function renderTemplate(template: string, student: AttendanceStudent): string {
  return template
    .replace(/\{name\}/g, student.name)
    .replace(/\{absences\}/g, String(student.absentDays))
    .replace(/\{remaining\}/g, String(student.remainingAbsent))
    .replace(/\{rate\}/g, student.attendanceRate.toFixed(1))
    .replace(/\{maxAbsent\}/g, String(student.maxAbsent));
}

// ─── 발송 대상 준비 ────────────────────────────────────────
export interface NotifyTarget {
  student: AttendanceStudent;
  phone: string;
  email: string;
  message: string;
  selected: boolean;
}

export function prepareTargets(students: AttendanceStudent[]): NotifyTarget[] {
  const templates = loadTemplates();

  return students
    .filter((s) => !s.dropout && (s.riskLevel === "danger" || s.riskLevel === "warning" || s.riskLevel === "caution"))
    .map((s) => {
      const contact = getContact(s.name);
      const template = templates[s.riskLevel as keyof NotifyTemplate] || templates.caution;
      return {
        student: s,
        phone: contact?.phone || "",
        email: contact?.email || "",
        message: renderTemplate(template, s),
        selected: true,
      };
    });
}

// ─── 발송 실행 ─────────────────────────────────────────────
export type NotifyMethod = "sms" | "email" | "both";

export interface SendResult {
  name: string;
  method: NotifyMethod;
  success: boolean;
  error?: string;
}

async function callEdgeFunction(body: object): Promise<{ ok: boolean; error?: string }> {
  if (!NOTIFY_FUNCTION_URL) {
    return { ok: false, error: "Edge Function URL이 설정되지 않았습니다." };
  }

  try {
    const res = await fetch(NOTIFY_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 강사 모드(보조강사 코드 로그인) 차단 — 학습자 개인정보(전화/이메일) 발송은
 * 운매(Google Workspace 로그인) 권한으로만 허용. 개인정보보호법 안전성 확보 조치.
 */
function isAssistantBlocked(): { blocked: boolean; reason: string } {
  const session = getAssistantSession();
  if (session) {
    return {
      blocked: true,
      reason: "강사 모드에서는 SMS/이메일 발송이 차단됩니다. 운매(Google 로그인)에 발송을 요청하세요.",
    };
  }
  return { blocked: false, reason: "" };
}

export async function sendNotification(
  target: NotifyTarget,
  method: NotifyMethod,
  smsFrom?: string,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  // 강사 모드 차단 (개인정보보호 — anon role + assistant_codes 로그인 사용자)
  const guard = isAssistantBlocked();
  if (guard.blocked) {
    results.push({
      name: target.student.name,
      method,
      success: false,
      error: guard.reason,
    });
    return results;
  }

  if ((method === "sms" || method === "both") && target.phone) {
    const res = await callEdgeFunction({
      type: "sms",
      to: target.phone,
      from: smsFrom || "",
      message: target.message,
    });
    results.push({ name: target.student.name, method: "sms", success: res.ok, error: res.error });
  }

  if ((method === "email" || method === "both") && target.email) {
    const res = await callEdgeFunction({
      type: "email",
      to: target.email,
      subject: "[KDT 출결안내] 출석 관리 안내",
      message: target.message,
    });
    results.push({ name: target.student.name, method: "email", success: res.ok, error: res.error });
  }

  // 연락처 없는 경우
  if (results.length === 0) {
    results.push({
      name: target.student.name,
      method,
      success: false,
      error: "연락처가 등록되지 않았습니다.",
    });
  }

  return results;
}

/** 다건 발송 */
export async function sendBulkNotifications(
  targets: NotifyTarget[],
  method: NotifyMethod,
  smsFrom?: string,
  onProgress?: (current: number, total: number) => void,
): Promise<SendResult[]> {
  const selected = targets.filter((t) => t.selected);
  const allResults: SendResult[] = [];

  for (let i = 0; i < selected.length; i++) {
    onProgress?.(i + 1, selected.length);
    const results = await sendNotification(selected[i], method, smsFrom);
    allResults.push(...results);
  }

  return allResults;
}

// ─── 발송 모달 UI ──────────────────────────────────────────

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

let currentTargets: NotifyTarget[] = [];
let currentMethod: NotifyMethod = "sms";

export function openNotifyModal(students: AttendanceStudent[]): void {
  // 강사 모드 차단 — 개인정보 발송은 운매 권한 전용
  const guard = isAssistantBlocked();
  if (guard.blocked) {
    alert(guard.reason);
    return;
  }

  currentTargets = prepareTargets(students);
  currentMethod = "sms";

  const modal = $("attNotifyModal");
  if (!modal) return;

  renderModalContent();
  modal.classList.add("active");
}

function renderModalContent(): void {
  const body = $("attNotifyModalBody");
  if (!body) return;

  const hasTargets = currentTargets.length > 0;
  const selectedCount = currentTargets.filter((t) => t.selected).length;
  const hasPhone = currentTargets.some((t) => t.selected && t.phone);
  const hasEmail = currentTargets.some((t) => t.selected && t.email);

  const lastSend = getLastSendSummary();

  body.innerHTML = `
    ${lastSend ? `<div class="notify-last-send">🕐 ${lastSend}</div>` : ""}
    <div class="notify-method-row">
      <label class="notify-method-label">
        <input type="radio" name="notifyMethod" value="sms" ${currentMethod === "sms" ? "checked" : ""} /> 문자 (SMS)
      </label>
      <label class="notify-method-label">
        <input type="radio" name="notifyMethod" value="email" ${currentMethod === "email" ? "checked" : ""} /> 이메일
      </label>
      <label class="notify-method-label">
        <input type="radio" name="notifyMethod" value="both" ${currentMethod === "both" ? "checked" : ""} /> 둘 다
      </label>
    </div>

    ${
      !hasTargets
        ? `<div class="dash-empty">관리대상 훈련생이 없습니다.</div>`
        : `
      <div class="notify-target-info">
        발송 대상: <strong>${selectedCount}명</strong>
        ${!hasPhone && (currentMethod === "sms" || currentMethod === "both") ? `<span class="notify-warn">⚠️ 전화번호 미등록</span>` : ""}
        ${!hasEmail && (currentMethod === "email" || currentMethod === "both") ? `<span class="notify-warn">⚠️ 이메일 미등록</span>` : ""}
      </div>

      <div class="notify-target-list">
        ${currentTargets
          .map((t, i) => {
            const riskEmoji = t.student.riskLevel === "danger" ? "🔴" : t.student.riskLevel === "warning" ? "🟠" : "🟡";
            const contactInfo = [t.phone, t.email].filter(Boolean).join(" / ") || "연락처 미등록";
            return `
            <div class="notify-target-item">
              <label class="notify-target-check">
                <input type="checkbox" data-idx="${i}" ${t.selected ? "checked" : ""} />
                ${riskEmoji} <strong>${esc(t.student.name)}</strong>
                <span class="notify-target-meta">${esc(contactInfo)}</span>
              </label>
              <div class="notify-target-preview">${esc(t.message)}</div>
            </div>
          `;
          })
          .join("")}
      </div>

      <div class="notify-actions">
        <button id="notifySendBtn" class="btn-primary btn-sm" ${selectedCount === 0 ? "disabled" : ""}>
          📱 ${selectedCount}명에게 발송
        </button>
        <div id="notifySendStatus" class="notify-send-status"></div>
      </div>
    `
    }
  `;

  // 이벤트 바인딩
  body.querySelectorAll<HTMLInputElement>('input[name="notifyMethod"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      currentMethod = radio.value as NotifyMethod;
      renderModalContent();
    });
  });

  body.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-idx]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = parseInt(cb.dataset.idx || "0", 10);
      if (currentTargets[idx]) currentTargets[idx].selected = cb.checked;
      renderModalContent();
    });
  });

  $("notifySendBtn")?.addEventListener("click", () => {
    void handleSend();
  });
}

async function handleSend(): Promise<void> {
  const btn = $("notifySendBtn") as HTMLButtonElement | null;
  const status = $("notifySendStatus");
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = "⏳ 발송 중...";

  // 현재 과정의 발신번호 조회
  const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
  const config = loadHrdConfig();
  const trainPrId = courseSelect?.value || "";
  const course = config.courses.find((c) => c.trainPrId === trainPrId);
  const smsFrom = course?.smsFrom || "";

  const results = await sendBulkNotifications(currentTargets, currentMethod, smsFrom, (cur, total) => {
    if (status) status.textContent = `${cur}/${total} 처리 중...`;
  });

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  const now = new Date().toISOString();

  // 발송 이력 저장
  if (successCount > 0) {
    saveSendEntry({
      timestamp: now,
      method: currentMethod,
      successCount,
      failCount,
      courseName: course?.name || "",
    });
  }

  if (status) {
    const timeStr = formatTimestamp(now);
    if (failCount === 0 && successCount > 0) {
      status.textContent = `✅ ${successCount}건 발송 완료 (${timeStr})`;
      status.className = "notify-send-status notify-status-success";
    } else if (successCount > 0) {
      status.textContent = `⚠️ 성공 ${successCount}건, 실패 ${failCount}건 (${timeStr})`;
      status.className = "notify-send-status notify-status-warn";
    } else {
      const firstErr = results.find((r) => r.error)?.error || "발송 실패";
      status.textContent = `❌ ${firstErr}`;
      status.className = "notify-send-status notify-status-error";
    }
  }

  btn.textContent = "📱 발송 완료";
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = `📱 ${currentTargets.filter((t) => t.selected).length}명에게 발송`;
  }, 3000);
}

export function initNotifyModal(): void {
  // 모달 닫기
  $("attNotifyModalClose")?.addEventListener("click", () => {
    $("attNotifyModal")?.classList.remove("active");
  });

  // 배경 클릭 닫기
  $("attNotifyModal")?.addEventListener("click", (e) => {
    if (e.target === $("attNotifyModal")) {
      $("attNotifyModal")?.classList.remove("active");
    }
  });
}
