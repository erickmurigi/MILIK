import mongoose from 'mongoose';

const carWashCustomerSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: null },
    plates: {
      type: [{ type: String, trim: true, uppercase: true }],
      default: [],
    },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

carWashCustomerSchema.index(
  { business: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } }
);
carWashCustomerSchema.index({ business: 1, plates: 1 });
carWashCustomerSchema.index({ business: 1, name: 1 });

export default mongoose.model('CarWashCustomer', carWashCustomerSchema);
