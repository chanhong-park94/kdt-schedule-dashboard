/**
 * HRD Slack 알림 스케줄러
 *
 * 브라우저가 열려있는 동안 매 분마다 체크하여
 * 지정된 시간(평일)에 자동으로 Slack 리포트를 전송합니다.
 */
import { loadHrdConfig, saveHrdConfig } from "./hrdConfig";
import { sendSlackReportDirect } from "./hrdSlack";
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import type { AttendanceStudent, HrdCourse, HrdConfig, HrdRawTrainee, HrdRawAttendance, RiskLevel } from "./hrdTypes";
import { DEFAULT_SLACK_SCHEDULE, isAbsentStatus, isAttendedStatus, isExcusedStatus } from "./hrdTypes";

let intervalId: ReturnType<typeof setInterval> | null = null;
let statusCallback: ((msg: string, type: "info" | "success" | "error") => void) | null = null;

/** NaN-safe hour/minute from schedule config */
function safeHour(h: number): number { return Number.isFinite(h) ? h : DEFAULT_SLACK_SCHEDULE.hour; }
function safeMinute(m: number): number { return Number.isFinite(m) ? m : DEFAULT_SLACK_SCHEDULE.minute; }

// ─── 유틸 ────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isWeekday(): boolean {
  const day = new Date().getDay();
  return day >= 1 && day <= 5;
}

function nowHHMM(): { hour: number; minute: number } {
  const d = new Date();
  return { hour: d.getHours(), minute: d.getMinutes() };
}

// ─── 출결 데이터 자체 처리 (hrdAttendance.ts에서 독립) ──────

function normalizeName(raw: string): string {
  return (raw || "").replace(/\s+/g, "").trim();
}

function resolveStatus(raw: HrdRawAttendance): string {
  const stNm = (raw.atendSttusNm || "").trim();
  if (stNm) return stNm;
  return "-";
}

function formatTime(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "-";
  const s = raw.replace(/[^0-9]/g, "");
  if (s.length < 3) return "-";
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

function getRiskLevel(remainingAbsent: number, totalDays: number): RiskLevel {
  if (totalDays === 0) return "safe";
  if (remainingAbsent <= 0) return "danger";
  if (remainingAbsent <= 2) return "warning";
  if (remainingAbsent <= 5) return "caution";
  return "safe";
}

/**
 * 스케줄러용 출결 데이터 조회 + 가공
 * hrdAttendance.ts의 buildStudents 로직을 간소화하여 독립 실행
 */
async function fetchAttendanceForReport(
  config: HrdConfig,
  course: HrdCourse,
  degr: string,
  today: string,
): Promise<AttendanceStudent[]> {
  const month = today.replace(/-/g, "").slice(0, 6);

  // 명단 + 출결 병렬 조회
  const [roster, daily] = await Promise.all([
    fetchRoster(config, course.trainPrId, degr),
    fetchDailyAttendance(config, course.trainPrId, degr, month),
  ]);

  if (roster.length === 0) return [];

  // 이름별 일별 출결 기록 맵 구축
  const recordsMap = new Map<string, { status: string; inTime: string; outTime: string }[]>();
  for (const raw of daily) {
    const nm = normalizeName(raw.cstmrNm || raw.trneeCstmrNm || raw.trneNm || "");
    if (!nm) continue;
    if (!recordsMap.has(nm)) recordsMap.set(nm, []);
    recordsMap.get(nm)!.push({
      status: resolveStatus(raw),
      inTime: formatTime(raw.lpsilTime || raw.atendTmIn),
      outTime: formatTime(raw.levromTime || raw.atendTmOut),
    });
  }

  // 오늘 날짜 출결만 추출
  const todayRaw = today.replace(/-/g, "");
  const todayDaily = daily.filter((d) => ((d.atendDe || "").toString().replace(/[^0-9]/g, "")) === todayRaw);
  const todayMap = new Map<string, HrdRawAttendance>();
  for (const d of todayDaily) {
    const nm = normalizeName(d.cstmrNm || d.trneeCstmrNm || d.trneNm || "");
    if (nm) todayMap.set(nm, d);
  }

  // 학생별 AttendanceStudent 생성
  return roster.map((raw: HrdRawTrainee) => {
    const nm = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").trim();
    const key = normalizeName(nm);
    const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
    const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기");

    const todayData = todayMap.get(key);
    const status = todayData ? resolveStatus(todayData) : (dropout ? "중도탈락" : "-");
    const inTime = todayData ? formatTime(todayData.lpsilTime || todayData.atendTmIn) : "";
    const outTime = todayData ? formatTime(todayData.levromTime || todayData.atendTmOut) : "";

    const records = recordsMap.get(key) || [];
    const totalDays = course.totalDays || 0;
    const attendedDays = records.filter((r) => isAttendedStatus(r.status)).length;
    const absentDays = records.filter((r) => isAbsentStatus(r.status)).length;
    const excusedDays = records.filter((r) => isExcusedStatus(r.status)).length;
    const maxAbsent = totalDays > 0 ? Math.floor(totalDays * 0.2) : 0;
    const remainingAbsent = maxAbsent - absentDays;
    const effectiveDays = totalDays > 0 ? totalDays - excusedDays : (records.length || 1);
    const attendanceRate = effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : (totalDays === 0 ? 100 : 0);

    // 퇴실 미체크 판단
    const missingCheckout = !!(
      course.endTime &&
      status !== "결석" && status !== "-" && !dropout &&
      inTime && inTime !== "-" &&
      (!outTime || outTime === "-")
    );

    const brRaw = (raw.lifyeaMd || raw.trneBrdt || raw.trneRrno || "").toString().replace(/[^0-9]/g, "");
    let birth = "-";
    if (brRaw.length >= 8) birth = `${brRaw.slice(0, 4)}.${brRaw.slice(4, 6)}.${brRaw.slice(6, 8)}`;
    else if (brRaw.length >= 6) birth = `${brRaw.slice(0, 2)}.${brRaw.slice(2, 4)}.${brRaw.slice(4, 6)}`;

    return {
      name: nm,
      birth,
      status,
      inTime,
      outTime,
      dropout,
      riskLevel: getRiskLevel(remainingAbsent, totalDays),
      totalDays,
      attendedDays,
      absentDays,
      excusedDays,
      maxAbsent,
      remainingAbsent,
      attendanceRate,
      missingCheckout,
    } as AttendanceStudent;
  });
}

// ─── 스케줄 체크 로직 ────────────────────────────────────────

async function checkAndSend(): Promise<void> {
  const config = loadHrdConfig();
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;
  const webhookUrl = config.slackWebhookUrl;

  // 비활성화 또는 webhook 미설정
  if (!schedule.enabled || !webhookUrl) return;

  // 평일 체크
  if (schedule.weekdaysOnly && !isWeekday()) return;

  // 시간 체크
  const { hour, minute } = nowHHMM();
  if (hour !== safeHour(schedule.hour) || minute !== safeMinute(schedule.minute)) return;

  // 오늘 이미 전송 완료
  const today = todayStr();
  if (schedule.lastSentDate === today) return;

  // ─── 자동 전송 시작 ─────
  emitStatus("⏳ 자동 알림 전송 중...", "info");
  console.log(`[Scheduler] Auto-send triggered at ${hour}:${String(minute).padStart(2, "0")}`);

  // 대상 과정 결정
  const courses = config.courses.filter(c => {
    if (schedule.targetCourses.length === 0) return true;
    return schedule.targetCourses.includes(c.trainPrId);
  });

  if (courses.length === 0) {
    emitStatus("⚠️ 전송할 대상 과정이 없습니다", "error");
    return;
  }

  let sentCount = 0;
  let failCount = 0;

  for (const course of courses) {
    // 각 과정의 최신 기수만 전송
    const latestDegr = course.degrs[course.degrs.length - 1] || "1";
    try {
      const students = await fetchAttendanceForReport(config, course, latestDegr, today);
      // 관리대상(위험+경고+주의+퇴실미체크)만 있을 때 전송
      const riskStudents = students.filter(s => !s.dropout && (
        s.riskLevel === "danger" || s.riskLevel === "warning" || s.riskLevel === "caution" || s.missingCheckout
      ));
      if (riskStudents.length === 0 && students.length === 0) continue;

      await sendSlackReportDirect(webhookUrl, course.name, latestDegr, today, students);
      sentCount++;
      console.log(`[Scheduler] Sent report for ${course.name} ${latestDegr}차`);
    } catch (e) {
      failCount++;
      console.error(`[Scheduler] Failed for ${course.name}:`, e);
    }
  }

  // 전송 완료 기록
  schedule.lastSentDate = today;
  config.slackSchedule = schedule;
  saveHrdConfig(config);

  // 마지막 전송 시간 업데이트
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (failCount === 0 && sentCount > 0) {
    emitStatus(`✅ ${today} ${timeStr} — ${sentCount}개 과정 전송 완료`, "success");
  } else if (sentCount > 0) {
    emitStatus(`⚠️ ${today} ${timeStr} — 성공 ${sentCount} / 실패 ${failCount}`, "error");
  } else {
    emitStatus(`ℹ️ ${today} ${timeStr} — 전송할 데이터 없음`, "info");
  }
}

// ─── 상태 콜백 ───────────────────────────────────────────────

function emitStatus(msg: string, type: "info" | "success" | "error"): void {
  if (statusCallback) statusCallback(msg, type);
  // UI 업데이트: 마지막 전송 표시
  const el = document.getElementById("slackScheduleStatus");
  if (el) {
    el.textContent = msg;
    el.className = `slack-schedule-status slack-schedule-${type}`;
  }
}

// ─── 공개 API ────────────────────────────────────────────────

/**
 * 스케줄러 시작 — 매 분마다 체크
 */
export function startScheduler(
  onStatus?: (msg: string, type: "info" | "success" | "error") => void,
): void {
  if (intervalId) return; // 이미 실행 중
  statusCallback = onStatus ?? null;

  // 초기 상태 표시
  const config = loadHrdConfig();
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;
  if (schedule.enabled) {
    const lastSent = schedule.lastSentDate;
    const timeStr = `${String(safeHour(schedule.hour)).padStart(2, "0")}:${String(safeMinute(schedule.minute)).padStart(2, "0")}`;
    if (lastSent === todayStr()) {
      emitStatus(`✅ 오늘 ${timeStr} 전송 완료`, "success");
    } else {
      emitStatus(`⏰ 매일 ${timeStr} 자동 전송 예약됨`, "info");
    }
  }

  // 60초마다 체크
  intervalId = setInterval(() => {
    checkAndSend().catch(e => {
      console.error("[Scheduler] Unexpected error:", e);
    });
  }, 60_000);

  // 시작 직후 1회 체크
  checkAndSend().catch(e => {
    console.error("[Scheduler] Initial check error:", e);
  });

  console.log("[Scheduler] Started — checking every 60s");
}

/**
 * 스케줄러 정지
 */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[Scheduler] Stopped");
  }
}

/**
 * 스케줄러 재시작 (설정 변경 후 호출)
 */
export function restartScheduler(): void {
  stopScheduler();
  startScheduler(statusCallback ?? undefined);
}

/**
 * 현재 스케줄 설정 상태 요약 텍스트
 */
export function getScheduleSummary(): string {
  const config = loadHrdConfig();
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;
  if (!schedule.enabled) return "비활성화";
  const timeStr = `${String(safeHour(schedule.hour)).padStart(2, "0")}:${String(safeMinute(schedule.minute)).padStart(2, "0")}`;
  const dayStr = schedule.weekdaysOnly ? "평일" : "매일";
  return `${dayStr} ${timeStr} 자동 전송`;
}
