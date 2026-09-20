import mongoose from "mongoose";
import SaleListing        from "../models/SaleListing.js";
import SaleDeal           from "../models/SaleDeal.js";
import SalePayment        from "../models/SalePayment.js";
import SaleCommission     from "../models/SaleCommission.js";
import SaleOffer          from "../models/SaleOffer.js";
import SaleLead, { LEAD_STATUSES } from "../models/SaleLead.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { ownDealIds } from "../middleware/agentScope.js";
import { PROJECT_WITH_AGENT, withEffectiveAgent } from "../services/listingAgent.js";

// Filter fragments restricting each report figure to the caller's own records when the company keeps agents to
// their own data (req.saleAgentId); all empty otherwise. Listings and buyers stay business-wide. Ids are real
// ObjectIds because aggregate() does not cast. Payments and installments follow the agent's deals.
const reportScope = async (req, business) => {
  if (!req.saleAgentId) return { deal: {}, offer: {}, lead: {}, commission: {}, dealChild: {} };
  const agent = new mongoose.Types.ObjectId(String(req.saleAgentId));
  return {
    deal: { agent },
    offer: { agent },
    lead: { assignedAgent: agent },
    commission: { agent },
    dealChild: { deal: { $in: await ownDealIds(req, business) } },
  };
};

export const getDashboardStats = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const sc = await reportScope(req, business);
    const bId = new mongoose.Types.ObjectId(String(business));

    const now = new Date();
    const [listingStats, dealStats, paymentStats, commissionStats, leadStats, overdueLeads, recentDeals, recentListings] = await Promise.all([
      SaleListing.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      SaleDeal.aggregate([
        { $match: { business: bId, ...sc.deal } },
        { $group: { _id: "$status", count: { $sum: 1 }, totalValue: { $sum: "$agreedPrice" } } },
      ]),
      SalePayment.aggregate([
        { $match: { business: bId, ...sc.dealChild, status: "paid" } },
        { $group: { _id: null, totalCollected: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      SaleCommission.aggregate([
        { $match: { business: bId, ...sc.commission } },
        { $group: { _id: "$status", totalAmount: { $sum: "$commissionAmount" } } },
      ]),
      SaleLead.aggregate([
        { $match: { business: bId, ...sc.lead } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      SaleLead.countDocuments({
        business: bId, ...sc.lead,
        status: { $nin: ["converted", "lost"] },
        nextFollowUpDate: { $lt: now },
      }),
      SaleDeal.find({ business, ...sc.deal })
        .select("-documents") // uploaded-document metadata is only needed by the deal detail (getDeal)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("listing", "title listingNumber propertyType")
        .populate("buyer", "fullName buyerNumber")
        .lean(),
      SaleListing.find({ business, status: { $in: ["available", "reserved"] } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("assignedAgent", "fullName")
        .populate(PROJECT_WITH_AGENT)
        .lean(),
    ]);

    const listingMap    = Object.fromEntries(listingStats.map((s) => [s._id, s.count]));
    const dealMap       = Object.fromEntries(dealStats.map((s) => [s._id, { count: s.count, value: s.totalValue }]));
    const commissionMap = Object.fromEntries(commissionStats.map((s) => [s._id, s.totalAmount]));
    const leadMap       = Object.fromEntries(leadStats.map((s) => [s._id, s.count]));
    const activeLeads   = (leadMap.new || 0) + (leadMap.contacted || 0) + (leadMap.qualified || 0) +
                          (leadMap.site_visited || 0) + (leadMap.proposal_sent || 0) + (leadMap.negotiating || 0);

    res.status(200).json({
      listings: {
        available: listingMap.available || 0,
        reserved: listingMap.reserved || 0,
        underContract: listingMap.under_contract || 0,
        sold: listingMap.sold || 0,
        total: Object.values(listingMap).reduce((a, b) => a + b, 0),
      },
      deals: {
        active: dealMap.active?.count || 0,
        closed: dealMap.closed?.count || 0,
        cancelled: dealMap.cancelled?.count || 0,
        activeValue: dealMap.active?.value || 0,
        closedValue: dealMap.closed?.value || 0,
      },
      payments: {
        totalCollected: paymentStats[0]?.totalCollected || 0,
        count: paymentStats[0]?.count || 0,
      },
      commissions: {
        pending: commissionMap.pending || 0,
        approved: commissionMap.approved || 0,
        paid: commissionMap.paid || 0,
      },
      leads: {
        new:          leadMap.new          || 0,
        contacted:    leadMap.contacted    || 0,
        qualified:    leadMap.qualified    || 0,
        siteVisited:  leadMap.site_visited || 0,
        proposalSent: leadMap.proposal_sent || 0,
        negotiating:  leadMap.negotiating  || 0,
        converted:    leadMap.converted    || 0,
        lost:         leadMap.lost         || 0,
        active:       activeLeads,
        overdue:      overdueLeads,
        total:        Object.values(leadMap).reduce((a, b) => a + b, 0),
      },
      recentDeals,
      recentListings: recentListings.map(withEffectiveAgent),
    });
  } catch (err) {
    next(err);
  }
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const getSalesReport = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const sc = await reportScope(req, business);
    const bId = new mongoose.Types.ObjectId(String(business));
    const year = Number(req.query.year) || new Date().getFullYear();

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    // 13 local-time month boundaries (same as the previous in-memory passes): month i = [start_i, start_i+1)
    const boundaries = Array.from({ length: 13 }, (_, i) => new Date(year, i, 1));

    // Buckets a date expression into the 12 months server-side; values outside the window fall into "out" (ignored).
    const bucketByMonth = (Model, match, dateExpr, sumField) =>
      Model.aggregate([
        { $match: match },
        {
          $bucket: {
            groupBy: dateExpr,
            boundaries,
            default: "out",
            output: { count: { $sum: 1 }, ...(sumField && { amount: { $sum: `$${sumField}` } }) },
          },
        },
      ]);

    // Deals: same pre-filter as before (a superset of both metrics' windows), then per-status month buckets.
    // Active -> dealDate || createdAt; closed -> actualClosingDate || updatedAt (legacy closed deals).
    const dealMonthly = (status, dateExpr) => [
      { $match: { status } },
      { $bucket: { groupBy: dateExpr, boundaries, default: "out", output: { count: { $sum: 1 } } } },
    ];

    const [listingRows, offerRows, dealRows, paymentRows, commissionRows] = await Promise.all([
      bucketByMonth(SaleListing, { business: bId, createdAt: { $gte: yearStart, $lt: yearEnd } }, "$createdAt"),
      bucketByMonth(SaleOffer, { business: bId, ...sc.offer, createdAt: { $gte: yearStart, $lt: yearEnd } }, "$createdAt"),
      SaleDeal.aggregate([
        {
          $match: {
            business: bId, ...sc.deal,
            $or: [
              { dealDate: { $gte: yearStart, $lt: yearEnd } },
              { createdAt: { $gte: yearStart, $lt: yearEnd } },
              // Deals closed in-window even if created/dated earlier. The second
              // branch covers legacy closed deals without actualClosingDate, which
              // are classified by updatedAt below.
              { actualClosingDate: { $gte: yearStart, $lt: yearEnd } },
              { status: "closed", actualClosingDate: null, updatedAt: { $gte: yearStart, $lt: yearEnd } },
            ],
          },
        },
        {
          $facet: {
            active: dealMonthly("active", { $ifNull: ["$dealDate", "$createdAt"] }),
            closed: dealMonthly("closed", { $ifNull: ["$actualClosingDate", "$updatedAt"] }),
          },
        },
      ]),
      bucketByMonth(SalePayment, { business: bId, ...sc.dealChild, status: "paid", paymentDate: { $gte: yearStart, $lt: yearEnd } }, "$paymentDate", "amount"),
      bucketByMonth(SaleCommission, { business: bId, ...sc.commission, status: { $in: ["approved", "paid"] }, updatedAt: { $gte: yearStart, $lt: yearEnd } }, "$updatedAt", "commissionAmount"),
    ]);

    // Bucket rows are keyed by their lower boundary date -> month index 0-11
    const boundaryTimes = boundaries.map((d) => d.getTime());
    const toMonthMap = (rows) => {
      const out = new Array(12).fill(null);
      for (const r of rows) {
        const idx = r._id instanceof Date ? boundaryTimes.indexOf(r._id.getTime()) : -1;
        if (idx >= 0 && idx < 12) out[idx] = r;
      }
      return out;
    };
    const listingsByMonth    = toMonthMap(listingRows);
    const offersByMonth      = toMonthMap(offerRows);
    const dealsActiveByMonth = toMonthMap(dealRows[0]?.active ?? []);
    const dealsClosedByMonth = toMonthMap(dealRows[0]?.closed ?? []);
    const paymentsByMonth    = toMonthMap(paymentRows);
    const commissionsByMonth = toMonthMap(commissionRows);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthName: MONTH_NAMES[i],
      listings: listingsByMonth[i]?.count || 0,
      offers: offersByMonth[i]?.count || 0,
      dealsActive: dealsActiveByMonth[i]?.count || 0,
      dealsClosed: dealsClosedByMonth[i]?.count || 0,
      revenue: paymentsByMonth[i]?.amount || 0,
      commissionsApproved: commissionsByMonth[i]?.amount || 0,
    }));

    const totals = months.reduce(
      (acc, m) => ({
        listings: acc.listings + m.listings,
        offers: acc.offers + m.offers,
        dealsActive: acc.dealsActive + m.dealsActive,
        dealsClosed: acc.dealsClosed + m.dealsClosed,
        revenue: acc.revenue + m.revenue,
        commissionsApproved: acc.commissionsApproved + m.commissionsApproved,
      }),
      { listings: 0, offers: 0, dealsActive: 0, dealsClosed: 0, revenue: 0, commissionsApproved: 0 }
    );

    res.status(200).json({ year, months, totals });
  } catch (err) {
    next(err);
  }
};

// Max installments returned per cash-flow bucket (bucket count/amount always cover the full set)
const CASH_FLOW_ITEM_CAP = 200;

export const getCashFlowForecast = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const sc = await reportScope(req, business);
    const bId      = new mongoose.Types.ObjectId(String(business));
    const now      = new Date();

    const d30  = new Date(now); d30.setDate(d30.getDate() + 30);
    const d60  = new Date(now); d60.setDate(d60.getDate() + 60);
    const d90  = new Date(now); d90.setDate(d90.getDate() + 90);

    const openStatuses = { $in: ["upcoming", "overdue"] };

    // Bucket ranges on dueDate - identical boundaries to the previous JS bucketing:
    // overdue: due < now; next30: now <= due <= d30; next60: d30 < due <= d60; next90: d60 < due <= d90; beyond90: > d90
    const RANGES = {
      overdue:  { $lt: now },
      next30:   { $gte: now, $lte: d30 },
      next60:   { $gt: d30, $lte: d60 },
      next90:   { $gt: d60, $lte: d90 },
      beyond90: { $gt: d90 },
    };
    const keys = Object.keys(RANGES);

    // Count/amount for EVERY open installment come from one aggregate; only the listed items are capped.
    const [totalsRows, ...itemLists] = await Promise.all([
      SalePaymentSchedule.aggregate([
        { $match: { business: bId, ...sc.dealChild, status: openStatuses } },
        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  { case: { $lt: ["$dueDate", now] },  then: "overdue" },
                  { case: { $lte: ["$dueDate", d30] }, then: "next30" },
                  { case: { $lte: ["$dueDate", d60] }, then: "next60" },
                  { case: { $lte: ["$dueDate", d90] }, then: "next90" },
                ],
                default: "beyond90",
              },
            },
            count: { $sum: 1 },
            amount: { $sum: "$expectedAmount" },
          },
        },
      ]),
      ...keys.map((k) =>
        SalePaymentSchedule.find({ business: bId, ...sc.dealChild, status: openStatuses, dueDate: RANGES[k] })
          .select("deal installmentNumber dueDate expectedAmount description status")
          .populate({
            path: "deal",
            select: "dealNumber",
            populate: [
              { path: "listing", select: "title" },
              { path: "buyer",   select: "fullName" },
            ],
          })
          .sort({ dueDate: 1 })
          .limit(CASH_FLOW_ITEM_CAP)
          .lean()
      ),
    ]);

    const totalsMap = Object.fromEntries(totalsRows.map((r) => [r._id, r]));
    const out = {};
    keys.forEach((k, idx) => {
      const items = itemLists[idx];
      const count = totalsMap[k]?.count || 0;
      // count/amount cover every open installment in the bucket; items is capped (hasMore flags truncation)
      out[k] = { count, amount: totalsMap[k]?.amount || 0, items, hasMore: count > items.length };
    });

    res.status(200).json({
      ...out,
      totalPipeline: keys.reduce((sum, k) => sum + out[k].amount, 0),
    });
  } catch (err) {
    next(err);
  }
};

export const getConversionFunnel = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const sc = await reportScope(req, business);
    const bId      = new mongoose.Types.ObjectId(String(business));

    const [leadStats, offerStats, dealStats] = await Promise.all([
      SaleLead.aggregate([{ $match: { business: bId, ...sc.lead } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      SaleOffer.aggregate([{ $match: { business: bId, ...sc.offer } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      SaleDeal.aggregate([{ $match: { business: bId, ...sc.deal } }, { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$agreedPrice" } } }]),
    ]);

    const lm = Object.fromEntries(leadStats.map((s) => [s._id, s.count]));
    const om = Object.fromEntries(offerStats.map((s) => [s._id, s.count]));
    const dm = Object.fromEntries(dealStats.map((s) => [s._id, { count: s.count, value: s.value }]));

    const totalLeads   = Object.values(lm).reduce((a, b) => a + b, 0);
    const totalOffers  = Object.values(om).reduce((a, b) => a + b, 0);
    const totalDeals   = Object.values(dm).reduce((a, b) => a + b.count, 0);
    const closedDeals  = dm.closed?.count  || 0;
    const closedValue  = dm.closed?.value  || 0;
    const activeDeals  = dm.active?.count  || 0;
    const activeValue  = dm.active?.value  || 0;

    res.status(200).json({
      leads: {
        total:       totalLeads,
        new:         lm.new          || 0,
        contacted:   lm.contacted    || 0,
        qualified:   lm.qualified    || 0,
        siteVisited: lm.site_visited || 0,
        proposalSent: lm.proposal_sent || 0,
        // Leads sitting in a custom pipeline stage from Sale Settings (not one of the built-in statuses)
        other:       Object.entries(lm).reduce((sum, [status, count]) => (LEAD_STATUSES.includes(status) ? sum : sum + count), 0),
        negotiating: lm.negotiating  || 0,
        converted:   lm.converted    || 0,
        lost:        lm.lost         || 0,
      },
      offers: {
        total:       totalOffers,
        pending:     om.pending     || 0,
        negotiating: om.negotiating || 0,
        accepted:    om.accepted    || 0,
        rejected:    om.rejected    || 0,
        expired:     om.expired     || 0,
        withdrawn:   om.withdrawn   || 0,
      },
      deals: {
        total: totalDeals, active: activeDeals, closed: closedDeals,
        cancelled: dm.cancelled?.count || 0,
        activeValue, closedValue,
      },
      rates: {
        leadsToOffers: totalLeads  > 0 ? Math.round((totalOffers / totalLeads)  * 100) : 0,
        offersToDeals: totalOffers > 0 ? Math.round((totalDeals  / totalOffers) * 100) : 0,
        dealsToClose:  totalDeals  > 0 ? Math.round((closedDeals / totalDeals)  * 100) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getMonthlyDetail = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const sc = await reportScope(req, business);
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Math.min(12, Math.max(1, Number(req.query.month) || 1));

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    const [listings, offers, deals, payments, commissions] = await Promise.all([
      SaleListing.find({ business, createdAt: { $gte: monthStart, $lt: monthEnd } })
        .populate("assignedAgent", "fullName agentNumber")
        .populate(PROJECT_WITH_AGENT)
        .select("listingNumber title propertyType askingPrice status location createdAt")
        .sort({ createdAt: -1 })
        .lean(),

      SaleOffer.find({ business, ...sc.offer, createdAt: { $gte: monthStart, $lt: monthEnd } })
        .populate("listing", "title listingNumber askingPrice")
        .populate("buyer", "fullName buyerNumber")
        .populate("agent", "fullName agentNumber")
        .select("offerNumber offerAmount counterOfferAmount status validityDate createdAt")
        .sort({ createdAt: -1 })
        .lean(),

      SaleDeal.find({
        business, ...sc.deal,
        $or: [
          { dealDate: { $gte: monthStart, $lt: monthEnd } },
          { createdAt: { $gte: monthStart, $lt: monthEnd } },
          // Deals closed in this month even if created/dated earlier (legacy
          // closed deals without actualClosingDate fall back to updatedAt)
          { actualClosingDate: { $gte: monthStart, $lt: monthEnd } },
          { status: "closed", actualClosingDate: null, updatedAt: { $gte: monthStart, $lt: monthEnd } },
        ],
      })
        .populate("listing", "title listingNumber propertyType")
        .populate("buyer", "fullName buyerNumber phone")
        .populate("agent", "fullName agentNumber")
        .select("dealNumber agreedPrice status dealDate actualClosingDate notes createdAt updatedAt")
        .sort({ dealDate: -1 })
        .lean(),

      SalePayment.find({ business, ...sc.dealChild, status: "paid", paymentDate: { $gte: monthStart, $lt: monthEnd } })
        .populate({
          path: "deal",
          select: "dealNumber agreedPrice",
          populate: [
            { path: "listing", select: "title listingNumber" },
            { path: "buyer", select: "fullName" },
          ],
        })
        .select("paymentNumber amount paymentType paymentMethod paymentDate reference")
        .sort({ paymentDate: -1 })
        .lean(),

      SaleCommission.find({ business, ...sc.commission, updatedAt: { $gte: monthStart, $lt: monthEnd } })
        .populate("agent", "fullName agentNumber")
        .populate({ path: "deal", select: "dealNumber", populate: { path: "listing", select: "title" } })
        .select("commissionNumber commissionAmount commissionRate commissionType status payoutDate updatedAt")
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalCommissions = commissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0);

    res.status(200).json({
      year,
      month,
      monthName: MONTH_NAMES[month - 1],
      listings: listings.map(withEffectiveAgent),
      offers,
      deals,
      payments,
      commissions,
      summary: {
        listings: listings.length,
        offers: offers.length,
        deals: deals.length,
        // Closed is defined by closing date (same rule as getSalesReport)
        dealsClosed: deals.filter((d) => {
          if (d.status !== "closed") return false;
          const closedAt = new Date(d.actualClosingDate || d.updatedAt);
          return closedAt >= monthStart && closedAt < monthEnd;
        }).length,
        payments: payments.length,
        totalRevenue,
        totalCommissions,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Per-agent performance figures for the all-agents page, computed server-side (two aggregates)
// instead of the client paging through every deal and commission. Semantics match the page:
//   totalDeals = all deals with an agent (any status); closed/active by status;
//   totalRevenue = sum(agreedPrice) of closed deals; commPaid = paid commissions;
//   commPending = pending + approved commissions; closeRate = round(closed / total * 100).
// Agent-scoped users see only their own row (same rule as listDeals/listCommissions).
export const getAgentsPerformance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const agentMatch = req.saleAgentId ? new mongoose.Types.ObjectId(String(req.saleAgentId)) : { $ne: null };

    const [dealRows, commRows] = await Promise.all([
      SaleDeal.aggregate([
        { $match: { business: bId, agent: agentMatch } },
        {
          $group: {
            _id: "$agent",
            totalDeals:   { $sum: 1 },
            closedDeals:  { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
            activeDeals:  { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
            totalRevenue: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, "$agreedPrice", 0] } },
          },
        },
      ]),
      SaleCommission.aggregate([
        { $match: { business: bId, agent: agentMatch } },
        {
          $group: {
            _id: "$agent",
            commPaid:    { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$commissionAmount", 0] } },
            commPending: { $sum: { $cond: [{ $in: ["$status", ["pending", "approved"]] }, "$commissionAmount", 0] } },
          },
        },
      ]),
    ]);

    const byAgent = new Map();
    const row = (id) => {
      const key = String(id);
      if (!byAgent.has(key)) {
        byAgent.set(key, { agentId: key, totalDeals: 0, closedDeals: 0, activeDeals: 0, totalRevenue: 0, commPaid: 0, commPending: 0, closeRate: 0 });
      }
      return byAgent.get(key);
    };
    for (const d of dealRows) {
      Object.assign(row(d._id), {
        totalDeals: d.totalDeals, closedDeals: d.closedDeals, activeDeals: d.activeDeals, totalRevenue: d.totalRevenue,
      });
    }
    for (const c of commRows) Object.assign(row(c._id), { commPaid: c.commPaid, commPending: c.commPending });

    const agents = [...byAgent.values()].map((a) => ({
      ...a,
      closeRate: a.totalDeals > 0 ? Math.round((a.closedDeals / a.totalDeals) * 100) : 0,
    }));

    res.status(200).json({ agents });
  } catch (err) {
    next(err);
  }
};
