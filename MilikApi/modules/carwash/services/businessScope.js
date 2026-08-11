import mongoose from "mongoose";

export {
  resolveBusinessIdOrThrow as resolveActiveBusinessId,
  currentUserId,
  parseBoolean,
  parseDateRange,
} from "../../../utils/requestContext.js";

export { escapeRegex } from "../../../utils/escapeRegex.js";
export { parsePage, parseLimit, parsePagination } from "../../../utils/pagination.js";

export const netJobPrice = (job) =>
  Math.max(0, Number(job?.price || 0) - Number(job?.discountAmount || 0));

export const resolveActiveBranchId = (req) => {
  const activeCompanyId = String(
    req.headers?.["x-active-company-id"] ||
    req.headers?.["x-company-id"] ||
    req.user?.company?._id ||
    req.user?.company ||
    "",
  );
  if (!activeCompanyId) return null;
  const assignments = Array.isArray(req.user?.companyAssignments) ? req.user.companyAssignments : [];
  const assignment = assignments.find(
    (a) => String(a?.company?._id || a?.company) === activeCompanyId,
  );
  const branchId = assignment?.carwashBranch || null;
  if (!branchId) return null;
  const id = String(branchId).trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
};
