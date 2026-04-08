/** HRD 출결현황 대시보드 */
import { classifyApiError } from "./hrdCacheUtils";
import {
  getAssistantSession,
  loadAssistantCodes,
  saveAssistantCode,
  removeAssistantCode,
  validateAssistantCode,
} from "../auth/assistantAuth";
import { Chart, registerables } from "chart.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { fetchRoster, fetchDailyAttendance, testConnection, discoverDegrs } from "./hrdApi";
import { loadHrdConfig, saveHrdConfig, DEFAULT_COURSES } from "./hrdConfig";
import type {
  HrdRawTrainee,
  HrdRawAttendance,
  HrdConfig,
  HrdCourse,
  AttendanceStudent,
  AttendanceMetrics,
  AttendanceStatus,
  AttendanceDayRecord,
  RiskLevel,
  WeeklyTrend,
  DayPattern,
  SlackScheduleConfig,
  TraineeGender,
} from "./hrdTypes";
import {
  ATTENDANCE_STATUS_CODE,
  isAbsentStatus,
  isAttendedStatus,
  isExcusedStatus,
  calcAbsentDays,
  DEFAULT_SLACK_SCHEDULE,
} from "./hrdTypes";
import { sendSlackReport, testSlackWebhook, sendSlackReportDirect } from "./hrdSlack";
import { startScheduler, restartScheduler } from "./hrdScheduler";

Chart.register(...registerables);

// ─── Supabase Client (성별 저장용) ──────────────────────────
const _sbUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const _sbKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const _sbUrlStr = typeof _sbUrl === "string" ? _sbUrl.trim() : "";
const _sbKeyStr = typeof _sbKey === "string" ? _sbKey.trim() : "";
const sbClient: SupabaseClient | null =
  _sbUrlStr.length > 0 && _sbKeyStr.length > 0
    ? createClient(_sbUrlStr, _sbKeyStr, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      })
    : null;

const GENDER_TABLE = "trainee_gender";
const genderCache: Map<string, TraineeGender> = new Map(); // "trainPrId|degr|name" → gender

function genderKey(trainPrId: string, degr: string, name: string): string {
  return `${trainPrId}|${degr}|${name}`;
}

async function loadGenderData(trainPrId: string, degr: string): Promise<void> {
  if (!sbClient) return;
  try {
    const { data } = await sbClient
      .from(GENDER_TABLE)
      .select("trainee_name, gender")
      .eq("train_pr_id", trainPrId)
      .eq("degr", degr);
    if (data) {
      for (const row of data) {
        genderCache.set(genderKey(trainPrId, degr, row.trainee_name), (row.gender || "") as TraineeGender);
      }
    }
  } catch (e) {
    console.warn("[Gender] 로드 실패:", e);
  }
}

async function saveGender(trainPrId: string, degr: string, name: string, gender: TraineeGender): Promise<void> {
  if (!sbClient) return;
  genderCache.set(genderKey(trainPrId, degr, name), gender);
  try {
    await sbClient
      .from(GENDER_TABLE)
      .upsert(
        { train_pr_id: trainPrId, degr, trainee_name: name, gender },
        { onConflict: "train_pr_id,degr,trainee_name" },
      );
  } catch (e) {
    console.warn("[Gender] 저장 실패:", e);
  }
}

// ─── State ──────────────────────────────────────────────────
let currentStudents: AttendanceStudent[] = [];
let allDailyRecords: Map<string, AttendanceDayRecord[]> = new Map(); // name → records
let chartInstances: Chart[] = [];
let currentConfig: HrdConfig = loadHrdConfig();

// ─── 전체 훈련기간 출결 조회 (개강~종강 누적) ────────────────

/**
 * 과정/기수의 전체 훈련기간 출결 데이터를 조회합니다.
 * startDate가 있으면 개강월부터, 없으면 totalDays 역산으로 추정.
 * 종강 기수도 정확한 누적 결석을 계산할 수 있습니다.
 */
async function fetchFullPeriodAttendance(
  config: HrdConfig,
  trainPrId: string,
  degr: string,
  course: HrdCourse | undefined,
): Promise<HrdRawAttendance[]> {
  const now = new Date();
  const months: string[] = [];

  let startMonth: Date;
  if (course?.startDate) {
    startMonth = new Date(course.startDate);
  } else {
    // totalDays 역산: 수업일수 ÷ 5 × 7 = 캘린더일 + 여유 2개월
    const td = course?.totalDays || 120;
    const calendarDays = Math.ceil(td / 5) * 7 + 60; // 여유 2개월 추가
    startMonth = new Date(now);
    startMonth.setDate(startMonth.getDate() - calendarDays);
  }

  const cursor = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
  while (cursor <= now) {
    months.push(`${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const allDaily: HrdRawAttendance[] = [];
  for (const m of months) {
    try {
      const records = await fetchDailyAttendance(config, trainPrId, degr, m);
      allDaily.push(...records);
    } catch {
      // 개별 월 실패 무시 (해당 월에 데이터 없을 수 있음)
    }
  }
  return allDaily;
}

// ─── DOM Helpers ────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

function destroyCharts(): void {
  chartInstances.forEach((c) => c.destroy());
  chartInstances = [];
}

// ─── Data Transform ─────────────────────────────────────────

function normalizeName(raw: string): string {
  return (raw || "").replace(/\s+/g, "").trim();
}

function normalizeTrainee(raw: HrdRawTrainee): {
  name: string;
  birth: string;
  dropout: boolean;
  traineeStatus: import("./hrdTypes").TraineeStatus;
  hrdStatusRaw: string;
} {
  const nm = raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-";
  const br = (raw.lifyeaMd || raw.trneBrdt || raw.trneRrno || "").toString().replace(/[^0-9]/g, "");
  let birth = "-";
  if (br.length >= 8) birth = `${br.slice(0, 4)}.${br.slice(4, 6)}.${br.slice(6, 8)}`;
  else if (br.length >= 6) birth = `${br.slice(0, 2)}.${br.slice(2, 4)}.${br.slice(4, 6)}`;
  const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
  const hrdStatusRaw = stNm.trim() || "훈련중";

  // 조기취업은 출석률에 따라 분기 → buildStudents에서 최종 결정
  const isEarlyEmployment = stNm.includes("조기취업");
  // 수료 상태
  const graduated =
    stNm.includes("80%이상수료") || stNm.includes("정상수료") || stNm.includes("수료후취업");
  // 하차 상태 (부정적 이탈만)
  const isDropout =
    stNm.includes("중도탈락") || stNm.includes("수료포기");

  // 조기취업은 일단 "조기취업" 상태로 → buildStudents에서 출석률 70% 기준 분기
  let traineeStatus: import("./hrdTypes").TraineeStatus;
  let dropout = false;
  if (isEarlyEmployment) {
    traineeStatus = "조기취업";
    dropout = false; // buildStudents에서 출석률 기반으로 재결정
  } else if (graduated) {
    traineeStatus = "수료";
  } else if (isDropout) {
    traineeStatus = "하차";
    dropout = true;
  } else {
    traineeStatus = "훈련중";
  }

  return { name: nm.trim(), birth, dropout, traineeStatus, hrdStatusRaw };
}

function resolveStatus(raw: HrdRawAttendance): AttendanceStatus {
  // API 원본 상태명을 그대로 보존 (복합 상태 지원: 외출&조퇴, 지각&조퇴 등)
  const stNm = (raw.atendSttusNm || "").trim();
  if (stNm) return stNm;
  const cd = raw.atendSttusCd || "";
  return ATTENDANCE_STATUS_CODE[cd] || "-";
}

function formatTime(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "-";
  const s = raw.replace(/[^0-9]/g, "");
  if (s.length < 3) return "-";
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

/** 잔여 허용 결석일수 기반 위험등급 — 비율 기반 (maxAbsent 대비 잔여 비율) */
function getRiskLevel(remainingAbsent: number, totalDays: number): RiskLevel {
  if (totalDays === 0) return "safe"; // 설정 미완료
  const maxAbsent = Math.floor(totalDays * 0.2);
  if (maxAbsent === 0) return "safe";
  const remainRate = remainingAbsent / maxAbsent;
  if (remainRate <= 0.15) return "danger"; // 제적위험: 잔여 ≤15%
  if (remainRate <= 0.30) return "warning"; // 경고: 잔여 ≤30%
  if (remainRate <= 0.60) return "caution"; // 주의: 잔여 ≤60%
  return "safe";
}

function getRiskLabel(level: RiskLevel): string {
  switch (level) {
    case "safe":
      return "안전";
    case "caution":
      return "주의";
    case "warning":
      return "경고";
    case "danger":
      return "위험";
  }
}

function getRiskEmoji(level: RiskLevel): string {
  switch (level) {
    case "safe":
      return "🟢";
    case "caution":
      return "🟡";
    case "warning":
      return "🟠";
    case "danger":
      return "🔴";
  }
}

function isMissingCheckout(student: AttendanceStudent, course: HrdCourse | undefined): boolean {
  if (!course || !course.endTime || student.status === "결석" || student.status === "-") return false;
  if (student.outTime && student.outTime !== "-") return false;
  if (student.inTime && student.inTime !== "-") return true;
  return false;
}

// ─── Build Students from API data ───────────────────────────

function buildStudents(
  roster: HrdRawTrainee[],
  dailyRecords: HrdRawAttendance[],
  selectedDate: string,
  course: HrdCourse | undefined,
  trainPrId?: string,
  degr?: string,
): AttendanceStudent[] {
  let dayData: HrdRawAttendance[];
  if (selectedDate.startsWith("week:")) {
    // 주간 필터: 선택 날짜가 속한 월~금 범위
    const baseDate = selectedDate.slice(5);
    const { start, end } = getWeekRange(baseDate);
    const startNum = start.replace(/-/g, "");
    const endNum = end.replace(/-/g, "");
    dayData = dailyRecords.filter((d) => {
      const de = (d.atendDe || "").toString().replace(/[^0-9]/g, "");
      return de >= startNum && de <= endNum;
    });
  } else {
    const dayStr = selectedDate.replace(/[^0-9]/g, "");
    dayData = dayStr
      ? dailyRecords.filter((d) => (d.atendDe || "").toString().replace(/[^0-9]/g, "") === dayStr)
      : dailyRecords;
  }

  const dailyMap = new Map<string, HrdRawAttendance>();
  for (const d of dayData) {
    const nm = normalizeName(d.cstmrNm || d.trneeCstmrNm || d.trneNm || "");
    if (nm) dailyMap.set(nm, d);
  }

  return roster.map((raw) => {
    const t = normalizeTrainee(raw);
    const key = normalizeName(t.name);
    const daily = dailyMap.get(key);

    const status: AttendanceStatus = daily
      ? resolveStatus(daily)
      : (t.traineeStatus !== "훈련중")
        ? t.hrdStatusRaw
        : "-";
    const inTime = daily ? formatTime(daily.lpsilTime || daily.atendTmIn) : "";
    const outTime = daily ? formatTime(daily.levromTime || daily.atendTmOut) : "";

    // 누적 출결 통계 계산 (전체 훈련일수 기반)
    const records = allDailyRecords.get(key) || [];
    const totalDays = course?.totalDays || 0;
    const attendedDays = records.filter((r) => isAttendedStatus(r.status)).length;
    // HRD-Net 기준: 순수결석 + 지각3회=1결석 + 조퇴3회=1결석
    const absentDays = calcAbsentDays(records);
    const excusedDays = records.filter((r) => isExcusedStatus(r.status)).length;
    const maxAbsent = totalDays > 0 ? Math.floor(totalDays * 0.2) : 0;
    const remainingAbsent = maxAbsent - absentDays;

    // 출석률: 출석인정일 / (전체훈련일 - 공결일) * 100
    const effectiveDays = totalDays > 0 ? totalDays - excusedDays : records.length || 1;
    const attendanceRate = effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : totalDays === 0 ? 100 : 0;

    // 조기취업: 출석률 70% 이상 → 수료(조기취업), 미만 → 하차(미수료 조기취업)
    let finalTraineeStatus = t.traineeStatus;
    let finalDropout = t.dropout;
    if (t.traineeStatus === "조기취업") {
      if (attendanceRate >= 70) {
        finalDropout = false; // 정상 조기취업 = 수료 취급
      } else {
        finalDropout = true; // 미수료 조기취업 = 하차 취급
      }
    }

    const student: AttendanceStudent = {
      name: t.name,
      birth: t.birth,
      status,
      inTime,
      outTime,
      dropout: finalDropout,
      traineeStatus: finalTraineeStatus,
      hrdStatusRaw: t.hrdStatusRaw,
      riskLevel: getRiskLevel(remainingAbsent, totalDays),
      totalDays,
      attendedDays,
      absentDays,
      excusedDays,
      maxAbsent,
      remainingAbsent,
      attendanceRate,
      missingCheckout: false,
      gender: ((trainPrId && degr ? genderCache.get(genderKey(trainPrId, degr, t.name)) : "") as TraineeGender) || "",
    };
    student.missingCheckout = isMissingCheckout(student, course);
    return student;
  });
}

// ─── Build cumulative records ───────────────────────────────

function buildAllDailyRecords(dailyRecords: HrdRawAttendance[]): Map<string, AttendanceDayRecord[]> {
  const map = new Map<string, AttendanceDayRecord[]>();
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

  for (const raw of dailyRecords) {
    const nm = normalizeName(raw.cstmrNm || raw.trneeCstmrNm || raw.trneNm || "");
    if (!nm) continue;
    const dateRaw = (raw.atendDe || "").toString().replace(/[^0-9]/g, "");
    if (dateRaw.length < 8) continue;
    const dateStr = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    const d = new Date(dateStr);
    const dow = dayNames[d.getDay()] || "";

    const record: AttendanceDayRecord = {
      date: dateStr,
      dayOfWeek: dow,
      status: resolveStatus(raw),
      inTime: formatTime(raw.lpsilTime || raw.atendTmIn),
      outTime: formatTime(raw.levromTime || raw.atendTmOut),
    };

    if (!map.has(nm)) map.set(nm, []);
    map.get(nm)!.push(record);
  }

  // Sort records by date
  for (const [, records] of map) {
    records.sort((a, b) => a.date.localeCompare(b.date));
  }

  return map;
}

// ─── Metrics ────────────────────────────────────────────────

function calculateMetrics(students: AttendanceStudent[]): AttendanceMetrics {
  const active = students.filter((s) => !s.dropout);
  const total = active.length;
  const present = active.filter((s) => s.status === "출석").length;
  const late = active.filter((s) => s.status.includes("지각")).length;
  const absent = active.filter((s) => isAbsentStatus(s.status)).length;
  const earlyLeave = active.filter((s) => s.status.includes("조퇴") || s.status.includes("외출")).length;
  const excused = active.filter((s) => isExcusedStatus(s.status)).length;
  const riskCount = active.filter((s) => s.riskLevel === "danger" || s.riskLevel === "warning").length;
  const missingCheckout = active.filter((s) => s.missingCheckout).length;
  const responded = active.filter((s) => isAttendedStatus(s.status) || isExcusedStatus(s.status)).length;
  const attendanceRate = total > 0 ? (responded / total) * 100 : 0;

  return { total, present, late, absent, earlyLeave, excused, attendanceRate, riskCount, missingCheckout };
}

// ─── Weekly Trend ───────────────────────────────────────────

function calculateWeeklyTrends(): WeeklyTrend[] {
  // Aggregate all student records by week
  const weekMap = new Map<string, { present: number; total: number }>();
  for (const [, records] of allDailyRecords) {
    for (const rec of records) {
      const d = new Date(rec.date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay() + 1); // Monday
      const key = weekStart.toISOString().slice(0, 10);
      if (!weekMap.has(key)) weekMap.set(key, { present: 0, total: 0 });
      const w = weekMap.get(key)!;
      w.total++;
      if (isAttendedStatus(rec.status)) w.present++;
    }
  }

  const sorted = Array.from(weekMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([weekStart, data], i) => ({
    weekLabel: `${i + 1}주차`,
    weekStart,
    attendanceRate: data.total > 0 ? (data.present / data.total) * 100 : 0,
    presentCount: data.present,
    totalCount: data.total,
  }));
}

// ─── Day Pattern ────────────────────────────────────────────

function calculateDayPatterns(): DayPattern[] {
  const course = getSelectedCourse();
  const isResident = course?.category === "재직자";
  // 재직자: 화~토, 실업자: 월~금
  const days = isResident ? ["화", "수", "목", "금", "토"] : ["월", "화", "수", "목", "금"];
  const stats = new Map<string, { late: number; absent: number; total: number }>();
  for (const d of days) stats.set(d, { late: 0, absent: 0, total: 0 });

  for (const [, records] of allDailyRecords) {
    for (const rec of records) {
      const s = stats.get(rec.dayOfWeek);
      if (!s) continue;
      s.total++;
      if (rec.status.includes("지각")) s.late++;
      if (isAbsentStatus(rec.status)) s.absent++;
    }
  }

  return days.map((day) => {
    const s = stats.get(day)!;
    return {
      day,
      lateRate: s.total > 0 ? (s.late / s.total) * 100 : 0,
      absentRate: s.total > 0 ? (s.absent / s.total) * 100 : 0,
      totalDays: s.total,
    };
  });
}

// ─── Render Functions ───────────────────────────────────────

function renderMetrics(metrics: AttendanceMetrics): void {
  const set = (id: string, val: string | number) => {
    const el = $(id);
    if (el) el.textContent = String(val);
  };
  set("attTotal", metrics.total);
  set("attPresent", metrics.present);
  set("attLate", metrics.late);
  set("attAbsent", metrics.absent);
  set("attEarlyLeave", metrics.earlyLeave);
  set("attRate", `${metrics.attendanceRate.toFixed(1)}%`);
  set("attRisk", metrics.riskCount);
  set("attMissing", metrics.missingCheckout);

  // Progress bars
  const bars: [string, number][] = [
    ["attBarPresent", metrics.total > 0 ? (metrics.present / metrics.total) * 100 : 0],
    ["attBarLate", metrics.total > 0 ? (metrics.late / metrics.total) * 100 : 0],
    ["attBarAbsent", metrics.total > 0 ? (metrics.absent / metrics.total) * 100 : 0],
    ["attBarRate", metrics.attendanceRate],
  ];
  for (const [id, pct] of bars) {
    const el = $(id) as HTMLElement | null;
    if (el) el.style.width = `${Math.min(pct, 100)}%`;
  }
}

function getStatusChipClass(status: AttendanceStatus): string {
  if (!status || status === "-") return "att-chip-default";
  if (status === "출석") return "att-chip-present";
  if (isAbsentStatus(status)) return "att-chip-absent";
  if (status.includes("지각")) return "att-chip-late";
  if (status.includes("조퇴") || status.includes("외출")) return "att-chip-early";
  if (isExcusedStatus(status)) return "att-chip-excused";
  if (status.includes("중도탈락")) return "att-chip-dropout";
  if (status === "수료") return "att-chip-graduated";
  return "att-chip-default";
}

function renderTable(students: AttendanceStudent[], searchTerm: string): void {
  const tbody = $("attTbody");
  if (!tbody) return;

  let filtered = students;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = students.filter((s) => s.name.toLowerCase().includes(term));
  }

  // Sort: 훈련중 (위험도순) → 수료 → 하차
  const statusOrder: Record<string, number> = { "훈련중": 0, "수료": 1, "조기취업": 2, "하차": 3 };
  filtered.sort((a, b) => {
    const stDiff = (statusOrder[a.traineeStatus] ?? 0) - (statusOrder[b.traineeStatus] ?? 0);
    if (stDiff !== 0) return stDiff;
    if (a.traineeStatus === "훈련중") {
      const riskOrder: Record<RiskLevel, number> = { danger: 0, warning: 1, caution: 2, safe: 3 };
      const diff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });

  tbody.innerHTML = filtered
    .map(
      (
        s,
        i,
      ) => `<tr class="${s.dropout ? "att-row-dropout" : ""} ${s.riskLevel === "danger" ? "att-row-danger" : s.riskLevel === "warning" ? "att-row-warning" : ""}">
    <td>${i + 1}</td>
    <td><span class="att-name-link" data-student="${s.name}">${s.name}</span></td>
    <td class="att-td-gender"><span class="att-gender-toggle" data-student="${s.name}" title="클릭하여 성별 변경">${s.gender ? (s.gender === "남" ? '<span class="att-gender-m">♂ 남</span>' : '<span class="att-gender-f">♀ 여</span>') : '<span class="att-gender-none">-</span>'}</span></td>
    <td class="att-td-birth">${s.birth}</td>
    <td><span class="att-chip ${getStatusChipClass(s.status)}">${s.status}</span>${s.missingCheckout ? ' <span class="att-chip att-chip-missing">⚠️ 퇴실미체크</span>' : ""}</td>
    <td class="att-td-time">${s.inTime || "-"}</td>
    <td class="att-td-time">${s.outTime || "-"}</td>
    <td>${s.totalDays > 0 ? `${s.absentDays}/${s.maxAbsent}일` : `${s.attendanceRate.toFixed(1)}%`}</td>
    <td>${s.traineeStatus === "하차" ? `<span class="att-risk-badge att-risk-ended">${s.hrdStatusRaw}</span>` : s.traineeStatus === "수료" ? `<span class="att-risk-badge att-risk-graduated">${s.hrdStatusRaw}</span>` : s.traineeStatus === "조기취업" ? `<span class="att-risk-badge ${s.dropout ? "att-risk-ended" : "att-risk-graduated"}">${s.hrdStatusRaw}${s.dropout ? " (미수료)" : ""}</span>` : `<span class="att-risk-badge att-risk-${s.riskLevel}">${getRiskEmoji(s.riskLevel)} ${getRiskLabel(s.riskLevel)}${s.totalDays > 0 && s.remainingAbsent > 0 ? ` (${s.remainingAbsent}일)` : ""}</span>`}</td>
  </tr>`,
    )
    .join("");

  // Table meta — 성별 통계 포함
  const genderM = filtered.filter((s) => s.gender === "남").length;
  const genderF = filtered.filter((s) => s.gender === "여").length;
  const genderNone = filtered.length - genderM - genderF;
  const meta = $("attTableMeta");
  if (meta) {
    let text = `총 ${filtered.length}명`;
    if (genderM > 0 || genderF > 0)
      text += ` (남 ${genderM} / 여 ${genderF}${genderNone > 0 ? ` / 미지정 ${genderNone}` : ""})`;
    if (searchTerm) text += ` — 검색: "${searchTerm}"`;
    meta.textContent = text;
  }

  // Attach name click events
  tbody.querySelectorAll(".att-name-link").forEach((el) => {
    el.addEventListener("click", () => {
      const name = (el as HTMLElement).dataset.student || "";
      openStudentDetail(name);
    });
  });

  // Attach gender toggle events
  tbody.querySelectorAll(".att-gender-toggle").forEach((el) => {
    el.addEventListener("click", async () => {
      const name = (el as HTMLElement).dataset.student || "";
      const student = currentStudents.find((s) => s.name === name);
      if (!student) return;
      const courseSelect = $("attFilterCourse") as HTMLSelectElement | null;
      const degrSelect = $("attFilterDegr") as HTMLSelectElement | null;
      const tid = courseSelect?.value || "";
      const deg = degrSelect?.value || "";
      if (!tid || !deg) return;

      // Cycle: "" → "남" → "여" → ""
      const next: TraineeGender = student.gender === "" ? "남" : student.gender === "남" ? "여" : "";
      student.gender = next;
      await saveGender(tid, deg, name, next);

      // Update display inline
      const inner =
        next === "남"
          ? '<span class="att-gender-m">♂ 남</span>'
          : next === "여"
            ? '<span class="att-gender-f">♀ 여</span>'
            : '<span class="att-gender-none">-</span>';
      (el as HTMLElement).innerHTML = inner;

      // Update meta
      const mCount = currentStudents.filter((s) => !s.dropout && s.gender === "남").length;
      const fCount = currentStudents.filter((s) => !s.dropout && s.gender === "여").length;
      const noneCount = currentStudents.filter((s) => !s.dropout).length - mCount - fCount;
      if (meta) {
        let text = `총 ${filtered.length}명`;
        if (mCount > 0 || fCount > 0)
          text += ` (남 ${mCount} / 여 ${fCount}${noneCount > 0 ? ` / 미지정 ${noneCount}` : ""})`;
        meta.textContent = text;
      }
    });
  });
}

function renderTrendChart(trends: WeeklyTrend[]): void {
  const canvas = $("attChartTrend") as HTMLCanvasElement | null;
  if (!canvas || trends.length === 0) return;

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: trends.map((t) => t.weekLabel),
      datasets: [
        {
          label: "출석률 (%)",
          data: trends.map((t) => Math.round(t.attendanceRate * 10) / 10),
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: "제적 기준선 (80%)",
          data: trends.map(() => 80),
          borderColor: "#ef4444",
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: "출석률 (%)" } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderPatternChart(patterns: DayPattern[]): void {
  const canvas = $("attChartPattern") as HTMLCanvasElement | null;
  if (!canvas || patterns.length === 0) return;

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: patterns.map((p) => p.day),
      datasets: [
        {
          label: "지각률 (%)",
          data: patterns.map((p) => Math.round(p.lateRate * 10) / 10),
          backgroundColor: "rgba(249,115,22,0.7)",
          borderRadius: 4,
        },
        {
          label: "결석률 (%)",
          data: patterns.map((p) => Math.round(p.absentRate * 10) / 10),
          backgroundColor: "rgba(239,68,68,0.7)",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: {
        y: { min: 0, title: { display: true, text: "비율 (%)" } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderPatternInsights(patterns: DayPattern[]): void {
  const container = $("attPatternInsights");
  if (!container) return;

  const insights: string[] = [];
  for (const p of patterns) {
    if (p.lateRate > 20) insights.push(`📌 ${p.day}요일 지각률 ${p.lateRate.toFixed(1)}% — 주의 필요`);
    if (p.absentRate > 15) insights.push(`📌 ${p.day}요일 결석률 ${p.absentRate.toFixed(1)}% — 주의 필요`);
  }

  const worst = [...patterns].sort((a, b) => b.lateRate + b.absentRate - (a.lateRate + a.absentRate))[0];
  if (worst && worst.lateRate + worst.absentRate > 10) {
    insights.unshift(`⚡ 가장 출결 이슈가 많은 요일: ${worst.day}요일`);
  }

  container.innerHTML =
    insights.length > 0
      ? insights.map((i) => `<div class="att-insight">${i}</div>`).join("")
      : '<div class="att-insight att-insight-ok">✅ 특이 패턴 없음</div>';
}

// ─── Student Detail Modal ───────────────────────────────────

function openStudentDetail(name: string): void {
  const modal = $("attDetailModal");
  if (!modal) return;

  const key = normalizeName(name);
  const records = allDailyRecords.get(key) || [];
  const student = currentStudents.find((s) => normalizeName(s.name) === key);

  const nameEl = $("attDetailName");
  const birthEl = $("attDetailBirth");
  const rateEl = $("attDetailRate");
  const riskEl = $("attDetailRisk");
  const tbody = $("attDetailTbody");

  if (nameEl) nameEl.textContent = name;
  if (birthEl) birthEl.textContent = student?.birth || "-";
  if (rateEl) rateEl.textContent = student ? `${student.attendanceRate.toFixed(1)}%` : "-";
  if (riskEl && student) {
    if (student.traineeStatus === "하차") {
      riskEl.textContent = student.hrdStatusRaw;
      riskEl.className = "att-detail-risk att-risk-ended";
    } else if (student.traineeStatus === "수료") {
      riskEl.textContent = student.hrdStatusRaw;
      riskEl.className = "att-detail-risk att-risk-graduated";
    } else if (student.traineeStatus === "조기취업") {
      riskEl.textContent = student.dropout ? `${student.hrdStatusRaw} (미수료)` : student.hrdStatusRaw;
      riskEl.className = student.dropout ? "att-detail-risk att-risk-ended" : "att-detail-risk att-risk-graduated";
    } else {
      riskEl.textContent = `${getRiskEmoji(student.riskLevel)} ${getRiskLabel(student.riskLevel)}`;
      riskEl.className = `att-detail-risk att-risk-${student.riskLevel}`;
    }
  }

  // Summary cards
  const attended = records.filter((r) => isAttendedStatus(r.status)).length;
  const late = records.filter((r) => r.status.includes("지각")).length;
  // HRD-Net 기준: 순수결석 + 지각3회=1결석 + 조퇴3회=1결석
  const absent = calcAbsentDays(records);

  const setSummary = (id: string, val: number) => {
    const el = $(id);
    if (el) el.textContent = String(val);
  };
  setSummary("attDetailAttended", attended);
  setSummary("attDetailLate", late);
  setSummary("attDetailAbsent", absent);
  setSummary("attDetailTotal", records.length);

  if (tbody) {
    tbody.innerHTML = records
      .map(
        (r) => `<tr>
        <td>${r.date}</td>
        <td>${r.dayOfWeek}</td>
        <td><span class="att-chip ${getStatusChipClass(r.status)}">${r.status}</span></td>
        <td class="att-td-time">${r.inTime}</td>
        <td class="att-td-time">${r.outTime}</td>
      </tr>`,
      )
      .join("");
  }

  modal.classList.add("active");

  // 모달 박스를 뷰포트 중앙으로 스크롤
  requestAnimationFrame(() => {
    const box = modal.querySelector(".att-modal-box");
    if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
    // 모달 내부 스크롤도 최상단으로 리셋
    if (box) (box as HTMLElement).scrollTop = 0;
  });
}

// ─── Risk Management Panel ──────────────────────────────────

function updateRiskButton(): void {
  const btn = $("attRiskBtn") as HTMLButtonElement | null;
  const badge = $("attRiskBadge");
  if (!btn) return;

  const active = currentStudents.filter((s) => !s.dropout);
  const riskCount = active.filter(
    (s) => s.riskLevel === "danger" || s.riskLevel === "warning" || s.riskLevel === "caution",
  ).length;
  const missingCount = active.filter((s) => s.missingCheckout).length;
  const total = riskCount + missingCount;

  btn.disabled = currentStudents.length === 0;
  if (badge) badge.textContent = String(total);
}

function renderStudentRow(s: AttendanceStudent, reason: string): string {
  const rateClass = s.riskLevel === "danger" ? "rd" : s.riskLevel === "warning" ? "rw" : "rc";
  const tagClass = reason === "missing" ? "tg-missing" : `tg-${s.riskLevel}`;
  const tagText = reason === "missing" ? "퇴실미체크" : getRiskLabel(s.riskLevel);
  const rateText = s.totalDays > 0 ? `결석 ${s.absentDays}/${s.maxAbsent}일` : `${s.attendanceRate.toFixed(1)}%`;
  const remainText =
    s.totalDays > 0 && s.remainingAbsent > 1
      ? ` · 잔여 ${s.remainingAbsent}일`
      : s.remainingAbsent <= 1 && s.totalDays > 0
        ? " · 제적위험"
        : "";
  return `<div class="att-risk-student" data-student="${s.name}">
    <div class="att-risk-student-left">
      <span class="att-risk-student-name">${s.name}</span>
      <span class="att-risk-student-birth">${s.birth}</span>
    </div>
    <div class="att-risk-student-right">
      <span class="att-risk-student-rate ${rateClass}">${rateText}${remainText}</span>
      <span class="att-risk-student-tag ${tagClass}">${tagText}</span>
    </div>
  </div>`;
}

function openRiskPanel(): void {
  const panel = $("attRiskPanel");
  if (!panel) return;

  const active = currentStudents.filter((s) => !s.dropout);
  const danger = active.filter((s) => s.riskLevel === "danger");
  const warning = active.filter((s) => s.riskLevel === "warning");
  const caution = active.filter((s) => s.riskLevel === "caution");
  const missing = active.filter((s) => s.missingCheckout);

  // Sort each group by attendance rate (lowest first)
  const byRate = (a: AttendanceStudent, b: AttendanceStudent) => a.attendanceRate - b.attendanceRate;
  danger.sort(byRate);
  warning.sort(byRate);
  caution.sort(byRate);

  // Summary counts
  const set = (id: string, val: number) => {
    const el = $(id);
    if (el) el.textContent = String(val);
  };
  set("attRpsDanger", danger.length);
  set("attRpsWarning", warning.length);
  set("attRpsCaution", caution.length);
  set("attRpsMissing", missing.length);

  // Render groups
  const renderGroup = (
    containerId: string,
    students: AttendanceStudent[],
    title: string,
    cssClass: string,
    reason: string,
  ) => {
    const container = $(containerId);
    if (!container) return;
    if (students.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML =
      `<div class="att-risk-group-title ${cssClass}">${title} (${students.length}명)</div>` +
      students.map((s) => renderStudentRow(s, reason)).join("");
  };

  renderGroup("attRiskListDanger", danger, "🔴 위험 — 허용 결석일 초과 (제적 대상)", "rg-danger", "risk");
  renderGroup("attRiskListWarning", warning, "🟠 경고 — 잔여 허용 결석 30% 이하", "rg-warning", "risk");
  renderGroup("attRiskListCaution", caution, "🟡 주의 — 잔여 허용 결석 60% 이하", "rg-caution", "risk");
  renderGroup("attRiskListMissing", missing, "⚠️ 퇴실 미체크", "rg-missing", "missing");

  // Attach click events to open student detail
  panel.querySelectorAll(".att-risk-student").forEach((el) => {
    el.addEventListener("click", () => {
      const name = (el as HTMLElement).dataset.student || "";
      panel.classList.remove("active");
      openStudentDetail(name);
    });
  });

  // Slack send button
  const slackBtn = $("attSlackSendBtn") as HTMLButtonElement | null;
  if (slackBtn) {
    const config = loadHrdConfig();
    slackBtn.style.display = config.slackWebhookUrl ? "" : "none";

    // Clone to remove old listeners
    const newBtn = slackBtn.cloneNode(true) as HTMLButtonElement;
    slackBtn.parentNode?.replaceChild(newBtn, slackBtn);

    newBtn.addEventListener("click", async () => {
      const course = getSelectedCourse();
      const degrSelect = $("attFilterDegr") as HTMLSelectElement | null;
      const dateInput = $("attFilterDate") as HTMLInputElement | null;
      if (!course || !degrSelect) return;

      newBtn.disabled = true;
      newBtn.className = "att-slack-btn att-slack-sending";
      newBtn.innerHTML = `<span class="att-slack-icon">⏳</span> 전송 중...`;

      try {
        // 하차방어율 계산
        const totalCount = currentStudents.length;
        const dropoutCount = currentStudents.filter((s) => s.dropout).length;
        const defRate = totalCount > 0 ? ((totalCount - dropoutCount) / totalCount) * 100 : 100;
        await sendSlackReport(
          course.name,
          degrSelect.value,
          dateInput?.value || new Date().toISOString().slice(0, 10),
          currentStudents,
          defRate,
        );
        newBtn.className = "att-slack-btn att-slack-sent";
        newBtn.innerHTML = `<span class="att-slack-icon">✅</span> 전송 완료`;
        setTimeout(() => {
          newBtn.className = "att-slack-btn";
          newBtn.innerHTML = `<span class="att-slack-icon">📤</span> Slack 전송`;
          newBtn.disabled = false;
        }, 3000);
      } catch (e) {
        newBtn.className = "att-slack-btn att-slack-fail";
        newBtn.innerHTML = `<span class="att-slack-icon">❌</span> 실패`;
        newBtn.title = e instanceof Error ? e.message : String(e);
        setTimeout(() => {
          newBtn.className = "att-slack-btn";
          newBtn.innerHTML = `<span class="att-slack-icon">📤</span> Slack 전송`;
          newBtn.disabled = false;
        }, 3000);
      }
    });
  }

  panel.classList.add("active");
}

// ─── Settings Integration ───────────────────────────────────

export async function renderHrdSettingsSection(): Promise<void> {
  const container = $("settingsCourseRegistration") ?? $("hrdSettingsSection");
  if (!container) return;

  currentConfig = loadHrdConfig();

  const keyInput = $("hrdAuthKey") as HTMLInputElement | null;
  const proxyInput = $("hrdProxy") as HTMLInputElement | null;
  const courseList = $("hrdCourseList");

  // Auth key는 잠금 해제 상태일 때만 표시
  const keySection = $("hrdKeySection");
  const isUnlocked = keySection && keySection.style.display !== "none";
  if (keyInput && isUnlocked) keyInput.value = currentConfig.authKey;
  if (proxyInput) proxyInput.value = currentConfig.proxy;
  const slackInput = $("hrdSlackWebhook") as HTMLInputElement | null;
  if (slackInput && isUnlocked) slackInput.value = currentConfig.slackWebhookUrl || "";
  const excusedSlackInput = $("hrdExcusedSlackWebhook") as HTMLInputElement | null;
  if (excusedSlackInput && isUnlocked) excusedSlackInput.value = currentConfig.excusedSlackWebhookUrl || "";
  const excusedSheetInput = $("hrdExcusedSheetUrl") as HTMLInputElement | null;
  if (excusedSheetInput) excusedSheetInput.value = currentConfig.excusedSheetUrl || "";
  const evidenceSheetInput = $("hrdEvidenceSheetUrl") as HTMLInputElement | null;
  if (evidenceSheetInput) evidenceSheetInput.value = currentConfig.evidenceSheetUrl || "";

  if (courseList) {
    // Supabase에서 보조강사 코드 비동기 조회
    let allAsstCodes: Awaited<ReturnType<typeof loadAssistantCodes>> = [];
    try {
      allAsstCodes = await loadAssistantCodes();
    } catch (err) {
      console.warn("[Attendance] 보조강사 코드 로드 실패:", err);
    }

    courseList.innerHTML =
      currentConfig.courses.length === 0
        ? '<div class="att-empty-mini">등록된 과정이 없습니다. "기본 과정 복원" 버튼을 눌러주세요.</div>'
        : currentConfig.courses
            .map((c, i) => {
              const asstCodes = allAsstCodes.filter((ac) => ac.trainPrId === c.trainPrId);
              const codeRows = asstCodes
                .map(
                  (ac) =>
                    `<div class="asst-code-row" data-asst-code="${ac.code}">
                    <span class="asst-code-degr">${ac.degr}기</span>
                    <code class="asst-code-value">${ac.code}</code>
                    <button class="btn-sm btn-danger asst-code-del" data-asst-del="${ac.code}" title="삭제">✕</button>
                  </div>`,
                )
                .join("");
              const degrOpts = c.degrs.map((d) => `<option value="${d}">${d}기</option>`).join("");
              const statusBadge =
                c.startDate && c.totalDays
                  ? (() => {
                      const end = new Date(c.startDate);
                      end.setDate(end.getDate() + Math.ceil((c.totalDays / 5) * 7));
                      return end < new Date()
                        ? '<span class="course-badge course-badge-done">종강</span>'
                        : '<span class="course-badge course-badge-active">진행중</span>';
                    })()
                  : "";
              return `<div class="hrd-course-item">
                  <div class="hrd-course-header">
                    <div class="hrd-course-title-row">
                      ${statusBadge}
                      <strong class="hrd-course-name">${c.name}</strong>
                      <button class="btn-icon hrd-course-remove" data-idx="${i}" title="과정 삭제">🗑</button>
                    </div>
                    <div class="hrd-course-tags">
                      <span class="course-tag"><span class="course-tag-label">ID</span>${c.trainPrId}</span>
                      <span class="course-tag"><span class="course-tag-label">기수</span>${c.degrs.join(", ")}기 (${c.degrs.length}개)</span>
                      ${c.startDate ? `<span class="course-tag"><span class="course-tag-label">개강</span>${c.startDate}</span>` : ""}
                      ${c.totalDays ? `<span class="course-tag"><span class="course-tag-label">훈련일수</span>${c.totalDays}일</span>` : ""}
                    </div>
                    <div class="hrd-course-sms-from u-mt-4">
                      <span class="course-tag-label">📱 발신번호</span>
                      <input class="hrd-sms-from-input" data-course-idx="${i}" type="tel" value="${c.smsFrom || ""}" placeholder="010-0000-0000" />
                    </div>
                  </div>
                  <div class="asst-code-section">
                    <div class="asst-code-header">🔑 보조강사 접근코드</div>
                    ${codeRows || '<div class="asst-code-empty">등록된 코드 없음</div>'}
                    <div class="asst-code-add">
                      <select class="asst-code-degr-select" data-course-idx="${i}">${degrOpts}</select>
                      <input class="asst-code-input" data-course-idx="${i}" placeholder="코드 입력 (예: kim-llm3)" />
                      <button class="btn-sm asst-code-save" data-course-idx="${i}" style="background:var(--primary);color:#fff;border:none;border-radius:6px">저장</button>
                    </div>
                    <div class="asst-code-msg" data-course-idx="${i}"></div>
                  </div>
                </div>`;
            })
            .join("");

    courseList.querySelectorAll(".hrd-course-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
        const removedTrainPrId = currentConfig.courses[idx]?.trainPrId;
        currentConfig.courses.splice(idx, 1);
        saveHrdConfig(currentConfig);
        document.dispatchEvent(
          new CustomEvent("hrd-course-changed", { detail: { action: "remove", trainPrId: removedTrainPrId } }),
        );
        void renderHrdSettingsSection();
        populateFilters();
      });
    });

    // 보조강사 코드 삭제
    courseList.querySelectorAll(".asst-code-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const code = (btn as HTMLElement).dataset.asstDel;
        if (code) {
          try {
            await removeAssistantCode(code);
          } catch (err) {
            console.warn("[Attendance] 보조강사 코드 삭제 실패:", err);
          }
          void renderHrdSettingsSection();
        }
      });
    });

    // 보조강사 코드 저장
    courseList.querySelectorAll(".asst-code-save").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = parseInt((btn as HTMLElement).dataset.courseIdx || "0");
        const course = currentConfig.courses[idx];
        if (!course) return;

        const row = btn.closest(".asst-code-add");
        const degrSel = row?.querySelector(".asst-code-degr-select") as HTMLSelectElement | null;
        const codeInput = row?.querySelector(".asst-code-input") as HTMLInputElement | null;
        const msgEl = courseList!.querySelector(`.asst-code-msg[data-course-idx="${idx}"]`);

        const code = codeInput?.value.trim() || "";
        const degr = degrSel?.value || "";

        try {
          const error = await validateAssistantCode(code);
          if (error) {
            if (msgEl) {
              msgEl.textContent = error;
              (msgEl as HTMLElement).style.color = "#dc2626";
            }
            return;
          }

          await saveAssistantCode({ code, trainPrId: course.trainPrId, degr, courseName: course.name });
          if (codeInput) codeInput.value = "";
          if (msgEl) {
            msgEl.textContent = "";
            (msgEl as HTMLElement).style.color = "";
          }
          void renderHrdSettingsSection();
        } catch (e) {
          if (msgEl) {
            msgEl.textContent = `저장 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`;
            (msgEl as HTMLElement).style.color = "#dc2626";
          }
        }
      });
    });

    // 발신번호 인라인 편집
    courseList.querySelectorAll<HTMLInputElement>(".hrd-sms-from-input").forEach((input) => {
      input.addEventListener("blur", () => {
        const idx = parseInt(input.dataset.courseIdx || "0", 10);
        if (currentConfig.courses[idx]) {
          currentConfig.courses[idx].smsFrom = input.value.trim() || undefined;
          saveHrdConfig(currentConfig);
        }
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
    });
  }

  // ─── Slack 자동 알림 설정 UI 렌더링 ─────
  renderSlackScheduleUI(currentConfig);
}

function renderSlackScheduleUI(config: HrdConfig): void {
  const schedule = config.slackSchedule ?? DEFAULT_SLACK_SCHEDULE;

  // 토글 상태
  const toggle = $("slackScheduleEnabled") as HTMLInputElement | null;
  const toggleLabel = $("slackScheduleToggleLabel");
  const settingsPanel = $("slackScheduleSettings");
  if (toggle) {
    toggle.checked = schedule.enabled;
    if (toggleLabel) toggleLabel.textContent = schedule.enabled ? "활성화" : "비활성화";
    if (settingsPanel) settingsPanel.style.display = schedule.enabled ? "block" : "none";
  }

  // 시간
  const hourSel = $("slackScheduleHour") as HTMLSelectElement | null;
  const minSel = $("slackScheduleMinute") as HTMLSelectElement | null;
  const safeHour = Number.isFinite(schedule.hour) ? schedule.hour : DEFAULT_SLACK_SCHEDULE.hour;
  const safeMinute = Number.isFinite(schedule.minute) ? schedule.minute : DEFAULT_SLACK_SCHEDULE.minute;
  if (hourSel) hourSel.value = String(safeHour);
  if (minSel) minSel.value = String(safeMinute);

  // 요일
  const weekdaySel = $("slackScheduleWeekdays") as HTMLSelectElement | null;
  if (weekdaySel) weekdaySel.value = schedule.weekdaysOnly ? "weekdays" : "daily";

  // 자동 SMS 설정 복원
  const autoSmsCheck = $("autoSmsEnabled") as HTMLInputElement | null;
  if (autoSmsCheck) autoSmsCheck.checked = schedule.autoSmsEnabled || false;
  const autoSmsLevel = schedule.autoSmsRiskLevel || "danger";
  const autoSmsRadio = document.querySelector<HTMLInputElement>(`input[name='autoSmsLevel'][value='${autoSmsLevel}']`);
  if (autoSmsRadio) autoSmsRadio.checked = true;

  // 대상 과정 + 담당 매니저 — 운영중인 과정만 표시, 최근 개강순
  const coursesContainer = $("slackScheduleCourses");
  if (coursesContainer) {
    const managers = schedule.courseManagers ?? {};
    const now = new Date();

    // 운영중 과정 필터 + 최근 개강순 정렬
    const sortedCourses = [...config.courses]
      .map((c) => {
        let isActive = true;
        if (c.startDate && c.totalDays) {
          const start = new Date(c.startDate);
          if (start > now) isActive = false;
          const calendarDays = Math.ceil(c.totalDays * 1.5);
          const elapsed = Math.floor((now.getTime() - start.getTime()) / 86400000);
          if (elapsed > calendarDays) isActive = false;
        }
        return { ...c, isActive };
      })
      .filter((c) => c.isActive)
      .sort((a, b) => (b.startDate || "0000").localeCompare(a.startDate || "0000"));

    coursesContainer.innerHTML = sortedCourses
      .map((c) => {
        const checked = schedule.targetCourses.length === 0 || schedule.targetCourses.includes(c.trainPrId);
        const latestDegr = c.degrs[c.degrs.length - 1] || "";
        const managerVal = managers[c.trainPrId] || "";
        return `<div class="slack-course-manager-row ${checked ? "checked" : ""}">
          <input type="checkbox" value="${c.trainPrId}" ${checked ? "checked" : ""} />
          <span class="slack-course-manager-name">${c.name}<span class="slack-course-degr">${latestDegr}기</span></span>
          <input type="text" class="slack-course-manager-input" data-course-id="${c.trainPrId}"
            value="${managerVal}" placeholder="매니저 Slack ID (예: U12345678)" />
        </div>`;
      })
      .join("");

    if (sortedCourses.length === 0) {
      coursesContainer.innerHTML = `<div class="muted" style="padding: 12px; text-align: center">현재 운영중인 과정이 없습니다</div>`;
    }

    // 체크 상태 변경 시 시각 피드백
    coursesContainer.querySelectorAll("input[type='checkbox']").forEach((cb) => {
      cb.addEventListener("change", () => {
        const row = cb.closest(".slack-course-manager-row");
        if (row) {
          row.classList.toggle("checked", (cb as HTMLInputElement).checked);
        }
      });
    });
  }

  // 헤더/푸터
  const headerInput = $("slackScheduleHeader") as HTMLInputElement | null;
  const footerInput = $("slackScheduleFooter") as HTMLInputElement | null;
  if (headerInput) headerInput.value = schedule.headerText || DEFAULT_SLACK_SCHEDULE.headerText;
  if (footerInput) footerInput.value = schedule.footerText || DEFAULT_SLACK_SCHEDULE.footerText;
}

/** Google Workspace 로그인(admin-mode) 상태로 API 키 섹션 접근 제어 */
function isAdminMode(): boolean {
  return document.body.classList.contains("admin-mode");
}

export function setupSettingsHandlers(): void {
  // ─── 접이식 섹션 토글 (settingsInit.ts에서도 바인딩, 중복 방지) ───
  document.querySelectorAll<HTMLElement>("[data-settings-toggle]").forEach((header) => {
    if (header.dataset.toggleBound) return;
    header.dataset.toggleBound = "1";
    header.addEventListener("click", () => {
      const body = header.nextElementSibling as HTMLElement | null;
      if (!body) return;
      const isExpanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", isExpanded ? "false" : "true");
      body.classList.toggle("is-collapsed", isExpanded);
    });
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        header.click();
      }
    });
  });

  // ─── Slack 배지 초기 상태 ──────────────────────
  const slackBadge = $("slackScheduleBadge");
  const updateSlackBadge = (enabled: boolean) => {
    if (!slackBadge) return;
    slackBadge.textContent = enabled ? "ON" : "OFF";
    slackBadge.className = `settings-badge ${enabled ? "settings-badge--on" : "settings-badge--off"}`;
  };
  updateSlackBadge(currentConfig.slackSchedule?.enabled ?? false);

  // API Key 잠금 해제 게이트 — Google Workspace 로그인(admin-mode)으로 자동 해제
  const gateUnlockBtn = $("hrdKeyGateUnlock");
  const gatePasswordInput = $("hrdKeyGatePassword") as HTMLInputElement | null;
  const gateError = $("hrdKeyGateError");

  const unlockKeySection = () => {
    if (!isAdminMode()) {
      if (gateError) {
        gateError.style.display = "block";
        gateError.textContent = "Google Workspace(@modulabs.co.kr) 로그인이 필요합니다";
      }
      return;
    }
    const gate = $("hrdKeyGate");
    const section = $("hrdKeySection");
    if (gate) gate.style.display = "none";
    if (section) section.style.display = "flex";
    if (gateError) gateError.style.display = "none";
    // 학업성취도 + 재직자 + 문의응대 섹션도 표시
    const achievementSection = $("achievementApiSection");
    if (achievementSection) achievementSection.style.display = "flex";
    const employedSection = $("employedApiSection");
    if (employedSection) employedSection.style.display = "flex";
    const inquirySection = $("inquiryApiSection");
    if (inquirySection) inquirySection.style.display = "flex";
    // Auth key, Proxy, Slack Webhook 복원
    const keyInput = $("hrdAuthKey") as HTMLInputElement | null;
    if (keyInput) {
      keyInput.type = "text";
      keyInput.value = currentConfig.authKey;
    }
    const proxyInput = $("hrdProxy") as HTMLInputElement | null;
    if (proxyInput) proxyInput.value = currentConfig.proxy || "";
    const slackInput = $("hrdSlackWebhook") as HTMLInputElement | null;
    if (slackInput) slackInput.value = currentConfig.slackWebhookUrl || "";
    const excusedSlackInput = $("hrdExcusedSlackWebhook") as HTMLInputElement | null;
    if (excusedSlackInput) excusedSlackInput.value = currentConfig.excusedSlackWebhookUrl || "";
    const excusedSheetInput = $("hrdExcusedSheetUrl") as HTMLInputElement | null;
    if (excusedSheetInput) excusedSheetInput.value = currentConfig.excusedSheetUrl || "";
    const evidenceSheetInput = $("hrdEvidenceSheetUrl") as HTMLInputElement | null;
    if (evidenceSheetInput) evidenceSheetInput.value = currentConfig.evidenceSheetUrl || "";
  };

  gateUnlockBtn?.addEventListener("click", unlockKeySection);
  // Enter 키 호환성 유지 (비밀번호 입력 없이 바로 동작)
  gatePasswordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockKeySection();
  });

  // Google 로그인 상태면 자동 잠금 해제
  if (isAdminMode()) unlockKeySection();

  // Save HRD settings
  const saveBtn = $("hrdSettingsSave");
  saveBtn?.addEventListener("click", () => {
    const key = ($("hrdAuthKey") as HTMLInputElement)?.value?.trim() || "";
    const proxy = ($("hrdProxy") as HTMLInputElement)?.value?.trim() || "";
    const slackUrl = ($("hrdSlackWebhook") as HTMLInputElement)?.value?.trim() || "";
    const excusedSlackUrl = ($("hrdExcusedSlackWebhook") as HTMLInputElement)?.value?.trim() || "";
    const excusedSheetUrl = ($("hrdExcusedSheetUrl") as HTMLInputElement)?.value?.trim() || "";
    const evidenceSheetUrl = ($("hrdEvidenceSheetUrl") as HTMLInputElement)?.value?.trim() || "";
    currentConfig.authKey = key;
    currentConfig.proxy = proxy;
    currentConfig.slackWebhookUrl = slackUrl || undefined;
    currentConfig.excusedSlackWebhookUrl = excusedSlackUrl || undefined;
    currentConfig.excusedSheetUrl = excusedSheetUrl || undefined;
    currentConfig.evidenceSheetUrl = evidenceSheetUrl || undefined;
    saveHrdConfig(currentConfig);
    const status = $("hrdTestStatus");
    if (status) {
      status.textContent = "✅ 저장됨";
      status.className = "att-api-status att-api-ok";
    }
  });

  // Test connection
  const testBtn = $("hrdTestBtn");
  testBtn?.addEventListener("click", async () => {
    const status = $("hrdTestStatus");
    if (status) {
      status.textContent = "테스트 중...";
      status.className = "att-api-status";
    }
    const config = loadHrdConfig();
    if (config.courses.length === 0) {
      if (status) {
        status.textContent = "❌ 등록된 과정이 없습니다";
        status.className = "att-api-status att-api-err";
      }
      return;
    }
    const c = config.courses[0];
    const result = await testConnection(config, c.trainPrId, c.degrs[0] || "1");
    if (status) {
      status.textContent = result.ok ? `✅ ${result.message}` : `❌ ${result.message}`;
      status.className = result.ok ? "att-api-status att-api-ok" : "att-api-status att-api-err";
    }
  });

  // Add course
  const addBtn = $("hrdCourseAdd");
  addBtn?.addEventListener("click", () => {
    const name = ($("hrdNewCourseName") as HTMLInputElement)?.value?.trim();
    const id = ($("hrdNewCourseId") as HTMLInputElement)?.value?.trim();
    const degrs = ($("hrdNewCourseDegrs") as HTMLInputElement)?.value?.trim();
    const start = ($("hrdNewCourseStart") as HTMLInputElement)?.value?.trim();
    const totalDays = parseInt(($("hrdNewCourseDays") as HTMLInputElement)?.value || "0");
    const endTime = ($("hrdNewCourseEndTime") as HTMLInputElement)?.value?.trim() || "18:00";
    const smsFrom = ($("hrdNewCourseSmsFrom") as HTMLInputElement)?.value?.trim() || "";

    if (!name || !id || !degrs) {
      alert("과정명, 훈련과정ID, 기수는 필수입니다.");
      return;
    }

    const newCourse = {
      name,
      trainPrId: id,
      degrs: degrs.split(",").map((d) => d.trim()),
      startDate: start || "",
      totalDays: totalDays || 0,
      endTime,
      smsFrom: smsFrom || undefined,
    };
    currentConfig.courses.push(newCourse);
    saveHrdConfig(currentConfig);
    document.dispatchEvent(new CustomEvent("hrd-course-changed", { detail: { action: "add", course: newCourse } }));
    void renderHrdSettingsSection();
    populateFilters();

    // Clear inputs
    (
      ["hrdNewCourseName", "hrdNewCourseId", "hrdNewCourseDegrs", "hrdNewCourseStart", "hrdNewCourseDays"] as const
    ).forEach((id) => {
      const el = $(id) as HTMLInputElement | null;
      if (el) el.value = "";
    });
  });

  // Reset defaults
  const resetBtn = $("hrdResetDefaults");
  resetBtn?.addEventListener("click", () => {
    currentConfig.courses = DEFAULT_COURSES.map((c) => ({ ...c, degrs: [...c.degrs] }));
    saveHrdConfig(currentConfig);
    document.dispatchEvent(new CustomEvent("hrd-course-changed", { detail: { action: "restore" } }));
    void renderHrdSettingsSection();
    populateFilters();
    const status = $("hrdTestStatus");
    if (status) {
      status.textContent = `✅ 기본 과정 복원됨 (${DEFAULT_COURSES.length}개 과정)`;
      status.className = "att-api-status att-api-ok";
    }
  });

  // Discover all degrs
  const discoverBtn = $("hrdDiscoverAll");
  discoverBtn?.addEventListener("click", async () => {
    const statusEl = $("hrdDiscoverStatus");
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.textContent = "🔍 기수 탐색 시작...";
    }
    if (discoverBtn instanceof HTMLButtonElement) discoverBtn.disabled = true;

    const config = loadHrdConfig();
    let updated = false;

    for (const course of config.courses) {
      if (statusEl) statusEl.textContent = `🔍 ${course.name} 기수 탐색 중...`;
      try {
        const found = await discoverDegrs(config, course.trainPrId, 15, (d, ok) => {
          if (statusEl) statusEl.textContent = `🔍 ${course.name} ${d}기 ${ok ? "✅" : "—"}`;
        });
        const newDegrs = found.map((f) => f.degr);
        if (newDegrs.length > 0 && newDegrs.join(",") !== course.degrs.join(",")) {
          course.degrs = newDegrs;
          updated = true;
        }
      } catch (err) {
        console.warn(`[Attendance] ${course.name} 기수 탐색 실패:`, err);
      }
    }

    if (updated) {
      saveHrdConfig(config);
      currentConfig = config;
      void renderHrdSettingsSection();
      populateFilters();
    }

    if (statusEl) {
      statusEl.textContent = updated
        ? "✅ 기수 탐색 완료! 새로운 기수가 업데이트되었습니다."
        : "✅ 탐색 완료. 변경사항 없음.";
    }
    if (discoverBtn instanceof HTMLButtonElement) discoverBtn.disabled = false;
  });

  // ─── Slack Webhook 테스트 버튼 ──────────────────
  const slackTestBtn = $("hrdSlackTestBtn");
  slackTestBtn?.addEventListener("click", async () => {
    const slackInput = $("hrdSlackWebhook") as HTMLInputElement | null;
    const statusEl = $("hrdSlackTestStatus");
    const url = slackInput?.value?.trim() || "";
    if (!url) {
      if (statusEl) {
        statusEl.textContent = "Webhook URL을 입력해주세요.";
        statusEl.style.color = "#dc2626";
      }
      return;
    }
    if (statusEl) {
      statusEl.textContent = "테스트 전송 중...";
      statusEl.style.color = "#6b7280";
    }
    if (slackTestBtn instanceof HTMLButtonElement) slackTestBtn.disabled = true;

    const result = await testSlackWebhook(url);
    if (statusEl) {
      statusEl.textContent = result.ok ? `✅ ${result.message}` : `❌ ${result.message}`;
      statusEl.style.color = result.ok ? "#059669" : "#dc2626";
    }
    if (slackTestBtn instanceof HTMLButtonElement) slackTestBtn.disabled = false;
  });

  // ─── 공결신청 Slack Webhook 테스트 ──────────────
  const excusedSlackTestBtn = $("hrdExcusedSlackTestBtn");
  excusedSlackTestBtn?.addEventListener("click", async () => {
    const excusedInput = $("hrdExcusedSlackWebhook") as HTMLInputElement | null;
    const statusEl = $("hrdExcusedSlackTestStatus");
    const url = excusedInput?.value?.trim() || "";
    if (!url) {
      if (statusEl) {
        statusEl.textContent = "Webhook URL을 입력해주세요.";
        statusEl.style.color = "#dc2626";
      }
      return;
    }
    if (statusEl) {
      statusEl.textContent = "테스트 전송 중...";
      statusEl.style.color = "#6b7280";
    }
    if (excusedSlackTestBtn instanceof HTMLButtonElement) excusedSlackTestBtn.disabled = true;

    const result = await testSlackWebhook(url);
    if (statusEl) {
      statusEl.textContent = result.ok ? `✅ ${result.message}` : `❌ ${result.message}`;
      statusEl.style.color = result.ok ? "#059669" : "#dc2626";
    }
    if (excusedSlackTestBtn instanceof HTMLButtonElement) excusedSlackTestBtn.disabled = false;
  });

  // ─── Slack 자동 알림 토글 ───────────────────────
  const scheduleToggle = $("slackScheduleEnabled") as HTMLInputElement | null;
  scheduleToggle?.addEventListener("change", () => {
    const toggleLabel = $("slackScheduleToggleLabel");
    const settingsPanel = $("slackScheduleSettings");
    updateSlackBadge(scheduleToggle.checked);
    if (toggleLabel) toggleLabel.textContent = scheduleToggle.checked ? "활성화" : "비활성화";
    if (settingsPanel) settingsPanel.style.display = scheduleToggle.checked ? "block" : "none";
  });

  // ─── Slack 알림 설정 저장 ───────────────────────
  const scheduleSaveBtn = $("slackScheduleSave");
  scheduleSaveBtn?.addEventListener("click", () => {
    const config = loadHrdConfig();
    const toggle = $("slackScheduleEnabled") as HTMLInputElement | null;
    const hourSel = $("slackScheduleHour") as HTMLSelectElement | null;
    const minSel = $("slackScheduleMinute") as HTMLSelectElement | null;
    const weekdaySel = $("slackScheduleWeekdays") as HTMLSelectElement | null;
    const headerInput = $("slackScheduleHeader") as HTMLInputElement | null;
    const footerInput = $("slackScheduleFooter") as HTMLInputElement | null;
    const coursesContainer = $("slackScheduleCourses");

    // 대상 과정 + 매니저 수집
    const targetCourses: string[] = [];
    const courseManagers: Record<string, string> = {};
    if (coursesContainer) {
      const checkboxes = coursesContainer.querySelectorAll("input[type='checkbox']");
      const allChecked = Array.from(checkboxes).every((cb) => (cb as HTMLInputElement).checked);
      if (!allChecked) {
        checkboxes.forEach((cb) => {
          if ((cb as HTMLInputElement).checked) {
            targetCourses.push((cb as HTMLInputElement).value);
          }
        });
      }
      // allChecked → 빈 배열 = 전체 과정

      // 매니저 입력 수집
      coursesContainer.querySelectorAll<HTMLInputElement>(".slack-course-manager-input").forEach((input) => {
        const courseId = input.dataset.courseId;
        const val = input.value.trim();
        if (courseId && val) {
          courseManagers[courseId] = val;
        }
      });
    }

    // 자동 SMS 설정
    const autoSmsCheck = $("autoSmsEnabled") as HTMLInputElement | null;
    const autoSmsLevel = document.querySelector<HTMLInputElement>("input[name='autoSmsLevel']:checked");

    const schedule: SlackScheduleConfig = {
      enabled: toggle?.checked || false,
      hour: parseInt(hourSel?.value || "10"),
      minute: parseInt(minSel?.value || "0"),
      weekdaysOnly: weekdaySel?.value !== "daily",
      targetCourses,
      headerText: headerInput?.value?.trim() || DEFAULT_SLACK_SCHEDULE.headerText,
      footerText: footerInput?.value?.trim() || DEFAULT_SLACK_SCHEDULE.footerText,
      lastSentDate: config.slackSchedule?.lastSentDate,
      courseManagers,
      autoSmsEnabled: autoSmsCheck?.checked || false,
      autoSmsRiskLevel: (autoSmsLevel?.value as "danger" | "warning") || "danger",
    };

    config.slackSchedule = schedule;
    saveHrdConfig(config);
    currentConfig = config;

    // 스케줄러 재시작
    restartScheduler();

    const statusEl = $("slackScheduleStatus");
    if (statusEl) {
      const timeStr = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
      statusEl.textContent = schedule.enabled
        ? `✅ 설정 저장됨 — ${schedule.weekdaysOnly ? "평일" : "매일"} ${timeStr} 자동 전송`
        : "ℹ️ 자동 전송 비활성화됨";
      statusEl.className = `slack-schedule-status ${schedule.enabled ? "slack-schedule-success" : "slack-schedule-info"}`;
    }
  });

  // ─── Slack 수동 전송 테스트 ─────────────────────
  const testSendBtn = $("slackScheduleTestSend");
  testSendBtn?.addEventListener("click", async () => {
    const config = loadHrdConfig();
    const webhookUrl = config.slackWebhookUrl;
    if (!webhookUrl) {
      const statusEl = $("slackScheduleStatus");
      if (statusEl) {
        statusEl.textContent = "❌ Webhook URL을 먼저 설정해주세요";
        statusEl.className = "slack-schedule-status slack-schedule-error";
      }
      return;
    }

    if (testSendBtn instanceof HTMLButtonElement) {
      testSendBtn.disabled = true;
      testSendBtn.textContent = "전송 중...";
    }
    const statusEl = $("slackScheduleStatus");
    if (statusEl) {
      statusEl.textContent = "⏳ 수동 전송 중...";
      statusEl.className = "slack-schedule-status slack-schedule-info";
    }

    try {
      // 현재 대시보드에 로드된 데이터가 있으면 사용, 없으면 첫 번째 과정으로 조회
      if (currentStudents.length > 0) {
        const courseSelect = $("attFilterCourse") as HTMLSelectElement | null;
        const degrSelect = $("attFilterDegr") as HTMLSelectElement | null;
        const course = currentConfig.courses.find((c) => c.trainPrId === courseSelect?.value);
        const courseName = course?.name || "테스트 과정";
        const degr = degrSelect?.value || "1";
        const today = new Date().toISOString().slice(0, 10);

        await sendSlackReportDirect(webhookUrl, courseName, degr, today, currentStudents);
        if (statusEl) {
          statusEl.textContent = `✅ ${courseName} ${degr}기 리포트 전송 완료`;
          statusEl.className = "slack-schedule-status slack-schedule-success";
        }
      } else {
        // 데이터 미로드 상태 — 테스트 메시지만 전송
        const result = await testSlackWebhook(webhookUrl);
        if (statusEl) {
          statusEl.textContent = result.ok ? "✅ 테스트 메시지 전송 완료" : `❌ ${result.message}`;
          statusEl.className = `slack-schedule-status ${result.ok ? "slack-schedule-success" : "slack-schedule-error"}`;
        }
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = `❌ 전송 실패: ${e instanceof Error ? e.message : String(e)}`;
        statusEl.className = "slack-schedule-status slack-schedule-error";
      }
    }
    if (testSendBtn instanceof HTMLButtonElement) {
      testSendBtn.disabled = false;
      testSendBtn.textContent = "수동 전송 테스트";
    }
  });
}

// ─── Filters ────────────────────────────────────────────────

function populateFilters(): void {
  const courseSelect = $("attFilterCourse") as HTMLSelectElement | null;
  const degrSelect = $("attFilterDegr") as HTMLSelectElement | null;
  if (!courseSelect) return;

  currentConfig = loadHrdConfig();
  courseSelect.innerHTML = currentConfig.courses
    .map((c) => `<option value="${c.trainPrId}">${c.name}</option>`)
    .join("");

  if (currentConfig.courses.length === 0) {
    courseSelect.innerHTML = '<option value="">과정을 등록해주세요</option>';
  }

  courseSelect.addEventListener("change", () => updateDegrOptions());
  updateDegrOptions();

  function updateDegrOptions(): void {
    if (!degrSelect) return;
    const selected = courseSelect!.value;
    const course = currentConfig.courses.find((c) => c.trainPrId === selected);
    degrSelect.innerHTML = course
      ? course.degrs.map((d) => `<option value="${d}">${d}기</option>`).join("")
      : '<option value="">-</option>';
  }

  // 보조강사 모드: 과정/기수 고정
  const assistantSession = getAssistantSession();
  if (assistantSession && courseSelect) {
    courseSelect.value = assistantSession.trainPrId;
    courseSelect.disabled = true;
    updateDegrOptions();
    if (degrSelect) {
      degrSelect.value = assistantSession.degr;
      degrSelect.disabled = true;
    }
  }
}

function getSelectedCourse(): HrdCourse | undefined {
  const courseSelect = $("attFilterCourse") as HTMLSelectElement | null;
  if (!courseSelect) return undefined;
  return currentConfig.courses.find((c) => c.trainPrId === courseSelect.value);
}

// ─── Week Range Helper ──────────────────────────────────────

/** 주어진 날짜(YYYY-MM-DD)가 속한 월~금 범위 반환 */
function getWeekRange(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=일, 1=월, ..., 6=토
  const diffToMon = day === 0 ? -6 : 1 - day; // 일요일이면 이전 월요일
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { start: fmt(mon), end: fmt(fri) };
}

/** 주간 범위 라벨: "3/17 ~ 3/21" */
function getWeekRangeLabel(dateStr: string): string {
  const { start, end } = getWeekRange(dateStr);
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return `${s.getMonth() + 1}/${s.getDate()} ~ ${e.getMonth() + 1}/${e.getDate()}`;
}

// ─── View Mode Helper ────────────────────────────────────────

function getViewMode(): "daily" | "weekly" | "monthly" {
  const active = document.querySelector("[data-att-view].active") as HTMLElement | null;
  return (active?.dataset.attView as "daily" | "weekly" | "monthly") || "monthly";
}

/** 뷰 모드 변경 시 자동 재조회 */
function reRenderWithViewMode(): void {
  fetchAndRender();
}

// ─── Main Data Fetch ────────────────────────────────────────

async function fetchAndRender(): Promise<void> {
  const courseSelect = $("attFilterCourse") as HTMLSelectElement | null;
  const degrSelect = $("attFilterDegr") as HTMLSelectElement | null;
  const dateInput = $("attFilterDate") as HTMLInputElement | null;
  const statusEl = $("attLoadStatus");

  if (!courseSelect?.value || !degrSelect?.value) {
    if (statusEl) statusEl.textContent = "과정과 기수를 선택해주세요.";
    return;
  }

  const tid = courseSelect.value;
  const deg = degrSelect.value;
  const date = dateInput?.value || new Date().toISOString().slice(0, 10);
  const course = getSelectedCourse();

  if (statusEl) statusEl.textContent = "데이터 조회 중...";

  try {
    currentConfig = loadHrdConfig();

    // 전체 훈련기간 출결 데이터 조회 — 개강~종강 누적 결석 정확 측정
    const now = new Date();

    const [roster] = await Promise.all([fetchRoster(currentConfig, tid, deg)]);
    await loadGenderData(tid, deg);

    // 전체 월 출결 데이터 수집 — 충분한 범위 조회 후 첫 출석일 자동 감지
    const allDaily = await fetchFullPeriodAttendance(currentConfig, tid, deg, course);

    // Build cumulative records (전체 기간 누적 — 결석일수/주간트렌드/요일패턴용)
    allDailyRecords = buildAllDailyRecords(allDaily);

    // 항상 일별 조회 — 선택한 날짜의 출결 상태만 테이블에 표시
    currentStudents = buildStudents(roster, allDaily, date, course, tid, deg);

    // Calculate metrics
    const metrics = calculateMetrics(currentStudents);

    // Render everything
    destroyCharts();
    renderMetrics(metrics);
    renderTable(currentStudents, ($("attSearch") as HTMLInputElement)?.value || "");

    // 주간 트렌드 + 요일별 패턴 — 월간 누적 데이터 기반 (항상 표시)
    const trends = calculateWeeklyTrends();
    renderTrendChart(trends);

    const patterns = calculateDayPatterns();
    renderPatternChart(patterns);
    renderPatternInsights(patterns);

    // 조회 정보 표시
    const queryNow = new Date();
    const queryTime = `${String(queryNow.getHours()).padStart(2, "0")}:${String(queryNow.getMinutes()).padStart(2, "0")}`;
    if (statusEl) statusEl.textContent = `✅ ${roster.length}명 · ${date} 출결 조회 완료 (${queryTime} 조회)`;

    // 테이블 상단 조회 정보 배너
    const queryInfoEl = $("attQueryInfo");
    if (queryInfoEl) {
      const courseName = courseSelect?.selectedOptions[0]?.textContent || "";
      queryInfoEl.style.display = "";
      queryInfoEl.innerHTML = `📅 <strong>${date}</strong> 출결 현황 · ${courseName} ${deg}기 · <span class="att-query-time">조회 시각 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${queryTime}</span>`;
    }

    // Update risk management button
    updateRiskButton();

    // Show content, hide empty state
    const empty = $("attEmptyState");
    const content = $("attContent");
    if (empty) empty.style.display = "none";
    if (content) content.style.display = "block";
  } catch (e) {
    if (statusEl) statusEl.textContent = classifyApiError(e);
  }
}

// ─── 전체 과정/기수 출결 데이터 조회 (교차분석용) ────────────

/**
 * 등록된 전체 과정·기수의 출결 데이터를 HRD API에서 조회하여
 * currentStudents에 저장합니다. 교차분석 등 전체 데이터가 필요한 탭에서 사용.
 *
 * @returns 전체 학생 배열
 */
export async function fetchAllAttendanceData(
  onProgress?: (msg: string) => void,
): Promise<AttendanceStudent[]> {
  const config = loadHrdConfig();
  if (!config.courses.length) {
    throw new Error("등록된 과정이 없습니다. 설정에서 과정을 먼저 등록해주세요.");
  }

  currentConfig = config;
  const allStudents: AttendanceStudent[] = [];
  const totalJobs = config.courses.reduce((sum, c) => sum + c.degrs.length, 0);
  let done = 0;

  for (const course of config.courses) {
    for (const degr of course.degrs) {
      done++;
      onProgress?.(`${done}/${totalJobs} 조회 중... (${course.name} ${degr}기)`);

      try {
        const roster = await fetchRoster(config, course.trainPrId, degr);
        const daily = await fetchFullPeriodAttendance(config, course.trainPrId, degr, course);

        // 성별 데이터 로딩 (교차분석용)
        await loadGenderData(course.trainPrId, degr);

        if (roster.length === 0) continue;

        // 누적 일별 기록 구축
        const dailyRecords = buildAllDailyRecords(daily);
        // 기존 allDailyRecords에 병합 (이름 충돌 방지: 과정+기수 정보는 따로 매칭됨)
        for (const [name, records] of dailyRecords) {
          if (!allDailyRecords.has(name)) {
            allDailyRecords.set(name, records);
          } else {
            // 기존 레코드와 날짜 중복 없이 병합
            const existing = allDailyRecords.get(name)!;
            const existingDates = new Set(existing.map((r) => r.date));
            for (const r of records) {
              if (!existingDates.has(r.date)) existing.push(r);
            }
            existing.sort((a, b) => a.date.localeCompare(b.date));
          }
        }

        // 전체 월 데이터 기반 학생 빌드 (filterDate="" → 전체)
        const students = buildStudents(roster, daily, "", course, course.trainPrId, degr);
        allStudents.push(...students);
      } catch (e) {
        console.warn(`[FetchAll] ${course.name} ${degr}기 실패:`, e);
      }
    }
  }

  currentStudents = allStudents;
  return allStudents;
}

// ─── Data Getters (for reports) ──────────────────────────────
export function getCachedAttendanceStudents(): AttendanceStudent[] {
  return currentStudents;
}
export function getCachedDailyRecords(): Map<string, AttendanceDayRecord[]> {
  return allDailyRecords;
}
export function getCachedHrdConfig(): HrdConfig {
  return currentConfig;
}

// ─── Init ───────────────────────────────────────────────────

export function initAttendanceDashboard(): void {
  // Populate filters
  populateFilters();

  // Set default date to today
  const dateInput = $("attFilterDate") as HTMLInputElement | null;
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  // 필터 초기화
  $("attFilterReset")?.addEventListener("click", () => {
    for (const id of ["attFilterCourse", "attFilterDegr"]) {
      const el = $(id) as HTMLSelectElement | null;
      if (el) el.selectedIndex = 0;
    }
    const dateInput = $("attFilterDate") as HTMLInputElement | null;
    if (dateInput) dateInput.value = "";
    // 날짜 초기화 → 오늘
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  });

  // Query button
  const queryBtn = $("attQueryBtn");
  queryBtn?.addEventListener("click", fetchAndRender);

  // Search input
  const searchInput = $("attSearch") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    renderTable(currentStudents, searchInput.value);
  });

  // 날짜 변경 시 자동 재조회
  if (dateInput) {
    dateInput.addEventListener("change", () => {
      if (currentStudents.length > 0) fetchAndRender();
    });
  }

  // Detail modal close
  const closeBtn = $("attDetailClose");
  closeBtn?.addEventListener("click", () => {
    $("attDetailModal")?.classList.remove("active");
  });

  // Risk management panel
  const riskBtn = $("attRiskBtn");
  riskBtn?.addEventListener("click", openRiskPanel);
  const riskPanelClose = $("attRiskPanelClose");
  riskPanelClose?.addEventListener("click", () => {
    $("attRiskPanel")?.classList.remove("active");
  });

  // Settings section
  void renderHrdSettingsSection();
  setupSettingsHandlers();

  // Slack 스케줄러 시작
  startScheduler();

  // 발송 모달 이벤트: 관리대상 패널에서 현재 학생 데이터 전달
  window.addEventListener("requestNotifyModal", () => {
    import("./hrdNotify").then(({ openNotifyModal }) => {
      openNotifyModal(currentStudents);
    });
  });

  // 보조강사 모드: 페이지 로드 시 자동 조회
  if (getAssistantSession()) {
    void fetchAndRender();
  }
}
