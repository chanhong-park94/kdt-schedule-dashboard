/** HRD 출결 관리대상 Slack 리포트 전송 모듈 */
import { loadHrdConfig } from "./hrdConfig";
import type { AttendanceStudent, RiskLevel } from "./hrdTypes";
import { DEFAULT_SLACK_SCHEDULE } from "./hrdTypes";

const CORS_PROXIES = [
  "https://corsproxy.io/?url=",
  "https://api.allorigins.win/raw?url=",
  "https://proxy.corsfix.com/?url=",
];

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
    s.totalDays > 0 ? (s.remainingAbsent <= 0 ? " · *제적대상*" : ` · 잔여 ${s.remainingAbsent}일`) : "";
  return `  • ${s.name} (${rateText}${remainText})`;
}

function buildRiskGroup(label: string, students: AttendanceStudent[]): string {
  if (students.length === 0) return "";
  const lines = students.sort((a, b) => a.attendanceRate - b.attendanceRate).map(formatStudentLine);
  return `${label} — *${students.length}명*\n${lines.join("\n")}`;
}

/**
 * Slack 메시지 빌드 — 커스텀 헤더/푸터 지원
 * @param defenseRate - 하차방어율 (%) — 스케줄러에서 전달
 */
export function buildSlackMessage(
  courseName: string,
  degr: string,
  date: string,
  students: AttendanceStudent[],
  headerText?: string,
  footerText?: string,
  defenseRate?: number,
): string {
  const config = loadHrdConfig();
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;
  const header = headerText ?? schedule.headerText ?? DEFAULT_SLACK_SCHEDULE.headerText;
  const footer = footerText ?? schedule.footerText ?? DEFAULT_SLACK_SCHEDULE.footerText;

  const active = students.filter((s) => !s.dropout);
  const danger = active.filter((s) => s.riskLevel === "danger");
  const warning = active.filter((s) => s.riskLevel === "warning");
  const caution = active.filter((s) => s.riskLevel === "caution");
  const missing = active.filter((s) => s.missingCheckout);

  const totalRisk = danger.length + warning.length + caution.length;

  const sections: string[] = [];

  // Header (커스터마이징 가능)
  sections.push(header);
  sections.push(`━━━━━━━━━━━━━━━━━━━`);
  sections.push(`📋 *${courseName} ${degr}기* | ${date}\n`);

  // Risk groups
  const dangerBlock = buildRiskGroup("🔴 위험 (제적 대상)", danger);
  const warningBlock = buildRiskGroup("🟠 경고 (잔여 2일 이내)", warning);
  const cautionBlock = buildRiskGroup("🟡 주의 (잔여 5일 이내)", caution);
  const missingBlock = buildRiskGroup("⚠️ 퇴실 미체크", missing);

  if (dangerBlock) sections.push(dangerBlock);
  if (warningBlock) sections.push(warningBlock);
  if (cautionBlock) sections.push(cautionBlock);
  if (missingBlock) sections.push(missingBlock);

  if (totalRisk === 0 && missing.length === 0) {
    sections.push("✅ 관리대상 없음 — 정상 운영 중");
  }

  // Summary stats — 하차방어율 포함
  sections.push("");
  const defRateText = defenseRate != null ? `하차방어율: ${defenseRate.toFixed(1)}%` : "";
  sections.push(
    `📊 전체: ${active.length}명 | 관리대상: ${totalRisk}명 | 퇴실미체크: ${missing.length}명 | ${defRateText}`,
  );

  // Footer (커스터마이징 가능)
  if (footer) {
    sections.push(`\n${footer}`);
  }

  return sections.join("\n");
}

// ─── Slack Webhook Sender ────────────────────────────────────

async function postToSlackViaProxy(webhookUrl: string, payload: object): Promise<void> {
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    try {
      const proxyUrl = CORS_PROXIES[i] + encodeURIComponent(webhookUrl);
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok || res.status === 200) return;
      // Slack returns "ok" as text, not JSON
      const text = await res.text();
      if (text === "ok") return;
      throw new Error(`Slack responded: ${res.status} ${text}`);
    } catch (e) {
      console.warn(`[Slack] Proxy #${i} failed:`, e instanceof Error ? e.message : e);
      if (i === CORS_PROXIES.length - 1) {
        throw new Error(`Slack 전송 실패: 모든 프록시 실패`);
      }
    }
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
  await postToSlackViaProxy(webhookUrl, { text });
}

/**
 * Slack Webhook URL 테스트 — 짧은 확인 메시지 전송
 */
export async function testSlackWebhook(webhookUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const text = `✅ *[KDT 대시보드 Slack 연결 테스트]*\n테스트 시간: ${timeStr}\n이 메시지가 보이면 Webhook이 정상적으로 연결되었습니다.`;
    await postToSlackViaProxy(webhookUrl, { text });
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
): Promise<void> {
  const text = buildSlackMessage(courseName, degr, date, students, undefined, undefined, defenseRate);
  await postToSlackViaProxy(webhookUrl, { text });
}
