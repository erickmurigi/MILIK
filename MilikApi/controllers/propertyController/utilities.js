// controllers/utilityController.js
import Utility from "../../models/Utility.js";

const resolveBusinessId = (req) => {
  const requested = req.query?.business || req.body?.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  return authenticated || requested || null;
};

const scopedUtilityQuery = (req, id) => {
  const business = resolveBusinessId(req);
  if (!business) return null;
  return { _id: id, business };
};

// Create utility
export const createUtility = async (req, res, next) => {
  const business = resolveBusinessId(req);
  const newUtility = new Utility({ ...req.body, business });

  try {
    const savedUtility = await newUtility.save();
    res.status(200).json(savedUtility);
  } catch (err) {
    next(err);
  }
};

// Get all utilities
export const getUtilities = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const utilities = await Utility.find({ business }).sort({ name: 1 });
    res.status(200).json(utilities);
  } catch (err) {
    next(err);
  }
};

// Get single utility
export const getUtility = async (req, res, next) => {
  try {
    const utility = await Utility.findOne(scopedUtilityQuery(req, req.params.id));
    if (!utility) return res.status(404).json({ message: "Utility not found" });
    res.status(200).json(utility);
  } catch (err) {
    next(err);
  }
};

// Update utility
export const updateUtility = async (req, res, next) => {
  try {
    const updatedUtility = await Utility.findOneAndUpdate(
      scopedUtilityQuery(req, req.params.id),
      { $set: req.body },
      { new: true }
    );
    if (!updatedUtility) return res.status(404).json({ message: "Utility not found" });
    res.status(200).json(updatedUtility);
  } catch (err) {
    next(err);
  }
};

// Delete utility
export const deleteUtility = async (req, res, next) => {
  try {
    const deleted = await Utility.findOneAndDelete(scopedUtilityQuery(req, req.params.id));
    if (!deleted) return res.status(404).json({ message: "Utility not found" });
    res.status(200).json({ message: "Utility deleted successfully" });
  } catch (err) {
    next(err);
  }
};
