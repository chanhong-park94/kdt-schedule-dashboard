/**
 * 훈련생 분석 대시보드
 *
 * HRD API 데이터(명단/출결)를 기반으로
 * 인구통계, 출결 패턴, 탈락 요인을 분석합니다.
 */
import { Chart, registerables } from "chart.js";
import { loadHrdConfig } from "./hrdConfig";
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import type { HrdRawTrainee, HrdRawAttendance, HrdConfig, HrdCourse } from "./hrdTypes";
import { isAbsentStatus, isAttendedStatus, isExcusedStatus } from "./hrdTypes";
import type { TraineeAnalysis, AnalyticsSummary, InsightCard, AgeGroup } from "./hrdAnalyticsTypes";
import { getAgeGroup } from "./hrdAnalyticsTypes";

Chart.register(...registerables);

// ─── 차트 인스턴스 관리 ─────────────────────────────────────
const charts: Chart[] = [];
function destroyCharts(): void {
  for (const c of charts) c.destroy();
  charts.length = 0;
}

// ─── DOM 헬퍼 ───────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

// ─── 데이터 저장 ────────────────────────────────────────────
let analysisData: TraineeAnalysis[] = [];

// ─── 성별/연령 파싱 ──────────────────────────────────────────

function parseGender(raw: HrdRawTrainee): "남" | "여" | "미상" {
  // 1) 직접적인 성별 필드 확인
  const sexField = (
    raw.sexdstnSe || raw.trneSexdstnSe || raw.sexCd || raw.gndrCd || ""
  ).toString().trim();
  if (sexField === "M" || sexField === "남" || sexField === "1") return "남";
  if (sexField === "F" || sexField === "여" || sexField === "2") return "여";

  // 2) 주민번호 뒷자리 첫 숫자
  const rrno = (raw.trneRrno || "").toString().replace(/[^0-9]/g, "");
  if (rrno.length >= 7) {
    const g = rrno[6];
    if (g === "1" || g === "3") return "남";
    if (g === "2" || g === "4") return "여";
  }
  // 3) lifyeaMd 뒤에 성별코드가 붙는 경우
  const lify = (raw.lifyeaMd || "").toString().replace(/[^0-9]/g, "");
  if (lify.length >= 7) {
    const g = lify[6];
    if (g === "1" || g === "3") return "남";
    if (g === "2" || g === "4") return "여";
  }
  return "미상";
}

function parseBirthYYYYMMDD(raw: HrdRawTrainee): string {
  const br = (raw.lifyeaMd || raw.trneBrdt || raw.trneRrno || "").toString().replace(/[^0-9]/g, "");
  if (br.length >= 8) return br.slice(0, 8);
  if (br.length >= 6) {
    const yy = parseInt(br.slice(0, 2));
    // 주민번호 7번째 자리로 세기 판별
    const rrno = (raw.trneRrno || "").toString().replace(/[^0-9]/g, "");
    const genderDigit = rrno.length >= 7 ? rrno[6] : (br.length >= 7 ? br[6] : "");
    const century = (genderDigit === "3" || genderDigit === "4") ? 2000 : 1900;
    return `${century + yy}${br.slice(2, 6)}`;
  }
  return "";
}

function calcAge(birthYYYYMMDD: string): number {
  if (birthYYYYMMDD.length < 8) return -1;
  const y = parseInt(birthYYYYMMDD.slice(0, 4));
  const m = parseInt(birthYYYYMMDD.slice(4, 6));
  const d = parseInt(birthYYYYMMDD.slice(6, 8));
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) {
    age--;
  }
  return age;
}

// ─── 출결 상태 분류 ──────────────────────────────────────────

function resolveStatusStr(raw: HrdRawAttendance): string {
  return (raw.atendSttusNm || "").trim() || "-";
}

function isLateStatus(status: string): boolean {
  return status.includes("지각");
}

// ─── 데이터 수집 ────────────────────────────────────────────

async function collectAnalyticsData(
  onProgress?: (msg: string) => void,
): Promise<TraineeAnalysis[]> {
  const config = loadHrdConfig();
  if (!config.courses.length) {
    throw new Error("등록된 과정이 없습니다. 설정에서 과정을 먼저 등록해주세요.");
  }

  const results: TraineeAnalysis[] = [];
  const totalJobs = config.courses.reduce((sum, c) => sum + c.degrs.length, 0);
  let done = 0;

  for (const course of config.courses) {
    const category = course.category || "실업자";
    for (const degr of course.degrs) {
      done++;
      onProgress?.(`${done}/${totalJobs} 조회 중... (${course.name} ${degr}기)`);

      try {
        const roster = await fetchRoster(config, course.trainPrId, degr);
        // 디버그: 첫 명단의 원본 필드 확인 (성별 필드 탐색용)
        if (roster.length > 0 && done === 1) {
          const r = roster[0];
          console.log("[훈련생분석] 원본 필드 전체:", JSON.stringify(r, null, 2));
          console.log("[훈련생분석] 성별 관련 필드 →",
            "trneRrno:", JSON.stringify(r.trneRrno),
            "| lifyeaMd:", JSON.stringify(r.lifyeaMd),
            "| trneBrdt:", JSON.stringify(r.trneBrdt),
            "| sexdstnSe:", JSON.stringify(r.sexdstnSe),
            "| trneSexdstnSe:", JSON.stringify(r.trneSexdstnSe),
          );
          // 숫자만 추출 후 길이 확인
          const rrnoDigits = (r.trneRrno || "").toString().replace(/[^0-9]/g, "");
          const lifyDigits = (r.lifyeaMd || "").toString().replace(/[^0-9]/g, "");
          console.log("[훈련생분석] 숫자 추출 →",
            "rrno:", rrnoDigits, `(${rrnoDigits.length}자리)`,
            "| lify:", lifyDigits, `(${lifyDigits.length}자리)`,
          );
        }
        // 월별 출결 — 개강월부터 현재월까지
        const attendanceRecords = await fetchAllMonthlyAttendance(config, course, degr);

        for (const raw of roster) {
          const name = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").toString().trim();
          const gender = parseGender(raw);
          const birthStr = parseBirthYYYYMMDD(raw);
          const age = calcAge(birthStr);
          const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
          const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기");

          // 이 훈련생의 출결 레코드 필터
          const nameKey = name.replace(/\s+/g, "");
          const myRecords = attendanceRecords.filter((r) => {
            const rName = (r.cstmrNm || r.trneeCstmrNm || r.trneNm || "").toString().replace(/\s+/g, "");
            return rName === nameKey;
          });

          const statuses = myRecords.map((r) => resolveStatusStr(r));
          const attendedDays = statuses.filter((s) => isAttendedStatus(s)).length;
          const absentDays = statuses.filter((s) => isAbsentStatus(s)).length;
          const lateDays = statuses.filter((s) => isLateStatus(s)).length;
          const excusedDays = statuses.filter((s) => isExcusedStatus(s)).length;
          const totalDays = course.totalDays || 0;
          const effectiveDays = totalDays > 0 ? totalDays - excusedDays : (myRecords.length || 1);
          const attendanceRate = effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : 100;

          // 요일별 결석
          const absentByWeekday = [0, 0, 0, 0, 0, 0, 0];
          const absentByMonth: number[] = [];
          const startDate = course.startDate ? new Date(course.startDate) : null;

          for (let i = 0; i < myRecords.length; i++) {
            const dateRaw = (myRecords[i].atendDe || "").toString().replace(/[^0-9]/g, "");
            if (dateRaw.length < 8) continue;
            const dateStr = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
            const d = new Date(dateStr);
            const status = statuses[i];

            if (isAbsentStatus(status)) {
              absentByWeekday[d.getDay()]++;
              if (startDate) {
                const monthIdx = (d.getFullYear() - startDate.getFullYear()) * 12 +
                  (d.getMonth() - startDate.getMonth());
                while (absentByMonth.length <= monthIdx) absentByMonth.push(0);
                if (monthIdx >= 0) absentByMonth[monthIdx]++;
              }
            }
          }

          results.push({
            name, birth: birthStr, age, gender,
            courseName: course.name, trainPrId: course.trainPrId,
            category, degr,
            attendanceRate, absentDays, lateDays, excusedDays, attendedDays, totalDays,
            dropout,
            absentByWeekday, absentByMonth,
          });
        }
      } catch (e) {
        console.warn(`[Analytics] ${course.name} ${degr}기 조회 실패:`, e);
      }
    }
  }

  return results;
}

async function fetchAllMonthlyAttendance(
  config: HrdConfig,
  course: HrdCourse,
  degr: string,
): Promise<HrdRawAttendance[]> {
  const all: HrdRawAttendance[] = [];
  const start = course.startDate ? new Date(course.startDate) : new Date();
  const now = new Date();
  const startMonth = start.getFullYear() * 12 + start.getMonth();
  const endMonth = now.getFullYear() * 12 + now.getMonth();

  for (let m = startMonth; m <= endMonth; m++) {
    const y = Math.floor(m / 12);
    const mo = (m % 12) + 1;
    const monthStr = `${y}${String(mo).padStart(2, "0")}`;
    try {
      const records = await fetchDailyAttendance(config, course.trainPrId, degr, monthStr);
      all.push(...records);
    } catch {
      // skip failed month
    }
  }
  return all;
}

// ─── 요약 통계 ──────────────────────────────────────────────

function computeSummary(data: TraineeAnalysis[]): AnalyticsSummary {
  const total = data.length;
  const ages = data.filter((d) => d.age > 0).map((d) => d.age);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  const maleCount = data.filter((d) => d.gender === "남").length;
  const femaleCount = data.filter((d) => d.gender === "여").length;
  const unknownGenderCount = data.filter((d) => d.gender === "미상").length;
  const dropoutCount = data.filter((d) => d.dropout).length;
  const dropoutRate = total > 0 ? (dropoutCount / total) * 100 : 0;
  const avgAttendanceRate = total > 0
    ? data.reduce((sum, d) => sum + d.attendanceRate, 0) / total : 0;
  return { totalTrainees: total, avgAge, maleCount, femaleCount, unknownGenderCount, dropoutCount, dropoutRate, avgAttendanceRate };
}

// ─── 인사이트 자동 생성 ──────────────────────────────────────

function generateInsights(data: TraineeAnalysis[]): InsightCard[] {
  const insights: InsightCard[] = [];
  if (data.length < 5) return insights;

  const overallDropoutRate = data.filter((d) => d.dropout).length / data.length;

  // 연령대별 탈락률
  const ageGroups: AgeGroup[] = ["10대", "20대", "30대", "40대", "50대+"];
  for (const ag of ageGroups) {
    const group = data.filter((d) => d.age > 0 && getAgeGroup(d.age) === ag);
    if (group.length < 3) continue;
    const rate = group.filter((d) => d.dropout).length / group.length;
    if (rate > overallDropoutRate * 1.5 && rate > 0.05) {
      insights.push({
        icon: "📊",
        text: `${ag} 중도탈락률 ${(rate * 100).toFixed(1)}% — 전체 평균(${(overallDropoutRate * 100).toFixed(1)}%) 대비 ${(rate / overallDropoutRate).toFixed(1)}배`,
        severity: rate > overallDropoutRate * 2 ? "danger" : "warning",
      });
    }
  }

  // 성별 × 과정유형 탈락률
  for (const gender of ["남", "여"] as const) {
    for (const cat of ["재직자", "실업자"] as const) {
      const group = data.filter((d) => d.gender === gender && d.category === cat);
      if (group.length < 3) continue;
      const rate = group.filter((d) => d.dropout).length / group.length;
      if (rate > overallDropoutRate * 1.5 && rate > 0.05) {
        insights.push({
          icon: gender === "남" ? "👨" : "👩",
          text: `${gender}성 ${cat} 과정 탈락률 ${(rate * 100).toFixed(1)}% — 전체 평균 대비 ${(rate / overallDropoutRate).toFixed(1)}배`,
          severity: rate > overallDropoutRate * 2 ? "danger" : "warning",
        });
      }
    }
  }

  // 결석 임계점 분석
  const absentThresholds = [3, 5];
  for (const thresh of absentThresholds) {
    const above = data.filter((d) => d.absentDays >= thresh);
    const below = data.filter((d) => d.absentDays < thresh);
    if (above.length < 3 || below.length < 3) continue;
    const aboveRate = above.filter((d) => d.dropout).length / above.length;
    const belowRate = below.filter((d) => d.dropout).length / below.length;
    if (belowRate > 0 && aboveRate / belowRate >= 2) {
      insights.push({
        icon: "⚠️",
        text: `결석 ${thresh}회 이상 훈련생 탈락 확률 ${(aboveRate * 100).toFixed(0)}% — ${thresh}회 미만(${(belowRate * 100).toFixed(0)}%) 대비 ${(aboveRate / belowRate).toFixed(1)}배`,
        severity: "warning",
      });
      break; // 하나만
    }
  }

  // 요일별 결석 집중
  const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const d of data) {
    for (let i = 0; i < 7; i++) weekdayTotals[i] += d.absentByWeekday[i];
  }
  const totalAbsent = weekdayTotals.reduce((a, b) => a + b, 0);
  if (totalAbsent > 0) {
    const maxIdx = weekdayTotals.indexOf(Math.max(...weekdayTotals));
    const minIdx = weekdayTotals.slice(1, 6).indexOf(Math.min(...weekdayTotals.slice(1, 6))) + 1; // 평일만
    const maxRate = weekdayTotals[maxIdx] / totalAbsent;
    if (maxRate > 0.25 && weekdayTotals[minIdx] > 0) {
      insights.push({
        icon: "📅",
        text: `${weekdayNames[maxIdx]}요일 결석 집중 (${(maxRate * 100).toFixed(0)}%) — ${weekdayNames[minIdx]}요일 대비 ${(weekdayTotals[maxIdx] / weekdayTotals[minIdx]).toFixed(1)}배`,
        severity: "info",
      });
    }
  }

  return insights;
}

// ─── 차트 렌더링 ────────────────────────────────────────────

function renderOverviewTab(data: TraineeAnalysis[], summary: AnalyticsSummary): void {
  // 요약 카드
  const cardEl = $("analyticsCards");
  if (cardEl) {
    const genderStr = summary.totalTrainees > 0
      ? `남 ${Math.round(summary.maleCount / summary.totalTrainees * 100)}% / 여 ${Math.round(summary.femaleCount / summary.totalTrainees * 100)}%`
      : "-";
    cardEl.innerHTML = `
      <div class="ana-card"><div class="ana-card-value">${summary.totalTrainees}명</div><div class="ana-card-label">전체 훈련생</div></div>
      <div class="ana-card"><div class="ana-card-value">${summary.avgAge > 0 ? summary.avgAge.toFixed(1) + "세" : "-"}</div><div class="ana-card-label">평균 연령</div></div>
      <div class="ana-card"><div class="ana-card-value">${genderStr}</div><div class="ana-card-label">성별 비율</div></div>
      <div class="ana-card"><div class="ana-card-value">${summary.dropoutRate.toFixed(1)}%</div><div class="ana-card-label">중도탈락률</div></div>
    `;
  }

  // 연령대 분포 Bar chart
  const ageCtx = ($("chartAgeDistribution") as HTMLCanvasElement)?.getContext("2d");
  if (ageCtx) {
    const groups: AgeGroup[] = ["10대", "20대", "30대", "40대", "50대+"];
    const counts = groups.map((g) => data.filter((d) => d.age > 0 && getAgeGroup(d.age) === g).length);
    charts.push(new Chart(ageCtx, {
      type: "bar",
      data: { labels: groups, datasets: [{ label: "인원", data: counts, backgroundColor: "#7c5cfc" }] },
      options: { responsive: true, plugins: { legend: { display: false }, title: { display: true, text: "연령대 분포" } } },
    }));
  }

  // 성별 Donut chart
  const genderCtx = ($("chartGenderDistribution") as HTMLCanvasElement)?.getContext("2d");
  if (genderCtx) {
    charts.push(new Chart(genderCtx, {
      type: "doughnut",
      data: {
        labels: ["남", "여", "미상"],
        datasets: [{ data: [summary.maleCount, summary.femaleCount, summary.unknownGenderCount], backgroundColor: ["#5b8ff9", "#f56c6c", "#ccc"] }],
      },
      options: { responsive: true, plugins: { title: { display: true, text: "성별 구성" } } },
    }));
  }

  // 과정별 인구 구성 Stacked bar
  const courseCtx = ($("chartCourseComposition") as HTMLCanvasElement)?.getContext("2d");
  if (courseCtx) {
    const courseNames = [...new Set(data.map((d) => d.courseName))];
    const maleData = courseNames.map((c) => data.filter((d) => d.courseName === c && d.gender === "남").length);
    const femaleData = courseNames.map((c) => data.filter((d) => d.courseName === c && d.gender === "여").length);
    charts.push(new Chart(courseCtx, {
      type: "bar",
      data: {
        labels: courseNames.map((n) => n.length > 15 ? n.slice(0, 15) + "…" : n),
        datasets: [
          { label: "남", data: maleData, backgroundColor: "#5b8ff9" },
          { label: "여", data: femaleData, backgroundColor: "#f56c6c" },
        ],
      },
      options: { responsive: true, plugins: { title: { display: true, text: "과정별 성별 구성" } }, scales: { x: { stacked: true }, y: { stacked: true } } },
    }));
  }
}

function renderRiskTab(data: TraineeAnalysis[], insights: InsightCard[]): void {
  // 인사이트 카드
  const insightEl = $("analyticsInsights");
  if (insightEl) {
    if (insights.length === 0) {
      insightEl.innerHTML = '<div class="ana-insight ana-insight-info">📊 데이터가 충분히 쌓이면 자동으로 인사이트가 생성됩니다.</div>';
    } else {
      insightEl.innerHTML = insights.map((ins) =>
        `<div class="ana-insight ana-insight-${ins.severity}">${ins.icon} ${ins.text}</div>`
      ).join("");
    }
  }

  // 요일별 결석률
  const wdCtx = ($("chartWeekdayAbsent") as HTMLCanvasElement)?.getContext("2d");
  if (wdCtx) {
    const weekdays = ["월", "화", "수", "목", "금"];
    const totals = [0, 0, 0, 0, 0];
    for (const d of data) {
      for (let i = 0; i < 5; i++) totals[i] += d.absentByWeekday[i + 1]; // 1=월~5=금
    }
    charts.push(new Chart(wdCtx, {
      type: "bar",
      data: { labels: weekdays, datasets: [{ label: "결석 횟수", data: totals, backgroundColor: "#f56c6c" }] },
      options: { responsive: true, plugins: { legend: { display: false }, title: { display: true, text: "요일별 결석 분포" } } },
    }));
  }

  // 월차별 결석 추이
  const monthCtx = ($("chartMonthlyAbsent") as HTMLCanvasElement)?.getContext("2d");
  if (monthCtx) {
    const maxMonths = Math.max(...data.map((d) => d.absentByMonth.length), 0);
    if (maxMonths > 0) {
      const labels = Array.from({ length: maxMonths }, (_, i) => `${i + 1}월차`);
      const totals = Array.from({ length: maxMonths }, () => 0);
      const excusedTotals = Array.from({ length: maxMonths }, () => 0);
      for (const d of data) {
        for (let i = 0; i < d.absentByMonth.length; i++) {
          totals[i] += d.absentByMonth[i];
        }
      }
      charts.push(new Chart(monthCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "결석", data: totals, borderColor: "#f56c6c", backgroundColor: "rgba(245,108,108,0.1)", fill: true },
          ],
        },
        options: { responsive: true, plugins: { title: { display: true, text: "월차별 결석 추이" } } },
      }));
    }
  }

  // 연령대별 탈락률
  const ageDropCtx = ($("chartAgeDropout") as HTMLCanvasElement)?.getContext("2d");
  if (ageDropCtx) {
    const groups: AgeGroup[] = ["10대", "20대", "30대", "40대", "50대+"];
    const empRates: number[] = [];
    const unempRates: number[] = [];
    for (const g of groups) {
      const emp = data.filter((d) => d.age > 0 && getAgeGroup(d.age) === g && d.category === "재직자");
      const unemp = data.filter((d) => d.age > 0 && getAgeGroup(d.age) === g && d.category === "실업자");
      empRates.push(emp.length > 0 ? (emp.filter((d) => d.dropout).length / emp.length) * 100 : 0);
      unempRates.push(unemp.length > 0 ? (unemp.filter((d) => d.dropout).length / unemp.length) * 100 : 0);
    }
    charts.push(new Chart(ageDropCtx, {
      type: "bar",
      data: {
        labels: groups,
        datasets: [
          { label: "재직자", data: empRates, backgroundColor: "#5b8ff9" },
          { label: "실업자", data: unempRates, backgroundColor: "#f7ba1e" },
        ],
      },
      options: { responsive: true, plugins: { title: { display: true, text: "연령대별 탈락률 (%)" } }, scales: { y: { min: 0 } } },
    }));
  }

  // 성별 × 과정유형별 탈락률
  const genderDropCtx = ($("chartGenderDropout") as HTMLCanvasElement)?.getContext("2d");
  if (genderDropCtx) {
    const labels = ["남-재직자", "남-실업자", "여-재직자", "여-실업자"];
    const combos: Array<{ gender: "남" | "여"; cat: "재직자" | "실업자" }> = [
      { gender: "남", cat: "재직자" }, { gender: "남", cat: "실업자" },
      { gender: "여", cat: "재직자" }, { gender: "여", cat: "실업자" },
    ];
    const rates = combos.map(({ gender, cat }) => {
      const group = data.filter((d) => d.gender === gender && d.category === cat);
      return group.length > 0 ? (group.filter((d) => d.dropout).length / group.length) * 100 : 0;
    });
    charts.push(new Chart(genderDropCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "탈락률 (%)", data: rates, backgroundColor: ["#5b8ff9", "#f7ba1e", "#f56c6c", "#67c23a"] }],
      },
      options: { responsive: true, plugins: { legend: { display: false }, title: { display: true, text: "성별 × 과정유형별 탈락률 (%)" } }, scales: { y: { min: 0 } } },
    }));
  }

  // 결석일수 vs 탈락 scatter
  const scatterCtx = ($("chartAbsentScatter") as HTMLCanvasElement)?.getContext("2d");
  if (scatterCtx) {
    const active = data.filter((d) => !d.dropout).map((d) => ({ x: d.absentDays, y: d.attendanceRate }));
    const dropped = data.filter((d) => d.dropout).map((d) => ({ x: d.absentDays, y: d.attendanceRate }));
    charts.push(new Chart(scatterCtx, {
      type: "scatter",
      data: {
        datasets: [
          { label: "수료/재학", data: active, backgroundColor: "rgba(91,143,249,0.5)", pointRadius: 4 },
          { label: "중도탈락", data: dropped, backgroundColor: "rgba(245,108,108,0.7)", pointRadius: 5 },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: "결석일수 vs 출석률" } },
        scales: { x: { title: { display: true, text: "결석일수" } }, y: { title: { display: true, text: "출석률 (%)" }, min: 0, max: 110 } },
      },
    }));
  }
}

function renderDetailTab(data: TraineeAnalysis[]): void {
  applyFiltersAndRender(data);

  // 필터 이벤트
  for (const id of ["anaFilterCourse", "anaFilterDegr", "anaFilterGender", "anaFilterAge", "anaFilterStatus"]) {
    $(id)?.addEventListener("change", () => applyFiltersAndRender(data));
  }
}

function populateFilters(data: TraineeAnalysis[]): void {
  const courseSelect = $("anaFilterCourse") as HTMLSelectElement | null;
  const degrSelect = $("anaFilterDegr") as HTMLSelectElement | null;
  if (courseSelect) {
    const courses = [...new Set(data.map((d) => d.courseName))];
    courseSelect.innerHTML = '<option value="">전체 과정</option>' +
      courses.map((c) => `<option value="${c}">${c}</option>`).join("");
  }
  if (degrSelect) {
    const degrs = [...new Set(data.map((d) => d.degr))].sort((a, b) => parseInt(a) - parseInt(b));
    degrSelect.innerHTML = '<option value="">전체 기수</option>' +
      degrs.map((d) => `<option value="${d}">${d}기</option>`).join("");
  }
}

let sortCol = "name";
let sortAsc = true;

function applyFiltersAndRender(data: TraineeAnalysis[]): void {
  const course = ($("anaFilterCourse") as HTMLSelectElement)?.value || "";
  const degr = ($("anaFilterDegr") as HTMLSelectElement)?.value || "";
  const gender = ($("anaFilterGender") as HTMLSelectElement)?.value || "";
  const age = ($("anaFilterAge") as HTMLSelectElement)?.value || "";
  const status = ($("anaFilterStatus") as HTMLSelectElement)?.value || "";

  let filtered = data;
  if (course) filtered = filtered.filter((d) => d.courseName === course);
  if (degr) filtered = filtered.filter((d) => d.degr === degr);
  if (gender) filtered = filtered.filter((d) => d.gender === gender);
  if (age) filtered = filtered.filter((d) => d.age > 0 && getAgeGroup(d.age) === age);
  if (status === "dropout") filtered = filtered.filter((d) => d.dropout);
  if (status === "active") filtered = filtered.filter((d) => !d.dropout);

  // 정렬
  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortCol) {
      case "name": cmp = a.name.localeCompare(b.name); break;
      case "course": cmp = a.courseName.localeCompare(b.courseName); break;
      case "degr": cmp = parseInt(a.degr) - parseInt(b.degr); break;
      case "age": cmp = a.age - b.age; break;
      case "gender": cmp = a.gender.localeCompare(b.gender); break;
      case "rate": cmp = a.attendanceRate - b.attendanceRate; break;
      case "absent": cmp = a.absentDays - b.absentDays; break;
      case "status": cmp = (a.dropout ? 1 : 0) - (b.dropout ? 1 : 0); break;
    }
    return sortAsc ? cmp : -cmp;
  });

  const tbody = $("anaDetailBody");
  if (!tbody) return;

  const countEl = $("anaDetailCount");
  if (countEl) countEl.textContent = `${filtered.length}명`;

  tbody.innerHTML = filtered.map((d) => `<tr>
    <td>${d.name}</td>
    <td>${d.courseName.length > 12 ? d.courseName.slice(0, 12) + "…" : d.courseName}</td>
    <td>${d.degr}기</td>
    <td>${d.age > 0 ? d.age + "세" : "-"}</td>
    <td>${d.gender}</td>
    <td>${d.attendanceRate.toFixed(1)}%</td>
    <td>${d.absentDays}</td>
    <td><span class="ana-status-chip ${d.dropout ? "ana-status-dropout" : "ana-status-active"}">${d.dropout ? "탈락" : "재학"}</span></td>
  </tr>`).join("");
}

// ─── 탭 전환 ────────────────────────────────────────────────

function setupTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".ana-tab-btn");
  const panels = document.querySelectorAll<HTMLElement>(".ana-tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => (p.style.display = "none"));
      tab.classList.add("active");
      const target = tab.dataset.anaTab;
      const panel = document.getElementById(`anaPanel-${target}`);
      if (panel) panel.style.display = "block";
    });
  });
}

// ─── 테이블 헤더 정렬 ───────────────────────────────────────

function setupTableSort(): void {
  const headers = document.querySelectorAll<HTMLElement>("[data-ana-sort]");
  headers.forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.dataset.anaSort || "name";
      if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
      headers.forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
      th.classList.add(sortAsc ? "sort-asc" : "sort-desc");
      applyFiltersAndRender(analysisData);
    });
  });
}

// ─── 공개 초기화 함수 ───────────────────────────────────────

export function initAnalytics(): void {
  setupTabs();
  setupTableSort();

  const fetchBtn = $("analyticsFetchBtn");
  const statusEl = $("analyticsStatus");
  const contentEl = $("analyticsContent");
  const emptyEl = $("analyticsEmpty");

  fetchBtn?.addEventListener("click", async () => {
    if (!fetchBtn || !statusEl) return;
    (fetchBtn as HTMLButtonElement).disabled = true;
    statusEl.textContent = "조회 중...";
    statusEl.className = "ana-status ana-status-info";

    try {
      destroyCharts();
      analysisData = await collectAnalyticsData((msg) => {
        statusEl.textContent = msg;
      });

      if (analysisData.length === 0) {
        statusEl.textContent = "조회된 훈련생이 없습니다.";
        statusEl.className = "ana-status ana-status-warning";
        return;
      }

      const summary = computeSummary(analysisData);
      const insights = generateInsights(analysisData);

      if (emptyEl) emptyEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";

      renderOverviewTab(analysisData, summary);
      renderRiskTab(analysisData, insights);
      populateFilters(analysisData);
      renderDetailTab(analysisData);

      statusEl.textContent = `✅ ${analysisData.length}명 분석 완료`;
      statusEl.className = "ana-status ana-status-success";

      // PDF 버튼 활성화
      const pdfBtn = $("analyticsPdfBtn") as HTMLButtonElement | null;
      if (pdfBtn) pdfBtn.disabled = false;
    } catch (e) {
      statusEl.textContent = `❌ ${e instanceof Error ? e.message : "조회 실패"}`;
      statusEl.className = "ana-status ana-status-error";
    } finally {
      (fetchBtn as HTMLButtonElement).disabled = false;
    }
  });

  // PDF 버튼
  $("analyticsPdfBtn")?.addEventListener("click", () => {
    if (analysisData.length === 0) { alert("데이터를 먼저 조회하세요."); return; }
    printAnalyticsReport(analysisData);
  });
}

// ─── PDF 출력 ──────────────────────────────────────────────

function printAnalyticsReport(data: TraineeAnalysis[]): void {
  const summary = computeSummary(data);
  const insights = generateInsights(data);
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;

  // 연령대 분포
  const ageGroups: AgeGroup[] = ["10대", "20대", "30대", "40대", "50대+"];
  const ageCounts = ageGroups.map((g) => data.filter((d) => d.age > 0 && getAgeGroup(d.age) === g).length);
  const maxAgeCount = Math.max(...ageCounts, 1);

  // 과정별 통계
  const courseNames = [...new Set(data.map((d) => d.courseName))];
  const courseStats = courseNames.map((name) => {
    const group = data.filter((d) => d.courseName === name);
    const dropouts = group.filter((d) => d.dropout).length;
    const avgRate = group.reduce((s, d) => s + d.attendanceRate, 0) / (group.length || 1);
    return { name, count: group.length, dropouts, dropoutRate: group.length > 0 ? (dropouts / group.length * 100) : 0, avgRate };
  });

  // 요일별 결석
  const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const d of data) {
    for (let i = 0; i < 7; i++) weekdayTotals[i] += d.absentByWeekday[i];
  }
  const maxWeekday = Math.max(...weekdayTotals, 1);

  // 상세 데이터 (탈락자 우선, 출석률 낮은 순)
  const sorted = [...data].sort((a, b) => {
    if (a.dropout !== b.dropout) return a.dropout ? -1 : 1;
    return a.attendanceRate - b.attendanceRate;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>훈련생 분석 리포트</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Noto Sans KR', sans-serif; color: #1e293b; background: #fff; padding: 20px 30px; font-size: 12px; line-height: 1.5; }
@page { margin: 12mm; size: A4; }
@media print { .no-print { display: none !important; } body { padding: 0; } }
.no-print { position: fixed; top: 16px; right: 16px; z-index: 999; }
.no-print button { padding: 10px 24px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
.subtitle { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
h2 { font-size: 15px; font-weight: 700; color: #374151; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e5e7eb; }
h3 { font-size: 13px; font-weight: 700; color: #374151; margin: 14px 0 6px; }

.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
.card-value { font-size: 22px; font-weight: 800; color: #1e293b; }
.card-label { font-size: 10px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .3px; }

.bar-chart { margin: 6px 0 12px; }
.bar-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.bar-label { width: 36px; text-align: right; font-size: 11px; color: #6b7280; font-weight: 600; }
.bar-track { flex: 1; height: 18px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding-left: 6px; font-size: 10px; color: #fff; font-weight: 700; min-width: 1px; }

.insight { padding: 8px 12px; border-radius: 6px; font-size: 11px; font-weight: 500; margin-bottom: 4px; }
.insight.info { background: #eff6ff; color: #1e40af; }
.insight.warning { background: #fef3c7; color: #92400e; }
.insight.danger { background: #fee2e2; color: #991b1b; }

table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
th { background: #f1f5f9; font-weight: 700; text-align: left; padding: 6px 8px; border-bottom: 2px solid #d1d5db; }
td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
tr:nth-child(even) { background: #fafbfc; }
.chip { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
.chip-dropout { background: #fee2e2; color: #991b1b; }
.chip-active { background: #dcfce7; color: #166534; }

.course-table th { font-size: 11px; }
.page-break { page-break-before: always; }
</style></head><body>
<div class="no-print"><button onclick="window.print()">PDF 저장 / 인쇄</button></div>

<h1>훈련생 분석 리포트</h1>
<div class="subtitle">${dateStr} 기준 · ${courseNames.length}개 과정 · ${data.length}명</div>

<div class="cards">
  <div class="card"><div class="card-value">${summary.totalTrainees}명</div><div class="card-label">전체 훈련생</div></div>
  <div class="card"><div class="card-value">${summary.avgAge > 0 ? summary.avgAge.toFixed(1) + "세" : "-"}</div><div class="card-label">평균 연령</div></div>
  <div class="card"><div class="card-value">남 ${summary.maleCount} / 여 ${summary.femaleCount}</div><div class="card-label">성별 구성</div></div>
  <div class="card"><div class="card-value">${summary.dropoutRate.toFixed(1)}%</div><div class="card-label">중도탈락률 (${summary.dropoutCount}명)</div></div>
</div>

<h2>연령대 분포</h2>
<div class="bar-chart">
${ageGroups.map((g, i) => `<div class="bar-row">
  <span class="bar-label">${g}</span>
  <div class="bar-track"><div class="bar-fill" style="width:${(ageCounts[i] / maxAgeCount * 100).toFixed(0)}%;background:#7c5cfc;">${ageCounts[i]}</div></div>
</div>`).join("")}
</div>

<h2>요일별 결석 분포</h2>
<div class="bar-chart">
${weekdayNames.map((name, i) => `<div class="bar-row">
  <span class="bar-label">${name}</span>
  <div class="bar-track"><div class="bar-fill" style="width:${(weekdayTotals[i] / maxWeekday * 100).toFixed(0)}%;background:${i === 0 || i === 6 ? "#94a3b8" : "#f56c6c"};">${weekdayTotals[i]}</div></div>
</div>`).join("")}
</div>

<h2>과정별 현황</h2>
<table class="course-table">
<thead><tr><th>과정명</th><th>인원</th><th>평균출석률</th><th>탈락</th><th>탈락률</th></tr></thead>
<tbody>
${courseStats.map((c) => `<tr>
  <td>${c.name.length > 20 ? c.name.slice(0, 20) + "…" : c.name}</td>
  <td>${c.count}명</td>
  <td>${c.avgRate.toFixed(1)}%</td>
  <td>${c.dropouts}명</td>
  <td>${c.dropoutRate.toFixed(1)}%</td>
</tr>`).join("")}
</tbody></table>

${insights.length > 0 ? `<h2>자동 인사이트</h2>
${insights.map((i) => `<div class="insight ${i.severity}">${i.icon} ${i.text}</div>`).join("")}` : ""}

<div class="page-break"></div>
<h2>상세 데이터</h2>
<table>
<thead><tr><th>이름</th><th>과정</th><th>기수</th><th>연령</th><th>성별</th><th>출석률</th><th>결석</th><th>지각</th><th>공결</th><th>상태</th></tr></thead>
<tbody>
${sorted.map((d) => `<tr>
  <td>${d.name}</td>
  <td>${d.courseName.length > 14 ? d.courseName.slice(0, 14) + "…" : d.courseName}</td>
  <td>${d.degr}기</td>
  <td>${d.age > 0 ? d.age + "세" : "-"}</td>
  <td>${d.gender}</td>
  <td>${d.attendanceRate.toFixed(1)}%</td>
  <td>${d.absentDays}</td>
  <td>${d.lateDays}</td>
  <td>${d.excusedDays}</td>
  <td><span class="chip ${d.dropout ? "chip-dropout" : "chip-active"}">${d.dropout ? "탈락" : "재학"}</span></td>
</tr>`).join("")}
</tbody></table>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
