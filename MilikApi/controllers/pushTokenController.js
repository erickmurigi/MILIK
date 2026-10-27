import PushToken from "../models/PushToken.js";
import { createError } from "../utils/error.js";

export const registerPushToken = async (req, res, next) => {
  try {
    const { token, platform } = req.body || {};
    if (!token || typeof token !== "string") return next(createError(400, "token is required"));

    const userId = req.user?.id || req.user?._id;
    const companyId = req.userCompany || req.user?.company?._id || req.user?.company;
    if (!userId || !companyId) return next(createError(401, "You are not authenticated!"));

    await PushToken.findOneAndUpdate(
      { token },
      { token, user: userId, company: companyId, platform: platform === "ios" ? "ios" : "android", lastSeenAt: new Date() },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const unregisterPushToken = async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) return next(createError(400, "token is required"));
    await PushToken.deleteOne({ token });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};
