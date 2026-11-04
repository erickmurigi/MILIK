import mongoose from "mongoose";

// A client's promise to pay by a date. While open and not yet due, dunning
// stays quiet for the covered invoices (all of the client's invoices when
// `invoices` is empty). The daily run marks it kept or broken afterwards.
const clientPromiseToPaySchema = new mongoose.Schema(
  {
    business:       { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:         { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    invoices:       [{ type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice" }],
    promiseDate:    { type: Date, required: true },
    promisedAmount: { type: Number, default: 0, min: 0 },
    status:         { type: String, enum: ["open", "kept", "broken", "cancelled"], default: "open" },
    // Receipts dated on/after this count towards keeping the promise.
    madeAt:         { type: Date, default: Date.now },
    contactName:    { type: String, trim: true, default: "" },
    notes:          { type: String, trim: true, default: "" },
    resolvedAt:     { type: Date, default: null },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clientPromiseToPaySchema.index({ business: 1, client: 1, status: 1, promiseDate: 1 });
clientPromiseToPaySchema.index({ business: 1, status: 1, promiseDate: 1 });

export default mongoose.model("ClientPromiseToPay", clientPromiseToPaySchema);
