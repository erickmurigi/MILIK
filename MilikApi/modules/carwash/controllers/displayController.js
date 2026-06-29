import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import CarWashJob from "../models/CarWashJob.js";
import Company from "../../../models/Company.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, "../../../uploads");

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

    const company = await Company.findById(businessId).select("companyName modules carwashSettings").lean();
    if (!company?.modules?.carwash) {
      return res.status(404).json({ error: "Not found" });
    }

    const todayStart = todayStartEAT();

    const jobs = await CarWashJob.find({
      business: businessId,
      status: { $in: ["waiting", "washing", "drying", "ready"] },
      createdAt: { $gte: todayStart },
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
      business: {
        name:       company.carwashSettings?.queueDisplayName?.trim() || company.companyName,
        queueBgImage: company.carwashSettings?.queueBgImage?.trim() || null,
      },
      jobs:     mapped,
    });
  } catch (error) {
    next(error);
  }
};

export const getQueueBgImage = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) return res.status(404).end();

    const company = await Company.findById(businessId)
      .select("carwashSettings.queueBgImage modules.carwash")
      .lean();
    if (!company?.modules?.carwash || !company?.carwashSettings?.queueBgImage) {
      return res.status(404).end();
    }

    const stored = company.carwashSettings.queueBgImage.trim();
    const relative = stored.replace(/^\/uploads\//, "");
    const filePath = path.resolve(UPLOADS_ROOT, relative);

    // Path traversal guard — resolved path must stay inside uploads root
    if (!filePath.startsWith(UPLOADS_ROOT + path.sep) && filePath !== UPLOADS_ROOT) {
      return res.status(400).end();
    }
    if (!fs.existsSync(filePath)) return res.status(404).end();

    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
};
