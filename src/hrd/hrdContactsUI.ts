/** 연락처 관리 탭 UI + 발송 모달 연결 */
import { loadContactsWithRoster, saveContact, bulkUpsertContacts, type ContactDisplay } from "./hrdContacts";
import { initNotifyModal, openNotifyModal } from "./hrdNotify";
import { loadHrdConfig } from "./hrdConfig";

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

let currentContacts: ContactDisplay[] = [];

// ─── 연락처 탭 전환 ────────────────────────────────────────

function setupContactsTab(): void {
  // 출결현황 탭 바에서 contacts 탭 클릭 처리
  const tabBar = document.querySelector(".att-tab-bar");
  if (!tabBar) return;

  tabBar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".att-tab[data-att-tab]");
    if (!btn || btn.disabled) return;

    const tab = btn.dataset.attTab;
    if (tab === "contacts") {
      // 다른 탭 비활성화
      tabBar.querySelectorAll<HTMLButtonElement>(".att-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // 패널 전환
      const attPanel = $("attPageAttendance");
      const manualPanel = $("attPageManual");
      const contactsPanel = $("attPageContacts");
      if (attPanel) attPanel.style.display = "none";
      if (manualPanel) manualPanel.style.display = "none";
      if (contactsPanel) contactsPanel.style.display = "block";
    } else if (tab === "hrd" || tab === "manual") {
      // contacts 패널 숨기기
      const contactsPanel = $("attPageContacts");
      if (contactsPanel) contactsPanel.style.display = "none";
    }
  });
}

// ─── 연락처 명단 로드 ──────────────────────────────────────

async function loadAndRenderContacts(): Promise<void> {
  const emptyState = $("contactsEmptyState");
  const content = $("contactsContent");
  const tbody = $("contactsTbody");
  const meta = $("contactsMeta");
  const status = $("contactsSaveStatus");

  // 출결현황 필터에서 현재 선택된 과정/기수 가져오기
  const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
  const degrSelect = document.getElementById("attFilterDegr") as HTMLSelectElement | null;

  const trainPrId = courseSelect?.value || "";
  const degr = degrSelect?.value || "";

  if (!trainPrId || !degr) {
    if (status) {
      status.textContent = "⚠️ 출결현황에서 과정/기수를 먼저 선택하세요.";
      status.style.color = "#f59e0b";
    }
    return;
  }

  if (status) {
    status.textContent = "⏳ 불러오는 중...";
    status.style.color = "";
  }

  try {
    currentContacts = await loadContactsWithRoster(trainPrId, degr);

    if (emptyState) emptyState.style.display = "none";
    if (content) content.style.display = "block";

    const phoneCount = currentContacts.filter((c) => c.phone).length;
    const emailCount = currentContacts.filter((c) => c.email).length;
    if (meta) {
      meta.textContent = `총 ${currentContacts.length}명 (전화 ${phoneCount}건 / 이메일 ${emailCount}건 등록)`;
    }

    if (tbody) {
      tbody.innerHTML = currentContacts
        .map((c, i) => {
          return `<tr>
            <td>${i + 1}</td>
            <td><strong>${c.name}</strong></td>
            <td>
              <input class="contact-input" type="tel" data-name="${c.name}" data-field="phone"
                     value="${c.phone}" placeholder="010-0000-0000" />
            </td>
            <td>
              <input class="contact-input" type="email" data-name="${c.name}" data-field="email"
                     value="${c.email}" placeholder="email@example.com" />
            </td>
            <td>${statusBadge(c.status)}</td>
          </tr>`;
        })
        .join("");

      // 인라인 편집 이벤트
      tbody.querySelectorAll<HTMLInputElement>(".contact-input").forEach((input) => {
        input.addEventListener("blur", () => {
          void handleContactSave(input);
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") input.blur();
        });
      });
    }

    if (status) {
      status.textContent = `✅ ${currentContacts.length}명 로드 완료`;
      status.style.color = "#10b981";
      setTimeout(() => {
        if (status) status.textContent = "";
      }, 3000);
    }
  } catch (e) {
    if (status) {
      status.textContent = "❌ 로드 실패";
      status.style.color = "#ef4444";
    }
    console.warn("[ContactsUI] Load error:", e);
  }
}

async function handleContactSave(input: HTMLInputElement): Promise<void> {
  const name = input.dataset.name || "";
  const field = input.dataset.field || "";
  const value = input.value.trim();

  const contact = currentContacts.find((c) => c.name === name);
  if (!contact) return;

  const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
  const degrSelect = document.getElementById("attFilterDegr") as HTMLSelectElement | null;
  const trainPrId = courseSelect?.value || "";
  const degr = degrSelect?.value || "";
  if (!trainPrId || !degr) return;

  const phone = field === "phone" ? value : contact.phone;
  const email = field === "email" ? value : contact.email;

  // 캐시 업데이트
  if (field === "phone") contact.phone = value;
  if (field === "email") contact.email = value;

  await saveContact(trainPrId, degr, name, phone, email);

  // 메타 정보 갱신
  const meta = $("contactsMeta");
  if (meta) {
    const phoneCount = currentContacts.filter((c) => c.phone).length;
    const emailCount = currentContacts.filter((c) => c.email).length;
    meta.textContent = `총 ${currentContacts.length}명 (전화 ${phoneCount}건 / 이메일 ${emailCount}건 등록)`;
  }

  const status = $("contactsSaveStatus");
  if (status) {
    status.textContent = "✅ 저장됨";
    status.style.color = "#10b981";
    setTimeout(() => {
      if (status) status.textContent = "";
    }, 2000);
  }
}

function statusBadge(st: string): string {
  let cls = "th-status-active";
  if (st.includes("중도탈락") || st.includes("수료포기")) cls = "th-status-dropout";
  else if (st.includes("조기취업")) cls = "th-status-early-employ";
  else if (st.includes("80%이상수료")) cls = "th-status-partial";
  else if (st.includes("수료") || st.includes("정상수료") || st.includes("수료후취업")) cls = "th-status-complete";
  return `<span class="th-detail-badge ${cls}">${st}</span>`;
}

// ─── 일괄 등록 ─────────────────────────────────────────────

function setupBulkModal(): void {
  $("contactsBulkBtn")?.addEventListener("click", () => {
    $("contactsBulkModal")?.classList.add("active");
  });

  $("contactsBulkClose")?.addEventListener("click", () => {
    $("contactsBulkModal")?.classList.remove("active");
  });

  $("contactsBulkModal")?.addEventListener("click", (e) => {
    if (e.target === $("contactsBulkModal")) {
      $("contactsBulkModal")?.classList.remove("active");
    }
  });

  $("contactsBulkSubmit")?.addEventListener("click", () => {
    void handleBulkSubmit();
  });
}

async function handleBulkSubmit(): Promise<void> {
  const textarea = $("contactsBulkInput") as HTMLTextAreaElement | null;
  const status = $("contactsBulkStatus");
  if (!textarea) return;

  const courseSelect = document.getElementById("attFilterCourse") as HTMLSelectElement | null;
  const degrSelect = document.getElementById("attFilterDegr") as HTMLSelectElement | null;
  const trainPrId = courseSelect?.value || "";
  const degr = degrSelect?.value || "";

  if (!trainPrId || !degr) {
    if (status) status.textContent = "⚠️ 과정/기수를 먼저 선택하세요.";
    return;
  }

  const lines = textarea.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    if (status) status.textContent = "⚠️ 입력된 데이터가 없습니다.";
    return;
  }

  const rows = lines
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return {
        name: parts[0] || "",
        phone: parts[1] || "",
        email: parts[2] || "",
      };
    })
    .filter((r) => r.name);

  if (status) status.textContent = `⏳ ${rows.length}건 등록 중...`;

  const result = await bulkUpsertContacts(trainPrId, degr, rows);

  if (status) {
    if (result.failed === 0) {
      status.textContent = `✅ ${result.success}건 등록 완료`;
      status.className = "notify-send-status notify-status-success";
    } else {
      status.textContent = `⚠️ 성공 ${result.success}건, 실패 ${result.failed}건`;
      status.className = "notify-send-status notify-status-warn";
    }
  }

  // 목록 갱신
  await loadAndRenderContacts();

  // 모달 닫기
  setTimeout(() => {
    $("contactsBulkModal")?.classList.remove("active");
  }, 1500);
}

// ─── 발송 버튼 연결 ────────────────────────────────────────

function setupNotifyButton(): void {
  // 관리대상 패널의 📱 발송 버튼
  $("attNotifySendBtn")?.addEventListener("click", () => {
    // 현재 출결현황에서 로드된 학생 데이터 가져오기
    // hrdAttendance.ts의 currentStudents는 모듈 내부이므로
    // window 이벤트로 전달하거나 직접 참조해야 함
    // → CustomEvent로 현재 students를 요청
    window.dispatchEvent(new CustomEvent("requestNotifyModal"));
  });
}

// ─── Init ───────────────────────────────────────────────────

export function initContacts(): void {
  setupContactsTab();
  setupBulkModal();
  setupNotifyButton();
  initNotifyModal();

  // 명단 불러오기 버튼
  $("contactsLoadBtn")?.addEventListener("click", () => {
    void loadAndRenderContacts();
  });

  // 출결현황에서 과정 조회 시 연락처도 로드 가능하도록 이벤트 수신
  window.addEventListener("attendanceLoaded", () => {
    // 연락처 탭이 활성화된 상태라면 자동 갱신
    const contactsPanel = $("attPageContacts");
    if (contactsPanel && contactsPanel.style.display !== "none") {
      void loadAndRenderContacts();
    }
  });
}
