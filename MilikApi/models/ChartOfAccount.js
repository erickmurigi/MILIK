import mongoose from "mongoose";

const ChartOfAccountSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["asset", "liability", "equity", "income", "expense"],
      required: true,
      lowercase: true,
      trim: true,
    },
    group: {
      type: String,
      default: "assets",
      lowercase: true,
      trim: true,
    },

    subGroup: {
      type: String,
      default: "",
      trim: true,
    },

    parentAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
      index: true,
    },

    level: {
      type: Number,
      default: 0,
      min: 0,
    },

    isHeader: {
      type: Boolean,
      default: false,
    },

    isPosting: {
      type: Boolean,
      default: true,
    },

    balance: {
      type: Number,
      default: 0,
    },

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    isSystem: {
      type: Boolean,
      default: false,
    },

    // Marks accounts that are auto-managed by a module (PM, CW, HR).
    // Finance staff should not manually journal to these — the module owns them.
    isControl: {
      type: Boolean,
      default: false,
      index: true,
    },

    // For property-specific sub-accounts (e.g. 1200-PARK).
    // Links the account back to its property for lookups and reports.
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      default: null,
      index: true,
    },

    moduleScopes: {
      type: [String],
      enum: ["general", "propertyManagement", "carwash", "hr", "propertySale", "inventory"],
      default: [],
      index: true,
    },

    // Soft-delete — accounts with ledger history are never physically removed
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ChartOfAccountSchema.pre("validate", function (next) {
  if (this.isHeader) {
    this.isPosting = false;
  }

  if (!this.parentAccount) {
    this.level = 0;
  }

  next();
});

ChartOfAccountSchema.index({ business: 1, code: 1 }, { unique: true });
ChartOfAccountSchema.index({ business: 1, type: 1, code: 1 });
ChartOfAccountSchema.index({ business: 1, group: 1, code: 1 });
ChartOfAccountSchema.index({ business: 1, parentAccount: 1, code: 1 });
ChartOfAccountSchema.index({ business: 1, subGroup: 1, code: 1 });
ChartOfAccountSchema.index({ business: 1, moduleScopes: 1, code: 1 });
ChartOfAccountSchema.index({ business: 1, isPosting: 1, isHeader: 1, type: 1, code: 1 });

const ChartOfAccount =
  mongoose.models.ChartOfAccount ||
  mongoose.model("ChartOfAccount", ChartOfAccountSchema);

export default ChartOfAccount;
