export {
  resolveBusinessIdOrThrow as resolveActiveBusinessId,
  currentUserId,
  parseBoolean,
  parseDateRange,
  parseMonthRange,
} from "../../../utils/requestContext.js";

export { escapeRegex } from "../../../utils/escapeRegex.js";
export { parsePage, parseLimit, parsePagination } from "../../../utils/pagination.js";

import { nextSequenceNumber } from "../../../utils/sequenceService.js";

// Adapter — keeps old call sites working: generateSequentialNumber(Model, business, prefix)
export const generateSequentialNumber = (_Model, business, prefix) =>
  nextSequenceNumber(String(business), prefix.toLowerCase(), prefix);
