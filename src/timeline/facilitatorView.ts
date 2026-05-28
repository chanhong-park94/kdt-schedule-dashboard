import { escapeHtml } from "../core/escape";
import {
  FACILITATOR_DATA,
  FACILITATOR_META,
  FACILITATOR_TIMELINE_END,
  FACILITATOR_TIMELINE_START,
  TYPE_COLORS,
  type FacilitatorCourse,
  type FacilitatorPhase,
} from "./facilitatorData";
import { checkFacilitatorUpdate } from "./facilitatorSync";
import { loadLastCheck, saveLastCheck, type LastCheckResult } from "./facilitatorStorage";

// ─── 날짜 헬퍼 ──────────────────────────────────────
const HOL_SET = new Set(FACILITATOR_DATA.holidays);

function pd(s: string): Date {
  const p = s.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function ds(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtMD(d: Date): string {
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function isBiz(d: Date): boolean {
  return d.getDay() > 0 && d.getDay() < 6 && !HOL_SET.has(ds(d));
}
function countBiz(s: Date, e: Date): number {
  let c = 0;
  let d = new Date(s);
  while (d <= e) {
    if (isBiz(d)) c++;
    d = addDays(d, 1);
  }
  return c;
}

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const TS = pd(FACILITATOR_TIMELINE_START);
const TE = pd(FACILITATOR_TIMELINE_END);
const TD_DAYS = (TE.getTime() - TS.getTime()) / 86400000;

function d2pct(d: Date): number {
  return Math.max(0, Math.min(100, ((d.getTime() - TS.getTime()) / 86400000) / TD_DAYS * 100));
}

function personColor(person: string): { bg: string; fg: string } {
  const c = FACILITATOR_DATA.colors[person];
  return { bg: c?.[0] ?? "#e5e7eb", fg: c?.[1] ?? "#000" };
}

function phaseClass(ph: string): string {
  if (ph === "P1") return "p1";
  if (ph === "P2") return "p2";
  if (ph.startsWith("P3")) return "p365";
  return "px";
}

// ─── 1. 오늘의 업무 ──────────────────────────────────────
function getTodayTasks() {
  const tasks: Array<{
    course: string;
    type: string;
    phase: string;
    person: string;
    total: number;
    done: number;
    pct: number;
    section: string;
  }> = [];
  for (const c of FACILITATOR_DATA.courses) {
    for (const ph of c.phases) {
      const s = pd(ph.s);
      const e = pd(ph.e);
      if (TODAY >= s && TODAY <= e) {
        const total = countBiz(s, e);
        const done = countBiz(s, TODAY);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        tasks.push({ course: c.name, type: c.type, phase: ph.ph, person: ph.person, total, done, pct, section: c.section });
      }
    }
  }
  return tasks;
}

function renderTodaySection(): string {
  const tasks = getTodayTasks();
  if (tasks.length === 0) {
    return `<section class="facilitator-section">
      <h3 class="facilitator-section-title">📊 오늘의 업무 현황</h3>
      <p class="facilitator-empty">오늘 진행 중인 업무가 없습니다.</p>
    </section>`;
  }
  const cards = tasks
    .sort((a, b) => b.pct - a.pct)
    .map((t) => {
      const { bg } = personColor(t.person);
      return `<article class="facilitator-task-card">
        <div class="facilitator-task-row1">
          <span class="facilitator-task-person" style="background:${escapeHtml(bg)}">${escapeHtml(t.person)}</span>
          <span class="facilitator-task-phase facilitator-phase-${phaseClass(t.phase)}">${escapeHtml(t.phase)}</span>
        </div>
        <div class="facilitator-task-course">${escapeHtml(t.course)} <span class="facilitator-task-type">(${escapeHtml(t.type)})</span></div>
        <div class="facilitator-task-dates">${escapeHtml(t.done.toString())} / ${escapeHtml(t.total.toString())} 영업일 (${t.pct}%)</div>
        <div class="facilitator-progress"><span class="facilitator-progress-fill" style="width:${t.pct}%;background:${escapeHtml(bg)}"></span></div>
      </article>`;
    })
    .join("");
  return `<section class="facilitator-section">
    <h3 class="facilitator-section-title">📊 오늘의 업무 현황 <span class="facilitator-count">${tasks.length}건</span></h3>
    <div class="facilitator-today-grid">${cards}</div>
  </section>`;
}

// ─── 2. 이번 주 주요 일정 ──────────────────────────────────────
function getWeekEvents() {
  const events: Array<{ type: "start" | "end"; course: string; phase: string; person: string; date: Date }> = [];
  // 월요일 기준 주
  const monday = addDays(TODAY, -(TODAY.getDay() === 0 ? 6 : TODAY.getDay() - 1));
  const sunday = addDays(monday, 6);
  for (const c of FACILITATOR_DATA.courses) {
    for (const ph of c.phases) {
      const s = pd(ph.s);
      const e = pd(ph.e);
      if (s >= monday && s <= sunday) events.push({ type: "start", course: c.name, phase: ph.ph, person: ph.person, date: s });
      if (e >= monday && e <= sunday) events.push({ type: "end", course: c.name, phase: ph.ph, person: ph.person, date: e });
    }
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { monday, sunday, events };
}

function renderWeekSection(): string {
  const { monday, sunday, events } = getWeekEvents();
  if (events.length === 0) {
    return `<section class="facilitator-section">
      <h3 class="facilitator-section-title">📅 이번 주 주요 일정 <span class="facilitator-week-range">(${fmtMD(monday)} ~ ${fmtMD(sunday)})</span></h3>
      <p class="facilitator-empty">이번 주에는 시작·종료 이벤트가 없습니다.</p>
    </section>`;
  }
  const tags = events
    .map((e) => {
      const cls = e.type === "start" ? "start" : "end";
      const label = e.type === "start" ? "▶ 시작" : "■ 종료";
      return `<span class="facilitator-event-tag ${cls}">${label} ${fmtMD(e.date)} · ${escapeHtml(e.course)} ${escapeHtml(e.phase)} · ${escapeHtml(e.person)}</span>`;
    })
    .join("");
  return `<section class="facilitator-section">
    <h3 class="facilitator-section-title">📅 이번 주 주요 일정 <span class="facilitator-week-range">(${fmtMD(monday)} ~ ${fmtMD(sunday)})</span></h3>
    <div class="facilitator-week-events">${tags}</div>
  </section>`;
}

// ─── 3. 과정별 간트차트 ──────────────────────────────────────
function getMonthTicks(): { label: string; pct: number }[] {
  const ticks: { label: string; pct: number }[] = [];
  let d = new Date(TS);
  d.setDate(1);
  while (d <= TE) {
    ticks.push({ label: `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, "0")}`, pct: d2pct(d) });
    d.setMonth(d.getMonth() + 1);
  }
  return ticks;
}

function renderGanttSection(): string {
  const ticks = getMonthTicks();
  const tickLine = ticks
    .map(
      (t) =>
        `<div class="facilitator-gantt-tick" style="left:${t.pct.toFixed(2)}%"><span>${escapeHtml(t.label)}</span></div>`,
    )
    .join("");
  const todayPct = TODAY >= TS && TODAY <= TE ? d2pct(TODAY) : null;
  const todayLine =
    todayPct !== null
      ? `<div class="facilitator-gantt-today" style="left:${todayPct.toFixed(2)}%" title="오늘"></div>`
      : "";
  const rows = FACILITATOR_DATA.courses.map((c) => renderGanttRow(c)).join("");

  return `<section class="facilitator-section">
    <h3 class="facilitator-section-title">📈 과정별 간트차트 <span class="facilitator-count">${FACILITATOR_DATA.courses.length}개 과정</span></h3>
    <div class="facilitator-gantt">
      <div class="facilitator-gantt-axis">${tickLine}</div>
      <div class="facilitator-gantt-rows">
        ${todayLine}
        ${rows}
      </div>
    </div>
  </section>`;
}

function renderGanttRow(c: FacilitatorCourse): string {
  const typeColor = TYPE_COLORS[c.type] ?? "#94a3b8";
  const bars = c.phases
    .map((ph) => {
      const s = pd(ph.s);
      const e = pd(ph.e);
      const left = d2pct(s);
      const width = Math.max(0.3, d2pct(e) - d2pct(s));
      const { bg, fg } = personColor(ph.person);
      return `<div class="facilitator-gantt-bar facilitator-phase-${phaseClass(ph.ph)}"
        style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${escapeHtml(bg)};color:${escapeHtml(fg)}"
        title="${escapeHtml(c.name)} ${escapeHtml(ph.ph)} · ${escapeHtml(ph.person)} · ${escapeHtml(ph.s)}~${escapeHtml(ph.e)}">
        <span>${escapeHtml(ph.ph)} · ${escapeHtml(ph.person)}</span>
      </div>`;
    })
    .join("");
  return `<div class="facilitator-gantt-row">
    <div class="facilitator-gantt-label" style="border-left-color:${escapeHtml(typeColor)}">
      <span class="facilitator-gantt-course-name">${escapeHtml(c.name)}</span>
      <span class="facilitator-gantt-course-type">${escapeHtml(c.type)}${c.section === "new" ? " · 신규" : ""}</span>
    </div>
    <div class="facilitator-gantt-track">${bars}</div>
  </div>`;
}

// ─── 4. 인력별 현황 ──────────────────────────────────────
function renderPersonSection(): string {
  const ticks = getMonthTicks();
  const tickLine = ticks
    .map((t) => `<div class="facilitator-gantt-tick" style="left:${t.pct.toFixed(2)}%"><span>${escapeHtml(t.label)}</span></div>`)
    .join("");
  const todayPct = TODAY >= TS && TODAY <= TE ? d2pct(TODAY) : null;
  const todayLine =
    todayPct !== null ? `<div class="facilitator-gantt-today" style="left:${todayPct.toFixed(2)}%"></div>` : "";

  const skip = new Set(FACILITATOR_DATA.skipPersons);
  const rows = FACILITATOR_DATA.personOrder
    .filter((p) => !skip.has(p))
    .map((person) => {
      const assignments: Array<{ course: string; ph: FacilitatorPhase }> = [];
      for (const c of FACILITATOR_DATA.courses) {
        for (const ph of c.phases) {
          if (ph.person === person) assignments.push({ course: c.name, ph });
        }
      }
      assignments.sort((a, b) => pd(a.ph.s).getTime() - pd(b.ph.s).getTime());
      const bars = assignments
        .map(({ course, ph }) => {
          const s = pd(ph.s);
          const e = pd(ph.e);
          const left = d2pct(s);
          const width = Math.max(0.3, d2pct(e) - d2pct(s));
          const { bg, fg } = personColor(person);
          return `<div class="facilitator-gantt-bar facilitator-phase-${phaseClass(ph.ph)}"
            style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${escapeHtml(bg)};color:${escapeHtml(fg)}"
            title="${escapeHtml(course)} ${escapeHtml(ph.ph)} · ${escapeHtml(ph.s)}~${escapeHtml(ph.e)}">
            <span>${escapeHtml(course)} ${escapeHtml(ph.ph)}</span>
          </div>`;
        })
        .join("");
      return `<div class="facilitator-gantt-row">
        <div class="facilitator-gantt-label" style="border-left-color:${escapeHtml(personColor(person).bg)}">
          <span class="facilitator-gantt-course-name">${escapeHtml(person)}</span>
          <span class="facilitator-gantt-course-type">${assignments.length}건</span>
        </div>
        <div class="facilitator-gantt-track">${bars}</div>
      </div>`;
    })
    .join("");

  return `<section class="facilitator-section">
    <h3 class="facilitator-section-title">👥 인력별 현황 <span class="facilitator-count">${FACILITATOR_DATA.personOrder.length - skip.size}명</span></h3>
    <div class="facilitator-gantt">
      <div class="facilitator-gantt-axis">${tickLine}</div>
      <div class="facilitator-gantt-rows">
        ${todayLine}
        ${rows}
      </div>
    </div>
  </section>`;
}

// ─── 헤더 + 업데이트 확인 ──────────────────────────────────────
function renderHeader(lastCheck: LastCheckResult | null): string {
  const status = lastCheck
    ? `<span class="facilitator-sync-status facilitator-sync-${escapeHtml(lastCheck.status)}">${escapeHtml(lastCheck.message)}</span>
       <span class="facilitator-sync-time">· ${escapeHtml(new Date(lastCheck.checkedAt).toLocaleString("ko-KR"))}</span>`
    : `<span class="facilitator-sync-status">마지막 동기화: ${escapeHtml(FACILITATOR_META.fetchedAt)}</span>`;
  return `<header class="facilitator-header">
    <div>
      <h2 class="facilitator-title">👥 ${escapeHtml(FACILITATOR_META.title)} <span class="facilitator-version">${escapeHtml(FACILITATOR_META.version)}</span></h2>
      <p class="facilitator-subtitle">
        출처: <a href="${escapeHtml(FACILITATOR_META.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(FACILITATOR_META.source.replace(/^https?:\/\//, ""))}</a>
        · ${status}
      </p>
    </div>
    <div class="facilitator-actions">
      <button type="button" class="facilitator-update-btn" id="facilitatorUpdateBtn">🔄 업데이트 확인</button>
      <a class="facilitator-open-btn" href="${escapeHtml(FACILITATOR_META.source)}" target="_blank" rel="noopener noreferrer">↗ 외부 사이트 열기</a>
    </div>
  </header>`;
}

// ─── 진입점 ──────────────────────────────────────
export function renderFacilitatorPage(container: HTMLElement): void {
  const lastCheck = loadLastCheck();
  container.innerHTML = `
    ${renderHeader(lastCheck)}
    <div id="facilitatorUpdateResult" class="facilitator-update-result"></div>
    ${renderTodaySection()}
    ${renderWeekSection()}
    ${renderGanttSection()}
    ${renderPersonSection()}
  `;
  bindHandlers(container);
}

function bindHandlers(container: HTMLElement): void {
  const btn = container.querySelector<HTMLButtonElement>("#facilitatorUpdateBtn");
  const result = container.querySelector<HTMLElement>("#facilitatorUpdateResult");
  if (!btn || !result) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "🔄 확인 중...";
    result.innerHTML = `<div class="facilitator-update-loading">외부 사이트와 비교 중...</div>`;
    const r = await checkFacilitatorUpdate();
    btn.disabled = false;
    btn.textContent = "🔄 업데이트 확인";
    const now = new Date().toISOString();
    if (!r.ok) {
      const last: LastCheckResult = { checkedAt: now, status: "error", message: `오류: ${r.error}` };
      saveLastCheck(last);
      result.innerHTML = `<div class="facilitator-update-error">
        <strong>업데이트 확인 실패</strong><br>
        ${escapeHtml(r.error)}<br>
        <a href="${escapeHtml(FACILITATOR_META.source)}" target="_blank" rel="noopener noreferrer">↗ 사이트 직접 열기</a>
      </div>`;
      return;
    }
    const hasDiff = r.added.length > 0 || r.removed.length > 0 || r.changed.length > 0;
    const status: LastCheckResult["status"] = hasDiff ? "diff" : "ok";
    const message = hasDiff
      ? `변경 발견 — 추가 ${r.added.length} / 변경 ${r.changed.length} / 삭제 ${r.removed.length}`
      : "최신 상태입니다";
    saveLastCheck({ checkedAt: now, status, message, added: r.added.length, changed: r.changed.length, removed: r.removed.length });
    const viaLabel =
      r.via === "direct"
        ? "직접 연결"
        : `프록시 (${r.via})`;
    if (!hasDiff) {
      result.innerHTML = `<div class="facilitator-update-ok">
        ✓ 최신 상태입니다 (로컬 ${r.localCount}개 = 원격 ${r.remoteCount}개) <span class="facilitator-update-via">· ${escapeHtml(viaLabel)}</span>
      </div>`;
    } else {
      const detail: string[] = [];
      if (r.added.length > 0) detail.push(`<li><strong>추가 ${r.added.length}건</strong>: ${r.added.map((c) => escapeHtml(c.name)).join(", ")}</li>`);
      if (r.changed.length > 0) detail.push(`<li><strong>변경 ${r.changed.length}건</strong>: ${r.changed.map((c) => escapeHtml(c.name)).join(", ")}</li>`);
      if (r.removed.length > 0) detail.push(`<li><strong>삭제 ${r.removed.length}건</strong>: ${r.removed.map((c) => escapeHtml(c.name)).join(", ")}</li>`);
      result.innerHTML = `<div class="facilitator-update-diff">
        <strong>외부 사이트에 변경이 있습니다</strong> (로컬 ${r.localCount} → 원격 ${r.remoteCount}) <span class="facilitator-update-via">· ${escapeHtml(viaLabel)}</span>
        <ul>${detail.join("")}</ul>
        <p class="facilitator-update-note">영구 반영하려면 운영자가 <code>src/timeline/facilitatorData.ts</code>를 갱신하고 PR을 머지하세요.</p>
      </div>`;
    }
  });
}
