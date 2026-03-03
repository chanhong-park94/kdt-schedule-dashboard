import { createClient } from "@supabase/supabase-js";
import type { InstructorDirectoryEntry } from "./types";
import { readClientEnv } from "./env";

type InstructorRow = {
  instructor_code: string;
  name: string | null;
  memo: string | null;
};

type InstructorPayload = {
  instructor_code: string;
  name: string | null;
  memo: string | null;
};

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

  const response = await client
    .from(TABLE_NAME)
    .select("instructor_code,name,memo")
    .order("instructor_code", { ascending: true, nullsFirst: false });

  if (response.error) {
    throw new Error(response.error.message);
  }

  if (!Array.isArray(response.data)) {
    return [];
  }

  const rows: InstructorDirectoryEntry[] = [];
  for (const item of response.data) {
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

  const payload: InstructorPayload = {
    instructor_code: entry.instructorCode,
    name: entry.name || null,
    memo: entry.memo || null
  };

  const response = await client.from(TABLE_NAME).upsert(payload, {
    onConflict: "instructor_code"
  });

  if (response.error) {
    throw new Error(response.error.message);
  }
}

export async function deleteInstructorFromCloud(instructorCode: string): Promise<void> {
  if (!client) {
    return;
  }

  const normalizedCode = instructorCode.trim().toUpperCase();
  if (!normalizedCode) {
    return;
  }

  const response = await client.from(TABLE_NAME).delete().eq("instructor_code", normalizedCode);
  if (response.error) {
    throw new Error(response.error.message);
  }
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
    if (!map.has(row.instructorCode)) {
      map.set(row.instructorCode, row);
    }
  }

  return [...map.values()].sort((a, b) => a.instructorCode.localeCompare(b.instructorCode));
}
