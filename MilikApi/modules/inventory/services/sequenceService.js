import SequenceCounter from "../../../models/SequenceCounter.js";

/**
 * Atomically increments the named counter and returns the formatted number string.
 * @param {string} business  - business ObjectId string
 * @param {string} key       - counter key, e.g. "po", "transfer", "receipt", "session"
 * @param {string} prefix    - number prefix, e.g. "PO", "TRF", "RCP", "SES"
 * @param {number} padLength - zero-pad width (default 5)
 */
export const nextSequenceNumber = async (business, key, prefix, padLength = 5) => {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business, key },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  );
  return `${prefix}-${String(counter.sequence).padStart(padLength, "0")}`;
};
