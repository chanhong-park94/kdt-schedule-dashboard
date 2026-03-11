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

const client: SupabaseClient | null = hasConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  : null;

function getClient(): SupabaseClient {
  if (!client) throw new Error("Supabase 설정이 없습니다. 보조강사 코드를 사용하려면 Supabase를 설정하세요.");
  return client;
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
