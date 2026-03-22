/** 캐시·타임아웃·에러 분류·토스트 공통 유틸 */

// ─── 캐시 경과 시간 ─────────────────────────────────────────

/** 캐시 timestamp를 "N분 전 / N시간 전 / N일 전" 형태로 변환 */
export function formatCacheAge(timestampMs: number): string {
  const diffMin = Math.floor((Date.now() - timestampMs) / 60_000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

// ─── AbortController 기반 타임아웃 fetch ────────────────────

/** fetch에 타임아웃을 적용한다. 기본 15 초. */
export function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── API 에러 → 운영자 친화 메시지 ──────────────────────────

/** API 에러를 운영자가 이해할 수 있는 한국어 메시지로 변환 */
export function classifyApiError(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const msg = e.message;

  if (e.name === "AbortError" || msg.includes("abort")) return "⏱ 응답 시간 초과 — 네트워크 상태를 확인해주세요.";
  if (msg.includes("401") || msg.includes("Unauthorized")) return "🔑 인증 실패 — API 키를 확인해주세요.";
  if (msg.includes("403") || msg.includes("Forbidden")) return "🚫 권한 부족 — API 접근 권한을 확인해주세요.";
  if (msg.includes("404") || msg.includes("Not Found")) return "❓ 리소스 없음 — 테이블명/URL을 확인해주세요.";
  if (msg.includes("429") || msg.includes("Too Many")) return "⚡ 요청 한도 초과 — 잠시 후 다시 시도해주세요.";
  if (msg.includes("500") || msg.includes("502") || msg.includes("503"))
    return "🔧 서버 오류 — 잠시 후 다시 시도해주세요.";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("network"))
    return "📡 네트워크 오류 — 인터넷 연결을 확인해주세요.";
  if (msg.includes("모든 프록시 실패")) return "📡 HRD-Net 연결 실패 — 네트워크 또는 프록시 설정을 확인해주세요.";

  return `❌ 오류: ${msg}`;
}

// ─── 토스트 알림 ────────────────────────────────────────────

/** ISO 날짜 문자열을 "N분 전 / N시간 전 / 어제 / N일 전" 형태로 변환 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return dateStr;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "어제";
  if (diffDay < 7) return `${diffDay}일 전`;
  return dateStr;
}

// ─── Skeleton 로딩 헬퍼 ─────────────────────────────────────

/** 컨테이너에 skeleton placeholder 표시 */
export function showSkeleton(containerId: string, rows = 5): void {
  const el = document.getElementById(containerId);
  if (!el) return;
  const rowsHtml = Array.from({ length: rows }, (_, i) => {
    const w = 60 + ((i * 17) % 30); // 60~90% 너비 변화
    return `<div class="skeleton-row" style="width:${w}%"></div>`;
  }).join("");
  el.innerHTML = `<div class="skeleton-table">${rowsHtml}</div>`;
}

/** skeleton placeholder 제거 */
export function clearSkeleton(containerId: string): void {
  const el = document.getElementById(containerId);
  if (el && el.querySelector(".skeleton-table")) el.innerHTML = "";
}

// ─── 토스트 알림 ────────────────────────────────────────────

/** 우상단 토스트 알림 (3초 후 자동 사라짐) */
export function showToast(message: string, type: "success" | "error" | "info" | "warning" = "info"): void {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3_000);
}
