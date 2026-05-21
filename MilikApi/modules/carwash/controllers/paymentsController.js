import { createError } from "../../../utils/error.js";
import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import { currentUserId, escapeRegex, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { accrueCommissionForJob, handleJobPaymentStatusAfterPaymentChange, markJobCommissionsPayable } from "../services/commissionService.js";
import { awardLoyaltyStamp, sendPaymentConfirmationSms } from "./loyaltyController.js";

const PAYMENT_METHODS = new Set(["cash", "mpesa", "bank", "card", "other"]);
const RECONCILIATION_STATUSES = new Set(["pending", "reconciled", "flagged"]);

const resolveCashbookAccount = async (business, value) => {
  const accountId = String(value || "").trim();
  if (!accountId) throw createError(400, "Cashbook account is required for Car Wash payments");
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw createError(400, "Invalid Car Wash payment cashbook account");
  }

  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business,
    type: "asset",
    isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();

  if (!account) {
    throw createError(400, "Select a valid posting cashbook account for this Car Wash payment");
  }

  return account._id;
};

const refreshJobPaymentStatus = async (business, jobId) => {
  const job = await CarWashJob.findOne({ _id: jobId, business });
  if (!job) throw createError(404, "Car Wash job not found");

  const totals = await CarWashPayment.aggregate([
    { $match: { business: job.business, job: job._id } },
    { $group: { _id: "$job", amount: { $sum: "$amount" } } },
  ]);
  const paidAmount = Number(totals?.[0]?.amount || 0);
  const price = Number(job.price || 0);
  job.paymentStatus = paidAmount <= 0 ? "unpaid" : paidAmount < price ? "partial" : "paid";
  if (job.paymentStatus === "paid" && job.status !== "cancelled") {
    job.status = "paid";
  } else if (job.status === "paid") {
    job.status = "done";
  }
  await job.save();
  return job;
};

export const listPayments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const branchId = resolveActiveBranchId(req);
    if (branchId) filter.branch = branchId;
    if (req.query.method) filter.method = String(req.query.method).trim().toLowerCase();
    if (req.query.cashbookAccount && mongoose.Types.ObjectId.isValid(String(req.query.cashbookAccount))) {
      filter.cashbookAccount = String(req.query.cashbookAccount);
    }
    if (req.query.reconciliationStatus) filter.reconciliationStatus = String(req.query.reconciliationStatus).trim().toLowerCase();
    if (req.query.reference) filter.reference = new RegExp(escapeRegex(String(req.query.reference).trim()), "i");
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.paymentDate = { $gte: start, $lt: end };
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;
    const [payments, total] = await Promise.all([
      CarWashPayment.find(filter)
        .populate("job", "jobNumber plateNumber customerName serviceName price status paymentStatus")
        .populate("cashbookAccount", "code name type subGroup")
        .populate("receivedBy", "name username email")
        .populate("branch", "name")
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarWashPayment.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { payments, pagination }, payments, pagination });
  } catch (error) {
    next(error);
  }
};

export const recordPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const jobId = req.body.job || req.params.jobId;
    const job = await CarWashJob.findOne({ _id: jobId, business }).lean();
    if (!job) return next(createError(404, "Car Wash job not found"));
    if (job.status === "cancelled") return next(createError(400, "Cannot record payment for a cancelled Car Wash job"));

    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Payment amount must be greater than zero"));
    const paidRows = await CarWashPayment.aggregate([
      { $match: { business: job.business, job: job._id } },
      { $group: { _id: "$job", amount: { $sum: "$amount" } } },
    ]);
    const alreadyPaid = Number(paidRows?.[0]?.amount || 0);
    const outstanding = Math.max(Number(job.price || 0) - alreadyPaid, 0);
    if (outstanding <= 0) return next(createError(400, "Car Wash job is already fully paid"));
    if (amount > outstanding) return next(createError(400, "Payment exceeds the outstanding Car Wash job balance"));

    const method = String(req.body.method || "cash").trim().toLowerCase();
    if (!PAYMENT_METHODS.has(method)) return next(createError(400, "Invalid Car Wash payment method"));
    const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount);

    const userId = currentUserId(req);
    const payment = await CarWashPayment.create({
      business,
      branch: job.branch || null,
      job: job._id,
      amount,
      method,
      cashbookAccount,
      reference: String(req.body.reference || "").trim(),
      paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : new Date(),
      receivedBy: userId,
      createdBy: userId,
      updatedBy: userId,
    });
    const updatedJob = await refreshJobPaymentStatus(business, job._id);
    await accrueCommissionForJob({ req, job: updatedJob });
    if (updatedJob.paymentStatus === "paid") {
      await markJobCommissionsPayable({ business, jobId: updatedJob._id });
      // Award loyalty stamp and send payment confirmation SMS (failures are silenced inside)
      await awardLoyaltyStamp({ business, job: updatedJob });
      await sendPaymentConfirmationSms({ business, job: updatedJob, amount });
    }
    res.status(201).json({ success: true, data: payment, payment, job: updatedJob, message: "Car Wash payment recorded" });
  } catch (error) {
    next(error);
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment = await CarWashPayment.findOne({ _id: req.params.id, business });
    if (!payment) return next(createError(404, "Car Wash payment not found"));
    const jobBeforeDelete = await CarWashJob.findOne({ _id: payment.job, business }).lean();
    if (!jobBeforeDelete) return next(createError(404, "Car Wash job not found"));

    const totals = await CarWashPayment.aggregate([
      { $match: { business: jobBeforeDelete.business, job: jobBeforeDelete._id } },
      { $group: { _id: "$job", amount: { $sum: "$amount" } } },
    ]);
    const paidAfterDelete = Number(totals?.[0]?.amount || 0) - Number(payment.amount || 0);
    const willRemainPaid = paidAfterDelete >= Number(jobBeforeDelete.price || 0);
    if (!willRemainPaid) {
      await handleJobPaymentStatusAfterPaymentChange({
        business,
        job: { ...jobBeforeDelete, paymentStatus: paidAfterDelete <= 0 ? "unpaid" : "partial" },
        checkOnly: true,
      });
    }

    await payment.deleteOne();
    const job = await refreshJobPaymentStatus(business, payment.job);
    await handleJobPaymentStatusAfterPaymentChange({ business, job });
    res.status(200).json({ success: true, job, message: "Car Wash payment deleted" });
  } catch (error) {
    next(error);
  }
};

export const updatePaymentReconciliation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status = String(req.body.reconciliationStatus || req.body.status || "").trim().toLowerCase();
    if (!RECONCILIATION_STATUSES.has(status)) return next(createError(400, "Invalid Car Wash reconciliation status"));

    const update = {
      reconciliationStatus: status,
      reconciliationNote: String(req.body.reconciliationNote || req.body.note || "").trim(),
      updatedBy: currentUserId(req),
    };
    if (status === "reconciled" || status === "flagged") {
      update.reconciledAt = new Date();
      update.reconciledBy = currentUserId(req);
    } else {
      update.reconciledAt = null;
      update.reconciledBy = null;
    }

    const payment = await CarWashPayment.findOneAndUpdate({ _id: req.params.id, business }, update, { new: true, runValidators: true })
      .populate("job", "jobNumber plateNumber customerName serviceName price status paymentStatus")
      .populate("cashbookAccount", "code name type subGroup")
      .populate("receivedBy", "name username email")
      .populate("reconciledBy", "name username email");
    if (!payment) return next(createError(404, "Car Wash payment not found"));
    res.status(200).json({ success: true, data: payment, payment, message: "Car Wash payment reconciliation updated" });
  } catch (error) {
    next(error);
  }
};
