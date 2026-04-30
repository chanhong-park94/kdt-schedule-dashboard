/** 출결 관리대상 문자/이메일 발송 모듈 */
import { readClientEnv } from "../core/env";
import { getContact } from "./hrdContacts";
import { loadHrdConfig, saveHrdConfig } from "./hrdConfig";
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

// 이메일 발신자 표시용 (Apps Script 프록시 SMTP 계정). 미설정 시 "프록시 기본 발신자"로 표시.
const EMAIL_FROM_DISPLAY = readClientEnv(["NEXT_PUBLIC_NOTIFY_EMAIL_FROM", "VITE_NOTIFY_EMAIL_FROM"]) || "";

// ─── 템플릿 ────────────────────────────────────────────────
const TEMPLATE_STORAGE_KEY = "kdt_notify_templates_v1";

export interface NotifyTemplate {
  danger: string;
  warning: string;
  caution: string;
}

const DEFAULT_TEMPLATES: NotifyTemplate = {
  danger: `[KDT 출결 긴급안내] {name}님, 현재 결석 {absences}회로 제적 위험 상태입니다. 잔여 허용 결석일이 {remaining}일 남았습니다. 즉시 출석 관리가 필요합니다. 문의: 모두의연구소 KDT 운영팀`,
  warning: `[KDT 출결안내] {name}님, 현재 결석 {absences}회입니다. 잔여 허용 결석일 {remaining}일입니다. 출석에 유의해주세요. 문의: 모두의연구소 KDT 운영팀`,
  caution: `[KDT 출결안내] {name}님, 결석일이 {absences}회 누적되었습니다. 지속적인 출석 관리 부탁드립니다. 문의: 모두의연구소 KDT 운영팀`,
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

// scheduler.ts 호환 alias
export const loadNotifyTemplates = loadTemplates;

export function saveTemplates(templates: NotifyTemplate): void {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

// ─── 발송 이력 (최근 발송 타임스탬프 + 학생별 상세) ──────────
const SEND_HISTORY_KEY = "kdt_notify_history_v1";

export interface SendHistoryDetail {
  name: string;
  method: NotifyMethod;
  success: boolean;
  error?: string;
  contact?: string; // 전화/이메일 마스킹된 값
}

interface SendHistoryEntry {
  timestamp: string; // ISO
  method: NotifyMethod;
  successCount: number;
  failCount: number;
  courseName: string;
  smsFrom?: string;
  emailFrom?: string;
  results?: SendHistoryDetail[]; // 학생별 상세 (v2)
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

/** SMS 바이트 계산 (EUC-KR 기준: 한글=2byte, ASCII=1byte) */
function smsByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    bytes += ch.charCodeAt(0) > 127 ? 2 : 1;
  }
  return bytes;
}

/** SMS 분류: SMS(≤90B) / LMS(≤2000B) / 초과 */
function classifySms(text: string): { kind: "SMS" | "LMS" | "초과"; bytes: number; limit: number } {
  const bytes = smsByteLength(text);
  if (bytes <= 90) return { kind: "SMS", bytes, limit: 90 };
  if (bytes <= 2000) return { kind: "LMS", bytes, limit: 2000 };
  return { kind: "초과", bytes, limit: 2000 };
}

function maskContact(value: string, type: "sms" | "email"): string {
  if (!value) return "-";
  if (type === "sms") {
    const digits = value.replace(/-/g, "");
    if (digits.length < 8) return value;
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }
  // email
  const at = value.indexOf("@");
  if (at <= 1) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}${domain}`;
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
      subject: "[모두의연구소 KDT 운영팀] 출석 관리 안내",
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
// 이번 발송에서 사용할 SMS 발신번호 (모달 내에서 일시 변경 가능)
let currentSmsFrom = "";
// 마지막 발송 결과 (모달 하단에 상세 표시)
let lastResults: SendResult[] = [];
let lastResultMethod: NotifyMethod = "sms";

export function openNotifyModal(students: AttendanceStudent[]): void {
  // 강사 모드 차단 — 개인정보 발송은 운매 권한 전용
  const guard = isAssistantBlocked();
  if (guard.blocked) {
    alert(guard.reason);
    return;
  }

  currentTargets = prepareTargets(students);
  currentMethod = "sms";
  lastResults = [];

  // 현재 선택된 과정의 SMS 발신번호 초기화
  const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
  const config = loadHrdConfig();
  const trainPrId = courseSelect?.value || "";
  const course = config.courses.find((c) => c.trainPrId === trainPrId);
  currentSmsFrom = course?.smsFrom || "";

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

  const showSms = currentMethod === "sms" || currentMethod === "both";
  const showEmail = currentMethod === "email" || currentMethod === "both";

  const emailFromText = EMAIL_FROM_DISPLAY
    ? EMAIL_FROM_DISPLAY
    : "프록시 기본 발신자 (Apps Script SMTP 계정)";

  body.innerHTML = `
    ${lastSend ? `<div class="notify-last-send">🕐 ${esc(lastSend)}</div>` : ""}

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

    <div class="notify-sender-block">
      ${
        showSms
          ? `
        <div class="notify-sender-row">
          <span class="notify-sender-label">📱 SMS 발신번호</span>
          <input id="notifySmsFromInput" class="notify-sender-input" type="tel"
                 value="${esc(currentSmsFrom)}" placeholder="010-0000-0000 (솔라피 사전등록 번호)" />
          <label class="notify-sender-save">
            <input id="notifySmsFromSave" type="checkbox" /> 과정 기본값으로 저장
          </label>
        </div>
        ${!currentSmsFrom ? `<div class="notify-sender-warn">⚠️ 발신번호가 비어 있습니다. 솔라피에 사전등록된 번호를 입력하세요.</div>` : ""}
      `
          : ""
      }
      ${
        showEmail
          ? `
        <div class="notify-sender-row">
          <span class="notify-sender-label">✉️ 이메일 발신자</span>
          <span class="notify-sender-fixed">${esc(emailFromText)}</span>
          ${!EMAIL_FROM_DISPLAY ? `<span class="notify-sender-hint">env: VITE_NOTIFY_EMAIL_FROM 으로 표시값 지정 가능</span>` : ""}
        </div>
      `
          : ""
      }
    </div>

    ${
      !hasTargets
        ? `<div class="dash-empty">관리대상 훈련생이 없습니다.</div>`
        : `
      <div class="notify-target-info">
        발송 대상: <strong>${selectedCount}명</strong>
        ${!hasPhone && showSms ? `<span class="notify-warn">⚠️ 전화번호 미등록</span>` : ""}
        ${!hasEmail && showEmail ? `<span class="notify-warn">⚠️ 이메일 미등록</span>` : ""}
      </div>

      <div class="notify-target-list">
        ${currentTargets
          .map((t, i) => {
            const riskEmoji = t.student.riskLevel === "danger" ? "🔴" : t.student.riskLevel === "warning" ? "🟠" : "🟡";
            const contactInfo = [t.phone, t.email].filter(Boolean).join(" / ") || "연락처 미등록";
            const cls = classifySms(t.message);
            const counterCls = cls.kind === "초과" ? "notify-counter-error" : cls.kind === "LMS" ? "notify-counter-warn" : "notify-counter-ok";
            return `
            <div class="notify-target-item">
              <label class="notify-target-check">
                <input type="checkbox" data-idx="${i}" ${t.selected ? "checked" : ""} />
                ${riskEmoji} <strong>${esc(t.student.name)}</strong>
                <span class="notify-target-meta">${esc(contactInfo)}</span>
              </label>
              <textarea class="notify-target-edit" data-edit-idx="${i}"
                        rows="3" placeholder="메시지 내용">${esc(t.message)}</textarea>
              <div class="notify-target-footer">
                <span class="notify-counter ${counterCls}">${cls.kind} · ${cls.bytes}/${cls.limit}B</span>
                <button class="notify-restore-btn" type="button" data-restore-idx="${i}">템플릿 복원</button>
              </div>
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

      ${renderResultsSection()}
    `
    }
  `;

  bindModalEvents();
}

function renderResultsSection(): string {
  if (lastResults.length === 0) return "";
  const success = lastResults.filter((r) => r.success);
  const failed = lastResults.filter((r) => !r.success);
  const methodLabel = lastResultMethod === "sms" ? "SMS" : lastResultMethod === "email" ? "이메일" : "SMS+이메일";

  const renderRow = (r: SendResult): string => {
    const icon = r.success ? "✅" : "❌";
    const ch = r.method === "sms" ? "📱" : "✉️";
    const err = r.error ? `<span class="notify-result-err">${esc(r.error)}</span>` : "";
    return `<li class="notify-result-row ${r.success ? "ok" : "fail"}">
      ${icon} ${ch} <strong>${esc(r.name)}</strong> ${err}
    </li>`;
  };

  return `
    <div class="notify-results-section">
      <div class="notify-results-head">
        📊 전송 결과 (${methodLabel}) — 성공 ${success.length} / 실패 ${failed.length}
      </div>
      <ul class="notify-results-list">
        ${lastResults.map(renderRow).join("")}
      </ul>
      <div class="notify-results-foot">
        <button id="notifyHistoryBtn" type="button" class="notify-link-btn">📜 최근 발송 이력 보기</button>
      </div>
    </div>
  `;
}

function bindModalEvents(): void {
  const body = $("attNotifyModalBody");
  if (!body) return;

  // 발송 방식 변경
  body.querySelectorAll<HTMLInputElement>('input[name="notifyMethod"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      currentMethod = radio.value as NotifyMethod;
      renderModalContent();
    });
  });

  // 대상 체크박스
  body.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-idx]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = parseInt(cb.dataset.idx || "0", 10);
      if (currentTargets[idx]) currentTargets[idx].selected = cb.checked;
      renderModalContent();
    });
  });

  // 메시지 인라인 편집 — 입력 시 카운터/대상 정보만 갱신 (전체 리렌더 아님)
  body.querySelectorAll<HTMLTextAreaElement>("textarea.notify-target-edit").forEach((ta) => {
    ta.addEventListener("input", () => {
      const idx = parseInt(ta.dataset.editIdx || "-1", 10);
      if (idx < 0 || !currentTargets[idx]) return;
      currentTargets[idx].message = ta.value;
      // 카운터만 부분 갱신
      const footer = ta.parentElement?.querySelector<HTMLSpanElement>(".notify-counter");
      if (footer) {
        const cls = classifySms(ta.value);
        footer.textContent = `${cls.kind} · ${cls.bytes}/${cls.limit}B`;
        footer.classList.remove("notify-counter-ok", "notify-counter-warn", "notify-counter-error");
        footer.classList.add(
          cls.kind === "초과" ? "notify-counter-error" : cls.kind === "LMS" ? "notify-counter-warn" : "notify-counter-ok",
        );
      }
    });
  });

  // 템플릿 복원
  body.querySelectorAll<HTMLButtonElement>(".notify-restore-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.restoreIdx || "-1", 10);
      if (idx < 0 || !currentTargets[idx]) return;
      const t = currentTargets[idx];
      const templates = loadTemplates();
      const tpl = templates[t.student.riskLevel as keyof NotifyTemplate] || templates.caution;
      t.message = renderTemplate(tpl, t.student);
      renderModalContent();
    });
  });

  // SMS 발신번호 입력
  const smsInput = $("notifySmsFromInput") as HTMLInputElement | null;
  if (smsInput) {
    smsInput.addEventListener("input", () => {
      currentSmsFrom = smsInput.value.trim();
    });
  }

  // 발송 버튼
  $("notifySendBtn")?.addEventListener("click", () => {
    void handleSend();
  });

  // 이력 보기
  $("notifyHistoryBtn")?.addEventListener("click", () => {
    showHistoryDialog();
  });
}

function buildConfirmMessage(selectedCount: number): string {
  const showSms = currentMethod === "sms" || currentMethod === "both";
  const showEmail = currentMethod === "email" || currentMethod === "both";
  const lines: string[] = [];
  lines.push(`총 ${selectedCount}명에게 발송합니다.`);
  lines.push("");
  if (showSms) {
    const fromTxt = currentSmsFrom || "(미입력)";
    lines.push(`📱 SMS 발신번호: ${fromTxt}`);
    // SMS 예상 비용 — 솔라피 기준 SMS 8.4원, LMS 31.9원 (참고용)
    let smsCost = 0;
    let lmsCost = 0;
    let overCount = 0;
    for (const t of currentTargets) {
      if (!t.selected || !t.phone) continue;
      const cls = classifySms(t.message);
      if (cls.kind === "SMS") smsCost++;
      else if (cls.kind === "LMS") lmsCost++;
      else overCount++;
    }
    const expected = smsCost * 8.4 + lmsCost * 31.9;
    lines.push(`   - SMS ${smsCost}건 / LMS ${lmsCost}건 (예상 약 ${expected.toFixed(0)}원)`);
    if (overCount > 0) lines.push(`   ⚠️ 2000B 초과 ${overCount}건 — 발송 실패 가능`);
  }
  if (showEmail) {
    const fromTxt = EMAIL_FROM_DISPLAY || "프록시 기본 발신자";
    lines.push(`✉️ 이메일 발신자: ${fromTxt}`);
  }
  lines.push("");
  lines.push("발송하시겠습니까?");
  return lines.join("\n");
}

async function handleSend(): Promise<void> {
  const btn = $("notifySendBtn") as HTMLButtonElement | null;
  const status = $("notifySendStatus");
  if (!btn) return;

  const selectedCount = currentTargets.filter((t) => t.selected).length;
  if (selectedCount === 0) return;

  // 최종 확인 다이얼로그
  if (!window.confirm(buildConfirmMessage(selectedCount))) return;

  // 발신번호 영구 저장 옵션
  const saveCheck = $("notifySmsFromSave") as HTMLInputElement | null;
  const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
  const trainPrId = courseSelect?.value || "";
  const config = loadHrdConfig();
  const courseIdx = config.courses.findIndex((c) => c.trainPrId === trainPrId);
  const course = courseIdx >= 0 ? config.courses[courseIdx] : undefined;

  if (saveCheck?.checked && courseIdx >= 0) {
    config.courses[courseIdx].smsFrom = currentSmsFrom || undefined;
    saveHrdConfig(config);
  }

  btn.disabled = true;
  btn.textContent = "⏳ 발송 중...";

  const results = await sendBulkNotifications(currentTargets, currentMethod, currentSmsFrom, (cur, total) => {
    if (status) status.textContent = `${cur}/${total} 처리 중...`;
  });

  lastResults = results;
  lastResultMethod = currentMethod;

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  const now = new Date().toISOString();

  // 발송 이력 저장 (학생별 상세 포함)
  if (results.length > 0) {
    const details: SendHistoryDetail[] = results.map((r) => {
      const t = currentTargets.find((tg) => tg.student.name === r.name);
      const contactRaw = r.method === "sms" ? t?.phone || "" : t?.email || "";
      return {
        name: r.name,
        method: r.method,
        success: r.success,
        error: r.error,
        contact: maskContact(contactRaw, r.method === "email" ? "email" : "sms"),
      };
    });
    saveSendEntry({
      timestamp: now,
      method: currentMethod,
      successCount,
      failCount,
      courseName: course?.name || "",
      smsFrom: currentSmsFrom || undefined,
      emailFrom: EMAIL_FROM_DISPLAY || undefined,
      results: details,
    });
  }

  // 결과 영역 다시 렌더링
  renderModalContent();

  const statusAfter = $("notifySendStatus");
  if (statusAfter) {
    const timeStr = formatTimestamp(now);
    if (failCount === 0 && successCount > 0) {
      statusAfter.textContent = `✅ ${successCount}건 발송 완료 (${timeStr})`;
      statusAfter.className = "notify-send-status notify-status-success";
    } else if (successCount > 0) {
      statusAfter.textContent = `⚠️ 성공 ${successCount}건, 실패 ${failCount}건 (${timeStr})`;
      statusAfter.className = "notify-send-status notify-status-warn";
    } else {
      const firstErr = results.find((r) => r.error)?.error || "발송 실패";
      statusAfter.textContent = `❌ ${firstErr}`;
      statusAfter.className = "notify-send-status notify-status-error";
    }
  }
}

function showHistoryDialog(): void {
  const history = loadSendHistory();
  if (history.length === 0) {
    alert("발송 이력이 없습니다.");
    return;
  }
  const lines: string[] = ["📜 최근 발송 이력 (최대 20건)\n"];
  history.forEach((h, i) => {
    const m = h.method === "sms" ? "SMS" : h.method === "email" ? "이메일" : "SMS+이메일";
    lines.push(`${i + 1}. ${formatTimestamp(h.timestamp)} | ${m} | ${h.courseName || "-"} | 성공 ${h.successCount} / 실패 ${h.failCount}`);
    if (h.smsFrom) lines.push(`   발신번호: ${h.smsFrom}`);
    if (h.results && h.results.length > 0) {
      h.results.slice(0, 10).forEach((r) => {
        const icon = r.success ? "✅" : "❌";
        lines.push(`   ${icon} ${r.name} (${r.contact || "-"}) ${r.error ? `· ${r.error}` : ""}`);
      });
      if (h.results.length > 10) lines.push(`   ... 외 ${h.results.length - 10}건`);
    }
  });
  alert(lines.join("\n"));
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
