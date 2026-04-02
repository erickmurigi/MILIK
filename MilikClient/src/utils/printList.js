const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const getCompanyDetails = (company = {}) => {
  const name = company?.companyName || company?.name || "MILIK";
  const logo = company?.logo || "";
  const phone = company?.phone || company?.phoneNumber || company?.mobile || "";
  const email = company?.email || company?.companyEmail || "";
  const address = company?.address || company?.location || company?.city || "";
  return { name, logo, phone, email, address };
};

const buildHeaderHtml = ({ company, title, subtitle, metaLine }) => {
  const details = getCompanyDetails(company);
  const infoLine = [details.phone, details.email, details.address].filter(Boolean).join(" • ");

  return `
    <div class="header-wrap">
      <div class="brand-side brand-side-left">
        ${details.logo ? `<img src="${escapeHtml(details.logo)}" alt="${escapeHtml(details.name)} logo" class="brand-logo" />` : `<div class="brand-logo brand-fallback">${escapeHtml(details.name.slice(0, 1).toUpperCase())}</div>`}
      </div>
      <div class="brand-center">
        <div class="company-name">${escapeHtml(details.name)}</div>
        <div class="report-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="report-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        ${infoLine ? `<div class="company-meta">${escapeHtml(infoLine)}</div>` : ""}
        <div class="company-meta">${escapeHtml(metaLine || `Printed on ${formatDateTime()}`)}</div>
      </div>
      <div class="brand-side"></div>
    </div>
  `;
};

const buildTableHtml = ({ columns = [], rows = [] }) => {
  const headerCells = columns
    .map((column) => `<th style="text-align:${column.align === "right" ? "right" : "left"};">${escapeHtml(column.label)}</th>`)
    .join("");

  const bodyRows = rows
    .map((row, rowIndex) => {
      const cells = columns
        .map((column) => {
          const rawValue = typeof column.value === "function" ? column.value(row, rowIndex) : row?.[column.key];
          return `<td style="text-align:${column.align === "right" ? "right" : "left"};">${escapeHtml(rawValue ?? "-")}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty-cell">No rows available</td></tr>`}</tbody>
    </table>
  `;
};

export const printTabularList = ({ title, subtitle = "", company = {}, columns = [], rows = [], summary = "" }) => {
  const printWindow = window.open("", "_blank", "width=1200,height=800");
  if (!printWindow) return null;

  const html = `
    <html>
      <head>
        <title>${escapeHtml(title || "List")}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 26px 28px; }
          .header-wrap { display: grid; grid-template-columns: 128px 1fr 128px; align-items: center; border-bottom: 3px solid #0B3B2E; padding-bottom: 18px; margin-bottom: 18px; gap: 12px; }
          .brand-side { display:flex; align-items:center; justify-content:center; min-height: 96px; }
          .brand-side-left { justify-content:flex-start; }
          .brand-logo { width: 96px; height: 96px; object-fit: cover; border-radius: 18px; border: 1px solid #cbd5e1; background: #fff; padding: 6px; }
          .brand-fallback { width: 96px; height: 96px; background: #0B3B2E; color: #fff; font-weight: 800; font-size: 34px; display:flex; align-items:center; justify-content:center; border-radius: 18px; }
          .brand-center { text-align: center; }
          .company-name { font-size: 26px; font-weight: 800; letter-spacing: .02em; color: #0B3B2E; }
          .report-title { font-size: 18px; font-weight: 700; margin-top: 4px; }
          .report-subtitle { font-size: 12px; color: #475569; margin-top: 4px; }
          .company-meta { font-size: 11px; color: #64748b; margin-top: 4px; }
          .summary-line { margin: 0 0 14px; font-size: 12px; color: #334155; font-weight: 600; }
          .header-wrap + .summary-line { margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          thead th { background: #0B3B2E; color: #fff; padding: 9px 10px; border: 1px solid #dbe3dd; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
          tbody td { padding: 8px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
          tbody tr:nth-child(even) td { background: #f8fafc; }
          .empty-cell { text-align:center; color:#64748b; padding: 20px; }
          @media print { body { padding: 14px 16px; } }
        </style>
      </head>
      <body>
        ${buildHeaderHtml({ company, title, subtitle, metaLine: summary || `Printed on ${formatDateTime()}` })}
        ${summary ? `<p class="summary-line">${escapeHtml(summary)}</p>` : ""}
        ${buildTableHtml({ columns, rows })}
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 450);

  return printWindow;
};

export default printTabularList;
