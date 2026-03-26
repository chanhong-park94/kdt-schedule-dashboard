/**
 * HRD Slack 알림 스케줄러
 *
 * 브라우저가 열려있는 동안 매 분마다 체크하여
 * 지정된 시간(평일)에 자동으로 Slack 리포트를 전송합니다.
 */
import { loadHrdConfig, saveHrdConfig } from "./hrdConfig";
import { sendSlackReportDirect, buildConsolidatedSlackMessage } from "./hrdSlack";
import type { CourseReportData } from "./hrdSlack";
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import { fetchPublicHolidaysKR } from "../core/holidays";
import type { AttendanceStudent, HrdCourse, HrdConfig, HrdRawTrainee, HrdRawAttendance, RiskLevel } from "./hrdTypes";
import { DEFAULT_SLACK_SCHEDULE, isAbsentStatus, isAttendedStatus, isExcusedStatus } from "./hrdTypes";

let intervalId: ReturnType<typeof setInterval> | null = null;
let statusCallback: ((msg: string, type: "info" | "success" | "error") => void) | null = null;

/** NaN-safe hour/minute from schedule config */
function safeHour(h: number): number {
  return Number.isFinite(h) ? h : DEFAULT_SLACK_SCHEDULE.hour;
}
function safeMinute(m: number): number {
  return Number.isFinite(m) ? m : DEFAULT_SLACK_SCHEDULE.minute;
}

// ─── 유틸 ────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isWeekday(): boolean {
  const day = new Date().getDay();
  return day >= 1 && day <= 5;
}

/** 과정 유형별 수업 요일 판단 */
function isClassDayOfWeek(dayOfWeek: number, category?: string): boolean {
  if (category === "재직자") {
    // 재직자: 화~토 (Tue=2 ~ Sat=6)
    return dayOfWeek >= 2 && dayOfWeek <= 6;
  }
  // 실업자(기본): 월~금 (Mon=1 ~ Fri=5)
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/** 특정 날짜가 해당 과정 유형의 수업일인지 (요일 + 공휴일 체크) */
async function isClassDayForCategory(dateStr: string, category?: string): Promise<boolean> {
  const d = new Date(dateStr);
  const day = d.getDay();
  if (!isClassDayOfWeek(day, category)) return false;
  // 공휴일 체크
  try {
    const year = d.getFullYear();
    const holidays = await fetchPublicHolidaysKR(year);
    if (holidays.some((h) => h.date === dateStr)) return false;
  } catch {
    // 공휴일 API 실패 시 요일만으로 판단
  }
  return true;
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 과정 유형별 가장 최근 수업일 찾기 (어제부터 역순 탐색, 최대 7일)
 * - 실업자(기본): 월~금 중 공휴일 아닌 가장 최근 날짜
 * - 재직자: 화~토 중 공휴일 아닌 가장 최근 날짜
 */
async function findLastClassDay(category?: string): Promise<string | null> {
  const now = new Date();
  for (let i = 1; i <= 7; i++) {
    const check = new Date(now);
    check.setDate(check.getDate() - i);
    const dateStr = formatDateStr(check);
    if (await isClassDayForCategory(dateStr, category)) {
      return dateStr;
    }
  }
  return null;
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
  const maxAbsent = Math.floor(totalDays * 0.2);
  if (maxAbsent === 0) return "safe";
  const remainRate = remainingAbsent / maxAbsent;
  if (remainRate <= 0.15) return "danger";
  if (remainRate <= 0.30) return "warning";
  if (remainRate <= 0.60) return "caution";
  return "safe";
}

/**
 * 스케줄러용 출결 데이터 조회 + 가공
 * hrdAttendance.ts의 buildStudents 로직을 간소화하여 독립 실행
 * @param targetDate - 출결 조회 대상 날짜 (YYYY-MM-DD) — 전일 출결 발송을 위해 분리
 */
async function fetchAttendanceForReport(
  config: HrdConfig,
  course: HrdCourse,
  degr: string,
  targetDate: string,
): Promise<AttendanceStudent[]> {
  const month = targetDate.replace(/-/g, "").slice(0, 6);

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

  // 대상 날짜 출결만 추출
  const targetRaw = targetDate.replace(/-/g, "");
  const targetDaily = daily.filter((d) => (d.atendDe || "").toString().replace(/[^0-9]/g, "") === targetRaw);
  const todayMap = new Map<string, HrdRawAttendance>();
  for (const d of targetDaily) {
    const nm = normalizeName(d.cstmrNm || d.trneeCstmrNm || d.trneNm || "");
    if (nm) todayMap.set(nm, d);
  }

  // 학생별 AttendanceStudent 생성
  return roster.map((raw: HrdRawTrainee) => {
    const nm = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").trim();
    const key = normalizeName(nm);
    const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
    const graduated =
      stNm.includes("80%이상수료") || stNm.includes("정상수료") || stNm.includes("수료후취업");
    const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기") || stNm.includes("조기취업");
    const traineeStatus = graduated ? "수료" as const : dropout ? "하차" as const : "훈련중" as const;

    const todayData = todayMap.get(key);
    const status = todayData ? resolveStatus(todayData) : dropout ? "중도탈락" : graduated ? "수료" : "-";
    const inTime = todayData ? formatTime(todayData.lpsilTime || todayData.atendTmIn) : "";
    const outTime = todayData ? formatTime(todayData.levromTime || todayData.atendTmOut) : "";

    const records = recordsMap.get(key) || [];
    const totalDays = course.totalDays || 0;
    const attendedDays = records.filter((r) => isAttendedStatus(r.status)).length;
    const absentDays = records.filter((r) => isAbsentStatus(r.status)).length;
    const excusedDays = records.filter((r) => isExcusedStatus(r.status)).length;
    const maxAbsent = totalDays > 0 ? Math.floor(totalDays * 0.2) : 0;
    const remainingAbsent = maxAbsent - absentDays;
    const effectiveDays = totalDays > 0 ? totalDays - excusedDays : records.length || 1;
    const attendanceRate = effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : totalDays === 0 ? 100 : 0;

    // 퇴실 미체크 판단
    const missingCheckout = !!(
      course.endTime &&
      status !== "결석" &&
      status !== "-" &&
      !dropout &&
      inTime &&
      inTime !== "-" &&
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
      traineeStatus,
      riskLevel: getRiskLevel(remainingAbsent, totalDays),
      totalDays,
      attendedDays,
      absentDays,
      excusedDays,
      maxAbsent,
      remainingAbsent,
      attendanceRate,
      missingCheckout,
      gender: "",
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
  console.warn(`[Scheduler] Auto-send triggered at ${hour}:${String(minute).padStart(2, "0")}`);

  // 대상 과정 결정 — 운영중인 과정만 필터 + 최근 개강순 정렬
  const allCourses = config.courses.filter((c) => {
    if (schedule.targetCourses.length === 0) return true;
    return schedule.targetCourses.includes(c.trainPrId);
  });

  // 운영중 판별: 종강 확인된 과정만 제외, 날짜 미설정은 포함
  const activeCourses = allCourses
    .filter((c) => {
      if (!c.startDate || !c.totalDays) return true; // 날짜 정보 없으면 포함
      const now = new Date();
      const end = new Date(c.startDate);
      end.setDate(end.getDate() + Math.ceil((c.totalDays / 5) * 7));
      return end >= now; // 종강일이 지난 과정만 제외
    })
    .sort((a, b) => {
      // 최근 개강 순 (내림차순)
      const dateA = a.startDate || "0000-00-00";
      const dateB = b.startDate || "0000-00-00";
      return dateB.localeCompare(dateA);
    });

  if (activeCourses.length === 0) {
    emitStatus("⚠️ 현재 운영중인 과정이 없습니다", "error");
    return;
  }

  // ─── 전 과정 데이터 수집 → 통합 메시지 1건 전송 ─────
  const reportEntries: CourseReportData[] = [];
  let failCount = 0;

  for (const course of activeCourses) {
    const reportDate = await findLastClassDay(course.category);
    if (!reportDate) {
      console.warn(`[Scheduler] Skipped ${course.name} — 최근 7일 내 수업일 없음`);
      continue;
    }

    for (const degr of course.degrs) {
      try {
        // 먼저 명단 조회 → 훈련상태로 종강 기수 필터
        const roster = await fetchRoster(config, course.trainPrId, degr);
        if (roster.length === 0) {
          console.warn(`[Scheduler] Skipped ${course.name} ${degr}기 — 명단 없음`);
          continue;
        }

        // HRD 명단 훈련상태로 훈련중 기수 판별
        const hasTraining = roster.some((r) => {
          const st = (r.trneeSttusNm || r.atendSttsNm || r.stttsCdNm || "").toString().trim();
          return st === "" || st.includes("훈련중") || st.includes("참여중");
        });
        if (!hasTraining) {
          console.warn(`[Scheduler] Skipped ${course.name} ${degr}기 — 종강/수료 기수`);
          continue;
        }

        const students = await fetchAttendanceForReport(config, course, degr, reportDate);
        if (students.length === 0) {
          console.warn(`[Scheduler] Skipped ${course.name} ${degr}기 — 출결 데이터 없음`);
          continue;
        }
        const activeStudents = students.filter((s) => !s.dropout);
        if (activeStudents.length === 0) {
          console.warn(`[Scheduler] Skipped ${course.name} ${degr}기 — 훈련중 학생 없음`);
          continue;
        }

        const total = students.length;
        const dropoutCount = students.filter((s) => s.dropout).length;
        const activeCount = total - dropoutCount;
        const defenseRate = total > 0 ? (activeCount / total) * 100 : 100;

        // 매니저 ID 조회
        const managerIds = schedule.courseManagers ? (schedule.courseManagers[course.trainPrId] ?? "") : "";

        reportEntries.push({
          courseName: course.name,
          degr,
          date: reportDate,
          students,
          defenseRate,
          managerIds,
        });
        console.warn(
          `[Scheduler] Collected ${course.name} ${degr}기 (${reportDate}, ${course.category || "실업자"})`,
        );
      } catch (e) {
        failCount++;
        console.error(`[Scheduler] Failed for ${course.name} ${degr}기:`, e);
      }
    }
  }

  // 통합 메시지 전송 (1건)
  let sentCount = 0;
  if (reportEntries.length > 0) {
    try {
      const text = buildConsolidatedSlackMessage(reportEntries);
      await sendSlackReportDirect(webhookUrl, "", "", "", [], undefined, undefined, undefined, text);
      sentCount = reportEntries.length;
      console.warn(`[Scheduler] Sent consolidated report — ${sentCount}개 기수 통합`);
    } catch (e) {
      failCount += reportEntries.length;
      console.error(`[Scheduler] Consolidated send failed:`, e);
    }
  }

  // 전송 완료 기록
  schedule.lastSentDate = today;
  config.slackSchedule = schedule;
  saveHrdConfig(config);

  // 마지막 전송 시간 업데이트
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (failCount === 0 && sentCount > 0) {
    emitStatus(`✅ ${today} ${timeStr} — ${sentCount}개 기수 전송 완료`, "success");
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
export function startScheduler(onStatus?: (msg: string, type: "info" | "success" | "error") => void): void {
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
    checkAndSend().catch((e) => {
      console.error("[Scheduler] Unexpected error:", e);
    });
  }, 60_000);

  // 시작 직후 1회 체크
  checkAndSend().catch((e) => {
    console.error("[Scheduler] Initial check error:", e);
  });

  console.warn("[Scheduler] Started — checking every 60s");
}

/**
 * 스케줄러 정지
 */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.warn("[Scheduler] Stopped");
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
