import mongoose from "mongoose";
import CarWashJob from "../models/CarWashJob.js";
import Company from "../../../models/Company.js";

const eatNow = () => new Date(Date.now() + 3 * 60 * 60 * 1000);

const todayStartEAT = () => {
  const now = eatNow();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

export const getQueueDisplay = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(404).json({ error: "Not found" });
    }

    const company = await Company.findById(businessId).select("companyName modules").lean();
    if (!company?.modules?.carwash) {
      return res.status(404).json({ error: "Not found" });
    }

    const todayStart = todayStartEAT();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const jobs = await CarWashJob.find({
      business: businessId,
      status: { $in: ["waiting", "washing", "done", "paid"] },
      createdAt: { $gte: todayStart },
      // Fade out paid jobs after 1 hour so they don't clutter the screen
      $or: [
        { status: { $ne: "paid" } },
        { updatedAt: { $gte: oneHourAgo } },
      ],
    })
      .select("plateNumber itemDescription status serviceName serviceLines createdAt updatedAt jobType")
      .sort({ createdAt: 1 })
      .lean();

    const mapped = jobs.map((j) => ({
      _id:       j._id,
      plate:     j.plateNumber || j.itemDescription || "—",
      status:    j.status,
      service:   j.serviceLines?.length
        ? j.serviceLines.map((sl) => sl.serviceName).filter(Boolean).join(" + ")
        : j.serviceName || "",
      jobType:   j.jobType,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    }));

    res.json({
      success:  true,
      business: { name: company.companyName },
      jobs:     mapped,
    });
  } catch (error) {
    next(error);
  }
};
