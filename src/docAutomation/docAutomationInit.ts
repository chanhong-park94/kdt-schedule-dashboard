/**
 * 문서자동화 탭 초기화
 * 출석입력요청대장 공결 기록 관리 + HWPX 다운로드
 * lazy-load 진입점: tabRegistry.ts에서 호출됨.
 */

import {
  loadExcuseRecords,
  addExcuseRecord,
  deleteExcuseRecord,
  updateExcuseRecord,
  loadDocConfig,
  saveDocConfig,
  type ExcuseRecord,
} from "./docAutomationApi";
import { loadSignatureFromFile, renderSignaturePreview, showSignatureModal } from "./signatureManager";

const $ = (id: string) => document.getElementById(id);

const REASON_OPTIONS = ["질병/입원", "휴가", "카드 분실·훼손", "정전", "단말기 고장", "카드발급 지연", "기타"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── 테이블 렌더링 ──────────────────────────────────
function renderRecordTable(): void {
  const tbody = $("docRecordBody");
  const empty = $("docEmptyState");
  const table = $("docRecordTable");
  const countEl = $("docRecordCount");
  if (!tbody) return;

  const records = loadExcuseRecords();

  if (records.length === 0) {
    if (table) table.style.display = "none";
    if (empty) empty.style.display = "";
    if (countEl) countEl.textContent = "";
    return;
  }

  if (table) table.style.display = "";
  if (empty) empty.style.display = "none";
  if (countEl) countEl.textContent = `총 ${records.length}건 (페이지 ${Math.ceil(records.length / 15)}장)`;

  const reasonOpts = REASON_OPTIONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");

  tbody.innerHTML = records
    .map(
      (r, i) => `<tr data-record-id="${r.id}">
        <td style="text-align:center;font-weight:600;">${i + 1}</td>
        <td><input type="date" class="doc-field" data-field="occurrenceDate" value="${r.occurrenceDate}" /></td>
        <td><input type="date" class="doc-field" data-field="applicationDate" value="${r.applicationDate}" /></td>
        <td><input type="text" class="doc-field" data-field="traineeName" value="${esc(r.traineeName)}" placeholder="성명" /></td>
        <td><select class="doc-field" data-field="reason">${reasonOpts.replace(`value="${esc(r.reason)}"`, `value="${esc(r.reason)}" selected`)}</select></td>
        <td><input type="text" class="doc-field" data-field="checkinTime" value="${esc(r.checkinTime)}" placeholder="-" style="width:60px" /></td>
        <td><input type="text" class="doc-field" data-field="checkoutTime" value="${esc(r.checkoutTime)}" placeholder="-" style="width:60px" /></td>
        <td style="text-align:center;"><button type="button" class="doc-delete-btn" data-delete-id="${r.id}">🗑️</button></td>
      </tr>`,
    )
    .join("");

  // 인라인 편집 이벤트
  tbody.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".doc-field").forEach((el) => {
    el.addEventListener("change", () => {
      const row = el.closest("tr");
      const id = row?.getAttribute("data-record-id");
      const field = el.getAttribute("data-field");
      if (id && field) {
        updateExcuseRecord(id, { [field]: el.value } as Partial<ExcuseRecord>);
      }
    });
  });

  // 삭제 이벤트
  tbody.querySelectorAll<HTMLButtonElement>(".doc-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-id");
      if (id && confirm("이 기록을 삭제하시겠습니까?")) {
        deleteExcuseRecord(id);
        renderRecordTable();
      }
    });
  });
}

// ── 설정 폼 복원 ────────────────────────────────────
function restoreConfig(): void {
  const config = loadDocConfig();
  const set = (id: string, val: string) => {
    const el = $(id) as HTMLInputElement | null;
    if (el && val) el.value = val;
  };
  set("docCourseName", config.courseName);
  set("docCohort", config.cohort);
  set("docPeriodStart", config.periodStart);
  set("docPeriodEnd", config.periodEnd);
  set("docTimeStart", config.timeStart);
  set("docTimeEnd", config.timeEnd);
  set("docManagerName", config.managerName);

  const canvas = $("docSignatureCanvas") as HTMLCanvasElement | null;
  if (canvas) renderSignaturePreview(canvas, config.signatureData);
}

function getConfigFromForm() {
  const val = (id: string) => ($(id) as HTMLInputElement | null)?.value?.trim() ?? "";
  return {
    courseName: val("docCourseName"),
    cohort: val("docCohort"),
    periodStart: val("docPeriodStart"),
    periodEnd: val("docPeriodEnd"),
    timeStart: val("docTimeStart"),
    timeEnd: val("docTimeEnd"),
    managerName: val("docManagerName"),
    signatureData: loadDocConfig().signatureData, // 서명은 별도 관리
  };
}

// ── 초기화 ─────────────────────────────────────────
export function initDocAutomation(): void {
  // 설정 복원
  restoreConfig();
  renderRecordTable();

  // 설정 저장
  $("docConfigSaveBtn")?.addEventListener("click", () => {
    const config = getConfigFromForm();
    saveDocConfig(config);
    const statusEl = $("docConfigStatus");
    if (statusEl) {
      statusEl.textContent = "✅ 저장됨";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    }
  });

  // 서명 생성 모달
  $("docSignatureGenBtn")?.addEventListener("click", () => {
    showSignatureModal((dataUrl) => {
      const config = loadDocConfig();
      config.signatureData = dataUrl;
      saveDocConfig(config);
      const canvas = $("docSignatureCanvas") as HTMLCanvasElement | null;
      if (canvas) renderSignaturePreview(canvas, dataUrl);
    });
  });

  // 서명 이미지 업로드
  $("docSignatureUploadBtn")?.addEventListener("click", () => {
    ($("docSignatureFile") as HTMLInputElement | null)?.click();
  });
  $("docSignatureFile")?.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const dataUrl = await loadSignatureFromFile(file);
      const config = loadDocConfig();
      config.signatureData = dataUrl;
      saveDocConfig(config);
      const canvas = $("docSignatureCanvas") as HTMLCanvasElement | null;
      if (canvas) renderSignaturePreview(canvas, dataUrl);
    } catch (err) {
      alert(`서명 이미지 로드 실패: ${(err as Error).message}`);
    }
  });

  // 공결 추가
  $("docAddRecordBtn")?.addEventListener("click", () => {
    const config = loadDocConfig();
    const today = new Date().toISOString().slice(0, 10);
    addExcuseRecord({
      courseName: config.courseName,
      cohort: config.cohort,
      occurrenceDate: today,
      applicationDate: today,
      traineeName: "",
      reason: "질병/입원",
      checkinTime: "-",
      checkoutTime: "-",
    });
    renderRecordTable();
    // 마지막 행의 성명 input에 포커스
    const rows = document.querySelectorAll("#docRecordBody tr");
    const lastRow = rows[rows.length - 1];
    const nameInput = lastRow?.querySelector<HTMLInputElement>('[data-field="traineeName"]');
    if (nameInput) nameInput.focus();
  });

  // HWPX 다운로드
  $("docHwpxBtn")?.addEventListener("click", async () => {
    const records = loadExcuseRecords();
    if (records.length === 0) {
      alert("공결 기록이 없습니다. 먼저 기록을 추가해주세요.");
      return;
    }
    const config = loadDocConfig();
    if (!config.courseName) {
      alert("과정 설정을 먼저 입력해주세요.");
      return;
    }
    try {
      const { generateHwpx } = await import("./hwpxGenerator");
      await generateHwpx(config, records);
    } catch (err) {
      alert(`HWPX 생성 실패: ${(err as Error).message}`);
    }
  });

  // Excel 내보내기
  $("docExcelBtn")?.addEventListener("click", async () => {
    const records = loadExcuseRecords();
    if (records.length === 0) {
      alert("공결 기록이 없습니다.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const wsData = records.map((r, i) => ({
        번호: i + 1,
        발생일: r.occurrenceDate,
        신청일: r.applicationDate,
        "훈련생 성명": r.traineeName,
        사유: r.reason,
        입실시간: r.checkinTime,
        퇴실시간: r.checkoutTime,
      }));
      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "출석입력요청");
      XLSX.writeFile(wb, `출석입력요청대장_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      alert(`Excel 생성 실패: ${(err as Error).message}`);
    }
  });
}
