import { createError } from "../../../utils/error.js";
import { round2 } from "../../../utils/math.js";
import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashService from "../models/CarWashService.js";
import CarWashStaff from "../models/CarWashStaff.js";
import CarWashCreditAccount from "../models/CarWashCreditAccount.js";
import CarWashAccountStatement from "../models/CarWashAccountStatement.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import { currentUserId, escapeRegex, netJobPrice, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { accrueCommissionForJob, cancelJobCommissions, markJobCommissionsPayable } from "../services/commissionService.js";
import { carpetUpload, fileUrlFromName, deletePhotoFile } from "../middleware/carpetUpload.js";
import { autoEnrollPlate, awardLoyaltyStamp } from "./loyaltyController.js";
import { normalizePlate } from "../utils/plateUtils.js";
import { sendAdHocSms, sendAdHocSmsToMasked } from "../../../services/communicationService.js";
import { resolveCarWashSmsBody } from "../services/carwashSmsService.js";
import { recomputeCustomerStats, recomputeCustomerStatsForPlates } from "../services/customerStatsService.js";

const JOB_STATUSES = new Set(["waiting", "washing", "drying", "ready", "done", "cancelled"]);
const JOB_TYPES = new Set(["vehicle", "carpet", "balance_bf"]);

const generateJobNumber = async (business) => {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CW-${stamp}-`;
  const latest = await CarWashJob.findOne(
    { business, jobNumber: { $regex: `^${prefix}` } },
    { jobNumber: 1 },
    { sort: { jobNumber: -1 } }
  ).lean();
  const nextNum = latest ? parseInt(latest.jobNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// Validate and resolve multi-service lines from request body
const resolveServiceLines = async (business, rawLines) => {
  if (!Array.isArray(rawLines) || !rawLines.length) return null;
  const sliced = rawLines.slice(0, 20);

  // Batch-fetch all referenced services in one query
  const serviceIds = sliced
    .filter((r) => r.service && mongoose.Types.ObjectId.isValid(String(r.service)))
    .map((r) => String(r.service));
  const fetchedServices = serviceIds.length
    ? await CarWashService.find({ _id: { $in: serviceIds }, business }).lean()
    : [];
  const svcMap = new Map(fetchedServices.map((s) => [String(s._id), s]));

  const lines = [];
  for (const raw of sliced) {
    let serviceId = null;
    let serviceName = String(raw.serviceName || "").trim();
    let vehicleType = String(raw.vehicleType || "").trim();
    let price = Number(raw.price ?? 0);

    if (raw.service && mongoose.Types.ObjectId.isValid(String(raw.service))) {
      const svc = svcMap.get(String(raw.service));
      if (!svc) throw createError(400, "One or more selected services are invalid for this company");
      serviceId = svc._id;
      serviceName = serviceName || String(svc.name || "").trim();
      vehicleType = vehicleType || String(svc.vehicleType || "").trim();
      if (!raw.isRewardLine && (!Number.isFinite(price) || price <= 0)) price = Number(svc.defaultPrice ?? 0);
    }

    if (!serviceName) throw createError(400, "Each service line must have a service name");
    if (!Number.isFinite(price) || price < 0) throw createError(400, "Each service line must have a valid price");

    const lineStaff = Array.isArray(raw.lineStaff)
      ? raw.lineStaff.map(s => String(s)).filter(id => mongoose.Types.ObjectId.isValid(id))
      : (raw.lineStaff && mongoose.Types.ObjectId.isValid(String(raw.lineStaff)) ? [String(raw.lineStaff)] : []);
    const svc = svcMap.get(String(serviceId || ""));
    const lineTaxRate  = (svc?.isTaxable && Number(svc?.taxRate) > 0) ? Number(svc.taxRate) : 0;
    const lineTaxAmount = lineTaxRate > 0 ? Math.round((price * lineTaxRate / (100 + lineTaxRate)) * 100) / 100 : 0;
    lines.push({ service: serviceId, serviceName, vehicleType, price, lineStaff, isRewardLine: Boolean(raw.isRewardLine), taxRate: lineTaxRate, taxAmount: lineTaxAmount });
  }
  return lines;
};

// Legacy single-service resolver (backward compat)
const resolveServiceSnapshot = async (business, body = {}) => {
  if (!body.service) {
    return {
      service: null,
      serviceName: String(body.serviceName || "").trim(),
      vehicleType: String(body.vehicleType || "").trim(),
      price: Number(body.price || 0),
    };
  }

  const service = await CarWashService.findOne({ _id: body.service, business }).lean();
  if (!service) throw createError(400, "Selected Car Wash service is invalid for this company");

  const resolvedPrice  = Number(body.price ?? service.defaultPrice ?? 0);
  const snapshotTaxRate   = (service.isTaxable && Number(service.taxRate) > 0) ? Number(service.taxRate) : 0;
  const snapshotTaxAmount = snapshotTaxRate > 0 ? Math.round((resolvedPrice * snapshotTaxRate / (100 + snapshotTaxRate)) * 100) / 100 : 0;
  return {
    service: service._id,
    serviceName: String(body.serviceName || service.name || "").trim(),
    vehicleType: String(body.vehicleType || service.vehicleType || "").trim(),
    price: resolvedPrice,
    taxRate:   snapshotTaxRate,
    taxAmount: snapshotTaxAmount,
  };
};

// Validate array of staff IDs against the business
const assertStaffArrayBelongsToBusiness = async (business, rawStaff) => {
  const ids = [
    ...new Set(
      [].concat(rawStaff || [])
        .map((s) => String(s?._id || s))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ].slice(0, 5);
  if (!ids.length) return [];
  const found = await CarWashStaff.find({ _id: { $in: ids }, business }).select("_id").lean();
  if (found.length !== ids.length) throw createError(400, "One or more selected Car Wash staff members are invalid for this company");
  return found.map((s) => s._id);
};

const getJobDeleteBlocker = async (business, job) => {
  if (!job) return "Car Wash job not found";
  if (job.paymentStatus !== "unpaid" || job.status === "paid") {
    return "Only unpaid Car Wash jobs can be deleted";
  }
  const [payments, activeComms] = await Promise.all([
    CarWashPayment.countDocuments({ business, job: job._id }),
    CarWashStaffCommission.countDocuments({ business, job: job._id, status: { $in: ["earned", "payable", "paid"] } }),
  ]);
  if (payments > 0) return "Cannot delete a Car Wash job that has payments";
  if (activeComms > 0) return "Reverse all commissions for this job before deleting";
  return "";
};

const getPaidAmount = async (business, jobId) => {
  const rows = await CarWashPayment.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(String(business)), job: new mongoose.Types.ObjectId(String(jobId)) } },
    { $group: { _id: "$job", amount: { $sum: "$amount" } } },
  ]).allowDiskUse(true);
  return Number(rows?.[0]?.amount || 0);
};

const applyPaymentStatus = (job, paidAmount) => {
  const price = netJobPrice(job);
  job.paymentStatus = paidAmount <= 0 ? "unpaid" : paidAmount < price ? "partial" : "paid";
  // Rollback only: legacy-paid jobs whose payment is reversed revert to done
  if (job.status === "paid" && job.paymentStatus !== "paid") {
    job.status = "done";
  }
};

export const listJobs = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const filter = { business };
    if (branchId) filter.branch = branchId;
    if (req.query.jobType && JOB_TYPES.has(String(req.query.jobType).trim().toLowerCase())) filter.jobType = String(req.query.jobType).trim().toLowerCase();
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
    if (req.query.paymentStatus) filter.paymentStatus = String(req.query.paymentStatus).trim().toLowerCase();
    if (req.query.service && mongoose.Types.ObjectId.isValid(req.query.service)) {
      // Match both old root-level service and new serviceLines entries
      const svcId = new mongoose.Types.ObjectId(req.query.service);
      filter.$or = [{ service: svcId }, { "serviceLines.service": svcId }];
    }
    if (req.query.staff && mongoose.Types.ObjectId.isValid(req.query.staff)) {
      // assignedStaff is now an array â€” $elemMatch or direct equality both work
      filter.assignedStaff = new mongoose.Types.ObjectId(req.query.staff);
    }
    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {};
      if (req.query.dateFrom) {
        const from = new Date(req.query.dateFrom);
        from.setUTCHours(0, 0, 0, 0);
        filter.createdAt.$gte = from;
      }
      if (req.query.dateTo) {
        const to = new Date(req.query.dateTo);
        to.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    } else if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.createdAt = { $gte: start, $lt: end };
    }
    if (req.query.customer) {
      const customer = escapeRegex(String(req.query.customer).trim());
      const customerOr = [{ customerName: new RegExp(customer, "i") }, { phone: new RegExp(customer, "i") }];
      filter.$and = filter.$or
        ? [{ $or: filter.$or }, { $or: customerOr }]
        : [{ $or: customerOr }];
      delete filter.$or;
    }
    if (req.query.payLater !== undefined) filter.payLater = req.query.payLater === "true";
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      const plateSearch = escapeRegex(normalizePlate(String(req.query.search)));
      const searchOr = [
        { jobNumber: new RegExp(search, "i") },
        { plateNumber: new RegExp(plateSearch || search, "i") },
        { itemDescription: new RegExp(search, "i") },
        { customerName: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
      ];
      filter.$and = filter.$and ? [...filter.$and, { $or: searchOr }] : [{ $or: searchOr }];
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    let jobsQuery = CarWashJob.find(filter)
      .populate("service", "name category vehicleType defaultPrice")
      .populate("assignedStaff", "name phone role");
    if (!branchId) jobsQuery = jobsQuery.populate("branch", "name");
    const [jobs, total] = await Promise.all([
      jobsQuery.sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CarWashJob.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { jobs, pagination }, jobs, pagination });
  } catch (error) {
    next(error);
  }
};

export const getJob = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const jobId    = req.params.id;
    const [job, paidRows] = await Promise.all([
      CarWashJob.findOne({ _id: jobId, business })
        .populate("service", "name category vehicleType defaultPrice")
        .populate("serviceLines.service", "name category vehicleType defaultPrice")
        .populate("assignedStaff", "name phone role")
        .populate("creditAccount", "accountType contactPerson accountNumber")
        .lean(),
      CarWashPayment.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(String(business)), job: new mongoose.Types.ObjectId(String(jobId)) } },
        { $group: { _id: null, amount: { $sum: "$amount" } } },
      ]).allowDiskUse(true),
    ]);
    if (!job) return next(createError(404, "Car Wash job not found"));
    const amountPaid = Number(paidRows?.[0]?.amount || 0);
    const result = { ...job, amountPaid };
    res.status(200).json({ success: true, data: result, job: result });
  } catch (error) {
    next(error);
  }
};

export const createJob = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const jobType = JOB_TYPES.has(String(req.body.jobType || "").toLowerCase()) ? String(req.body.jobType).toLowerCase() : "vehicle";

    const plateNumber = normalizePlate(req.body.plateNumber || "");
    const itemDescription = String(req.body.itemDescription || "").trim();
    if (jobType === "vehicle" && !plateNumber) return next(createError(400, "Plate number is required for vehicle jobs"));
    if (jobType === "carpet" && !itemDescription) return next(createError(400, "Item description is required for carpet jobs"));
    // balance_bf: plate optional (debt may be known only by customer name)

    // Resolve service lines â€” new multi-line format takes priority
    let serviceLines = null;
    let rootService = null, rootServiceName = "", rootVehicleType = "", totalPrice = 0, totalTaxAmount = 0;

    if (Array.isArray(req.body.serviceLines) && req.body.serviceLines.length) {
      serviceLines = await resolveServiceLines(business, req.body.serviceLines);
      totalPrice = round2(serviceLines.reduce((s, l) => s + Number(l.price || 0), 0));
      totalTaxAmount = round2(serviceLines.reduce((s, l) => s + Number(l.taxAmount || 0), 0));
      // Keep root fields pointing to first line for backward compat with reports/filters
      rootService = serviceLines[0].service;
      rootServiceName = serviceLines.length === 1 ? serviceLines[0].serviceName : `${serviceLines[0].serviceName} +${serviceLines.length - 1} more`;
      rootVehicleType = serviceLines[0].vehicleType;
    } else {
      // Legacy single-service path
      const snapshot = await resolveServiceSnapshot(business, req.body);
      if (!snapshot.serviceName) return next(createError(400, "Service name is required"));
      if (!Number.isFinite(snapshot.price) || snapshot.price < 0) return next(createError(400, "Price must be a valid amount"));
      serviceLines = [{ service: snapshot.service, serviceName: snapshot.serviceName, vehicleType: snapshot.vehicleType, price: snapshot.price }];
      totalPrice = snapshot.price;
      totalTaxAmount = round2(Number(snapshot.taxAmount || 0));
      rootService = snapshot.service;
      rootServiceName = snapshot.serviceName;
      rootVehicleType = snapshot.vehicleType;
    }

    const hasRewardLine = serviceLines.some((l) => l.isRewardLine);
    if (totalPrice <= 0 && !req.body._allowZeroPrice && !hasRewardLine) {
      return next(createError(400, "Total job price must be greater than zero"));
    }

    const discountAmount = round2(Math.max(0, Number(req.body.discountAmount || 0)));
    if (discountAmount > totalPrice) {
      return next(createError(400, "Discount cannot exceed the total job price"));
    }
    if (discountAmount > 0) {
      const biz = await Company.findById(business).select("carwashSettings").lean();
      const minPrice = Number(biz?.carwashSettings?.discountMinJobPrice ?? 0);
      const maxPct   = Number(biz?.carwashSettings?.discountMaxPercent  ?? 0);
      if (minPrice > 0 && totalPrice <= minPrice) {
        return next(createError(400, `Discounts are only allowed on jobs above KES ${minPrice}`));
      }
      if (maxPct > 0) {
        const cap = round2(totalPrice * maxPct / 100);
        if (discountAmount > cap + 0.009) {
          return next(createError(400, `Discount cannot exceed ${maxPct}% (KES ${cap})`));
        }
      }
    }

    // Derive assignedStaff from service lines' per-line staff. Falls back to
    // req.body.assignedStaff for backward-compatibility with old clients.
    const derivedStaffIds = [...new Set(
      serviceLines.flatMap(l => Array.isArray(l.lineStaff) ? l.lineStaff : []).filter(Boolean)
    )];
    const staffSource = derivedStaffIds.length ? derivedStaffIds : (req.body.assignedStaff || []);
    const assignedStaff = await assertStaffArrayBelongsToBusiness(business, staffSource);

    const userId = currentUserId(req);
    const ctxBranch = resolveActiveBranchId(req);
    const bodyBranch = req.body.branch && mongoose.Types.ObjectId.isValid(String(req.body.branch)) ? String(req.body.branch) : null;
    const branchId = ctxBranch || bodyBranch;
    const expectedReadyAt = req.body.expectedReadyAt ? new Date(req.body.expectedReadyAt) : null;

    // Credit account validation
    let resolvedCreditAccount = null;
    let resolvedCreditAccountType = null;
    let resolvedCreditAccountCompanyName = "";
    const rawAccountId = req.body.creditAccount;
    if (rawAccountId && mongoose.Types.ObjectId.isValid(String(rawAccountId))) {
      const acc = await CarWashCreditAccount.findOne({ _id: String(rawAccountId), business, status: "active" })
        .select("_id accountType contactPerson accountNumber")
        .lean();
      if (!acc) return next(createError(400, "Credit account not found or not active"));
      resolvedCreditAccount = acc._id;
      resolvedCreditAccountType = acc.accountType;
      resolvedCreditAccountCompanyName = acc.contactPerson || acc.accountNumber || "";
    }

    // Auto-detect account by plate â€” covers prepaid, credit, and monthly accounts.
    // Voucher accounts are excluded: they are always selected manually by the supervisor.
    // Prepaid is prioritised so the wallet auto-deduction below still fires first.
    if (!resolvedCreditAccount && plateNumber && jobType === "vehicle") {
      const autoAcc = await CarWashCreditAccount.findOne({
        business,
        plates: plateNumber,
        status: "active",
        accountType: { $ne: "voucher" },
      }).sort({ accountType: -1 }).select("_id accountType").lean(); // prepaid > monthly > credit alphabetically desc
      if (autoAcc) {
        resolvedCreditAccount = autoAcc._id;
        resolvedCreditAccountType = autoAcc.accountType;
      }
    }

    const manualJobNumber = String(req.body.jobNumber || "").trim();
    const jobBase = {
      business,
      branch: branchId || null,
      jobType,
      customerName: String(req.body.customerName || "").trim(),
      phone: String(req.body.phone || "").trim(),
      plateNumber: (jobType === "vehicle" || jobType === "balance_bf") ? plateNumber : "",
      itemDescription: jobType === "carpet" ? itemDescription : "",
      expectedReadyAt: jobType === "carpet" && expectedReadyAt && !Number.isNaN(expectedReadyAt.getTime()) ? expectedReadyAt : null,
      // Root fields (backward compat)
      service: rootService,
      serviceName: rootServiceName,
      vehicleType: rootVehicleType,
      // Multi-line
      serviceLines,
      price: totalPrice,
      taxAmount: totalTaxAmount,
      rewardRedemption: hasRewardLine,
      discountAmount,
      status: JOB_STATUSES.has(String(req.body.status || "").toLowerCase()) ? String(req.body.status).toLowerCase() : "waiting",
      assignedStaff,
      creditAccount: resolvedCreditAccount,
      isVoucher: resolvedCreditAccountType === "voucher",
      voucherCompanyName: resolvedCreditAccountType === "voucher" ? resolvedCreditAccountCompanyName : "",
      paymentStatus: "unpaid",
      notes: String(req.body.notes || "").trim(),
      createdBy: userId,
      updatedBy: userId,
    };

    let job;
    for (let attempt = 0; attempt < 3; attempt++) {
      const jobNumber = manualJobNumber || (await generateJobNumber(business));
      try {
        job = await CarWashJob.create({ ...jobBase, jobNumber });
        break;
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.jobNumber && !manualJobNumber && attempt < 2) continue;
        throw err;
      }
    }

    if ((job.jobType === "vehicle" || job.jobType === "balance_bf") && job.plateNumber) {
      // Awaited â€” guarantees customer + loyalty card exist before response is sent.
      try {
        await autoEnrollPlate({ business, plate: job.plateNumber, customerName: job.customerName, phone: job.phone });
      } catch (err) {
        console.error("[CW Job] autoEnroll failed job=%s plate=%s: %s", job.jobNumber, job.plateNumber, err?.message || err);
      }

      // Award stamp for completed vehicle jobs â€” balance_bf is historical debt, not a new wash.
      // For done status: only credit account jobs earn the stamp here (cash/M-Pesa stamp fires on payment).
      const shouldStampOnCreate =
        job.jobType === "vehicle" &&
        !job.isVoucher &&
        (job.status === "paid" || (job.status === "done" && job.creditAccount));
      if (shouldStampOnCreate) {
        try {
          await awardLoyaltyStamp({ business, job });
        } catch (err) {
          console.error("[CW Loyalty] Stamp award failed job=%s: %s", job.jobNumber, err?.message || err);
        }
      }

      // Keep customer stats current
      recomputeCustomerStats(business, job.plateNumber).catch(() => {});

      // Register plate on the credit account â€” but not for voucher accounts (any plate can use any voucher)
      if (resolvedCreditAccount && job.plateNumber && resolvedCreditAccountType !== "voucher") {
        CarWashCreditAccount.updateOne(
          { _id: resolvedCreditAccount },
          { $addToSet: { plates: job.plateNumber } }
        ).catch(() => {});
      }
    }

    // Auto-apply prepaid credit â€” atomically deduct min(accountCredit, netPrice) with no race condition.
    // Uses a MongoDB 4.2+ aggregation-pipeline update so the read-modify-write is a single atomic op.
    const netPrice = round2(Math.max(0, totalPrice - discountAmount));
    if (resolvedCreditAccount && netPrice > 0 && resolvedCreditAccountType !== "voucher") {
      try {
        // Atomically floor accountCredit at 0 while returning the pre-update value.
        // The $max ensures we never store a negative balance even under concurrent requests.
        const prevAcc = await CarWashCreditAccount.findOneAndUpdate(
          { _id: resolvedCreditAccount, business, accountType: "prepaid", accountCredit: { $gt: 0.009 } },
          [{ $set: { accountCredit: { $max: [0, { $subtract: ["$accountCredit", netPrice] }] } } }],
          { new: false, lean: true }
        );
        if (prevAcc) {
          const autoApply = round2(Math.min(prevAcc.accountCredit, netPrice));
          await CarWashPayment.create({
            business,
            branch: branchId || null,
            job: job._id,
            amount: autoApply,
            method: "prepaid",
            reference: "Auto-deducted from prepaid balance",
            paymentDate: new Date(),
            createdBy: userId,
            updatedBy: userId,
          });
          const newPaymentStatus = autoApply >= netPrice - 0.009 ? "paid" : "partial";
          await CarWashJob.updateOne({ _id: job._id }, { paymentStatus: newPaymentStatus });
          job.paymentStatus = newPaymentStatus;
          // Accrue commission now that a payment exists
          accrueCommissionForJob({ req, job }).catch((err) =>
            console.error("[CW Job] Commission accrual failed (prepaid):", err?.message)
          );
          if (newPaymentStatus === "paid") {
            markJobCommissionsPayable({ business, jobId: job._id }).catch(() => {});
          }
        }
      } catch (err) {
        console.error("[CW Job] Prepaid auto-deduct failed:", err?.message);
      }
    }

    res.status(201).json({
      success: true,
      data: job,
      job,
      creditAccount: resolvedCreditAccount ? String(resolvedCreditAccount) : null,
      message: resolvedCreditAccount
        ? "Job created and charged to credit account"
        : `${jobType === "carpet" ? "Carpet" : "Car Wash"} job created`,
    });
  } catch (error) {
    next(error);
  }
};

export const updateJob = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const existing = await CarWashJob.findOne({ _id: req.params.id, business });
    if (!existing) return next(createError(404, "Car Wash job not found"));

    // Resolve service lines
    let serviceLines, rootService, rootServiceName, rootVehicleType, totalPrice;

    if (Array.isArray(req.body.serviceLines) && req.body.serviceLines.length) {
      serviceLines = await resolveServiceLines(business, req.body.serviceLines);
      totalPrice = round2(serviceLines.reduce((s, l) => s + Number(l.price || 0), 0));
      rootService = serviceLines[0].service;
      rootServiceName = serviceLines.length === 1 ? serviceLines[0].serviceName : `${serviceLines[0].serviceName} +${serviceLines.length - 1} more`;
      rootVehicleType = serviceLines[0].vehicleType;
    } else {
      // Fall back to legacy single-service merge
      const snapshot = await resolveServiceSnapshot(business, {
        service: req.body.service ?? existing.service,
        serviceName: req.body.serviceName ?? existing.serviceName,
        vehicleType: req.body.vehicleType ?? existing.vehicleType,
        price: req.body.price ?? existing.price,
      });
      serviceLines = existing.serviceLines?.length
        ? existing.serviceLines
        : [{ service: snapshot.service, serviceName: snapshot.serviceName, vehicleType: snapshot.vehicleType, price: snapshot.price }];
      totalPrice = snapshot.price;
      rootService = snapshot.service;
      rootServiceName = snapshot.serviceName;
      rootVehicleType = snapshot.vehicleType;
    }

    // Derive assignedStaff from service lines; fall back to existing/body for compat
    const derivedStaffIds = [...new Set(
      serviceLines.flatMap(l => Array.isArray(l.lineStaff) ? l.lineStaff : []).filter(Boolean)
    )];
    const rawStaff = derivedStaffIds.length ? derivedStaffIds
      : (req.body.assignedStaff !== undefined ? req.body.assignedStaff : existing.assignedStaff);
    const assignedStaff = await assertStaffArrayBelongsToBusiness(business, rawStaff);

    const status = String(req.body.status || existing.status).toLowerCase();
    if (!JOB_STATUSES.has(status)) return next(createError(400, "Invalid Car Wash job status"));
    if (status === "paid" && existing.paymentStatus !== "paid") {
      return next(createError(400, "Record payment before marking a Car Wash job as paid"));
    }

    existing.customerName = String(req.body.customerName ?? existing.customerName).trim();
    existing.phone = String(req.body.phone ?? existing.phone).trim();
    if (existing.jobType === "vehicle") {
      const updatedPlate = normalizePlate(req.body.plateNumber ?? existing.plateNumber);
      if (!updatedPlate) return next(createError(400, "Plate number is required for vehicle jobs"));
      if (updatedPlate !== existing.plateNumber && existing.paymentStatus === "paid") {
        return next(createError(400, "Plate number cannot be changed on a paid job"));
      }
      existing.plateNumber = updatedPlate;
    } else {
      const updatedItem = String(req.body.itemDescription ?? existing.itemDescription).trim();
      if (!updatedItem) return next(createError(400, "Item description is required for carpet jobs"));
      existing.itemDescription = updatedItem;
      if (req.body.expectedReadyAt !== undefined) {
        const d = req.body.expectedReadyAt ? new Date(req.body.expectedReadyAt) : null;
        existing.expectedReadyAt = d && !Number.isNaN(d.getTime()) ? d : null;
      }
    }

    if (existing.jobType === "vehicle" && req.body.creditAccount !== undefined) {
      if (existing.paymentStatus === "paid") {
        return next(createError(400, "Credit account cannot be changed on a paid job"));
      }
      const rawAccountId = req.body.creditAccount;
      if (rawAccountId && mongoose.Types.ObjectId.isValid(String(rawAccountId))) {
        const acc = await CarWashCreditAccount.findOne({ _id: String(rawAccountId), business, status: "active" })
          .select("_id accountType contactPerson accountNumber")
          .lean();
        if (!acc) return next(createError(400, "Credit account not found or not active"));
        existing.creditAccount = acc._id;
        existing.isVoucher = acc.accountType === "voucher";
        existing.voucherCompanyName = acc.accountType === "voucher" ? (acc.contactPerson || acc.accountNumber || "") : "";
      } else {
        existing.creditAccount = null;
        existing.isVoucher = false;
        existing.voucherCompanyName = "";
      }
    }

    const updatedDiscount = round2(Math.max(0, Number(req.body.discountAmount ?? existing.discountAmount ?? 0)));
    if (updatedDiscount > totalPrice) {
      return next(createError(400, "Discount cannot exceed the total job price"));
    }
    if (updatedDiscount > 0) {
      const biz = await Company.findById(business).select("carwashSettings").lean();
      const minPrice = Number(biz?.carwashSettings?.discountMinJobPrice ?? 0);
      const maxPct   = Number(biz?.carwashSettings?.discountMaxPercent  ?? 0);
      if (minPrice > 0 && totalPrice <= minPrice) {
        return next(createError(400, `Discounts are only allowed on jobs above KES ${minPrice}`));
      }
      if (maxPct > 0) {
        const cap = round2(totalPrice * maxPct / 100);
        if (updatedDiscount > cap + 0.009) {
          return next(createError(400, `Discount cannot exceed ${maxPct}% (KES ${cap})`));
        }
      }
    }

    existing.service = rootService;
    existing.serviceName = rootServiceName;
    existing.vehicleType = rootVehicleType;
    existing.serviceLines = serviceLines;
    existing.price = totalPrice;
    existing.discountAmount = updatedDiscount;
    existing.status = status;
    existing.assignedStaff = assignedStaff;
    existing.notes = String(req.body.notes ?? existing.notes).trim();
    existing.updatedBy = currentUserId(req);

    const paidAmount = await getPaidAmount(business, existing._id);
    const netPriceAfterDiscount = round2(Math.max(0, totalPrice - updatedDiscount));
    if (status === "cancelled" && paidAmount > 0) {
      return next(createError(400, "Cannot cancel a Car Wash job that already has payments"));
    }
    if (paidAmount > netPriceAfterDiscount) {
      return next(createError(400, "Job price cannot be lower than payments already recorded"));
    }
    applyPaymentStatus(existing, paidAmount);

    await existing.save();
    if (existing.paymentStatus === "paid" || existing.paymentStatus === "partial") {
      // Re-evaluate commissions with updated service lines/prices.
      // "paid" â†’ payable, "partial" â†’ earned. accrueCommissionForJob handles both.
      await accrueCommissionForJob({ req, job: existing });
      // Award stamp when paid OR when done (manual completion without payment).
      // awardLoyaltyStamp has a per-job idempotency guard, but we merge the two
      // conditions here to avoid the redundant DB call when paymentStatus===paid AND status===done.
      if (existing.paymentStatus === "paid" || existing.status === "done") {
        try {
          await awardLoyaltyStamp({ business, job: existing });
        } catch (err) {
          console.error("[CW Loyalty] Stamp award failed job=%s: %s", existing.jobNumber, err?.message || err);
        }
      }
    } else {
      // Unpaid or cancelled â€” cancel any pending commissions
      const cancelReason = existing.status === "cancelled"
        ? "Car Wash job was cancelled."
        : "Job not yet paid.";
      await cancelJobCommissions({ req, business, jobId: existing._id, reason: cancelReason });
      if (existing.status === "done") {
        try {
          await awardLoyaltyStamp({ business, job: existing });
        } catch (err) {
          console.error("[CW Loyalty] Stamp award failed job=%s: %s", existing.jobNumber, err?.message || err);
        }
      }
    }
    if (existing.plateNumber) recomputeCustomerStats(business, existing.plateNumber).catch(() => {});
    res.status(200).json({ success: true, data: existing, job: existing, message: "Car Wash job updated" });
  } catch (error) {
    next(error);
  }
};

export const updateJobStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status = String(req.body.status || "").trim().toLowerCase();
    if (!JOB_STATUSES.has(status)) return next(createError(400, "Invalid Car Wash job status"));

    if (status === "cancelled") {
      const paidAmount = await getPaidAmount(business, req.params.id);
      if (paidAmount > 0) return next(createError(400, "Cannot cancel a Car Wash job that already has payments"));
    }

    const updateFilter = { _id: req.params.id, business };
    if (status === "paid") updateFilter.paymentStatus = "paid";
    else if (status === "cancelled") updateFilter.paymentStatus = "unpaid";
    else updateFilter.$nor = [{ status: "done", paymentStatus: "paid" }];

    const job = await CarWashJob.findOneAndUpdate(
      updateFilter,
      { status, updatedBy: currentUserId(req) },
      { new: true, runValidators: true }
    );

    if (!job) {
      const exists = await CarWashJob.exists({ _id: req.params.id, business });
      if (!exists) return next(createError(404, "Car Wash job not found"));
      if (status === "paid") return next(createError(400, "Record payment before marking a Car Wash job as paid"));
      if (status === "cancelled") {
        const hasPayment = await CarWashPayment.exists({ business, job: req.params.id });
        if (hasPayment) return next(createError(400, "Cannot cancel a job that has payments â€” reverse the payments first."));
        return next(createError(404, "Car wash job not found"));
      }
      return next(createError(400, "This job is done and fully paid â€” its status cannot be changed."));
    }

    // Pre-paid job advanced to ready â†’ auto-mark done so it leaves washboard/queue display
    if (status === "ready" && job.paymentStatus === "paid") {
      job.status = "done";
      await CarWashJob.updateOne({ _id: job._id }, { status: "done" });
    }

    const effectiveStatus = job.status;

    if (effectiveStatus === "cancelled") {
      await cancelJobCommissions({ req, business, jobId: job._id, reason: "Car Wash job was cancelled." });
    } else {
      if (effectiveStatus === "done") {
        if (job.isVoucher) {
          // Voucher job â€” courtesy SMS to customer, no stamp
          resolveCarWashSmsBody(business, "carwash_voucher_completed", {
            customerName: job.customerName || "Customer",
            plate: job.plateNumber || "",
            voucherCompanyName: job.voucherCompanyName || "our partner",
          }).then((body) => {
            if (!body) return;
            const dest = job.maskedMsisdn || job.phone;
            if (!dest) return;
            const sender = job.maskedMsisdn
              ? sendAdHocSmsToMasked({ businessId: business, maskedNumber: job.maskedMsisdn, body, templateKey: "carwash_voucher_completed", recipientName: job.customerName || "" })
              : sendAdHocSms({ businessId: business, phone: dest, body, templateKey: "carwash_voucher_completed", recipientName: job.customerName || "" });
            sender.catch(() => {});
          }).catch(() => {});
        } else {
          try {
            await awardLoyaltyStamp({ business, job });
          } catch (err) {
            console.error("[CW Loyalty] Stamp award failed job=%s: %s", job.jobNumber, err?.message || err);
          }
        }
      }
    }
    if (job.plateNumber) recomputeCustomerStats(business, job.plateNumber).catch(() => {});
    res.status(200).json({ success: true, data: job, job, message: "Car Wash job status updated" });
  } catch (error) {
    next(error);
  }
};

export const markPayLater = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const job = await CarWashJob.findOneAndUpdate(
      {
        _id: req.params.id,
        business,
        paymentStatus: { $in: ["unpaid", "partial"] },
        status: "ready",
        payLater: { $ne: true },
      },
      {
        $set: {
          payLater: true,
          payLaterAt: new Date(),
          payLaterBy: currentUserId(req),
          status: "done",
          updatedBy: currentUserId(req),
        },
      },
      { new: true }
    );
    if (!job) return next(createError(400, "Job not found, already paid, or already marked pay-later"));
    res.json({ success: true, data: job, job, message: "Job marked as pay-later" });
  } catch (err) {
    next(err);
  }
};

export const deleteJob = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const job = await CarWashJob.findOne({ _id: req.params.id, business });
    if (!job) return next(createError(404, "Car Wash job not found"));
    const blocker = await getJobDeleteBlocker(business, job);
    if (blocker) return next(createError(400, blocker));
    await CarWashJob.deleteOne({ _id: job._id, business });
    if (job.plateNumber) recomputeCustomerStats(business, job.plateNumber).catch(() => {});

    // Clean up any statements that embedded this job's line
    if (job.creditAccount) {
      const r2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
      const affected = await CarWashAccountStatement.find(
        { business, account: job.creditAccount, "jobs.job": job._id },
        { _id: 1, jobs: 1, openingBalance: 1, status: 1 }
      ).lean();
      if (affected.length) {
        const toDelete = [], toUpdate = [];
        for (const stmt of affected) {
          const remaining = (stmt.jobs || []).filter((jl) => String(jl.job) !== String(job._id));
          if (!remaining.length) {
            toDelete.push(stmt._id);
          } else {
            let inv = 0, paid = 0;
            for (const l of remaining) { inv += l.price || 0; paid += l.paidAmount || 0; }
            const totalInvoiced = r2(inv), totalPaid = r2(paid), totalOutstanding = r2(inv - paid);
            toUpdate.push({ id: stmt._id, remaining, totalInvoiced, totalPaid, totalOutstanding, openingBalance: stmt.openingBalance, status: stmt.status });
          }
        }
        await Promise.all([
          toDelete.length && CarWashAccountStatement.deleteMany({ _id: { $in: toDelete } }),
          ...toUpdate.map(({ id, remaining, totalInvoiced, totalPaid, totalOutstanding, openingBalance, status }) =>
            CarWashAccountStatement.updateOne({ _id: id }, {
              jobs: remaining, totalJobs: remaining.length,
              totalInvoiced, totalPaid, totalOutstanding,
              closingBalance: r2((openingBalance || 0) + totalOutstanding),
              status: totalOutstanding <= 0 ? "paid" : status,
            })
          ),
        ].filter(Boolean));
      }
    }

    res.status(200).json({ success: true, message: "Car Wash job deleted" });
  } catch (error) {
    next(error);
  }
};

export const deleteJobsBulk = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).slice(0, 100) : [];
    if (!ids.length) return next(createError(400, "Select at least one Car Wash job to delete"));

    const jobs = await CarWashJob.find({ _id: { $in: ids }, business }).lean();
    const safeIds = [];
    const skipped = [];

    const jobObjectIds = jobs.map((j) => j._id);
    const businessOid = new mongoose.Types.ObjectId(String(business));
    const [paymentCounts, commissionCounts] = await Promise.all([
      CarWashPayment.aggregate([
        { $match: { business: businessOid, job: { $in: jobObjectIds } } },
        { $group: { _id: "$job", count: { $sum: 1 } } },
      ]).allowDiskUse(true),
      CarWashStaffCommission.aggregate([
        { $match: { business: businessOid, job: { $in: jobObjectIds }, status: { $in: ["earned", "payable", "paid"] } } },
        { $group: { _id: "$job", count: { $sum: 1 } } },
      ]).allowDiskUse(true),
    ]);
    const paymentsMap = new Map(paymentCounts.map((r) => [String(r._id), r.count]));
    const commissionsMap = new Map(commissionCounts.map((r) => [String(r._id), r.count]));

    for (const job of jobs) {
      if (!job) { skipped.push({ id: "", reason: "Car Wash job not found" }); continue; }
      if (job.paymentStatus !== "unpaid" || job.status === "paid") {
        skipped.push({ id: String(job._id), jobNumber: job.jobNumber, reason: "Only unpaid Car Wash jobs can be deleted" });
      } else if ((paymentsMap.get(String(job._id)) || 0) > 0) {
        skipped.push({ id: String(job._id), jobNumber: job.jobNumber, reason: "Cannot delete a Car Wash job that has payments" });
      } else if ((commissionsMap.get(String(job._id)) || 0) > 0) {
        skipped.push({ id: String(job._id), jobNumber: job.jobNumber, reason: "Reverse all commissions for this job before deleting" });
      } else {
        safeIds.push(job._id);
      }
    }

    let deletedCount = 0;
    if (safeIds.length) {
      const result = await CarWashJob.deleteMany({ _id: { $in: safeIds }, business });
      deletedCount = result.deletedCount || 0;
      // Recompute stats for each affected plate (deduplicated)
      const affectedPlates = [...new Set(jobs.filter((j) => safeIds.some((sid) => String(sid) === String(j._id)) && j.plateNumber).map((j) => j.plateNumber))];
      if (affectedPlates.length) recomputeCustomerStatsForPlates(business, affectedPlates).catch(() => {});
    }

    res.status(200).json({
      success: true,
      deletedCount,
      skipped,
      message: skipped.length ? "Safe Car Wash jobs deleted; locked jobs were skipped" : "Car Wash jobs deleted",
    });
  } catch (error) {
    next(error);
  }
};

export const sendJobSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const job = await CarWashJob.findOne({ _id: req.params.id, business }).lean();
    if (!job) throw createError(404, "Car Wash job not found");
    const phone = String(req.body.phone || job.phone || "").trim();
    const masked = String(job.maskedMsisdn || "").trim();
    const body = String(req.body.body || "").trim();
    if (!body) throw createError(400, "Message body is required");
    if (phone) {
      await sendAdHocSms({ businessId: business, phone, body, templateKey: "carwash_job_manual" });
    } else if (masked) {
      await sendAdHocSmsToMasked({ businessId: business, maskedNumber: masked, body, templateKey: "carwash_job_manual", recipientName: job.customerName || "Customer" });
    } else {
      throw createError(400, "No phone number available for this job");
    }
    res.json({ success: true, message: "SMS sent" });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Carpet photo upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const uploadJobPhotos = (req, res, next) => {
  carpetUpload(req, res, async (err) => {
    if (err) return next(createError(400, err?.message || "Photo upload failed"));
    try {
      const business = resolveActiveBusinessId(req);
      const job = await CarWashJob.findOne({ _id: req.params.id, business });
      if (!job) return next(createError(404, "Car Wash job not found"));
      if (job.jobType !== "carpet") return next(createError(400, "Photos can only be added to carpet jobs"));

      const newUrls = (req.files || []).map((f) => fileUrlFromName(f.filename));
      const total = (job.photos || []).length + newUrls.length;
      if (total > 5) {
        newUrls.forEach((url) => deletePhotoFile(url));
        return next(createError(400, "A job can have at most 5 photos"));
      }

      job.photos = [...(job.photos || []), ...newUrls];
      job.updatedBy = currentUserId(req);
      await job.save();
      res.status(201).json({ success: true, data: job, job, photos: job.photos, message: `${newUrls.length} photo(s) uploaded` });
    } catch (error) {
      next(error);
    }
  });
};

export const deleteJobPhoto = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const job = await CarWashJob.findOne({ _id: req.params.id, business });
    if (!job) return next(createError(404, "Car Wash job not found"));

    const photoUrl = decodeURIComponent(String(req.query.url || "").trim());
    if (!photoUrl || !job.photos?.includes(photoUrl)) {
      return next(createError(404, "Photo not found on this job"));
    }

    deletePhotoFile(photoUrl);
    job.photos = job.photos.filter((p) => p !== photoUrl);
    job.updatedBy = currentUserId(req);
    await job.save();
    res.json({ success: true, photos: job.photos, message: "Photo deleted" });
  } catch (error) {
    next(error);
  }
};
