import mongoose from "mongoose";

// Product catalog — no stock stored here; stock lives in InvStockEntry per location.
const invProductSchema = new mongoose.Schema(
  {
    business:      { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name:          { type: String, required: true, trim: true },
    sku:           { type: String, trim: true, uppercase: true, default: null },
    barcode:       { type: String, trim: true, default: "" },
    category:      { type: mongoose.Schema.Types.ObjectId, ref: "InvCategory", default: null, index: true },
    unitOfMeasure: { type: String, trim: true, default: "pcs" },
    costPrice:     { type: Number, default: 0, min: 0 },
    sellingPrice:  { type: Number, default: 0, min: 0 },
    vatRate:       { type: Number, default: 0, min: 0, max: 100 },   // percentage, e.g. 16
    trackStock:    { type: Boolean, default: true },
    serialized:    { type: Boolean, default: false },   // track individual units by serial/IMEI
    reorderLevel:  { type: Number, default: 0, min: 0 },
    description:   { type: String, trim: true, default: "" },
    imageUrl:      { type: String, trim: true, default: "" },
    active:        { type: Boolean, default: true, index: true },
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invProductSchema.index({ business: 1, sku: 1 }, { unique: true, sparse: true });
invProductSchema.index({ business: 1, barcode: 1 }, { sparse: true });
invProductSchema.index({ business: 1, active: 1, name: 1 });
invProductSchema.index({ business: 1, category: 1 });
invProductSchema.index({ name: "text", sku: "text", barcode: "text", description: "text" }, { default_language: "none" });

invProductSchema.pre("save", function (next) {
  if (this.sku === "") this.sku = null;
  if (this.barcode === "") this.barcode = null;
  next();
});

export default mongoose.model("InvProduct", invProductSchema);
