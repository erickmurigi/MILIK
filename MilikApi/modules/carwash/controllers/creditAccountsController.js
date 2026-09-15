import mongoose from "mongoose";
import CarWashCreditAccount from "../models/CarWashCreditAccount.js";
import CarWashAccountStatement from "../models/CarWashAccountStatement.js";
import CarWashAccountTopup from "../models/CarWashAccountTopup.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { createError } from "../../../utils/error.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, escapeRegex, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { sendAdHocSms, sendAdHocEmail } from "../../../services/communicationService.js";
import { postCarWashTopupLedger, reverseCarWashTopupLedger, postCarWashPaymentLedger } from "../services/carwashAccountingService.js";
import { resolveCarWashSmsBody } from "../services/carwashSmsService.js";
import { accrueCommissionForJob, markJobCommissionsPayable } from "../services/commissionService.js";


// â”€â”€â”€ Number generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const generateAccountNumber = async (business) => {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const prefix = `CWAC-${ymd}-`;
  const last = await CarWashCreditAccount.findOne({ business, accountNumber: new RegExp(`^${prefix}`) })
    .sort({ accountNumber: -1 }).lean();
  const seq = last
    ? Number(String(last.accountNumber).slice(prefix.length)) + 1
    : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const generateStatementNumber = async (business, periodStart) => {
  const d = new Date(periodStart);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `CWST-${ym}-`;
  const last = await CarWashAccountStatement.findOne({ business, statementNumber: new RegExp(`^${prefix}`) })
    .sort({ statementNumber: -1 }).lean();
  const seq = last
    ? Number(String(last.statementNumber).slice(prefix.length)) + 1
    : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
};

// â”€â”€â”€ Balance computation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Single-account variant â€” used when refreshing one account after a topup/payment.
const computeAccountBalance = async (business, accountId) => {
  const account = await CarWashCreditAccount.findById(accountId).select("plates").lean();
  const plates = Array.isArray(account?.plates) ? account.plates.filter(Boolean) : [];

  const orConditions = [{ creditAccount: new mongoose.Types.ObjectId(String(accountId)) }];
  if (plates.length) orConditions.push({ plateNumber: { $in: plates } });

  const jobs = await CarWashJob.find({
    business,
    status: { $nin: ["cancelled"] },
    $or: orConditions,
  }).select("_id price discountAmount").lean();

  if (!jobs.length) return 0;

  const uniqueJobs = [...new Map(jobs.map((j) => [String(j._id), j])).values()];
  const jobIds = uniqueJobs.map((j) => j._id);

  const businessOid = new mongoose.Types.ObjectId(String(business));
  const totals = await CarWashPayment.aggregate([
    { $match: { business: businessOid, job: { $in: jobIds } } },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]).allowDiskUse(true);

  const totalInvoiced = uniqueJobs.reduce((sum, j) => sum + Math.max(0, Number(j.price || 0) - Number(j.discountAmount || 0)), 0);
  return round2(Math.max(0, totalInvoiced - Number(totals[0]?.paid || 0)));
};

// Batch variant â€” computes balances for all accounts in 2 queries instead of 3N.
const computeAllBalances = async (business, accounts) => {
  if (!accounts.length) return {};
  const businessOid = new mongoose.Types.ObjectId(String(business));
  const allAccountIds = accounts.map((a) => a._id);
  const allPlates = [...new Set(accounts.flatMap((a) => (a.plates || []).filter(Boolean)))];

  const jobOrConditions = [{ creditAccount: { $in: allAccountIds } }];
  if (allPlates.length) jobOrConditions.push({ plateNumber: { $in: allPlates } });

  const allJobs = await CarWashJob.find({
    business: businessOid,
    status: { $nin: ["cancelled"] },
    $or: jobOrConditions,
  }).select("_id price discountAmount creditAccount plateNumber").lean();

  if (!allJobs.length) return {};

  const allJobIds = allJobs.map((j) => j._id);
  const paymentRows = await CarWashPayment.aggregate([
    { $match: { business: businessOid, job: { $in: allJobIds } } },
    { $group: { _id: "$job", paid: { $sum: "$amount" } } },
  ]).allowDiskUse(true);
  const paidByJob = new Map(paymentRows.map((r) => [String(r._id), Number(r.paid)]));
  const jobById   = new Map(allJobs.map((j) => [String(j._id), j]));

  // plate -> set of accountIds that own that plate
  const plateToAccounts = new Map();
  accounts.forEach((acc) => {
    (acc.plates || []).filter(Boolean).forEach((plate) => {
      if (!plateToAccounts.has(plate)) plateToAccounts.set(plate, new Set());
      plateToAccounts.get(plate).add(String(acc._id));
    });
  });

  // account -> set of unique job IDs it owns
  const accountJobIds = new Map(accounts.map((a) => [String(a._id), new Set()]));
  for (const job of allJobs) {
    const jobIdStr = String(job._id);
    if (job.creditAccount) {
      const key = String(job.creditAccount);
      accountJobIds.get(key)?.add(jobIdStr);
    }
    if (job.plateNumber && plateToAccounts.has(job.plateNumber)) {
      for (const accIdStr of plateToAccounts.get(job.plateNumber)) {
        accountJobIds.get(accIdStr)?.add(jobIdStr);
      }
    }
  }

  const result = {};
  for (const [accIdStr, jobIdSet] of accountJobIds) {
    let invoiced = 0, paid = 0;
    for (const jid of jobIdSet) {
      const j = jobById.get(jid);
      invoiced += Math.max(0, Number(j?.price || 0) - Number(j?.discountAmount || 0));
      paid     += paidByJob.get(jid) || 0;
    }
    result[accIdStr] = round2(Math.max(0, invoiced - paid));
  }
  return result;
};

// â”€â”€â”€ CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const listAccounts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.status)      filter.status      = req.query.status;
    if (req.query.accountType) filter.accountType = req.query.accountType;

    // Fetch all accounts (balance computation requires the full set anyway)
    const accounts = await CarWashCreditAccount.find(filter)
      .populate("customer", "name phone plates")
      .sort({ status: 1, createdAt: -1 })
      .limit(500)
      .lean();

    const balances = await computeAllBalances(business, accounts);
    let enriched = accounts.map((acc) => ({ ...acc, currentBalance: balances[String(acc._id)] ?? 0 }));

    // In-memory search across account number, customer name/phone, and plates
    const search = String(req.query.search || "").trim().toLowerCase();
    if (search) {
      enriched = enriched.filter((acc) =>
        acc.accountNumber?.toLowerCase().includes(search) ||
        acc.customer?.name?.toLowerCase().includes(search) ||
        acc.customer?.phone?.includes(search) ||
        (acc.plates || []).some((p) => p.toLowerCase().includes(search)) ||
        acc.contactPerson?.toLowerCase().includes(search)
      );
    }

    // In-memory sort
    const sortBy  = String(req.query.sortBy  || "");
    const sortDir = req.query.sortDir === "asc" ? 1 : -1;
    if (sortBy === "balance") {
      enriched.sort((a, b) => sortDir * (a.currentBalance - b.currentBalance));
    } else if (sortBy === "name") {
      enriched.sort((a, b) => sortDir * (a.customer?.name || "").localeCompare(b.customer?.name || ""));
    } else if (sortBy === "type") {
      enriched.sort((a, b) => sortDir * a.accountType.localeCompare(b.accountType));
    }

    // Pagination
    const limit  = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page   = Math.max(Number(req.query.page || 1), 1);
    const total  = enriched.length;
    const pages  = Math.max(Math.ceil(total / limit), 1);
    const data   = enriched.slice((page - 1) * limit, page * limit);

    res.json({ success: true, data, total, page, limit, pages });
  } catch (err) {
    next(err);
  }
};

export const createAccount = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const { customerId, accountType, contactPerson, billingEmail, creditLimit, billingCycle, billingDay, notes, plates } = req.body;
    if (!customerId) return next(createError(400, "Customer is required"));
    if (!accountType || !["credit", "monthly", "prepaid", "voucher"].includes(accountType)) {
      return next(createError(400, "accountType must be 'credit', 'monthly', 'prepaid', or 'voucher'"));
    }

    const customer = await CarWashCustomer.findOne({ _id: customerId, business }).lean();
    if (!customer) return next(createError(404, "Customer not found"));

    // Normalize plates â€” merge customer plates with any extra plates provided
    const allPlates = [...new Set([
      ...(customer.plates || []),
      ...(Array.isArray(plates) ? plates.map((p) => String(p).trim().toUpperCase()).filter(Boolean) : []),
    ])];

    const accountNumber = await generateAccountNumber(business);
    const account = await CarWashCreditAccount.create({
      business,
      branch: resolveActiveBranchId(req) || null,
      accountNumber,
      customer: customer._id,
      plates: allPlates,
      accountType,
      contactPerson: String(contactPerson || "").trim(),
      billingEmail:  String(billingEmail  || "").trim().toLowerCase(),
      creditLimit: Math.max(0, Number(creditLimit || 0)),
      billingCycle: billingCycle || "monthly",
      billingDay: Math.min(28, Math.max(1, Number(billingDay || 1))),
      notes: String(notes || "").trim(),
      createdBy: userId,
      updatedBy: userId,
    });

    res.status(201).json({ success: true, data: account, message: "Credit account created" });
  } catch (err) {
    next(err);
  }
};

export const getAccount = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business })
      .populate("customer", "name phone plates")
      .lean();
    if (!account) return next(createError(404, "Credit account not found"));

    // Attach live balance and recent jobs
    const [balance, recentJobs] = await Promise.all([
      computeAccountBalance(business, account._id),
      CarWashJob.find({ business, creditAccount: account._id, status: { $nin: ["cancelled"] } })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    const jobIds = recentJobs.map((j) => j._id);
    const paymentTotals = jobIds.length
      ? await CarWashPayment.aggregate([
          { $match: { business, job: { $in: jobIds } } },
          { $group: { _id: "$job", paid: { $sum: "$amount" } } },
        ])
      : [];
    const paidMap = new Map(paymentTotals.map((p) => [String(p._id), p.paid]));

    const jobsWithBalance = recentJobs.map((j) => ({
      ...j,
      paidAmount: paidMap.get(String(j._id)) || 0,
      outstanding: round2(Math.max(0, j.price - (j.discountAmount || 0) - (paidMap.get(String(j._id)) || 0))),
    }));

    res.json({ success: true, data: { ...account, currentBalance: balance, jobs: jobsWithBalance } });
  } catch (err) {
    next(err);
  }
};

export const updateAccount = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business });
    if (!account) return next(createError(404, "Credit account not found"));

    const { creditLimit, billingCycle, billingDay, status, notes, plates, contactPerson, billingEmail } = req.body;
    if (contactPerson !== undefined) account.contactPerson = String(contactPerson).trim();
    if (billingEmail  !== undefined) account.billingEmail  = String(billingEmail).trim().toLowerCase();
    if (creditLimit   !== undefined) account.creditLimit   = Math.max(0, Number(creditLimit));
    if (billingCycle  !== undefined) account.billingCycle  = billingCycle;
    if (billingDay    !== undefined) account.billingDay    = Math.min(28, Math.max(1, Number(billingDay)));
    if (status !== undefined && ["active", "suspended", "closed"].includes(status)) account.status = status;
    if (notes !== undefined) account.notes = String(notes).trim();
    if (Array.isArray(plates)) {
      account.plates = [...new Set(plates.map((p) => String(p).trim().toUpperCase()).filter(Boolean))];
    }
    account.updatedBy = userId;
    await account.save();
    res.json({ success: true, data: account, message: "Account updated" });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Plate lookup for job creation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const lookupAccountByPlate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const plate = String(req.params.plate || "").trim().toUpperCase();
    if (!plate) return next(createError(400, "Plate is required"));

    const account = await CarWashCreditAccount.findOne({
      business,
      plates: plate,
      status: "active",
      accountType: { $ne: "voucher" },
    }).populate("customer", "name phone plates").lean();

    if (!account) return res.json({ success: true, data: null });

    const balance = await computeAccountBalance(business, account._id);
    const atLimit = account.creditLimit > 0 && balance >= account.creditLimit;
    const overLimit = account.creditLimit > 0 && balance > account.creditLimit;

    res.json({ success: true, data: { ...account, currentBalance: balance, atLimit, overLimit } });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ FIFO payment recording â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const recordAccountPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business });
    if (!account) return next(createError(404, "Credit account not found"));
    if (account.status === "closed") return next(createError(400, "Cannot record payment on a closed account"));

    const amount = round2(Number(req.body.amount || 0));
    if (!amount || amount <= 0) return next(createError(400, "Payment amount must be greater than zero"));

    const method = String(req.body.method || "cash").trim().toLowerCase();
    const reference = String(req.body.reference || "").trim();
    const paymentDate = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();
    const receivedFromPhone = method === "mpesa" && req.body.receivedFromPhone
      ? String(req.body.receivedFromPhone).trim() || null : null;

    // Resolve cashbook
    let cashbookAccount = null;
    if (req.body.cashbookAccount && mongoose.Types.ObjectId.isValid(String(req.body.cashbookAccount))) {
      const cb = await ChartOfAccount.findOne({ _id: req.body.cashbookAccount, business, type: "asset", isPosting: true }).lean();
      if (!cb) return next(createError(400, "Selected cashbook account not found"));
      cashbookAccount = cb._id;
    }

    // Wallet accounts (prepaid / voucher): revenue was already recognised at top-up time.
    // Force no cashbook (prevents double GL) and deduct from accountCredit balance.
    const isWalletAccount = ["prepaid", "voucher"].includes(account.accountType);
    if (isWalletAccount) {
      cashbookAccount = null;
      const walletBalance = round2(account.accountCredit || 0);
      if (amount > walletBalance + 0.009) {
        return next(createError(400, `Insufficient wallet balance. Available: KES ${walletBalance.toLocaleString()}`));
      }
    }
    const effectiveMethod = isWalletAccount ? "prepaid" : method;

    // â”€â”€ FIFO allocation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Link any plate-matched jobs that are missing the creditAccount ref â€” this
    // prevents a permanent phantom debt where the balance includes jobs that can
    // never be settled because recordAccountPayment only queries by creditAccount.
    if ((account.plates || []).length) {
      await CarWashJob.updateMany(
        {
          business,
          plateNumber: { $in: account.plates },
          creditAccount: null,
          status: { $nin: ["cancelled"] },
          paymentStatus: { $in: ["unpaid", "partial"] },
        },
        { $set: { creditAccount: account._id } }
      );
    }

    const unpaidJobs = await CarWashJob.find({
      business,
      creditAccount: account._id,
      paymentStatus: { $in: ["unpaid", "partial"] },
      status: { $nin: ["cancelled"] },
    }).sort({ createdAt: 1 }).limit(200).lean();

    const jobIds = unpaidJobs.map((j) => j._id);
    const paymentTotals = jobIds.length
      ? await CarWashPayment.aggregate([
          { $match: { business, job: { $in: jobIds } } },
          { $group: { _id: "$job", paid: { $sum: "$amount" } } },
        ])
      : [];
    const paidMap = new Map(paymentTotals.map((p) => [String(p._id), p.paid]));

    let remaining = amount;
    const allocations = [];

    for (const job of unpaidJobs) {
      if (remaining <= 0.009) break;
      const alreadyPaid = paidMap.get(String(job._id)) || 0;
      const outstanding = round2(Math.max(0, (job.price - (job.discountAmount || 0)) - alreadyPaid));
      if (outstanding <= 0.009) continue;

      const apply = round2(Math.min(outstanding, remaining));
      remaining = round2(remaining - apply);

      const payment = await CarWashPayment.create({
        business,
        branch: job.branch || account.branch || null,
        job: job._id,
        amount: apply,
        method: effectiveMethod,
        cashbookAccount,
        reference: isWalletAccount ? "" : reference,
        receivedFromPhone: isWalletAccount ? null : receivedFromPhone,
        paymentDate,
        receivedBy: userId,
        createdBy: userId,
        updatedBy: userId,
      });

      // Post Dr Cashbook / Cr 4400 for each job settled â€” same entry as a direct payment.
      // Fire-and-forget so a ledger error never blocks the payment response.
      if (cashbookAccount) {
        postCarWashPaymentLedger({ businessId: business, payment, cashbookAccountId: cashbookAccount, job: { ...job }, userId, taxAmount: Number(job.taxAmount || 0), jobPrice: Number(job.price || 0) })
          .catch((e) => console.error("[CW Account] Ledger posting failed job=%s: %s", job.jobNumber, e?.message));
      }

      const newPaid = round2(alreadyPaid + apply);
      const jobNetPrice = round2(job.price - (job.discountAmount || 0));
      const newPaymentStatus = newPaid >= jobNetPrice - 0.009 ? "paid" : "partial";
      const newJobStatus = newPaymentStatus === "paid" && job.status !== "cancelled" ? "paid" : job.status;
      await CarWashJob.updateOne({ _id: job._id }, { paymentStatus: newPaymentStatus, status: newJobStatus, updatedBy: userId });

      if (newJobStatus === "paid") {
        const jobForCommission = { ...job, status: "paid", paymentStatus: "paid" };
        accrueCommissionForJob({ req: null, job: jobForCommission })
          .then(() => markJobCommissionsPayable({ business, jobId: job._id }))
          .catch((e) => console.error("[CW Account] Commission accrual failed job=%s: %s", job.jobNumber, e?.message));
      }

      allocations.push({ jobId: job._id, jobNumber: job.jobNumber, plateNumber: job.plateNumber, applied: apply });
    }

    const excessCredit = round2(remaining);
    const newBalance = await computeAccountBalance(business, account._id);
    account.currentBalance = newBalance;
    account.updatedBy = userId;
    if (isWalletAccount) {
      // Deduct only what was actually allocated â€” unallocated remainder stays in the wallet
      const allocated = round2(amount - remaining);
      account.accountCredit = round2((account.accountCredit || 0) - allocated);
    } else {
      account.accountCredit = round2((account.accountCredit || 0) + excessCredit);
    }
    await account.save();

    // Update statement status if any statement covers these jobs
    await refreshStatementStatuses(business, account._id);

    res.status(201).json({
      success: true,
      message: `Payment of KES ${amount.toLocaleString()} applied to ${allocations.length} job(s)`,
      data: { allocations, excessCredit, newBalance, jobsCleared: allocations.filter((a) => a.applied > 0).length },
    });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Statement generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const refreshStatementStatuses = async (business, accountId) => {
  const statements = await CarWashAccountStatement.find({ business, account: accountId, status: { $nin: ["paid"] } });
  if (!statements.length) return;

  // One query for all jobs referenced by any statement (instead of N queries)
  const allJobIds = [...new Set(statements.flatMap((s) => s.jobs.map((l) => String(l.job))))];
  const jobs = await CarWashJob.find({ _id: { $in: allJobIds } }, { _id: 1, paymentStatus: 1 }).lean();
  const jobMap = new Map(jobs.map((j) => [String(j._id), j.paymentStatus]));

  const updateOps = [];
  for (const stmt of statements) {
    const statuses = stmt.jobs.map((l) => jobMap.get(String(l.job)) || "unpaid");
    const allPaid = statuses.every((s) => s === "paid");
    const anyPaid = statuses.some((s) => s !== "unpaid");
    const nextStatus = allPaid ? "paid" : anyPaid ? "partial" : stmt.status;
    if (nextStatus !== stmt.status) {
      updateOps.push({ updateOne: { filter: { _id: stmt._id }, update: { $set: { status: nextStatus } } } });
    }
  }
  if (updateOps.length) await CarWashAccountStatement.bulkWrite(updateOps, { ordered: false });
};

export const generateStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business })
      .populate("customer", "name phone").lean();
    if (!account) return next(createError(404, "Credit account not found"));

    const now         = new Date();
    const isCreditType = account.accountType === "credit";

    // Credit accounts cover all jobs from account opening; monthly defaults to current calendar month
    const periodStart = req.body.periodStart
      ? new Date(req.body.periodStart)
      : isCreditType
        ? new Date(account.createdAt || 0)
        : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const periodEnd = req.body.periodEnd
      ? new Date(req.body.periodEnd)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Prevent duplicate monthly statements for the same calendar month
    if (!isCreditType && !req.body.periodStart) {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const existing   = await CarWashAccountStatement.findOne({
        business, account: account._id,
        periodStart: { $gte: monthStart, $lt: monthEnd },
      }).lean();
      if (existing) return next(createError(409, `Statement ${existing.statementNumber} already exists for this month`));
    }

    // Fetch all non-cancelled jobs in the period
    const jobs = await CarWashJob.find({
      business,
      creditAccount: account._id,
      status: { $nin: ["cancelled"] },
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).sort({ createdAt: 1 }).lean();

    if (!jobs.length) {
      return next(createError(400, "No jobs found for this account in the selected period"));
    }

    const jobIds = jobs.map((j) => j._id);
    const paymentTotals = await CarWashPayment.aggregate([
      { $match: { business, job: { $in: jobIds } } },
      { $group: { _id: "$job", paid: { $sum: "$amount" } } },
    ]).allowDiskUse(true);
    const paidMap = new Map(paymentTotals.map((p) => [String(p._id), p.paid]));

    const jobLines = jobs.map((j) => {
      const net  = round2(Number(j.price || 0) - Number(j.discountAmount || 0));
      const paid = round2(paidMap.get(String(j._id)) || 0);
      return {
        job: j._id,
        jobNumber: j.jobNumber,
        plateNumber: j.plateNumber,
        serviceName: j.serviceName,
        price: net,
        paidAmount: paid,
        outstanding: round2(net - paid),
        jobDate: j.createdAt,
      };
    });

    const totalInvoiced = round2(jobLines.reduce((s, l) => s + l.price, 0));
    const totalPaid     = round2(jobLines.reduce((s, l) => s + l.paidAmount, 0));
    const totalOutstanding = round2(totalInvoiced - totalPaid);

    // Opening balance = account balance before this period's jobs
    const priorJobs = await CarWashJob.find({
      business,
      creditAccount: account._id,
      status: { $nin: ["cancelled"] },
      createdAt: { $lt: periodStart },
    }).lean();
    const priorJobIds = priorJobs.map((j) => j._id);
    const priorPaid = priorJobIds.length
      ? (await CarWashPayment.aggregate([
          { $match: { business, job: { $in: priorJobIds } } },
          { $group: { _id: null, paid: { $sum: "$amount" } } },
        ]))[0]?.paid || 0
      : 0;
    const openingBalance = round2(priorJobs.reduce((s, j) => s + Math.max(0, j.price - (j.discountAmount || 0)), 0) - priorPaid);

    const statementNumber = await generateStatementNumber(business, isCreditType ? now : periodStart);
    const statement = await CarWashAccountStatement.create({
      business,
      account: account._id,
      statementNumber,
      periodStart,
      periodEnd,
      openingBalance,
      jobs: jobLines,
      totalJobs: jobs.length,
      totalInvoiced,
      totalPaid,
      totalOutstanding,
      closingBalance: round2(openingBalance + totalOutstanding),
      status: totalOutstanding <= 0 ? "paid" : "draft",
      notes: String(req.body.notes || "").trim(),
      createdBy: userId,
      updatedBy: userId,
    });

    // Update account's lastStatementAt
    await CarWashCreditAccount.updateOne({ _id: account._id }, { lastStatementAt: now, updatedBy: userId });

    res.status(201).json({ success: true, data: statement, message: `Statement ${statementNumber} generated` });
  } catch (err) {
    next(err);
  }
};

export const listStatements = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (req.params.id) filter.account = req.params.id;
    if (req.query.status) filter.status = req.query.status;

    const statements = await CarWashAccountStatement.find(filter)
      .populate("account", "accountNumber customer")
      .sort({ periodStart: -1 })
      .lean();

    res.json({ success: true, data: statements });
  } catch (err) {
    next(err);
  }
};

export const getStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const statement = await CarWashAccountStatement.findOne({ _id: req.params.statementId, business })
      .populate("account", "accountNumber accountType contactPerson billingEmail creditLimit billingCycle billingDay status currentBalance accountCredit lastStatementAt notes plates customer branch")
      .lean();
    if (!statement) return next(createError(404, "Statement not found"));
    res.json({ success: true, data: statement });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Send statement SMS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const sendStatementSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const statement = await CarWashAccountStatement.findOne({ _id: req.params.statementId, business })
      .populate({ path: "account", populate: { path: "customer", select: "name phone" } })
      .lean();
    if (!statement) return next(createError(404, "Statement not found"));

    const customer = statement.account?.customer;
    const phone = String(req.body.phone || customer?.phone || "").trim();
    if (!phone) return next(createError(400, "No phone number available"));

    const period = new Date(statement.periodStart).toLocaleString("en-KE", { month: "long", year: "numeric" });
    const body = req.body.body || await resolveCarWashSmsBody(business, "carwash_statement", {
      customerName:    customer?.name || "Customer",
      period,
      outstanding:     Number(statement.totalOutstanding || 0).toLocaleString(),
      totalJobs:       statement.totalJobs,
      statementNumber: statement.statementNumber,
    }) || `Hi ${customer?.name || "Customer"}, your car wash statement for ${period} is KES ${Number(statement.totalOutstanding || 0).toLocaleString()} for ${statement.totalJobs} wash(es). Ref: ${statement.statementNumber}. Thank you!`;

    await sendAdHocSms({ businessId: business, phone, body, templateKey: "carwash_statement" });

    await CarWashAccountStatement.updateOne({ _id: statement._id }, { status: "sent", sentAt: new Date() });
    res.json({ success: true, message: "Statement SMS sent" });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Send statement email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const sendStatementEmail = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const statement = await CarWashAccountStatement.findOne({ _id: req.params.statementId, business })
      .populate({ path: "account", populate: { path: "customer", select: "name phone" } })
      .lean();
    if (!statement) return next(createError(404, "Statement not found"));

    const account  = statement.account;
    const customer = account?.customer;
    const to = String(req.body.email || account?.billingEmail || "").trim().toLowerCase();
    if (!to) return next(createError(400, "No billing email on this account. Add one in account settings or provide it in the request."));

    const period          = new Date(statement.periodStart).toLocaleString("en-KE", { month: "long", year: "numeric" });
    const contactName     = account?.contactPerson || customer?.name || "Customer";
    const fmtAmt          = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
    const esc             = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const jobRows = (statement.jobs || []).map((j) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${new Date(j.jobDate).toLocaleDateString("en-KE")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${esc(j.plateNumber || "â€”")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${esc(j.serviceName || "â€”")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${fmtAmt(j.price)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${fmtAmt(j.paidAmount)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:bold;color:${j.outstanding > 0 ? "#dc2626" : "#16a34a"}">${fmtAmt(j.outstanding)}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:700px;margin:0 auto;padding:24px">
      <div style="background:#0B3B2E;color:#fff;padding:20px 24px;border-radius:4px 4px 0 0">
        <h2 style="margin:0;font-size:18px">Car Wash Account Statement</h2>
        <p style="margin:4px 0 0;opacity:.75;font-size:13px">${esc(period)} Â· Ref: ${esc(statement.statementNumber)}</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:20px 24px">
        <p style="margin:0 0 4px"><strong>To:</strong> ${esc(contactName)}</p>
        <p style="margin:0 0 4px"><strong>Account:</strong> ${esc(account?.accountNumber || "")}</p>
        <p style="margin:0 0 16px"><strong>Period:</strong> ${esc(period)}</p>

        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="padding:8px;text-align:left">Date</th>
              <th style="padding:8px;text-align:left">Plate</th>
              <th style="padding:8px;text-align:left">Service</th>
              <th style="padding:8px;text-align:right">Amount</th>
              <th style="padding:8px;text-align:right">Paid</th>
              <th style="padding:8px;text-align:right">Balance</th>
            </tr>
          </thead>
          <tbody>${jobRows}</tbody>
          <tfoot>
            <tr style="background:#f8fafc">
              <td colspan="3" style="padding:8px;font-weight:bold">Opening Balance</td>
              <td colspan="3" style="padding:8px;text-align:right">${fmtAmt(statement.openingBalance)}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td colspan="3" style="padding:8px;font-weight:bold">Total Invoiced</td>
              <td colspan="3" style="padding:8px;text-align:right">${fmtAmt(statement.totalInvoiced)}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td colspan="3" style="padding:8px;font-weight:bold">Total Paid</td>
              <td colspan="3" style="padding:8px;text-align:right">${fmtAmt(statement.totalPaid)}</td>
            </tr>
            <tr style="background:#0B3B2E;color:#fff">
              <td colspan="3" style="padding:10px 8px;font-weight:bold;font-size:14px">Amount Due</td>
              <td colspan="3" style="padding:10px 8px;text-align:right;font-weight:bold;font-size:14px">${fmtAmt(statement.totalOutstanding)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="margin:20px 0 0;font-size:12px;color:#64748b">This is an automatically generated statement. Please contact us if you have any queries.</p>
      </div>
    </body></html>`;

    await sendAdHocEmail({
      businessId: business,
      to,
      subject: `Car Wash Statement â€” ${period} (${statement.statementNumber})`,
      html,
      text: `Hi ${contactName},\n\nYour car wash statement for ${period}:\nInvoiced: ${fmtAmt(statement.totalInvoiced)}\nPaid: ${fmtAmt(statement.totalPaid)}\nAmount Due: ${fmtAmt(statement.totalOutstanding)}\nRef: ${statement.statementNumber}\n\nThank you.`,
    });

    await CarWashAccountStatement.updateOne({ _id: statement._id }, { status: "sent", sentAt: new Date() });
    res.json({ success: true, message: `Statement emailed to ${to}` });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Auto-billing: called on server startup + daily check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Finds all monthly accounts where today is their billingDay and no statement
// exists for the current month yet, then generates statements automatically.

export const processDueBilling = async (business) => {
  const today = new Date();
  const dayOfMonth = today.getDate();

  const dueAccounts = await CarWashCreditAccount.find({
    ...(business ? { business } : {}),
    accountType: "monthly",
    status: "active",
    billingDay: dayOfMonth,
  }).lean();

  const customerIds = dueAccounts.map((a) => a.customer).filter(Boolean);
  const customerDocs = await CarWashCustomer.find({ _id: { $in: customerIds } }).lean();
  const customerMap = new Map(customerDocs.map((c) => [String(c._id), c]));

  const settled = await Promise.allSettled(dueAccounts.map(async (account) => {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const existing = await CarWashAccountStatement.findOne({
      business: account.business,
      account: account._id,
      periodStart: { $gte: monthStart },
    }).lean();
    if (existing) return null;

    const periodStart = monthStart;
    const periodEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const jobs = await CarWashJob.find({
      business: account.business,
      creditAccount: account._id,
      status: { $nin: ["cancelled"] },
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).lean();

    if (!jobs.length) return null;

    const jobIds = jobs.map((j) => j._id);
    const paymentTotals = await CarWashPayment.aggregate([
      { $match: { business: account.business, job: { $in: jobIds } } },
      { $group: { _id: "$job", paid: { $sum: "$amount" } } },
    ]).allowDiskUse(true);
    const paidMap = new Map(paymentTotals.map((p) => [String(p._id), p.paid]));

    const jobLines = jobs.map((j) => {
      const paid = paidMap.get(String(j._id)) || 0;
      return {
        job: j._id,
        jobNumber: j.jobNumber,
        plateNumber: j.plateNumber,
        serviceName: j.serviceName,
        price: j.price,
        paidAmount: round2(paid),
        outstanding: round2(j.price - paid),
        jobDate: j.createdAt,
      };
    });

    const totalInvoiced   = round2(jobLines.reduce((s, l) => s + l.price, 0));
    const totalPaid       = round2(jobLines.reduce((s, l) => s + l.paidAmount, 0));
    const totalOutstanding = round2(totalInvoiced - totalPaid);

    const statementNumber = await generateStatementNumber(account.business, periodStart);
    const stmt = await CarWashAccountStatement.create({
      business: account.business,
      account: account._id,
      statementNumber,
      periodStart,
      periodEnd,
      openingBalance: 0,
      jobs: jobLines,
      totalJobs: jobs.length,
      totalInvoiced,
      totalPaid,
      totalOutstanding,
      closingBalance: totalOutstanding,
      status: "draft",
    });

    await CarWashCreditAccount.updateOne({ _id: account._id }, { lastStatementAt: today });

    // Auto-send SMS if customer has a phone
    const customer = customerMap.get(String(account.customer));
    if (customer?.phone && totalOutstanding > 0) {
      const period = today.toLocaleString("en-KE", { month: "long", year: "numeric" });
      const body = await resolveCarWashSmsBody(account.business, "carwash_statement", {
        customerName:    customer.name,
        period,
        outstanding:     totalOutstanding.toLocaleString(),
        totalJobs:       jobs.length,
        statementNumber,
      }) || `Hi ${customer.name}, your car wash bill for ${period} is KES ${totalOutstanding.toLocaleString()} for ${jobs.length} wash(es). Ref: ${statementNumber}. Thank you!`;
      sendAdHocSms({ businessId: account.business, phone: customer.phone, body, templateKey: "carwash_statement" }).catch(() => {});
      await CarWashAccountStatement.updateOne({ _id: stmt._id }, { status: "sent", sentAt: new Date() });
    }

    return { account: account.accountNumber, statement: statementNumber, jobs: jobs.length, totalOutstanding };
  }));
  const results = settled.filter((r) => r.status === "fulfilled" && r.value !== null).map((r) => r.value);

  return results;
};

// â”€â”€â”€ Prepaid top-up â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const recordAccountTopup = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business });
    if (!account) return next(createError(404, "Credit account not found"));
    if (account.status === "closed") return next(createError(400, "Cannot top up a closed account"));

    const amount = round2(Number(req.body.amount || 0));
    if (!amount || amount <= 0) return next(createError(400, "Top-up amount must be greater than zero"));

    const method    = String(req.body.method    || "cash").trim().toLowerCase();
    const reference = String(req.body.reference || "").trim();
    const notes     = String(req.body.notes     || "").trim();
    const paymentDate = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();

    let cashbookAccount = null;
    if (req.body.cashbookAccount && mongoose.Types.ObjectId.isValid(String(req.body.cashbookAccount))) {
      const cb = await ChartOfAccount.findOne({ _id: req.body.cashbookAccount, business, type: "asset", isPosting: true }).lean();
      if (!cb) return next(createError(400, "Selected cashbook account not found"));
      cashbookAccount = cb._id;
    }

    // Record the top-up
    const topup = await CarWashAccountTopup.create({
      business, account: account._id, amount, method, reference, cashbookAccount, paymentDate, notes, createdBy: userId,
    });

    // Credit the account balance atomically to prevent concurrent topup races
    await CarWashCreditAccount.findByIdAndUpdate(
      account._id,
      { $inc: { accountCredit: amount } }
    );

    // Post Dr Cashbook / Cr Revenue â€” revenue recognised at point of cash receipt
    await postCarWashTopupLedger({ businessId: business, topup, cashbookAccountId: cashbookAccount, userId });

    res.status(201).json({
      success: true,
      message: `Prepaid top-up of KES ${amount.toLocaleString()} recorded`,
      data: { topup, accountCredit: round2((account.accountCredit || 0) + amount) },
    });
  } catch (err) {
    next(err);
  }
};

export const listAccountTopups = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const account  = await CarWashCreditAccount.findOne({ _id: req.params.id, business }).lean();
    if (!account) return next(createError(404, "Credit account not found"));

    const topups = await CarWashAccountTopup.find({ business, account: account._id })
      .sort({ paymentDate: -1 })
      .lean();

    res.json({ success: true, data: topups });
  } catch (err) {
    next(err);
  }
};

// Called from the financials journal â€” no account ID required
export const voidTopupDirect = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const topup = await CarWashAccountTopup.findOne({ _id: req.params.topupId, business });
    if (!topup) return next(createError(404, "Top-up not found"));
    if (topup.isVoided) return next(createError(400, "This top-up has already been voided"));
    const userId = currentUserId(req);
    const reason = String(req.body.reason || "").trim();
    await reverseCarWashTopupLedger({ businessId: business, topupId: topup._id, reason: reason || "Top-up voided", req });
    const account = await CarWashCreditAccount.findOne({ _id: topup.account, business });
    if (account) {
      await CarWashCreditAccount.findByIdAndUpdate(
        account._id,
        { $inc: { accountCredit: -topup.amount } }
      );
    }
    topup.isVoided   = true;
    topup.voidedAt   = new Date();
    topup.voidedBy   = userId;
    topup.voidReason = reason;
    await topup.save();
    res.json({ success: true, message: "Top-up voided and ledger reversed", data: topup });
  } catch (err) { next(err); }
};

export const voidTopup = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const topup = await CarWashAccountTopup.findOne({ _id: req.params.topupId, business, account: req.params.id });
    if (!topup) return next(createError(404, "Top-up not found"));
    if (topup.isVoided) return next(createError(400, "This top-up has already been voided"));

    const userId = currentUserId(req);
    const reason = String(req.body.reason || "").trim();

    // Reverse ledger entries
    await reverseCarWashTopupLedger({ businessId: business, topupId: topup._id, reason: reason || "Top-up voided", req });

    // Reduce the account credit atomically by the voided amount
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business });
    if (account) {
      await CarWashCreditAccount.findByIdAndUpdate(
        account._id,
        { $inc: { accountCredit: -topup.amount } }
      );
    }

    topup.isVoided  = true;
    topup.voidedAt  = new Date();
    topup.voidedBy  = userId;
    topup.voidReason = reason;
    await topup.save();

    res.json({ success: true, message: "Top-up voided and ledger reversed", data: topup });
  } catch (err) {
    next(err);
  }
};
