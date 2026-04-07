/**
 * 관리자 서명 관리
 * 1. 이름 입력 → Canvas 사인 생성
 * 2. 이미지 파일 업로드 → Canvas 리사이즈
 */

/** Canvas에 한글 이름으로 필기체 스타일 사인 생성 */
export function generateSignatureFromName(name: string, width = 120, height = 50): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // 투명 배경
  ctx.clearRect(0, 0, width, height);

  // 필기체 스타일
  ctx.font = `bold ${Math.min(height * 0.6, 28)}px "나눔손글씨 펜", "Nanum Pen Script", "Pretendard", cursive`;
  ctx.fillStyle = "#1a1a2e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 약간 기울임 효과
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-0.05);
  ctx.fillText(name, 0, 0);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

/** 이미지 파일 → Canvas 리사이즈 → base64 */
export function loadSignatureFromFile(file: File, maxWidth = 120, maxHeight = 50): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        // 비율 유지 리사이즈
        const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context failed"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("이미지 로드 실패"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
}

/** base64 PNG → Canvas에 미리보기 렌더링 */
export function renderSignaturePreview(canvas: HTMLCanvasElement, dataUrl: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!dataUrl) {
    ctx.font = "12px Pretendard, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("서명 없음", canvas.width / 2, canvas.height / 2);
    return;
  }

  const img = new Image();
  img.onload = () => {
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  };
  img.src = dataUrl;
}

/** 사인 생성 모달 표시 */
export function showSignatureModal(onSave: (dataUrl: string) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "doc-signature-modal";
  overlay.innerHTML = `
    <div class="doc-signature-modal-content">
      <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">✍️ 관리자 사인 생성</h3>
      <div style="margin-bottom: 12px;">
        <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 6px;">이름 입력</label>
        <input type="text" id="sigNameInput" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px;" placeholder="이름을 입력하세요" />
      </div>
      <div style="margin-bottom: 16px; text-align: center;">
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 6px;">미리보기</label>
        <canvas id="sigPreviewCanvas" width="200" height="80" style="border: 1px dashed var(--border); border-radius: 8px; background: #fff;"></canvas>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="btn btn--sm" id="sigCancelBtn">취소</button>
        <button type="button" class="btn btn--sm btn--primary" id="sigSaveBtn">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector("#sigNameInput") as HTMLInputElement;
  const previewCanvas = overlay.querySelector("#sigPreviewCanvas") as HTMLCanvasElement;
  let currentData = "";

  nameInput.addEventListener("input", () => {
    const name = nameInput.value.trim();
    if (name) {
      currentData = generateSignatureFromName(name, 200, 80);
      renderSignaturePreview(previewCanvas, currentData);
    } else {
      const ctx = previewCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, 200, 80);
      currentData = "";
    }
  });

  overlay.querySelector("#sigCancelBtn")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#sigSaveBtn")?.addEventListener("click", () => {
    if (currentData) {
      onSave(currentData);
    }
    overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  nameInput.focus();
}
