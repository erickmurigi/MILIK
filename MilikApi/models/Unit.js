import mongoose from "mongoose";
import { canonicalizeBillingPeriodKey } from "../services/billingPeriodService.js";
import { slugifyWithSuffix } from "../utils/slugify.js";

const unitUtilitySchema = new mongoose.Schema(
  {
    utility: { type: String, trim: true },
    isIncluded: { type: Boolean, default: false },
    unitCharge: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const UnitSchema = new mongoose.Schema(
  {
    unitNumber: {
      type: String,
      required: true,
      trim: true,
    },

    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },

    unitType: {
      type: String,
      enum: ["studio", "1bed", "2bed", "3bed", "4bed", "commercial"],
      required: true,
      trim: true,
    },

    rent: {
      type: Number,
      required: true,
      min: 0,
    },

    deposit: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["vacant", "occupied", "maintenance", "reserved", "archived"],
      default: "vacant",
    },

    amenities: [{ type: String, trim: true }],

    utilities: {
      type: [unitUtilitySchema],
      default: [],
    },

    billingFrequency: {
      type: String,
      trim: true,
      default: "monthly",
    },

    billingPeriodKey: {
      type: String,
      trim: true,
      default: "monthly",
    },

    isVacant: { type: Boolean, default: true },

    lastTenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
    },

    vacantSince: { type: Date },
    daysVacant: { type: Number, default: 0, min: 0 },

    lastPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },

    images: [{ type: String }],

    description: { type: String, trim: true },

    areaSqFt: { type: Number, default: 0, min: 0 },

    furnished: {
      type: String,
      enum: ["furnished", "semi-furnished", "unfurnished"],
      default: "unfurnished",
      trim: true,
    },

    listingEnabled: { type: Boolean, default: false },

    listingTitle: { type: String, trim: true, default: "" },
    slug: { type: String, trim: true, default: "" },
    featured: { type: Boolean, default: false },

    bedrooms: { type: Number, default: null, min: 0 },
    bathrooms: { type: Number, default: null, min: 0 },
    parkingSpaces: { type: Number, default: 0, min: 0 },
    floorNumber: { type: String, trim: true, default: "" },
    petsAllowed: { type: Boolean, default: false },

    rentNegotiable: { type: Boolean, default: false },
    minimumLeaseTermMonths: { type: Number, default: 0, min: 0 },

    videoUrl: { type: String, trim: true, default: "" },
    virtualTourUrl: { type: String, trim: true, default: "" },

    // Set when a tenant has given notice on an occupied unit, so it can be
    // marketed ("Available from <date>") before it actually turns vacant.
    availableFrom: { type: Date, default: null },

    ownerOccupied: { type: Boolean, default: false },

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
  },
  { timestamps: true }
);

UnitSchema.index({ business: 1, status: 1 });
UnitSchema.index({ property: 1, status: 1 });
UnitSchema.index({ business: 1, property: 1, unitNumber: 1 }, { unique: true });
UnitSchema.index({ isVacant: 1 });
UnitSchema.index({ listingEnabled: 1, status: 1 });
UnitSchema.index({ business: 1, createdAt: -1 });
UnitSchema.index({ business: 1, slug: 1 }, { unique: true, sparse: true });
UnitSchema.index({ listingEnabled: 1, status: 1, availableFrom: 1 });
UnitSchema.index({ listingEnabled: 1, featured: 1, status: 1 });
UnitSchema.index({ listingEnabled: 1, status: 1, rent: 1 });
UnitSchema.index({ listingEnabled: 1, status: 1, unitType: 1 });

UnitSchema.pre("validate", function (next) {
  if (typeof this.unitNumber === "string") {
    this.unitNumber = this.unitNumber.trim();
  }

  if (typeof this.unitType === "string") {
    this.unitType = this.unitType.trim();
  }

  if (typeof this.description === "string") {
    this.description = this.description.trim();
  }

  if (Array.isArray(this.amenities)) {
    this.amenities = this.amenities
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => typeof item === "string" && item !== "");
  }

  if (Array.isArray(this.utilities)) {
    this.utilities = this.utilities.map((item) => ({
      ...item,
      utility: typeof item?.utility === "string" ? item.utility.trim() : item?.utility,
      unitCharge: Number(item?.unitCharge || 0),
      isIncluded: !!item?.isIncluded,
    }));
  }

  const normalizedBillingPeriodKey = canonicalizeBillingPeriodKey(
    this.billingPeriodKey || this.billingFrequency || "monthly"
  );
  this.billingPeriodKey = normalizedBillingPeriodKey;
  this.billingFrequency = normalizedBillingPeriodKey;

  this.rent = Number(this.rent || 0);
  this.deposit = Number(this.deposit || 0);
  this.areaSqFt = Number(this.areaSqFt || 0);
  this.daysVacant = Number(this.daysVacant || 0);

  if (this.status === "vacant") {
    this.isVacant = true;
    if (!this.vacantSince) {
      this.vacantSince = new Date();
    }
    if (!this.availableFrom) {
      this.availableFrom = this.vacantSince;
    }
  } else {
    this.isVacant = false;
    this.vacantSince = null;
    this.daysVacant = 0;
    // availableFrom is intentionally left untouched here — an occupied unit
    // can carry a future availableFrom (tenant gave notice) so it can be
    // marketed ahead of actually turning vacant.
  }

  if (!this.slug || this.isModified("unitNumber")) {
    this.slug = slugifyWithSuffix(this.unitNumber, this._id);
  }

  next();
});

export default mongoose.model("Unit", UnitSchema);