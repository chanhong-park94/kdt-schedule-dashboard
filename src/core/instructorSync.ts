import { createClient } from "@supabase/supabase-js";
import type { InstructorDirectoryEntry } from "./types";
import { readClientEnv } from "./env";

type InstructorRow = {
  instructor_code: string;
  name: string | null;
  memo: string | null;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number = 300
): Promise<T> {
  if (maxAttempts < 1) {
    throw new RangeError(`withRetry: maxAttempts must be >= 1, got ${maxAttempts}`);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && baseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

const TABLE_NAME = "instructors";

const rawSupabaseUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawSupabaseAnonKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);

const hasSupabaseConfig =
  typeof rawSupabaseUrl === "string" &&
  typeof rawSupabaseAnonKey === "string" &&
  rawSupabaseUrl.length > 0 &&
  rawSupabaseAnonKey.length > 0;

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toInstructorEntry(row: unknown): InstructorDirectoryEntry | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const data = row as InstructorRow;
  const instructorCode = toText(data.instructor_code).toUpperCase();
  if (!instructorCode) {
    return null;
  }

  return {
    instructorCode,
    name: toText(data.name),
    memo: toText(data.memo)
  };
}

function mergeRows(existing: InstructorDirectoryEntry[]): Map<string, InstructorDirectoryEntry> {
  const map = new Map<string, InstructorDirectoryEntry>();
  for (const row of existing) {
    const normalizedCode = row.instructorCode.trim().toUpperCase();
    if (!normalizedCode) {
      continue;
    }
    map.set(normalizedCode, {
      instructorCode: normalizedCode,
      name: row.name.trim(),
      memo: row.memo.trim()
    });
  }
  return map;
}

const client = hasSupabaseConfig
  ? createClient(rawSupabaseUrl as string, rawSupabaseAnonKey as string, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  : null;

export function isInstructorCloudEnabled(): boolean {
  return hasSupabaseConfig && client !== null;
}

export async function loadInstructorDirectoryFromCloud(): Promise<InstructorDirectoryEntry[]> {
  if (!client) {
    return [];
  }

  const data = await withRetry(async () => {
    const res = await client!
      .from(TABLE_NAME)
      .select("instructor_code,name,memo")
      .order("instructor_code", { ascending: true, nullsFirst: false });
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }, 3);

  if (!Array.isArray(data)) {
    return [];
  }

  const rows: InstructorDirectoryEntry[] = [];
  for (const item of data) {
    const entry = toInstructorEntry(item);
    if (entry) {
      rows.push(entry);
    }
  }
  return rows;
}

export async function upsertInstructorInCloud(entry: InstructorDirectoryEntry): Promise<void> {
  if (!client) {
    return;
  }

  const payload: InstructorRow = {
    instructor_code: entry.instructorCode,
    name: entry.name || null,
    memo: entry.memo || null
  };

  await withRetry(async () => {
    const res = await client!.from(TABLE_NAME).upsert(payload, {
      onConflict: "instructor_code"
    });
    if (res.error) throw new Error(res.error.message);
  }, 3);
}

export async function deleteInstructorFromCloud(instructorCode: string): Promise<void> {
  if (!client) {
    return;
  }

  const normalizedCode = instructorCode.trim().toUpperCase();
  if (!normalizedCode) {
    return;
  }

  await withRetry(async () => {
    const res = await client!.from(TABLE_NAME).delete().eq("instructor_code", normalizedCode);
    if (res.error) throw new Error(res.error.message);
  }, 3);
}

export function mergeWithLocalInstructorDirectory(
  local: InstructorDirectoryEntry[],
  cloud: InstructorDirectoryEntry[]
): InstructorDirectoryEntry[] {
  if (cloud.length === 0) {
    return [...local];
  }

  const map = mergeRows(local);
  for (const row of cloud) {
    const normalizedCode = row.instructorCode.trim().toUpperCase();
    if (!map.has(normalizedCode)) {
      map.set(normalizedCode, { ...row, instructorCode: normalizedCode });
    }
  }

  return [...map.values()].sort((a, b) => a.instructorCode.localeCompare(b.instructorCode));
}
