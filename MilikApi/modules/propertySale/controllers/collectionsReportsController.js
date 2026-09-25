// Money-owed and sales-register reports for Property Sales:
//   receivables      - what each buyer still owes, aged by how late the unpaid instalments are
//   overdue          - the follow-up list: every unpaid instalment past its due date, oldest first
//   register         - every deal with price, discount, paid and balance, filterable
// Only active deals count toward money owed (a cancelled deal owes nothing). A company that keeps agents to their own
// deals (req.saleAgentId) only ever sees those deals here, exactly like the deal list.
import mongoose from "mongoose";
import SaleDeal from "../models/SaleDeal.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import SalePayment from "../models/SalePayment.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import SaleProject from "../models/SaleProject.js";
import { escapeRegex, resolveActiveBusinessId } from "../services/businessScope.js";
import { createError } from "../../../utils/error.js";

const DAY = 86_400_000;
const MAX_EXPORT = 5000;
const OPEN_INSTALLMENT = ["upcoming", "overdue"];
const BUCKETS = ["notDue", "d1_30", "d31_60", "d61_90", "d90plus"];
const cents = (n) => Math.round(Number(n || 0) * 100);
const money = (c) => c / 100;
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

const paging = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_EXPORT);
  return { page, limit };
};

const asOfDate = (req) => {
  if (!req.query.asOf) return new Date();
  const d = new Date(req.query.asOf);
  if (Number.isNaN(d.getTime())) throw createError(400, "Invalid asOf date.");
  d.setHours(23, 59, 59, 999);
  return d;
};

// Filter on deals from the query string: project, agent, status, deal-date window, and the agent-visibility scope.
const buildDealFilter = async (req, business, { statuses } = {}) => {
  const { projectId, agentId, status, dateFrom, dateTo } = req.query;
  const filter = { business: oid(business) };
  if (statuses) filter.status = { $in: statuses };
  else if (status) filter.status = String(status);
  if (req.saleAgentId) filter.agent = oid(req.saleAgentId);
  else if (agentId) {
    if (!isId(agentId)) throw createError(400, "Invalid agent.");
    filter.agent = oid(agentId);
  }
  if (projectId) {
    if (!isId(projectId)) throw createError(400, "Invalid project.");
    filter.listing = { $in: await SaleListing.distinct("_id", { business, project: projectId }) };
  }
  if (dateFrom || dateTo) {
    filter.dealDate = {};
    if (dateFrom) filter.dealDate.$gte = new Date(dateFrom);
    if (dateTo) filter.dealDate.$lte = new Date(`${dateTo}T23:59:59.999Z`);
  }
  return filter;
};

// Names for the ids on a set of deals, fetched once each (no per-row lookups)
const loadNames = async (business, deals) => {
  const ids = (key) => [...new Set(deals.map((d) => d[key]).filter(Boolean).map(String))];
  const [buyers, listings, agents] = await Promise.all([
    SaleBuyer.find({ business, _id: { $in: ids("buyer") } }).select("fullName phone buyerNumber").lean(),
    SaleListing.find({ business, _id: { $in: ids("listing") } }).select("title unitNumber listingNumber project askingPrice titleDeedNumber").lean(),
    SaleAgent.find({ business, _id: { $in: ids("agent") } }).select("fullName").lean(),
  ]);
  const projectIds = [...new Set(listings.map((l) => l.project).filter(Boolean).map(String))];
  const projects = projectIds.length ? await SaleProject.find({ business, _id: { $in: projectIds } }).select("name projectNumber").lean() : [];
  const by = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  return { buyers: by(buyers), listings: by(listings), agents: by(agents), projects: by(projects) };
};

const dealLabels = (deal, names) => {
  const listing = names.listings.get(String(deal.listing));
  const project = listing?.project ? names.projects.get(String(listing.project)) : null;
  const buyer = names.buyers.get(String(deal.buyer));
  return {
    dealNumber: deal.dealNumber,
    buyerName: buyer?.fullName || "",
    buyerPhone: buyer?.phone || "",
    unit: listing ? [listing.unitNumber ? `Unit ${listing.unitNumber}` : "", listing.title].filter(Boolean).join(" · ") : "",
    project: project?.name || "",
    agentName: names.agents.get(String(deal.agent))?.fullName || "",
  };
};

const paidByDeal = async (business, dealIds) => {
  if (!dealIds.length) return new Map();
  const rows = await SalePayment.aggregate([
    { $match: { business: oid(business), deal: { $in: dealIds }, status: "paid" } },
    { $group: { _id: "$deal", paid: { $sum: "$amount" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.paid]));
};

// days late -> bucket name (0 or less: not yet due)
const bucketOf = (daysLate) =>
  daysLate <= 0 ? "notDue" : daysLate <= 30 ? "d1_30" : daysLate <= 60 ? "d31_60" : daysLate <= 90 ? "d61_90" : "d90plus";

// Same buckets as bucketOf, expressed as plain date comparisons against thresholds worked out once here:
// floor((asOf - due) / day) <= N  <=>  due > asOf - (N + 1) days.
const bucketExpr = (asOf) => {
  const after = (days) => new Date(asOf.getTime() - days * DAY);
  return {
    $switch: {
      branches: [
        { case: { $gt: ["$dueDate", after(1)] }, then: "notDue" },
        { case: { $gt: ["$dueDate", after(31)] }, then: "d1_30" },
        { case: { $gt: ["$dueDate", after(61)] }, then: "d31_60" },
        { case: { $gt: ["$dueDate", after(91)] }, then: "d61_90" },
      ],
      default: "d90plus",
    },
  };
};

/** Balance owed per deal (agreed price - paid), split into not-yet-due and overdue buckets by unpaid instalment. */
export const getReceivables = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const asOf = asOfDate(req);
    const { page, limit } = paging(req);
    const deals = await SaleDeal.find(await buildDealFilter(req, business, { statuses: ["active", "closed"] }))
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

    const totalsC = { balance: 0, unscheduled: 0, overdue: 0, ...Object.fromEntries(BUCKETS.map((b) => [b, 0])) };
    const rows = [];
    for (const deal of deals) {
      const balanceC = cents(deal.agreedPrice) - cents(paid.get(String(deal._id)));
      if (balanceC <= 0) continue; // fully paid
      const entry = perDeal.get(String(deal._id)) || { buckets: {}, oldest: null };
      const scheduledC = BUCKETS.reduce((s, b) => s + (entry.buckets[b] || 0), 0);
      // what is owed but has no instalment date: it has no due date to age, so it is shown apart
      const unscheduledC = Math.max(balanceC - scheduledC, 0);
      const overdueC = BUCKETS.filter((b) => b !== "notDue").reduce((s, b) => s + (entry.buckets[b] || 0), 0);
      const row = {
        _id: deal._id,
        _deal: deal,
        dealDate: deal.dealDate,
        status: deal.status,
        agreedPrice: deal.agreedPrice,
        paid: money(cents(paid.get(String(deal._id)))),
        balance: money(balanceC),
        unscheduled: money(unscheduledC),
        overdue: money(overdueC),
        oldestDue: entry.oldest,
        daysLate: entry.oldest ? Math.max(Math.floor((asOf - entry.oldest) / DAY), 0) : 0,
        ...Object.fromEntries(BUCKETS.map((b) => [b, money(entry.buckets[b] || 0)])),
      };
      if (req.query.overdueOnly === "1" && overdueC === 0) continue;
      rows.push(row);
      totalsC.balance += balanceC; totalsC.unscheduled += unscheduledC; totalsC.overdue += overdueC;
      for (const b of BUCKETS) totalsC[b] += entry.buckets[b] || 0;
    }
    rows.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);

    const pageRows = rows.slice((page - 1) * limit, page * limit);
    const names = await loadNames(business, pageRows.map((r) => r._deal));
    const data = pageRows.map(({ _deal, ...row }) => ({ ...dealLabels(_deal, names), ...row }));

    res.status(200).json({
      data,
      total: rows.length,
      page,
      pages: Math.max(Math.ceil(rows.length / limit), 1),
      asOf,
      totals: { ...Object.fromEntries(Object.entries(totalsC).map(([k, v]) => [k, money(v)])), deals: rows.length },
    });
  } catch (err) {
    next(err);
  }
};

/** Unpaid instalments past their due date (active deals only), oldest first, with buyer contact for follow-up. */
export const getOverdueInstallments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const asOf = asOfDate(req);
    const { page, limit } = paging(req);
    const minDays = Math.max(parseInt(req.query.minDays, 10) || 0, 0);
    const dealIds = await SaleDeal.distinct("_id", await buildDealFilter(req, business, { statuses: ["active"] }));
    const latest = new Date(asOf.getTime() - minDays * DAY);
    const match = { business: oid(business), deal: { $in: dealIds }, status: { $in: OPEN_INSTALLMENT }, dueDate: { $lt: minDays ? latest : asOf } };

    const [totalsRows, items] = await Promise.all([
      SalePaymentSchedule.aggregate([
        { $match: match },
        { $group: { _id: bucketExpr(asOf), count: { $sum: 1 }, amount: { $sum: "$expectedAmount" } } },
      ]),
      SalePaymentSchedule.find(match).sort({ dueDate: 1, installmentNumber: 1 }).skip((page - 1) * limit).limit(limit)
        .select("deal installmentNumber dueDate expectedAmount description").lean(),
    ]);

    const deals = await SaleDeal.find({ business, _id: { $in: [...new Set(items.map((i) => String(i.deal)))] } })
      .select("dealNumber buyer listing agent").lean();
    const dealById = new Map(deals.map((d) => [String(d._id), d]));
    const names = await loadNames(business, deals);
    const data = items.map((i) => {
      const deal = dealById.get(String(i.deal));
      const daysLate = Math.max(Math.floor((asOf - i.dueDate) / DAY), 0);
      return {
        _id: i._id,
        dealId: i.deal,
        ...(deal ? dealLabels(deal, names) : {}),
        installmentNumber: i.installmentNumber,
        description: i.description,
        dueDate: i.dueDate,
        daysLate,
        bucket: bucketOf(daysLate),
        amount: i.expectedAmount,
      };
    });

    const byBucket = Object.fromEntries(BUCKETS.filter((b) => b !== "notDue").map((b) => [b, { count: 0, amount: 0 }]));
    let count = 0; let totalC = 0;
    for (const r of totalsRows) {
      if (!byBucket[r._id]) continue;
      byBucket[r._id] = { count: r.count, amount: money(cents(r.amount)) };
      count += r.count; totalC += cents(r.amount);
    }
    res.status(200).json({
      data,
      total: count,
      page,
      pages: Math.max(Math.ceil(count / limit), 1),
      asOf,
      totals: { count, amount: money(totalC), buckets: byBucket },
    });
  } catch (err) {
    next(err);
  }
};

/** Every deal in the filter with price, discount off the asking price, paid and balance. */
export const getSalesRegister = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { page, limit } = paging(req);
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

    // Totals cover the whole filter, not just this page, and are worked out in the database: each deal's paid amount
    // comes from an indexed lookup (business + deal + status), then deals are grouped by status. Paid money on a
    // cancelled deal is not a receivable, so cancelled deals add to "paid" but not to "agreed" or "balance".
    const [deals, total, totalsByStatus] = await Promise.all([
      SaleDeal.find(filter).sort({ dealDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
        .select("dealNumber buyer listing agent agreedPrice dealDate status actualClosingDate titleTransferDate").lean(),
      SaleDeal.countDocuments(filter),
      SaleDeal.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: SalePayment.collection.name,
            let: { dealId: "$_id" },
            pipeline: [
              { $match: { business: oid(business), $expr: { $and: [{ $eq: ["$deal", "$$dealId"] }, { $eq: ["$status", "paid"] }] } } },
              { $group: { _id: null, paid: { $sum: "$amount" } } },
            ],
            as: "pay",
          },
        },
        { $addFields: { paidAmount: { $ifNull: [{ $arrayElemAt: ["$pay.paid", 0] }, 0] } } },
        {
          $group: {
            _id: "$status",
            deals: { $sum: 1 },
            agreed: { $sum: "$agreedPrice" },
            paid: { $sum: "$paidAmount" },
            balance: { $sum: { $max: [0, { $subtract: ["$agreedPrice", "$paidAmount"] }] } },
          },
        },
      ]),
    ]);
    const [pagePaid, names] = await Promise.all([paidByDeal(business, deals.map((d) => d._id)), loadNames(business, deals)]);

    const totalsC = { agreed: 0, paid: 0, balance: 0, cancelled: 0 };
    for (const row of totalsByStatus) {
      totalsC.paid += cents(row.paid);
      if (row._id === "cancelled") { totalsC.cancelled += row.deals; continue; }
      totalsC.agreed += cents(row.agreed); totalsC.balance += cents(row.balance);
    }

    const data = deals.map((d) => {
      const listing = names.listings.get(String(d.listing));
      const paidC = cents(pagePaid.get(String(d._id)));
      return {
        _id: d._id,
        ...dealLabels(d, names),
        dealDate: d.dealDate,
        status: d.status,
        askingPrice: listing?.askingPrice ?? null,
        agreedPrice: d.agreedPrice,
        discount: listing?.askingPrice != null ? money(cents(listing.askingPrice) - cents(d.agreedPrice)) : null,
        paid: money(paidC),
        balance: d.status === "cancelled" ? 0 : money(Math.max(cents(d.agreedPrice) - paidC, 0)),
        closingDate: d.actualClosingDate,
        titleTransferDate: d.titleTransferDate,
      };
    });

    res.status(200).json({
      data,
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      totals: { deals: total, cancelled: totalsC.cancelled, agreed: money(totalsC.agreed), paid: money(totalsC.paid), balance: money(totalsC.balance) },
    });
  } catch (err) {
    next(err);
  }
};
