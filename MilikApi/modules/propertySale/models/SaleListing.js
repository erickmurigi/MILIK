import mongoose from "mongoose";

const LISTING_STATUSES = ["available", "reserved", "under_contract", "sold", "withdrawn"];
const PROPERTY_TYPES = ["plot", "house", "apartment", "commercial", "land", "other"];
const SIZE_UNITS = ["sqm", "sqft", "acres", "hectares"];

const saleListingSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    listingNumber: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    propertyType: { type: String, enum: PROPERTY_TYPES, default: "plot" },
    description: { type: String, trim: true, default: "" },
    size: { type: Number, min: 0, default: null },
    sizeUnit: { type: String, enum: SIZE_UNITS, default: "sqm" },
    location: { type: String, trim: true, default: "" },
    town: { type: String, trim: true, default: "" },
    county: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "Kenya" },
    askingPrice: { type: Number, required: true, min: 0 },
    negotiable: { type: Boolean, default: true },
    currency: { type: String, default: "KES" },
    status: { type: String, enum: LISTING_STATUSES, default: "available", index: true },
    titleDeedAvailable: { type: Boolean, default: false },
    titleDeedNumber: { type: String, trim: true, default: "" },
    amenities: [{ type: String, trim: true }],
    images: [{ type: String, trim: true }],
    assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent", default: null },
    listedDate: { type: Date, default: Date.now },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleListingSchema.index({ business: 1, listingNumber: 1 }, { unique: true });
saleListingSchema.index({ business: 1, status: 1, createdAt: -1 });
saleListingSchema.index({ business: 1, assignedAgent: 1 });
saleListingSchema.index({ title: "text", listingNumber: "text", location: "text", town: "text", titleDeedNumber: "text" }, { default_language: "none" });

export default mongoose.model("SaleListing", saleListingSchema);
