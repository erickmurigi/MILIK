import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import ClientRevenueSchedule from "../models/ClientRevenueSchedule.js";
import { resolveActiveBusinessId, currentUserId } from "../services/businessScope.js";
import {
  billedVsRecognised,
  deferredRevenueBalance,
  deferredRevenueWaterfall,
  previewRevenueRecognition,
  recognizeMilestone,
  runRevenueRecognition,
} from "../services/clientRevenueService.js";
import { monthKeyOf } from "../services/clientLineMath.js";

const idOrNull = (v) => (v && mongoose.Types.ObjectId.isValid(String(v)) ? String(v) : null);
const previousMonth = () => {
  const now = new Date();
  return monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
};

export const listRevenueSchedules = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (idOrNull(req.query.contractId)) filter.contract = req.query.contractId;
    if (idOrNull(req.query.clientId)) filter.client = req.query.clientId;
    if (idOrNull(req.query.invoiceId)) filter.invoice = req.query.invoiceId;
    if (req.query.status) filter.status = String(req.query.status);
    const schedules = await ClientRevenueSchedule.find(filter)
      .populate("client", "name clientCode")
      .populate("incomeAccount", "code name")
      .sort({ servicePeriodStart: 1 })
      .lean();
    const rows = schedules.map((s) => ({
      ...s,
      unrecognized: Math.round((s.totalAmount - s.creditedAmount - s.recognizedAmount) * 100) / 100,
    }));
    res.status(200).json({ success: true, data: rows, schedules: rows });
  } catch (error) {
    next(error);
  }
};

export const previewRecognition = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const result = await previewRevenueRecognition({ business, throughMonth: req.query.throughMonth || previousMonth(), contractId: idOrNull(req.query.contractId) });
    res.status(200).json({ success: true, data: result, ...result });
  } catch (error) {
    next(error);
  }
};

export const runRecognition = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const result = await runRevenueRecognition({
      business,
      throughMonth: req.body?.throughMonth || previousMonth(),
      contractId: idOrNull(req.body?.contractId),
      userId: currentUserId(req),
    });
    await logAuditEvent({
      req, company: business, action: "client_revenue.recognition_run", category: "finance",
      message: `Revenue recognition through ${result.throughMonth}: ${result.recognized} month(s), ${result.total}`,
      metadata: result,
    });
    res.status(200).json({ success: true, data: result, ...result });
  } catch (error) {
    next(error);
  }
};

export const recognizeMilestoneHandler = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (!idOrNull(req.params.id)) return next(createError(400, "Invalid schedule id"));
    const schedule = await recognizeMilestone({
      business,
      scheduleId: req.params.id,
      amount: req.body?.amount,
      date: req.body?.date ? new Date(req.body.date) : new Date(),
      description: req.body?.description,
      userId: currentUserId(req),
    });
    await logAuditEvent({
      req, company: business, action: "client_revenue.milestone_recognized", category: "finance",
      targetType: "ClientRevenueSchedule", targetId: schedule._id, targetName: schedule.invoiceNumber,
      message: `Milestone revenue ${req.body?.amount} recognised on ${schedule.invoiceNumber}`,
    });
    res.status(200).json({ success: true, data: schedule, schedule });
  } catch (error) {
    next(error);
  }
};

export const deferredBalanceReport = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const result = await deferredRevenueBalance({ business, groupBy: req.query.groupBy === "contract" ? "contract" : "client" });
    res.status(200).json({ success: true, data: result, ...result });
  } catch (error) {
    next(error);
  }
};

export const waterfallReport = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const result = await deferredRevenueWaterfall({ business, months: req.query.months, fromMonth: req.query.fromMonth || null });
    res.status(200).json({ success: true, data: result, ...result });
  } catch (error) {
    next(error);
  }
};

export const billedVsRecognisedReport = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const now = new Date();
    const toMonth = req.query.toMonth || monthKeyOf(now);
    const fromMonth = req.query.fromMonth || monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)));
    const result = await billedVsRecognised({ business, fromMonth, toMonth });
    res.status(200).json({ success: true, data: result, ...result });
  } catch (error) {
    next(error);
  }
};
