// Normalise image URLs — strips the absolute origin from legacy URLs so the relative
// path proxy (/uploads/...) works in both dev and production.
export const imgSrc = (url) => {
  if (!url || url.startsWith("/")) return url;
  try { return new URL(url).pathname; } catch { return url; }
};
