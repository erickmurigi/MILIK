import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";

export const validateParamId = (paramName = "id") => (req, res, next) => {
  const value = req.params[paramName];
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    return next(createError(400, `Invalid ${paramName} format`));
  }
  next();
};
