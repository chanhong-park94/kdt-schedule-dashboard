/** HRD 하차방어율 대시보드 */
import { Chart, registerables } from "chart.js";
import { fetchRoster } from "./hrdApi";
import { loadHrdConfig } from "./hrdConfig";
import type {
  HrdConfig,
  HrdCourse,
  HrdRawTrainee,
  DropoutRosterEntry,
  DropoutSummary,
  CourseCategory,
} from "./hrdTypes";

Chart.register(...registerables);

// ─── KPI Targets ─────────────────────────────────────────────
const KPI_TARGET = {
  employed: 75,   // 재직자 과정 목표 75%
  unemployed: 85, // 실업자 과정 목표 85%
} as const;

/** 과정 카테고리에 맞는 목표 방어율 반환 */
function getTargetRate(category: CourseCategory): number {
  return category === "재직자" ? KPI_TARGET.employed : KPI_TARGET.unemployed;
}

// ─── State ──────────────────────────────────────────────────
let dropoutData: DropoutRosterEntry[] = [];
let chartInstances: Chart[] = [];

const $ = (id: string) => document.getElementById(id);

function destroyCharts(): void {
  chartInstances.forEach((c) => c.destroy());
  chartInstances = [];
}

// ─── Helpers ────────────────────────────────────────────────

/** trainPrId에서 연도 추출 (예: AIG20240000498389 → "2024") */
function extractYearFromId(trainPrId: string): string {
  const m = trainPrId.match(/\d{4}/);
  return m ? m[0] : "";
}

/** 개강일 또는 trainPrId에서 연도 추출 */
function getEntryYear(e: DropoutRosterEntry): string {
  if (e.startDate && e.startDate.length >= 4) return e.startDate.slice(0, 4);
  return extractYearFromId(e.trainPrId);
}

/** 개강일 표시 텍스트 */
function formatStartDate(e: DropoutRosterEntry): string {
  return e.startDate || "-";
}

/** 개강일 기준 오름차순 정렬 */
function sortByStartDateAsc(entries: DropoutRosterEntry[]): DropoutRosterEntry[] {
  return [...entries].sort((a, b) => {
    // 개강일이 있는 항목 우선
    const dateA = a.startDate || "9999";
    const dateB = b.startDate || "9999";
    const cmp = dateA.localeCompare(dateB);
    if (cmp !== 0) return cmp;
    // 같은 날짜면 과정명 → 기수 순
    const nc = a.courseName.localeCompare(b.courseName);
    return nc !== 0 ? nc : Number(a.degr) - Number(b.degr);
  });
}

/** ISO 주간 번호 계산 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { year: d.getFullYear(), week: weekNum };
}

// ─── Data Fetch ─────────────────────────────────────────────

function isDropout(raw: HrdRawTrainee): boolean {
  const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString();
  return stNm.includes("중도탈락") || stNm.includes("수료포기");
}

async function fetchAllRosters(
  config: HrdConfig,
  onProgress?: (msg: string) => void,
): Promise<DropoutRosterEntry[]> {
  const results: DropoutRosterEntry[] = [];
  const total = config.courses.reduce((sum, c) => sum + c.degrs.length, 0);
  let done = 0;

  // 과정별 순차, 기수별 병렬 (3개씩 배치)
  for (const course of config.courses) {
    const BATCH = 3;
    for (let i = 0; i < course.degrs.length; i += BATCH) {
      const batch = course.degrs.slice(i, i + BATCH);
      const promises = batch.map(async (degr) => {
        try {
          const roster = await fetchRoster(config, course.trainPrId, degr);
          const dropoutCount = roster.filter(isDropout).length;
          const totalCount = roster.length;
          results.push({
            courseName: course.name,
            trainPrId: course.trainPrId,
            degr,
            category: course.category || "실업자",
            total: totalCount,
            dropout: dropoutCount,
            active: totalCount - dropoutCount,
            defenseRate: totalCount > 0 ? ((totalCount - dropoutCount) / totalCount) * 100 : 0,
            startDate: course.startDate || "",
          });
        } catch {
          // skip failed
        }
        done++;
        onProgress?.(`${done}/${total} 조회 중... (${course.name} ${degr}기)`);
      });
      await Promise.all(promises);
    }
  }

  // Sort: course name → degr
  results.sort((a, b) => {
    const nc = a.courseName.localeCompare(b.courseName);
    return nc !== 0 ? nc : Number(a.degr) - Number(b.degr);
  });

  return results;
}

// ─── Aggregation ────────────────────────────────────────────

function aggregateEntries(entries: DropoutRosterEntry[], label: string): DropoutSummary {
  const total = entries.reduce((s, e) => s + e.total, 0);
  const dropout = entries.reduce((s, e) => s + e.dropout, 0);
  return {
    label,
    total,
    dropout,
    active: total - dropout,
    defenseRate: total > 0 ? ((total - dropout) / total) * 100 : 0,
  };
}

function getOverallSummary(): DropoutSummary {
  return aggregateEntries(dropoutData, "전체");
}

function getCategorySummary(cat: CourseCategory): DropoutSummary {
  return aggregateEntries(dropoutData.filter((e) => e.category === cat), cat);
}

function getCourseSummaries(): DropoutSummary[] {
  const courseMap = new Map<string, DropoutRosterEntry[]>();
  for (const e of dropoutData) {
    if (!courseMap.has(e.courseName)) courseMap.set(e.courseName, []);
    courseMap.get(e.courseName)!.push(e);
  }
  return Array.from(courseMap.entries()).map(([name, entries]) => aggregateEntries(entries, name));
}

// ─── Common Render Helpers ──────────────────────────────────

function rateClassByTarget(rate: number, category: CourseCategory): string {
  const target = getTargetRate(category);
  if (rate >= target) return "do-rate-good";
  if (rate >= target - 5) return "do-rate-ok";
  return "do-rate-bad";
}

/** 기수 상세 행 생성 (개강일 포함) */
function renderDetailRow(e: DropoutRosterEntry, showCategory = true): string {
  const rateClass = rateClassByTarget(e.defenseRate, e.category);
  const target = getTargetRate(e.category);
  const diff = e.defenseRate - target;
  const diffLabel = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
  const catCell = showCategory
    ? `<td><span class="do-cat-chip do-cat-${e.category === "재직자" ? "emp" : "unemp"}">${e.category}</span></td>`
    : "";
  return `<tr>
    ${catCell}
    <td>${e.courseName}</td>
    <td>${e.degr}기</td>
    <td>${formatStartDate(e)}</td>
    <td>${e.total}</td>
    <td>${e.dropout}</td>
    <td>${e.active}</td>
    <td><span class="do-rate-cell ${rateClass}">${e.defenseRate.toFixed(1)}%</span></td>
    <td><span class="do-diff ${diff >= 0 ? "do-diff-plus" : "do-diff-minus"}">${diffLabel}%p</span></td>
    <td><div class="do-bar"><div class="do-bar-fill ${rateClass}" style="width:${e.defenseRate}%"></div><div class="do-bar-target" style="left:${target}%"></div></div></td>
  </tr>`;
}

/** 집계 소계 행 */
function renderSubtotalRow(label: string, entries: DropoutRosterEntry[], colSpan: number): string {
  const summary = aggregateEntries(entries, label);
  if (entries.length === 0) return "";
  // 카테고리 기반 색상
  const cats = new Set(entries.map(e => e.category));
  const mainCat: CourseCategory = cats.has("재직자") && !cats.has("실업자") ? "재직자" : cats.has("실업자") && !cats.has("재직자") ? "실업자" : "실업자";
  const rateClass = rateClassByTarget(summary.defenseRate, mainCat);
  const target = getTargetRate(mainCat);
  const diff = summary.defenseRate - target;
  const diffLabel = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
  return `<tr style="background:#f1f5f9;font-weight:700;">
    <td colspan="${colSpan}" style="text-align:right;color:#475569;">${label} 소계</td>
    <td>${summary.total}</td>
    <td>${summary.dropout}</td>
    <td>${summary.active}</td>
    <td><span class="do-rate-cell ${rateClass}">${summary.defenseRate.toFixed(1)}%</span></td>
    <td><span class="do-diff ${diff >= 0 ? "do-diff-plus" : "do-diff-minus"}">${diffLabel}%p</span></td>
    <td></td>
  </tr>`;
}

// ─── Render: Summary Cards ──────────────────────────────────

function renderSummaryCards(): void {
  const overall = getOverallSummary();
  const employed = getCategorySummary("재직자");
  const unemployed = getCategorySummary("실업자");

  const setCard = (prefix: string, s: DropoutSummary, target?: number) => {
    const rateEl = $(`${prefix}Rate`);
    const totalEl = $(`${prefix}Total`);
    const dropEl = $(`${prefix}Drop`);
    const targetEl = $(`${prefix}Target`);
    if (rateEl) rateEl.textContent = `${s.defenseRate.toFixed(1)}%`;
    if (totalEl) totalEl.textContent = `${s.total}명`;
    if (dropEl) dropEl.textContent = `${s.dropout}명`;
    if (rateEl) {
      rateEl.className = "do-card-rate";
      if (target !== undefined) {
        rateEl.classList.add(s.defenseRate >= target ? "do-rate-good" : "do-rate-bad");
      } else {
        const empMet = employed.defenseRate >= KPI_TARGET.employed;
        const unempMet = unemployed.defenseRate >= KPI_TARGET.unemployed;
        rateEl.classList.add(empMet && unempMet ? "do-rate-good" : !empMet && !unempMet ? "do-rate-bad" : "do-rate-ok");
      }
    }
    if (targetEl && target !== undefined) {
      const met = s.defenseRate >= target;
      targetEl.innerHTML = `${met ? "✅" : "❌"} 목표 ${target}% ${met ? "달성" : "미달"} (${(s.defenseRate - target).toFixed(1)}%p)`;
      targetEl.className = `do-card-target ${met ? "do-target-met" : "do-target-miss"}`;
    }
  };

  setCard("doAll", overall);
  setCard("doEmp", employed, KPI_TARGET.employed);
  setCard("doUnemp", unemployed, KPI_TARGET.unemployed);
}

// ─── Render: Course Table ───────────────────────────────────

function renderCourseTable(): void {
  const tbody = $("doCourseTbody");
  if (!tbody) return;

  const courseSummaries = getCourseSummaries();

  tbody.innerHTML = courseSummaries
    .sort((a, b) => a.defenseRate - b.defenseRate)
    .map((s) => {
      const cat = (dropoutData.find((e) => e.courseName === s.label)?.category || "실업자") as CourseCategory;
      const target = getTargetRate(cat);
      const rateClass = rateClassByTarget(s.defenseRate, cat);
      const diff = s.defenseRate - target;
      const diffLabel = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
      return `<tr>
        <td><span class="do-cat-chip do-cat-${cat === "재직자" ? "emp" : "unemp"}">${cat}</span></td>
        <td><strong>${s.label}</strong></td>
        <td>${s.total}</td>
        <td>${s.dropout}</td>
        <td>${s.active}</td>
        <td><span class="do-rate-cell ${rateClass}">${s.defenseRate.toFixed(1)}%</span></td>
        <td><span class="do-diff ${diff >= 0 ? "do-diff-plus" : "do-diff-minus"}">${diffLabel}%p</span></td>
        <td><div class="do-bar"><div class="do-bar-fill ${rateClass}" style="width:${s.defenseRate}%"></div><div class="do-bar-target" style="left:${target}%"></div></div></td>
      </tr>`;
    })
    .join("");
}

// ─── Render: Degr Table (개강일 포함) ───────────────────────

function renderDegrTable(): void {
  const tbody = $("doDegrTbody");
  if (!tbody) return;

  const sorted = sortByStartDateAsc(dropoutData);
  tbody.innerHTML = sorted.map((e) => renderDetailRow(e, true)).join("");
}

// ─── Render: Yearly Table ───────────────────────────────────

function renderYearlyTable(): void {
  const tbody = $("doYearlyTbody");
  if (!tbody) return;

  // 연도별 그룹핑
  const sorted = sortByStartDateAsc(dropoutData);
  const yearMap = new Map<string, DropoutRosterEntry[]>();
  for (const e of sorted) {
    const year = getEntryYear(e) || "미분류";
    if (!yearMap.has(year)) yearMap.set(year, []);
    yearMap.get(year)!.push(e);
  }

  // 연도 오름차순 정렬
  const years = Array.from(yearMap.keys()).sort();

  let html = "";
  for (const year of years) {
    const entries = yearMap.get(year)!;
    const summary = aggregateEntries(entries, year);
    // 연도 그룹 헤더
    html += `<tr class="do-year-group">
      <td colspan="11">${year}년 — ${entries.length}개 기수, 총 ${summary.total}명, 방어율 ${summary.defenseRate.toFixed(1)}%</td>
    </tr>`;
    // 개강일 오름차순 상세 행
    for (const e of entries) {
      const rateClass = rateClassByTarget(e.defenseRate, e.category);
      const target = getTargetRate(e.category);
      const diff = e.defenseRate - target;
      const diffLabel = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
      html += `<tr>
        <td>${year}</td>
        <td><span class="do-cat-chip do-cat-${e.category === "재직자" ? "emp" : "unemp"}">${e.category}</span></td>
        <td>${e.courseName}</td>
        <td>${e.degr}기</td>
        <td>${formatStartDate(e)}</td>
        <td>${e.total}</td>
        <td>${e.dropout}</td>
        <td>${e.active}</td>
        <td><span class="do-rate-cell ${rateClass}">${e.defenseRate.toFixed(1)}%</span></td>
        <td><span class="do-diff ${diff >= 0 ? "do-diff-plus" : "do-diff-minus"}">${diffLabel}%p</span></td>
        <td><div class="do-bar"><div class="do-bar-fill ${rateClass}" style="width:${e.defenseRate}%"></div><div class="do-bar-target" style="left:${target}%"></div></div></td>
      </tr>`;
    }
    // 소계
    html += renderSubtotalRow(year + "년", entries, 5);
  }

  tbody.innerHTML = html;
}

// ─── Render: Category Tables (재직자/실업자) ────────────────

function renderCategoryDetailTable(category: CourseCategory): void {
  const tbodyId = category === "재직자" ? "doEmployedTbody" : "doUnemployedTbody";
  const tbody = $(tbodyId);
  if (!tbody) return;

  const filtered = dropoutData.filter((e) => e.category === category);
  const sorted = sortByStartDateAsc(filtered);

  // 과정별 그룹핑
  const courseMap = new Map<string, DropoutRosterEntry[]>();
  for (const e of sorted) {
    if (!courseMap.has(e.courseName)) courseMap.set(e.courseName, []);
    courseMap.get(e.courseName)!.push(e);
  }

  let html = "";
  for (const [courseName, entries] of courseMap) {
    for (const e of entries) {
      html += renderDetailRow(e, false);
    }
    // 과정별 소계
    html += renderSubtotalRow(courseName, entries, 3);
  }

  // 전체 소계
  const overallSummary = aggregateEntries(filtered, category);
  const target = getTargetRate(category);
  const rateClass = rateClassByTarget(overallSummary.defenseRate, category);
  const diff = overallSummary.defenseRate - target;
  const diffLabel = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
  html += `<tr style="background:#e2e8f0;font-weight:800;">
    <td colspan="3" style="text-align:right;color:#1e293b;">${category} 전체</td>
    <td>${overallSummary.total}</td>
    <td>${overallSummary.dropout}</td>
    <td>${overallSummary.active}</td>
    <td><span class="do-rate-cell ${rateClass}">${overallSummary.defenseRate.toFixed(1)}%</span></td>
    <td><span class="do-diff ${diff >= 0 ? "do-diff-plus" : "do-diff-minus"}">${diffLabel}%p</span></td>
    <td></td>
  </tr>`;

  tbody.innerHTML = html;
}

// ─── Render: Monthly Table ──────────────────────────────────

function populateMonthlyFilters(): void {
  const yearSel = $("doMonthlyYear") as HTMLSelectElement | null;
  if (!yearSel) return;

  // 데이터에서 가용 연도 추출
  const years = new Set<string>();
  for (const e of dropoutData) {
    const y = getEntryYear(e);
    if (y) years.add(y);
  }
  const sortedYears = Array.from(years).sort();
  yearSel.innerHTML = `<option value="0">전체</option>` +
    sortedYears.map((y) => `<option value="${y}">${y}년</option>`).join("");

  // 현재 연도 기본 선택
  const currentYear = String(new Date().getFullYear());
  if (years.has(currentYear)) yearSel.value = currentYear;
}

function renderMonthlyTable(): void {
  const tbody = $("doMonthlyTbody");
  const statusEl = $("doMonthlyStatus");
  if (!tbody) return;

  const yearSel = $("doMonthlyYear") as HTMLSelectElement | null;
  const monthSel = $("doMonthlyMonth") as HTMLSelectElement | null;
  const selectedYear = yearSel?.value || "0";
  const selectedMonth = parseInt(monthSel?.value || "0");

  let filtered = dropoutData;

  // 연도 필터
  if (selectedYear !== "0") {
    filtered = filtered.filter((e) => getEntryYear(e) === selectedYear);
  }

  // 월 필터 (개강일 기준)
  if (selectedMonth > 0) {
    filtered = filtered.filter((e) => {
      if (!e.startDate || e.startDate.length < 7) return false;
      const month = parseInt(e.startDate.slice(5, 7));
      return month === selectedMonth;
    });
  }

  const sorted = sortByStartDateAsc(filtered);
  tbody.innerHTML = sorted.map((e) => renderDetailRow(e, true)).join("")
    + renderSubtotalRow("조회 결과", filtered, 4);

  if (statusEl) {
    statusEl.textContent = `${filtered.length}개 기수 표시`;
  }
}

// ─── Render: Weekly Table ───────────────────────────────────

function renderWeeklyTable(): void {
  const tbody = $("doWeeklyTbody");
  const statusEl = $("doWeeklyStatus");
  if (!tbody) return;

  const weekPicker = $("doWeeklyPicker") as HTMLInputElement | null;
  const weekVal = weekPicker?.value || ""; // format: YYYY-Www (e.g., "2024-W12")

  if (!weekVal) {
    // 기본: 전체 표시
    const sorted = sortByStartDateAsc(dropoutData);
    tbody.innerHTML = sorted.map((e) => renderDetailRow(e, true)).join("");
    if (statusEl) statusEl.textContent = `전체 ${dropoutData.length}개 기수`;
    return;
  }

  // 주간 파싱
  const m = weekVal.match(/(\d{4})-W(\d{2})/);
  if (!m) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#6b7280;">주간을 선택해주세요.</td></tr>';
    return;
  }
  const targetYear = parseInt(m[1]);
  const targetWeek = parseInt(m[2]);

  const filtered = dropoutData.filter((e) => {
    if (!e.startDate) return false;
    const d = new Date(e.startDate);
    if (isNaN(d.getTime())) return false;
    const { year, week } = getISOWeek(d);
    return year === targetYear && week === targetWeek;
  });

  const sorted = sortByStartDateAsc(filtered);
  tbody.innerHTML = sorted.length > 0
    ? sorted.map((e) => renderDetailRow(e, true)).join("") + renderSubtotalRow("주간 소계", filtered, 4)
    : `<tr><td colspan="10" style="text-align:center;color:#6b7280;">해당 주간에 개강한 과정이 없습니다.</td></tr>`;

  if (statusEl) {
    statusEl.textContent = `${filtered.length}개 기수 표시 (${targetYear}년 ${targetWeek}주차)`;
  }
}

// ─── Charts ─────────────────────────────────────────────────

function renderCourseChart(): void {
  const canvas = $("doChartCourse") as HTMLCanvasElement | null;
  if (!canvas) return;

  const summaries = getCourseSummaries().sort((a, b) => b.defenseRate - a.defenseRate);

  const catMap = new Map<string, CourseCategory>();
  for (const e of dropoutData) {
    if (!catMap.has(e.courseName)) catMap.set(e.courseName, e.category);
  }

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: summaries.map((s) => s.label.length > 10 ? s.label.slice(0, 10) + "…" : s.label),
      datasets: [{
        label: "하차방어율 (%)",
        data: summaries.map((s) => Math.round(s.defenseRate * 10) / 10),
        backgroundColor: summaries.map((s) => {
          const cat = catMap.get(s.label) || "실업자";
          const target = getTargetRate(cat);
          return s.defenseRate >= target ? "rgba(16,185,129,0.7)" :
                 s.defenseRate >= target - 5 ? "rgba(245,158,11,0.7)" :
                 "rgba(239,68,68,0.7)";
        }),
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { min: 0, max: 100, title: { display: true, text: "하차방어율 (%)" } } },
    },
    plugins: [{
      id: "targetLines",
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!scales.x) return;
        const targets = [
          { val: KPI_TARGET.employed, color: "#6366f1", label: `재직자 ${KPI_TARGET.employed}%` },
          { val: KPI_TARGET.unemployed, color: "#10b981", label: `실업자 ${KPI_TARGET.unemployed}%` },
        ];
        for (const t of targets) {
          const x = scales.x.getPixelForValue(t.val);
          ctx.save();
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.fillStyle = t.color;
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(t.label, x, chartArea.top - 4);
          ctx.restore();
        }
      },
    }],
  });
  chartInstances.push(chart);
}

function renderCategoryChart(): void {
  const canvas = $("doChartCategory") as HTMLCanvasElement | null;
  if (!canvas) return;

  const employed = getCategorySummary("재직자");
  const unemployed = getCategorySummary("실업자");

  const chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["재직자 방어", "재직자 이탈", "실업자 방어", "실업자 이탈"],
      datasets: [{
        data: [employed.active, employed.dropout, unemployed.active, unemployed.dropout],
        backgroundColor: [
          "rgba(99,102,241,0.8)", "rgba(99,102,241,0.25)",
          "rgba(16,185,129,0.8)", "rgba(16,185,129,0.25)",
        ],
        borderWidth: 2,
        borderColor: "#fff",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } },
    },
  });
  chartInstances.push(chart);
}

function renderDegrChart(): void {
  const canvas = $("doChartDegr") as HTMLCanvasElement | null;
  if (!canvas) return;

  const courseMap = new Map<string, { degr: string; rate: number }[]>();
  for (const e of dropoutData) {
    if (!courseMap.has(e.courseName)) courseMap.set(e.courseName, []);
    courseMap.get(e.courseName)!.push({ degr: e.degr, rate: e.defenseRate });
  }

  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];
  const datasets = Array.from(courseMap.entries()).map(([name, points], i) => ({
    label: name.length > 12 ? name.slice(0, 12) + "…" : name,
    data: points.sort((a, b) => Number(a.degr) - Number(b.degr)).map((p) => p.rate),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length] + "20",
    tension: 0.3,
    pointRadius: 5,
    pointHoverRadius: 7,
  }));

  const maxDegr = Math.max(...Array.from(courseMap.values()).map((v) => v.length));
  const labels = Array.from({ length: maxDegr }, (_, i) => `${i + 1}기`);

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { font: { size: 10 } } } },
      scales: { y: { min: 0, max: 100, title: { display: true, text: "하차방어율 (%)" } } },
    },
    plugins: [{
      id: "targetHorizontalLines",
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!scales.y) return;
        const targets = [
          { val: KPI_TARGET.employed, color: "#6366f1", label: `재직자 목표 ${KPI_TARGET.employed}%` },
          { val: KPI_TARGET.unemployed, color: "#10b981", label: `실업자 목표 ${KPI_TARGET.unemployed}%` },
        ];
        for (const t of targets) {
          const y = scales.y.getPixelForValue(t.val);
          ctx.save();
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.stroke();
          ctx.fillStyle = t.color;
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "right";
          ctx.fillText(t.label, chartArea.right, y - 4);
          ctx.restore();
        }
      },
    }],
  });
  chartInstances.push(chart);
}

// ─── Tab Management ─────────────────────────────────────────

function setupDropoutTabs(): void {
  const tabs = document.querySelectorAll("[data-do-tab]");
  const panels = document.querySelectorAll("[data-do-panel]");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = (tab as HTMLElement).dataset.doTab || "";
      panels.forEach((p) => {
        (p as HTMLElement).style.display = (p as HTMLElement).dataset.doPanel === target ? "block" : "none";
      });
    });
  });
}

// ─── Filter Handlers ────────────────────────────────────────

function setupFilterHandlers(): void {
  // Monthly filter
  const monthlyQueryBtn = $("doMonthlyQuery");
  monthlyQueryBtn?.addEventListener("click", renderMonthlyTable);

  // Weekly filter
  const weeklyQueryBtn = $("doWeeklyQuery");
  weeklyQueryBtn?.addEventListener("click", renderWeeklyTable);
}

// ─── Main ───────────────────────────────────────────────────

function renderAllTables(): void {
  renderSummaryCards();
  renderCourseTable();
  renderDegrTable();
  renderYearlyTable();
  renderCategoryDetailTable("재직자");
  renderCategoryDetailTable("실업자");
  populateMonthlyFilters();
  renderMonthlyTable();
  renderWeeklyTable();
}

async function fetchAndRenderDropout(): Promise<void> {
  const statusEl = $("doLoadStatus");
  const emptyEl = $("doEmptyState");
  const contentEl = $("doContent");

  if (statusEl) statusEl.textContent = "전체 과정 명단 조회 중...";

  try {
    const config = loadHrdConfig();
    dropoutData = await fetchAllRosters(config, (msg) => {
      if (statusEl) statusEl.textContent = msg;
    });

    if (dropoutData.length === 0) {
      if (statusEl) statusEl.textContent = "데이터가 없습니다.";
      return;
    }

    destroyCharts();
    renderAllTables();
    renderCourseChart();
    renderCategoryChart();
    renderDegrChart();

    const overall = getOverallSummary();
    if (statusEl) statusEl.textContent = `✅ ${config.courses.length}개 과정, ${dropoutData.length}개 기수 조회 완료 (총 ${overall.total}명)`;
    if (emptyEl) emptyEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function initDropoutDashboard(): void {
  // Query button
  const queryBtn = $("doQueryBtn");
  queryBtn?.addEventListener("click", fetchAndRenderDropout);

  // Internal tabs (course/degr/yearly/category/monthly/weekly)
  setupDropoutTabs();
  setupFilterHandlers();
}
