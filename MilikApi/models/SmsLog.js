import mongoose from 'mongoose';

const SmsLogSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['sms', 'email'],
      default: 'sms',
    },
    contextType: { type: String, trim: true, default: '' },
    templateKey: { type: String, trim: true, default: '' },
    templateName: { type: String, trim: true, default: '' },
    profileName: { type: String, trim: true, default: '' },
    provider: { type: String, trim: true, default: '' },
    to: { type: String, trim: true, default: '' },
    recipientName: { type: String, trim: true, default: '' },
    body: { type: String, trim: true, default: '' },
    subject: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['sent', 'failed', 'pending'],
      default: 'pending',
      index: true,
    },
    providerMessageId: { type: String, trim: true, default: '' },
    providerStatus: { type: String, trim: true, default: '' },
    costLabel: { type: String, trim: true, default: '' },
    error: { type: String, trim: true, default: '' },
    recordId: { type: String, trim: true, default: '' },
    isTest: { type: Boolean, default: false },
    sentAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

SmsLogSchema.index({ business: 1, sentAt: -1 });
SmsLogSchema.index({ business: 1, channel: 1, sentAt: -1 });
SmsLogSchema.index({ business: 1, status: 1, sentAt: -1 });

export default mongoose.model('SmsLog', SmsLogSchema);
