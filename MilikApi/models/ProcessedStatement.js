import mongoose from "mongoose";

const statementTransactionHistorySchema = new mongoose.Schema(
  {
    amount: { type: Number, default: 0 },
    paymentDate: { type: Date, default: Date.now },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "cash", "cheque", "mpesa", "paypal", "pesapal", null],
      default: null,
    },
    paymentReference: { type: String, default: null },
    notes: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    entryId: { type: String, default: null, trim: true },
  },
  { _id: false }
);

const ProcessedStatementSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },
    sourceStatement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LandlordStatement",
      default: null,
    },
    sourceStatementNumber: {
      type: String,
      default: null,
      trim: true,
    },
    reversedSourceStatement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LandlordStatement",
      default: null,
    },
    reversedSourceStatementNumber: {
      type: String,
      default: null,
      trim: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    cutoffAt: {
      type: Date,
      default: null,
      index: true,
    },
    previousCutoffAt: {
      type: Date,
      default: null,
    },
    statementType: {
      type: String,
      enum: ["provisional", "final"],
      default: "provisional",
    },
    totalRentInvoiced: {
      type: Number,
      default: 0,
    },
    totalRentReceived: {
      type: Number,
      default: 0,
    },
    totalRentReceivedByManager: {
      type: Number,
      default: 0,
    },
    totalRentReceivedByLandlord: {
      type: Number,
      default: 0,
    },
    totalUtilitiesCollected: {
      type: Number,
      default: 0,
    },
    depositsHeldByManager: {
      type: Number,
      default: 0,
    },
    depositsHeldByLandlord: {
      type: Number,
      default: 0,
    },
    unappliedPayments: {
      type: Number,
      default: 0,
    },
    commissionPercentage: {
      type: Number,
      default: 0,
    },
    commissionBasis: {
      type: String,
      enum: ["invoiced", "received", "received_manager_only"],
      default: "received",
    },
    commissionAmount: {
      type: Number,
      default: 0,
    },
    commissionTaxAmount: {
      type: Number,
      default: 0,
    },
    commissionGrossAmount: {
      type: Number,
      default: 0,
    },
    commissionTaxMode: {
      type: String,
      enum: ["exclusive", "inclusive"],
      default: "exclusive",
    },
    commissionTaxRate: {
      type: Number,
      default: 0,
    },
    commissionTaxCodeKey: {
      type: String,
      default: "no_tax",
    },
    netAmountDue: {
      type: Number,
      default: 0,
    },
    totalExpenses: {
      type: Number,
      default: 0,
    },
    recurringDeductions: {
      type: Number,
      default: 0,
    },
    advanceRecoveries: {
      type: Number,
      default: 0,
    },
    expensesByCategory: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    netAfterExpenses: {
      type: Number,
      default: 0,
    },
    isNegativeStatement: {
      type: Boolean,
      default: false,
    },
    amountPayableByLandlordToManager: {
      type: Number,
      default: 0,
    },
    summaryBuckets: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    workspaceSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    financialEvents: [
      {
        eventType: { type: String },
        bucket: { type: String },
        amount: { type: Number, default: 0 },
        date: { type: Date },
        tenantId: { type: String },
        unit: { type: String },
        tenantName: { type: String },
        reference: { type: String },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],
    occupiedUnits: {
      type: Number,
      default: 0,
    },
    vacantUnits: {
      type: Number,
      default: 0,
    },
    tenantRows: [
      {
        unit: String,
        tenantName: String,
        rentPerMonth: Number,
        openingBalance: Number,
        totalInvoiced: Number,
        txnNo: String,
        totalReceived: Number,
        closingBalance: Number,
      },
    ],
    status: {
      type: String,
      enum: ["processed", "unpaid", "part_paid", "paid", "reversed"],
      default: "unpaid",
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    paymentHistory: {
      type: [statementTransactionHistorySchema],
      default: [],
    },
    amountRecovered: {
      type: Number,
      default: 0,
    },
    recoveryBalance: {
      type: Number,
      default: 0,
    },
    recoveryHistory: {
      type: [statementTransactionHistorySchema],
      default: [],
    },
    recoveryDate: {
      type: Date,
      default: null,
    },
    paidDate: {
      type: Date,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "cash", "cheque", "mpesa", "paypal", "pesapal", null],
      default: null,
    },
    paymentReference: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    reversedAt: {
      type: Date,
      default: null,
    },
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reversalReason: {
      type: String,
      default: null,
      trim: true,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    closedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

ProcessedStatementSchema.index({ business: 1, landlord: 1, property: 1, periodStart: 1 });
ProcessedStatementSchema.index({ business: 1, landlord: 1, property: 1, cutoffAt: -1 });
ProcessedStatementSchema.index({ business: 1, status: 1 });
ProcessedStatementSchema.index({ business: 1, closedAt: -1 });
ProcessedStatementSchema.index(
  { business: 1, sourceStatement: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceStatement: { $type: "objectId" },
    },
  }
);

ProcessedStatementSchema.pre("save", function (next) {
  if (this.status === "reversed") {
    this.balanceDue = 0;
    this.recoveryBalance = 0;
    return next();
  }

  const rawNetAmountDue = Number(this.netAmountDue || 0);
  const rawNetAfterExpenses =
    this.netAfterExpenses !== undefined && this.netAfterExpenses !== null
      ? Number(this.netAfterExpenses || 0)
      : rawNetAmountDue;
  const explicitRecovery = Math.max(Number(this.amountPayableByLandlordToManager || 0), 0);
  const isNegativeStatement =
    Boolean(this.isNegativeStatement) || explicitRecovery > 0 || rawNetAmountDue < 0 || rawNetAfterExpenses < 0;

  if (isNegativeStatement) {
    const inferredRecovery = Math.abs(Math.min(rawNetAmountDue, rawNetAfterExpenses, 0));
    const totalRecovery = explicitRecovery || inferredRecovery;
    const recovered = Math.max(Math.min(Number(this.amountRecovered || 0), totalRecovery), 0);
    this.isNegativeStatement = true;
    this.amountPayableByLandlordToManager = totalRecovery;
    this.amountRecovered = recovered;
    this.recoveryBalance = Math.max(totalRecovery - recovered, 0);
    this.netAmountDue = 0;
    this.balanceDue = 0;
    this.amountPaid = 0;
    this.status = "processed";
    return next();
  }

  this.isNegativeStatement = false;
  this.amountPayableByLandlordToManager = 0;
  this.amountRecovered = 0;
  this.recoveryBalance = 0;

  const due = Math.max(Number(this.netAmountDue || 0), 0);
  const paid = Math.max(Number(this.amountPaid || 0), 0);
  this.netAmountDue = due;
  this.amountPaid = paid;

  if (paid <= 0) {
    this.balanceDue = due;
    this.status = this.status === "processed" ? "processed" : due > 0 ? "unpaid" : "processed";
  } else if (paid >= due && due > 0) {
    this.balanceDue = 0;
    this.status = "paid";
  } else if (due > 0) {
    this.balanceDue = Math.max(due - paid, 0);
    this.status = "part_paid";
  } else {
    this.balanceDue = 0;
    if (!["processed", "paid", "part_paid", "unpaid", "reversed"].includes(this.status)) {
      this.status = "processed";
    } else if (this.status !== "processed") {
      this.status = "processed";
    }
  }

  next();
});

export default mongoose.model("ProcessedStatement", ProcessedStatementSchema);
