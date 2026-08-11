export const parsePage  = (v, def = 1)            => Math.max(parseInt(v, 10) || def, 1);
export const parseLimit = (v, def = 50, max = 200) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);

/**
 * Extracts and validates page + limit from req.query.
 * Returns { page, limit, skip } ready for Mongoose .skip().limit().
 */
export const parsePagination = (req, { defaultLimit = 50, maxLimit = 200 } = {}) => {
  const page  = parsePage(req.query.page);
  const limit = parseLimit(req.query.limit, defaultLimit, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};
