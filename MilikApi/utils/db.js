import mongoose from "mongoose";
const { Types: { ObjectId } } = mongoose;

/** Casts a raw value (string, ObjectId, or {_id} object) to a Mongoose ObjectId. Returns null if invalid. */
export const toObjectId = (v) => {
  const raw = typeof v === "object" && v?._id ? v._id : v;
  if (!raw || !ObjectId.isValid(String(raw))) return null;
  return new ObjectId(String(raw));
};
