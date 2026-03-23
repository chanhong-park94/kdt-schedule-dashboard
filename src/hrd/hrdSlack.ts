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

function _getRiskEmoji(level: RiskLevel): string {
  switch (level) {
    case "danger":
      return "🔴";
    case "warning":
      return "🟠";
    case "caution":
      return "🟡";
    default:
      return "🟢";
  }
}

function formatStudentLine(s: AttendanceStudent): string {
  const rateText = s.totalDays > 0 ? `결석 ${s.absentDays}/${s.maxAbsent}일` : `${s.attendanceRate.toFixed(1)}%`;
  const remainText =
    s.totalDays > 0 ? (s.remainingAbsent <= 1 ? " · *제적위험*" : ` · 잔여 ${s.remainingAbsent}일`) : "";
  return `  • ${s.name} (${rateText}${remainText})`;
}

function buildRiskGroup(label: string, students: AttendanceStudent[]): string {
  if (students.length === 0) return "";
  const lines = students.sort((a, b) => a.attendanceRate - b.attendanceRate).map(formatStudentLine);
  return `${label} — *${students.length}명*\n${lines.join("\n")}`;
}

/** 매니저 태그 문자열 생성 — Slack <@U12345> 형식 */
function buildManagerMentions(managerIds: string): string {
  if (!managerIds || !managerIds.trim()) return "";
  const ids = managerIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return "";
  return "👤 담당: " + ids.map((id) => `<@${id}>`).join(" ") + "\n";
}

/** 연속 결석자 목록 추출 (2일 이상 연속 결석) */
function getConsecutiveAbsentees(students: AttendanceStudent[]): AttendanceStudent[] {
  // 결석일수 2일 이상이면서 현재 결석 상태인 훈련생 = 연속 결석 관리 대상
  return students.filter(
    (s) =>
      !s.dropout &&
      s.absentDays >= 2 &&
      (s.riskLevel === "danger" || s.riskLevel === "warning" || s.riskLevel === "caution"),
  );
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
 * Slack 메시지 빌드 — 신규 KPI 요약 형식
 * 전체 훈련인원, 현재 훈련인원, 주간 하차인원, 하차방어율, 연속 결석 관리대상
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
  const config = loadHrdConfig();
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;
  const header = headerText ?? schedule.headerText ?? DEFAULT_SLACK_SCHEDULE.headerText;
  const footer = footerText ?? schedule.footerText ?? DEFAULT_SLACK_SCHEDULE.footerText;

  // 매니저 ID: 직접 전달 > config에서 조회
  const resolvedManagerIds =
    managerIds ?? (trainPrId && schedule.courseManagers ? (schedule.courseManagers[trainPrId] ?? "") : "");

  const total = students.length;
  const active = students.filter((s) => !s.dropout);
  const dropouts = total - active.length;
  const danger = active.filter((s) => s.riskLevel === "danger");
  const warning = active.filter((s) => s.riskLevel === "warning");
  const caution = active.filter((s) => s.riskLevel === "caution");
  const missing = active.filter((s) => s.missingCheckout);
  const consecutiveAbsent = getConsecutiveAbsentees(active);

  const totalRisk = danger.length + warning.length + caution.length;
  const defRate = defenseRate ?? (total > 0 ? (active.length / total) * 100 : 100);

  const sections: string[] = [];

  // Header
  sections.push(header);
  sections.push(`━━━━━━━━━━━━━━━━━━━`);
  sections.push(`📋 *${courseName} ${degr}기* | ${date}`);

  // 매니저 태그
  const mentions = buildManagerMentions(resolvedManagerIds);
  if (mentions) sections.push(mentions);

  sections.push("");

  // KPI 요약 블록
  sections.push(`📊 *운영 현황*`);
  sections.push(`  • 전체 훈련인원: *${total}명*`);
  sections.push(`  • 현재 훈련인원: *${active.length}명* (하차 ${dropouts}명)`);
  if (weeklyDropouts != null) {
    sections.push(`  • 주간 하차인원: *${weeklyDropouts}명*`);
  }
  sections.push(`  • 하차방어율: *${defRate.toFixed(1)}%*`);
  sections.push("");

  // 연속 결석 관리대상
  if (consecutiveAbsent.length > 0) {
    sections.push(`🚨 *연속 결석 관리대상* — *${consecutiveAbsent.length}명*`);
    consecutiveAbsent
      .sort((a, b) => a.remainingAbsent - b.remainingAbsent)
      .forEach((s) => {
        const emoji = _getRiskEmoji(s.riskLevel);
        const remainText = s.remainingAbsent <= 1 ? "*제적위험*" : `잔여 ${s.remainingAbsent}일`;
        sections.push(`  ${emoji} ${s.name} — 결석 ${s.absentDays}/${s.maxAbsent}일 · ${remainText}`);
      });
    sections.push("");
  }

  // Risk groups (상세)
  const dangerBlock = buildRiskGroup("🔴 제적위험 (잔여 1일 이하)", danger);
  const warningBlock = buildRiskGroup("🟠 경고 (잔여 2~3일)", warning);
  const cautionBlock = buildRiskGroup("🟡 주의 (잔여 4~6일)", caution);
  const missingBlock = buildRiskGroup("⚠️ 퇴실 미체크", missing);

  if (dangerBlock) sections.push(dangerBlock);
  if (warningBlock) sections.push(warningBlock);
  if (cautionBlock) sections.push(cautionBlock);
  if (missingBlock) sections.push(missingBlock);

  if (totalRisk === 0 && missing.length === 0 && consecutiveAbsent.length === 0) {
    sections.push("✅ 관리대상 없음 — 정상 운영 중");
  }

  // Summary
  sections.push("");
  sections.push(
    `📈 관리대상: ${totalRisk}명 | 퇴실미체크: ${missing.length}명 | 연속결석: ${consecutiveAbsent.length}명`,
  );

  // Footer
  if (footer) {
    sections.push(`\n${footer}`);
  }

  return sections.join("\n");
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
): Promise<void> {
  const text = buildSlackMessage(
    courseName,
    degr,
    date,
    students,
    undefined,
    undefined,
    defenseRate,
    weeklyDropouts,
    undefined,
    trainPrId,
  );
  await postToSlack(webhookUrl, { text });
}
