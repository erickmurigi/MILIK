import express from "express";
import mongoose from "mongoose";
import Unit from "../models/Unit.js";
import Company from "../models/Company.js";
import RentalListingLead from "../models/RentalListingLead.js";
import { nextSequenceNumber } from "../utils/sequenceService.js";
import { escapeRegex } from "../utils/escapeRegex.js";

const router = express.Router();

const UNIT_PUBLIC_FIELDS =
  "unitNumber unitType listingTitle slug featured rent deposit areaSqFt furnished bedrooms bathrooms parkingSpaces floorNumber petsAllowed rentNegotiable minimumLeaseTermMonths videoUrl virtualTourUrl amenities utilities images description status vacantSince availableFrom property";

const PROPERTY_PUBLIC_FIELDS =
  "propertyName slug townCityState estateArea zoneRegion roadStreet propertyType images description coordinates specificContactInfo listingContact amenities nearbyPoints yearBuilt verified";

// A unit is public-listable once it's actually vacant, or it's occupied but
// carries an availableFrom date (tenant has given notice) so it can be
// marketed ahead of the actual move-out.
const buildListableFilter = (businessId) => ({
  business: businessId,
  listingEnabled: true,
  $or: [{ status: "vacant" }, { status: "occupied", availableFrom: { $ne: null } }],
});

const LISTABLE_STATUS_MATCH = {
  listingEnabled: true,
  $or: [{ status: "vacant" }, { status: "occupied", availableFrom: { $ne: null } }],
};

// Properties saved before these listing fields existed on the schema were
// never re-saved, so `.lean()` reads simply omit the keys (Mongoose only
// backfills defaults on hydrated documents, not on lean reads of old data).
// Normalize here so the public API always has a consistent shape.
const normalizeProperty = (property = {}) => ({
  ...property,
  description: property.description || "",
  specificContactInfo: property.specificContactInfo || "",
  amenities: Array.isArray(property.amenities) ? property.amenities : [],
  nearbyPoints: Array.isArray(property.nearbyPoints) ? property.nearbyPoints : [],
  listingContact: property.listingContact || {},
  yearBuilt: property.yearBuilt ?? null,
  verified: Boolean(property.verified),
  coordinates: property.coordinates || { lat: null, lng: null },
  images: Array.isArray(property.images) ? property.images : [],
});

// Cross-business search — the aggregated marketplace feed. Unlike the
// per-business endpoint below, this has no businessId to scope by, so
// filtering happens via an aggregation pipeline (Unit -> lookup Property ->
// lookup Company) rather than a plain find().
router.get("/", async (req, res) => {
  try {
    const {
      town = "",
      zoneRegion = "",
      propertyType = "",
      unitType = "",
      minRent = "",
      maxRent = "",
      bedrooms = "",
      page = 1,
      limit = 24,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 24, 1), 100);

    const unitMatch = { ...LISTABLE_STATUS_MATCH };
    if (unitType) unitMatch.unitType = unitType;
    if (bedrooms) unitMatch.bedrooms = { $gte: Number(bedrooms) || 0 };
    if (minRent || maxRent) {
      unitMatch.rent = {};
      if (minRent) unitMatch.rent.$gte = Number(minRent) || 0;
      if (maxRent) unitMatch.rent.$lte = Number(maxRent) || 0;
    }

    const propertyMatch = {};
    if (town) propertyMatch["property.townCityState"] = { $regex: escapeRegex(town), $options: "i" };
    if (zoneRegion) propertyMatch["property.zoneRegion"] = { $regex: escapeRegex(zoneRegion), $options: "i" };
    if (propertyType) propertyMatch["property.propertyType"] = propertyType;

    const pipeline = [
      { $match: unitMatch },
      { $lookup: { from: "properties", localField: "property", foreignField: "_id", as: "property" } },
      { $unwind: "$property" },
      ...(Object.keys(propertyMatch).length > 0 ? [{ $match: propertyMatch }] : []),
      { $lookup: { from: "companies", localField: "business", foreignField: "_id", as: "business" } },
      { $unwind: "$business" },
      { $sort: { featured: -1, availableFrom: -1 } },
      {
        $facet: {
          data: [
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
            {
              $project: {
                unitNumber: 1, unitType: 1, listingTitle: 1, slug: 1, featured: 1,
                rent: 1, deposit: 1, areaSqFt: 1, furnished: 1, bedrooms: 1, bathrooms: 1,
                parkingSpaces: 1, floorNumber: 1, petsAllowed: 1, rentNegotiable: 1,
                minimumLeaseTermMonths: 1, videoUrl: 1, virtualTourUrl: 1, images: 1,
                description: 1, status: 1, vacantSince: 1, availableFrom: 1,
                "property._id": 1, "property.propertyName": 1, "property.slug": 1,
                "property.townCityState": 1, "property.estateArea": 1, "property.zoneRegion": 1,
                "property.roadStreet": 1, "property.propertyType": 1, "property.images": 1,
                "property.coordinates": 1, "property.amenities": 1, "property.nearbyPoints": 1,
                "property.yearBuilt": 1, "property.verified": 1,
                "business._id": 1, "business.companyName": 1, "business.phoneNo": 1,
                "business.logo": 1, "business.slogan": 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await Unit.aggregate(pipeline);
    const listings = (result?.data || []).map((item) => ({
      ...item,
      property: normalizeProperty(item.property),
    }));
    const total = result?.totalCount?.[0]?.count || 0;

    return res.json({
      success: true,
      listings,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err) {
    console.error("Public marketplace search error:", err);
    return res.status(500).json({ success: false, message: "Failed to load listings" });
  }
});

router.get("/detail/:unitId", async (req, res) => {
  try {
    const { unitId } = req.params;
    if (!mongoose.isValidObjectId(unitId)) {
      return res.status(400).json({ success: false, message: "Invalid listing ID" });
    }

    const unit = await Unit.findOne({ _id: unitId, ...LISTABLE_STATUS_MATCH })
      .select(`${UNIT_PUBLIC_FIELDS} business`)
      .populate("property", PROPERTY_PUBLIC_FIELDS)
      .populate("business", "companyName phoneNo logo slogan")
      .lean();

    if (!unit) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    unit.property = normalizeProperty(unit.property);

    return res.json({ success: true, listing: unit });
  } catch (err) {
    console.error("Public listing detail error:", err);
    return res.status(500).json({ success: false, message: "Failed to load listing" });
  }
});

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
      Unit.find(buildListableFilter(businessId))
        .select(UNIT_PUBLIC_FIELDS)
        .populate("property", PROPERTY_PUBLIC_FIELDS)
        .sort({ featured: -1, availableFrom: -1 })
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
      listings: listings.map((item) => ({ ...item, property: normalizeProperty(item.property) })),
    });
  } catch (err) {
    console.error("Public listings error:", err);
    return res.status(500).json({ success: false, message: "Failed to load listings" });
  }
});

// Public "contact about this unit" submission — captures a lead instead of
// exposing the landlord/PM's raw phone number for scraping.
router.post("/leads", async (req, res) => {
  try {
    const { unitId, fullName, phone = "", email = "", message = "" } = req.body || {};

    if (!mongoose.isValidObjectId(unitId)) {
      return res.status(400).json({ success: false, message: "Invalid unit reference" });
    }

    const trimmedName = typeof fullName === "string" ? fullName.trim() : "";
    const trimmedPhone = typeof phone === "string" ? phone.trim() : "";
    const trimmedEmail = typeof email === "string" ? email.trim() : "";

    if (!trimmedName || (!trimmedPhone && !trimmedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Full name and a phone number or email are required",
      });
    }

    const unit = await Unit.findOne({ _id: unitId, listingEnabled: true }).select("business property").lean();
    if (!unit) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    const leadNumber = await nextSequenceNumber(String(unit.business), "rlead", "RLD");

    const lead = await RentalListingLead.create({
      business: unit.business,
      unit: unit._id,
      property: unit.property,
      leadNumber,
      fullName: trimmedName,
      phone: trimmedPhone,
      email: trimmedEmail,
      message: typeof message === "string" ? message.trim().slice(0, 1000) : "",
      source: "public_site",
    });

    return res.status(201).json({ success: true, leadNumber: lead.leadNumber });
  } catch (err) {
    console.error("Public listing lead submission error:", err);
    return res.status(500).json({ success: false, message: "Failed to submit inquiry" });
  }
});

export default router;
