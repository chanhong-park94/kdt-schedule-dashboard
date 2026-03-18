/** 훈련생 연락처 관리 모듈 — Supabase CRUD + 캐시 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { fetchRoster } from "./hrdApi";
import { loadHrdConfig } from "./hrdConfig";
import type { HrdRawTrainee } from "./hrdTypes";

// ─── Supabase Client ────────────────────────────────────────
const rawUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const supabaseUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const supabaseKey = typeof rawKey === "string" ? rawKey.trim() : "";
const hasConfig = supabaseUrl.length > 0 && supabaseKey.length > 0;
const sbClient: SupabaseClient | null = hasConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
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
    const { data, error } = await sbClient
      .from(TABLE)
      .select("*")
      .eq("train_pr_id", trainPrId)
      .eq("degr", degr);

    if (error) {
      console.warn("[Contacts] Load error:", error.message);
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
    await sbClient.from(TABLE).upsert(
      {
        train_pr_id: trainPrId,
        degr,
        trainee_name: name,
        phone: phone.trim(),
        email: email.trim(),
      },
      { onConflict: "train_pr_id,degr,trainee_name" },
    );
  } catch (e) {
    console.warn("[Contacts] Save failed:", e);
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
    const { error } = await sbClient
      .from(TABLE)
      .upsert(upsertRows, { onConflict: "train_pr_id,degr,trainee_name" });

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
export async function loadContactsWithRoster(
  trainPrId: string,
  degr: string,
): Promise<ContactDisplay[]> {
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
