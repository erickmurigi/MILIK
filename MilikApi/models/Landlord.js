import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    name: { type: String, trim: true },
    size: { type: String, trim: true },
    dateTime: { type: String, trim: true },
    url: { type: String, trim: true },
  },
  { _id: true }
);

const LandlordSchema = new mongoose.Schema(
  {
    // General Information
    landlordCode: {
      type: String,
      required: true,
      trim: true,
    },

    landlordType: {
      type: String,
      enum: ["Individual", "Company", "Partnership", "Trust"],
      required: true,
      default: "Individual",
      trim: true,
    },

    landlordName: {
      type: String,
      required: true,
      trim: true,
    },

    // Legacy compatibility: existing DB may still use idNumber
    // Keep this field synced with regId at save time.
    idNumber: {
      type: String,
      trim: true,
      default: null,
    },

    regId: {
      type: String,
      required: true,
      trim: true,
    },

    taxPin: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["Active", "Archived"],
      default: "Active",
      trim: true,
    },

    portalAccess: {
      type: String,
      enum: ["Enabled", "Disabled"],
      default: "Disabled",
      trim: true,
    },

    // Address Information
    postalAddress: { type: String, default: "", trim: true },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },

    location: { type: String, default: "", trim: true },

    // Attachments
    attachments: {
      type: [attachmentSchema],
      default: [],
    },

    // System fields
    propertyCount: { type: Number, default: 0, min: 0 },
    unitsCount: { type: Number, default: 0, min: 0 },
    totalRevenue: { type: Number, default: 0, min: 0 },

    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes
LandlordSchema.index({ company: 1 });
LandlordSchema.index({ company: 1, landlordCode: 1 }, { unique: true });
LandlordSchema.index({ company: 1, regId: 1 }, { unique: true });
LandlordSchema.index({ company: 1, idNumber: 1 }, { unique: true, sparse: true });
LandlordSchema.index({ company: 1, email: 1 });
LandlordSchema.index({ company: 1, landlordName: 1 });
LandlordSchema.index({ company: 1, status: 1 });
LandlordSchema.index({ createdAt: -1 });

LandlordSchema.pre("validate", function (next) {
  if (typeof this.landlordCode === "string") {
    this.landlordCode = this.landlordCode.trim();
  }

  if (typeof this.landlordName === "string") {
    this.landlordName = this.landlordName.trim();
  }

  if (typeof this.landlordType === "string") {
    this.landlordType = this.landlordType.trim();
  }

  if (typeof this.regId === "string") {
    this.regId = this.regId.trim();
  }

  if (typeof this.taxPin === "string") {
    this.taxPin = this.taxPin.trim();
  }

  if (typeof this.email === "string") {
    this.email = this.email.trim().toLowerCase();
  }

  if (typeof this.phoneNumber === "string") {
    this.phoneNumber = this.phoneNumber.trim();
  }

  if (typeof this.postalAddress === "string") {
    this.postalAddress = this.postalAddress.trim();
  }

  if (typeof this.location === "string") {
    this.location = this.location.trim();
  }

  if (typeof this.status === "string") {
    this.status = this.status.trim();
  }

  if (typeof this.portalAccess === "string") {
    this.portalAccess = this.portalAccess.trim();
  }

  if (this.regId) {
    this.idNumber = this.regId;
  } else if (typeof this.idNumber === "string") {
    this.idNumber = this.idNumber.trim();
  }

  if (Array.isArray(this.attachments)) {
    this.attachments = this.attachments.map((item) => ({
      ...item,
      id: typeof item?.id === "string" ? item.id.trim() : item?.id,
      name: typeof item?.name === "string" ? item.name.trim() : item?.name,
      size: typeof item?.size === "string" ? item.size.trim() : item?.size,
      dateTime:
        typeof item?.dateTime === "string" ? item.dateTime.trim() : item?.dateTime,
      url: typeof item?.url === "string" ? item.url.trim() : item?.url,
    }));
  }

  next();
});

export default mongoose.model("Landlord", LandlordSchema);