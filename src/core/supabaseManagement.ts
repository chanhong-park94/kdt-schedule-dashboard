import { createClient } from "@supabase/supabase-js";
import { readClientEnv } from "./env";

export const MANAGEMENT_TABLES = {
  courses: "courses",
  subjects: "subjects",
  instructors: "instructors",
  courseSubjectInstructorMap: "course_subject_instructor_map",
  courseTemplates: "course_templates"
} as const;

type CourseRow = {
  id: string;
  course_id: string;
  course_name: string;
  created_at: string | null;
};

type SubjectRow = {
  id: string;
  course_id: string;
  subject_code: string;
  subject_name: string | null;
};

type InstructorRow = {
  id: string;
  instructor_code: string;
  name: string | null;
  created_at: string | null;
};

type CourseTemplateRow = {
  id: string;
  course_id: string;
  template_name: string;
  template_json: Record<string, unknown>;
  created_at: string | null;
};

export type CourseRecord = {
  id: string;
  courseId: string;
  courseName: string;
  createdAt: string;
};

export type SubjectRecord = {
  id: string;
  courseId: string;
  subjectCode: string;
  subjectName: string;
};

export type InstructorRecord = {
  id: string;
  instructorCode: string;
  name: string;
  createdAt: string;
};

export type CourseTemplateRecord = {
  id: string;
  courseId: string;
  templateName: string;
  templateJson: Record<string, unknown>;
  createdAt: string;
};

export type CreateCourseInput = {
  courseId: string;
  courseName: string;
};

export type CreateSubjectInput = {
  courseId: string;
  subjectCode: string;
  subjectName?: string;
};

export type CreateInstructorInput = {
  instructorCode: string;
  name?: string;
};

export type SaveCourseTemplateInput = {
  id?: string;
  courseId: string;
  templateName: string;
  templateJson: Record<string, unknown>;
};

const rawSupabaseUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const rawSupabaseAnonKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);

const normalizedSupabaseUrl = typeof rawSupabaseUrl === "string" ? rawSupabaseUrl.trim() : "";
const normalizedSupabaseAnonKey = typeof rawSupabaseAnonKey === "string" ? rawSupabaseAnonKey.trim() : "";

const hasSupabaseConfig = normalizedSupabaseUrl.length > 0 && normalizedSupabaseAnonKey.length > 0;

const client = hasSupabaseConfig
  ? createClient(normalizedSupabaseUrl, normalizedSupabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  : null;

export function isManagementCloudEnabled(): boolean {
  return hasSupabaseConfig && client !== null;
}

function getClient() {
  if (!client) {
    throw new Error("Supabase 설정이 없습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인하세요.");
  }
  return client;
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function toCourseRecord(row: CourseRow): CourseRecord {
  return {
    id: row.id,
    courseId: normalizeCode(row.course_id),
    courseName: normalizeText(row.course_name),
    createdAt: row.created_at ?? ""
  };
}

function toSubjectRecord(row: SubjectRow): SubjectRecord {
  return {
    id: row.id,
    courseId: normalizeCode(row.course_id),
    subjectCode: normalizeCode(row.subject_code),
    subjectName: normalizeText(row.subject_name ?? "")
  };
}

function toInstructorRecord(row: InstructorRow): InstructorRecord {
  return {
    id: row.id,
    instructorCode: normalizeCode(row.instructor_code),
    name: normalizeText(row.name ?? ""),
    createdAt: row.created_at ?? ""
  };
}

function toCourseTemplateRecord(row: CourseTemplateRow): CourseTemplateRecord {
  return {
    id: row.id,
    courseId: normalizeCode(row.course_id),
    templateName: normalizeText(row.template_name),
    templateJson: row.template_json,
    createdAt: row.created_at ?? ""
  };
}

export function isValidSaveCourseTemplateInput(payload: unknown): payload is SaveCourseTemplateInput {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const row = payload as Record<string, unknown>;
  if (typeof row.courseId !== "string" || row.courseId.trim().length === 0) {
    return false;
  }
  if (typeof row.templateName !== "string" || row.templateName.trim().length === 0) {
    return false;
  }
  if (!row.templateJson || typeof row.templateJson !== "object") {
    return false;
  }
  if (row.id !== undefined && typeof row.id !== "string") {
    return false;
  }
  return true;
}

export async function listCourses(): Promise<CourseRecord[]> {
  const supabase = getClient();
  const response = await supabase
    .from(MANAGEMENT_TABLES.courses)
    .select("id,course_id,course_name,created_at")
    .order("course_id", { ascending: true });

  if (response.error) {
    throw new Error(response.error.message);
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.map((row) => toCourseRecord(row as CourseRow));
}

export async function createCourse(input: CreateCourseInput): Promise<CourseRecord> {
  const supabase = getClient();
  const payload = {
    course_id: normalizeCode(input.courseId),
    course_name: normalizeText(input.courseName)
  };

  const response = await supabase
    .from(MANAGEMENT_TABLES.courses)
    .upsert(payload, { onConflict: "course_id" })
    .select("id,course_id,course_name,created_at")
    .single();

  if (response.error) {
    throw new Error(response.error.message);
  }

  return toCourseRecord(response.data as CourseRow);
}

export async function listSubjects(courseId: string): Promise<SubjectRecord[]> {
  const supabase = getClient();
  const normalizedCourseId = normalizeCode(courseId);
  const response = await supabase
    .from(MANAGEMENT_TABLES.subjects)
    .select("id,course_id,subject_code,subject_name")
    .eq("course_id", normalizedCourseId)
    .order("subject_code", { ascending: true });

  if (response.error) {
    throw new Error(response.error.message);
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.map((row) => toSubjectRecord(row as SubjectRow));
}

export async function createSubject(input: CreateSubjectInput): Promise<SubjectRecord> {
  const supabase = getClient();
  const payload = {
    course_id: normalizeCode(input.courseId),
    subject_code: normalizeCode(input.subjectCode),
    subject_name: normalizeText(input.subjectName)
  };

  const response = await supabase
    .from(MANAGEMENT_TABLES.subjects)
    .upsert(payload, { onConflict: "course_id,subject_code" })
    .select("id,course_id,subject_code,subject_name")
    .single();

  if (response.error) {
    throw new Error(response.error.message);
  }

  return toSubjectRecord(response.data as SubjectRow);
}

export async function listInstructors(): Promise<InstructorRecord[]> {
  const supabase = getClient();
  const response = await supabase
    .from(MANAGEMENT_TABLES.instructors)
    .select("id,instructor_code,name,created_at")
    .order("instructor_code", { ascending: true });

  if (response.error) {
    throw new Error(response.error.message);
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.map((row) => toInstructorRecord(row as InstructorRow));
}

export async function createInstructor(input: CreateInstructorInput): Promise<InstructorRecord> {
  const supabase = getClient();
  const payload = {
    instructor_code: normalizeCode(input.instructorCode),
    name: normalizeText(input.name)
  };

  const response = await supabase
    .from(MANAGEMENT_TABLES.instructors)
    .upsert(payload, { onConflict: "instructor_code" })
    .select("id,instructor_code,name,created_at")
    .single();

  if (response.error) {
    throw new Error(response.error.message);
  }

  return toInstructorRecord(response.data as InstructorRow);
}

export async function saveCourseTemplate(input: SaveCourseTemplateInput): Promise<CourseTemplateRecord> {
  if (!isValidSaveCourseTemplateInput(input)) {
    throw new Error("course template payload 형식이 올바르지 않습니다.");
  }

  const supabase = getClient();
  let templateId = input.id?.trim() ?? "";
  if (!templateId) {
    const existing = await supabase
      .from(MANAGEMENT_TABLES.courseTemplates)
      .select("id")
      .eq("course_id", normalizeCode(input.courseId))
      .eq("template_name", normalizeText(input.templateName))
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      throw new Error(existing.error.message);
    }

    if (existing.data?.id) {
      templateId = existing.data.id;
    }
  }

  const payload = {
    ...(templateId ? { id: templateId } : {}),
    course_id: normalizeCode(input.courseId),
    template_name: normalizeText(input.templateName),
    template_json: input.templateJson
  };

  const response = await supabase
    .from(MANAGEMENT_TABLES.courseTemplates)
    .upsert(payload, { onConflict: "id" })
    .select("id,course_id,template_name,template_json,created_at")
    .single();

  if (response.error) {
    throw new Error(response.error.message);
  }

  return toCourseTemplateRecord(response.data as CourseTemplateRow);
}

export async function listCourseTemplates(): Promise<CourseTemplateRecord[]> {
  const supabase = getClient();
  const response = await supabase
    .from(MANAGEMENT_TABLES.courseTemplates)
    .select("id,course_id,template_name,template_json,created_at")
    .order("course_id", { ascending: true })
    .order("template_name", { ascending: true });

  if (response.error) {
    throw new Error(response.error.message);
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.map((row) => toCourseTemplateRecord(row as CourseTemplateRow));
}

export async function deleteCourseTemplate(courseId: string, templateName: string): Promise<void> {
  const supabase = getClient();
  const response = await supabase
    .from(MANAGEMENT_TABLES.courseTemplates)
    .delete()
    .eq("course_id", normalizeCode(courseId))
    .eq("template_name", normalizeText(templateName));

  if (response.error) {
    throw new Error(response.error.message);
  }
}
