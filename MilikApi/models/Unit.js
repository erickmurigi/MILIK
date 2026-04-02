import mongoose from "mongoose";

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
      index: true,
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
      enum: ["monthly", "bi-monthly", "quarterly", "semi-annually", "annually"],
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

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

UnitSchema.index({ business: 1 });
UnitSchema.index({ business: 1, status: 1 });
UnitSchema.index({ property: 1 });
UnitSchema.index({ property: 1, status: 1 });
UnitSchema.index({ business: 1, property: 1, unitNumber: 1 }, { unique: true });
UnitSchema.index({ isVacant: 1 });

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

  this.rent = Number(this.rent || 0);
  this.deposit = Number(this.deposit || 0);
  this.areaSqFt = Number(this.areaSqFt || 0);
  this.daysVacant = Number(this.daysVacant || 0);

  if (this.status === "vacant") {
    this.isVacant = true;
    if (!this.vacantSince) {
      this.vacantSince = new Date();
    }
  } else {
    this.isVacant = false;
    this.vacantSince = null;
    this.daysVacant = 0;
  }

  next();
});

export default mongoose.model("Unit", UnitSchema);