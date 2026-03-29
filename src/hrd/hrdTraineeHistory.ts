/** 훈련생 개인 이력 — 과정/기수 선택, 명단 조회, 개인 상세 (출결 캘린더, 주차별 추이) */
import { fetchRoster, fetchDailyAttendance } from "./hrdApi";
import { loadHrdConfig } from "./hrdConfig";
import { isDropout } from "./hrdDropout";
import { isAbsentStatus, isAttendedStatus, isExcusedStatus, calcAbsentDays } from "./hrdTypes";
import type { HrdRawAttendance } from "./hrdTypes";

const $ = (id: string) => document.getElementById(id);

// ─── Helpers ────────────────────────────────────────────
function resolveStatusStr(raw: HrdRawAttendance): string {
  return (raw.atendSttusNm || raw.atendSttusCd || "").toString().trim();
}

function isLateStatus(s: string): boolean {
  return s.includes("지각");
}

function getRiskLevel(remaining: number, total: number): "safe" | "caution" | "warning" | "danger" {
  if (total === 0) return "safe";
  const maxAbsent = Math.floor(total * 0.2);
  if (maxAbsent === 0) return "safe";
  const remainRate = remaining / maxAbsent;
  if (remainRate <= 0.15) return "danger";
  if (remainRate <= 0.30) return "warning";
  if (remainRate <= 0.60) return "caution";
  return "safe";
}

function riskBadgeHtml(level: string): string {
  const cls =
    level === "danger"
      ? "badge-danger"
      : level === "warning"
        ? "badge-warning"
        : level === "caution"
          ? "badge-caution"
          : "badge-safe";
  const label = level === "danger" ? "제적위험" : level === "warning" ? "경고" : level === "caution" ? "주의" : "정상";
  return `<span class="dash-risk-badge ${cls}">${label}</span>`;
}

function statusBadgeHtml(status: string): string {
  let cls = "th-status-active";
  if (status.includes("중도탈락") || status.includes("수료포기")) cls = "th-status-dropout";
  else if (status.includes("조기취업")) cls = "th-status-early-employ";
  else if (status.includes("80%이상수료")) cls = "th-status-partial";
  else if (status.includes("수료") || status.includes("정상수료") || status.includes("수료후취업"))
    cls = "th-status-complete";
  return `<span class="th-detail-badge ${cls}">${status}</span>`;
}

// ─── Filter Bar ─────────────────────────────────────────
export function initTraineeHistory(): void {
  const filterContainer = $("traineeHistoryFilter");
  if (!filterContainer) return;

  const config = loadHrdConfig();
  const courses = config.courses;

  filterContainer.innerHTML = `
    <select id="thCourseSelect">
      <option value="">과정 선택</option>
      ${courses.map((c) => `<option value="${c.trainPrId}" data-degrs='${JSON.stringify(c.degrs)}' data-name="${c.name}" data-totaldays="${c.totalDays}">${c.name}</option>`).join("")}
    </select>
    <select id="thDegrSelect" disabled>
      <option value="">기수 선택</option>
    </select>
    <input type="text" id="thSearchInput" placeholder="이름 검색" />
    <button id="thLoadBtn" type="button">조회</button>
  `;

  const courseSelect = $("thCourseSelect") as HTMLSelectElement;
  const degrSelect = $("thDegrSelect") as HTMLSelectElement;
  const loadBtn = $("thLoadBtn") as HTMLButtonElement;

  courseSelect?.addEventListener("change", () => {
    const opt = courseSelect.selectedOptions[0];
    const degrs = opt?.dataset.degrs ? (JSON.parse(opt.dataset.degrs) as string[]) : [];
    if (degrSelect) {
      degrSelect.innerHTML =
        `<option value="">기수 선택</option>` + degrs.map((d) => `<option value="${d}">${d}기</option>`).join("");
      degrSelect.disabled = degrs.length === 0;
    }
  });

  loadBtn?.addEventListener("click", () => {
    const trainPrId = courseSelect?.value || "";
    const degr = degrSelect?.value || "";
    const opt = courseSelect?.selectedOptions[0];
    const courseName = opt?.dataset.name || "";
    const totalDays = parseInt(opt?.dataset.totaldays || "0", 10);
    if (!trainPrId || !degr) return;
    loadAndRenderList(trainPrId, degr, courseName, totalDays);
  });

  // 대시보드에서 네비게이션 이벤트 수신
  window.addEventListener("openTraineeDetail", ((e: CustomEvent) => {
    const { name, courseName, trainPrId, degr } = e.detail;
    // 필터 설정
    if (courseSelect) {
      courseSelect.value = trainPrId;
      courseSelect.dispatchEvent(new Event("change"));
      setTimeout(() => {
        if (degrSelect) degrSelect.value = degr;
        const opt = courseSelect.selectedOptions[0];
        const totalDays = parseInt(opt?.dataset.totaldays || "0", 10);
        loadAndRenderList(trainPrId, degr, courseName, totalDays, name);
      }, 100);
    }
  }) as EventListener);
}

// ─── Roster List ────────────────────────────────────────
async function loadAndRenderList(
  trainPrId: string,
  degr: string,
  courseName: string,
  totalDays: number,
  autoOpenName?: string,
): Promise<void> {
  const listContainer = $("traineeHistoryList");
  const detailContainer = $("traineeHistoryDetail");
  if (!listContainer) return;
  if (detailContainer) detailContainer.style.display = "none";

  listContainer.innerHTML = `<div class="dash-loading"><div class="dash-spinner"></div><p>명단 조회 중...</p></div>`;

  try {
    const config = loadHrdConfig();
    const roster = await fetchRoster(config, trainPrId, degr);
    const searchInput = $("thSearchInput") as HTMLInputElement;
    const searchTerm = searchInput?.value.trim() || "";

    const filtered = roster.filter((raw) => {
      if (!searchTerm) return true;
      const name = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "").toString();
      return name.includes(searchTerm);
    });

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div class="dash-empty">조회 결과가 없습니다.</div>`;
      return;
    }

    listContainer.innerHTML = `
      <table class="th-roster-table">
        <thead><tr><th>이름</th><th>상태</th></tr></thead>
        <tbody>
          ${filtered
            .map((raw) => {
              const name = (raw.trneeCstmrNm || raw.trneNm || raw.trneNm1 || raw.cstmrNm || "-").toString().trim();
              const stNm = (raw.trneeSttusNm || raw.atendSttsNm || raw.stttsCdNm || "").toString().trim() || "훈련중";
              return `<tr>
              <td><span class="th-name-link" data-name="${name}">${name}</span></td>
              <td>${statusBadgeHtml(stNm)}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;

    // 이름 클릭 이벤트
    listContainer.querySelectorAll<HTMLElement>(".th-name-link").forEach((el) => {
      el.addEventListener("click", () => {
        const name = el.dataset.name || "";
        showTraineeDetail(name, trainPrId, degr, courseName, totalDays);
      });
    });

    // 자동 열기
    if (autoOpenName) {
      showTraineeDetail(autoOpenName, trainPrId, degr, courseName, totalDays);
    }
  } catch (e) {
    listContainer.innerHTML = `<div class="dash-empty">데이터 조회 중 오류가 발생했습니다.</div>`;
    console.warn("[TraineeHistory] Error:", e);
  }
}

// ─── Individual Detail ──────────────────────────────────
async function showTraineeDetail(
  name: string,
  trainPrId: string,
  degr: string,
  courseName: string,
  totalDays: number,
): Promise<void> {
  const container = $("traineeHistoryDetail");
  if (!container) return;

  container.style.display = "block";
  container.innerHTML = `<div class="dash-loading"><div class="dash-spinner"></div><p>${name} 출결 데이터 조회 중...</p></div>`;

  try {
    const config = loadHrdConfig();

    // 명단에서 상태 확인
    const roster = await fetchRoster(config, trainPrId, degr);
    const trainee = roster.find((r) => {
      const n = (r.trneeCstmrNm || r.trneNm || r.trneNm1 || r.cstmrNm || "").toString().trim();
      return n === name;
    });
    const stNm = trainee
      ? (trainee.trneeSttusNm || trainee.atendSttsNm || trainee.stttsCdNm || "").toString().trim() || "훈련중"
      : "훈련중";
    // 출결 데이터 (최근 6개월)
    const now = new Date();
    const months: string[] = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const allRecords: HrdRawAttendance[] = [];
    for (const month of months) {
      try {
        const records = await fetchDailyAttendance(config, trainPrId, degr, month);
        allRecords.push(...records);
      } catch {
        /* skip */
      }
    }

    const nameKey = name.replace(/\s+/g, "");
    const myRecords = allRecords.filter((r) => {
      const rName = (r.cstmrNm || r.trneeCstmrNm || r.trneNm || "").toString().replace(/\s+/g, "");
      return rName === nameKey;
    });

    // 출결 통계 계산
    const statuses = myRecords.map(resolveStatusStr);
    const attendedDays = statuses.filter(isAttendedStatus).length;
    // HRD-Net 기준: 순수결석 + 지각3회=1결석 + 조퇴3회=1결석
    const absentDays = calcAbsentDays(statuses.map((s) => ({ status: s })));
    const lateDays = statuses.filter(isLateStatus).length;
    const excusedDays = statuses.filter(isExcusedStatus).length;
    const maxAbsent = Math.floor(totalDays * 0.2);
    const remainingAbsent = maxAbsent - absentDays;
    const effectiveDays = totalDays > 0 ? totalDays - excusedDays : myRecords.length || 1;
    const attendanceRate = myRecords.length === 0 ? -1 : effectiveDays > 0 ? (attendedDays / effectiveDays) * 100 : 100;
    const riskLevel = getRiskLevel(remainingAbsent, totalDays);

    // 경보 사유
    const alerts: { text: string; level: string }[] = [];
    if (riskLevel === "danger")
      alerts.push({ text: `잔여 결석 허용일 ${remainingAbsent}일 — 제적 위험`, level: "high" });
    if (riskLevel === "warning") alerts.push({ text: `잔여 결석 허용일 ${remainingAbsent}일 — 경고`, level: "medium" });
    if (lateDays >= 5) alerts.push({ text: `상습 지각 ${lateDays}회`, level: "medium" });

    // 연속결석 체크
    let maxConsec = 0,
      curConsec = 0;
    const sortedRecords = [...myRecords].sort((a, b) => (a.atendDe || "").localeCompare(b.atendDe || ""));
    for (const r of sortedRecords) {
      const s = resolveStatusStr(r);
      if (isAbsentStatus(s)) {
        curConsec++;
        if (curConsec > maxConsec) maxConsec = curConsec;
      } else {
        curConsec = 0;
      }
    }
    if (maxConsec >= 3) alerts.push({ text: `최대 연속결석 ${maxConsec}일`, level: "high" });

    // 일별 출결 맵 (캘린더용)
    const dayMap = new Map<string, string>();
    for (const r of myRecords) {
      const date = (r.atendDe || "").toString();
      if (date.length === 8) {
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        dayMap.set(iso, resolveStatusStr(r));
      }
    }

    // 주차별 출석률 (실제 출결 데이터가 있는 기간 기준)
    const weeklyRates: { label: string; rate: number }[] = [];
    const allDates = [...dayMap.keys()].sort();
    if (allDates.length > 0) {
      const firstDate = new Date(allDates[0]);
      const lastDate = new Date(allDates[allDates.length - 1]);
      // 첫 출결일 기준 월요일로 정렬
      const startMonday = new Date(firstDate);
      startMonday.setDate(startMonday.getDate() - ((startMonday.getDay() + 6) % 7));
      const totalWeeks = Math.ceil((lastDate.getTime() - startMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
      for (let w = 0; w < totalWeeks; w++) {
        const wStart = new Date(startMonday);
        wStart.setDate(wStart.getDate() + w * 7);
        const wEnd = new Date(wStart);
        wEnd.setDate(wEnd.getDate() + 6);
        let total = 0, attended = 0;
        for (const [dateStr, status] of dayMap) {
          const d = new Date(dateStr);
          if (d >= wStart && d <= wEnd) {
            total++;
            if (isAttendedStatus(status)) attended++;
          }
        }
        if (total > 0) weeklyRates.push({ label: `${w + 1}주`, rate: (attended / total) * 100 });
      }
    }

    // HTML 렌더링
    container.innerHTML = `
      <div class="th-detail-header">
        <span class="th-detail-name">${name}</span>
        <span class="th-detail-meta">${courseName} ${degr}기</span>
        ${statusBadgeHtml(stNm)}
        ${riskBadgeHtml(riskLevel)}
        <button class="th-detail-close" id="thDetailClose">닫기</button>
      </div>

      <div class="th-stat-cards">
        <div class="th-stat-card">
          <div class="th-stat-value ${attendanceRate >= 80 ? "th-stat-good" : attendanceRate >= 70 ? "th-stat-warn" : "th-stat-danger"}">
            ${attendanceRate >= 0 ? attendanceRate.toFixed(1) + "%" : "-"}
          </div>
          <div class="th-stat-label">출석률</div>
        </div>
        <div class="th-stat-card">
          <div class="th-stat-value">${absentDays} / ${maxAbsent}</div>
          <div class="th-stat-label">결석 / 최대허용</div>
        </div>
        <div class="th-stat-card">
          <div class="th-stat-value ${remainingAbsent <= 1 ? "th-stat-danger" : remainingAbsent <= 3 ? "th-stat-warn" : "th-stat-good"}">
            ${remainingAbsent}일
          </div>
          <div class="th-stat-label">잔여 허용 결석</div>
        </div>
      </div>

      ${
        alerts.length > 0
          ? `
        <ul class="th-alert-list">
          ${alerts.map((a) => `<li class="th-alert-item alert-${a.level}">${a.text}</li>`).join("")}
        </ul>
      `
          : ""
      }

      <div class="th-detail-body">
        <div class="th-calendar" id="thCalendar"></div>
        <div class="th-chart-area" style="display:flex;flex-direction:column">
          <h4>주차별 출석률 추이</h4>
          <div id="thWeeklyBars" style="flex:1;overflow-y:auto"></div>
        </div>
      </div>
    `;

    // 닫기 버튼
    $("thDetailClose")?.addEventListener("click", () => {
      container.style.display = "none";
        });

    // 캘린더 히트맵 렌더링
    renderCalendarHeatmap(dayMap, months);

    // 주차별 바 차트 (CSS 기반)
    const barsEl = document.getElementById("thWeeklyBars");
    if (barsEl && weeklyRates.length > 0) {
      barsEl.innerHTML = weeklyRates.map((w) => {
        const color = w.rate < 70 ? "#ef4444" : w.rate < 80 ? "#f59e0b" : "#10b981";
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px">
          <span style="min-width:48px;color:var(--text-muted);text-align:right">${w.label}</span>
          <div style="flex:1;height:16px;background:var(--surface-hover,#f5f3f8);border-radius:4px;overflow:hidden">
            <div style="width:${w.rate}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s"></div>
          </div>
          <span style="min-width:38px;font-weight:600;color:${color}">${w.rate.toFixed(0)}%</span>
        </div>`;
      }).join("");
    } else if (barsEl) {
      barsEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px">주차별 데이터 없음</div>';
    }

    container.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    container.innerHTML = `<div class="dash-empty">출결 데이터를 불러올 수 없습니다.</div>`;
    console.warn("[TraineeHistory] Detail error:", e);
  }
}

// ─── Calendar Heatmap ───────────────────────────────────
function renderCalendarHeatmap(dayMap: Map<string, string>, monthStrings: string[]): void {
  const calContainer = $("thCalendar");
  if (!calContainer) return;

  // 데이터가 있는 월만 필터링
  const monthsWithData = monthStrings.filter((ms) => {
    const prefix = `${ms.slice(0, 4)}-${ms.slice(4, 6)}`;
    for (const key of dayMap.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  });

  if (monthsWithData.length === 0) {
    calContainer.innerHTML = `<div class="dash-empty">출결 데이터가 없습니다.</div>`;
    return;
  }

  const dayHeaders = ["일", "월", "화", "수", "목", "금", "토"];

  // 범례
  let html = `<div class="th-calendar-legend">
    <span class="th-legend-item cal-present">출석</span>
    <span class="th-legend-item cal-late">지각</span>
    <span class="th-legend-item cal-absent">결석</span>
    <span class="th-legend-item cal-excused">공결</span>
    <span class="th-legend-item cal-weekend">주말</span>
  </div>`;

  html += `<div class="th-calendar-months">`;
  for (const ms of monthsWithData) {
    const year = parseInt(ms.slice(0, 4), 10);
    const month = parseInt(ms.slice(4, 6), 10) - 1;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();

    html += `<div class="th-calendar-month">`;
    html += `<div class="th-calendar-month-label">${year}년 ${month + 1}월</div>`;
    html += `<div class="th-calendar-grid">`;
    html += dayHeaders.map((d) => `<div class="th-calendar-day-header">${d}</div>`).join("");

    for (let i = 0; i < startDow; i++) {
      html += `<div class="th-calendar-cell cal-empty"></div>`;
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = date.getDay();
      const status = dayMap.get(iso) || "";

      let cls = "cal-empty";
      if (dow === 0 || dow === 6) {
        cls = "cal-weekend";
      } else if (status) {
        if (isAttendedStatus(status) && !isLateStatus(status)) cls = "cal-present";
        else if (isLateStatus(status)) cls = "cal-late";
        else if (isAbsentStatus(status)) cls = "cal-absent";
        else if (isExcusedStatus(status)) cls = "cal-excused";
        else cls = "cal-present";
      }

      html += `<div class="th-calendar-cell ${cls}" title="${iso}: ${status || "기록없음"}">${String(d)}</div>`;
    }

    html += `</div></div>`;
  }
  html += `</div>`; // close th-calendar-months

  calContainer.innerHTML = html;
}
