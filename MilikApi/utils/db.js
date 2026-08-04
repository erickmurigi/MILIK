import mongoose from "mongoose";
const { Types: { ObjectId } } = mongoose;

/** Casts a raw value to a Mongoose ObjectId. Returns null if invalid. */
export const toObjectId = (v) =>
  ObjectId.isValid(String(v || "")) ? new ObjectId(String(v)) : null;
