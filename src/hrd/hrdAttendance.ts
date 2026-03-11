/** HRD 출결현황 대시보드 */
import { Chart, registerables } from "chart.js";
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
  AttendanceViewMode,
  SlackScheduleConfig,
} from "./hrdTypes";
import { ATTENDANCE_STATUS_CODE, isAbsentStatus, isAttendedStatus, isExcusedStatus, DEFAULT_SLACK_SCHEDULE } from "./hrdTypes";
import { sendSlackReport, testSlackWebhook, sendSlackReportDirect } from "./hrdSlack";
import { startScheduler, restartScheduler } from "./hrdScheduler";

Chart.register(...registerables);

// ─── State ──────────────────────────────────────────────────
let currentStudents: AttendanceStudent[] = [];
let allDailyRecords: Map<string, AttendanceDayRecord[]> = new Map(); // name → records
let chartInstances: Chart[] = [];
let currentConfig: HrdConfig = loadHrdConfig();

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

function normalizeTrainee(raw: HrdRawTrainee): { name: string; birth: string; dropout: boolean } {
  const nm = raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-";
  const br = (raw.lifyeaMd || raw.trneBrdt || raw.trneRrno || "").toString().replace(/[^0-9]/g, "");
  let birth = "-";
  if (br.length >= 8) birth = `${br.slice(0, 4)}.${br.slice(4, 6)}.${br.slice(6, 8)}`;
  else if (br.length >= 6) birth = `${br.slice(0, 2)}.${br.slice(2, 4)}.${br.slice(4, 6)}`;
  const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
  const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기");
  return { name: nm.trim(), birth, dropout };
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

/** 잔여 허용 결석일수 기반 위험등급 */
function getRiskLevel(remainingAbsent: number, totalDays: number): RiskLevel {
  if (totalDays === 0) return "safe"; // 설정 미완료
  if (remainingAbsent <= 0) return "danger";  // 제적 대상
  if (remainingAbsent <= 2) return "warning";  // 결석 2일 이내 제적
  if (remainingAbsent <= 5) return "caution";  // 결석 5일 이내 주의
  return "safe";
}

function getRiskLabel(level: RiskLevel): string {
  switch (level) {
    case "safe": return "안전";
    case "caution": return "주의";
    case "warning": return "경고";
    case "danger": return "위험";
  }
}

function getRiskEmoji(level: RiskLevel): string {
  switch (level) {
    case "safe": return "🟢";
    case "caution": return "🟡";
    case "warning": return "🟠";
    case "danger": return "🔴";
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
  course: HrdCourse | undefined
): AttendanceStudent[] {
  const dayStr = selectedDate.replace(/[^0-9]/g, "");
  const dayData = dayStr ? dailyRecords.filter((d) => ((d.atendDe || "").toString().replace(/[^0-9]/g, "")) === dayStr) : dailyRecords;

  const dailyMap = new Map<string, HrdRawAttendance>();
  for (const d of dayData) {
    const nm = normalizeName(d.cstmrNm || d.trneeCstmrNm || d.trneNm || "");
    if (nm) dailyMap.set(nm, d);
  }

  return roster.map((raw) => {
    const t = normalizeTrainee(raw);
    const key = normalizeName(t.name);
    const daily = dailyMap.get(key);

    const status: AttendanceStatus = daily ? resolveStatus(daily) : (t.dropout ? "중도탈락" : "-");
    const inTime = daily ? formatTime(daily.lpsilTime || daily.atendTmIn) : "";
    const outTime = daily ? formatTime(daily.levromTime || daily.atendTmOut) : "";

    // 누적 출결 통계 계산 (전체 훈련일수 기반)
    const records = allDailyRecords.get(key) || [];
    const totalDays = course?.totalDays || 0;
    const attendedDays = records.filter((r) => isAttendedStatus(r.status)).length;
    const absentDays = records.filter((r) => isAbsentStatus(r.status)).length;
    const excusedDays = records.filter((r) => isExcusedStatus(r.status)).length;
    const maxAbsent = totalDays > 0 ? Math.floor(totalDays * 0.2) : 0;
    const remainingAbsent = maxAbsent - absentDays;

    // 출석률: 출석인정일 / (전체훈련일 - 공결일) * 100
    const effectiveDays = totalDays > 0 ? totalDays - excusedDays : (records.length || 1);
    const attendanceRate = effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : (totalDays === 0 ? 100 : 0);

    const student: AttendanceStudent = {
      name: t.name,
      birth: t.birth,
      status,
      inTime,
      outTime,
      dropout: t.dropout,
      riskLevel: getRiskLevel(remainingAbsent, totalDays),
      totalDays,
      attendedDays,
      absentDays,
      excusedDays,
      maxAbsent,
      remainingAbsent,
      attendanceRate,
      missingCheckout: false,
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
  const earlyLeave = active.filter((s) =>
    s.status.includes("조퇴") || s.status.includes("외출"),
  ).length;
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
  const days = ["월", "화", "수", "목", "금"];
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

  // Sort: danger first, then by name
  filtered.sort((a, b) => {
    const riskOrder: Record<RiskLevel, number> = { danger: 0, warning: 1, caution: 2, safe: 3 };
    const diff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  tbody.innerHTML = filtered
    .map(
      (s, i) => `<tr class="${s.dropout ? "att-row-dropout" : ""} ${s.riskLevel === "danger" ? "att-row-danger" : s.riskLevel === "warning" ? "att-row-warning" : ""}">
    <td>${i + 1}</td>
    <td><span class="att-name-link" data-student="${s.name}">${s.name}</span></td>
    <td class="att-td-birth">${s.birth}</td>
    <td><span class="att-chip ${getStatusChipClass(s.status)}">${s.status}</span>${s.missingCheckout ? ' <span class="att-chip att-chip-missing">⚠️ 퇴실미체크</span>' : ""}</td>
    <td class="att-td-time">${s.inTime || "-"}</td>
    <td class="att-td-time">${s.outTime || "-"}</td>
    <td>${s.totalDays > 0 ? `${s.absentDays}/${s.maxAbsent}일` : `${s.attendanceRate.toFixed(1)}%`}</td>
    <td><span class="att-risk-badge att-risk-${s.riskLevel}">${getRiskEmoji(s.riskLevel)} ${getRiskLabel(s.riskLevel)}${s.totalDays > 0 && s.remainingAbsent > 0 ? ` (${s.remainingAbsent}일)` : ""}</span></td>
  </tr>`
    )
    .join("");

  // Table meta
  const meta = $("attTableMeta");
  if (meta) meta.textContent = `총 ${filtered.length}명${searchTerm ? ` (검색: "${searchTerm}")` : ""}`;

  // Attach name click events
  tbody.querySelectorAll(".att-name-link").forEach((el) => {
    el.addEventListener("click", () => {
      const name = (el as HTMLElement).dataset.student || "";
      openStudentDetail(name);
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

  const worst = [...patterns].sort((a, b) => (b.lateRate + b.absentRate) - (a.lateRate + a.absentRate))[0];
  if (worst && (worst.lateRate + worst.absentRate) > 10) {
    insights.unshift(`⚡ 가장 출결 이슈가 많은 요일: ${worst.day}요일`);
  }

  container.innerHTML = insights.length > 0
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
    riskEl.textContent = `${getRiskEmoji(student.riskLevel)} ${getRiskLabel(student.riskLevel)}`;
    riskEl.className = `att-detail-risk att-risk-${student.riskLevel}`;
  }

  // Summary cards
  const attended = records.filter((r) => isAttendedStatus(r.status)).length;
  const late = records.filter((r) => r.status.includes("지각")).length;
  const absent = records.filter((r) => isAbsentStatus(r.status)).length;

  const setSummary = (id: string, val: number) => { const el = $(id); if (el) el.textContent = String(val); };
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
      </tr>`
      )
      .join("");
  }

  modal.classList.add("active");
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
  const rateText = s.totalDays > 0
    ? `결석 ${s.absentDays}/${s.maxAbsent}일`
    : `${s.attendanceRate.toFixed(1)}%`;
  const remainText = s.totalDays > 0 && s.remainingAbsent > 0
    ? ` · 잔여 ${s.remainingAbsent}일`
    : s.remainingAbsent <= 0 && s.totalDays > 0 ? " · 제적대상" : "";
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
  const set = (id: string, val: number) => { const el = $(id); if (el) el.textContent = String(val); };
  set("attRpsDanger", danger.length);
  set("attRpsWarning", warning.length);
  set("attRpsCaution", caution.length);
  set("attRpsMissing", missing.length);

  // Render groups
  const renderGroup = (containerId: string, students: AttendanceStudent[], title: string, cssClass: string, reason: string) => {
    const container = $(containerId);
    if (!container) return;
    if (students.length === 0) { container.innerHTML = ""; return; }
    container.innerHTML = `<div class="att-risk-group-title ${cssClass}">${title} (${students.length}명)</div>`
      + students.map((s) => renderStudentRow(s, reason)).join("");
  };

  renderGroup("attRiskListDanger", danger, "🔴 위험 — 허용 결석일 초과 (제적 대상)", "rg-danger", "risk");
  renderGroup("attRiskListWarning", warning, "🟠 경고 — 잔여 결석 2일 이내", "rg-warning", "risk");
  renderGroup("attRiskListCaution", caution, "🟡 주의 — 잔여 결석 5일 이내", "rg-caution", "risk");
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
        const dropoutCount = currentStudents.filter(s => s.dropout).length;
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

function renderHrdSettingsSection(): void {
  const container = $("hrdSettingsSection");
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

  if (courseList) {
    courseList.innerHTML = currentConfig.courses.length === 0
      ? '<div class="att-empty-mini">등록된 과정이 없습니다. "기본 과정 복원" 버튼을 눌러주세요.</div>'
      : currentConfig.courses
          .map(
            (c, i) => `<div class="hrd-course-item">
          <div class="hrd-course-info">
            <strong>${c.name}</strong>
            <span class="hrd-course-meta">${c.trainPrId} | 기수: ${c.degrs.join(",")}기 (${c.degrs.length}개)${c.startDate ? ` | 개강: ${c.startDate}` : ""}${c.totalDays ? ` | ${c.totalDays}일` : ""}</span>
          </div>
          <button class="btn-sm btn-danger hrd-course-remove" data-idx="${i}">삭제</button>
        </div>`
          )
          .join("");

    courseList.querySelectorAll(".hrd-course-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
        currentConfig.courses.splice(idx, 1);
        saveHrdConfig(currentConfig);
        renderHrdSettingsSection();
        populateFilters();
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

  // 대상 과정 체크박스
  const coursesContainer = $("slackScheduleCourses");
  if (coursesContainer) {
    coursesContainer.innerHTML = config.courses.map((c) => {
      const checked = schedule.targetCourses.length === 0 || schedule.targetCourses.includes(c.trainPrId);
      return `<label class="slack-course-check ${checked ? "checked" : ""}">
        <input type="checkbox" value="${c.trainPrId}" ${checked ? "checked" : ""} />
        ${c.name}
      </label>`;
    }).join("");

    // 체크 상태 변경 시 시각 피드백
    coursesContainer.querySelectorAll("input[type='checkbox']").forEach((cb) => {
      cb.addEventListener("change", () => {
        const label = cb.closest(".slack-course-check");
        if (label) {
          label.classList.toggle("checked", (cb as HTMLInputElement).checked);
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

const HRD_KEY_GATE_PASSWORD = "admin";

function setupSettingsHandlers(): void {
  // ─── 접이식 섹션 토글 ──────────────────────────
  document.querySelectorAll<HTMLElement>("[data-settings-toggle]").forEach((header) => {
    header.addEventListener("click", () => {
      const body = header.nextElementSibling as HTMLElement | null;
      if (!body) return;
      const isExpanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", isExpanded ? "false" : "true");
      body.classList.toggle("is-collapsed", isExpanded);
    });
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); header.click(); }
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

  // API Key 잠금 해제 게이트
  const gateUnlockBtn = $("hrdKeyGateUnlock");
  const gatePasswordInput = $("hrdKeyGatePassword") as HTMLInputElement | null;
  const gateError = $("hrdKeyGateError");

  const unlockKeySection = () => {
    const pw = gatePasswordInput?.value?.trim() || "";
    if (pw === HRD_KEY_GATE_PASSWORD) {
      const gate = $("hrdKeyGate");
      const section = $("hrdKeySection");
      if (gate) gate.style.display = "none";
      if (section) section.style.display = "flex";
      if (gateError) gateError.style.display = "none";
      // Auth key 표시
      const keyInput = $("hrdAuthKey") as HTMLInputElement | null;
      if (keyInput) { keyInput.type = "text"; keyInput.value = currentConfig.authKey; }
    } else {
      if (gateError) { gateError.style.display = "block"; gateError.textContent = "비밀번호가 올바르지 않습니다"; }
      if (gatePasswordInput) { gatePasswordInput.value = ""; gatePasswordInput.focus(); }
    }
  };

  gateUnlockBtn?.addEventListener("click", unlockKeySection);
  gatePasswordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockKeySection();
  });

  // Save HRD settings
  const saveBtn = $("hrdSettingsSave");
  saveBtn?.addEventListener("click", () => {
    const key = ($("hrdAuthKey") as HTMLInputElement)?.value?.trim() || "";
    const proxy = ($("hrdProxy") as HTMLInputElement)?.value?.trim() || "";
    const slackUrl = ($("hrdSlackWebhook") as HTMLInputElement)?.value?.trim() || "";
    currentConfig.authKey = key;
    currentConfig.proxy = proxy;
    currentConfig.slackWebhookUrl = slackUrl || undefined;
    saveHrdConfig(currentConfig);
    const status = $("hrdTestStatus");
    if (status) { status.textContent = "✅ 저장됨"; status.className = "att-api-status att-api-ok"; }
  });

  // Test connection
  const testBtn = $("hrdTestBtn");
  testBtn?.addEventListener("click", async () => {
    const status = $("hrdTestStatus");
    if (status) { status.textContent = "테스트 중..."; status.className = "att-api-status"; }
    const config = loadHrdConfig();
    if (config.courses.length === 0) {
      if (status) { status.textContent = "❌ 등록된 과정이 없습니다"; status.className = "att-api-status att-api-err"; }
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

    if (!name || !id || !degrs) { alert("과정명, 훈련과정ID, 기수는 필수입니다."); return; }

    currentConfig.courses.push({
      name,
      trainPrId: id,
      degrs: degrs.split(",").map((d) => d.trim()),
      startDate: start || "",
      totalDays: totalDays || 0,
      endTime,
    });
    saveHrdConfig(currentConfig);
    renderHrdSettingsSection();
    populateFilters();

    // Clear inputs
    (["hrdNewCourseName", "hrdNewCourseId", "hrdNewCourseDegrs", "hrdNewCourseStart", "hrdNewCourseDays"] as const).forEach((id) => {
      const el = $(id) as HTMLInputElement | null;
      if (el) el.value = "";
    });
  });

  // Reset defaults
  const resetBtn = $("hrdResetDefaults");
  resetBtn?.addEventListener("click", () => {
    currentConfig.courses = DEFAULT_COURSES.map((c) => ({ ...c, degrs: [...c.degrs] }));
    saveHrdConfig(currentConfig);
    renderHrdSettingsSection();
    populateFilters();
    const status = $("hrdTestStatus");
    if (status) { status.textContent = `✅ 기본 과정 복원됨 (${DEFAULT_COURSES.length}개 과정)`; status.className = "att-api-status att-api-ok"; }
  });

  // Discover all degrs
  const discoverBtn = $("hrdDiscoverAll");
  discoverBtn?.addEventListener("click", async () => {
    const statusEl = $("hrdDiscoverStatus");
    if (statusEl) { statusEl.style.display = "block"; statusEl.textContent = "🔍 기수 탐색 시작..."; }
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
      } catch { /* ignore */ }
    }

    if (updated) {
      saveHrdConfig(config);
      currentConfig = config;
      renderHrdSettingsSection();
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
      if (statusEl) { statusEl.textContent = "Webhook URL을 입력해주세요."; statusEl.style.color = "#dc2626"; }
      return;
    }
    if (statusEl) { statusEl.textContent = "테스트 전송 중..."; statusEl.style.color = "#6b7280"; }
    if (slackTestBtn instanceof HTMLButtonElement) slackTestBtn.disabled = true;

    const result = await testSlackWebhook(url);
    if (statusEl) {
      statusEl.textContent = result.ok ? `✅ ${result.message}` : `❌ ${result.message}`;
      statusEl.style.color = result.ok ? "#059669" : "#dc2626";
    }
    if (slackTestBtn instanceof HTMLButtonElement) slackTestBtn.disabled = false;
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

    // 대상 과정 수집
    const targetCourses: string[] = [];
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
    }

    const schedule: SlackScheduleConfig = {
      enabled: toggle?.checked || false,
      hour: parseInt(hourSel?.value || "10"),
      minute: parseInt(minSel?.value || "0"),
      weekdaysOnly: weekdaySel?.value !== "daily",
      targetCourses,
      headerText: headerInput?.value?.trim() || DEFAULT_SLACK_SCHEDULE.headerText,
      footerText: footerInput?.value?.trim() || DEFAULT_SLACK_SCHEDULE.footerText,
      lastSentDate: config.slackSchedule?.lastSentDate,
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
      if (statusEl) { statusEl.textContent = "❌ Webhook URL을 먼저 설정해주세요"; statusEl.className = "slack-schedule-status slack-schedule-error"; }
      return;
    }

    if (testSendBtn instanceof HTMLButtonElement) { testSendBtn.disabled = true; testSendBtn.textContent = "전송 중..."; }
    const statusEl = $("slackScheduleStatus");
    if (statusEl) { statusEl.textContent = "⏳ 수동 전송 중..."; statusEl.className = "slack-schedule-status slack-schedule-info"; }

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
        if (statusEl) { statusEl.textContent = `✅ ${courseName} ${degr}기 리포트 전송 완료`; statusEl.className = "slack-schedule-status slack-schedule-success"; }
      } else {
        // 데이터 미로드 상태 — 테스트 메시지만 전송
        const result = await testSlackWebhook(webhookUrl);
        if (statusEl) {
          statusEl.textContent = result.ok ? "✅ 테스트 메시지 전송 완료" : `❌ ${result.message}`;
          statusEl.className = `slack-schedule-status ${result.ok ? "slack-schedule-success" : "slack-schedule-error"}`;
        }
      }
    } catch (e) {
      if (statusEl) { statusEl.textContent = `❌ 전송 실패: ${e instanceof Error ? e.message : String(e)}`; statusEl.className = "slack-schedule-status slack-schedule-error"; }
    }
    if (testSendBtn instanceof HTMLButtonElement) { testSendBtn.disabled = false; testSendBtn.textContent = "수동 전송 테스트"; }
  });
}

// ─── Filters ────────────────────────────────────────────────

function populateFilters(): void {
  const courseSelect = $("attFilterCourse") as HTMLSelectElement | null;
  const degrSelect = $("attFilterDegr") as HTMLSelectElement | null;
  if (!courseSelect) return;

  currentConfig = loadHrdConfig();
  courseSelect.innerHTML = currentConfig.courses.map((c) => `<option value="${c.trainPrId}">${c.name}</option>`).join("");

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
}

function getSelectedCourse(): HrdCourse | undefined {
  const courseSelect = $("attFilterCourse") as HTMLSelectElement | null;
  if (!courseSelect) return undefined;
  return currentConfig.courses.find((c) => c.trainPrId === courseSelect.value);
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
  const month = date.replace(/-/g, "").slice(0, 6);
  const course = getSelectedCourse();

  if (statusEl) statusEl.textContent = "데이터 조회 중...";

  try {
    currentConfig = loadHrdConfig();

    // Fetch roster + daily data in parallel
    const [roster, daily] = await Promise.all([
      fetchRoster(currentConfig, tid, deg),
      fetchDailyAttendance(currentConfig, tid, deg, month),
    ]);

    // Build cumulative records
    allDailyRecords = buildAllDailyRecords(daily);

    // Build students
    currentStudents = buildStudents(roster, daily, date, course);

    // Calculate metrics
    const metrics = calculateMetrics(currentStudents);

    // Render everything
    destroyCharts();
    renderMetrics(metrics);
    renderTable(currentStudents, ($("attSearch") as HTMLInputElement)?.value || "");

    const trends = calculateWeeklyTrends();
    renderTrendChart(trends);

    const patterns = calculateDayPatterns();
    renderPatternChart(patterns);
    renderPatternInsights(patterns);

    if (statusEl) statusEl.textContent = `✅ ${roster.length}명 조회 완료 (${date})`;

    // Update risk management button
    updateRiskButton();

    // Show content, hide empty state
    const empty = $("attEmptyState");
    const content = $("attContent");
    if (empty) empty.style.display = "none";
    if (content) content.style.display = "block";
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ─── Init ───────────────────────────────────────────────────

export function initAttendanceDashboard(): void {
  // Populate filters
  populateFilters();

  // Set default date to today
  const dateInput = $("attFilterDate") as HTMLInputElement | null;
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  // Query button
  const queryBtn = $("attQueryBtn");
  queryBtn?.addEventListener("click", fetchAndRender);

  // Search input
  const searchInput = $("attSearch") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    renderTable(currentStudents, searchInput.value);
  });

  // View mode buttons
  document.querySelectorAll("[data-att-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-att-view]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      // View mode changes will affect date range in fetchAndRender
    });
  });

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
  renderHrdSettingsSection();
  setupSettingsHandlers();

  // Slack 스케줄러 시작
  startScheduler();
}
