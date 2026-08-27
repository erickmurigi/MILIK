import mongoose from "mongoose";
import { TENANT_INVOICE_CATEGORIES } from "./TenantInvoice.js";

export const TENANT_NOTE_TYPES = ["CREDIT_NOTE", "DEBIT_NOTE"];
export const TENANT_NOTE_STATUSES = ["draft", "posted", "partially_paid", "paid", "cancelled", "reversed"];

const TenantInvoiceNoteSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
      index: true,
    },
    sourceInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantInvoice",
      required: false,
      default: null,
      index: true,
    },
    noteNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    noteType: {
      type: String,
      enum: TENANT_NOTE_TYPES,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: TENANT_INVOICE_CATEGORIES,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, "Amount must be positive"],
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    noteDate: {
      type: Date,
      required: true,
      index: true,
    },
    bookingDate: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: TENANT_NOTE_STATUSES,
      default: "posted",
      index: true,
    },
    outstanding: {
      type: Number,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    chartAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
      index: true,
    },
    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    ledgerEntries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FinancialLedgerEntry",
      },
    ],
    postingStatus: {
      type: String,
      enum: ["unposted", "posted", "failed", "reversed", "not_applicable"],
      default: "posted",
      index: true,
    },
    postingError: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

TenantInvoiceNoteSchema.index({ business: 1, noteNumber: 1 }, { unique: true });
TenantInvoiceNoteSchema.index({ business: 1, tenant: 1, noteDate: -1 });
// Covers snapshot query: {business, tenant, status:$nin, postingStatus} sort noteDate — replaces the
// looser {business, tenant, noteDate} prefix scan that did not filter by status before sorting.
TenantInvoiceNoteSchema.index({ business: 1, tenant: 1, status: 1, noteDate: -1 });
TenantInvoiceNoteSchema.index({ business: 1, sourceInvoice: 1, noteType: 1, status: 1 });
TenantInvoiceNoteSchema.index({ business: 1, property: 1, status: 1, noteDate: -1 });

export default mongoose.model("TenantInvoiceNote", TenantInvoiceNoteSchema);
