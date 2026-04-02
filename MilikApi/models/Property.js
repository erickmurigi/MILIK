import mongoose from "mongoose";

const landlordSchema = new mongoose.Schema(
  {
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: "Landlord", default: null },
    name: { type: String, required: true, trim: true },
    contact: { type: String, trim: true },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true }
);

const standingChargeSchema = new mongoose.Schema(
  {
    serviceCharge: { type: String, required: true, trim: true },
    chargeMode: {
      type: String,
      enum: ["Monthly", "Quarterly", "Annual", "One-time"],
      default: "Monthly",
    },
    billingCurrency: {
      type: String,
      enum: ["KES", "USD"],
      default: "KES",
    },
    costPerArea: { type: String, trim: true },
    chargeValue: { type: Number, default: 0 },
    vatRate: {
      type: String,
      enum: ["0%", "8%", "16%"],
      default: "16%",
    },
    escalatesWithRent: { type: Boolean, default: false },
  },
  { _id: true }
);

const securityDepositSchema = new mongoose.Schema(
  {
    depositType: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    currency: {
      type: String,
      enum: ["KES", "USD"],
      default: "KES",
    },
    refundable: { type: Boolean, default: true },
    terms: { type: String, trim: true },
  },
  { _id: true }
);

const smsExemptionsSchema = new mongoose.Schema(
  {
    all: { type: Boolean, default: false },
    invoice: { type: Boolean, default: false },
    general: { type: Boolean, default: false },
    receipt: { type: Boolean, default: false },
    balance: { type: Boolean, default: false },
  },
  { _id: false }
);

const emailExemptionsSchema = new mongoose.Schema(
  {
    all: { type: Boolean, default: false },
    invoice: { type: Boolean, default: false },
    general: { type: Boolean, default: false },
    receipt: { type: Boolean, default: false },
    balance: { type: Boolean, default: false },
  },
  { _id: false }
);

const bankingDetailsSchema = new mongoose.Schema(
  {
    drawerBank: { type: String, default: "", trim: true },
    bankBranch: { type: String, default: "", trim: true },
    accountName: { type: String, default: "", trim: true },
    accountNumber: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const commissionTaxSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    taxCodeKey: { type: String, default: "vat_standard", trim: true },
    taxMode: { type: String, enum: ["company_default", "exclusive", "inclusive"], default: "company_default" },
    rateOverride: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const PropertySchema = new mongoose.Schema(
  {
    dateAcquired: { type: Date },
    letManage: {
      type: String,
      enum: ["Managing", "Letting", "Both"],
      default: "Managing",
    },

    landlords: {
      type: [landlordSchema],
      default: [],
    },

    propertyCode: {
      type: String,
      required: true,
      trim: true,
    },

    propertyName: {
      type: String,
      required: true,
      trim: true,
    },

    lrNumber: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      trim: true,
    },

    propertyType: {
      type: String,
      enum: [
        "Residential",
        "Commercial",
        "Mixed Use",
        "Industrial",
        "Agricultural",
        "Special Purpose",
        "apartment",
        "house",
        "townhouse",
        "commercial",
        "mixed",
      ],
      required: true,
      trim: true,
    },

    specification: {
      type: String,
      enum: [
        "Multi-Unit/Multi-Spa",
        "Single Storey",
        "Multi Storey",
        "High Rise",
        "Complex",
        "Estate",
      ],
      trim: true,
    },

    multiStoreyType: {
      type: String,
      enum: ["Low Rise", "Mid Rise", "High Rise"],
      trim: true,
    },

    numberOfFloors: { type: Number, default: 0 },

    country: {
      type: String,
      default: "Kenya",
      trim: true,
    },

    townCityState: { type: String, trim: true },
    estateArea: { type: String, trim: true },
    roadStreet: { type: String, trim: true },
    zoneRegion: { type: String, trim: true },
    address: { type: String, trim: true },

    accountLedgerType: {
      type: String,
      default: "Property Control Ledger In GL",
      trim: true,
    },

    primaryBank: { type: String, trim: true },
    alternativeTaxPin: { type: String, trim: true },
    invoicePrefix: { type: String, trim: true },

    invoicePaymentTerms: {
      type: String,
      default: "Please pay your invoice before due date to avoid penalty.",
      trim: true,
    },

    mpesaPaybill: { type: Boolean, default: true },
    disableMpesaStkPush: { type: Boolean, default: false },
    mpesaNarration: { type: String, trim: true },

    standingCharges: {
      type: [standingChargeSchema],
      default: [],
    },

    securityDeposits: {
      type: [securityDepositSchema],
      default: [],
    },

    smsExemptions: {
      type: smsExemptionsSchema,
      default: () => ({}),
    },

    emailExemptions: {
      type: emailExemptionsSchema,
      default: () => ({}),
    },

    excludeFeeSummary: { type: Boolean, default: false },
    exemptFromLatePenalties: { type: Boolean, default: false },

    bankingDetails: {
      type: bankingDetailsSchema,
      default: () => ({}),
    },

    notes: { type: String, trim: true },
    specificContactInfo: { type: String, trim: true },
    description: { type: String, trim: true },

    totalUnits: { type: Number, default: 0 },
    occupiedUnits: { type: Number, default: 0 },
    vacantUnits: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["active", "maintenance", "closed", "archived"],
      default: "active",
    },

    images: [{ type: String }],

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    commissionPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    commissionRecognitionBasis: {
      type: String,
      enum: ["invoiced", "received", "received_manager_only"],
      default: "received",
    },

    commissionPaymentMode: {
      type: String,
      enum: ["percentage", "fixed", "both"],
      default: "percentage",
    },

    commissionFixedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionTaxSettings: {
      type: commissionTaxSettingsSchema,
      default: () => ({}),
    },

    tenantsPaysTo: {
      type: String,
      enum: ["propertyManager", "landlord"],
      default: "propertyManager",
    },

    depositHeldBy: {
      type: String,
      enum: ["propertyManager", "landlord"],
      default: "propertyManager",
    },

    controlAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PropertySchema.virtual("fullAddress").get(function () {
  const parts = [
    this.roadStreet,
    this.estateArea,
    this.townCityState,
    this.zoneRegion,
    this.country,
  ].filter((part) => part && part.trim() !== "");

  return parts.join(", ");
});

PropertySchema.index({ business: 1, propertyCode: 1 }, { unique: true });
PropertySchema.index({ business: 1, lrNumber: 1 });
PropertySchema.index({ business: 1, propertyName: 1 });
PropertySchema.index({ business: 1, status: 1 });
PropertySchema.index({ business: 1, zoneRegion: 1 });
PropertySchema.index({ "landlords.landlordId": 1 });
PropertySchema.index({ "landlords.name": 1 });
PropertySchema.index({ createdAt: -1 });
PropertySchema.index({ controlAccount: 1 });

PropertySchema.statics.updateUnitCounts = async function (propertyId) {
  const Unit = mongoose.model("Unit");

  const totalUnits = await Unit.countDocuments({ property: propertyId });
  const occupiedUnits = await Unit.countDocuments({
    property: propertyId,
    status: "occupied",
  });
  const vacantUnits = await Unit.countDocuments({
    property: propertyId,
    status: "vacant",
  });

  await this.findByIdAndUpdate(propertyId, {
    totalUnits,
    occupiedUnits,
    vacantUnits,
  });
};

PropertySchema.pre("save", function (next) {
  if (typeof this.propertyCode === "string") {
    this.propertyCode = this.propertyCode.trim();
  }
  if (typeof this.propertyName === "string") {
    this.propertyName = this.propertyName.trim();
  }
  if (typeof this.lrNumber === "string") {
    this.lrNumber = this.lrNumber.trim();
  }
  if (typeof this.propertyType === "string") {
    this.propertyType = this.propertyType.trim();
  }
  if (typeof this.category === "string") {
    this.category = this.category.trim();
  }
  if (typeof this.specification === "string") {
    this.specification = this.specification.trim();
  }
  if (typeof this.multiStoreyType === "string") {
    this.multiStoreyType = this.multiStoreyType.trim();
  }
  if (typeof this.country === "string") {
    this.country = this.country.trim();
  }
  if (typeof this.townCityState === "string") {
    this.townCityState = this.townCityState.trim();
  }
  if (typeof this.estateArea === "string") {
    this.estateArea = this.estateArea.trim();
  }
  if (typeof this.roadStreet === "string") {
    this.roadStreet = this.roadStreet.trim();
  }
  if (typeof this.zoneRegion === "string") {
    this.zoneRegion = this.zoneRegion.trim();
  }
  if (typeof this.address === "string") {
    this.address = this.address.trim();
  }

  if (this.landlords && this.landlords.length > 0) {
    this.landlords = this.landlords.filter(
      (landlord) =>
        landlord &&
        typeof landlord.name === "string" &&
        landlord.name.trim() !== "" &&
        landlord.name.trim().toLowerCase() !== "default"
    );

    if (this.landlords.length > 0) {
      this.landlords.forEach((landlord) => {
        if (typeof landlord.name === "string") landlord.name = landlord.name.trim();
        if (typeof landlord.contact === "string") landlord.contact = landlord.contact.trim();
      });

      const primaryCount = this.landlords.filter((landlord) => landlord.isPrimary).length;

      if (primaryCount === 0) {
        this.landlords[0].isPrimary = true;
      } else if (primaryCount > 1) {
        let firstPrimaryFound = false;
        this.landlords.forEach((landlord) => {
          if (landlord.isPrimary && !firstPrimaryFound) {
            firstPrimaryFound = true;
          } else {
            landlord.isPrimary = false;
          }
        });
      }
    }
  }

  next();
});

export default mongoose.model("Property", PropertySchema);