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
      index: true,
    },

    isSystem: {
      type: Boolean,
      default: false,
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

const ChartOfAccount =
  mongoose.models.ChartOfAccount ||
  mongoose.model("ChartOfAccount", ChartOfAccountSchema);

export default ChartOfAccount;