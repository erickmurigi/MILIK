// Shared print engine, PURE part (no window / DOM), so the very same code renders the browser printouts and the server PDFs.
// THIS FILE EXISTS TWICE and must stay identical: MilikClient/src/utils/printKitCore.js and MilikApi/utils/printKitCore.js
// (an API test compares them). Edit one, copy to the other.
//
//   documentPageHtml(spec)   customer documents: invoices, receipts, vouchers, statements (A4 portrait)
//   listPageHtml(spec)       lists and reports (A4 landscape)
//
// Rules: every dynamic value is HTML-escaped; a logo is used only when it is an http(s) or data:image URL.

import { MILIK_STAMP_LOGO } from "./printKitLogo.js";

export const BRAND = { green: "#0B3B2E", gold: "#B8963E", orange: "#F58220", ink: "#0f172a", muted: "#64748b" };

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Text placed inside a CSS string: quotes and backslashes escaped, and < > written as CSS escapes, so a company name can never
// close the <style> tag.
const cssString = (value) => String(value ?? "").replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ").replace(/</g, "\\3C ").replace(/>/g, "\\3E ");

export const formatDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const formatDate = (value) => {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const formatMoney = (value, { decimals = 2 } = {}) =>
  Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

// ── amount in words (invoices, receipts, vouchers) ─────────────────────────────────────────────────────────────────────
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", " Thousand", " Million", " Billion", " Trillion"];

const belowThousand = (n) => {
  const parts = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; if (n) parts.push("and"); }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); } else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
};

const integerToWords = (n) => {
  if (n === 0) return "Zero";
  const groups = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${belowThousand(chunk)}${SCALES[scale]}`);
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return groups.join(", ").replace(/, (?=[^,]*$)/, " ").replace(/\s+and\s+and\s+/g, " and ");
};

const CURRENCY_WORDS = {
  KES: ["Kenya Shillings", "Cents"], KSH: ["Kenya Shillings", "Cents"], USD: ["US Dollars", "Cents"], EUR: ["Euros", "Cents"],
  GBP: ["Pounds Sterling", "Pence"], UGX: ["Uganda Shillings", "Cents"], TZS: ["Tanzania Shillings", "Cents"],
};

/** 1250.5 -> "Kenya Shillings One Thousand Two Hundred and Fifty and Fifty Cents Only". */
export const amountInWords = (amount, currency = "KES") => {
  const value = Math.abs(Number(amount || 0));
  if (!Number.isFinite(value)) return "";
  const [major, minor] = CURRENCY_WORDS[String(currency).toUpperCase()] || [String(currency).toUpperCase(), "Cents"];
  const whole = Math.floor(value);
  const cents = Math.round((value - whole) * 100);
  return `${major} ${integerToWords(whole)}${cents ? ` and ${integerToWords(cents)} ${minor}` : ""} Only`;
};

// ── company identity ────────────────────────────────────────────────────────────────────────────────────────────────────
export const getCompanyDetails = (company = {}) => {
  const logo = typeof company?.logo === "string" ? company.logo.trim() : "";
  const town = company?.town || company?.city || "";
  const postal = company?.postalAddress || company?.address || company?.location || "";
  return {
    name: company?.companyName || company?.name || "MILIK",
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
    currency: company?.baseCurrency || "KES",
  };
};

// ── shared building blocks ──────────────────────────────────────────────────────────────────────────────────────────────
/** The "Powered by Milik" stamp: the Milik logo in a small rounded badge at the foot of every printout. */
export const poweredByHtml = () => `
  <div class="pb" aria-label="Powered by Milik">
    <span class="pb-label">Powered by</span>
    <img class="pb-logo" src="${MILIK_STAMP_LOGO}" alt="Milik" />
  </div>`;

/** Letterhead: logo and company details on the left, document label / title / number on the right, under a brand rule. */
export const letterheadHtml = (company, { kicker = "", title = "", subtitle = "", meta = [], status = null, printed = true } = {}) => {
  const d = getCompanyDetails(company);
  const statusHtml = status?.label ? `<span class="pill pill-${escapeHtml(status.tone || "neutral")}">${escapeHtml(status.label)}</span>` : "";
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
        ${kicker ? `<div class="lh-kicker">${escapeHtml(kicker)}</div>` : ""}
        <div class="lh-title">${escapeHtml(title)}</div>
        ${statusHtml}
        ${subtitle ? `<div class="lh-sub">${escapeHtml(subtitle)}</div>` : ""}
        ${meta.map(([label, value]) => `<div class="lh-metarow"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join("")}
        ${printed ? `<div class="lh-meta">Printed ${escapeHtml(formatDateTime())}</div>` : ""}
      </div>
    </header>
    <div class="lh-rule"><span></span></div>`;
};

export const footerHtml = (company, { left = "", right = "Confidential — for the intended recipient" } = {}) => `
  <footer class="foot">
    <div class="foot-text">
      <span>${escapeHtml(left || getCompanyDetails(company).name)}</span>
      <span>${escapeHtml(right)}</span>
    </div>
    ${poweredByHtml()}
  </footer>`;

export const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: ${BRAND.ink}; background: #fff; padding: 26px 30px 20px; font-size: 11px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  img { max-width: 100%; }

  /* Letterhead */
  .lh { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; padding-bottom: 14px; }
  .lh-brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .lh-logo { max-height: 68px; max-width: 170px; object-fit: contain; }
  .lh-mark { width: 60px; height: 60px; flex: none; background: ${BRAND.green}; color: #fff; font-size: 26px; font-weight: 800; display: flex; align-items: center; justify-content: center; border-radius: 12px; }
  .lh-name { font-size: 21px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: ${BRAND.green}; line-height: 1.15; }
  .lh-line { font-size: 10px; color: #475569; line-height: 1.55; margin-top: 1px; }
  .lh-ids { color: ${BRAND.muted}; font-size: 9.5px; letter-spacing: .02em; }
  .lh-doc { text-align: right; flex: none; max-width: 46%; }
  .lh-kicker { font-size: 9px; font-weight: 700; letter-spacing: .28em; text-transform: uppercase; color: ${BRAND.gold}; }
  .lh-title { font-size: 22px; font-weight: 800; color: ${BRAND.ink}; line-height: 1.15; margin-top: 3px; }
  .lh-sub { font-size: 10.5px; color: #475569; margin-top: 4px; line-height: 1.45; }
  .lh-meta { font-size: 9.5px; color: #94a3b8; margin-top: 6px; }
  .lh-metarow { display: flex; justify-content: flex-end; gap: 10px; font-size: 10.5px; color: #475569; margin-top: 3px; }
  .lh-metarow b { color: ${BRAND.ink}; min-width: 90px; text-align: right; font-weight: 700; }
  .lh-rule { position: relative; height: 3px; background: ${BRAND.green}; margin-bottom: 14px; }
  .lh-rule span { position: absolute; left: 0; top: 0; width: 96px; height: 3px; background: ${BRAND.gold}; }

  /* Status pills */
  .pill { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .pill-success { background: #dcfce7; color: #166534; } .pill-warning { background: #fef3c7; color: #92400e; }
  .pill-danger { background: #fee2e2; color: #991b1b; } .pill-neutral { background: #e2e8f0; color: #334155; }
  .pill-info { background: #dbeafe; color: #1e40af; }

  /* Footer and the Powered by Milik stamp */
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 22px; padding-top: 10px; border-top: 1px solid #cbd5e1; page-break-inside: avoid; }
  .foot-text { display: flex; flex-direction: column; gap: 2px; font-size: 9px; color: #94a3b8; }
  .pb { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 5px 11px 6px; border: 1px solid #d5dfda; border-radius: 8px; background: #fff; flex: none; }
  .pb-label { font-size: 6.5px; letter-spacing: .22em; text-transform: uppercase; color: ${BRAND.muted}; line-height: 1; }
  .pb-logo { height: 17px; width: auto; display: block; }
`;

/** A complete HTML page from a body and its styles. */
export const wrapPage = ({ title, css = "", body, pageCss = "" }) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title || "Document")}</title>
  <style>${BASE_CSS}${css}${pageCss}</style>
</head>
<body>${body}</body>
</html>`;

export const pageBoxCss = ({ size = "A4", margin = "11mm 12mm 14mm", left = "" } = {}) => `
  @media print {
    body { padding: 0; }
    @page { size: ${size}; margin: ${margin};
      @bottom-left { content: "${cssString(left)}"; font: 8.5px "Segoe UI", Arial, sans-serif; color: #94a3b8; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8.5px "Segoe UI", Arial, sans-serif; color: #94a3b8; }
    }
  }`;

// ── transactional documents ─────────────────────────────────────────────────────────────────────────────────────────────
const DOC_CSS = `
  .cards { display: grid; gap: 10px; margin-bottom: 14px; }
  .card { border: 1px solid #e2e8f0; border-radius: 4px; padding: 9px 12px; background: #fff; }
  .card h4 { font-size: 8.5px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: ${BRAND.gold}; margin-bottom: 5px; }
  .card .who { font-size: 13px; font-weight: 800; color: ${BRAND.ink}; }
  .card .line { font-size: 10.5px; color: #475569; margin-top: 1px; }
  .kv { display: flex; justify-content: space-between; gap: 12px; font-size: 10.5px; padding: 2.5px 0; border-bottom: 1px dotted #e2e8f0; }
  .kv:last-child { border-bottom: 0; }
  .kv span { color: ${BRAND.muted}; } .kv b { font-weight: 700; text-align: right; }

  table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10.5px; }
  table.items thead th { background: ${BRAND.green}; color: #fff; text-align: left; padding: 8px 10px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
  table.items td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #f8fafc; }
  table.items .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.items td .sub { display: block; font-size: 9.5px; color: ${BRAND.muted}; margin-top: 1px; }
  table.items tr { page-break-inside: avoid; }

  .lower { display: grid; grid-template-columns: 1fr 250px; gap: 18px; align-items: start; margin-bottom: 14px; }
  .totals { border: 1px solid #cfe3d9; border-radius: 4px; overflow: hidden; page-break-inside: avoid; }
  .totals .row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 12px; font-size: 10.5px; border-bottom: 1px solid #e6efe9; font-variant-numeric: tabular-nums; }
  .totals .row span { color: #475569; }
  .totals .row.strong { background: #eef7f2; font-size: 12px; font-weight: 800; color: ${BRAND.green}; }
  .totals .row.strong span { color: ${BRAND.green}; }
  .totals .row.hero { background: ${BRAND.green}; color: #fff; font-size: 13px; font-weight: 800; border-bottom: 0; }
  .totals .row.hero span { color: #d9ece2; }
  .totals .row.neg b { color: #b91c1c; } .totals .row.pos b { color: #15803d; }
  .words { border-left: 3px solid ${BRAND.gold}; background: #fbf8ef; padding: 8px 12px; margin-bottom: 14px; font-size: 10.5px; }
  .words b { display: block; font-size: 8.5px; letter-spacing: .16em; text-transform: uppercase; color: ${BRAND.gold}; margin-bottom: 2px; }
  .words i { font-style: normal; font-weight: 700; color: ${BRAND.ink}; }
  .notes { font-size: 10px; color: #475569; }
  .notes h4 { font-size: 8.5px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: ${BRAND.gold}; margin: 0 0 4px; }
  .notes p, .notes li { margin-bottom: 3px; } .notes ul { margin-left: 14px; }
  .notes .block { margin-bottom: 10px; }

  .sigs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 26px; margin: 26px 0 8px; page-break-inside: avoid; }
  .sig { border-top: 1px solid #94a3b8; padding-top: 5px; font-size: 9.5px; color: ${BRAND.muted}; }
  .sig b { display: block; color: ${BRAND.ink}; font-size: 10.5px; margin-bottom: 1px; }
  .stampbox { width: 118px; height: 66px; border: 1px dashed #b6c4bd; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 8px; letter-spacing: .14em; text-transform: uppercase; color: #b6c4bd; flex: none; }
  .verify { font-size: 9px; color: #94a3b8; margin-top: 10px; text-align: center; }
  .watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 120px; font-weight: 900; letter-spacing: .08em; color: rgba(11,59,46,.055); transform: rotate(-22deg); pointer-events: none; z-index: 0; }
  .watermark.danger { color: rgba(185,28,28,.07); }
  .sec { position: relative; z-index: 1; }
`;

const cellText = (col, row, index) => {
  const raw = Array.isArray(row) ? row[index] : typeof col.value === "function" ? col.value(row) : row?.[col.key];
  return raw ?? "";
};

/**
 * Print a customer-facing document (invoice, receipt, payment voucher, statement, quotation...).
 *
 * spec: {
 *   company, docType ("Receipt"), docNumber, status: { label, tone: success|warning|danger|neutral|info }, watermark ("PAID"),
 *   meta: [[label, value]]           dates / reference shown under the title,
 *   parties: [{ heading, name, lines: [] }]   up to three cards (Bill to / Received from / Property ...),
 *   details: [[label, value]] | { heading, rows }   a key-value card,
 *   table: { columns: [{ label, align, width, value(row), sub(row) }], rows, empty },
 *   totals: [{ label, value, strong, hero, tone }],
 *   amountWords: { amount, currency },
 *   notes: [{ heading, text | items: [] }],
 *   signatures: [{ label, name }], stamp: true (adds a company stamp box),
 *   footerNote, preparedBy, win
 * }
 */
export const documentPageHtml = (spec) => {
  const { company, docType = "Document", docNumber = "", status = null, watermark = "", meta = [], parties = [], details = null, table = null, totals = [], amountWords = null, notes = [], signatures = [], stamp = false, footerNote = "", preparedBy = "" } = spec;
  const co = getCompanyDetails(company);

  const partyCards = parties.slice(0, 3).map((p) => `
    <div class="card">
      <h4>${escapeHtml(p.heading)}</h4>
      ${p.name ? `<div class="who">${escapeHtml(p.name)}</div>` : ""}
      ${(p.lines || []).filter(Boolean).map((line) => `<div class="line">${escapeHtml(line)}</div>`).join("")}
    </div>`);
  const detailRows = Array.isArray(details) ? details : details?.rows || [];
  if (detailRows.length) {
    partyCards.push(`
    <div class="card">
      <h4>${escapeHtml(Array.isArray(details) ? "Details" : details.heading || "Details")}</h4>
      ${detailRows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join("")}
    </div>`);
  }
  const cardsHtml = partyCards.length ? `<div class="cards" style="grid-template-columns:repeat(${Math.min(partyCards.length, 3)},1fr)">${partyCards.join("")}</div>` : "";

  let tableHtml = "";
  if (table) {
    const cols = table.columns || [];
    const head = cols.map((c) => `<th class="${c.align === "right" ? "num" : ""}" ${c.width ? `style="width:${escapeHtml(c.width)}"` : ""}>${escapeHtml(c.label)}</th>`).join("");
    const body = (table.rows || []).map((row) => `<tr>${cols.map((c, i) => {
      const sub = typeof c.sub === "function" ? c.sub(row) : "";
      return `<td class="${c.align === "right" ? "num" : ""}">${escapeHtml(cellText(c, row, i))}${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ""}</td>`;
    }).join("")}</tr>`).join("");
    tableHtml = `<table class="items"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${Math.max(cols.length, 1)}" style="text-align:center;color:#94a3b8;padding:18px">${escapeHtml(table.empty || "No items")}</td></tr>`}</tbody></table>`;
  }

  const totalsHtml = totals.length
    ? `<div class="totals">${totals.map((t) => `<div class="row ${t.hero ? "hero" : t.strong ? "strong" : ""} ${t.tone || ""}"><span>${escapeHtml(t.label)}</span><b>${escapeHtml(t.value)}</b></div>`).join("")}</div>`
    : "";
  const notesHtml = notes.length
    ? `<div class="notes">${notes.map((n) => `<div class="block">${n.heading ? `<h4>${escapeHtml(n.heading)}</h4>` : ""}${n.text ? `<p>${escapeHtml(n.text)}</p>` : ""}${n.items?.length ? `<ul>${n.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</div>`
    : "<div></div>";
  const wordsHtml = amountWords ? `<div class="words"><b>Amount in words</b><i>${escapeHtml(amountInWords(amountWords.amount, amountWords.currency || co.currency))}</i></div>` : "";

  const sigList = signatures.length ? signatures : [];
  const sigsHtml = sigList.length || stamp
    ? `<div class="sigs">${sigList.map((s) => `<div class="sig"><b>${escapeHtml(s.name || " ")}</b>${escapeHtml(s.label)}</div>`).join("")}${stamp ? `<div class="stampbox">Company stamp</div>` : ""}</div>`
    : "";

  const body = `
    ${watermark ? `<div class="watermark ${watermark === "VOID" || watermark === "CANCELLED" ? "danger" : ""}">${escapeHtml(watermark)}</div>` : ""}
    <div class="sec">
      ${letterheadHtml(company, { kicker: docType, title: docNumber || docType, status, meta, printed: false })}
      ${cardsHtml}
      ${tableHtml}
      ${totalsHtml || notesHtml !== "<div></div>" ? `<div class="lower">${notesHtml}${totalsHtml || "<div></div>"}</div>` : ""}
      ${wordsHtml}
      ${sigsHtml}
      ${footerNote ? `<div class="verify" style="font-size:10.5px;color:${BRAND.green};font-weight:700">${escapeHtml(footerNote)}</div>` : ""}
      <div class="verify">Computer-generated ${escapeHtml(docType.toLowerCase())}${docNumber ? ` ${escapeHtml(docNumber)}` : ""} · printed ${escapeHtml(formatDateTime())}${preparedBy ? ` by ${escapeHtml(preparedBy)}` : ""}</div>
      ${footerHtml(company, { left: `${co.name}${docNumber ? ` · ${docNumber}` : ""}` })}
    </div>`;

  return wrapPage({
    title: `${docType} ${docNumber}`.trim(),
    css: DOC_CSS,
    body,
    pageCss: pageBoxCss({ size: "A4", margin: "12mm 14mm 16mm", left: `${co.name}${docNumber ? ` · ${docNumber}` : ""}` }),
  });
};

// ── lists and reports ───────────────────────────────────────────────────────────────────────────────────────────────────
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
  h3.sec-h { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .14em; color: ${BRAND.green}; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe3d9; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
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
  // totalsRow: array of pre-formatted strings aligned per column; false = no footer; otherwise a record count
  const foot = totalsRow === false
    ? ""
    : totalsRow
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


/**
 * spec: { title, subtitle, company, columns, rows, summary, summaryItems: [[label, value]], totalsRow, notes: [], signatures: [{label, name}],
 *         orientation: "landscape"|"portrait", kicker }
 * Rows may be plain records or markers { __group, meta } / { __subtotal: [cells] }; a column can colour a cell with tone(row)
 * ("neg" | "pos" | "muted") and bold it with bold: true.
 * sections: [{ heading, columns, rows, totalsRow, half }] more tables under the main one (or instead of it when `columns` is
 * empty); consecutive `half: true` sections sit side by side.
 */
export const listPageHtml = ({
  title, subtitle = "", company = {}, columns = [], rows = [], summary = "", summaryItems = [], totalsRow = null,
  notes = [], signatures = [], orientation = "landscape", kicker = "Report", sections = [],
}) => {
  const name = getCompanyDetails(company).name;
  const sectionHtml = (sec) => `<div class="sec-block"><h3 class="sec-h">${escapeHtml(sec.heading || "")}</h3>${buildTableHtml({ columns: sec.columns || [], rows: sec.rows || [], totalsRow: sec.totalsRow || false })}</div>`;
  const sectionsHtml = [];
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i].half && sections[i + 1]?.half) { sectionsHtml.push(`<div class="two-col">${sectionHtml(sections[i])}${sectionHtml(sections[i + 1])}</div>`); i += 1; } else sectionsHtml.push(sectionHtml(sections[i]));
  }
  const body = `
    ${letterheadHtml(company, { kicker, title, subtitle })}
    ${summary ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}
    ${summaryItems.length ? `<div class="kpis">${summaryItems.map(([label, value]) => `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div></div>`).join("")}</div>` : ""}
    ${columns.length ? buildTableHtml({ columns, rows, totalsRow }) : ""}
    ${sectionsHtml.join("")}
    ${notes.length ? `<div class="notes-list">${notes.map((n) => `<p>${escapeHtml(n)}</p>`).join("")}</div>` : ""}
    ${signatures.length ? `<div class="sigs">${signatures.map((s) => `<div class="sig">${escapeHtml(s.label)}${s.name ? ` — ${escapeHtml(s.name)}` : ""}</div>`).join("")}</div>` : ""}
    ${footerHtml(company, { left: name })}`;
  return wrapPage({ title: title || "Report", css: LIST_CSS, body, pageCss: pageBoxCss({ size: orientation === "portrait" ? "A4" : "A4 landscape", left: name }) });
};
