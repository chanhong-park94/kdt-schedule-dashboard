/** 훈련생 연락처 관리 모듈 — Supabase CRUD + 캐시 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { fetchRoster } from "./hrdApi";
import { loadHrdConfig } from "./hrdConfig";
import type { HrdRawTrainee } from "./hrdTypes";

// ─── Supabase Client ────────────────────────────────────────
// 개인정보(연락처) CRUD는 Google OAuth 인증된 세션(authenticated role)으로만 동작해야 함.
// spec/sql/010_secure_trainee_contacts.sql 의 RLS가 anon 접근을 차단하므로
// persistSession: true 로 OAuth 세션을 자동 복원해서 authenticated JWT 를 전달해야 함.
const rawUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const supabaseUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const supabaseKey = typeof rawKey === "string" ? rawKey.trim() : "";
const hasConfig = supabaseUrl.length > 0 && supabaseKey.length > 0;
const sbClient: SupabaseClient | null = hasConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null;

const TABLE = "trainee_contacts";

// ─── Types ──────────────────────────────────────────────────
export interface ContactRow {
  id?: string;
  train_pr_id: string;
  degr: string;
  trainee_name: string;
  phone: string;
  email: string;
  created_at?: string;
  updated_at?: string;
}

export interface ContactDisplay {
  name: string;
  phone: string;
  email: string;
  status: string; // HRD 훈련 상태
  dropout: boolean;
}

// ─── Cache ──────────────────────────────────────────────────
let contactCache: Map<string, ContactRow> = new Map();
let currentTrainPrId = "";
let currentDegr = "";

function cacheKey(name: string): string {
  return name.replace(/\s+/g, "");
}

// ─── CRUD ───────────────────────────────────────────────────

/** 과정/기수별 연락처 전체 로드 */
export async function loadContacts(trainPrId: string, degr: string): Promise<Map<string, ContactRow>> {
  contactCache = new Map();
  currentTrainPrId = trainPrId;
  currentDegr = degr;

  if (!sbClient) return contactCache;

  try {
    const { data, error } = await sbClient.from(TABLE).select("id,train_pr_id,degr,trainee_name,phone,email").eq("train_pr_id", trainPrId).eq("degr", degr);

    if (error) {
      // RLS 차단(권한 없음) — Google 로그인 안 된 상태이거나 강사 모드
      if (error.code === "42501" || error.message?.includes("permission denied") || error.message?.includes("row-level security")) {
        console.warn("[Contacts] Permission denied — Google Workspace login required");
      } else {
        console.warn("[Contacts] Load error:", error.message);
      }
      return contactCache;
    }

    for (const row of data || []) {
      contactCache.set(cacheKey(row.trainee_name), row as ContactRow);
    }
  } catch (e) {
    console.warn("[Contacts] Load failed:", e);
  }

  return contactCache;
}

/** 개별 연락처 저장 (upsert) */
export async function saveContact(
  trainPrId: string,
  degr: string,
  name: string,
  phone: string,
  email: string,
): Promise<void> {
  const key = cacheKey(name);
  const existing = contactCache.get(key);
  const row: ContactRow = {
    ...existing,
    train_pr_id: trainPrId,
    degr,
    trainee_name: name,
    phone: phone.trim(),
    email: email.trim(),
  };
  contactCache.set(key, row);

  if (!sbClient) return;

  try {
    const { error } = await sbClient.from(TABLE).upsert(
      {
        train_pr_id: trainPrId,
        degr,
        trainee_name: name,
        phone: phone.trim(),
        email: email.trim(),
      },
      { onConflict: "train_pr_id,degr,trainee_name" },
    );
    if (error) {
      // RLS 차단 시 사용자에게 명확한 메시지 (Google 로그인 안 된 강사 모드 등)
      if (error.code === "42501" || error.message?.includes("permission denied") || error.message?.includes("row-level security")) {
        throw new Error("연락처 저장 권한이 없습니다. Google Workspace 계정으로 로그인 후 다시 시도하세요.");
      }
      throw new Error(error.message);
    }
  } catch (e) {
    console.warn("[Contacts] Save failed:", e);
    throw e;
  }
}

/** 일괄 연락처 저장 */
export async function bulkUpsertContacts(
  trainPrId: string,
  degr: string,
  rows: { name: string; phone: string; email: string }[],
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  if (!sbClient) return { success: 0, failed: rows.length };

  const upsertRows = rows.map((r) => ({
    train_pr_id: trainPrId,
    degr,
    trainee_name: r.name.trim(),
    phone: r.phone.trim(),
    email: r.email.trim(),
  }));

  try {
    const { error } = await sbClient.from(TABLE).upsert(upsertRows, { onConflict: "train_pr_id,degr,trainee_name" });

    if (error) {
      console.warn("[Contacts] Bulk upsert error:", error.message);
      failed = rows.length;
    } else {
      success = rows.length;
      // 캐시 갱신
      for (const r of upsertRows) {
        contactCache.set(cacheKey(r.trainee_name), r as ContactRow);
      }
    }
  } catch (e) {
    console.warn("[Contacts] Bulk upsert failed:", e);
    failed = rows.length;
  }

  return { success, failed };
}

/** HRD 명단 + DB 연락처 병합 */
export async function loadContactsWithRoster(trainPrId: string, degr: string): Promise<ContactDisplay[]> {
  const config = loadHrdConfig();

  // 병렬: HRD 명단 + DB 연락처
  const [roster, contacts] = await Promise.all([
    fetchRoster(config, trainPrId, degr).catch(() => [] as HrdRawTrainee[]),
    loadContacts(trainPrId, degr),
  ]);

  return roster.map((raw: HrdRawTrainee) => {
    const name = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").toString().trim();
    const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString().trim() || "훈련중";
    const dropout =
      stNm.includes("중도탈락") ||
      stNm.includes("수료포기") ||
      stNm.includes("조기취업") ||
      stNm.includes("80%이상수료") ||
      stNm.includes("정상수료") ||
      stNm.includes("수료후취업");

    const contact = contacts.get(cacheKey(name));
    return {
      name,
      phone: contact?.phone || "",
      email: contact?.email || "",
      status: stNm,
      dropout,
    };
  });
}

/** 캐시에서 특정 훈련생 연락처 조회 */
export function getContact(name: string): ContactRow | undefined {
  return contactCache.get(cacheKey(name));
}

/** 현재 캐시된 과정/기수 */
export function getCurrentScope(): { trainPrId: string; degr: string } {
  return { trainPrId: currentTrainPrId, degr: currentDegr };
}
