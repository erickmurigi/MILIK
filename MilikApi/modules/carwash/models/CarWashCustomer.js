import mongoose from 'mongoose';

const carWashCustomerSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    name: { type: String, required: true, trim: true, minlength: 1 },
    phone: { type: String, trim: true, default: null },
    maskedMsisdn: { type: String, trim: true, default: null },
    plates: {
      type: [{ type: String, trim: true, uppercase: true }],
      default: [],
    },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Denormalized stats — kept current by recomputeCustomerStats after every job/payment mutation.
    // Allows DB-level sorting and filtering without post-enrichment aggregations.
    stats: {
      totalJobs:     { type: Number, default: 0 },
      totalInvoiced: { type: Number, default: 0 },
      totalPaid:     { type: Number, default: 0 },
      outstanding:   { type: Number, default: 0 },
      lastVisit:     { type: Date,   default: null },
    },
  },
  { timestamps: true }
);

carWashCustomerSchema.index(
  { business: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } }
);
carWashCustomerSchema.index({ business: 1, plates: 1 });
carWashCustomerSchema.index({ business: 1, name: 1 });
// Indexes for sort/filter on denormalized stats fields
carWashCustomerSchema.index({ business: 1, 'stats.outstanding': -1 });
carWashCustomerSchema.index({ business: 1, 'stats.lastVisit':   -1 });
carWashCustomerSchema.index({ business: 1, 'stats.totalPaid':   -1 });
carWashCustomerSchema.index({ business: 1, 'stats.totalJobs':   -1 });

export default mongoose.model('CarWashCustomer', carWashCustomerSchema);
