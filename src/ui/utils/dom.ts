export function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Required element is missing: ${selector}`);
  }
  return element as T;
}

export function setRenderNotice(element: HTMLElement, total: number, rendered: number): void {
  if (total === 0) {
    element.textContent = "";
    return;
  }

  if (total > rendered) {
    element.textContent = `총 ${total}건 중 상위 ${rendered}건만 표시됩니다. CSV 내보내기에는 전체 건수가 포함됩니다.`;
    return;
  }

  element.textContent = `총 ${total}건 표시 중`;
}

export function createClickableCell(value: string, onClick: () => void): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = value;
  td.classList.add("clickable-cell");
  td.title = "클릭 시 간트에서 강조됩니다.";
  td.addEventListener("click", onClick);
  return td;
}

export function createTableElement(columns: readonly string[], rows: string[][]): HTMLTableElement {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return table;
}
