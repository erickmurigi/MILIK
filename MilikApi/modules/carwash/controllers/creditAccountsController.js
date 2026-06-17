import mongoose from "mongoose";
import CarWashCreditAccount from "../models/CarWashCreditAccount.js";
import CarWashAccountStatement from "../models/CarWashAccountStatement.js";
import CarWashAccountTopup from "../models/CarWashAccountTopup.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { createError } from "../../../utils/error.js";
import { currentUserId, escapeRegex, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { sendAdHocSms } from "../../../services/communicationService.js";
import { postCarWashTopupLedger, reverseCarWashTopupLedger } from "../services/carwashAccountingService.js";
import { resolveCarWashSmsBody } from "../services/carwashSmsService.js";
import { accrueCommissionForJob, markJobCommissionsPayable } from "../services/commissionService.js";

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// ─── Number generators ────────────────────────────────────────────────────────

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

// ─── Balance computation ──────────────────────────────────────────────────────

// Single-account variant — used when refreshing one account after a topup/payment.
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
  ]);

  const totalInvoiced = uniqueJobs.reduce((sum, j) => sum + Math.max(0, Number(j.price || 0) - Number(j.discountAmount || 0)), 0);
  return round2(Math.max(0, totalInvoiced - Number(totals[0]?.paid || 0)));
};

// Batch variant — computes balances for all accounts in 2 queries instead of 3N.
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
  ]);
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

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const listAccounts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.status) filter.status = req.query.status;
    if (req.query.accountType) filter.accountType = req.query.accountType;
    if (req.query.search) {
      const term = escapeRegex(String(req.query.search).trim());
      filter.$or = [{ accountNumber: { $regex: term, $options: "i" } }];
    }

    const accounts = await CarWashCreditAccount.find(filter)
      .populate("customer", "name phone plates")
      .sort({ status: 1, createdAt: -1 })
      .lean();

    const balances = await computeAllBalances(business, accounts);
    const enriched = accounts.map((acc) => ({ ...acc, currentBalance: balances[String(acc._id)] ?? 0 }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
};

export const createAccount = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const { customerId, accountType, creditLimit, billingCycle, billingDay, notes, plates } = req.body;
    if (!customerId) return next(createError(400, "Customer is required"));
    if (!accountType || !["credit", "monthly", "prepaid"].includes(accountType)) {
      return next(createError(400, "accountType must be 'credit', 'monthly', or 'prepaid'"));
    }

    const customer = await CarWashCustomer.findOne({ _id: customerId, business }).lean();
    if (!customer) return next(createError(404, "Customer not found"));

    // Normalize plates — merge customer plates with any extra plates provided
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
      outstanding: round2(j.price - (paidMap.get(String(j._id)) || 0)),
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

    const { creditLimit, billingCycle, billingDay, status, notes, plates } = req.body;
    if (creditLimit !== undefined) account.creditLimit = Math.max(0, Number(creditLimit));
    if (billingCycle !== undefined) account.billingCycle = billingCycle;
    if (billingDay !== undefined) account.billingDay = Math.min(28, Math.max(1, Number(billingDay)));
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

// ─── Plate lookup for job creation ───────────────────────────────────────────

export const lookupAccountByPlate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const plate = String(req.params.plate || "").trim().toUpperCase();
    if (!plate) return next(createError(400, "Plate is required"));

    const account = await CarWashCreditAccount.findOne({
      business,
      plates: plate,
      status: "active",
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

// ─── FIFO payment recording ───────────────────────────────────────────────────

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

    // ── FIFO allocation ──────────────────────────────────────────────────────
    // Link any plate-matched jobs that are missing the creditAccount ref — this
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
    }).sort({ createdAt: 1 });

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
      const outstanding = round2(job.price - alreadyPaid);
      if (outstanding <= 0.009) continue;

      const apply = round2(Math.min(outstanding, remaining));
      remaining = round2(remaining - apply);

      await CarWashPayment.create({
        business,
        branch: job.branch || account.branch || null,
        job: job._id,
        amount: apply,
        method,
        cashbookAccount,
        reference,
        receivedFromPhone,
        paymentDate,
        receivedBy: userId,
        createdBy: userId,
        updatedBy: userId,
      });

      const newPaid = round2(alreadyPaid + apply);
      const newPaymentStatus = newPaid >= job.price - 0.009 ? "paid" : "partial";
      const newJobStatus = newPaymentStatus === "paid" && job.status !== "cancelled" ? "paid" : job.status;
      await CarWashJob.updateOne({ _id: job._id }, { paymentStatus: newPaymentStatus, status: newJobStatus, updatedBy: userId });

      if (newJobStatus === "paid") {
        const jobForCommission = { ...job.toObject(), status: "paid", paymentStatus: "paid" };
        accrueCommissionForJob({ req: null, job: jobForCommission })
          .then(() => markJobCommissionsPayable({ business, jobId: job._id }))
          .catch((e) => console.error("[CW Account] Commission accrual failed job=%s: %s", job.jobNumber, e?.message));
      }

      allocations.push({ jobId: job._id, jobNumber: job.jobNumber, plateNumber: job.plateNumber, applied: apply });
    }

    // Apply excess as account credit
    const excessCredit = round2(remaining);
    const newBalance = await computeAccountBalance(business, account._id);
    account.currentBalance = newBalance;
    account.accountCredit = round2((account.accountCredit || 0) + excessCredit);
    account.updatedBy = userId;
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

// ─── Statement generation ─────────────────────────────────────────────────────

const refreshStatementStatuses = async (business, accountId) => {
  const statements = await CarWashAccountStatement.find({ business, account: accountId, status: { $nin: ["paid"] } });
  if (!statements.length) return;

  // One query for all jobs referenced by any statement (instead of N queries)
  const allJobIds = [...new Set(statements.flatMap((s) => s.jobs.map((l) => String(l.job))))];
  const jobs = await CarWashJob.find({ _id: { $in: allJobIds } }, { _id: 1, paymentStatus: 1 }).lean();
  const jobMap = new Map(jobs.map((j) => [String(j._id), j.paymentStatus]));

  await Promise.all(statements.map((stmt) => {
    const statuses = stmt.jobs.map((l) => jobMap.get(String(l.job)) || "unpaid");
    const allPaid = statuses.every((s) => s === "paid");
    const anyPaid = statuses.some((s) => s !== "unpaid");
    if (allPaid) stmt.status = "paid";
    else if (anyPaid) stmt.status = "partial";
    return stmt.save();
  }));
};

export const generateStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business })
      .populate("customer", "name phone").lean();
    if (!account) return next(createError(404, "Credit account not found"));

    // Default to the current calendar month if no period provided
    const now = new Date();
    const periodStart = req.body.periodStart
      ? new Date(req.body.periodStart)
      : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const periodEnd = req.body.periodEnd
      ? new Date(req.body.periodEnd)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

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
    ]);
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
    const openingBalance = round2(priorJobs.reduce((s, j) => s + j.price, 0) - priorPaid);

    const statementNumber = await generateStatementNumber(business, periodStart);
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
      .populate("account")
      .lean();
    if (!statement) return next(createError(404, "Statement not found"));
    res.json({ success: true, data: statement });
  } catch (err) {
    next(err);
  }
};

// ─── Send statement SMS ───────────────────────────────────────────────────────

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

// ─── Auto-billing: called on server startup + daily check ────────────────────
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

  const results = [];
  for (const account of dueAccounts) {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const existing = await CarWashAccountStatement.findOne({
      business: account.business,
      account: account._id,
      periodStart: { $gte: monthStart },
    }).lean();
    if (existing) continue;

    const periodStart = monthStart;
    const periodEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const jobs = await CarWashJob.find({
      business: account.business,
      creditAccount: account._id,
      status: { $nin: ["cancelled"] },
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).lean();

    if (!jobs.length) continue;

    const jobIds = jobs.map((j) => j._id);
    const paymentTotals = await CarWashPayment.aggregate([
      { $match: { business: account.business, job: { $in: jobIds } } },
      { $group: { _id: "$job", paid: { $sum: "$amount" } } },
    ]);
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
    const customer = await CarWashCustomer.findById(account.customer).lean();
    if (customer?.phone && totalOutstanding > 0) {
      const period = today.toLocaleString("en-KE", { month: "long", year: "numeric" });
      const body = await resolveCarWashSmsBody(account.business, "carwash_statement", {
        customerName:    customer.name,
        period,
        outstanding:     totalOutstanding.toLocaleString(),
        totalJobs:       jobs.length,
        statementNumber,
      }) || `Hi ${customer.name}, your car wash bill for ${period} is KES ${totalOutstanding.toLocaleString()} for ${jobs.length} wash(es). Ref: ${statementNumber}. Thank you!`;
      await sendAdHocSms({ businessId: account.business, phone: customer.phone, body, templateKey: "carwash_statement" }).catch(() => {});
      await CarWashAccountStatement.updateOne({ _id: stmt._id }, { status: "sent", sentAt: new Date() });
    }

    results.push({ account: account.accountNumber, statement: statementNumber, jobs: jobs.length, totalOutstanding });
  }

  return results;
};

// ─── Prepaid top-up ───────────────────────────────────────────────────────────

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

    // Credit the account balance
    account.accountCredit = round2((account.accountCredit || 0) + amount);
    account.updatedBy = userId;
    await account.save();

    // Post Dr Cashbook / Cr Revenue — revenue recognised at point of cash receipt
    await postCarWashTopupLedger({ businessId: business, topup, cashbookAccountId: cashbookAccount, userId });

    res.status(201).json({
      success: true,
      message: `Prepaid top-up of KES ${amount.toLocaleString()} recorded`,
      data: { topup, accountCredit: account.accountCredit },
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

// Called from the financials journal — no account ID required
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
      account.accountCredit = Math.max(0, round2((account.accountCredit || 0) - topup.amount));
      account.updatedBy = userId;
      await account.save();
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

    // Reduce the account credit by the voided amount
    const account = await CarWashCreditAccount.findOne({ _id: req.params.id, business });
    if (account) {
      account.accountCredit = Math.max(0, round2((account.accountCredit || 0) - topup.amount));
      account.updatedBy = userId;
      await account.save();
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
