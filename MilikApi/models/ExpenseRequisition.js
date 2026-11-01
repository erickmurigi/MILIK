import mongoose from "mongoose";

const ExpenseRequisitionSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      // Not required for a vendor take-on (opening) balance — a lot of vendors (auditors, software
      // subscriptions, company-wide contractors) aren't tied to any one property.
      required: function () { return !this.isTakeOnBalance; },
      default: null,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      default: null,
      index: true,
    },
    serviceProvider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      default: null,
      index: true,
    },
    // The real Chart-of-Accounts line this requisition is drawn against. Replaces the old
    // regex-guessed-from-category account used only at GL-posting time — this is now the single
    // account used both for GL posting AND for matching against Budget's account-keyed lines, so
    // the two can never silently disagree.
    expenseAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["maintenance", "repair", "utility", "tax", "insurance", "supplies", "other", "general"],
      default: "other",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    requestDate: {
      type: Date,
      default: Date.now,
    },
    neededBy: {
      type: Date,
      default: null,
    },
    neededByDate: {
      type: Date,
      default: null,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected", "converted", "cancelled"],
      default: "draft",
      index: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    vendorName: {
      type: String,
      default: "",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvalNote: {
      type: String,
      default: "",
      trim: true,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: "",
      trim: true,
    },
    convertedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    convertedAt: {
      type: Date,
      default: null,
    },
    linkedVoucher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentVoucher",
      default: null,
      index: true,
    },
    referenceNo: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    requisitionNo: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    // Snapshot of the budget-headroom check at the moment of the last submit/approve — kept for
    // audit (what the requester/approver actually saw), not re-derived on every read.
    budgetCheck: {
      type: new mongoose.Schema(
        {
          budgetId: { type: mongoose.Schema.Types.ObjectId, ref: "Budget", default: null },
          lineId: { type: mongoose.Schema.Types.ObjectId, default: null },
          period: { type: String, default: "" }, // budget name, or "YYYY-MM" when a monthly line matched
          budgeted: { type: Number, default: 0 },
          committed: { type: Number, default: 0 },
          actual: { type: Number, default: 0 },
          available: { type: Number, default: 0 },
          overBudget: { type: Boolean, default: false },
          checkedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    // Required when an approver pushes a requisition through despite overBudget being true at
    // approval time — the point isn't to block the spend, it's to make sure the override is on record.
    approvalOverrideNote: {
      type: String,
      default: "",
      trim: true,
    },
    // A vendor opening/take-on balance — created pre-approved (bypassing the normal
    // draft/submit/approve workflow and budget check) to record a payable that already existed
    // before this vendor was onboarded here. Otherwise behaves like any other requisition: shows
    // up in the normal list, posts the same accrual GL entry, and is corrected the normal way
    // (cancel, which reverses the GL entry, then delete).
    isTakeOnBalance: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

ExpenseRequisitionSchema.pre("validate", function syncCompatibilityFields(next) {
  if (!this.referenceNo && this.requisitionNo) {
    this.referenceNo = this.requisitionNo;
  }
  if (!this.requisitionNo && this.referenceNo) {
    this.requisitionNo = this.referenceNo;
  }
  if (!this.neededByDate && this.neededBy) {
    this.neededByDate = this.neededBy;
  }
  if (!this.neededBy && this.neededByDate) {
    this.neededBy = this.neededByDate;
  }
  next();
});

ExpenseRequisitionSchema.index({ business: 1, createdAt: -1 });
ExpenseRequisitionSchema.index({ business: 1, property: 1, status: 1, createdAt: -1 });
ExpenseRequisitionSchema.index({ business: 1, referenceNo: 1 }, { unique: true });
ExpenseRequisitionSchema.index({ business: 1, requisitionNo: 1 });
ExpenseRequisitionSchema.index({ business: 1, serviceProvider: 1, createdAt: -1 });

const ExpenseRequisition =
  mongoose.models.ExpenseRequisition ||
  mongoose.model("ExpenseRequisition", ExpenseRequisitionSchema);

export default ExpenseRequisition;
