import { createError } from "../../../utils/error.js";
import mongoose from "mongoose";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashService from "../models/CarWashService.js";
import CarWashStaff from "../models/CarWashStaff.js";
import { currentUserId, escapeRegex, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { accrueCommissionForJob, cancelJobCommissions } from "../services/commissionService.js";
import { autoEnrollPlate } from "./loyaltyController.js";
import { sendAdHocSms } from "../../../services/communicationService.js";

const JOB_STATUSES = new Set(["waiting", "washing", "done", "paid", "cancelled"]);
const JOB_TYPES = new Set(["vehicle", "carpet"]);

const generateJobNumber = async (business) => {
  const { start, end } = parseDateRange(new Date());
  const stamp = start.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await CarWashJob.countDocuments({ business, createdAt: { $gte: start, $lt: end } });
  return `CW-${stamp}-${String(count + 1).padStart(4, "0")}`;
};

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

  return {
    service: service._id,
    serviceName: String(body.serviceName || service.name || "").trim(),
    vehicleType: String(body.vehicleType || service.vehicleType || "").trim(),
    price: Number(body.price ?? service.defaultPrice ?? 0),
  };
};

const assertStaffBelongsToBusiness = async (business, staffId) => {
  if (!staffId) return null;
  const staff = await CarWashStaff.findOne({ _id: staffId, business }).select("_id").lean();
  if (!staff) throw createError(400, "Selected Car Wash staff member is invalid for this company");
  return staff._id;
};

const getJobDeleteBlocker = async (business, job) => {
  if (!job) return "Car Wash job not found";
  if (job.paymentStatus !== "unpaid" || job.status === "paid") {
    return "Only unpaid Car Wash jobs can be deleted";
  }
  const payments = await CarWashPayment.countDocuments({ business, job: job._id });
  if (payments > 0) return "Cannot delete a Car Wash job that has payments";
  return "";
};

const getPaidAmount = async (business, jobId) => {
  const rows = await CarWashPayment.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(String(business)), job: new mongoose.Types.ObjectId(String(jobId)) } },
    { $group: { _id: "$job", amount: { $sum: "$amount" } } },
  ]);
  return Number(rows?.[0]?.amount || 0);
};

const applyPaymentStatus = (job, paidAmount) => {
  const price = Number(job.price || 0);
  job.paymentStatus = paidAmount <= 0 ? "unpaid" : paidAmount < price ? "partial" : "paid";
  if (job.paymentStatus === "paid" && job.status !== "cancelled") {
    job.status = "paid";
  } else if (job.status === "paid") {
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
    if (req.query.service && mongoose.Types.ObjectId.isValid(req.query.service)) filter.service = req.query.service;
    if (req.query.staff && mongoose.Types.ObjectId.isValid(req.query.staff)) filter.assignedStaff = req.query.staff;
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.createdAt = { $gte: start, $lt: end };
    }
    if (req.query.customer) {
      const customer = escapeRegex(String(req.query.customer).trim());
      filter.$or = [{ customerName: new RegExp(customer, "i") }, { phone: new RegExp(customer, "i") }];
    }
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      const searchFilter = [
        { jobNumber: new RegExp(search, "i") },
        { plateNumber: new RegExp(search, "i") },
        { itemDescription: new RegExp(search, "i") },
        { customerName: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
      ];
      filter.$and = filter.$or ? [{ $or: filter.$or }, { $or: searchFilter }] : [{ $or: searchFilter }];
      delete filter.$or;
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      CarWashJob.find(filter)
        .populate("service", "name category vehicleType defaultPrice")
        .populate("assignedStaff", "name phone role")
        .populate(branchId ? null : "branch", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
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
    const job = await CarWashJob.findOne({ _id: req.params.id, business })
      .populate("service", "name category vehicleType defaultPrice")
      .populate("assignedStaff", "name phone role")
      .lean();
    if (!job) return next(createError(404, "Car Wash job not found"));
    res.status(200).json({ success: true, data: job, job });
  } catch (error) {
    next(error);
  }
};

export const createJob = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const jobType = JOB_TYPES.has(String(req.body.jobType || "").toLowerCase()) ? String(req.body.jobType).toLowerCase() : "vehicle";

    const plateNumber = String(req.body.plateNumber || "").trim().toUpperCase();
    const itemDescription = String(req.body.itemDescription || "").trim();
    if (jobType === "vehicle" && !plateNumber) return next(createError(400, "Plate number is required for vehicle jobs"));
    if (jobType === "carpet" && !itemDescription) return next(createError(400, "Item description is required for carpet jobs"));

    const serviceSnapshot = await resolveServiceSnapshot(business, req.body);
    if (!serviceSnapshot.serviceName) return next(createError(400, "Service name is required"));
    if (!Number.isFinite(serviceSnapshot.price) || serviceSnapshot.price < 0) {
      return next(createError(400, "Price must be a valid amount"));
    }

    const assignedStaff = await assertStaffBelongsToBusiness(business, req.body.assignedStaff);
    const userId = currentUserId(req);
    const branchId = resolveActiveBranchId(req);
    const expectedReadyAt = req.body.expectedReadyAt ? new Date(req.body.expectedReadyAt) : null;

    const manualJobNumber = String(req.body.jobNumber || "").trim();
    const jobBase = {
      business,
      branch: branchId || null,
      jobType,
      customerName: String(req.body.customerName || "").trim(),
      phone: String(req.body.phone || "").trim(),
      plateNumber: jobType === "vehicle" ? plateNumber : "",
      itemDescription: jobType === "carpet" ? itemDescription : "",
      expectedReadyAt: jobType === "carpet" && expectedReadyAt && !Number.isNaN(expectedReadyAt.getTime()) ? expectedReadyAt : null,
      ...serviceSnapshot,
      status: JOB_STATUSES.has(String(req.body.status || "").toLowerCase()) ? String(req.body.status).toLowerCase() : "waiting",
      assignedStaff,
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

    // Auto-enroll vehicle plate into loyalty program (fire-and-forget)
    if (job.jobType === "vehicle" && job.plateNumber) {
      autoEnrollPlate?.({
        business,
        plate: job.plateNumber,
        customerName: job.customerName,
        phone: job.phone,
      })?.catch(() => {});
    }

    res.status(201).json({ success: true, data: job, job, message: `${jobType === "carpet" ? "Carpet" : "Car Wash"} job created` });
  } catch (error) {
    next(error);
  }
};

export const updateJob = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const existing = await CarWashJob.findOne({ _id: req.params.id, business });
    if (!existing) return next(createError(404, "Car Wash job not found"));

    const serviceSnapshot = await resolveServiceSnapshot(business, {
      service: req.body.service ?? existing.service,
      serviceName: req.body.serviceName ?? existing.serviceName,
      vehicleType: req.body.vehicleType ?? existing.vehicleType,
      price: req.body.price ?? existing.price,
    });
    const assignedStaff = await assertStaffBelongsToBusiness(business, req.body.assignedStaff ?? existing.assignedStaff);
    const status = String(req.body.status || existing.status).toLowerCase();
    if (!JOB_STATUSES.has(status)) return next(createError(400, "Invalid Car Wash job status"));
    if (status === "paid" && existing.paymentStatus !== "paid") {
      return next(createError(400, "Record payment before marking a Car Wash job as paid"));
    }

    existing.customerName = String(req.body.customerName ?? existing.customerName).trim();
    existing.phone = String(req.body.phone ?? existing.phone).trim();
    if (existing.jobType === "vehicle") {
      const updatedPlate = String(req.body.plateNumber ?? existing.plateNumber).trim().toUpperCase();
      if (!updatedPlate) return next(createError(400, "Plate number is required for vehicle jobs"));
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
    existing.vehicleType = serviceSnapshot.vehicleType;
    existing.service = serviceSnapshot.service;
    existing.serviceName = serviceSnapshot.serviceName;
    existing.price = serviceSnapshot.price;
    existing.status = status;
    existing.assignedStaff = assignedStaff;
    existing.notes = String(req.body.notes ?? existing.notes).trim();
    existing.updatedBy = currentUserId(req);

    const paidAmount = await getPaidAmount(business, existing._id);
    if (status === "cancelled" && paidAmount > 0) {
      return next(createError(400, "Cannot cancel a Car Wash job that already has payments"));
    }
    if (paidAmount > Number(existing.price || 0)) {
      return next(createError(400, "Job price cannot be lower than payments already recorded"));
    }
    applyPaymentStatus(existing, paidAmount);

    await existing.save();
    if (existing.status === "cancelled") {
      await cancelJobCommissions({ req, business, jobId: existing._id });
    } else if (!["done", "paid"].includes(existing.status)) {
      await cancelJobCommissions({
        req,
        business,
        jobId: existing._id,
        reason: "Cancelled because the Car Wash job was moved out of the completed workflow.",
      });
    } else {
      await accrueCommissionForJob({ req, job: existing });
    }
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
    else if (status !== "cancelled") updateFilter.paymentStatus = { $ne: "paid" };

    const job = await CarWashJob.findOneAndUpdate(
      updateFilter,
      { status, updatedBy: currentUserId(req) },
      { new: true, runValidators: true }
    );

    if (!job) {
      const exists = await CarWashJob.exists({ _id: req.params.id, business });
      if (!exists) return next(createError(404, "Car Wash job not found"));
      if (status === "paid") return next(createError(400, "Record payment before marking a Car Wash job as paid"));
      return next(createError(400, "A fully paid Car Wash job cannot be moved back to an active status"));
    }

    if (status === "cancelled") {
      await cancelJobCommissions({ req, business, jobId: job._id });
    } else if (!["done", "paid"].includes(status)) {
      await cancelJobCommissions({
        req,
        business,
        jobId: job._id,
        reason: "Cancelled because the Car Wash job was moved out of the completed workflow.",
      });
    } else {
      await accrueCommissionForJob({ req, job });
    }
    res.status(200).json({ success: true, data: job, job, message: "Car Wash job status updated" });
  } catch (error) {
    next(error);
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

    const jobs = await CarWashJob.find({ _id: { $in: ids }, business });
    const safeIds = [];
    const skipped = [];

    const paymentCounts = await CarWashPayment.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)), job: { $in: jobs.map((j) => j._id) } } },
      { $group: { _id: "$job", count: { $sum: 1 } } },
    ]);
    const paymentsMap = new Map(paymentCounts.map((r) => [String(r._id), r.count]));

    for (const job of jobs) {
      if (!job) { skipped.push({ id: "", reason: "Car Wash job not found" }); continue; }
      if (job.paymentStatus !== "unpaid" || job.status === "paid") {
        skipped.push({ id: String(job._id), jobNumber: job.jobNumber, reason: "Only unpaid Car Wash jobs can be deleted" });
      } else if ((paymentsMap.get(String(job._id)) || 0) > 0) {
        skipped.push({ id: String(job._id), jobNumber: job.jobNumber, reason: "Cannot delete a Car Wash job that has payments" });
      } else {
        safeIds.push(job._id);
      }
    }

    let deletedCount = 0;
    if (safeIds.length) {
      const result = await CarWashJob.deleteMany({ _id: { $in: safeIds }, business });
      deletedCount = result.deletedCount || 0;
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
    if (!phone) throw createError(400, "No phone number available for this job");
    const body = String(req.body.body || "").trim();
    if (!body) throw createError(400, "Message body is required");
    await sendAdHocSms({ businessId: business, phone, body, templateKey: "carwash_job_manual" });
    res.json({ success: true, message: "SMS sent" });
  } catch (err) {
    next(err);
  }
};
