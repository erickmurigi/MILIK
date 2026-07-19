/**
 * Canonical error response shape: { success: false, message }.
 * Use this everywhere instead of ad-hoc res.status(x).json({ error: ... }) or { message: ... }.
 */
export const sendError = (res, statusCode, message) =>
  res.status(statusCode).json({ success: false, message });
