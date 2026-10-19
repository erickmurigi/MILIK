// Report Center PDF generator — data builders for each report. Every builder returns exactly the
// `{subtitle, summaryItems, columns, rows, totalsRow}` shape printKitCore.js's listPageHtml expects
// (columns: [{label, align, value: (row) => ...}]) — the same shape already used throughout this
// module's client-side print specs (SaleReportsHub.jsx, SaleCommissions.jsx, etc.), just built
// server-side here so it can be rendered to a real PDF via Puppeteer instead of window.print().
//
// Each builder reuses the EXACT same filter/aggregation helpers the report's own JSON endpoint uses
// (exported from collectionsReportsController.js / commissionsController.js for this purpose) rather
// than re-deriving the business logic — the rows a generated PDF shows are guaranteed to match what the
// same filters would show on screen, because it is the same code building them.
import SaleDeal from "../models/SaleDeal.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleProject from "../models/SaleProject.js";
import SaleAgent from "../models/SaleAgent.js";
import { formatMoney } from "../../../utils/printKitCore.js";
import {
  BUCKETS, OPEN_INSTALLMENT, cents, money, asOfDate, buildDealFilter, loadNames, dealLabels, paidByDeal, bucketExpr,
} from "../controllers/collectionsReportsController.js";
import { populateCommission } from "../controllers/commissionsController.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import { escapeRegex } from "../services/businessScope.js";
import mongoose from "mongoose";

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const kes = (v) => formatMoney(v);
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtLabel = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// A printed PDF has no pagination — every matching row renders into one Puppeteer page, so an
// unfiltered report on a company with a very large history must not be allowed to try to fetch and
// render an unbounded row set. Checked with a cheap, index-backed countDocuments() BEFORE the full
// fetch — rejecting early never pays the cost of the work it's protecting against. 3,000 rows is
// already a large printed document; anything bigger means the filters need narrowing, not a bigger cap.
export const MAX_REPORT_ROWS = 3000;
export const assertWithinCap = (count, label) => {
  if (count > MAX_REPORT_ROWS) {
    const err = new Error(`${label}: ${count.toLocaleString()} rows match these filters — narrow by project, agent, or date range before generating a PDF (limit ${MAX_REPORT_ROWS.toLocaleString()}).`);
    err.status = 400;
    throw err;
  }
};

const AGING_LABEL = { notDue: "Not yet due", d1_30: "1–30 days late", d31_60: "31–60 days", d61_90: "61–90 days", d90plus: "Over 90 days" };
const DAY_MS = 86_400_000;

// No server-side equivalent exists to the frontend's useTerms() (per-company customizable wording,
// e.g. "Deal" -> "Transaction") — that's resolved client-side from Redux only, nothing the backend
// reads today. Fixed default labels here, matching how the PMS PDF services (receiptPdfService.js etc.)
// already print fixed English terms with no per-company customization.
const LABEL = { deal: "Deal", buyer: "Buyer", listing: "Listing", project: "Project", agent: "Agent" };

// Resolves the same human-readable "Project: X · Agent: Y" subtitle fragment every report uses,
// from whichever of projectId/agentId query params were actually sent.
const describeFilters = async (business, req) => {
  const [project, agent] = await Promise.all([
    req.query.projectId ? SaleProject.findOne({ business, _id: req.query.projectId }).select("name").lean() : null,
    req.query.agentId ? SaleAgent.findOne({ business, _id: req.query.agentId }).select("fullName").lean() : null,
  ]);
  return [project?.name, agent?.fullName].filter(Boolean).join(" · ");
};

// ── Receivables Aging ─────────────────────────────────────────────────────────────────────────────
const receivablesReport = async (business, req) => {
  const asOf = asOfDate(req);
  const dealFilter = await buildDealFilter(req, business, { statuses: ["active", "closed"] });
  assertWithinCap(await SaleDeal.countDocuments(dealFilter), "Receivables Aging");
  const deals = await SaleDeal.find(dealFilter)
    .select("dealNumber buyer listing agent agreedPrice dealDate status").lean();
  const dealIds = deals.map((d) => d._id);

  const [paid, scheduled] = await Promise.all([
    paidByDeal(business, dealIds),
    dealIds.length
      ? SalePaymentSchedule.aggregate([
          { $match: { business: oid(business), deal: { $in: dealIds }, status: { $in: OPEN_INSTALLMENT } } },
          { $group: { _id: { deal: "$deal", bucket: bucketExpr(asOf) }, amount: { $sum: "$expectedAmount" }, oldest: { $min: "$dueDate" } } },
        ])
      : [],
  ]);
  const perDeal = new Map();
  for (const r of scheduled) {
    const key = String(r._id.deal);
    const entry = perDeal.get(key) || { buckets: {}, oldest: null };
    entry.buckets[r._id.bucket] = (entry.buckets[r._id.bucket] || 0) + cents(r.amount);
    if (r._id.bucket !== "notDue" && (!entry.oldest || r.oldest < entry.oldest)) entry.oldest = r.oldest;
    perDeal.set(key, entry);
  }

  const totalsC = { balance: 0, ...Object.fromEntries(BUCKETS.map((b) => [b, 0])) };
  const dealRows = [];
  for (const deal of deals) {
    const balanceC = cents(deal.agreedPrice) - cents(paid.get(String(deal._id)));
    if (balanceC <= 0) continue;
    const entry = perDeal.get(String(deal._id)) || { buckets: {}, oldest: null };
    dealRows.push({ _deal: deal, balance: money(balanceC), oldestDue: entry.oldest,
      daysLate: entry.oldest ? Math.max(Math.floor((asOf - entry.oldest) / DAY_MS), 0) : 0,
      ...Object.fromEntries(BUCKETS.map((b) => [b, money(entry.buckets[b] || 0)])) });
    totalsC.balance += balanceC;
    for (const b of BUCKETS) totalsC[b] += entry.buckets[b] || 0;
  }
  dealRows.sort((a, b) => b.balance - a.balance);
  const names = await loadNames(business, dealRows.map((r) => r._deal));
  const rows = dealRows.map((r) => ({ ...dealLabels(r._deal, names), ...r }));

  return {
    subtitle: [`As of ${fmtDate(asOf)}`, await describeFilters(business, req)].filter(Boolean).join(" · "),
    summaryItems: [["Owed", kes(money(totalsC.balance))], ...BUCKETS.map((b) => [AGING_LABEL[b], kes(money(totalsC[b]))])],
    columns: [
      { label: LABEL.deal, value: (r) => r.dealNumber },
      { label: LABEL.buyer, value: (r) => r.buyerName },
      { label: `${LABEL.listing} · ${LABEL.project}`, value: (r) => [r.unit, r.project].filter(Boolean).join(" — ") },
      { label: LABEL.agent, value: (r) => r.agentName },
      { label: "Balance", align: "right", value: (r) => kes(r.balance) },
      ...BUCKETS.map((b) => ({ label: AGING_LABEL[b], align: "right", value: (r) => (r[b] ? kes(r[b]) : "—") })),
      { label: "Oldest Late", align: "right", value: (r) => (r.daysLate ? `${r.daysLate} d` : "—") },
    ],
    rows,
    totalsRow: ["TOTAL", "", "", "", kes(money(totalsC.balance)), ...BUCKETS.map((b) => kes(money(totalsC[b]))), ""],
  };
};

// ── Sales Register ────────────────────────────────────────────────────────────────────────────────
const registerReport = async (business, req) => {
  const filter = await buildDealFilter(req, business);
  const search = String(req.query.search || "").trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    const [buyers, listings] = await Promise.all([
      SaleBuyer.distinct("_id", { business, $or: [{ fullName: rx }, { phone: rx }, { buyerNumber: rx }] }),
      SaleListing.distinct("_id", { business, $or: [{ title: rx }, { unitNumber: rx }, { listingNumber: rx }] }),
    ]);
    filter.$or = [{ dealNumber: rx }, { buyer: { $in: buyers } }, { listing: { $in: listings } }];
  }
  assertWithinCap(await SaleDeal.countDocuments(filter), "Sales Register");
  const deals = await SaleDeal.find(filter).sort({ dealDate: -1, _id: -1 })
    .select("dealNumber buyer listing agent agreedPrice dealDate status actualClosingDate titleTransferDate").lean();
  const [paid, names] = await Promise.all([paidByDeal(business, deals.map((d) => d._id)), loadNames(business, deals)]);

  let agreedC = 0, paidC = 0, balanceC = 0, cancelled = 0;
  const rows = deals.map((d) => {
    const listing = names.listings.get(String(d.listing));
    const thisPaidC = cents(paid.get(String(d._id)));
    const thisBalanceC = d.status === "cancelled" ? 0 : Math.max(cents(d.agreedPrice) - thisPaidC, 0);
    paidC += thisPaidC;
    if (d.status === "cancelled") cancelled += 1; else { agreedC += cents(d.agreedPrice); balanceC += thisBalanceC; }
    return {
      ...dealLabels(d, names), dealDate: d.dealDate, status: d.status,
      askingPrice: listing?.askingPrice ?? null, agreedPrice: d.agreedPrice,
      discount: listing?.askingPrice != null ? money(cents(listing.askingPrice) - cents(d.agreedPrice)) : null,
      paid: money(thisPaidC), balance: money(thisBalanceC),
    };
  });

  return {
    subtitle: [req.query.dateFrom && req.query.dateTo ? `${fmtDate(req.query.dateFrom)} – ${fmtDate(req.query.dateTo)}` : "", req.query.status && `Status: ${fmtLabel(req.query.status)}`, await describeFilters(business, req)].filter(Boolean).join(" · "),
    summaryItems: [[`${LABEL.deal}s`, String(rows.length)], ["Cancelled", String(cancelled)], ["Agreed", kes(money(agreedC))], ["Paid", kes(money(paidC))], ["Balance", kes(money(balanceC))]],
    columns: [
      { label: "Date", value: (r) => fmtDate(r.dealDate) },
      { label: LABEL.deal, value: (r) => r.dealNumber },
      { label: LABEL.buyer, value: (r) => r.buyerName },
      { label: LABEL.listing, value: (r) => r.unit },
      { label: LABEL.project, value: (r) => r.project },
      { label: LABEL.agent, value: (r) => r.agentName },
      { label: "Agreed", align: "right", value: (r) => kes(r.agreedPrice) },
      { label: "Paid", align: "right", value: (r) => kes(r.paid) },
      { label: "Balance", align: "right", value: (r) => kes(r.balance) },
      { label: "Status", value: (r) => fmtLabel(r.status) },
    ],
    rows,
    totalsRow: ["TOTAL", "", `${rows.length} ${LABEL.deal.toLowerCase()}s`, "", "", "", kes(money(agreedC)), kes(money(paidC)), kes(money(balanceC)), ""],
  };
};

// ── Commissions ───────────────────────────────────────────────────────────────────────────────────
const commissionsReport = async (business, req) => {
  const { agentId = "", status = "", dateFrom = "", dateTo = "" } = req.query;
  const filter = { business };
  if (agentId) filter.agent = agentId;
  if (status) filter.status = status;
  else filter.status = { $nin: ["cancelled", "reversed"] };
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo + "T23:59:59.999Z");
  }
  assertWithinCap(await SaleCommission.countDocuments(filter), "Commissions");
  const rows = await populateCommission(SaleCommission.find(filter).sort({ createdAt: -1 })).lean();
  const sum = (key) => rows.reduce((s, c) => s + Number(c[key] || 0), 0);

  return {
    subtitle: [status && `Status: ${fmtLabel(status)}`, (dateFrom || dateTo) && `${dateFrom ? fmtDate(dateFrom) : "…"} – ${dateTo ? fmtDate(dateTo) : "…"}`, await describeFilters(business, req)].filter(Boolean).join(" · "),
    summaryItems: [["Commissions", String(rows.length)], ["Gross", kes(sum("commissionAmount"))], ["WHT", kes(sum("whtAmount"))], ["Net", kes(rows.reduce((s, c) => s + Number(c.netAmount ?? c.commissionAmount ?? 0), 0))]],
    columns: [
      { label: "Comm. No.", value: (c) => c.commissionNumber },
      { label: LABEL.agent, value: (c) => c.agent?.fullName || "—" },
      { label: LABEL.deal, value: (c) => c.deal?.dealNumber || "—" },
      { label: "Property", value: (c) => c.listing?.title || c.listing?.listingNumber || "—" },
      { label: "Rate", value: (c) => `${c.commissionRate}${c.commissionType === "percentage" ? "%" : " KES"}` },
      { label: "Gross", align: "right", value: (c) => kes(c.commissionAmount) },
      { label: "WHT", align: "right", value: (c) => (c.whtAmount > 0 ? kes(c.whtAmount) : "—") },
      { label: "Net", align: "right", value: (c) => kes(c.netAmount ?? c.commissionAmount) },
      { label: "Status", value: (c) => fmtLabel(c.status) },
    ],
    rows,
    totalsRow: ["TOTAL", `${rows.length} commissions`, "", "", "", kes(sum("commissionAmount")), kes(sum("whtAmount")), kes(rows.reduce((s, c) => s + Number(c.netAmount ?? c.commissionAmount ?? 0), 0)), ""],
  };
};

// id -> { title, kicker, permission, build(business, req) }. Each `title` doubles as the PDF document
// title; `permission` names the access-control resource the viewing endpoint's own route already
// requires for that report's JSON data (see routes/reports.js and routes/commissions.js), so the one
// shared PDF route can enforce the right check per report instead of one blanket permission for all.
export const SALE_REPORTS = {
  receivables:  { title: "Receivables Aging",  kicker: "Money Owed",       permission: "sale-reports",     build: receivablesReport },
  register:     { title: "Sales Register",     kicker: "Sales & Pipeline", permission: "sale-reports",     build: registerReport },
  commissions:  { title: "Commissions",        kicker: "Agents & Commission", permission: "sale-commissions", build: commissionsReport },
};
