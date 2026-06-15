import mongoose from "mongoose";
import SaleListing   from "../models/SaleListing.js";
import SaleDeal      from "../models/SaleDeal.js";
import SalePayment   from "../models/SalePayment.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOffer     from "../models/SaleOffer.js";
import SaleLead      from "../models/SaleLead.js";
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
