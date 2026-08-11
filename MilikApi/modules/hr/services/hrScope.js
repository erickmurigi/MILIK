import mongoose from "mongoose";

export {
  resolveBusinessIdOrThrow as resolveCompanyId,
  currentUserId,
} from "../../../utils/requestContext.js";

export { escapeRegex } from "../../../utils/escapeRegex.js";
export { parsePage, parseLimit, parsePagination } from "../../../utils/pagination.js";

export const requireOid = (id, label = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(String(id || ""))) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
};

export const toOid = (v) =>
  v && mongoose.Types.ObjectId.isValid(String(v))
    ? new mongoose.Types.ObjectId(String(v))
    : undefined;
