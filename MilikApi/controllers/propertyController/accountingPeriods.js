import AccountingPeriod from "../../models/AccountingPeriod.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { toObjectId } from "../../utils/db.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";
import {
  closeFiscalYear,
  closePeriod,
  createPeriod,
  deletePeriod,
  endPostingWindow,
  openPostingWindow,
  generateFiscalYear,
  listPeriods,
  lockPeriod,
  periodChecklist,
  reopenPeriod,
  updatePeriod,
  yearCloseChecklist,
} from "../../services/accountingPeriodService.js";

const withBusiness = (handler) => async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));
    await handler(req, res, businessId);
  } catch (err) {
    next(err);
  }
};

// Periods grouped by fiscal year, with ledger activity and the date gaps between them.
export const getAccountingPeriods = withBusiness(async (req, res, businessId) => {
  res.status(200).json(await listPeriods(businessId));
});

export const getAccountingPeriod = withBusiness(async (req, res, businessId) => {
  const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId }).lean();
  if (!period) throw createError(404, "Period not found");
  res.status(200).json(period);
});

export const createAccountingPeriod = withBusiness(async (req, res, businessId) => {
  const { name, startDate, endDate, notes } = req.body || {};
  res.status(201).json(await createPeriod({ businessId, name, startDate, endDate, notes, user: req.user, req }));
});

export const generateAccountingYear = withBusiness(async (req, res, businessId) => {
  res.status(201).json(await generateFiscalYear({ businessId, fiscalYearStart: req.body?.fiscalYearStart, user: req.user, req }));
});

export const updateAccountingPeriod = withBusiness(async (req, res, businessId) => {
  const { name, notes, startDate, endDate } = req.body || {};
  res.status(200).json(await updatePeriod({ businessId, id: req.params.id, name, notes, startDate, endDate, user: req.user, req }));
});

export const deleteAccountingPeriod = withBusiness(async (req, res, businessId) => {
  await deletePeriod({ businessId, id: req.params.id, req });
  res.status(200).json({ message: "Period deleted" });
});

export const getAccountingPeriodChecklist = withBusiness(async (req, res, businessId) => {
  res.status(200).json(await periodChecklist({ businessId, id: req.params.id }));
});

export const closeAccountingPeriod = withBusiness(async (req, res, businessId) => {
  const period = await closePeriod({ businessId, id: req.params.id, user: req.user, req });
  res.status(200).json({ message: "Period closed", period });
});

export const reopenAccountingPeriod = withBusiness(async (req, res, businessId) => {
  const period = await reopenPeriod({ businessId, id: req.params.id, reason: req.body?.reason, user: req.user, req });
  res.status(200).json({ message: "Period reopened", period });
});

export const lockAccountingPeriod = withBusiness(async (req, res, businessId) => {
  const period = await lockPeriod({ businessId, id: req.params.id, user: req.user, req });
  res.status(200).json({ message: "Period locked permanently", period });
});

export const openAccountingPostingWindow = withBusiness(async (req, res, businessId) => {
  const { minutes, reason } = req.body || {};
  const period = await openPostingWindow({ businessId, id: req.params.id, minutes, reason, user: req.user, req });
  res.status(200).json({ message: "Posting window opened", period });
});

export const endAccountingPostingWindow = withBusiness(async (req, res, businessId) => {
  const period = await endPostingWindow({ businessId, id: req.params.id, user: req.user, req });
  res.status(200).json({ message: "Posting window ended", period });
});

export const getYearCloseChecklist = withBusiness(async (req, res, businessId) => {
  res.status(200).json(await yearCloseChecklist({ businessId, fiscalYearStart: req.query.fiscalYearStart }));
});

export const closeAccountingYear = withBusiness(async (req, res, businessId) => {
  res.status(200).json(await closeFiscalYear({ businessId, fiscalYearStart: req.body?.fiscalYearStart, user: req.user, req }));
});

// Entry counts and totals for one period.
export const getAccountingPeriodStats = withBusiness(async (req, res, businessId) => {
  const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId }).lean();
  if (!period) throw createError(404, "Period not found");

  const [stats] = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: toObjectId(businessId),
        transactionDate: { $gte: period.startDate, $lte: period.endDate },
        status: { $in: ["approved", "reversed"] },
      },
    },
    {
      $group: {
        _id: null,
        totalEntries: { $sum: 1 },
        totalDebits: { $sum: "$debit" },
        totalCredits: { $sum: "$credit" },
        approvedCount: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
        reversedCount: { $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] } },
      },
    },
  ]).allowDiskUse(true);

  res.status(200).json({
    period,
    stats: stats || { totalEntries: 0, totalDebits: 0, totalCredits: 0, approvedCount: 0, reversedCount: 0 },
  });
});
