import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";

export interface AssistantCode {
  code: string;
  trainPrId: string;
  degr: string;
  courseName: string;
  createdAt: string;
}

const ADMIN_CODE = "v2";
const TABLE = "assistant_codes";

// ─── Supabase Client (reuse same env vars) ──────────────────

const rawUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const supabaseUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const supabaseKey = typeof rawKey === "string" ? rawKey.trim() : "";
const hasConfig = supabaseUrl.length > 0 && supabaseKey.length > 0;

// 데이터 조회용 클라이언트 (보조강사 코드, 성별 등)
const client: SupabaseClient | null = hasConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  : null;

// Google OAuth 전용 클라이언트 (세션 유지 + 콜백 감지)
const authClient: SupabaseClient | null = hasConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, detectSessionInUrl: true },
    })
  : null;

function getClient(): SupabaseClient {
  if (!client) throw new Error("Supabase 설정이 없습니다. 보조강사 코드를 사용하려면 Supabase를 설정하세요.");
  return client;
}

function getAuthClient(): SupabaseClient {
  if (!authClient) throw new Error("Supabase 설정이 없습니다.");
  return authClient;
}

// ─── DB Row type ─────────────────────────────────────────────

type AssistantCodeRow = {
  id: string;
  code: string;
  train_pr_id: string;
  degr: string;
  course_name: string;
  created_at: string | null;
};

function toAssistantCode(row: AssistantCodeRow): AssistantCode {
  return {
    code: row.code,
    trainPrId: row.train_pr_id,
    degr: row.degr,
    courseName: row.course_name,
    createdAt: row.created_at ?? "",
  };
}

// ─── CRUD (async, Supabase-backed) ──────────────────────────

export async function loadAssistantCodes(): Promise<AssistantCode[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,code,train_pr_id,degr,course_name,created_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toAssistantCode(row as AssistantCodeRow));
}

export async function saveAssistantCode(entry: Omit<AssistantCode, "createdAt">): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { code: entry.code, train_pr_id: entry.trainPrId, degr: entry.degr, course_name: entry.courseName },
      { onConflict: "code" },
    );

  if (error) throw new Error(error.message);
}

export async function removeAssistantCode(code: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from(TABLE).delete().eq("code", code);
  if (error) throw new Error(error.message);
}

export async function findAssistantCode(code: string): Promise<AssistantCode | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,code,train_pr_id,degr,course_name,created_at")
    .eq("code", code)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toAssistantCode(data as AssistantCodeRow) : null;
}

/** null = valid, string = error message */
export async function validateAssistantCode(code: string): Promise<string | null> {
  if (!code.trim()) return "코드를 입력하세요.";
  if (code === ADMIN_CODE) return "관리자 인증코드와 동일한 코드는 사용할 수 없습니다.";
  const existing = await findAssistantCode(code);
  if (existing) return "이미 사용 중인 코드입니다.";
  return null;
}

// ─── Session Management (sessionStorage — per-tab) ──────────

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

// ─── Google OAuth (운영매니저 @modulabs.co.kr) ───────────────

const ALLOWED_DOMAIN = "modulabs.co.kr";

/** Google Workspace 계정으로 로그인 (리다이렉트) */
export async function signInWithGoogle(): Promise<void> {
  const sb = getAuthClient();
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { hd: ALLOWED_DOMAIN },
    },
  });
  if (error) throw new Error(error.message);
}

/** OAuth 콜백 처리: 리다이렉트 후 세션 확인 + 도메인 검증 */
export async function handleAuthCallback(): Promise<{ email: string } | null> {
  const sb = getAuthClient();
  const { data } = await sb.auth.getSession();
  if (!data.session?.user?.email) return null;

  const email = data.session.user.email;
  // 도메인 이중 검증: @modulabs.co.kr만 허용
  if (!email.endsWith("@" + ALLOWED_DOMAIN)) {
    await sb.auth.signOut();
    return null;
  }
  return { email };
}

/** Google OAuth 로그아웃 */
export async function signOutGoogle(): Promise<void> {
  try {
    const sb = getAuthClient();
    await sb.auth.signOut();
  } catch {
    // 무시 (이미 로그아웃 상태일 수 있음)
  }
}
