/** HRD 출결 관리대상 Slack 리포트 전송 모듈 */
import { loadHrdConfig } from "./hrdConfig";
import { readClientEnv } from "../core/env";
import type { AttendanceStudent, RiskLevel } from "./hrdTypes";
import { DEFAULT_SLACK_SCHEDULE } from "./hrdTypes";

// Supabase Edge Function 기반 Slack 프록시
const _sbUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const _sbKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const EDGE_FUNCTION_URL =
  typeof _sbUrl === "string" && _sbUrl.trim() ? `${_sbUrl.trim()}/functions/v1/slack-proxy` : "";
const SUPABASE_ANON_KEY = typeof _sbKey === "string" ? _sbKey.trim() : "";

// ─── Slack Message Builder ───────────────────────────────────

function _getRiskTag(level: RiskLevel): string {
  switch (level) {
    case "danger":
      return "🔴";
    case "warning":
      return "🟠";
    case "caution":
      return "🟡";
    default:
      return "";
  }
}

/** 연속 결석자 목록 추출 (2일 이상 연속 결석) */
function getConsecutiveAbsentees(students: AttendanceStudent[]): AttendanceStudent[] {
  return students.filter(
    (s) =>
      !s.dropout &&
      s.absentDays >= 2 &&
      (s.riskLevel === "danger" || s.riskLevel === "warning" || s.riskLevel === "caution"),
  );
}

/** 매니저 ID 목록에서 고유 Slack 멤버 ID 추출 */
function collectUniqueManagerIds(managerIdsList: string[]): string[] {
  const set = new Set<string>();
  for (const ids of managerIdsList) {
    if (!ids || !ids.trim()) continue;
    ids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .forEach((id) => set.add(id));
  }
  return Array.from(set);
}

export interface SlackReportOptions {
  courseName: string;
  degr: string;
  date: string;
  students: AttendanceStudent[];
  headerText?: string;
  footerText?: string;
  defenseRate?: number;
  /** 주간 하차 인원 (이번 주 기준) */
  weeklyDropouts?: number;
  /** 과정 담당 매니저 Slack ID (콤마 구분) */
  managerIds?: string;
  /** 해당 과정의 trainPrId (매니저 조회용) */
  trainPrId?: string;
}

/**
 * 개별 과정 Slack 메시지 빌드 (수동 전송용)
 */
export function buildSlackMessage(
  courseName: string,
  degr: string,
  date: string,
  students: AttendanceStudent[],
  headerText?: string,
  footerText?: string,
  defenseRate?: number,
  weeklyDropouts?: number,
  managerIds?: string,
  trainPrId?: string,
): string {
  // 단일 과정을 통합 빌더에 위임
  const config = loadHrdConfig();
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;
  const resolvedManagerIds =
    managerIds ?? (trainPrId && schedule.courseManagers ? (schedule.courseManagers[trainPrId] ?? "") : "");

  return buildConsolidatedSlackMessage(
    [{ courseName, degr, date, students, defenseRate, weeklyDropouts, managerIds: resolvedManagerIds }],
    headerText,
    footerText,
  );
}

/** 통합 리포트용 과정 데이터 */
export interface CourseReportData {
  courseName: string;
  degr: string;
  date: string;
  students: AttendanceStudent[];
  defenseRate?: number;
  weeklyDropouts?: number;
  managerIds?: string;
}

/**
 * 통합 Slack 메시지 빌드 — 전 과정을 하나의 메시지로 합침
 *
 * 구조:
 * ┌─ 헤더 (1회)
 * ├─ 담당자 태그 (고유 멤버만, 1회)
 * ├─ 과정 A 블록 (운영현황 + 관리대상)
 * ├─ 과정 B 블록
 * ├─ ...
 * ├─ 전체 요약 (1회)
 * └─ 푸터 (1회)
 */
export function buildConsolidatedSlackMessage(
  courses: CourseReportData[],
  headerText?: string,
  footerText?: string,
): string {
  const config = loadHrdConfig();
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;
  const header = headerText ?? schedule.headerText ?? DEFAULT_SLACK_SCHEDULE.headerText;
  const footer = footerText ?? schedule.footerText ?? DEFAULT_SLACK_SCHEDULE.footerText;

  const lines: string[] = [];

  // ─── 푸터 → 상단 표기 ───
  if (footer) {
    lines.push(footer);
  }

  // ─── 헤더 ───
  lines.push(header);
  lines.push("━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  // ─── 전체 요약 집계용 ───
  let grandTotalRisk = 0;
  let grandTotalMissing = 0;
  let grandTotalConsec = 0;

  // ─── 과정별 블록 ───
  courses.forEach((c, idx) => {
    const total = c.students.length;
    const active = c.students.filter((s) => !s.dropout);
    const dropouts = total - active.length;
    const danger = active.filter((s) => s.riskLevel === "danger");
    const warning = active.filter((s) => s.riskLevel === "warning");
    const caution = active.filter((s) => s.riskLevel === "caution");
    const missing = active.filter((s) => s.missingCheckout);
    const consecutiveAbsent = getConsecutiveAbsentees(active);
    const totalRisk = danger.length + warning.length + caution.length;
    const defRate = c.defenseRate ?? (total > 0 ? (active.length / total) * 100 : 100);

    grandTotalRisk += totalRisk;
    grandTotalMissing += missing.length;
    grandTotalConsec += consecutiveAbsent.length;

    // 과정 구분선 (2번째부터)
    if (idx > 0) lines.push("");

    // 과정 헤더: 과정명 + 날짜
    lines.push(`*${c.courseName} ${c.degr}기* | ${c.date}`);

    // 운영 현황 — 1줄 요약
    lines.push(
      `  전체 ${total}명 · 현재 ${active.length}명 (하차 ${dropouts}명) · 하차방어율 ${defRate.toFixed(1)}%`,
    );

    // 관리대상 없으면 정상 표시
    if (totalRisk === 0 && missing.length === 0 && consecutiveAbsent.length === 0) {
      lines.push("  ✅ 관리대상 없음 — 정상 운영 중");
      return;
    }

    // 관리대상: 위험도별 인라인 표시
    const riskStudents = [...danger, ...warning, ...caution].sort(
      (a, b) => a.remainingAbsent - b.remainingAbsent,
    );
    if (riskStudents.length > 0) {
      lines.push(`  관리대상 ${totalRisk}명 | 퇴실미체크 ${missing.length}명 | 연속결석 ${consecutiveAbsent.length}명`);
      for (const s of riskStudents) {
        const tag = _getRiskTag(s.riskLevel);
        const remainPct = s.maxAbsent > 0 ? Math.round((s.remainingAbsent / s.maxAbsent) * 100) : 0;
        const remainText = remainPct <= 15 ? "*제적위험*" : `잔여 ${s.remainingAbsent}일(${remainPct}%)`;
        lines.push(`    ${tag} ${s.name} — 결석 ${s.absentDays}/${s.maxAbsent}일 · ${remainText}`);
      }
    } else if (missing.length > 0 || consecutiveAbsent.length > 0) {
      lines.push(`  관리대상 0명 | 퇴실미체크 ${missing.length}명 | 연속결석 ${consecutiveAbsent.length}명`);
    }

    // 퇴실 미체크 (관리대상과 별도 — 이름만 나열)
    if (missing.length > 0) {
      const names = missing.map((s) => s.name).join(", ");
      lines.push(`    ⚠️ 퇴실미체크: ${names}`);
    }
  });

  // ─── 전체 요약 (1회) ───
  if (courses.length > 1) {
    lines.push("");
    lines.push("─────────────────────");
    lines.push(
      `전체 요약 | 관리대상 ${grandTotalRisk}명 · 퇴실미체크 ${grandTotalMissing}명 · 연속결석 ${grandTotalConsec}명`,
    );
  }

  // 푸터는 상단으로 이동됨

  return lines.join("\n");
}

// ─── Slack Webhook Sender ────────────────────────────────────

async function postToSlack(webhookUrl: string, payload: object): Promise<void> {
  if (!EDGE_FUNCTION_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase 환경변수가 설정되지 않았습니다. Edge Function을 사용할 수 없습니다.");
  }

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ webhookUrl, payload }),
  });

  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));

  if (!res.ok || !data.ok) {
    throw new Error(`Slack 전송 실패: ${data.error || `HTTP ${res.status}`}`);
  }
}

export async function sendSlackReport(
  courseName: string,
  degr: string,
  date: string,
  students: AttendanceStudent[],
  defenseRate?: number,
): Promise<void> {
  const config = loadHrdConfig();
  const webhookUrl = config.slackWebhookUrl;

  if (!webhookUrl) {
    throw new Error("Slack Webhook URL이 설정되지 않았습니다.\n설정 > 잠금 해제 > Slack Webhook URL을 입력해주세요.");
  }

  const text = buildSlackMessage(courseName, degr, date, students, undefined, undefined, defenseRate);
  await postToSlack(webhookUrl, { text });
}

/**
 * Slack Webhook URL 테스트 — 짧은 확인 메시지 전송
 */
export async function testSlackWebhook(webhookUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const text = `✅ *[KDT 대시보드 Slack 연결 테스트]*\n테스트 시간: ${timeStr}\n이 메시지가 보이면 Webhook이 정상적으로 연결되었습니다.`;
    await postToSlack(webhookUrl, { text });
    return { ok: true, message: "Slack 전송 성공! 채널을 확인하세요." };
  } catch (e) {
    return { ok: false, message: `Slack 전송 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 특정 webhook URL로 리포트 전송 (스케줄러용)
 * prebuiltText가 있으면 빌드 없이 직접 전송
 */
export async function sendSlackReportDirect(
  webhookUrl: string,
  courseName: string,
  degr: string,
  date: string,
  students: AttendanceStudent[],
  defenseRate?: number,
  weeklyDropouts?: number,
  trainPrId?: string,
  prebuiltText?: string,
): Promise<void> {
  const text =
    prebuiltText ??
    buildSlackMessage(courseName, degr, date, students, undefined, undefined, defenseRate, weeklyDropouts, undefined, trainPrId);
  await postToSlack(webhookUrl, { text });
}
