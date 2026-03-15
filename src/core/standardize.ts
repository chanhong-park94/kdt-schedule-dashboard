const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/g;
const SPACE_PATTERN = /\s+/g;
const BRACKET_PATTERN = /[()[\]{}]/g;
const SEPARATOR_PATTERN = /[-_/\\|:;,.]+/g;

function normalizeCode(raw: string): string {
  const withoutControl = (raw ?? "").replace(CONTROL_CHAR_PATTERN, " ");
  const trimmed = withoutControl.trim().replace(SPACE_PATTERN, " ");

  if (!trimmed) {
    return "";
  }

  const normalized = trimmed
    .replace(BRACKET_PATTERN, " ")
    .replace(SEPARATOR_PATTERN, "_")
    .replace(/\s*_\s*/g, "_")
    .replace(SPACE_PATTERN, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized;
}

export function normalizeInstructorCode(raw: string): string {
  return normalizeCode(raw);
}

export function normalizeClassroomCode(raw: string): string {
  return normalizeCode(raw);
}

export function normalizeSubjectCode(raw: string): string {
  return normalizeCode(raw);
}
