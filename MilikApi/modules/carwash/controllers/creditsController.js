import mongoose from 'mongoose';
import CarWashCustomerCredit from '../models/CarWashCustomerCredit.js';
import CarWashCustomer from '../models/CarWashCustomer.js';
import CarWashJob from '../models/CarWashJob.js';
import ChartOfAccount from '../../../models/ChartOfAccount.js';
import Company from '../../../models/Company.js';
import FinancialLedgerEntry from '../../../models/FinancialLedgerEntry.js';
import { createError } from '../../../utils/error.js';
import { currentUserId, escapeRegex, resolveActiveBusinessId } from '../services/businessScope.js';
import {
  postCarWashCreditAppliedLedger,
  postCarWashCreditWriteOffLedger,
  postCarWashCreditRefundLedger,
  reverseCarWashCreditWriteOffLedger,
  postCarWashCustomerCreditCreationLedger,
} from '../services/carwashAccountingService.js';
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig } from '../../../utils/companyModules.js';

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// ─── List active customer credits (with optional dormancy filter) ─────────────
export const listCredits = async (req, res, next) => {
  try {
    const business    = resolveActiveBusinessId(req);
    const businessOid = new mongoose.Types.ObjectId(String(business));
    const status      = req.query.status || 'active';
    const dormantDays = Number(req.query.dormantDays || 0);
    const search      = String(req.query.search || '').trim();
    const sortBy      = String(req.query.sortBy  || 'createdAt');
    const sortDir     = req.query.sortDir === 'desc' ? -1 : 1;

    const filter = { business, status };
    if (dormantDays > 0 && status === 'active') {
      const cutoff = new Date(Date.now() - dormantDays * 86_400_000);
      filter.createdAt = { $lte: cutoff };
    }

    // Pre-query matching customer IDs when searching by name / phone / plate
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      const matchingCustomers = await CarWashCustomer.find(
        { business, $or: [{ name: rx }, { phone: rx }, { plates: rx }] },
        { _id: 1 }
      ).lean();
      filter.customer = { $in: matchingCustomers.map((c) => c._id) };
    }

    const SORT_FIELDS = { amount: 'amount', age: 'createdAt', createdAt: 'createdAt' };
    const dbSortField = SORT_FIELDS[sortBy] || 'createdAt';
    const sortSpec    = { [dbSortField]: dbSortField === 'createdAt' && sortBy !== 'age' ? 1 : sortDir };

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);

    const [credits, total, totalAmountAgg] = await Promise.all([
      CarWashCustomerCredit.find(filter)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customer', 'name phone plates')
        .populate('sourceJob', 'jobNumber plateNumber')
        .populate('appliedToJob', 'jobNumber plateNumber')
        .lean(),
      CarWashCustomerCredit.countDocuments(filter),
      CarWashCustomerCredit.aggregate([
        { $match: { business: businessOid, status, ...(filter.createdAt && { createdAt: filter.createdAt }), ...(filter.customer && { customer: filter.customer }) } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: credits,
      total,
      totalAmount: round2(totalAmountAgg[0]?.total || 0),
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get credit balance for a specific plate (used in payment modal) ──────────
export const getCreditByPlate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const plate = String(req.params.plate || '').trim().toUpperCase();
    if (!plate) return next(createError(400, 'Plate is required'));

    const customer = await CarWashCustomer.findOne({ business, plates: plate }).lean();
    if (!customer) return res.json({ success: true, creditBalance: 0, credits: [] });

    const credits = await CarWashCustomerCredit.find({ business, customer: customer._id, status: 'active' })
      .select('amount createdAt sourceJob')
      .populate('sourceJob', 'jobNumber')
      .lean();

    const creditBalance = round2(credits.reduce((s, c) => s + Number(c.amount || 0), 0));
    res.json({ success: true, creditBalance, credits, customer: { _id: customer._id, name: customer.name, phone: customer.phone } });
  } catch (err) {
    next(err);
  }
};

// ─── Apply credit to a job (customer explicitly asks) ────────────────────────
export const applyCredit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const credit   = await CarWashCustomerCredit.findOne({ _id: req.params.id, business, status: 'active' });
    if (!credit) return next(createError(404, 'Active credit not found'));

    const jobId = req.body.jobId;
    if (!jobId) return next(createError(400, 'jobId is required'));
    const job = await CarWashJob.findOne({ _id: jobId, business }).lean();
    if (!job) return next(createError(404, 'Job not found'));
    if (job.status === 'cancelled') return next(createError(400, 'Cannot apply credit to a cancelled job'));

    // Post ledger FIRST — if it throws, status is not updated
    await postCarWashCreditAppliedLedger({ businessId: business, credit, appliedToJob: job, userId });

    credit.status       = 'applied';
    credit.appliedToJob = job._id;
    credit.appliedAt    = new Date();
    credit.appliedBy    = userId;
    credit.updatedBy    = userId;
    await credit.save();

    res.json({ success: true, data: credit, message: 'Credit applied successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Write off dormant credit to Other Income ─────────────────────────────────
export const writeOffCredit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    // Support single ID (route param) or array of IDs (bulk, body.ids)
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.params.id].filter(Boolean);
    if (!ids.length) return next(createError(400, 'No credit IDs provided'));

    const credits = await CarWashCustomerCredit.find({ _id: { $in: ids }, business, status: 'active' });
    if (!credits.length) return next(createError(404, 'No active credits found'));

    const now = new Date();
    const succeeded = [];
    const failed    = [];

    // Process in parallel — each credit is independent
    await Promise.all(credits.map(async (credit) => {
      try {
        // Ledger first; if it throws, document is not updated
        const entryIds = await postCarWashCreditWriteOffLedger({ businessId: business, credit, userId });
        credit.status                = 'written_off';
        credit.writtenOffAt          = now;
        credit.writtenOffBy          = userId;
        credit.writeOffLedgerEntries = entryIds;
        credit.updatedBy             = userId;
        await credit.save();
        succeeded.push(credit._id);
      } catch (err) {
        console.error('[CW Credits] Write-off failed credit=%s: %s', credit._id, err?.message || err);
        failed.push(credit._id);
      }
    }));

    if (!succeeded.length) return next(createError(500, 'All write-offs failed — check server logs'));

    res.json({
      success: true,
      writtenOff: succeeded.length,
      failed: failed.length,
      message: `${succeeded.length} credit(s) written off to Other Income${failed.length ? ` (${failed.length} failed)` : ''}`,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Undo a write-off (customer comes back) ───────────────────────────────────
export const undoWriteOff = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const credit   = await CarWashCustomerCredit.findOne({ _id: req.params.id, business, status: 'written_off' });
    if (!credit) return next(createError(404, 'Written-off credit not found'));

    // Ledger reversal first — if it throws, document status is NOT changed
    await reverseCarWashCreditWriteOffLedger({ businessId: business, credit, req });

    credit.status                = 'active';
    credit.reversedAt            = new Date();
    credit.reversedBy            = userId;
    credit.writeOffLedgerEntries = [];
    credit.writtenOffAt          = undefined;
    credit.writtenOffBy          = undefined;
    credit.updatedBy             = userId;
    await credit.save();

    res.json({ success: true, data: credit, message: 'Write-off reversed — credit is active again' });
  } catch (err) {
    next(err);
  }
};

// ─── Refund credit as cash ────────────────────────────────────────────────────
export const refundCredit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const credit   = await CarWashCustomerCredit.findOne({ _id: req.params.id, business, status: 'active' });
    if (!credit) return next(createError(404, 'Active credit not found'));

    const cashbookAccountId = String(req.body.cashbookAccount || '').trim();
    if (!cashbookAccountId || !mongoose.Types.ObjectId.isValid(cashbookAccountId)) {
      return next(createError(400, 'Select a valid cashbook account for the refund'));
    }
    const cashbook = await ChartOfAccount.findOne({
      _id: cashbookAccountId, business, isPosting: true,
    }).lean();
    if (!cashbook) return next(createError(400, 'Cashbook account not found'));

    // Dr 2162 (Customer Credit Liability) / Cr Cashbook — cash physically paid out
    // Ledger first; if it throws, document status is NOT changed
    await postCarWashCreditRefundLedger({ businessId: business, credit, cashbookAccountId: cashbook._id, userId });

    credit.status     = 'refunded';
    credit.refundedAt = new Date();
    credit.refundedBy = userId;
    credit.refundNote = String(req.body.note || '').trim();
    credit.updatedBy  = userId;
    await credit.save();

    res.json({ success: true, data: credit, message: `KES ${credit.amount.toLocaleString()} credit refunded` });
  } catch (err) {
    next(err);
  }
};

// ─── Repair: re-post GL entries for M-Pesa credits that failed schema validation ─
export const repairCreditLedgers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const company = await Company.findById(business).select('paymentIntegration').lean();
    const config = getPrimaryMpesaPaybillConfig(getRawMpesaPaybillConfigs(company?.paymentIntegration));
    const cashbookId = config?.defaultCashbookAccountId;
    if (!cashbookId || !mongoose.Types.ObjectId.isValid(String(cashbookId))) {
      return next(createError(422, 'M-Pesa cashbook not configured on paybill settings'));
    }
    const cashbook = await ChartOfAccount.findOne({ _id: cashbookId, business, type: 'asset', isPosting: true }).lean();
    if (!cashbook) return next(createError(422, 'Cashbook account not found'));

    // Find credit docs that have no posted ledger entry yet
    const credits = await CarWashCustomerCredit.find({ business }).lean();
    const postedIds = new Set(
      (await FinancialLedgerEntry.distinct('sourceTransactionId', {
        business: new mongoose.Types.ObjectId(String(business)),
        sourceTransactionType: 'carwash_customer_credit_created',
      })).map(String)
    );

    const pending = credits.filter((c) => !postedIds.has(String(c._id)));
    let posted = 0;
    for (const creditDoc of pending) {
      await postCarWashCustomerCreditCreationLedger({ businessId: business, creditDoc, cashbookAccountId: cashbook._id, userId });
      posted++;
    }

    res.json({ success: true, message: `Repaired ${posted} credit ledger entries (${credits.length - posted} already posted).` });
  } catch (err) {
    next(err);
  }
};
