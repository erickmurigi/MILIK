import mongoose from "mongoose";
import SaleListing        from "../models/SaleListing.js";
import SaleDeal           from "../models/SaleDeal.js";
import SalePayment        from "../models/SalePayment.js";
import SaleCommission     from "../models/SaleCommission.js";
import SaleOffer          from "../models/SaleOffer.js";
import SaleLead           from "../models/SaleLead.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";

export const getDashboardStats = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));

    const now = new Date();
    const [listingStats, dealStats, paymentStats, commissionStats, leadStats, overdueLeads, recentDeals, recentListings] = await Promise.all([
      SaleListing.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      SaleDeal.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 }, totalValue: { $sum: "$agreedPrice" } } },
      ]),
      SalePayment.aggregate([
        { $match: { business: bId, status: "paid" } },
        { $group: { _id: null, totalCollected: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      SaleCommission.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", totalAmount: { $sum: "$commissionAmount" } } },
      ]),
      SaleLead.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      SaleLead.countDocuments({
        business: bId,
        status: { $nin: ["converted", "lost"] },
        nextFollowUpDate: { $lt: now },
      }),
      SaleDeal.find({ business })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("listing", "title listingNumber propertyType")
        .populate("buyer", "fullName buyerNumber")
        .lean(),
      SaleListing.find({ business, status: { $in: ["available", "reserved"] } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("assignedAgent", "fullName")
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
      recentListings,
    });
  } catch (err) {
    next(err);
  }
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const getSalesReport = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const year = Number(req.query.year) || new Date().getFullYear();

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    const [listings, offers, deals, payments, commissions] = await Promise.all([
      SaleListing.find({ business, createdAt: { $gte: yearStart, $lt: yearEnd } }).select("createdAt").lean(),
      SaleOffer.find({ business, createdAt: { $gte: yearStart, $lt: yearEnd } }).select("createdAt").lean(),
      SaleDeal.find({
        business,
        $or: [
          { dealDate: { $gte: yearStart, $lt: yearEnd } },
          { createdAt: { $gte: yearStart, $lt: yearEnd } },
        ],
      }).select("status agreedPrice dealDate actualClosingDate createdAt updatedAt").lean(),
      SalePayment.find({ business, status: "paid", paymentDate: { $gte: yearStart, $lt: yearEnd } })
        .select("amount paymentDate").lean(),
      SaleCommission.find({ business, status: { $in: ["approved", "paid"] }, updatedAt: { $gte: yearStart, $lt: yearEnd } })
        .select("commissionAmount updatedAt").lean(),
    ]);

    const inMonth = (date, monthStart, monthEnd) => {
      const d = new Date(date);
      return d >= monthStart && d < monthEnd;
    };

    const months = Array.from({ length: 12 }, (_, i) => {
      const monthStart = new Date(year, i, 1);
      const monthEnd = new Date(year, i + 1, 1);

      const mListings = listings.filter((l) => inMonth(l.createdAt, monthStart, monthEnd)).length;
      const mOffers = offers.filter((o) => inMonth(o.createdAt, monthStart, monthEnd)).length;
      const mDealsActive = deals.filter(
        (d) => d.status === "active" && inMonth(d.dealDate || d.createdAt, monthStart, monthEnd)
      ).length;
      const mDealsClosed = deals.filter(
        (d) => d.status === "closed" && inMonth(d.actualClosingDate || d.updatedAt, monthStart, monthEnd)
      ).length;
      const mRevenue = payments
        .filter((p) => inMonth(p.paymentDate, monthStart, monthEnd))
        .reduce((sum, p) => sum + (p.amount || 0), 0);
      const mCommissions = commissions
        .filter((c) => inMonth(c.updatedAt, monthStart, monthEnd))
        .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);

      return {
        month: i + 1,
        monthName: MONTH_NAMES[i],
        listings: mListings,
        offers: mOffers,
        dealsActive: mDealsActive,
        dealsClosed: mDealsClosed,
        revenue: mRevenue,
        commissionsApproved: mCommissions,
      };
    });

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

export const getCashFlowForecast = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId      = new mongoose.Types.ObjectId(String(business));
    const now      = new Date();

    const d30  = new Date(now); d30.setDate(d30.getDate() + 30);
    const d60  = new Date(now); d60.setDate(d60.getDate() + 60);
    const d90  = new Date(now); d90.setDate(d90.getDate() + 90);

    const allItems = await SalePaymentSchedule.find({
      business: bId,
      status: { $in: ["upcoming", "overdue"] },
    })
      .populate({
        path: "deal",
        select: "dealNumber agreedPrice totalPaid",
        populate: [
          { path: "listing", select: "title listingNumber" },
          { path: "buyer",   select: "fullName phone" },
        ],
      })
      .sort({ dueDate: 1 })
      .lean();

    const bucket = (item) => {
      const due = new Date(item.dueDate);
      if (due < now)   return "overdue";
      if (due <= d30)  return "next30";
      if (due <= d60)  return "next60";
      if (due <= d90)  return "next90";
      return "beyond90";
    };

    const buckets = { overdue: [], next30: [], next60: [], next90: [], beyond90: [] };
    for (const item of allItems) buckets[bucket(item)].push(item);

    const summarise = (items) => ({
      count:  items.length,
      amount: items.reduce((s, i) => s + Number(i.expectedAmount || 0), 0),
      items,
    });

    res.status(200).json({
      overdue:   summarise(buckets.overdue),
      next30:    summarise(buckets.next30),
      next60:    summarise(buckets.next60),
      next90:    summarise(buckets.next90),
      beyond90:  summarise(buckets.beyond90),
      totalPipeline: allItems.reduce((s, i) => s + Number(i.expectedAmount || 0), 0),
    });
  } catch (err) {
    next(err);
  }
};

export const getConversionFunnel = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId      = new mongoose.Types.ObjectId(String(business));

    const [leadStats, offerStats, dealStats] = await Promise.all([
      SaleLead.aggregate([{ $match: { business: bId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      SaleOffer.aggregate([{ $match: { business: bId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      SaleDeal.aggregate([{ $match: { business: bId } }, { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$agreedPrice" } } }]),
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
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Math.min(12, Math.max(1, Number(req.query.month) || 1));

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    const [listings, offers, deals, payments, commissions] = await Promise.all([
      SaleListing.find({ business, createdAt: { $gte: monthStart, $lt: monthEnd } })
        .populate("assignedAgent", "fullName agentNumber")
        .select("listingNumber title propertyType askingPrice status location createdAt")
        .sort({ createdAt: -1 })
        .lean(),

      SaleOffer.find({ business, createdAt: { $gte: monthStart, $lt: monthEnd } })
        .populate("listing", "title listingNumber askingPrice")
        .populate("buyer", "fullName buyerNumber")
        .populate("agent", "fullName agentNumber")
        .select("offerNumber offerAmount counterOfferAmount status validityDate createdAt")
        .sort({ createdAt: -1 })
        .lean(),

      SaleDeal.find({
        business,
        $or: [
          { dealDate: { $gte: monthStart, $lt: monthEnd } },
          { createdAt: { $gte: monthStart, $lt: monthEnd } },
        ],
      })
        .populate("listing", "title listingNumber propertyType")
        .populate("buyer", "fullName buyerNumber phone")
        .populate("agent", "fullName agentNumber")
        .select("dealNumber agreedPrice status dealDate actualClosingDate notes createdAt")
        .sort({ dealDate: -1 })
        .lean(),

      SalePayment.find({ business, status: "paid", paymentDate: { $gte: monthStart, $lt: monthEnd } })
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

      SaleCommission.find({ business, updatedAt: { $gte: monthStart, $lt: monthEnd } })
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
      listings,
      offers,
      deals,
      payments,
      commissions,
      summary: {
        listings: listings.length,
        offers: offers.length,
        deals: deals.length,
        dealsClosed: deals.filter((d) => d.status === "closed").length,
        payments: payments.length,
        totalRevenue,
        totalCommissions,
      },
    });
  } catch (err) {
    next(err);
  }
};
