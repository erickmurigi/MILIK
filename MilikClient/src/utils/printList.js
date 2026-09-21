// Standard printout for lists and reports: company letterhead, report title and filters, key figures, table with a totals
// row, footer and the "Powered by Milik" stamp (see utils/printKit.js for the shared pieces). A4 landscape by default.
//
// Rows may be plain records, or these markers:
//   { __group: "Kilimani Heights", meta: "12 tenants" }   a group heading row
//   { __subtotal: ["Subtotal", "", "1,000.00"] }           a subtotal row (cells per column)
// A column can colour a cell with tone(row): "neg" (red), "pos" (green), "muted" (grey) and make it bold with bold: true.
import { BRAND, escapeHtml, footerHtml, getCompanyDetails, letterheadHtml, openPrintWindow, pageBoxCss, writeAndPrint } from "./printKit";

const LIST_CSS = `
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .kpi { min-width: 120px; padding: 6px 12px 7px; background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid ${BRAND.green}; border-radius: 2px; }
  .kpi-label { font-size: 8.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${BRAND.muted}; }
  .kpi-value { font-size: 13.5px; font-weight: 800; color: ${BRAND.ink}; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .summary { font-size: 11px; font-weight: 700; color: #334155; margin-bottom: 12px; padding: 7px 10px; background: #f8fafc; border-left: 3px solid ${BRAND.green}; border-radius: 0 4px 4px 0; }

  table.list { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  table.list thead { display: table-header-group; }
  table.list tfoot { display: table-footer-group; }
  table.list tr { page-break-inside: avoid; }
  table.list thead th { background: ${BRAND.green}; color: #fff; padding: 8px 9px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; text-align: left; border: 1px solid rgba(255,255,255,.14); }
  table.list td.num, table.list th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.list tbody td { padding: 7px 9px; border: 1px solid #e2e8f0; vertical-align: top; color: #1e293b; }
  table.list tbody tr.alt td { background: #f8fafc; }
  table.list td.neg { color: #b91c1c; font-weight: 700; } table.list td.pos { color: #15803d; font-weight: 700; } table.list td.muted { color: #94a3b8; }
  table.list td.bold { font-weight: 800; }
  table.list tr.grp td { background: #eef7f2; border-top: 2px solid ${BRAND.green}; border-bottom: 1px solid #cfe3d9; padding: 6px 9px; font-weight: 800; color: ${BRAND.green}; text-transform: uppercase; letter-spacing: .06em; font-size: 9.5px; }
  table.list tr.grp td span { font-weight: 600; color: ${BRAND.muted}; text-transform: none; letter-spacing: 0; margin-left: 10px; }
  table.list tr.sub td { background: #f1f5f9; font-weight: 800; border-top: 1px solid #94a3b8; }
  table.list .empty-cell { text-align: center; color: #94a3b8; padding: 22px; font-style: italic; }
  table.list tfoot td { padding: 8px 9px; font-weight: 800; font-size: 10.5px; border: 1px solid #cfe3d9; border-top: 2px solid ${BRAND.green}; background: #eef7f2; color: ${BRAND.green}; }
  .notes-list { margin-top: 10px; font-size: 9.5px; color: #64748b; }
  .notes-list p { margin-bottom: 2px; }
  .sigs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 26px; margin: 28px 0 4px; page-break-inside: avoid; }
  .sig { border-top: 1px solid #94a3b8; padding-top: 5px; font-size: 9.5px; color: ${BRAND.muted}; }
`;

const buildTableHtml = ({ columns = [], rows = [], totalsRow = null }) => {
  const isNum = (col) => col.align === "right";
  const headerCells = columns
    .map((col) => `<th class="${isNum(col) ? "num" : ""}" ${col.width ? `style="width:${escapeHtml(col.width)}"` : ""}>${escapeHtml(col.label)}</th>`)
    .join("");

  let dataIndex = 0;
  const bodyRows = rows
    .map((row) => {
      if (row?.__group !== undefined) {
        dataIndex = 0;
        return `<tr class="grp"><td colspan="${Math.max(columns.length, 1)}">${escapeHtml(row.__group)}${row.meta ? `<span>${escapeHtml(row.meta)}</span>` : ""}</td></tr>`;
      }
      if (row?.__subtotal) {
        return `<tr class="sub">${columns.map((col, i) => `<td class="${isNum(col) ? "num" : ""}">${escapeHtml(row.__subtotal[i] ?? "")}</td>`).join("")}</tr>`;
      }
      const idx = dataIndex++;
      const cells = columns
        .map((col) => {
          const raw = typeof col.value === "function" ? col.value(row, idx) : row?.[col.key];
          const tone = typeof col.tone === "function" ? col.tone(row) : "";
          const cls = [isNum(col) ? "num" : "", tone, col.bold ? "bold" : ""].filter(Boolean).join(" ");
          return `<td class="${cls}">${escapeHtml(raw ?? "-")}</td>`;
        })
        .join("");
      return `<tr class="${idx % 2 === 1 ? "alt" : ""}">${cells}</tr>`;
    })
    .join("");

  const dataCount = rows.filter((r) => r?.__group === undefined && !r?.__subtotal).length;
  // totalsRow: array of pre-formatted strings aligned per column; falls back to a record count
  const foot = totalsRow
    ? `<tfoot><tr>${columns.map((col, i) => `<td class="${isNum(col) ? "num" : ""}">${escapeHtml(totalsRow[i] ?? "")}</td>`).join("")}</tr></tfoot>`
    : dataCount > 0
      ? `<tfoot><tr><td colspan="${Math.max(columns.length, 1)}">${dataCount.toLocaleString()} record${dataCount !== 1 ? "s" : ""}</td></tr></tfoot>`
      : "";

  return `
    <table class="list">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty-cell">No records found</td></tr>`}</tbody>
      ${foot}
    </table>`;
};

// summaryItems: [[label, value], ...] shown as key-figure cards above the table (values are shown as given).
// notes: extra lines under the table. signatures: [{ label, name }] adds sign-off lines (prepared / checked / approved).
// win: a window opened by the caller inside the click handler, for reports that fetch their rows first (a window opened
// after an await is usually blocked as a pop-up). It is cleared before the report is written into it.
export const printTabularList = ({
  title, subtitle = "", company = {}, columns = [], rows = [], summary = "", summaryItems = [], totalsRow = null,
  notes = [], signatures = [], orientation = "landscape", kicker = "Report", win: target = null,
}) => {
  const win = openPrintWindow(target);
  if (!win) return null;

  const name = getCompanyDetails(company).name;
  const body = `
    ${letterheadHtml(company, { kicker, title, subtitle })}
    ${summary ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}
    ${summaryItems.length ? `<div class="kpis">${summaryItems.map(([label, value]) => `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div></div>`).join("")}</div>` : ""}
    ${buildTableHtml({ columns, rows, totalsRow })}
    ${notes.length ? `<div class="notes-list">${notes.map((n) => `<p>${escapeHtml(n)}</p>`).join("")}</div>` : ""}
    ${signatures.length ? `<div class="sigs">${signatures.map((s) => `<div class="sig">${escapeHtml(s.label)}${s.name ? ` — ${escapeHtml(s.name)}` : ""}</div>`).join("")}</div>` : ""}
    ${footerHtml(company, { left: name })}`;

  return writeAndPrint(win, {
    title: title || "Report",
    css: LIST_CSS,
    body,
    pageCss: pageBoxCss({ size: orientation === "portrait" ? "A4" : "A4 landscape", left: name }),
  });
};

export default printTabularList;
