import mongoose from "mongoose";
import ServiceProvider from "../../models/ServiceProvider.js";

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
    if (req.query?.search) {
      const term = String(req.query.search).trim();
      filter.$or = [
        { providerCode: { $regex: term, $options: "i" } },
        { name: { $regex: term, $options: "i" } },
        { contactPerson: { $regex: term, $options: "i" } },
        { email: { $regex: term, $options: "i" } },
        { phone: { $regex: term, $options: "i" } },
        { category: { $regex: term, $options: "i" } },
      ];
    }

    const rows = await ServiceProvider.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json(rows);
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
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) row[field] = req.body[field];
    });
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
