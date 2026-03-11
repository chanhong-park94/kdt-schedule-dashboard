export interface AssistantCode {
  code: string;
  trainPrId: string;
  degr: string;
  courseName: string;
  createdAt: string;
}

const STORAGE_KEY = "kdt_assistant_codes_v1";
const ADMIN_CODE = "v2";

export function loadAssistantCodes(): AssistantCode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AssistantCode[]) : [];
  } catch {
    return [];
  }
}

function saveCodes(codes: AssistantCode[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
}

export function saveAssistantCode(entry: Omit<AssistantCode, "createdAt">): void {
  const codes = loadAssistantCodes();
  const idx = codes.findIndex((c) => c.code === entry.code);
  const full: AssistantCode = { ...entry, createdAt: new Date().toISOString() };
  if (idx >= 0) {
    codes[idx] = full;
  } else {
    codes.push(full);
  }
  saveCodes(codes);
}

export function removeAssistantCode(code: string): void {
  const codes = loadAssistantCodes().filter((c) => c.code !== code);
  saveCodes(codes);
}

export function findAssistantCode(code: string): AssistantCode | null {
  return loadAssistantCodes().find((c) => c.code === code) ?? null;
}

/** null = valid, string = error message */
export function validateAssistantCode(code: string): string | null {
  if (!code.trim()) return "코드를 입력하세요.";
  if (code === ADMIN_CODE) return "관리자 인증코드와 동일한 코드는 사용할 수 없습니다.";
  const existing = loadAssistantCodes();
  if (existing.some((c) => c.code === code)) return "이미 사용 중인 코드입니다.";
  return null;
}

// ─── Session Management ─────────────────────────────

export interface AssistantSession {
  role: "assistant";
  trainPrId: string;
  degr: string;
  courseName: string;
}

const SESSION_KEY = "kdt_assistant_session_v1";

export function setAssistantSession(session: AssistantSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getAssistantSession(): AssistantSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AssistantSession) : null;
  } catch {
    return null;
  }
}

export function clearAssistantSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
