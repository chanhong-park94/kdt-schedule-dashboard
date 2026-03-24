/**
 * 훈련생 분석 대시보드
 *
 * HRD API 데이터(명단/출결)를 기반으로
 * 인구통계, 출결 패턴, 탈락 요인을 분석합니다.
 */
import { Chart, registerables } from "chart.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readClientEnv } from "../core/env";
import { loadHrdConfig } from "./hrdConfig";
import { classifyApiError } from "./hrdCacheUtils";
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import type { HrdRawTrainee, HrdRawAttendance, HrdConfig, HrdCourse, TraineeGender } from "./hrdTypes";
import { isAbsentStatus, isAttendedStatus, isExcusedStatus } from "./hrdTypes";
import type { TraineeAnalysis, AnalyticsSummary, InsightCard } from "./hrdAnalyticsTypes";
import { getAgeGroup } from "./hrdAnalyticsTypes";

// ─── Supabase Client (성별 조회용) ──────────────────────────
const _anaUrl = readClientEnv(["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]);
const _anaKey = readClientEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
const _anaUrlStr = typeof _anaUrl === "string" ? _anaUrl.trim() : "";
const _anaKeyStr = typeof _anaKey === "string" ? _anaKey.trim() : "";
const anaClient: SupabaseClient | null =
  _anaUrlStr.length > 0 && _anaKeyStr.length > 0
    ? createClient(_anaUrlStr, _anaKeyStr, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      })
    : null;

async function loadAllGenderData(): Promise<Map<string, TraineeGender>> {
  const map = new Map<string, TraineeGender>();
  if (!anaClient) return map;
  try {
    const { data } = await anaClient.from("trainee_gender").select("train_pr_id, degr, trainee_name, gender");
    if (data) {
      for (const row of data) {
        map.set(`${row.train_pr_id}|${row.degr}|${row.trainee_name}`, (row.gender || "") as TraineeGender);
      }
    }
  } catch (e) {
    console.warn("[Analytics] 성별 로드 실패:", e);
  }
  return map;
}

Chart.register(...registerables);

// ─── 차트 인스턴스 관리 ─────────────────────────────────────
const charts: Chart[] = [];
function destroyCharts(): void {
  for (const c of charts) c.destroy();
  charts.length = 0;
}

// ─── DOM 헬퍼 ───────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

/** 출석률 포맷: -1이면 "N/A" (데이터 없음), 아니면 소수점 1자리% */
function fmtRate(rate: number): string {
  return rate < 0 ? "N/A" : `${rate.toFixed(1)}%`;
}

// ─── 데이터 저장 ────────────────────────────────────────────
let analysisData: TraineeAnalysis[] = [];
let activeCourseStatusFilter: "" | "진행중" | "종강" = "진행중";
const CACHE_KEY = "kdt_analytics_cache_v1";

// ─── 연령 파싱 ──────────────────────────────────────────────

function parseBirthYYYYMMDD(raw: HrdRawTrainee): string {
  const br = (raw.lifyeaMd || raw.trneBrdt || raw.trneRrno || "").toString().replace(/[^0-9]/g, "");
  if (br.length >= 8) return br.slice(0, 8);
  if (br.length >= 6) {
    const yy = parseInt(br.slice(0, 2));
    const century = yy <= 30 ? 2000 : 1900;
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

async function collectAnalyticsData(onProgress?: (msg: string) => void): Promise<TraineeAnalysis[]> {
  const config = loadHrdConfig();
  if (!config.courses.length) {
    throw new Error("등록된 과정이 없습니다. 설정에서 과정을 먼저 등록해주세요.");
  }

  // 성별 데이터 미리 로드
  const genderMap = await loadAllGenderData();

  const results: TraineeAnalysis[] = [];
  const totalJobs = config.courses.reduce((sum, c) => sum + c.degrs.length, 0);
  let done = 0;

  for (const course of config.courses) {
    const category = course.category || "실업자";
    // 과정 상태 판정: startDate + totalDays 기반, 없으면 명단 훈련상태로 판단
    let courseStatusFromDate: "진행중" | "종강" | null = null;
    let courseProgressRate = 0;
    if (course.startDate && course.totalDays > 0) {
      const estimatedEnd = new Date(course.startDate);
      estimatedEnd.setDate(estimatedEnd.getDate() + Math.ceil((course.totalDays / 5) * 7));
      courseStatusFromDate = estimatedEnd < new Date() ? "종강" : "진행중";
      const start = new Date(course.startDate);
      const now = new Date();
      let weekdaysPassed = 0;
      const cursor = new Date(start);
      while (cursor <= now && weekdaysPassed < course.totalDays) {
        const day = cursor.getDay();
        const isClassDay = category === "재직자" ? day >= 2 && day <= 6 : day >= 1 && day <= 5;
        if (isClassDay) weekdaysPassed++;
        cursor.setDate(cursor.getDate() + 1);
      }
      courseProgressRate = courseStatusFromDate === "종강" ? 100 : Math.min((weekdaysPassed / course.totalDays) * 100, 100);
    }
    for (const degr of course.degrs) {
      done++;
      onProgress?.(`${done}/${totalJobs} 조회 중... (${course.name} ${degr}기)`);

      try {
        const roster = await fetchRoster(config, course.trainPrId, degr);
        // 월별 출결 — 개강월부터 현재월까지
        const attendanceRecords = await fetchAllMonthlyAttendance(config, course, degr);

        // courseStatus 결정: startDate 기반 → 없으면 명단 훈련상태로 판단
        let courseStatus: "진행중" | "종강" = courseStatusFromDate ?? "진행중";
        if (!courseStatusFromDate && roster.length > 0) {
          const hasTraining = roster.some((r) => {
            const st = (r.trneeSttusNm || r.atendSttsNm || r.stttsCdNm || "").toString();
            return st.includes("훈련중") || st.includes("참여중") || st === "";
          });
          courseStatus = hasTraining ? "진행중" : "종강";
        }

        for (const raw of roster) {
          const name = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").toString().trim();
          const birthStr = parseBirthYYYYMMDD(raw);
          const age = calcAge(birthStr);
          const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
          const completionStatus = stNm.trim() || "훈련중";
          const dropout = stNm.includes("중도탈락") || stNm.includes("수료포기") || stNm.includes("조기취업");

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
          const hasAttendanceData = myRecords.length > 0;
          const effectiveDays = totalDays > 0 ? totalDays - excusedDays : myRecords.length || 1;
          const attendanceRate = !hasAttendanceData
            ? -1
            : effectiveDays > 0
              ? (attendedDays / effectiveDays) * 100
              : 100;

          // 요일별 결석
          const absentByWeekday = [0, 0, 0, 0, 0, 0, 0];
          const absentByMonth: number[] = [];
          const startDate = course.startDate ? new Date(course.startDate) : null;

          // 연속결석 / 지각 시간대 / 주차별 출석 추적용
          let maxConsecutiveAbsent = 0;
          let currentConsecutiveAbsent = 0;
          const lateByHour = [0, 0, 0, 0, 0, 0]; // 7시~12시 (6칸)
          const weeklyBuckets: Array<{ attended: number; total: number }> = [];
          let lastAttendedDate: Date | null = null;

          // 날짜순 정렬된 레코드 (안전하게)
          const sortedIndices = myRecords
            .map((_, idx) => idx)
            .sort((a, b) => {
              const da = (myRecords[a].atendDe || "").toString().replace(/[^0-9]/g, "");
              const db = (myRecords[b].atendDe || "").toString().replace(/[^0-9]/g, "");
              return da.localeCompare(db);
            });

          for (const idx of sortedIndices) {
            const rec = myRecords[idx];
            const dateRaw = (rec.atendDe || "").toString().replace(/[^0-9]/g, "");
            if (dateRaw.length < 8) continue;
            const dateStr = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
            const d = new Date(dateStr);
            const status = statuses[idx];

            // 요일별/월차별 결석
            if (isAbsentStatus(status)) {
              absentByWeekday[d.getDay()]++;
              if (startDate) {
                const monthIdx =
                  (d.getFullYear() - startDate.getFullYear()) * 12 + (d.getMonth() - startDate.getMonth());
                while (absentByMonth.length <= monthIdx) absentByMonth.push(0);
                if (monthIdx >= 0) absentByMonth[monthIdx]++;
              }
            }

            // 연속결석 추적
            if (isAbsentStatus(status)) {
              currentConsecutiveAbsent++;
              if (currentConsecutiveAbsent > maxConsecutiveAbsent) maxConsecutiveAbsent = currentConsecutiveAbsent;
            } else if (isAttendedStatus(status) || isExcusedStatus(status)) {
              currentConsecutiveAbsent = 0;
              lastAttendedDate = d;
            }

            // 지각 시간대 분포
            if (isLateStatus(status)) {
              const timeIn = (rec.atendTmIn || rec.lpsilTime || "").toString().replace(/[^0-9]/g, "");
              if (timeIn.length >= 4) {
                const hour = parseInt(timeIn.slice(0, 2));
                if (hour >= 7 && hour <= 12) lateByHour[hour - 7]++;
              }
            }

            // 주차별 출석률 버킷
            if (startDate) {
              const daysDiff = Math.floor((d.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
              const weekIdx = Math.floor(daysDiff / 7);
              if (weekIdx >= 0) {
                while (weeklyBuckets.length <= weekIdx) weeklyBuckets.push({ attended: 0, total: 0 });
                weeklyBuckets[weekIdx].total++;
                if (isAttendedStatus(status)) weeklyBuckets[weekIdx].attended++;
              }
            }
          }

          // 주차별 출석률 계산
          const weeklyAttendanceRates = weeklyBuckets.map((b) => (b.total > 0 ? (b.attended / b.total) * 100 : 100));

          // 탈락 시점 (주차)
          let dropoutWeekIdx = -1;
          if (dropout && lastAttendedDate && startDate) {
            const daysDiff = Math.floor((lastAttendedDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            dropoutWeekIdx = Math.max(0, Math.floor(daysDiff / 7));
          }

          // 경보 사유 판정
          const alertReasons: string[] = [];
          if (currentConsecutiveAbsent >= 3) alertReasons.push("연속결석");
          if (lateDays >= 5) alertReasons.push("상습지각");
          // 출석률 급락: 최근 2주 vs 이전 2주
          if (weeklyAttendanceRates.length >= 4) {
            const len = weeklyAttendanceRates.length;
            const recent2 = (weeklyAttendanceRates[len - 2] + weeklyAttendanceRates[len - 1]) / 2;
            const prev2 = (weeklyAttendanceRates[len - 4] + weeklyAttendanceRates[len - 3]) / 2;
            if (prev2 - recent2 >= 10) alertReasons.push("출석률 급락");
          }

          results.push({
            name,
            birth: birthStr,
            age,
            courseName: course.name,
            trainPrId: course.trainPrId,
            category,
            degr,
            attendanceRate,
            absentDays,
            lateDays,
            excusedDays,
            attendedDays,
            totalDays,
            dropout,
            hasAttendanceData,
            absentByWeekday,
            absentByMonth,
            maxConsecutiveAbsent,
            currentConsecutiveAbsent,
            lateByHour,
            weeklyAttendanceRates,
            dropoutWeekIdx,
            alertReasons,
            courseStatus,
            completionStatus,
            courseProgressRate,
            courseStartDate: course.startDate || "",
            gender: (genderMap.get(`${course.trainPrId}|${degr}|${name}`) || "") as TraineeGender,
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
  const now = new Date();

  // 개강일: startDate가 있으면 사용, 없으면 totalDays 기반으로 역산
  let start: Date;
  if (course.startDate) {
    start = new Date(course.startDate);
  } else if (course.totalDays > 0) {
    // totalDays로 개강일 역산 (주말 제외: 평일 기준 ≈ totalDays / 5 * 7)
    const estimatedCalendarDays = Math.ceil((course.totalDays / 5) * 7) + 30; // 여유 1개월
    start = new Date(now);
    start.setDate(start.getDate() - estimatedCalendarDays);
  } else {
    // 둘 다 없으면 24개월 전부터 조회
    start = new Date(now);
    start.setMonth(start.getMonth() - 24);
  }

  // 종료월: startDate + totalDays 기반 추정 or 현재월
  let endDate: Date;
  if (course.startDate && course.totalDays > 0) {
    const estimatedEnd = new Date(course.startDate);
    const calDays = Math.ceil((course.totalDays / 5) * 7) + 14; // 여유 2주
    estimatedEnd.setDate(estimatedEnd.getDate() + calDays);
    // 현재보다 미래면 현재까지만
    endDate = estimatedEnd < now ? estimatedEnd : now;
  } else {
    endDate = now;
  }

  const startMonth = start.getFullYear() * 12 + start.getMonth();
  const endMonth = endDate.getFullYear() * 12 + endDate.getMonth();

  for (let m = startMonth; m <= endMonth; m++) {
    const y = Math.floor(m / 12);
    const mo = (m % 12) + 1;
    const monthStr = `${y}${String(mo).padStart(2, "0")}`;
    try {
      const records = await fetchDailyAttendance(config, course.trainPrId, degr, monthStr);
      all.push(...records);
    } catch (err) {
      console.warn(`[Analytics] ${monthStr} 출결 조회 실패:`, err);
    }
  }
  return all;
}

// ─── 요약 통계 ──────────────────────────────────────────────

function computeSummary(data: TraineeAnalysis[]): AnalyticsSummary {
  const total = data.length;
  const ages = data.filter((d) => d.age > 0).map((d) => d.age);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  const dropoutCount = data.filter((d) => d.dropout).length;
  const dropoutRate = total > 0 ? (dropoutCount / total) * 100 : 0;
  // 출결 데이터가 있는 훈련생만 평균 출석률 계산
  const withData = data.filter((d) => d.hasAttendanceData);
  const avgAttendanceRate =
    withData.length > 0 ? withData.reduce((sum, d) => sum + d.attendanceRate, 0) / withData.length : 0;
  const consecutiveAbsentCount = data.filter((d) => !d.dropout && d.currentConsecutiveAbsent >= 3).length;
  // 수료율 (HRD-Net 상태 기반): "수료" 상태인 훈련생 / 전체
  const completionCount = data.filter(
    (d) => (d.completionStatus || "").includes("수료") && !(d.completionStatus || "").includes("포기"),
  ).length;
  const completionRate = total > 0 ? (completionCount / total) * 100 : 0;
  // 전체 훈련 진행률 (가중평균)
  const progressData = data.filter((d) => d.courseProgressRate > 0);
  const avgProgressRate =
    progressData.length > 0 ? progressData.reduce((s, d) => s + d.courseProgressRate, 0) / progressData.length : 0;
  return {
    totalTrainees: total,
    avgAge,
    dropoutCount,
    dropoutRate,
    avgAttendanceRate,
    consecutiveAbsentCount,
    completionRate,
    completionCount,
    avgProgressRate,
  };
}

// ─── 인사이트 자동 생성 ──────────────────────────────────────

function generateInsights(data: TraineeAnalysis[]): InsightCard[] {
  const insights: InsightCard[] = [];
  if (data.length < 5) return insights;

  const overallDropoutRate = data.filter((d) => d.dropout).length / data.length;

  // 연속결석 경고
  const consecutiveAbsentStudents = data.filter((d) => !d.dropout && d.currentConsecutiveAbsent >= 3);
  if (consecutiveAbsentStudents.length > 0) {
    insights.push({
      icon: "🚨",
      text: `연속결석 3일+ ${consecutiveAbsentStudents.length}명 — 즉시 면담 필요`,
      severity: "danger",
    });
  }

  // 상습지각 경고
  const habitualLateStudents = data.filter((d) => !d.dropout && d.lateDays >= 5);
  if (habitualLateStudents.length > 0) {
    insights.push({
      icon: "⏰",
      text: `상습지각 5회+ ${habitualLateStudents.length}명 — 지각 사유 확인 필요`,
      severity: "warning",
    });
  }

  // 과정유형별(재직자/실업자) 탈락률 비교
  for (const cat of ["재직자", "실업자"] as const) {
    const group = data.filter((d) => d.category === cat);
    if (group.length < 3) continue;
    const rate = group.filter((d) => d.dropout).length / group.length;
    if (rate > overallDropoutRate * 1.5 && rate > 0.05) {
      insights.push({
        icon: cat === "재직자" ? "🏢" : "📚",
        text: `${cat} 과정 탈락률 ${(rate * 100).toFixed(1)}% — 전체 평균(${(overallDropoutRate * 100).toFixed(1)}%) 대비 ${(rate / overallDropoutRate).toFixed(1)}배`,
        severity: rate > overallDropoutRate * 2 ? "danger" : "warning",
      });
    }
  }

  // 과정별 출석률 편차
  const courseNames = [...new Set(data.map((d) => d.courseName))];
  if (courseNames.length >= 2) {
    const courseRates = courseNames
      .map((c) => {
        const group = data.filter((d) => d.courseName === c && d.hasAttendanceData);
        return {
          name: c,
          avgRate: group.length > 0 ? group.reduce((s, d) => s + d.attendanceRate, 0) / group.length : -1,
          count: group.length,
        };
      })
      .filter((c) => c.count >= 3 && c.avgRate >= 0);
    if (courseRates.length >= 2) {
      const maxCourse = courseRates.reduce((a, b) => (a.avgRate > b.avgRate ? a : b));
      const minCourse = courseRates.reduce((a, b) => (a.avgRate < b.avgRate ? a : b));
      const gap = maxCourse.avgRate - minCourse.avgRate;
      if (gap > 5) {
        insights.push({
          icon: "📋",
          text: `과정 간 출석률 격차 ${gap.toFixed(1)}%p — ${minCourse.name.slice(0, 10)}(${minCourse.avgRate.toFixed(1)}%) vs ${maxCourse.name.slice(0, 10)}(${maxCourse.avgRate.toFixed(1)}%)`,
          severity: gap > 15 ? "danger" : "warning",
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

// ─── 종강 기수 상세 패널 ─────────────────────────────────────

function renderCourseDetailPanel(g: {
  course: string;
  degr: string;
  category: string;
  list: TraineeAnalysis[];
}): string {
  const list = g.list;
  const cnt = list.length;
  const ages = list.filter((d) => d.age > 0).map((d) => d.age);
  const avgAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : "-";
  const avgExcused = cnt > 0 ? (list.reduce((s, d) => s + d.excusedDays, 0) / cnt).toFixed(1) : "0";

  // 주요 결석 요일
  const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const d of list) {
    for (let i = 0; i < 7; i++) weekdayTotals[i] += d.absentByWeekday[i];
  }
  const topWeekdays = weekdayTotals
    .map((v, i) => ({ day: weekdayNames[i], count: v }))
    .filter((_, i) => i >= 1 && i <= 5)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // 중도탈락 시점
  const dropouts = list.filter((d) => d.dropout && d.dropoutWeekIdx >= 0);
  let dropoutTimingHtml = "<span style='color:#9ca3af;'>탈락 데이터 없음</span>";
  if (dropouts.length > 0) {
    const timingMap: Record<string, number> = {};
    for (const d of dropouts) {
      const label = `${d.dropoutWeekIdx + 1}주차`;
      timingMap[label] = (timingMap[label] || 0) + 1;
    }
    dropoutTimingHtml = Object.entries(timingMap)
      .sort((a, b) => b[1] - a[1])
      .map(([week, count]) => `${week}: ${count}명`)
      .join(", ");
  }

  // 훈련생별 상세
  const sorted = [...list].sort((a, b) => {
    if (a.dropout !== b.dropout) return a.dropout ? -1 : 1;
    return a.attendanceRate - b.attendanceRate;
  });

  return `<div class="ana-detail-content">
    <div class="ana-detail-stats">
      <div class="ana-detail-stat"><span class="ana-detail-stat-label">평균 나이</span><span class="ana-detail-stat-value">${avgAge}세</span></div>
      <div class="ana-detail-stat"><span class="ana-detail-stat-label">평균 공가/사유결석</span><span class="ana-detail-stat-value">${avgExcused}일</span></div>
      <div class="ana-detail-stat"><span class="ana-detail-stat-label">주요 결석 요일</span><span class="ana-detail-stat-value">${topWeekdays.map((w) => `${w.day}(${w.count}회)`).join(", ") || "-"}</span></div>
      <div class="ana-detail-stat"><span class="ana-detail-stat-label">중도탈락 시점</span><span class="ana-detail-stat-value">${dropoutTimingHtml}</span></div>
    </div>
    <table class="hrd-table" style="margin-top:8px;font-size:12px;">
      <thead><tr><th>이름</th><th>상태</th><th>출석률</th><th>결석</th><th>지각</th><th>공가</th><th>연속결석(최대)</th></tr></thead>
      <tbody>${sorted
        .map((d) => {
          const statusLabel = d.completionStatus || (d.dropout ? "중도탈락" : "훈련중");
          const isCompleted = statusLabel.includes("수료") && !statusLabel.includes("포기");
          const chipClass = d.dropout
            ? "ana-status-dropout"
            : isCompleted
              ? "ana-status-completed"
              : "ana-status-active";
          return `<tr>
          <td>${d.name}</td>
          <td><span class="ana-status-chip ${chipClass}">${statusLabel}</span></td>
          <td>${fmtRate(d.attendanceRate)}</td>
          <td>${d.absentDays}일</td>
          <td>${d.lateDays}일</td>
          <td>${d.excusedDays}일</td>
          <td>${d.maxConsecutiveAbsent}일</td>
        </tr>`;
        })
        .join("")}</tbody>
    </table>
  </div>`;
}

// ─── 차트 렌더링 ────────────────────────────────────────────

function renderOverviewTab(data: TraineeAnalysis[], summary: AnalyticsSummary): void {
  const atRiskActive = data.filter((d) => !d.dropout && d.hasAttendanceData && d.attendanceRate < 80);
  const filter = activeCourseStatusFilter;

  // ── 요약 카드 (필터별 차별화) ──
  const cardEl = $("analyticsCards");
  if (cardEl) {
    const hasRate = summary.avgAttendanceRate > 0;
    const rateClass = !hasRate
      ? ""
      : summary.avgAttendanceRate >= 90
        ? "ana-cell-good"
        : summary.avgAttendanceRate >= 80
          ? "ana-cell-warn"
          : "ana-cell-bad";
    const dropClass =
      summary.dropoutRate <= 5 ? "ana-cell-good" : summary.dropoutRate <= 15 ? "ana-cell-warn" : "ana-cell-bad";

    if (filter === "종강") {
      // 종강: 전체 훈련생 / 수료율 / 중도탈락률 / 평균 출석률
      const compClass =
        summary.completionRate >= 80
          ? "ana-cell-good"
          : summary.completionRate >= 60
            ? "ana-cell-warn"
            : "ana-cell-bad";
      cardEl.innerHTML = `
        <div class="ana-card"><div class="ana-card-value">${summary.totalTrainees}명</div><div class="ana-card-label">전체 훈련생</div></div>
        <div class="ana-card"><div class="ana-card-value ${compClass}">${summary.completionRate.toFixed(1)}%</div><div class="ana-card-label">수료율</div><div class="ana-card-sub">${summary.completionCount}명 수료</div></div>
        <div class="ana-card"><div class="ana-card-value ${dropClass}">${summary.dropoutRate.toFixed(1)}%</div><div class="ana-card-label">중도탈락률</div><div class="ana-card-sub">${summary.dropoutCount}명</div></div>
        <div class="ana-card"><div class="ana-card-value ${rateClass}">${hasRate ? summary.avgAttendanceRate.toFixed(1) + "%" : "N/A"}</div><div class="ana-card-label">평균 출석률</div></div>
      `;
    } else if (filter === "진행중") {
      // 진행중: 전체 훈련생 / 전체 훈련 진행률 / 중도탈락률 / 위험군 / 연속결석
      const progClass =
        summary.avgProgressRate >= 70
          ? "ana-cell-good"
          : summary.avgProgressRate >= 40
            ? "ana-cell-warn"
            : "ana-cell-bad";
      cardEl.innerHTML = `
        <div class="ana-card"><div class="ana-card-value">${summary.totalTrainees}명</div><div class="ana-card-label">전체 훈련생</div></div>
        <div class="ana-card"><div class="ana-card-value ${progClass}">${summary.avgProgressRate.toFixed(1)}%</div><div class="ana-card-label">전체 훈련 진행률</div></div>
        <div class="ana-card"><div class="ana-card-value ${dropClass}">${summary.dropoutRate.toFixed(1)}%</div><div class="ana-card-label">중도탈락률</div><div class="ana-card-sub">${summary.dropoutCount}명</div></div>
        <div class="ana-card"><div class="ana-card-value" style="color:${atRiskActive.length > 0 ? "#dc2626" : "#059669"}">${atRiskActive.length}명</div><div class="ana-card-label">위험군 (재학)</div><div class="ana-card-sub">출석률 80% 미만</div></div>
        <div class="ana-card"><div class="ana-card-value" style="color:${summary.consecutiveAbsentCount > 0 ? "#dc2626" : "#059669"}">${summary.consecutiveAbsentCount}명</div><div class="ana-card-label">연속결석 경고</div><div class="ana-card-sub">3일+ 연속결석</div></div>
      `;
    } else {
      // 전체: 기존 5개 카드
      cardEl.innerHTML = `
        <div class="ana-card"><div class="ana-card-value">${summary.totalTrainees}명</div><div class="ana-card-label">전체 훈련생</div></div>
        <div class="ana-card"><div class="ana-card-value ${rateClass}">${hasRate ? summary.avgAttendanceRate.toFixed(1) + "%" : "N/A"}</div><div class="ana-card-label">평균 출석률</div></div>
        <div class="ana-card"><div class="ana-card-value ${dropClass}">${summary.dropoutRate.toFixed(1)}%</div><div class="ana-card-label">중도탈락률</div><div class="ana-card-sub">${summary.dropoutCount}명</div></div>
        <div class="ana-card"><div class="ana-card-value" style="color:${atRiskActive.length > 0 ? "#dc2626" : "#059669"}">${atRiskActive.length}명</div><div class="ana-card-label">위험군 (재학)</div><div class="ana-card-sub">출석률 80% 미만</div></div>
        <div class="ana-card"><div class="ana-card-value" style="color:${summary.consecutiveAbsentCount > 0 ? "#dc2626" : "#059669"}">${summary.consecutiveAbsentCount}명</div><div class="ana-card-label">연속결석 경고</div><div class="ana-card-sub">3일+ 연속결석</div></div>
      `;
    }
  }

  // ── 과정·기수별 종합 현황표 ──
  const statusBody = $("anaCourseStatusBody");
  const statusFoot = $("anaCourseStatusFoot");
  const statusHead = $("anaCourseStatusHead");
  if (statusBody) {
    // 과정+기수 조합별 그룹
    interface CourseGroup {
      course: string;
      degr: string;
      category: string;
      list: TraineeAnalysis[];
      progressRate: number;
      startDate: string;
    }
    const groups: CourseGroup[] = [];
    for (const d of data) {
      let g = groups.find((x) => x.course === d.courseName && x.degr === d.degr);
      if (!g) {
        g = {
          course: d.courseName,
          degr: d.degr,
          category: d.category,
          list: [],
          progressRate: d.courseProgressRate,
          startDate: d.courseStartDate,
        };
        groups.push(g);
      }
      g.list.push(d);
    }
    groups.sort((a, b) => a.course.localeCompare(b.course) || parseInt(a.degr) - parseInt(b.degr));

    // 테이블 헤더 동적 변경
    if (statusHead) {
      if (filter === "종강") {
        statusHead.innerHTML = `<tr><th>과정명</th><th>기수</th><th>유형</th><th>인원</th><th>수료율</th><th>탈락률</th><th>이전기수 대비</th><th>평균출석률</th></tr>`;
      } else if (filter === "진행중") {
        statusHead.innerHTML = `<tr><th>과정명</th><th>기수</th><th>유형</th><th>인원</th><th>훈련 진행률</th><th>평균출석률</th><th>탈락</th><th>탈락률</th><th>위험군</th></tr>`;
      } else {
        statusHead.innerHTML = `<tr><th>과정명</th><th>기수</th><th>유형</th><th>인원</th><th>평균출석률</th><th>탈락</th><th>탈락률</th><th>위험군</th></tr>`;
      }
    }

    statusBody.innerHTML = groups
      .map((g) => {
        const cnt = g.list.length;
        const withData = g.list.filter((d) => d.hasAttendanceData);
        const avgRate = withData.length > 0 ? withData.reduce((s, d) => s + d.attendanceRate, 0) / withData.length : -1;
        const dropouts = g.list.filter((d) => d.dropout).length;
        const dropRate = (dropouts / cnt) * 100;
        const atRisk = g.list.filter((d) => !d.dropout && d.hasAttendanceData && d.attendanceRate < 80).length;
        const noData = avgRate < 0;
        const rateClass = noData
          ? ""
          : avgRate >= 90
            ? "ana-cell-good"
            : avgRate >= 80
              ? "ana-cell-warn"
              : "ana-cell-bad";
        const dropClass = dropRate <= 5 ? "ana-cell-good" : dropRate <= 15 ? "ana-cell-warn" : "ana-cell-bad";
        const riskClass = noData ? "" : atRisk === 0 ? "ana-cell-good" : atRisk <= 2 ? "ana-cell-warn" : "ana-cell-bad";
        const courseTd = `<td>${g.course.length > 18 ? g.course.slice(0, 18) + "…" : g.course}</td>`;

        if (filter === "종강") {
          // 수료율 계산
          const completed = g.list.filter(
            (d) => (d.completionStatus || "").includes("수료") && !(d.completionStatus || "").includes("포기"),
          ).length;
          const compRate = (completed / cnt) * 100;
          const compClass = compRate >= 80 ? "ana-cell-good" : compRate >= 60 ? "ana-cell-warn" : "ana-cell-bad";
          // 이전기수 대비 탈락률
          const prevDegr = String(parseInt(g.degr) - 1);
          const prevGroup = groups.find((x) => x.course === g.course && x.degr === prevDegr);
          let prevCompare = "-";
          if (prevGroup) {
            const prevDropRate = (prevGroup.list.filter((d) => d.dropout).length / prevGroup.list.length) * 100;
            const diff = dropRate - prevDropRate;
            const sign = diff > 0 ? "+" : "";
            const color = diff > 0 ? "#dc2626" : diff < 0 ? "#059669" : "#6b7280";
            prevCompare = `<span style="color:${color};font-weight:600;">${sign}${diff.toFixed(1)}%p</span>`;
          }
          const rowId = `anaRow_${g.course.replace(/[^a-zA-Z0-9가-힣]/g, "")}_${g.degr}`;
          return `<tr class="ana-expandable-row" data-row-id="${rowId}" style="cursor:pointer;" title="클릭하여 상세 보기">
            ${courseTd}
            <td>${g.degr}기</td>
            <td>${g.category}</td>
            <td>${cnt}명</td>
            <td class="${compClass}">${compRate.toFixed(1)}%</td>
            <td class="${dropClass}">${dropRate.toFixed(1)}%</td>
            <td>${prevCompare}</td>
            <td class="${rateClass}">${fmtRate(avgRate)}</td>
          </tr>
          <tr class="ana-detail-panel" id="${rowId}" style="display:none;">
            <td colspan="8">${renderCourseDetailPanel(g)}</td>
          </tr>`;
        } else if (filter === "진행중") {
          const progClass =
            g.progressRate >= 70 ? "ana-cell-good" : g.progressRate >= 40 ? "ana-cell-warn" : "ana-cell-bad";
          return `<tr>
            ${courseTd}
            <td>${g.degr}기</td>
            <td>${g.category}</td>
            <td>${cnt}명</td>
            <td class="${progClass}">${g.progressRate.toFixed(1)}%</td>
            <td class="${rateClass}">${fmtRate(avgRate)}</td>
            <td>${dropouts}명</td>
            <td class="${dropClass}">${dropRate.toFixed(1)}%</td>
            <td class="${riskClass}">${noData ? "-" : atRisk + "명"}</td>
          </tr>`;
        } else {
          return `<tr>
            ${courseTd}
            <td>${g.degr}기</td>
            <td>${g.category}</td>
            <td>${cnt}명</td>
            <td class="${rateClass}">${fmtRate(avgRate)}</td>
            <td>${dropouts}명</td>
            <td class="${dropClass}">${dropRate.toFixed(1)}%</td>
            <td class="${riskClass}">${noData ? "-" : atRisk + "명"}</td>
          </tr>`;
        }
      })
      .join("");

    // 종강 행 클릭 이벤트 (상세 패널 토글)
    if (filter === "종강") {
      statusBody.querySelectorAll<HTMLElement>(".ana-expandable-row").forEach((row) => {
        row.addEventListener("click", () => {
          const panelId = row.dataset.rowId || "";
          const panel = document.getElementById(panelId);
          if (panel) {
            const isHidden = panel.style.display === "none";
            panel.style.display = isHidden ? "" : "none";
            row.classList.toggle("ana-row-expanded", isHidden);
          }
        });
      });
    }

    // 합계 행
    if (statusFoot) {
      if (filter === "종강") {
        const totalComp = data.filter(
          (d) => (d.completionStatus || "").includes("수료") && !(d.completionStatus || "").includes("포기"),
        ).length;
        const totalCompRate = data.length > 0 ? (totalComp / data.length) * 100 : 0;
        const compClass =
          totalCompRate >= 80 ? "ana-cell-good" : totalCompRate >= 60 ? "ana-cell-warn" : "ana-cell-bad";
        statusFoot.innerHTML = `<tr>
          <td colspan="3"><strong>전체 합계</strong></td>
          <td><strong>${data.length}명</strong></td>
          <td class="${compClass}"><strong>${totalCompRate.toFixed(1)}%</strong></td>
          <td class="${summary.dropoutRate <= 5 ? "ana-cell-good" : summary.dropoutRate <= 15 ? "ana-cell-warn" : "ana-cell-bad"}"><strong>${summary.dropoutRate.toFixed(1)}%</strong></td>
          <td>-</td>
          <td class="${summary.avgAttendanceRate >= 90 ? "ana-cell-good" : summary.avgAttendanceRate >= 80 ? "ana-cell-warn" : "ana-cell-bad"}"><strong>${summary.avgAttendanceRate > 0 ? summary.avgAttendanceRate.toFixed(1) + "%" : "N/A"}</strong></td>
        </tr>`;
      } else if (filter === "진행중") {
        const totalRisk = atRiskActive.length;
        statusFoot.innerHTML = `<tr>
          <td colspan="3"><strong>전체 합계</strong></td>
          <td><strong>${data.length}명</strong></td>
          <td><strong>${summary.avgProgressRate.toFixed(1)}%</strong></td>
          <td class="${summary.avgAttendanceRate >= 90 ? "ana-cell-good" : summary.avgAttendanceRate >= 80 ? "ana-cell-warn" : "ana-cell-bad"}"><strong>${summary.avgAttendanceRate > 0 ? summary.avgAttendanceRate.toFixed(1) + "%" : "N/A"}</strong></td>
          <td><strong>${summary.dropoutCount}명</strong></td>
          <td class="${summary.dropoutRate <= 5 ? "ana-cell-good" : summary.dropoutRate <= 15 ? "ana-cell-warn" : "ana-cell-bad"}"><strong>${summary.dropoutRate.toFixed(1)}%</strong></td>
          <td class="${totalRisk === 0 ? "ana-cell-good" : "ana-cell-bad"}"><strong>${totalRisk}명</strong></td>
        </tr>`;
      } else {
        const totalRisk = atRiskActive.length;
        statusFoot.innerHTML = `<tr>
          <td colspan="3"><strong>전체 합계</strong></td>
          <td><strong>${data.length}명</strong></td>
          <td class="${summary.avgAttendanceRate >= 90 ? "ana-cell-good" : summary.avgAttendanceRate >= 80 ? "ana-cell-warn" : "ana-cell-bad"}"><strong>${summary.avgAttendanceRate > 0 ? summary.avgAttendanceRate.toFixed(1) + "%" : "N/A"}</strong></td>
          <td><strong>${summary.dropoutCount}명</strong></td>
          <td class="${summary.dropoutRate <= 5 ? "ana-cell-good" : summary.dropoutRate <= 15 ? "ana-cell-warn" : "ana-cell-bad"}"><strong>${summary.dropoutRate.toFixed(1)}%</strong></td>
          <td class="${totalRisk === 0 ? "ana-cell-good" : "ana-cell-bad"}"><strong>${totalRisk}명</strong></td>
        </tr>`;
      }
    }
  }

  // ── 재직자 vs 실업자 비교 ──
  const compareEl = $("anaCategoryCompare");
  if (compareEl) {
    const renderCat = (cat: "재직자" | "실업자", icon: string, color: string) => {
      const g = data.filter((d) => d.category === cat);
      if (g.length === 0) return "";
      const withData = g.filter((d) => d.hasAttendanceData);
      const avgRate = withData.length > 0 ? withData.reduce((s, d) => s + d.attendanceRate, 0) / withData.length : -1;
      const drops = g.filter((d) => d.dropout).length;
      const dropRate = (drops / g.length) * 100;
      const risk = g.filter((d) => !d.dropout && d.hasAttendanceData && d.attendanceRate < 80).length;
      const ages = g.filter((d) => d.age > 0).map((d) => d.age);
      const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
      const rateDisplay = avgRate < 0 ? "N/A" : `${avgRate.toFixed(1)}%`;
      const rateClass =
        avgRate < 0 ? "" : avgRate >= 90 ? "ana-cell-good" : avgRate >= 80 ? "ana-cell-warn" : "ana-cell-bad";
      return `<div class="ana-compare-card" style="border-top:3px solid ${color};">
        <h5>${icon} ${cat}</h5>
        <div class="ana-compare-row"><span class="ana-compare-label">인원</span><span class="ana-compare-value">${g.length}명</span></div>
        <div class="ana-compare-row"><span class="ana-compare-label">평균 출석률</span><span class="ana-compare-value ${rateClass}">${rateDisplay}</span></div>
        <div class="ana-compare-row"><span class="ana-compare-label">탈락률</span><span class="ana-compare-value ${dropRate <= 5 ? "ana-cell-good" : dropRate <= 15 ? "ana-cell-warn" : "ana-cell-bad"}">${dropRate.toFixed(1)}% (${drops}명)</span></div>
        <div class="ana-compare-row"><span class="ana-compare-label">위험군</span><span class="ana-compare-value" style="color:${risk > 0 ? "#dc2626" : "#059669"}">${risk}명</span></div>
        <div class="ana-compare-row"><span class="ana-compare-label">평균 연령</span><span class="ana-compare-value">${avgAge > 0 ? avgAge.toFixed(1) + "세" : "-"}</span></div>
      </div>`;
    };
    compareEl.innerHTML = renderCat("재직자", "🏢", "#5b8ff9") + renderCat("실업자", "📚", "#f7ba1e");
  }

  // ── 지각 시간대 분포 (horizontal bar) ──
  const lateHourCtx = ($("chartLateByHour") as HTMLCanvasElement)?.getContext("2d");
  if (lateHourCtx) {
    const hourLabels = ["7시대", "8시대", "9시대", "10시대", "11시대", "12시대"];
    const hourTotals = [0, 0, 0, 0, 0, 0];
    for (const d of data) {
      for (let i = 0; i < 6; i++) hourTotals[i] += d.lateByHour[i];
    }
    charts.push(
      new Chart(lateHourCtx, {
        type: "bar",
        data: {
          labels: hourLabels,
          datasets: [{ label: "지각 횟수", data: hourTotals, backgroundColor: "#f59e0b" }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          plugins: { legend: { display: false }, title: { display: true, text: "지각 시간대 분포" } },
          scales: { x: { title: { display: true, text: "지각 횟수" } } },
        },
      }),
    );
  }

  // ── 기수별 탈락률 추이 ──
  const degrDropCtx = ($("chartDegrDropout") as HTMLCanvasElement)?.getContext("2d");
  if (degrDropCtx) {
    const degrs = [...new Set(data.map((d) => d.degr))].sort((a, b) => parseInt(a) - parseInt(b));
    if (degrs.length >= 2) {
      const degrRates = degrs.map((dg) => {
        const group = data.filter((d) => d.degr === dg);
        return group.length > 0 ? +((group.filter((d) => d.dropout).length / group.length) * 100).toFixed(1) : 0;
      });
      const degrCounts = degrs.map((dg) => data.filter((d) => d.degr === dg).length);
      charts.push(
        new Chart(degrDropCtx, {
          type: "line",
          data: {
            labels: degrs.map((d) => `${d}기`),
            datasets: [
              {
                label: "탈락률 (%)",
                data: degrRates,
                borderColor: "#f56c6c",
                backgroundColor: "rgba(245,108,108,0.1)",
                fill: true,
                tension: 0.3,
                yAxisID: "y",
              },
              {
                label: "인원",
                data: degrCounts,
                borderColor: "#5b8ff9",
                backgroundColor: "rgba(91,143,249,0.1)",
                fill: false,
                borderDash: [5, 5],
                tension: 0.3,
                yAxisID: "y1",
              },
            ],
          },
          options: {
            responsive: true,
            plugins: { title: { display: true, text: "기수별 탈락률 추이" } },
            scales: {
              y: { type: "linear", position: "left", min: 0, title: { display: true, text: "탈락률 (%)" } },
              y1: {
                type: "linear",
                position: "right",
                min: 0,
                grid: { drawOnChartArea: false },
                title: { display: true, text: "인원" },
              },
            },
          },
        }),
      );
    } else {
      const parent = degrDropCtx.canvas.parentElement;
      if (parent)
        parent.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:180px;color:#9ca3af;font-size:13px;">2개 이상의 기수 데이터가 필요합니다</div>';
    }
  }
}

function renderRiskTab(data: TraineeAnalysis[], insights: InsightCard[]): void {
  const filter = activeCourseStatusFilter;
  // 인사이트 카드
  const insightEl = $("analyticsInsights");
  if (insightEl) {
    if (insights.length === 0) {
      insightEl.innerHTML =
        '<div class="ana-insight ana-insight-info">📊 데이터가 충분히 쌓이면 자동으로 인사이트가 생성됩니다.</div>';
    } else {
      insightEl.innerHTML = insights
        .map((ins) => `<div class="ana-insight ana-insight-${ins.severity}">${ins.icon} ${ins.text}</div>`)
        .join("");
    }
  }

  const contentEl = $("riskTabContent");
  if (!contentEl) return;

  if (filter === "종강") {
    renderRiskTabCompleted(contentEl, data);
  } else {
    renderRiskTabActive(contentEl, data);
  }
}

// ── 전체 / 진행중: 과정·기수별 카드 ──
function renderRiskTabActive(container: HTMLElement, data: TraineeAnalysis[]): void {
  // 과정·기수별 그룹
  interface RiskGroup {
    course: string;
    degr: string;
    list: TraineeAnalysis[];
    atRisk: TraineeAnalysis[];
  }
  const groups: RiskGroup[] = [];
  for (const d of data) {
    let g = groups.find((x) => x.course === d.courseName && x.degr === d.degr);
    if (!g) {
      g = { course: d.courseName, degr: d.degr, list: [], atRisk: [] };
      groups.push(g);
    }
    g.list.push(d);
    if (
      !d.dropout &&
      d.hasAttendanceData &&
      (d.attendanceRate < 80 || d.currentConsecutiveAbsent >= 3 || d.alertReasons.length > 0)
    ) {
      g.atRisk.push(d);
    }
  }
  groups.sort((a, b) => b.atRisk.length - a.atRisk.length || a.course.localeCompare(b.course));

  const totalAtRisk = groups.reduce((s, g) => s + g.atRisk.length, 0);

  let html = `<h4 style="margin:16px 0 8px">⚠️ 과정·기수별 조기경보</h4>
    <div class="risk-summary-bar">위험군 총 <strong>${totalAtRisk}명</strong> / 전체 ${data.length}명</div>`;

  if (totalAtRisk === 0) {
    html +=
      '<div style="text-align:center;padding:24px;color:#10b981;font-weight:600;">✅ 현재 위험군 훈련생이 없습니다</div>';
  } else {
    html += '<div class="risk-group-list">';
    for (const g of groups) {
      const withData = g.list.filter((d) => d.hasAttendanceData);
      const avgRate = withData.length > 0 ? withData.reduce((s, d) => s + d.attendanceRate, 0) / withData.length : -1;
      const consAbsent = g.list.filter((d) => !d.dropout && d.currentConsecutiveAbsent >= 3).length;
      const riskCount = g.atRisk.length;
      const cardId = `riskCard_${g.course.replace(/[^a-zA-Z0-9가-힣]/g, "")}_${g.degr}`;
      const severityClass = riskCount === 0 ? "risk-card-safe" : riskCount >= 3 ? "risk-card-danger" : "risk-card-warn";

      html += `<div class="risk-group-card ${severityClass}" data-risk-card="${cardId}">
        <div class="risk-card-header">
          <div class="risk-card-title">${g.course} <span class="risk-card-degr">${g.degr}기</span></div>
          <div class="risk-card-badges">
            ${riskCount > 0 ? `<span class="risk-badge risk-badge-danger">위험 ${riskCount}명</span>` : '<span class="risk-badge risk-badge-safe">안전</span>'}
            ${consAbsent > 0 ? `<span class="risk-badge risk-badge-warn">연속결석 ${consAbsent}명</span>` : ""}
          </div>
        </div>
        <div class="risk-card-stats">
          <span>인원 ${g.list.length}명</span>
          <span>평균출석률 ${avgRate < 0 ? "N/A" : avgRate.toFixed(1) + "%"}</span>
          <span>탈락 ${g.list.filter((d) => d.dropout).length}명</span>
        </div>
      </div>`;

      // 상세 패널 (접힌 상태)
      if (riskCount > 0) {
        const sorted = g.atRisk.sort((a, b) => {
          const ca = b.currentConsecutiveAbsent - a.currentConsecutiveAbsent;
          return ca !== 0 ? ca : a.attendanceRate - b.attendanceRate;
        });
        html += `<div class="risk-detail-panel" id="${cardId}" style="display:none;">
          <table class="hrd-table" style="margin:0;font-size:12px;">
            <thead><tr><th>이름</th><th>출석률</th><th>결석</th><th>지각</th><th>연속결석</th><th>위험도</th><th>경고사유</th></tr></thead>
            <tbody>${sorted
              .map((d) => {
                const riskLevel = d.attendanceRate < 60 ? "high" : d.attendanceRate < 70 ? "mid" : "low";
                const riskLabel = d.attendanceRate < 60 ? "긴급" : d.attendanceRate < 70 ? "주의" : "관찰";
                const alertTags = d.alertReasons
                  .map((r) => {
                    const cls =
                      r === "연속결석"
                        ? "alert-tag--consecutive"
                        : r === "출석률 급락"
                          ? "alert-tag--drop"
                          : "alert-tag--late";
                    return `<span class="alert-tag ${cls}">${r}</span>`;
                  })
                  .join("");
                return `<tr>
                <td><strong>${d.name}</strong></td>
                <td style="color:${d.attendanceRate < 60 ? "#dc2626" : "#d97706"};font-weight:700;">${d.attendanceRate.toFixed(1)}%</td>
                <td>${d.absentDays}일</td><td>${d.lateDays}일</td>
                <td>${d.currentConsecutiveAbsent > 0 ? d.currentConsecutiveAbsent + "일" : "-"}</td>
                <td><span class="ana-risk-${riskLevel}">${riskLabel}</span></td>
                <td>${alertTags || "-"}</td>
              </tr>`;
              })
              .join("")}</tbody>
          </table>
        </div>`;
      }
    }
    html += "</div>";
  }

  // 차트 영역
  html += `<h4 style="margin:24px 0 8px">출결 패턴</h4>
    <div class="ana-chart-grid">
      <div class="ana-chart-box"><canvas id="chartWeekdayAbsent"></canvas></div>
      <div class="ana-chart-box"><canvas id="chartMonthlyAbsent"></canvas></div>
    </div>
    <h4 style="margin:16px 0 8px">탈락 요인 / 위험군 추이</h4>
    <div class="ana-chart-grid">
      <div class="ana-chart-box"><canvas id="chartDropoutTiming"></canvas></div>
      <div class="ana-chart-box"><canvas id="chartIndividualTrend"></canvas></div>
    </div>`;

  container.innerHTML = html;

  // 카드 클릭 토글
  container.querySelectorAll<HTMLElement>(".risk-group-card").forEach((card) => {
    card.addEventListener("click", () => {
      const panelId = card.dataset.riskCard || "";
      const panel = document.getElementById(panelId);
      if (panel) {
        const isHidden = panel.style.display === "none";
        panel.style.display = isHidden ? "" : "none";
        card.classList.toggle("risk-card-expanded", isHidden);
      }
    });
  });

  // 차트 렌더링
  renderRiskCharts(data);
}

// ── 종강: 과정별 인사이트 리포트 ──
function renderRiskTabCompleted(container: HTMLElement, data: TraineeAnalysis[]): void {
  interface CompGroup {
    course: string;
    degr: string;
    category: string;
    list: TraineeAnalysis[];
  }
  const groups: CompGroup[] = [];
  for (const d of data) {
    let g = groups.find((x) => x.course === d.courseName && x.degr === d.degr);
    if (!g) {
      g = { course: d.courseName, degr: d.degr, category: d.category ?? "", list: [] };
      groups.push(g);
    }
    g.list.push(d);
  }
  groups.sort((a, b) => a.course.localeCompare(b.course) || parseInt(a.degr) - parseInt(b.degr));

  let html = '<h4 style="margin:16px 0 8px">📊 종강 과정 인사이트</h4><div class="risk-group-list">';

  for (const g of groups) {
    const cnt = g.list.length;
    const completed = g.list.filter(
      (d) => (d.completionStatus || "").includes("수료") && !(d.completionStatus || "").includes("포기"),
    ).length;
    const compRate = cnt > 0 ? (completed / cnt) * 100 : 0;
    const dropouts = g.list.filter((d) => d.dropout);
    const dropRate = cnt > 0 ? (dropouts.length / cnt) * 100 : 0;
    const withData = g.list.filter((d) => d.hasAttendanceData);
    const avgRate = withData.length > 0 ? withData.reduce((s, d) => s + d.attendanceRate, 0) / withData.length : -1;

    // 탈락 시점 분포
    const dropoutsByWeek: Record<string, number> = {};
    for (const d of dropouts) {
      if (d.dropoutWeekIdx >= 0) {
        const period = d.dropoutWeekIdx < 4 ? "초기(1-4주)" : d.dropoutWeekIdx < 8 ? "중기(5-8주)" : "후기(9주+)";
        dropoutsByWeek[period] = (dropoutsByWeek[period] || 0) + 1;
      }
    }
    const dropTimingHtml =
      Object.entries(dropoutsByWeek)
        .map(([k, v]) => `${k}: ${v}명`)
        .join(", ") || "-";

    // 요일별 결석 top — 재직자 과정은 토요일 포함
    const isResident = g.category === "재직자";
    const dayNames = isResident ? ["화", "수", "목", "금", "토"] : ["월", "화", "수", "목", "금"];
    const dayIndices = isResident ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    const weekdayTotals = new Array(dayNames.length).fill(0);
    for (const d of g.list) {
      for (let i = 0; i < dayNames.length; i++) weekdayTotals[i] += d.absentByWeekday[dayIndices[i]];
    }
    const topDay = weekdayTotals.indexOf(Math.max(...weekdayTotals));
    const topDayHtml = weekdayTotals[topDay] > 0 ? `${dayNames[topDay]}요일 (${weekdayTotals[topDay]}건)` : "-";

    // 지각 top 시간대
    const lateHourTotals = [0, 0, 0, 0, 0, 0];
    const hourLabels = ["7시", "8시", "9시", "10시", "11시", "12시"];
    for (const d of g.list) {
      for (let i = 0; i < 6; i++) lateHourTotals[i] += d.lateByHour[i];
    }
    const topHour = lateHourTotals.indexOf(Math.max(...lateHourTotals));
    const topHourHtml = lateHourTotals[topHour] > 0 ? `${hourLabels[topHour]}대 (${lateHourTotals[topHour]}건)` : "-";

    // 이전기수 대비
    const prevDegr = String(parseInt(g.degr) - 1);
    const prevGroup = groups.find((x) => x.course === g.course && x.degr === prevDegr);
    let prevCompareHtml = "";
    if (prevGroup) {
      const prevDrop = (prevGroup.list.filter((d) => d.dropout).length / prevGroup.list.length) * 100;
      const diff = dropRate - prevDrop;
      const color = diff > 0 ? "#dc2626" : diff < 0 ? "#059669" : "#6b7280";
      const sign = diff > 0 ? "+" : "";
      prevCompareHtml = `<div class="insight-compare">vs ${prevDegr}기 탈락률: <span style="color:${color};font-weight:700;">${sign}${diff.toFixed(1)}%p</span></div>`;
    }

    const compClass = compRate >= 80 ? "insight-card-good" : compRate >= 60 ? "insight-card-warn" : "insight-card-bad";
    const cardId = `insightCard_${g.course.replace(/[^a-zA-Z0-9가-힣]/g, "")}_${g.degr}`;

    html += `<div class="insight-course-card ${compClass}" data-insight-card="${cardId}">
      <div class="insight-card-header">
        <div class="insight-card-title">${g.course} <span class="risk-card-degr">${g.degr}기</span></div>
        <div class="insight-card-rate">${compRate.toFixed(0)}% <span class="insight-card-rate-label">수료율</span></div>
      </div>
      <div class="insight-card-summary">
        <span>인원 ${cnt}명</span>
        <span>수료 ${completed}명</span>
        <span>탈락 ${dropouts.length}명 (${dropRate.toFixed(1)}%)</span>
      </div>
      ${prevCompareHtml}
    </div>
    <div class="risk-detail-panel" id="${cardId}" style="display:none;">
      <div class="insight-detail-grid">
        <div class="insight-detail-item">
          <div class="insight-detail-label">평균 출석률</div>
          <div class="insight-detail-value">${avgRate < 0 ? "N/A" : avgRate.toFixed(1) + "%"}</div>
        </div>
        <div class="insight-detail-item">
          <div class="insight-detail-label">탈락 시점 분포</div>
          <div class="insight-detail-value">${dropTimingHtml}</div>
        </div>
        <div class="insight-detail-item">
          <div class="insight-detail-label">결석 최다 요일</div>
          <div class="insight-detail-value">${topDayHtml}</div>
        </div>
        <div class="insight-detail-item">
          <div class="insight-detail-label">지각 최다 시간대</div>
          <div class="insight-detail-value">${topHourHtml}</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:12px;">
        <strong>훈련생 상태 분포:</strong>
        ${(() => {
          const statusMap: Record<string, number> = {};
          for (const d of g.list) {
            const s = d.completionStatus || (d.dropout ? "중도탈락" : "훈련중");
            statusMap[s] = (statusMap[s] || 0) + 1;
          }
          return Object.entries(statusMap)
            .map(([k, v]) => `<span class="insight-status-chip">${k} ${v}명</span>`)
            .join(" ");
        })()}
      </div>
    </div>`;
  }
  html += "</div>";

  // 차트 영역 (종강도 출결 패턴 차트는 유용)
  html += `<h4 style="margin:24px 0 8px">출결 패턴 종합</h4>
    <div class="ana-chart-grid">
      <div class="ana-chart-box"><canvas id="chartWeekdayAbsent"></canvas></div>
      <div class="ana-chart-box"><canvas id="chartMonthlyAbsent"></canvas></div>
    </div>
    <h4 style="margin:16px 0 8px">탈락 시점 분석</h4>
    <div class="ana-chart-grid">
      <div class="ana-chart-box"><canvas id="chartDropoutTiming"></canvas></div>
      <div class="ana-chart-box"><canvas id="chartIndividualTrend"></canvas></div>
    </div>`;

  container.innerHTML = html;

  // 카드 클릭 토글
  container.querySelectorAll<HTMLElement>(".insight-course-card").forEach((card) => {
    card.addEventListener("click", () => {
      const panelId = card.dataset.insightCard || "";
      const panel = document.getElementById(panelId);
      if (panel) {
        const isHidden = panel.style.display === "none";
        panel.style.display = isHidden ? "" : "none";
        card.classList.toggle("risk-card-expanded", isHidden);
      }
    });
  });

  renderRiskCharts(data);
}

// ── 공통 차트 렌더링 ──
function renderRiskCharts(data: TraineeAnalysis[]): void {
  // 요일별 결석률 — 재직자 과정은 토요일 포함
  const wdCtx = ($("chartWeekdayAbsent") as HTMLCanvasElement)?.getContext("2d");
  if (wdCtx) {
    const hasResident = data.some((d) => d.category === "재직자");
    const weekdays = hasResident ? ["월", "화", "수", "목", "금", "토"] : ["월", "화", "수", "목", "금"];
    const dayCount = weekdays.length;
    const totals = new Array(dayCount).fill(0);
    for (const d of data) {
      for (let i = 0; i < dayCount; i++) totals[i] += d.absentByWeekday[i + 1];
    }
    charts.push(
      new Chart(wdCtx, {
        type: "bar",
        data: { labels: weekdays, datasets: [{ label: "결석 횟수", data: totals, backgroundColor: "#f56c6c" }] },
        options: {
          responsive: true,
          plugins: { legend: { display: false }, title: { display: true, text: "요일별 결석 분포" } },
        },
      }),
    );
  }

  // 월차별 결석 추이
  const monthCtx = ($("chartMonthlyAbsent") as HTMLCanvasElement)?.getContext("2d");
  if (monthCtx) {
    const maxMonths = Math.max(...data.map((d) => d.absentByMonth.length), 0);
    if (maxMonths > 0) {
      const labels = Array.from({ length: maxMonths }, (_, i) => `${i + 1}월차`);
      const totals = Array.from({ length: maxMonths }, () => 0);
      for (const d of data) {
        for (let i = 0; i < d.absentByMonth.length; i++) totals[i] += d.absentByMonth[i];
      }
      charts.push(
        new Chart(monthCtx, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "결석",
                data: totals,
                borderColor: "#f56c6c",
                backgroundColor: "rgba(245,108,108,0.1)",
                fill: true,
              },
            ],
          },
          options: { responsive: true, plugins: { title: { display: true, text: "월차별 결석 추이" } } },
        }),
      );
    }
  }

  // 탈락 시점 분석
  const dropTimingCtx = ($("chartDropoutTiming") as HTMLCanvasElement)?.getContext("2d");
  if (dropTimingCtx) {
    const dropouts = data.filter((d) => d.dropout && d.dropoutWeekIdx >= 0);
    if (dropouts.length > 0) {
      const maxWeek = Math.max(...dropouts.map((d) => d.dropoutWeekIdx));
      const weekLabels = Array.from({ length: maxWeek + 1 }, (_, i) => `${i + 1}주`);
      const weekCounts = Array.from({ length: maxWeek + 1 }, () => 0);
      for (const d of dropouts) weekCounts[d.dropoutWeekIdx]++;
      charts.push(
        new Chart(dropTimingCtx, {
          type: "bar",
          data: {
            labels: weekLabels,
            datasets: [{ label: "탈락 인원", data: weekCounts, backgroundColor: "#f56c6c" }],
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false }, title: { display: true, text: "탈락 시점 분석 (훈련 주차별)" } },
            scales: { y: { title: { display: true, text: "인원" }, beginAtZero: true } },
          },
        }),
      );
    } else {
      const parent = dropTimingCtx.canvas.parentElement;
      if (parent)
        parent.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:180px;color:#9ca3af;font-size:13px;">탈락 데이터가 없습니다</div>';
    }
  }

  // 위험군 개인별 출결 추이
  const trendCtx = ($("chartIndividualTrend") as HTMLCanvasElement)?.getContext("2d");
  if (trendCtx) {
    const riskStudents = data
      .filter((d) => !d.dropout && d.alertReasons.length > 0 && d.weeklyAttendanceRates.length >= 2)
      .sort((a, b) => a.attendanceRate - b.attendanceRate)
      .slice(0, 5);
    if (riskStudents.length > 0) {
      const maxWeeks = Math.max(...riskStudents.map((d) => d.weeklyAttendanceRates.length));
      const labels = Array.from({ length: maxWeeks }, (_, i) => `${i + 1}주`);
      const colors = ["#dc2626", "#d97706", "#7c3aed", "#0891b2", "#059669"];
      charts.push(
        new Chart(trendCtx, {
          type: "line",
          data: {
            labels,
            datasets: riskStudents.map((d, i) => ({
              label: d.name,
              data: d.weeklyAttendanceRates,
              borderColor: colors[i % colors.length],
              backgroundColor: "transparent",
              tension: 0.3,
              pointRadius: 3,
            })),
          },
          options: {
            responsive: true,
            plugins: { title: { display: true, text: "위험군 출결 추이 (TOP 5)" } },
            scales: { y: { title: { display: true, text: "출석률 (%)" }, min: 0, max: 110 } },
          },
        }),
      );
    } else {
      const parent = trendCtx.canvas.parentElement;
      if (parent)
        parent.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:180px;color:#9ca3af;font-size:13px;">경고 대상 훈련생이 없습니다</div>';
    }
  }
}

function renderDetailTab(data: TraineeAnalysis[]): void {
  applyFiltersAndRender(data);

  // 필터 이벤트
  const filterIds = ["anaFilterCourse", "anaFilterDegr", "anaFilterAge", "anaFilterStatus", "anaFilterGender"];
  for (const id of filterIds) {
    $(id)?.addEventListener("change", () => applyFiltersAndRender(data));
  }

  // 필터 초기화 버튼
  $("anaFilterReset")?.addEventListener("click", () => {
    for (const id of filterIds) {
      const el = $(id) as HTMLSelectElement | null;
      if (el) el.value = "";
    }
    applyFiltersAndRender(data);
  });
}

function populateFilters(data: TraineeAnalysis[]): void {
  const courseSelect = $("anaFilterCourse") as HTMLSelectElement | null;
  const degrSelect = $("anaFilterDegr") as HTMLSelectElement | null;
  if (courseSelect) {
    const courses = [...new Set(data.map((d) => d.courseName))];
    courseSelect.innerHTML =
      '<option value="">전체 과정</option>' + courses.map((c) => `<option value="${c}">${c}</option>`).join("");
  }
  if (degrSelect) {
    const degrs = [...new Set(data.map((d) => d.degr))].sort((a, b) => parseInt(a) - parseInt(b));
    degrSelect.innerHTML =
      '<option value="">전체 기수</option>' + degrs.map((d) => `<option value="${d}">${d}기</option>`).join("");
  }
}

let sortCol = "name";
let sortAsc = true;

function applyFiltersAndRender(data: TraineeAnalysis[]): void {
  const course = ($("anaFilterCourse") as HTMLSelectElement)?.value || "";
  const degr = ($("anaFilterDegr") as HTMLSelectElement)?.value || "";
  const age = ($("anaFilterAge") as HTMLSelectElement)?.value || "";
  const status = ($("anaFilterStatus") as HTMLSelectElement)?.value || "";
  const gender = ($("anaFilterGender") as HTMLSelectElement)?.value || "";

  let filtered = data;
  if (course) filtered = filtered.filter((d) => d.courseName === course);
  if (degr) filtered = filtered.filter((d) => d.degr === degr);
  if (age) filtered = filtered.filter((d) => d.age > 0 && getAgeGroup(d.age) === age);
  if (status === "dropout") filtered = filtered.filter((d) => d.dropout);
  if (status === "active") filtered = filtered.filter((d) => !d.dropout);
  if (gender) filtered = filtered.filter((d) => d.gender === gender);

  // 정렬
  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortCol) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "course":
        cmp = a.courseName.localeCompare(b.courseName);
        break;
      case "degr":
        cmp = parseInt(a.degr) - parseInt(b.degr);
        break;
      case "age":
        cmp = a.age - b.age;
        break;
      case "category":
        cmp = a.category.localeCompare(b.category);
        break;
      case "rate":
        cmp = a.attendanceRate - b.attendanceRate;
        break;
      case "absent":
        cmp = a.absentDays - b.absentDays;
        break;
      case "status":
        cmp = (a.dropout ? 1 : 0) - (b.dropout ? 1 : 0);
        break;
    }
    return sortAsc ? cmp : -cmp;
  });

  const tbody = $("anaDetailBody");
  if (!tbody) return;

  const countEl = $("anaDetailCount");
  if (countEl) countEl.textContent = `${filtered.length}명`;

  tbody.innerHTML = filtered
    .map(
      (d) => `<tr>
    <td>${d.name}</td>
    <td>${d.courseName.length > 12 ? d.courseName.slice(0, 12) + "…" : d.courseName}</td>
    <td>${d.degr}기</td>
    <td>${d.age > 0 ? d.age + "세" : "-"}</td>
    <td>${d.category}</td>
    <td>${fmtRate(d.attendanceRate)}</td>
    <td>${d.absentDays}</td>
    <td><span class="ana-status-chip ${d.dropout ? "ana-status-dropout" : "ana-status-active"}">${d.dropout ? "탈락" : "재학"}</span></td>
  </tr>`,
    )
    .join("");
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
      if (sortCol === col) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col;
        sortAsc = true;
      }
      headers.forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
      th.classList.add(sortAsc ? "sort-asc" : "sort-desc");
      applyFiltersAndRender(analysisData);
    });
  });
}

// ─── 렌더링 통합 ────────────────────────────────────────────

function renderAllTabs(data: TraineeAnalysis[]): void {
  destroyCharts();
  const summary = computeSummary(data);
  const insights = generateInsights(data);
  renderOverviewTab(data, summary);
  renderRiskTab(data, insights);
  populateFilters(data);
  renderDetailTab(data);
}

function getFilteredData(): TraineeAnalysis[] {
  if (!activeCourseStatusFilter) return analysisData;
  return analysisData.filter((d) => (d.courseStatus || "") === activeCourseStatusFilter);
}

function updateLastQueried(timestamp: string): void {
  const lastEl = $("analyticsLastQueried");
  if (!lastEl) return;
  const d = new Date(timestamp);
  lastEl.textContent = `최근 조회: ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  lastEl.style.display = "";
}

function saveCache(data: TraineeAnalysis[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: new Date().toISOString() }));
  } catch {
    /* quota exceeded — ignore */
  }
}

function loadCache(): { data: TraineeAnalysis[]; timestamp: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.data) && parsed.timestamp) return parsed;
  } catch {
    /* corrupted */
  }
  return null;
}

function setupCourseStatusFilter(): void {
  const container = $("anaCourseStatusFilter");
  if (!container) return;
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-course-status]") as HTMLElement | null;
    if (!btn) return;
    container.querySelectorAll(".ana-filter-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeCourseStatusFilter = (btn.dataset.courseStatus || "") as "" | "진행중" | "종강";
    renderAllTabs(getFilteredData());
  });
}

// ─── Data Getter (for reports) ───────────────────────────────
export function getCachedAnalysisData(): TraineeAnalysis[] {
  return analysisData;
}

// ─── 공개 초기화 함수 ───────────────────────────────────────

export function initAnalytics(): void {
  setupTabs();
  setupTableSort();
  setupCourseStatusFilter();

  const fetchBtn = $("analyticsFetchBtn");
  const statusEl = $("analyticsStatus");
  const contentEl = $("analyticsContent");
  const emptyEl = $("analyticsEmpty");

  // 캐시 로드 — 이전 조회 결과가 있으면 즉시 표시
  const cached = loadCache();
  if (cached && cached.data.length > 0) {
    analysisData = cached.data;
    if (emptyEl) emptyEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";
    renderAllTabs(getFilteredData());
    updateLastQueried(cached.timestamp);
    if (statusEl) {
      statusEl.textContent = `캐시된 데이터 ${analysisData.length}명 표시 중 (새 데이터는 전체 조회 클릭)`;
      statusEl.className = "ana-status ana-status-info";
    }
    const pdfBtn = $("analyticsPdfBtn") as HTMLButtonElement | null;
    if (pdfBtn) pdfBtn.disabled = false;
  }

  fetchBtn?.addEventListener("click", async () => {
    if (!fetchBtn || !statusEl) return;
    (fetchBtn as HTMLButtonElement).disabled = true;
    statusEl.textContent = "📊 데이터 수집 준비 중...";
    statusEl.className = "ana-status ana-status-info";

    try {
      destroyCharts();
      analysisData = await collectAnalyticsData((msg) => {
        statusEl.textContent = `📊 ${msg}`;
      });

      if (analysisData.length === 0) {
        statusEl.textContent = "조회된 훈련생이 없습니다.";
        statusEl.className = "ana-status ana-status-warning";
        return;
      }

      if (emptyEl) emptyEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";

      // 필터 초기화 — 기본 "진행중"
      activeCourseStatusFilter = "진행중";
      const filterContainer = $("anaCourseStatusFilter");
      if (filterContainer) {
        filterContainer.querySelectorAll(".ana-filter-btn").forEach((b) => {
          b.classList.toggle("is-active", (b as HTMLElement).dataset.courseStatus === "진행중");
        });
      }

      renderAllTabs(getFilteredData());

      // 캐시 저장 + 타임스탬프
      const now = new Date().toISOString();
      saveCache(analysisData);
      updateLastQueried(now);

      statusEl.textContent = `✅ ${analysisData.length}명 분석 완료`;
      statusEl.className = "ana-status ana-status-success";

      // PDF 버튼 활성화
      const pdfBtn = $("analyticsPdfBtn") as HTMLButtonElement | null;
      if (pdfBtn) pdfBtn.disabled = false;
    } catch (e) {
      statusEl.textContent = classifyApiError(e);
      statusEl.className = "ana-status ana-status-error";
    } finally {
      (fetchBtn as HTMLButtonElement).disabled = false;
    }
  });

  // PDF 버튼
  $("analyticsPdfBtn")?.addEventListener("click", () => {
    if (analysisData.length === 0) {
      alert("데이터를 먼저 조회하세요.");
      return;
    }
    printAnalyticsReport(analysisData);
  });
}

// ─── PDF 출력 ──────────────────────────────────────────────

function printAnalyticsReport(data: TraineeAnalysis[]): void {
  const summary = computeSummary(data);
  const insights = generateInsights(data);
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;

  // 지각 시간대 분포
  const lateHourLabels = ["7시대", "8시대", "9시대", "10시대", "11시대", "12시대"];
  const lateHourTotals = [0, 0, 0, 0, 0, 0];
  for (const d of data) {
    for (let i = 0; i < 6; i++) lateHourTotals[i] += d.lateByHour[i];
  }
  const maxLateHour = Math.max(...lateHourTotals, 1);

  // 과정·기수별 통계
  const courseNames = [...new Set(data.map((d) => d.courseName))];
  const courseDegrStats: Array<{
    name: string;
    degr: string;
    category: string;
    count: number;
    avgRate: number;
    hasData: boolean;
    dropouts: number;
    dropoutRate: number;
    atRisk: number;
  }> = [];
  for (const d of data) {
    let g = courseDegrStats.find((x) => x.name === d.courseName && x.degr === d.degr);
    if (!g) {
      g = {
        name: d.courseName,
        degr: d.degr,
        category: d.category,
        count: 0,
        avgRate: 0,
        hasData: false,
        dropouts: 0,
        dropoutRate: 0,
        atRisk: 0,
      };
      courseDegrStats.push(g);
    }
    g.count++;
    if (d.hasAttendanceData) {
      g.avgRate += d.attendanceRate;
      g.hasData = true;
    }
    if (d.dropout) g.dropouts++;
    if (!d.dropout && d.hasAttendanceData && d.attendanceRate < 80) g.atRisk++;
  }
  for (const g of courseDegrStats) {
    const withData = data.filter((d) => d.courseName === g.name && d.degr === g.degr && d.hasAttendanceData);
    g.avgRate = withData.length > 0 ? g.avgRate / withData.length : -1;
    g.dropoutRate = (g.dropouts / g.count) * 100;
  }

  // 위험군 훈련생 (다중 조건)
  const atRiskList = data
    .filter(
      (d) =>
        !d.dropout &&
        d.hasAttendanceData &&
        (d.attendanceRate < 80 || d.currentConsecutiveAbsent >= 3 || d.alertReasons.length > 0),
    )
    .sort((a, b) => {
      const ca = b.currentConsecutiveAbsent - a.currentConsecutiveAbsent;
      if (ca !== 0) return ca;
      return a.attendanceRate - b.attendanceRate;
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

.cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 16px; }
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
  <div class="card"><div class="card-value">${summary.avgAttendanceRate > 0 ? summary.avgAttendanceRate.toFixed(1) + "%" : "N/A"}</div><div class="card-label">평균 출석률</div></div>
  <div class="card"><div class="card-value">${summary.dropoutRate.toFixed(1)}%</div><div class="card-label">중도탈락률 (${summary.dropoutCount}명)</div></div>
  <div class="card"><div class="card-value" style="color:${atRiskList.length > 0 ? "#dc2626" : "#059669"}">${atRiskList.length}명</div><div class="card-label">위험군 (출석률 80% 미만)</div></div>
  <div class="card"><div class="card-value" style="color:${summary.consecutiveAbsentCount > 0 ? "#dc2626" : "#059669"}">${summary.consecutiveAbsentCount}명</div><div class="card-label">연속결석 경고 (3일+)</div></div>
</div>

<h2>지각 시간대 분포</h2>
<div class="bar-chart">
${lateHourLabels
  .map(
    (label, i) => `<div class="bar-row">
  <span class="bar-label">${label}</span>
  <div class="bar-track"><div class="bar-fill" style="width:${((lateHourTotals[i] / maxLateHour) * 100).toFixed(0)}%;background:#f59e0b;">${lateHourTotals[i]}</div></div>
</div>`,
  )
  .join("")}
</div>

<h2>요일별 결석 분포</h2>
<div class="bar-chart">
${weekdayNames
  .map(
    (name, i) => `<div class="bar-row">
  <span class="bar-label">${name}</span>
  <div class="bar-track"><div class="bar-fill" style="width:${((weekdayTotals[i] / maxWeekday) * 100).toFixed(0)}%;background:${i === 0 || i === 6 ? "#94a3b8" : "#f56c6c"};">${weekdayTotals[i]}</div></div>
</div>`,
  )
  .join("")}
</div>

<h2>과정·기수별 현황</h2>
<table class="course-table">
<thead><tr><th>과정명</th><th>기수</th><th>유형</th><th>인원</th><th>평균출석률</th><th>탈락</th><th>탈락률</th><th>위험군</th></tr></thead>
<tbody>
${courseDegrStats
  .map(
    (c) => `<tr>
  <td>${c.name.length > 16 ? c.name.slice(0, 16) + "…" : c.name}</td>
  <td>${c.degr}기</td>
  <td>${c.category}</td>
  <td>${c.count}명</td>
  <td style="color:${c.avgRate < 0 ? "#6b7280" : c.avgRate >= 90 ? "#059669" : c.avgRate >= 80 ? "#d97706" : "#dc2626"};font-weight:600;">${c.avgRate < 0 ? "N/A" : c.avgRate.toFixed(1) + "%"}</td>
  <td>${c.dropouts}명</td>
  <td style="color:${c.dropoutRate <= 5 ? "#059669" : c.dropoutRate <= 15 ? "#d97706" : "#dc2626"};font-weight:600;">${c.dropoutRate.toFixed(1)}%</td>
  <td style="color:${c.avgRate < 0 ? "#6b7280" : c.atRisk > 0 ? "#dc2626" : "#059669"};font-weight:600;">${c.avgRate < 0 ? "-" : c.atRisk + "명"}</td>
</tr>`,
  )
  .join("")}
</tbody></table>

${
  atRiskList.length > 0
    ? `<h2>⚠️ 조기경보 대상 훈련생</h2>
<table class="course-table">
<thead><tr><th>이름</th><th>과정</th><th>기수</th><th>출석률</th><th>결석</th><th>지각</th><th>위험도</th><th>경고사유</th></tr></thead>
<tbody>
${atRiskList
  .map(
    (d) => `<tr>
  <td><strong>${d.name}</strong></td>
  <td>${d.courseName.length > 14 ? d.courseName.slice(0, 14) + "…" : d.courseName}</td>
  <td>${d.degr}기</td>
  <td style="color:${d.attendanceRate < 60 ? "#dc2626" : "#d97706"};font-weight:700;">${d.attendanceRate.toFixed(1)}%</td>
  <td>${d.absentDays}일</td>
  <td>${d.lateDays}일</td>
  <td><span class="chip ${d.attendanceRate < 60 ? "chip-dropout" : "chip-active"}" style="${d.attendanceRate < 60 ? "" : "background:#fef3c7;color:#92400e;"}">${d.attendanceRate < 60 ? "긴급" : d.attendanceRate < 70 ? "주의" : "관찰"}</span></td>
  <td>${d.alertReasons.length > 0 ? d.alertReasons.join(", ") : "-"}</td>
</tr>`,
  )
  .join("")}
</tbody></table>`
    : ""
}

${
  insights.length > 0
    ? `<h2>자동 인사이트</h2>
${insights.map((i) => `<div class="insight ${i.severity}">${i.icon} ${i.text}</div>`).join("")}`
    : ""
}

<div class="page-break"></div>
<h2>상세 데이터</h2>
<table>
<thead><tr><th>이름</th><th>과정</th><th>기수</th><th>연령</th><th>유형</th><th>출석률</th><th>결석</th><th>지각</th><th>공결</th><th>상태</th></tr></thead>
<tbody>
${sorted
  .map(
    (d) => `<tr>
  <td>${d.name}</td>
  <td>${d.courseName.length > 14 ? d.courseName.slice(0, 14) + "…" : d.courseName}</td>
  <td>${d.degr}기</td>
  <td>${d.age > 0 ? d.age + "세" : "-"}</td>
  <td>${d.category}</td>
  <td>${fmtRate(d.attendanceRate)}</td>
  <td>${d.absentDays}</td>
  <td>${d.lateDays}</td>
  <td>${d.excusedDays}</td>
  <td><span class="chip ${d.dropout ? "chip-dropout" : "chip-active"}">${d.dropout ? "탈락" : "재학"}</span></td>
</tr>`,
  )
  .join("")}
</tbody></table>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
