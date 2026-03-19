/**
 * 문의응대 대시보드
 *
 * Airtable API(응대/수강생/과정 테이블)에서 데이터를 읽어와
 * 통계 카드 + 상세 테이블을 표시합니다.
 */
import type { InquiryRecord, InquiryConfig, InquiryStats } from "./hrdInquiryTypes";
import {
  loadInquiryConfig,
  saveInquiryConfig,
  testInquiryConnection,
  fetchInquiryRecords,
  calcInquiryStats,
  loadInquiryCache,
} from "./hrdInquiryApi";

// ─── DOM 헬퍼 ───────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

let currentConfig: InquiryConfig = { baseId: "", pat: "" };
let allRecords: InquiryRecord[] = [];

function setStatus(msg: string, type: "success" | "error" | "loading" = "loading"): void {
  const el = $("inquiryStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `ana-status ${type}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── 통계 카드 렌더링 ───────────────────────────────────────
function renderStats(stats: InquiryStats): void {
  const container = $("inquiryStats");
  if (!container) return;
  container.style.display = "";

  // 총건수
  const totalEl = $("inqStatTotal");
  if (totalEl) totalEl.textContent = `${stats.총건수}건`;

  // 최근 7일
  const recentEl = $("inqStatRecent");
  if (recentEl) recentEl.textContent = `${stats.최근7일}건`;

  // 채널별
  const channelEl = $("inqStatChannel");
  if (channelEl) {
    channelEl.innerHTML = Object.entries(stats.채널별)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="inq-chip">${esc(k)} <strong>${v}</strong></span>`)
      .join(" ");
  }

  // 작성자별
  const writerEl = $("inqStatWriter");
  if (writerEl) {
    writerEl.innerHTML = Object.entries(stats.작성자별)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="inq-chip">${esc(k)} <strong>${v}</strong></span>`)
      .join(" ");
  }

  // 유형별
  const categoryEl = $("inqStatCategory");
  if (categoryEl) {
    categoryEl.innerHTML = Object.entries(stats.유형별)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="inq-chip">${esc(k)} <strong>${v}</strong></span>`)
      .join(" ");
  }
}

// ─── 테이블 렌더링 ──────────────────────────────────────────
function renderTable(records: InquiryRecord[]): void {
  const tbody = $("inqTableBody");
  const content = $("inquiryContent");
  const empty = $("inquiryEmpty");
  const count = $("inqRecordCount");
  if (!tbody || !content || !empty) return;

  if (records.length === 0) {
    content.style.display = "none";
    empty.style.display = "";
    return;
  }

  empty.style.display = "none";
  content.style.display = "";
  if (count) count.textContent = `${records.length}건`;

  const channelColor: Record<string, string> = {
    디스코드: "#5865F2",
    채널톡: "#3CB371",
    유선: "#F59E0B",
    zep: "#8B5CF6",
  };

  tbody.innerHTML = records
    .map(
      (r, i) => `
    <tr data-inq-idx="${i}" style="cursor:pointer">
      <td>${esc(r.상담일)}</td>
      <td style="font-weight:600">${esc(r.학생이름)}</td>
      <td>${esc(r.과정명)}</td>
      <td>${esc(r.질문요약)}</td>
      <td><span class="inq-badge" style="background:${channelColor[r.응대채널] ?? "#6b7280"};color:#fff">${esc(r.응대채널)}</span></td>
      <td>${esc(r.작성자)}</td>
    </tr>`,
    )
    .join("");

  // 행 클릭 → 상세 펼침
  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-inq-idx]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const idx = Number(tr.getAttribute("data-inq-idx"));
      if (records[idx]) showDetail(records[idx]);
    });
  });
}

// ─── 상세 보기 ──────────────────────────────────────────────
function showDetail(r: InquiryRecord): void {
  const detailEl = $("inquiryDetail");
  const titleEl = $("inqDetailTitle");
  const bodyEl = $("inqDetailBody");
  if (!detailEl || !titleEl || !bodyEl) return;

  titleEl.textContent = `${r.질문요약} — ${r.학생이름} (${r.상담일})`;
  bodyEl.innerHTML = `
    <div class="inq-detail-section">
      <h5>문의내용</h5>
      <p>${esc(r.문의내용).replace(/\n/g, "<br>")}</p>
    </div>
    <div class="inq-detail-section">
      <h5>응답내용</h5>
      <p>${esc(r.응답내용).replace(/\n/g, "<br>")}</p>
    </div>
    <div class="inq-detail-meta">
      <span>채널: ${esc(r.응대채널)}</span>
      <span>작성자: ${esc(r.작성자)}</span>
      <span>과정: ${esc(r.과정명)}</span>
    </div>`;
  detailEl.style.display = "";
}

// ─── 필터 적용 ──────────────────────────────────────────────
function applyFilterAndRender(): void {
  const channelVal = ($("inqFilterChannel") as HTMLSelectElement)?.value ?? "";
  const writerVal = ($("inqFilterWriter") as HTMLSelectElement)?.value ?? "";
  const searchVal = ($("inqFilterSearch") as HTMLInputElement)?.value?.toLowerCase() ?? "";

  const filtered = allRecords.filter((r) => {
    if (channelVal && r.응대채널 !== channelVal) return false;
    if (writerVal && r.작성자 !== writerVal) return false;
    if (searchVal) {
      const haystack = `${r.질문요약} ${r.학생이름} ${r.문의내용} ${r.과정명}`.toLowerCase();
      if (!haystack.includes(searchVal)) return false;
    }
    return true;
  });

  renderTable(filtered);
  const detailEl = $("inquiryDetail");
  if (detailEl) detailEl.style.display = "none";
}

function populateFilters(records: InquiryRecord[]): void {
  const channels = [...new Set(records.map((r) => r.응대채널).filter(Boolean))].sort();
  const writers = [...new Set(records.map((r) => r.작성자).filter(Boolean))].sort();

  const channelSelect = $("inqFilterChannel") as HTMLSelectElement | null;
  const writerSelect = $("inqFilterWriter") as HTMLSelectElement | null;
  const filtersEl = $("inquiryFilters");

  if (channelSelect) {
    channelSelect.innerHTML =
      '<option value="">전체 채널</option>' +
      channels.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  if (writerSelect) {
    writerSelect.innerHTML =
      '<option value="">전체 작성자</option>' +
      writers.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join("");
  }
  if (filtersEl) filtersEl.style.display = "";
}

// ─── 설정 탭 초기화 (API 연동 섹션) ────────────────────────
function initSettingsInquiry(): void {
  const baseIdInput = $("settingsInquiryBaseId") as HTMLInputElement | null;
  const patInput = $("settingsInquiryPat") as HTMLInputElement | null;

  if (baseIdInput && currentConfig.baseId) baseIdInput.value = currentConfig.baseId;
  if (patInput && currentConfig.pat) patInput.value = currentConfig.pat;

  // 연결 테스트
  $("settingsInquiryTestBtn")?.addEventListener("click", async () => {
    const baseId = (baseIdInput?.value ?? "").trim();
    const pat = (patInput?.value ?? "").trim();
    const statusEl = $("settingsInquiryTestStatus");
    if (!baseId || !pat) {
      if (statusEl) {
        statusEl.textContent = "Base ID와 PAT를 입력하세요.";
        statusEl.className = "settings-status-msg error";
      }
      return;
    }
    if (statusEl) {
      statusEl.textContent = "테스트 중...";
      statusEl.className = "settings-status-msg loading";
    }
    try {
      const msg = await testInquiryConnection({ baseId, pat });
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.className = "settings-status-msg success";
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = (e as Error).message;
        statusEl.className = "settings-status-msg error";
      }
    }
  });

  // 저장
  $("settingsInquirySave")?.addEventListener("click", () => {
    const baseId = (baseIdInput?.value ?? "").trim();
    const pat = (patInput?.value ?? "").trim();
    currentConfig = { baseId, pat };
    saveInquiryConfig(currentConfig);
    const statusEl = $("settingsInquiryTestStatus");
    if (statusEl) {
      statusEl.textContent = "저장됨 ✓";
      statusEl.className = "settings-status-msg success";
    }
    // 문의응대 탭 안내 숨김
    updateConfigNotice();
  });
}

// ─── 설정 미완료 안내 표시/숨김 ─────────────────────────────
function updateConfigNotice(): void {
  const noticeEl = $("inquiryConfigNotice");
  if (!noticeEl) return;
  if (!currentConfig.baseId || !currentConfig.pat) {
    noticeEl.style.display = "";
  } else {
    noticeEl.style.display = "none";
  }
}

// ─── 초기화 ─────────────────────────────────────────────────
export function initInquiry(): void {
  currentConfig = loadInquiryConfig();

  // 설정 탭 UI 초기화
  initSettingsInquiry();

  // 설정 미완료 시 안내
  updateConfigNotice();

  // 필터 이벤트
  $("inqFilterChannel")?.addEventListener("change", applyFilterAndRender);
  $("inqFilterWriter")?.addEventListener("change", applyFilterAndRender);
  $("inqFilterSearch")?.addEventListener("input", applyFilterAndRender);

  // 캐시에서 자동 복원
  restoreFromCache();

  // 조회
  $("inquiryFetchBtn")?.addEventListener("click", async () => {
    // 매번 최신 설정 읽기
    currentConfig = loadInquiryConfig();
    if (!currentConfig.baseId || !currentConfig.pat) {
      setStatus("설정 → API 연동에서 Airtable 연결 정보를 입력해주세요.", "error");
      return;
    }
    setStatus("데이터 로딩 중...", "loading");
    try {
      allRecords = await fetchInquiryRecords(currentConfig);
      populateFilters(allRecords);
      const stats = calcInquiryStats(allRecords);
      renderStats(stats);
      applyFilterAndRender();
      setStatus(`${allRecords.length}건 로드 완료`, "success");
    } catch (e) {
      setStatus(`로드 실패: ${(e as Error).message}`, "error");
    }
  });
}

// ─── 캐시 자동 복원 ───────────────────────────────────────
function restoreFromCache(): void {
  const cached = loadInquiryCache();
  if (!cached || cached.length === 0) return;
  allRecords = cached;
  populateFilters(allRecords);
  const stats = calcInquiryStats(allRecords);
  renderStats(stats);
  applyFilterAndRender();
  setStatus(`${allRecords.length}건 (캐시)`, "success");
}
