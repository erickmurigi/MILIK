// Standard printout for lists and reports: company letterhead, report title and filters, key figures, table with a totals
// row, and a footer. A4 landscape. Every value is HTML-escaped (the print window is same-origin and written with
// document.write), and a logo is only used when it is an http(s) or data:image URL.
const GRN = "#0B3B2E";
const GOLD = "#B8963E";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-KE", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const getCompanyDetails = (company = {}) => {
  const logo = typeof company?.logo === "string" ? company.logo.trim() : "";
  const town = company?.town || company?.city || "";
  const postal = company?.postalAddress || company?.address || company?.location || "";
  return {
    name: company?.companyName || company?.name || "MILIKPMS",
    logo: /^(https?:\/\/|data:image\/)/i.test(logo) ? logo : "",
    address: [postal, company?.roadStreet, town].filter((v, i, all) => v && all.indexOf(v) === i).join(", "),
    contact: [
      company?.phone || company?.phoneNo || company?.phoneNumber || company?.mobile || company?.contactPhone || "",
      company?.email || company?.companyEmail || company?.contactEmail || "",
      company?.website || "",
    ].filter(Boolean).join("  ·  "),
    ids: [
      company?.taxPIN ? `PIN: ${company.taxPIN}` : "",
      company?.registrationNo ? `Reg. No: ${company.registrationNo}` : "",
    ].filter(Boolean).join("  ·  "),
  };
};

// Letterhead: logo and company details on the left, the report's title and filters on the right, under a brand rule.
const buildHeaderHtml = ({ company, title, subtitle }) => {
  const d = getCompanyDetails(company);
  return `
    <header class="lh">
      <div class="lh-brand">
        ${d.logo
          ? `<img src="${escapeHtml(d.logo)}" alt="" class="lh-logo" />`
          : `<div class="lh-mark">${escapeHtml(d.name.slice(0, 1).toUpperCase())}</div>`}
        <div class="lh-co">
          <div class="lh-name">${escapeHtml(d.name)}</div>
          ${d.address ? `<div class="lh-line">${escapeHtml(d.address)}</div>` : ""}
          ${d.contact ? `<div class="lh-line">${escapeHtml(d.contact)}</div>` : ""}
          ${d.ids ? `<div class="lh-line lh-ids">${escapeHtml(d.ids)}</div>` : ""}
        </div>
      </div>
      <div class="lh-doc">
        <div class="lh-kicker">Report</div>
        <div class="lh-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="lh-sub">${escapeHtml(subtitle)}</div>` : ""}
        <div class="lh-meta">Printed ${escapeHtml(formatDateTime())}</div>
      </div>
    </header>
    <div class="lh-rule"><span></span></div>
  `;
};

const buildTableHtml = ({ columns = [], rows = [], totalsRow = null }) => {
  const align = (col) => (col.align === "right" ? "right" : "left");
  const headerCells = columns
    .map((col) => `<th class="${col.align === "right" ? "num" : ""}">${escapeHtml(col.label)}</th>`)
    .join("");

  const bodyRows = rows
    .map((row, idx) => {
      const cells = columns
        .map((col) => {
          const raw = typeof col.value === "function" ? col.value(row, idx) : row?.[col.key];
          return `<td class="${col.align === "right" ? "num" : ""}">${escapeHtml(raw ?? "-")}</td>`;
        })
        .join("");
      return `<tr class="${idx % 2 === 1 ? "alt" : ""}">${cells}</tr>`;
    })
    .join("");

  // totalsRow: array of pre-formatted strings aligned per column; falls back to a record count
  const foot = totalsRow
    ? `<tfoot><tr>${columns.map((col, i) => `<td class="${align(col) === "right" ? "num" : ""}">${escapeHtml(totalsRow[i] ?? "")}</td>`).join("")}</tr></tfoot>`
    : rows.length > 0
      ? `<tfoot><tr><td colspan="${Math.max(columns.length, 1)}">${rows.length.toLocaleString()} record${rows.length !== 1 ? "s" : ""}</td></tr></tfoot>`
      : "";

  return `
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty-cell">No records found</td></tr>`}</tbody>
      ${foot}
    </table>
  `;
};

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; padding: 26px 30px 20px; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Letterhead */
  .lh { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; padding-bottom: 14px; }
  .lh-brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .lh-logo { max-height: 68px; max-width: 170px; object-fit: contain; }
  .lh-mark { width: 60px; height: 60px; flex: none; background: ${GRN}; color: #fff; font-size: 26px; font-weight: 800; display: flex; align-items: center; justify-content: center; border-radius: 12px; }
  .lh-name { font-size: 21px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: ${GRN}; line-height: 1.15; }
  .lh-line { font-size: 10px; color: #475569; line-height: 1.55; margin-top: 1px; }
  .lh-ids { color: #64748b; font-size: 9.5px; letter-spacing: .02em; }
  .lh-doc { text-align: right; flex: none; max-width: 46%; }
  .lh-kicker { font-size: 9px; font-weight: 700; letter-spacing: .28em; text-transform: uppercase; color: ${GOLD}; }
  .lh-title { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.15; margin-top: 3px; }
  .lh-sub { font-size: 10.5px; color: #475569; margin-top: 4px; line-height: 1.45; }
  .lh-meta { font-size: 9.5px; color: #94a3b8; margin-top: 6px; }
  .lh-rule { position: relative; height: 3px; background: ${GRN}; margin-bottom: 14px; }
  .lh-rule span { position: absolute; left: 0; top: 0; width: 96px; height: 3px; background: ${GOLD}; }

  /* Key figures */
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .kpi { min-width: 120px; padding: 6px 12px 7px; background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid ${GRN}; border-radius: 2px; }
  .kpi-label { font-size: 8.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #64748b; }
  .kpi-value { font-size: 13.5px; font-weight: 800; color: #0f172a; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .summary { font-size: 11px; font-weight: 700; color: #334155; margin-bottom: 12px; padding: 7px 10px; background: #f8fafc; border-left: 3px solid ${GRN}; border-radius: 0 4px 4px 0; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; }
  thead th { background: ${GRN}; color: #fff; padding: 8px 9px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; text-align: left; border: 1px solid rgba(255,255,255,.14); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody td { padding: 7px 9px; border: 1px solid #e2e8f0; vertical-align: top; color: #1e293b; }
  tbody tr.alt td { background: #f8fafc; }
  .empty-cell { text-align: center; color: #94a3b8; padding: 22px; font-style: italic; }
  tfoot td { padding: 8px 9px; font-weight: 800; font-size: 10.5px; border: 1px solid #cfe3d9; border-top: 2px solid ${GRN}; background: #eef7f2; color: ${GRN}; }

  /* Footer */
  .foot { display: flex; justify-content: space-between; gap: 16px; margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 9px; color: #94a3b8; }

  @media print {
    body { padding: 0; }
    @page { size: A4 landscape; margin: 11mm 11mm 13mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px "Segoe UI", Arial, sans-serif; color: #94a3b8; } }
  }
`;

// summaryItems: [[label, value], ...] shown as key-figure cards above the table (values are shown as given).
// win: a window opened by the caller inside the click handler, for reports that fetch their rows first (a window opened
// after an await is usually blocked as a pop-up). It is cleared before the report is written into it.
export const printTabularList = ({ title, subtitle = "", company = {}, columns = [], rows = [], summary = "", summaryItems = [], totalsRow = null, win: target = null }) => {
  const win = target || window.open("", "_blank", "width=1200,height=800");
  if (!win) return null;

  const name = getCompanyDetails(company).name;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title || "List")}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  ${buildHeaderHtml({ company, title, subtitle })}
  ${summary ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}
  ${summaryItems.length ? `<div class="kpis">${summaryItems.map(([label, value]) => `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div></div>`).join("")}</div>` : ""}
  ${buildTableHtml({ columns, rows, totalsRow })}
  <div class="foot"><span>${escapeHtml(name)} · generated by MILIKPMS</span><span>Confidential — for internal use</span></div>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
  return win;
};

export default printTabularList;
