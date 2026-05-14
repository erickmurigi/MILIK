import mongoose from "mongoose";

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    relationship: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    url: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const tenantUtilitySchema = new mongoose.Schema(
  {
    utility: { type: String, trim: true },
    utilityLabel: { type: String, trim: true },
    unitCharge: { type: Number, default: 0, min: 0 },
    isIncluded: { type: Boolean, default: false },
  },
  { _id: true }
);

const TenantSchema = new mongoose.Schema(
  {
    tenantCode: {
      type: String,
      trim: true,
      default: null,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    idNumber: {
      type: String,
      required: true,
      trim: true,
    },

    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
    },

    additionalUnits: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Unit",
        },
      ],
      default: [],
    },

    unitTransferHistory: {
      type: [
        {
          fromUnit: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Unit",
            default: null,
          },
          toUnit: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Unit",
            default: null,
          },
          effectiveDate: { type: Date, default: Date.now },
          reason: { type: String, trim: true, default: "" },
          transferredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
          },
          previousAdditionalUnits: {
            type: [
              {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Unit",
              },
            ],
            default: [],
          },
          nextAdditionalUnits: {
            type: [
              {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Unit",
              },
            ],
            default: [],
          },
        },
      ],
      default: [],
    },

    rent: {
      type: Number,
      required: true,
      min: 0,
    },

    balance: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "terminated", "evicted", "overdue", "moved_out"],
      default: "active",
    },

    depositAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    depositHeldBy: {
      type: String,
      enum: ["Management Company", "Landlord"],
      default: "Management Company",
    },

    terminationDate: { type: Date, default: null },
    terminationReason: { type: String, default: "", trim: true },

    depositRefundStatus: {
      type: String,
      enum: ["not_applicable", "pending", "approved", "paid"],
      default: "not_applicable",
    },

    depositRefundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    depositRefundReference: {
      type: String,
      default: "",
      trim: true,
    },

    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "mobile_money", "cash", "check", "credit_card"],
      default: "bank_transfer",
    },

    leaseType: {
      type: String,
      enum: ["at_will", "fixed"],
      default: "at_will",
    },

    moveInDate: { type: Date, required: true },
    moveOutDate: { type: Date, default: null },

    emergencyContact: {
      type: emergencyContactSchema,
      default: () => ({}),
    },

    documents: {
      type: [documentSchema],
      default: [],
    },

    utilities: {
      type: [tenantUtilitySchema],
      default: [],
    },

    lettingFeeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    profileImage: { type: String, default: "", trim: true },

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
  },
  { timestamps: true }
);

TenantSchema.index({ business: 1 });
TenantSchema.index({ business: 1, status: 1 });
TenantSchema.index({ business: 1, tenantCode: 1 }, { unique: true, sparse: true });
TenantSchema.index({ business: 1, idNumber: 1 }, { unique: true });
TenantSchema.index({ business: 1, phone: 1 });
TenantSchema.index({ unit: 1 });
TenantSchema.index({ business: 1, unit: 1, status: 1 });
TenantSchema.index({ additionalUnits: 1 });
TenantSchema.index({ moveInDate: -1 });

TenantSchema.pre("validate", function (next) {
  if (typeof this.tenantCode === "string") {
    this.tenantCode = this.tenantCode.trim();
  }

  if (typeof this.name === "string") {
    this.name = this.name.trim();
  }

  if (typeof this.phone === "string") {
    this.phone = this.phone.trim();
  }

  if (typeof this.idNumber === "string") {
    this.idNumber = this.idNumber.trim();
  }

  if (typeof this.terminationReason === "string") {
    this.terminationReason = this.terminationReason.trim();
  }

  if (typeof this.depositRefundReference === "string") {
    this.depositRefundReference = this.depositRefundReference.trim();
  }

  if (typeof this.profileImage === "string") {
    this.profileImage = this.profileImage.trim();
  }

  this.rent = Number(this.rent || 0);
  this.balance = Number(this.balance || 0);
  this.depositAmount = Number(this.depositAmount || 0);
  this.depositRefundAmount = Number(this.depositRefundAmount || 0);

  if (Array.isArray(this.additionalUnits)) {
    this.additionalUnits = Array.from(
      new Set(
        this.additionalUnits
          .map((item) => (item ? String(item) : ""))
          .filter(Boolean)
          .filter((item) => item !== String(this.unit || ""))
      )
    );
  } else {
    this.additionalUnits = [];
  }

  if (Array.isArray(this.unitTransferHistory)) {
    this.unitTransferHistory = this.unitTransferHistory.map((entry) => ({
      ...entry,
      reason: typeof entry?.reason === "string" ? entry.reason.trim() : "",
      effectiveDate: entry?.effectiveDate || new Date(),
      previousAdditionalUnits: Array.isArray(entry?.previousAdditionalUnits)
        ? Array.from(new Set(entry.previousAdditionalUnits.map((item) => String(item)).filter(Boolean)))
        : [],
      nextAdditionalUnits: Array.isArray(entry?.nextAdditionalUnits)
        ? Array.from(new Set(entry.nextAdditionalUnits.map((item) => String(item)).filter(Boolean)))
        : [],
    }));
  } else {
    this.unitTransferHistory = [];
  }

  if (this.status === "moved_out") {
    this.status = "terminated";
  }

  if (Array.isArray(this.documents)) {
    this.documents = this.documents.map((doc) => ({
      ...doc,
      name: typeof doc?.name === "string" ? doc.name.trim() : doc?.name,
      url: typeof doc?.url === "string" ? doc.url.trim() : doc?.url,
      uploadedAt: doc?.uploadedAt || new Date(),
    }));
  }

  if (Array.isArray(this.utilities)) {
    this.utilities = this.utilities.map((item) => ({
      ...item,
      utility: typeof item?.utility === "string" ? item.utility.trim() : item?.utility,
      utilityLabel:
        typeof item?.utilityLabel === "string" ? item.utilityLabel.trim() : item?.utilityLabel,
      unitCharge: Number(item?.unitCharge || 0),
      isIncluded: !!item?.isIncluded,
    }));
  }

  next();
});

export default mongoose.model("Tenant", TenantSchema);