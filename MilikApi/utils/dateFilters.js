/**
 * Builds a Mongoose field filter for a date range.
 * Returns {} when neither bound is provided.
 */
export const buildDateRangeFilter = (field, dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return {};
  const cond = {};
  if (dateFrom) cond.$gte = new Date(dateFrom);
  if (dateTo)   cond.$lte = new Date(dateTo);
  return { [field]: cond };
};
