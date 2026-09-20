import { fmtKES } from "../services/propertySaleApi";
import { listingAgentText } from "./saleAgent";
import { customFieldRows } from "./saleListingForm";

// Opens the printable sheet of a listing or unit. `company` is the current company; `T` the sales terms
// (saleListing, saleAgent, saleProject).
export function printSaleListing(row, { company, T, typeDef }) {
  const hides = (group) => Boolean(typeDef?.hiddenFields?.includes(group));
  const extraRows = customFieldRows(row, typeDef?.fields);
  const co = company || {};
  const coName = co.companyName || co.name || "MILIK";
  const coInfo = [co.phone || co.phoneNumber, co.email || co.companyEmail, co.address || co.location].filter(Boolean).join(" • ");
  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const statusLabel = String(row.status || "").replace(/_/g, " ").toUpperCase();
  const statusC  = { available: "#166534", reserved: "#92400e", under_contract: "#1e40af", sold: "#0f172a", withdrawn: "#9f1239" }[row.status] || "#334155";
  const statusBg = { available: "#dcfce7", reserved: "#fef3c7", under_contract: "#dbeafe", sold: "#f1f5f9", withdrawn: "#ffe4e6" }[row.status] || "#f1f5f9";
  const win = window.open("", "_blank", "width=900,height=720");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${esc(T.saleListing)} &ndash; ${esc(row.listingNumber)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px 32px;font-size:12px}
.hdr{display:grid;grid-template-columns:1fr 180px;align-items:start;border-bottom:3px solid #0B3B2E;padding-bottom:14px;margin-bottom:18px}
.co-name{font-size:18px;font-weight:900;color:#0B3B2E;margin-bottom:3px}.co-sub{font-size:9px;color:#64748b;line-height:1.5}
.doc-block{text-align:right}.doc-type{font-size:13px;font-weight:900;color:#0B3B2E;text-transform:uppercase;letter-spacing:.05em}
.doc-no{font-family:monospace;font-size:15px;font-weight:700;margin-top:3px}
.status-badge{display:inline-block;padding:3px 12px;font-size:10px;font-weight:800;margin-top:6px;background:${statusBg};color:${statusC}}
.price-box{border:2px solid #0B3B2E;padding:12px 16px;margin-bottom:16px;background:#f0faf5;display:flex;align-items:center;justify-content:space-between}
.price-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#64748b}
.price-val{font-size:28px;font-weight:900;color:#0B3B2E;font-family:monospace}.price-note{font-size:9px;font-weight:700;color:#64748b;margin-top:3px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:14px}
.field{background:#fff;padding:9px 12px}.fl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.fv{font-size:11px;font-weight:600;color:#1e293b}.section-title{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;margin:14px 0 6px}
.desc-box{border:1px solid #e2e8f0;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#334155;line-height:1.6}
.notice{font-size:9px;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #f1f5f9;padding-top:10px;line-height:1.6}
@media print{body{padding:14px 16px}@page{size:A4 portrait;margin:10mm}}</style></head><body>
<div class="hdr"><div><div class="co-name">${esc(coName)}</div>${coInfo ? `<div class="co-sub">${esc(coInfo)}</div>` : ""}</div>
<div class="doc-block"><div class="doc-type">${esc(T.saleListing)}</div><div class="doc-no">${esc(row.listingNumber)}</div><div class="status-badge">${esc(statusLabel)}</div></div></div>
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
<div class="notice">Official property sale listing issued by ${esc(coName)} &bull; Printed: ${new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" })} &bull; All prices in KES</div>
</body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}
