import SequenceCounter from "../models/SequenceCounter.js";

/**
 * Atomically increments the named counter and returns a formatted sequence string.
 * Safe under concurrent writes — uses findOneAndUpdate with upsert.
 * If the resulting number conflicts with an existing document, jumps past the
 * current max (pass `conflictCheck` to enable this).
 *
 * @param {string} business    - business ObjectId string
 * @param {string} key         - counter key, e.g. "po", "transfer", "receipt"
 * @param {string} prefix      - number prefix, e.g. "PO", "TRF", "RCP"
 * @param {number} padLength   - zero-pad width (default 5)
 * @param {object} [conflictCheck] - { Model, field } to check for existing docs
 */
export const nextSequenceNumber = async (
  business,
  key,
  prefix,
  padLength = 5,
  conflictCheck = null,
) => {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business, key },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true },
  );

  let seq = counter.sequence;

  if (conflictCheck) {
    const { Model, field = key } = conflictCheck;
    const candidate = `${prefix}-${String(seq).padStart(padLength, "0")}`;
    const exists = await Model.exists({ business, [field]: candidate });
    if (exists) {
      const maxDoc = await Model.findOne({ business, [field]: { $regex: `^${prefix}-` } })
        .sort({ [field]: -1 })
        .select(field)
        .lean();
      if (maxDoc) {
        const currentMax = parseInt(String(maxDoc[field]).split("-")[1], 10) || 0;
        if (currentMax >= seq) {
          seq = currentMax + 1;
          await SequenceCounter.findOneAndUpdate(
            { business, key },
            { $max: { sequence: seq } },
            { upsert: true },
          );
        }
      }
    }
  }

  return `${prefix}-${String(seq).padStart(padLength, "0")}`;
};
