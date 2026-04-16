/**
 * HTML 이스케이프 유틸
 *
 * innerHTML에 사용자/API 데이터를 삽입할 때 XSS를 방지합니다.
 * - `&`, `<`, `>`, `"`, `'` 문자를 엔티티로 변환
 * - null/undefined는 빈 문자열로 처리
 * - 숫자/불리언은 String() 변환 후 이스케이프
 *
 * 사용 예:
 *   element.innerHTML = `<td>${escapeHtml(student.name)}</td>`;
 *
 * 대안(더 안전): element.textContent = student.name
 *   — 하지만 템플릿 리터럴로 복합 HTML을 조립할 때는 이 함수를 사용하세요.
 */
export function escapeHtml(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML 속성값 전용 이스케이프 (쌍따옴표 속성 기준)
 *
 * <input value="${escapeAttr(userInput)}" /> 패턴에 사용합니다.
 * escapeHtml과 사실상 동일하지만 의도를 명확히 하기 위해 분리 export.
 */
export function escapeAttr(value: string | number | boolean | null | undefined): string {
  return escapeHtml(value);
}
