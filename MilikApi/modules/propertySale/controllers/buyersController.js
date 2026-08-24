import { createError } from "../../../utils/error.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleLead from "../models/SaleLead.js";
import SaleOffer from "../models/SaleOffer.js";
import Company from "../../../models/Company.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { sendAdHocSms, sendAdHocEmail } from "../../../services/communicationService.js";

const fillPlaceholders = (text, vars) =>
  String(text || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

export const listBuyers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", source = "", kycStatus = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (source) filter.source = source;
    if (kycStatus) filter.kycStatus = kycStatus;
    if (search.trim()) {
      filter.$text = { $search: search.trim() };
    }
    const [buyers, total] = await Promise.all([
      SaleBuyer.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      SaleBuyer.countDocuments(filter),
    ]);
    res.status(200).json({ data: buyers, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) {
    next(err);
  }
};

export const getBuyer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const buyer = await SaleBuyer.findOne({ _id: req.params.id, business }).lean();
    if (!buyer) return next(createError(404, "Buyer not found"));
    res.status(200).json(buyer);
  } catch (err) {
    next(err);
  }
};

export const createBuyer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const buyerNumber = await generateSequentialNumber(SaleBuyer, business, "BYR");
    const buyer = await SaleBuyer.create({
      ...req.body,
      business,
      buyerNumber,
      createdBy: userId,
      updatedBy: userId,
    });
    res.status(201).json(buyer);
  } catch (err) {
    next(err);
  }
};

export const updateBuyer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, buyerNumber: _n, createdBy: _c, ...updates } = req.body;
    const buyer = await SaleBuyer.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    );
    if (!buyer) return next(createError(404, "Buyer not found"));
    res.status(200).json(buyer);
  } catch (err) {
    next(err);
  }
};

export const deleteBuyer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const buyer = await SaleBuyer.findOne({ _id: req.params.id, business });
    if (!buyer) return next(createError(404, "Buyer not found"));

    const [deals, offers] = await Promise.all([
      SaleDeal.countDocuments({ business, buyer: buyer._id }),
      SaleOffer.countDocuments({ business, buyer: buyer._id }),
    ]);
    if (deals > 0 || offers > 0) {
      return next(createError(400, `Cannot delete buyer with existing records (${deals} deals, ${offers} offers)`));
    }

    await buyer.deleteOne();

    // Unlink the parent lead so it re-enters the pipeline
    await SaleLead.updateOne(
      { business, convertedBuyer: buyer._id },
      { $set: { convertedBuyer: null, convertedAt: null, status: "negotiating" } }
    );

    res.status(200).json({ message: "Buyer deleted" });
  } catch (err) {
    next(err);
  }
};

export const sendBuyerSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const buyer = await SaleBuyer.findOne({ _id: req.params.id, business }).lean();
    if (!buyer) return next(createError(404, "Buyer not found"));
    const phone = String(req.body.phone || buyer.phone || "").trim();
    const body  = String(req.body.body || "").trim();
    if (!phone) return next(createError(400, "Buyer has no phone number"));
    if (!body)  return next(createError(400, "Message body is required"));
    await sendAdHocSms({ businessId: business, phone, body, templateKey: "sale_buyer_manual" });
    res.json({ success: true, message: "SMS sent" });
  } catch (err) {
    next(err);
  }
};

export const sendBuyerEmail = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const [buyer, company] = await Promise.all([
      SaleBuyer.findOne({ _id: req.params.id, business }).lean(),
      Company.findById(business).select("companyName name phoneNo email").lean(),
    ]);
    if (!buyer) return next(createError(404, "Buyer not found"));
    const to      = String(req.body.to      || buyer.email || "").trim();
    const subject = String(req.body.subject || "").trim();
    const body    = String(req.body.body    || "").trim();
    if (!to)      return next(createError(400, "Buyer has no email address"));
    if (!subject) return next(createError(400, "Email subject is required"));
    if (!body)    return next(createError(400, "Email body is required"));
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const vars = {
      buyerName:        buyer.fullName    || "Buyer",
      buyerNumber:      buyer.buyerNumber || "",
      phone:            buyer.phone       || "",
      email:            buyer.email       || "",
      idNumber:         buyer.idNumber    || "",
      kycStatus:        buyer.kycStatus   || "",
      source:           buyer.source      || "",
      registrationDate: fmtDate(buyer.createdAt),
      companyName:      company?.companyName || company?.name || "",
      companyPhone:     company?.phoneNo  || "",
      companyEmail:     company?.email    || "",
    };
    await sendAdHocEmail({ businessId: business, to, subject: fillPlaceholders(subject, vars), bodyText: fillPlaceholders(body, vars) });
    res.json({ success: true, message: "Email sent" });
  } catch (err) {
    next(err);
  }
};
