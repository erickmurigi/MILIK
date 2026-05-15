import { createError } from "../../../utils/error.js";
import SaleBuyer from "../models/SaleBuyer.js";
import { currentUserId, escapeRegex, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

export const listBuyers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", source = "", kycStatus = "" } = req.query;
    const filter = { business };
    if (source) filter.source = source;
    if (kycStatus) filter.kycStatus = kycStatus;
    if (search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ fullName: rx }, { buyerNumber: rx }, { phone: rx }, { email: rx }, { idNumber: rx }];
    }
    const buyers = await SaleBuyer.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json(buyers);
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
    await buyer.deleteOne();
    res.status(200).json({ message: "Buyer deleted" });
  } catch (err) {
    next(err);
  }
};
