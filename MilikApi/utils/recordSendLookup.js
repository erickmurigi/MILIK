import mongoose from "mongoose";
import SmsLog from "../models/SmsLog.js";

export const getLastSentByRecord = async ({ businessId, contextTypes, recordIds }) => {
  const ids = [...new Set((recordIds || []).map(String).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await SmsLog.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(businessId),
        status: "sent",
        contextType: { $in: contextTypes },
        recordId: { $in: ids },
      },
    },
    { $group: { _id: { recordId: "$recordId", channel: "$channel" }, sentAt: { $max: "$sentAt" } } },
  ]);
  const byRecord = new Map();
  for (const { _id, sentAt } of rows) {
    const entry = byRecord.get(_id.recordId) || { sms: null, email: null };
    if (_id.channel === "sms") entry.sms = sentAt;
    if (_id.channel === "email") entry.email = sentAt;
    byRecord.set(_id.recordId, entry);
  }
  return byRecord;
};
