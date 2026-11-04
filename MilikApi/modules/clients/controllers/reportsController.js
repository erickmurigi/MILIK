// Client reports — thin wrappers over services/clientReportsService.js.
import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import {
  getArAging,
  getDashboardKpis,
  getBillingForecast,
  getRevenueBreakdown,
  getContractRegister,
  getRenewalsAndExpiries,
  getSalesVatReport,
  getWhtCertificatesReport,
} from "../services/clientReportsService.js";

const idOrNull = (value) => (mongoose.Types.ObjectId.isValid(String(value || "")) ? String(value) : null);
const validDate = (value) => (value && !Number.isNaN(new Date(value).getTime()) ? value : null);

const handler = (build) => async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    for (const key of ["from", "to", "asOf"]) {
      if (req.query[key] && !validDate(req.query[key])) return next(createError(400, `Invalid ${key} date`));
    }
    const data = await build({ business, q: req.query });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const arAging = handler(({ business, q }) => getArAging({
  business,
  asOf: q.asOf || null,
  groupBy: q.groupBy === "owner" ? "owner" : "client",
  clientId: idOrNull(q.clientId),
  ownerId: idOrNull(q.ownerId),
  page: q.page,
  limit: q.limit,
}));

export const dashboard = handler(({ business, q }) => getDashboardKpis({ business, from: q.from, to: q.to }));

export const billingForecast = handler(({ business, q }) => getBillingForecast({ business, months: q.months, clientId: idOrNull(q.clientId) }));

export const revenue = handler(({ business, q }) => getRevenueBreakdown({
  business,
  from: q.from,
  to: q.to,
  groupBy: ["client", "service", "owner"].includes(q.groupBy) ? q.groupBy : "client",
  page: q.page,
  limit: q.limit,
}));

export const contractRegister = handler(({ business, q }) => getContractRegister({
  business,
  status: q.status ? String(q.status) : null,
  clientId: idOrNull(q.clientId),
  search: q.search || "",
  page: q.page,
  limit: q.limit,
}));

export const renewals = handler(({ business, q }) => getRenewalsAndExpiries({ business, days: q.days, pastDays: q.pastDays, page: q.page, limit: q.limit }));

export const salesVat = handler(({ business, q }) => getSalesVatReport({ business, from: q.from, to: q.to, page: q.page, limit: q.limit }));

export const whtCertificates = handler(({ business, q }) => getWhtCertificatesReport({
  business,
  status: q.status || "expected",
  clientId: idOrNull(q.clientId),
  type: ["income_tax", "vat"].includes(q.type) ? q.type : null,
  page: q.page,
  limit: q.limit,
}));
