const GRN = "#0B3B2E";

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

const getCompanyDetails = (company = {}) => ({
  name: company?.companyName || company?.name || "MILIK",
  logo: company?.logo || "",
  phone: company?.phone || company?.phoneNo || company?.phoneNumber || company?.mobile || company?.contactPhone || "",
  email: company?.email || company?.companyEmail || company?.contactEmail || "",
  address: [company?.address || company?.postalAddress || company?.location || "", company?.town || company?.city || ""].filter(Boolean).join(", "),
});

const buildHeaderHtml = ({ company, title, subtitle, metaLine }) => {
  const d = getCompanyDetails(company);
  const infoLine = [d.address, d.phone, d.email].filter(Boolean).join(" · ");

  return `
    <div class="hdr">
      <div></div>
      <div class="hdr-center">
        ${d.logo
          ? `<img src="${escapeHtml(d.logo)}" alt="${escapeHtml(d.name)} logo" class="logo-img" />`
          : `<div class="logo-fallback">${escapeHtml(d.name.slice(0, 1).toUpperCase())}</div>`}
        <div class="co-name">${escapeHtml(d.name)}</div>
        ${infoLine ? `<div class="co-sub">${escapeHtml(infoLine)}</div>` : ""}
        <div class="rpt-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="rpt-sub">${escapeHtml(subtitle)}</div>` : ""}
      </div>
      <div class="hdr-right">
        <div class="print-date">${escapeHtml(metaLine || `Printed: ${formatDateTime()}`)}</div>
      </div>
    </div>
    <div class="divider"></div>
  `;
};

const buildTableHtml = ({ columns = [], rows = [] }) => {
  const headerCells = columns
    .map((col) => `<th style="text-align:${col.align === "right" ? "right" : "left"}">${escapeHtml(col.label)}</th>`)
    .join("");

  const bodyRows = rows
    .map((row, idx) => {
      const cells = columns
        .map((col) => {
          const raw = typeof col.value === "function" ? col.value(row, idx) : row?.[col.key];
          return `<td style="text-align:${col.align === "right" ? "right" : "left"}">${escapeHtml(raw ?? "-")}</td>`;
        })
        .join("");
      return `<tr class="${idx % 2 === 1 ? "alt" : ""}">${cells}</tr>`;
    })
    .join("");

  return `
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty-cell">No records found</td></tr>`}</tbody>
    </table>
  `;
};

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; padding: 26px 28px; font-size: 12px; }
  /* Header */
  .hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding-bottom: 16px; margin-bottom: 4px; gap: 16px; }
  .hdr-logo { display: none; }
  .logo-img { max-height: 60px; max-width: 150px; object-fit: contain; border-radius: 6px; }
  .logo-fallback { width: 56px; height: 56px; background: ${GRN}; color: #fff; font-size: 22px; font-weight: 900; display: flex; align-items: center; justify-content: center; border-radius: 10px; }
  .hdr-center { display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center; }
  .co-name { font-size: 18px; font-weight: 900; color: #0f172a; letter-spacing: -.01em; margin-top: 6px; }
  .co-sub { font-size: 10px; color: #64748b; line-height: 1.6; }
  .rpt-title { font-size: 15px; font-weight: 800; color: #1e293b; margin-top: 6px; }
  .rpt-sub { font-size: 11px; color: #475569; margin-top: 3px; }
  .divider { height: 2px; background: linear-gradient(90deg, #3b82f6, #93c5fd); border-radius: 2px; margin: 16px 0 16px; }
  .hdr-right { text-align: right; align-self: center; }
  .print-date { font-size: 10px; color: #64748b; line-height: 1.6; }
  /* Summary line */
  .summary { font-size: 11px; font-weight: 700; color: #334155; margin-bottom: 12px; padding: 7px 10px; background: #f8fafc; border-left: 3px solid ${GRN}; border-radius: 0 4px 4px 0; }
  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: ${GRN}; }
  thead th { color: #fff; padding: 9px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border: 1px solid rgba(255,255,255,.15); }
  tbody td { padding: 8px 10px; border: 1px solid #e2e8f0; vertical-align: top; color: #1e293b; }
  tbody tr.alt td { background: #f8fafc; }
  tbody tr:hover td { background: #f0fdf4; }
  .empty-cell { text-align: center; color: #94a3b8; padding: 20px; font-style: italic; }
  /* Footer count */
  tfoot td { padding: 8px 10px; font-weight: 700; font-size: 11px; border-top: 2px solid ${GRN}; background: #f0faf5; color: ${GRN}; }
  /* Print */
  @media print {
    body { padding: 12px 14px; }
    @page { size: A4 landscape; margin: 10mm; }
    thead tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tbody tr.alt td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export const printTabularList = ({ title, subtitle = "", company = {}, columns = [], rows = [], summary = "" }) => {
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) return null;

  const countRow = rows.length > 0
    ? `<tfoot><tr><td colspan="${columns.length}">${rows.length.toLocaleString()} record${rows.length !== 1 ? "s" : ""}</td></tr></tfoot>`
    : "";

  const tableWithFoot = buildTableHtml({ columns, rows }).replace("</table>", `${countRow}</table>`);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title || "List")}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  ${buildHeaderHtml({ company, title, subtitle, metaLine: summary || `Printed: ${formatDateTime()}` })}
  ${summary ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}
  ${tableWithFoot}
</body>
</html>`;

  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
  return win;
};

export default printTabularList;
