# 학업성취도 대시보드 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Google Sheets에서 노드/퀘스트 학업성취도 데이터를 읽어와 과정/기수별 훈련생 성적 테이블을 보여주는 새 탭 구현

**Architecture:** Apps Script Web App을 구글시트에 배포 → 클라이언트에서 JSON fetch → 과정/기수 필터 테이블 + 행 클릭 시 상세 매트릭스 펼침. 기존 `kpiSheets.ts` 패턴을 따르며, `hrdAnalytics.ts` 스타일의 init 함수 + 캐시 구조 사용.

**Tech Stack:** TypeScript, Vite, Google Apps Script, localStorage 캐시

---

### Task 1: Apps Script 코드 작성

**Files:**
- Create: `docs/apps-script-achievement.js`

**Step 1: Apps Script 코드 작성**

구글시트에 배포할 Web App 스크립트. 3가지 action 지원:
- `unified` → 노드퀘스트DB 통합시트 전체
- `node` → 개별 노드 시트 (sheet 파라미터 필요)
- `quest` → 개별 퀘스트 시트 (sheet 파라미터 필요)
- `sheets` → 사용 가능한 시트 목록 반환

```javascript
function doGet(e) {
  const action = e.parameter.action || "sheets";
  const sheetName = e.parameter.sheet || "";
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === "sheets") {
    const names = ss.getSheets().map(s => s.getName());
    return jsonResponse({ sheets: names });
  }

  if (action === "unified") {
    const sheet = ss.getSheetByName("노드퀘스트DB (통합)");
    if (!sheet) return jsonResponse({ error: "통합 시트 없음" });
    const data = sheet.getDataRange().getValues();
    return jsonResponse({ headers: data[0], rows: data.slice(1) });
  }

  if (action === "node" || action === "quest") {
    const prefix = action === "node" ? "노드" : "퀘스트";
    const fullName = `${prefix}(${sheetName})`;
    const sheet = ss.getSheetByName(fullName);
    if (!sheet) return jsonResponse({ error: `시트 없음: ${fullName}` });
    const data = sheet.getDataRange().getValues();
    return jsonResponse({ sheetName: fullName, headers: data[0], rows: data.slice(1) });
  }

  return jsonResponse({ error: "Unknown action" });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**Step 2: 커밋**

```bash
git add docs/apps-script-achievement.js
git commit -m "feat: 학업성취도 Apps Script Web App 코드"
```

---

### Task 2: 타입 정의

**Files:**
- Create: `src/hrd/hrdAchievementTypes.ts`

**Step 1: 타입 파일 작성**

```typescript
/** 노드퀘스트DB 통합시트 1행 = 1개 노드 또는 퀘스트 기록 */
export interface UnifiedRecord {
  구분: string;
  기수: string;
  학번: number;
  고유번호: number;
  이름: string;
  길드: string;
  과정: string;
  세부과정: string;
  훈련상태: string;
  모듈명: string;
  노드명: string;
  별점: number;
  노드순서: number;
  노드실행여부: boolean;
  퀘스트명: string;
  퀘스트상태: "P" | "F" | null;
  퀘스트순서: number;
  퀘스트실행여부: boolean;
}

/** 훈련생별 집계 (클라이언트에서 통합시트 그룹핑 후 생성) */
export interface TraineeAchievementSummary {
  이름: string;
  길드: string;
  과정: string;
  기수: string;
  훈련상태: string;
  총노드수: number;
  제출노드수: number;
  노드평균별점: number;
  총퀘스트수: number;
  패스퀘스트수: number;
  신호등: "green" | "yellow" | "red";
}

/** 개별 노드 시트 행 */
export interface NodeSheetRow {
  이름: string;
  신호등: string;
  누적별점: number;
  노드제출률: number;
  모듈별점수: Record<string, number | null>;
}

/** 개별 퀘스트 시트 행 */
export interface QuestSheetRow {
  고유번호: number;
  이름: string;
  길드: string;
  과정: string;
  상태: string;
  퀘스트별상태: Record<string, "P" | "F" | null>;
  PASS_TOTAL: number;
  퀘스트점수: number;
  TOTAL: number;
}

/** 학업성취도 설정 */
export interface AchievementConfig {
  webAppUrl: string;
}

export const ACHIEVEMENT_CONFIG_KEY = "kdt_achievement_config_v1";
export const ACHIEVEMENT_CACHE_KEY = "kdt_achievement_cache_v1";
```

**Step 2: 커밋**

```bash
git add src/hrd/hrdAchievementTypes.ts
git commit -m "feat: 학업성취도 타입 정의"
```

---

### Task 3: API 모듈 (Google Sheets 연동)

**Files:**
- Create: `src/hrd/hrdAchievementApi.ts`

**Step 1: API 모듈 작성**

Apps Script Web App fetch → JSON 파싱 → 타입 변환. `kpiSheets.ts`의 `fetchViaAppsScript` 패턴 참고.

```typescript
import type {
  UnifiedRecord,
  TraineeAchievementSummary,
  NodeSheetRow,
  QuestSheetRow,
  AchievementConfig,
} from "./hrdAchievementTypes";
import { ACHIEVEMENT_CONFIG_KEY, ACHIEVEMENT_CACHE_KEY } from "./hrdAchievementTypes";

// ── 설정 저장/불러오기 ──
export function loadAchievementConfig(): AchievementConfig {
  try {
    const raw = localStorage.getItem(ACHIEVEMENT_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { webAppUrl: "" };
}

export function saveAchievementConfig(config: AchievementConfig): void {
  localStorage.setItem(ACHIEVEMENT_CONFIG_KEY, JSON.stringify(config));
}

// ── 캐시 ──
interface AchievementCache {
  timestamp: number;
  unified: UnifiedRecord[];
  sheetList: string[];
}

const CACHE_TTL = 60 * 60 * 1000; // 1시간

export function loadCache(): AchievementCache | null {
  try {
    const raw = localStorage.getItem(ACHIEVEMENT_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as AchievementCache;
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache;
  } catch { return null; }
}

function saveCache(data: AchievementCache): void {
  try { localStorage.setItem(ACHIEVEMENT_CACHE_KEY, JSON.stringify(data)); }
  catch { /* quota exceeded 등 무시 */ }
}

// ── API 호출 ──
async function fetchAction(baseUrl: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** 통합시트 전체 로드 */
export async function fetchUnified(config: AchievementConfig): Promise<UnifiedRecord[]> {
  const cached = loadCache();
  if (cached) return cached.unified;

  const json = await fetchAction(config.webAppUrl, { action: "unified" }) as {
    headers: string[];
    rows: (string | number | boolean | null)[][];
  };

  const records = json.rows.map((row) => ({
    구분: String(row[0] ?? ""),
    기수: String(row[1] ?? ""),
    학번: Number(row[2]) || 0,
    고유번호: Number(row[3]) || 0,
    이름: String(row[4] ?? ""),
    길드: String(row[5] ?? ""),
    과정: String(row[6] ?? ""),
    세부과정: String(row[7] ?? ""),
    훈련상태: String(row[8] ?? ""),
    모듈명: String(row[9] ?? ""),
    노드명: String(row[10] ?? ""),
    별점: Number(row[11]) || 0,
    노드순서: Number(row[12]) || 0,
    노드실행여부: row[13] === true || row[13] === "true",
    퀘스트명: String(row[14] ?? ""),
    퀘스트상태: row[15] === "P" ? "P" : row[15] === "F" ? "F" : null,
    퀘스트순서: Number(row[16]) || 0,
    퀘스트실행여부: row[17] === true || row[17] === "true",
  })) as UnifiedRecord[];

  // 시트 목록도 함께 캐시
  const sheetsJson = await fetchAction(config.webAppUrl, { action: "sheets" }) as { sheets: string[] };
  saveCache({ timestamp: Date.now(), unified: records, sheetList: sheetsJson.sheets });
  return records;
}

/** 사용 가능한 시트 목록 */
export async function fetchSheetList(config: AchievementConfig): Promise<string[]> {
  const cached = loadCache();
  if (cached) return cached.sheetList;
  const json = await fetchAction(config.webAppUrl, { action: "sheets" }) as { sheets: string[] };
  return json.sheets;
}

/** 개별 노드 시트 로드 */
export async function fetchNodeSheet(config: AchievementConfig, sheetKey: string): Promise<NodeSheetRow[]> {
  const json = await fetchAction(config.webAppUrl, { action: "node", sheet: sheetKey }) as {
    headers: string[];
    rows: (string | number | null)[][];
  };
  // 동적 컬럼: 이름 이후 ~ 끝까지가 모듈별 노드 점수
  const headers = json.headers.map(String);
  const nameIdx = headers.indexOf("이름");
  const signalIdx = headers.indexOf("신호등");
  const cumIdx = headers.findIndex(h => h.includes("누적별점"));
  const submitIdx = headers.findIndex(h => h.includes("노드제출률"));
  // 모듈 컬럼 = signalIdx 이후의 비-집계 컬럼들
  const moduleStartIdx = submitIdx >= 0 ? submitIdx + 1 : 9;

  return json.rows
    .filter(row => row[nameIdx] && String(row[nameIdx]).trim())
    .map(row => {
      const 모듈별점수: Record<string, number | null> = {};
      for (let i = moduleStartIdx; i < headers.length; i++) {
        const v = row[i];
        모듈별점수[headers[i]] = v != null && v !== "" ? Number(v) : null;
      }
      return {
        이름: String(row[nameIdx] ?? ""),
        신호등: String(row[signalIdx] ?? ""),
        누적별점: Number(row[cumIdx]) || 0,
        노드제출률: Number(row[submitIdx]) || 0,
        모듈별점수,
      };
    });
}

/** 개별 퀘스트 시트 로드 */
export async function fetchQuestSheet(config: AchievementConfig, sheetKey: string): Promise<QuestSheetRow[]> {
  const json = await fetchAction(config.webAppUrl, { action: "quest", sheet: sheetKey }) as {
    headers: string[];
    rows: (string | number | null)[][];
  };
  const headers = json.headers.map(String);
  const nameIdx = headers.indexOf("이름");
  const idIdx = headers.indexOf("고유번호");
  const guildIdx = headers.indexOf("길드");
  const courseIdx = headers.indexOf("과정");
  const statusIdx = headers.indexOf("상태");
  const passTotalIdx = headers.findIndex(h => h === "PASS_TOTAL");
  const questScoreIdx = headers.findIndex(h => h === "퀘스트점수");
  const totalIdx = headers.findIndex(h => h === "TOTAL");

  // 퀘스트 컬럼 = 상태 이후 ~ PASS_TOTAL 이전
  const questStart = (statusIdx >= 0 ? statusIdx : 5) + 1;
  const questEnd = passTotalIdx >= 0 ? passTotalIdx : headers.length;

  return json.rows
    .filter(row => row[nameIdx] && String(row[nameIdx]).trim())
    .map(row => {
      const 퀘스트별상태: Record<string, "P" | "F" | null> = {};
      for (let i = questStart; i < questEnd; i++) {
        const v = String(row[i] ?? "").trim();
        퀘스트별상태[headers[i]] = v === "P" ? "P" : v === "F" ? "F" : null;
      }
      return {
        고유번호: Number(row[idIdx]) || 0,
        이름: String(row[nameIdx] ?? ""),
        길드: String(row[guildIdx] ?? ""),
        과정: String(row[courseIdx] ?? ""),
        상태: String(row[statusIdx] ?? ""),
        퀘스트별상태,
        PASS_TOTAL: Number(row[passTotalIdx]) || 0,
        퀘스트점수: Number(row[questScoreIdx]) || 0,
        TOTAL: Number(row[totalIdx]) || 0,
      };
    });
}

/** 통합 데이터 → 과정/기수별 훈련생 집계 */
export function summarizeByTrainee(
  records: UnifiedRecord[],
  과정Filter: string,
  기수Filter: string,
): TraineeAchievementSummary[] {
  const filtered = records.filter(r =>
    (!과정Filter || r.과정 === 과정Filter) &&
    (!기수Filter || r.기수 === 기수Filter)
  );

  // 이름+과정+기수 그룹핑
  const map = new Map<string, { nodes: UnifiedRecord[]; quests: UnifiedRecord[] }>();
  for (const r of filtered) {
    const key = `${r.이름}|${r.과정}|${r.기수}`;
    if (!map.has(key)) map.set(key, { nodes: [], quests: [] });
    const entry = map.get(key)!;
    if (r.노드명) entry.nodes.push(r);
    if (r.퀘스트명) entry.quests.push(r);
  }

  const results: TraineeAchievementSummary[] = [];
  for (const [, { nodes, quests }] of map) {
    const first = nodes[0] || quests[0];
    if (!first) continue;
    const 제출 = nodes.filter(n => n.노드실행여부);
    const 패스 = quests.filter(q => q.퀘스트상태 === "P");
    const avgStar = 제출.length > 0 ? 제출.reduce((s, n) => s + n.별점, 0) / 제출.length : 0;
    const nodeRate = nodes.length > 0 ? 제출.length / nodes.length : 0;
    const questRate = quests.length > 0 ? 패스.length / quests.length : 0;
    const composite = nodeRate * 0.4 + questRate * 0.6;
    const 신호등 = composite >= 0.7 ? "green" : composite >= 0.4 ? "yellow" : "red";

    results.push({
      이름: first.이름,
      길드: first.길드,
      과정: first.과정,
      기수: first.기수,
      훈련상태: first.훈련상태,
      총노드수: nodes.length,
      제출노드수: 제출.length,
      노드평균별점: Math.round(avgStar * 10) / 10,
      총퀘스트수: quests.length,
      패스퀘스트수: 패스.length,
      신호등,
    });
  }

  return results.sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 };
    return order[a.신호등] - order[b.신호등] || a.이름.localeCompare(b.이름);
  });
}

/** 과정/기수 유니크 목록 추출 */
export function extractFilters(records: UnifiedRecord[]): { courses: string[]; cohorts: string[] } {
  const courses = [...new Set(records.map(r => r.과정).filter(Boolean))].sort();
  const cohorts = [...new Set(records.map(r => r.기수).filter(Boolean))].sort();
  return { courses, cohorts };
}

/** 연결 테스트 */
export async function testAchievementConnection(
  config: AchievementConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (!config.webAppUrl) return { ok: false, message: "Apps Script URL을 입력하세요." };
    const json = await fetchAction(config.webAppUrl, { action: "sheets" }) as { sheets: string[] };
    const count = json.sheets?.length ?? 0;
    return { ok: true, message: `연결 성공! (${count}개 시트 확인)` };
  } catch (e) {
    return { ok: false, message: `연결 실패: ${(e as Error).message}` };
  }
}
```

**Step 2: 커밋**

```bash
git add src/hrd/hrdAchievementApi.ts
git commit -m "feat: 학업성취도 API 모듈 (Google Sheets 연동)"
```

---

### Task 4: HTML 섹션 추가

**Files:**
- Modify: `src/index.html` — 사이드바 nav 버튼 + 모바일 nav + 메인 콘텐츠 섹션

**Step 1: 사이드바에 학업성취도 버튼 추가**

`src/index.html`의 "훈련생 관리" 섹션 (line ~95) 하단, "훈련생 이력" 버튼 뒤에 추가:

```html
<button
  class="jibble-nav-item"
  type="button"
  data-scroll-target="sectionAchievement"
  data-nav-key="achievement"
  data-nav-icon="star"
  data-default-label="학업성취도"
>
  <span class="jibble-nav-emoji" aria-hidden="true">🎓</span>
  <span class="jibble-nav-label">학업성취도</span>
</button>
```

**Step 2: 모바일 nav에 추가**

"훈련생이력" 버튼 뒤에:

```html
<button class="mobile-bottom-nav-item" type="button" data-mobile-nav="achievement">
  <svg class="mobile-nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1 4 3 6 3s6-2 6-3v-5"/></svg>
  <span class="mobile-bottom-nav-label">학업성취도</span>
</button>
```

**Step 3: 메인 콘텐츠 섹션 추가**

`sectionTraineeHistory` 섹션 뒤 (`<!-- /sectionAnalytics -->` 패턴 참고), `sectionStaffingAssign` 앞에:

```html
<!-- ═══ 학업성취도 ═══ -->
<div class="card card-span-12 u-mt-14" id="sectionAchievement" data-page-group="achievement">
  <div class="row u-row-between u-row-center" style="margin-bottom: 12px">
    <h3>🎓 학업성취도</h3>
    <div style="display: flex; gap: 8px">
      <button id="achievementFetchBtn" class="btn btn--primary btn--sm">조회</button>
    </div>
  </div>

  <!-- 설정 영역 -->
  <div id="achievementConfigArea" class="achv-config" style="margin-bottom: 16px">
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
      <input id="achievementWebAppUrl" type="text" class="hrd-input" placeholder="Apps Script Web App URL" style="flex: 1; min-width: 200px" />
      <button id="achievementConnectTestBtn" class="btn btn--sm">연결 테스트</button>
      <button id="achievementConnectSaveBtn" class="btn btn--sm btn--primary">저장</button>
    </div>
    <div id="achievementConnectStatus" class="kpi-connect-status" style="margin-top: 4px"></div>
  </div>

  <!-- 필터 -->
  <div id="achievementFilters" class="ana-filters" style="margin-bottom: 12px; display: none">
    <select id="achvFilterCourse" class="hrd-input">
      <option value="">전체 과정</option>
    </select>
    <select id="achvFilterCohort" class="hrd-input">
      <option value="">전체 기수</option>
    </select>
    <span id="achvTraineeCount" class="muted" style="font-size: 13px"></span>
  </div>

  <div id="achievementStatus" class="ana-status"></div>

  <!-- 빈 상태 -->
  <div id="achievementEmpty" class="att-empty-state">
    <div class="att-empty-title">학업성취도</div>
    <div class="att-empty-desc">Apps Script URL을 설정하고 조회 버튼을 클릭하면 학업성취도 데이터를 표시합니다.</div>
  </div>

  <!-- 데이터 테이블 -->
  <div id="achievementContent" style="display: none">
    <div style="overflow-x: auto">
      <table class="hrd-table" style="margin-top: 0">
        <thead>
          <tr>
            <th data-achv-sort="name">이름</th>
            <th data-achv-sort="guild">길드</th>
            <th data-achv-sort="status">훈련상태</th>
            <th data-achv-sort="nodeRate">노드 제출</th>
            <th data-achv-sort="nodeAvg">노드 평균별점</th>
            <th data-achv-sort="questRate">퀘스트 패스</th>
            <th data-achv-sort="signal">신호등</th>
          </tr>
        </thead>
        <tbody id="achvTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- 상세 펼침 (행 클릭 시) -->
  <div id="achievementDetail" style="display: none; margin-top: 16px">
    <h4 id="achvDetailTitle" style="margin-bottom: 8px"></h4>
    <div id="achvDetailNode" style="margin-bottom: 12px"></div>
    <div id="achvDetailQuest"></div>
  </div>
</div>
<!-- /sectionAchievement -->
```

**Step 4: 커밋**

```bash
git add src/index.html
git commit -m "feat: 학업성취도 HTML 섹션 추가"
```

---

### Task 5: 메인 UI 모듈 (초기화 + 렌더링)

**Files:**
- Create: `src/hrd/hrdAchievement.ts`
- Modify: `src/main.ts` — import + init 호출 추가

**Step 1: hrdAchievement.ts 작성**

`hrdAnalytics.ts` 패턴 참고: init 함수에서 DOM 이벤트 바인딩, fetch → render 흐름.

```typescript
import type { TraineeAchievementSummary, AchievementConfig } from "./hrdAchievementTypes";
import {
  loadAchievementConfig,
  saveAchievementConfig,
  testAchievementConnection,
  fetchUnified,
  fetchNodeSheet,
  fetchQuestSheet,
  summarizeByTrainee,
  extractFilters,
} from "./hrdAchievementApi";

const $ = (id: string) => document.getElementById(id);

let currentSummaries: TraineeAchievementSummary[] = [];
let currentConfig: AchievementConfig = { webAppUrl: "" };

function setStatus(msg: string, type: "success" | "error" | "loading" = "loading"): void {
  const el = $("achievementStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `ana-status ${type}`;
}

function renderTable(summaries: TraineeAchievementSummary[]): void {
  const tbody = $("achvTableBody");
  const content = $("achievementContent");
  const empty = $("achievementEmpty");
  const count = $("achvTraineeCount");
  if (!tbody || !content || !empty) return;

  if (summaries.length === 0) {
    content.style.display = "none";
    empty.style.display = "";
    return;
  }

  empty.style.display = "none";
  content.style.display = "";
  if (count) count.textContent = `${summaries.length}명`;

  const signalEmoji = { green: "🟢", yellow: "🟡", red: "🔴" };
  tbody.innerHTML = summaries.map((s, i) => `
    <tr data-achv-idx="${i}" style="cursor: pointer">
      <td>${s.이름}</td>
      <td>${s.길드}</td>
      <td>${s.훈련상태}</td>
      <td>${s.제출노드수}/${s.총노드수}</td>
      <td>${s.노드평균별점}</td>
      <td>${s.패스퀘스트수}/${s.총퀘스트수}</td>
      <td>${signalEmoji[s.신호등]}</td>
    </tr>
  `).join("");

  // 행 클릭 이벤트
  tbody.querySelectorAll("tr[data-achv-idx]").forEach(tr => {
    tr.addEventListener("click", () => {
      const idx = Number(tr.getAttribute("data-achv-idx"));
      handleRowClick(summaries[idx]);
    });
  });
}

async function handleRowClick(summary: TraineeAchievementSummary): void {
  const detailEl = $("achievementDetail");
  const titleEl = $("achvDetailTitle");
  const nodeEl = $("achvDetailNode");
  const questEl = $("achvDetailQuest");
  if (!detailEl || !titleEl || !nodeEl || !questEl) return;

  titleEl.textContent = `${summary.이름} (${summary.과정} ${summary.기수}) 상세`;
  detailEl.style.display = "";
  nodeEl.innerHTML = "<p>노드 상세 로딩중...</p>";
  questEl.innerHTML = "<p>퀘스트 상세 로딩중...</p>";

  const sheetKey = `${summary.기수}${summary.과정}`;

  try {
    const [nodeRows, questRows] = await Promise.all([
      fetchNodeSheet(currentConfig, sheetKey).catch(() => []),
      fetchQuestSheet(currentConfig, sheetKey).catch(() => []),
    ]);

    // 노드 상세 렌더
    const myNode = nodeRows.find(r => r.이름 === summary.이름);
    if (myNode) {
      const modules = Object.entries(myNode.모듈별점수);
      nodeEl.innerHTML = `
        <h5>노드 점수 (${myNode.신호등} | 누적: ${myNode.누적별점} | 제출률: ${myNode.노드제출률}%)</h5>
        <div style="overflow-x:auto">
          <table class="hrd-table" style="font-size:13px">
            <thead><tr>${modules.map(([k]) => `<th>${k}</th>`).join("")}</tr></thead>
            <tbody><tr>${modules.map(([, v]) => `<td>${v ?? "-"}</td>`).join("")}</tr></tbody>
          </table>
        </div>`;
    } else {
      nodeEl.innerHTML = "<p class='muted'>개별 노드 시트 데이터 없음</p>";
    }

    // 퀘스트 상세 렌더
    const myQuest = questRows.find(r => r.이름 === summary.이름);
    if (myQuest) {
      const quests = Object.entries(myQuest.퀘스트별상태);
      const statusStyle = (v: "P" | "F" | null) =>
        v === "P" ? "color:#10b981" : v === "F" ? "color:#ef4444" : "color:#6b7280";
      questEl.innerHTML = `
        <h5>퀘스트 상태 (TOTAL: ${myQuest.TOTAL} | PASS: ${myQuest.PASS_TOTAL})</h5>
        <div style="overflow-x:auto">
          <table class="hrd-table" style="font-size:13px">
            <thead><tr>${quests.map(([k]) => `<th>${k}</th>`).join("")}</tr></thead>
            <tbody><tr>${quests.map(([, v]) => `<td style="${statusStyle(v)};font-weight:600">${v ?? "-"}</td>`).join("")}</tr></tbody>
          </table>
        </div>`;
    } else {
      questEl.innerHTML = "<p class='muted'>개별 퀘스트 시트 데이터 없음</p>";
    }
  } catch (e) {
    nodeEl.innerHTML = `<p class="muted">상세 로드 실패: ${(e as Error).message}</p>`;
    questEl.innerHTML = "";
  }
}

function populateFilters(courses: string[], cohorts: string[]): void {
  const courseSelect = $("achvFilterCourse") as HTMLSelectElement | null;
  const cohortSelect = $("achvFilterCohort") as HTMLSelectElement | null;
  const filtersEl = $("achievementFilters");
  if (!courseSelect || !cohortSelect) return;

  courseSelect.innerHTML = '<option value="">전체 과정</option>' +
    courses.map(c => `<option value="${c}">${c}</option>`).join("");
  cohortSelect.innerHTML = '<option value="">전체 기수</option>' +
    cohorts.map(c => `<option value="${c}">${c}</option>`).join("");
  if (filtersEl) filtersEl.style.display = "";
}

export function initAchievement(): void {
  currentConfig = loadAchievementConfig();

  // 저장된 URL 반영
  const urlInput = $("achievementWebAppUrl") as HTMLInputElement | null;
  if (urlInput && currentConfig.webAppUrl) urlInput.value = currentConfig.webAppUrl;

  // 연결 테스트
  $("achievementConnectTestBtn")?.addEventListener("click", async () => {
    const url = (urlInput?.value ?? "").trim();
    const statusEl = $("achievementConnectStatus");
    if (statusEl) { statusEl.textContent = "테스트 중..."; statusEl.className = "kpi-connect-status loading"; }
    const result = await testAchievementConnection({ webAppUrl: url });
    if (statusEl) {
      statusEl.textContent = result.message;
      statusEl.className = `kpi-connect-status ${result.ok ? "success" : "error"}`;
    }
  });

  // 저장
  $("achievementConnectSaveBtn")?.addEventListener("click", () => {
    const url = (urlInput?.value ?? "").trim();
    currentConfig = { webAppUrl: url };
    saveAchievementConfig(currentConfig);
    const statusEl = $("achievementConnectStatus");
    if (statusEl) { statusEl.textContent = "저장됨"; statusEl.className = "kpi-connect-status success"; }
  });

  // 조회
  $("achievementFetchBtn")?.addEventListener("click", async () => {
    if (!currentConfig.webAppUrl) {
      setStatus("Apps Script URL을 먼저 설정하세요.", "error");
      return;
    }
    setStatus("데이터 로딩 중...", "loading");
    try {
      const records = await fetchUnified(currentConfig);
      const { courses, cohorts } = extractFilters(records);
      populateFilters(courses, cohorts);

      const courseVal = ($ ("achvFilterCourse") as HTMLSelectElement)?.value ?? "";
      const cohortVal = ($("achvFilterCohort") as HTMLSelectElement)?.value ?? "";
      currentSummaries = summarizeByTrainee(records, courseVal, cohortVal);
      renderTable(currentSummaries);
      setStatus(`${records.length.toLocaleString()}건 로드 완료 (${currentSummaries.length}명)`, "success");

      // 필터 변경 시 재렌더
      const refilter = () => {
        const c = ($("achvFilterCourse") as HTMLSelectElement)?.value ?? "";
        const d = ($("achvFilterCohort") as HTMLSelectElement)?.value ?? "";
        currentSummaries = summarizeByTrainee(records, c, d);
        renderTable(currentSummaries);
        $("achievementDetail")!.style.display = "none";
      };
      $("achvFilterCourse")?.addEventListener("change", refilter);
      $("achvFilterCohort")?.addEventListener("change", refilter);
    } catch (e) {
      setStatus(`로드 실패: ${(e as Error).message}`, "error");
    }
  });
}
```

**Step 2: main.ts에 import + init 추가**

`src/main.ts` 상단 import 영역 (line ~13 부근):
```typescript
import { initAchievement } from "./hrd/hrdAchievement";
```

init 호출 영역 (line ~2627 부근, `initExcusedAbsence()` 뒤):
```typescript
initAchievement();
```

**Step 3: 커밋**

```bash
git add src/hrd/hrdAchievement.ts src/main.ts
git commit -m "feat: 학업성취도 메인 UI + main.ts 연결"
```

---

### Task 6: 빌드 검증 + 테스트

**Step 1: 빌드 확인**

```bash
npm run build
```
Expected: 에러 없이 dist/ 생성

**Step 2: lint 수정**

```bash
npm run lint:fix
npm run format
```

**Step 3: 개발서버에서 수동 확인**

```bash
npm run dev
```
- 사이드바에 "학업성취도" 탭 표시 확인
- 탭 클릭 시 설정 영역 + 빈 상태 표시 확인
- Apps Script URL 입력 → 연결 테스트 → 조회 흐름 확인

**Step 4: 커밋**

```bash
git add -A
git commit -m "chore: lint + format 정리"
```

---

### Task 7: 설정 페이지에 학업성취도 연결 설정 추가 (선택사항)

기존 설정 페이지(`data-page-group="settings"`)에 학업성취도 Apps Script URL 설정란을 추가하여, 학업성취도 페이지 내부 설정 영역과 동기화.

(이 태스크는 기본 기능 동작 확인 후 진행)

---

## 파일 변경 요약

| 액션 | 파일 | 설명 |
|------|------|------|
| Create | `docs/apps-script-achievement.js` | Apps Script 배포 코드 |
| Create | `src/hrd/hrdAchievementTypes.ts` | 타입 정의 |
| Create | `src/hrd/hrdAchievementApi.ts` | API + 캐시 + 집계 |
| Create | `src/hrd/hrdAchievement.ts` | UI 초기화 + 렌더링 |
| Modify | `src/index.html` | 사이드바 + 모바일 nav + 콘텐츠 섹션 |
| Modify | `src/main.ts` | import + initAchievement() |
