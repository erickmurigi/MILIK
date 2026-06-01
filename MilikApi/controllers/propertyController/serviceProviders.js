import mongoose from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const resolveBusinessId = (req) =>
  req?.query?.business ||
  req?.query?.company ||
  req?.body?.business ||
  req?.body?.company ||
  req?.user?.company?._id ||
  req?.user?.company ||
  null;

const generateProviderCode = async (businessId) => {
  const prefix = "SP";
  const last = await ServiceProvider.findOne(
    { business: businessId, providerCode: { $regex: `^${prefix}\\d+$` } },
    { providerCode: 1 },
    { sort: { createdAt: -1 } }
  ).lean();

  const seq = last?.providerCode ? (parseInt(last.providerCode.replace(prefix, ""), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

export const createServiceProvider = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Service provider name is required" });

    const doc = await ServiceProvider.create({
      business: businessId,
      providerCode: await generateProviderCode(businessId),
      name,
      contactPerson: req.body?.contactPerson || "",
      email: req.body?.email || "",
      phone: req.body?.phone || "",
      category: req.body?.category || "general",
      kraPin: req.body?.kraPin || "",
      accountNumber: req.body?.accountNumber || "",
      paybillNumber: req.body?.paybillNumber || "",
      bankName: req.body?.bankName || "",
      accountName: req.body?.accountName || "",
      isActive: req.body?.isActive !== false,
      notes: req.body?.notes || "",
    });

    res.status(201).json(doc);
  } catch (error) {
    next(error);
  }
};

export const getServiceProviders = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const filter = { business: businessId };
    if (req.query?.active === "true") filter.isActive = true;
    if (req.query?.active === "false") filter.isActive = false;
    const searchTerm = escapeRegex(String(req.query?.search || "").trim());
    const nameFilter = String(req.query?.name || "").trim();
    const categoryFilter = String(req.query?.category || "").trim();

    if (nameFilter) {
      filter.name = { $regex: nameFilter, $options: "i" };
    }

    if (categoryFilter && categoryFilter !== "all") {
      filter.category = { $regex: `^${categoryFilter}$`, $options: "i" };
    }

    if (searchTerm) {
      filter.$or = [
        { providerCode: { $regex: searchTerm, $options: "i" } },
        { name: { $regex: searchTerm, $options: "i" } },
        { contactPerson: { $regex: searchTerm, $options: "i" } },
        { email: { $regex: searchTerm, $options: "i" } },
        { phone: { $regex: searchTerm, $options: "i" } },
        { category: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const [rows, total] = await Promise.all([
      ServiceProvider.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      ServiceProvider.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: rows, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (error) {
    next(error);
  }
};

export const updateServiceProvider = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const row = await ServiceProvider.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Service provider not found" });

    const allowed = ["name", "contactPerson", "email", "phone", "category", "kraPin", "accountNumber", "paybillNumber", "bankName", "accountName", "isActive", "notes"];
    allowed.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) return;
      if (field === "name") {
        row[field] = String(req.body[field] || "").trim();
        return;
      }
      row[field] = req.body[field];
    });

    if (!String(row.name || "").trim()) {
      return res.status(400).json({ success: false, message: "Service provider name is required" });
    }
    await row.save();
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
};

export const deleteServiceProvider = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const row = await ServiceProvider.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Service provider not found" });
    await ServiceProvider.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({ success: true, message: "Service provider deleted" });
  } catch (error) {
    next(error);
  }
};

export const getCreditorsSummary = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const businessIdObj = new mongoose.Types.ObjectId(String(businessId));

    const providers = await ServiceProvider.find({ business: businessId }).sort({ name: 1 }).lean();
    if (!providers.length) return res.status(200).json([]);

    const providerIds = providers.map((p) => p._id);

    // Aggregate invoiced amounts from approved/submitted/converted requisitions
    const reqAgg = await ExpenseRequisition.aggregate([
      { $match: { business: businessIdObj, serviceProvider: { $in: providerIds } } },
      {
        $group: {
          _id: "$serviceProvider",
          totalInvoiced: {
            $sum: {
              $cond: [{ $in: ["$status", ["submitted", "approved", "converted"]] }, "$amount", 0],
            },
          },
          reqIds: { $push: "$_id" },
        },
      },
    ]);

    const allReqIds = reqAgg.flatMap((r) => r.reqIds);
    const paidByProvider = new Map();

    if (allReqIds.length) {
      const paidAgg = await PaymentVoucher.aggregate([
        { $match: { business: businessIdObj, sourceRequisition: { $in: allReqIds }, status: "paid" } },
        { $lookup: { from: "expenserequisitions", localField: "sourceRequisition", foreignField: "_id", as: "req" } },
        { $unwind: { path: "$req", preserveNullAndEmpty: false } },
        { $group: { _id: "$req.serviceProvider", totalPaid: { $sum: "$amount" } } },
      ]);
      paidAgg.forEach((r) => paidByProvider.set(String(r._id), r.totalPaid));
    }

    const reqByProvider = new Map();
    reqAgg.forEach((r) => reqByProvider.set(String(r._id), r));

    const result = providers.map((p) => {
      const rData = reqByProvider.get(String(p._id)) || {};
      const totalInvoiced = rData.totalInvoiced || 0;
      const totalPaid = paidByProvider.get(String(p._id)) || 0;
      return { ...p, totalInvoiced, totalPaid, outstanding: totalInvoiced - totalPaid };
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getCreditorStatement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const providerId = req.params.id;
    if (!isValidObjectId(providerId)) return res.status(400).json({ success: false, message: "Invalid provider ID" });

    const provider = await ServiceProvider.findOne({ _id: providerId, business: businessId }).lean();
    if (!provider) return res.status(404).json({ success: false, message: "Service provider not found" });

    const requisitions = await ExpenseRequisition.find({
      business: businessId,
      serviceProvider: providerId,
      status: { $in: ["submitted", "approved", "converted", "rejected", "cancelled"] },
    })
      .sort({ requestDate: 1, createdAt: 1 })
      .lean();

    const reqIds = requisitions.map((r) => r._id);
    const vouchers = reqIds.length
      ? await PaymentVoucher.find({
          business: businessId,
          sourceRequisition: { $in: reqIds },
          status: { $in: ["approved", "paid"] },
        })
          .sort({ paidDate: 1, createdAt: 1 })
          .lean()
      : [];

    const vouchersByReqId = new Map();
    vouchers.forEach((v) => {
      const key = String(v.sourceRequisition);
      if (!vouchersByReqId.has(key)) vouchersByReqId.set(key, []);
      vouchersByReqId.get(key).push(v);
    });

    const lines = [];
    for (const req of requisitions) {
      lines.push({
        date: req.requestDate || req.createdAt,
        ref: req.requisitionNo || req.referenceNo || "",
        type: "invoice",
        description: req.title || req.description || "",
        status: req.status,
        invoiced: req.amount || 0,
        paid: 0,
      });
      const linked = vouchersByReqId.get(String(req._id)) || [];
      for (const v of linked) {
        if (v.status === "paid") {
          lines.push({
            date: v.paidDate || v.paidAt || v.createdAt,
            ref: v.voucherNo || "",
            type: "payment",
            description: v.narration || `Payment against ${req.requisitionNo || req.referenceNo || ""}`,
            status: v.status,
            invoiced: 0,
            paid: v.amount || 0,
          });
        }
      }
    }

    lines.sort((a, b) => new Date(a.date) - new Date(b.date));

    let balance = 0;
    for (const line of lines) {
      balance += line.invoiced - line.paid;
      line.balance = balance;
    }

    const totalInvoiced = lines.reduce((s, l) => s + l.invoiced, 0);
    const totalPaid = lines.reduce((s, l) => s + l.paid, 0);

    res.status(200).json({
      provider,
      lines,
      summary: { totalInvoiced, totalPaid, outstanding: totalInvoiced - totalPaid },
    });
  } catch (error) {
    next(error);
  }
};
