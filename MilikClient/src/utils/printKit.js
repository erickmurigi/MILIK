// Shared print engine. Every printout in Milik (reports, lists, invoices, receipts, vouchers, statements, payslips...) is built
// from these pieces so they all carry the same letterhead, typography, footer and "Powered by Milik" stamp:
//
//   printDocument(spec)      transactional documents for customers (A4 portrait)
//   printTabularList(spec)   lists and reports (A4 landscape) - see utils/printList.js
//
// Rules: every dynamic value is HTML-escaped (the print window is same-origin and written with document.write); a logo is
// used only when it is an http(s) or data:image URL; the window can be opened by the caller inside the click handler
// (`win`) so that documents that fetch data first are not blocked as pop-ups.

export const BRAND = { green: "#0B3B2E", gold: "#B8963E", orange: "#F58220", ink: "#0f172a", muted: "#64748b" };

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const cssString = (value) => String(value ?? "").replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ");

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
/** The "Powered by Milik" stamp: the Milik mark (two overlapping squares) and wordmark in a rounded badge. */
export const poweredByHtml = () => `
  <div class="pb" aria-label="Powered by Milik">
    <svg class="pb-mark" viewBox="0 0 30 26" width="24" height="21" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="15" fill="none" stroke="${BRAND.orange}" stroke-width="3"/>
      <rect x="9.5" y="8.5" width="17" height="15" fill="none" stroke="${BRAND.green}" stroke-width="3"/>
    </svg>
    <div class="pb-text"><span>Powered by</span><b>Milik</b></div>
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
  .pb { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px 5px 9px; border: 1px solid #d5dfda; border-radius: 8px; background: #f8fbf9; flex: none; }
  .pb-text { display: flex; flex-direction: column; line-height: 1; }
  .pb-text span { font-size: 7px; letter-spacing: .2em; text-transform: uppercase; color: ${BRAND.muted}; }
  .pb-text b { font-size: 15px; font-weight: 800; color: ${BRAND.green}; letter-spacing: -.01em; margin-top: 2px; }
`;

/** Open the print window now (call inside the click handler) or reuse the one the caller opened. */
export const openPrintWindow = (target = null, size = "width=1200,height=800") => target || window.open("", "_blank", size);

/** Write a finished document into the window, replacing anything there, and print it once it has laid out. */
export const writeAndPrint = (win, { title, css, body, pageCss = "" }) => {
  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title || "Document")}</title>
  <style>${BASE_CSS}${css || ""}${pageCss}</style>
</head>
<body>${body}</body>
</html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
  return win;
};

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
export const printDocument = (spec) => {
  const win = openPrintWindow(spec.win, "width=980,height=1100");
  if (!win) return null;
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

  return writeAndPrint(win, {
    title: `${docType} ${docNumber}`.trim(),
    css: DOC_CSS,
    body,
    pageCss: pageBoxCss({ size: "A4", margin: "12mm 14mm 16mm", left: `${co.name}${docNumber ? ` · ${docNumber}` : ""}` }),
  });
};
