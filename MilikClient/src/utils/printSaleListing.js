import { toast } from "react-toastify";
import { fmtKES } from "../services/propertySaleApi";
import { escapeHtml, footerHtml, formatDate, getCompanyDetails, letterheadHtml, openPrintWindow, pageBoxCss, wrapPage } from "./printKit";
import { listingAgentText } from "./saleAgent";
import { customFieldRows } from "./saleListingForm";

// Opens the printable sheet of a listing or unit. `company` is the current company; `T` the sales terms
// (saleListing, saleAgent, saleProject).
export function printSaleListing(row, { company, T, typeDef }) {
  const hides = (group) => Boolean(typeDef?.hiddenFields?.includes(group));
  const extraRows = customFieldRows(row, typeDef?.fields);
  const esc = escapeHtml;
  const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const statusLabel = String(row.status || "").replace(/_/g, " ");
  const statusTone = { available: "success", reserved: "warning", under_contract: "info", sold: "neutral", withdrawn: "danger" }[row.status] || "neutral";
  const coName = getCompanyDetails(company).name;
  const win = openPrintWindow(null, "width=900,height=720");
  if (!win) { toast.error("Pop-up blocked — allow pop-ups for this site to print"); return; }
  const css = `
.price-box{border:2px solid #0B3B2E;padding:12px 16px;margin-bottom:16px;background:#f0faf5;display:flex;align-items:center;justify-content:space-between}
.price-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
.price-val{font-size:28px;font-weight:900;color:#0B3B2E;font-family:monospace}.price-note{font-size:9px;font-weight:700;color:#64748b;margin-top:3px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}.section-title{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;margin:14px 0 6px}
.desc-box{border:1px solid #e2e8f0;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#334155;line-height:1.6}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:20px;line-height:1.6}`;
  const body = `${letterheadHtml(company, { kicker: T.saleListing, title: row.listingNumber || T.saleListing, status: { label: statusLabel, tone: statusTone }, printed: false })}
<div class="price-box"><div><div class="price-label">Asking Price</div><div class="price-val">${esc(fmtKES(row.askingPrice))}</div><div class="price-note">${row.negotiable ? "Price is negotiable" : "Fixed price – not negotiable"}</div></div>
<div style="text-align:right"><div class="price-label">Property Type</div><div style="font-size:15px;font-weight:900;color:#0f172a;text-transform:capitalize;margin-top:4px">${esc(row.propertyType)}</div></div></div>
<div class="section-title">Property Details</div><div class="grid">
<div class="field"><div class="fl">${esc(T.saleListing)} No.</div><div class="fv">${esc(row.listingNumber)}</div></div>
<div class="field"><div class="fl">Title</div><div class="fv">${esc(row.title)}</div></div>
<div class="field"><div class="fl">Listed Date</div><div class="fv">${esc(fmtD(row.listedDate))}</div></div>
${hides("size") ? "" : `<div class="field"><div class="fl">Size</div><div class="fv">${row.size ? esc(`${row.size} ${row.sizeUnit ?? ""}`.trim()) : "Not specified"}</div></div>`}
${hides("titleDeed") ? "" : `<div class="field"><div class="fl">Title Deed</div><div class="fv">${row.titleDeedAvailable ? `Yes &ndash; ${esc(row.titleDeedNumber || "N/A")}` : "Not available"}</div></div>`}
<div class="field"><div class="fl">Assigned ${esc(T.saleAgent)}</div><div class="fv">${esc(listingAgentText(row, T.saleProject.toLowerCase()) || "Unassigned")}</div></div></div>
${extraRows.length ? `<div class="section-title">Details</div><div class="grid">${extraRows.map(([l, v]) => `<div class="field"><div class="fl">${esc(l)}</div><div class="fv">${esc(v)}</div></div>`).join("")}</div>` : ""}
${hides("location") ? "" : `<div class="section-title">Location</div><div class="grid">
<div class="field"><div class="fl">Location / Address</div><div class="fv">${esc(row.location || "—")}</div></div>
<div class="field"><div class="fl">Town / City</div><div class="fv">${esc(row.town || "—")}</div></div>
<div class="field"><div class="fl">County</div><div class="fv">${esc(row.county || "—")}</div></div></div>`}
${row.description ? `<div class="section-title">Description</div><div class="desc-box">${esc(row.description)}</div>` : ""}
${!hides("amenities") && row.amenities?.length ? `<div class="section-title">Amenities</div><div class="desc-box">${row.amenities.map(esc).join(" &bull; ")}</div>` : ""}
<div class="notice">Official property sale listing issued by ${esc(coName)} &bull; Printed: ${esc(formatDate(new Date()))} &bull; All prices in KES</div>
${footerHtml(company, { left: `${coName} · ${row.listingNumber || ""}` })}`;
  win.document.open();
  win.document.write(wrapPage({ title: `${T.saleListing} – ${row.listingNumber || ""}`, css, body, pageCss: pageBoxCss({ size: "A4", margin: "11mm 12mm 14mm", left: coName }) }));
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 450);
}
