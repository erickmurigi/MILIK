import express from "express";
import mongoose from "mongoose";
import Unit from "../models/Unit.js";
import Company from "../models/Company.js";

const router = express.Router();

router.get("/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;

    if (!mongoose.isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: "Invalid business ID" });
    }

    const [business, listings] = await Promise.all([
      Company.findById(businessId)
        .select("companyName phoneNo logo slogan")
        .lean(),
      Unit.find({ business: businessId, listingEnabled: true, status: "vacant" })
        .select("unitNumber unitType rent deposit areaSqFt furnished amenities utilities images description vacantSince property")
        .populate(
          "property",
          "propertyName townCityState estateArea zoneRegion roadStreet propertyType images description coordinates specificContactInfo"
        )
        .sort({ vacantSince: -1 })
        .limit(200)
        .lean(),
    ]);

    if (!business) {
      return res.status(404).json({ success: false, message: "Business not found" });
    }

    return res.json({
      success: true,
      business: {
        companyName: business.companyName,
        phoneNo: business.phoneNo || "",
        logo: business.logo || "",
        slogan: business.slogan || "",
      },
      listings,
    });
  } catch (err) {
    console.error("Public listings error:", err);
    return res.status(500).json({ success: false, message: "Failed to load listings" });
  }
});

export default router;
