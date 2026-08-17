// Injects an on-the-fly Cloudinary delivery transformation into an already-
// uploaded image's secure_url — e.g. cloudinaryUrl(url, { width: 200, height: 200 })
// for a thumbnail — instead of always loading the full-resolution original.
// Always adds auto quality/format negotiation (WebP/AVIF where supported).
// No-ops for non-Cloudinary URLs (e.g. local blob previews of staged files).
export const cloudinaryUrl = (url, { width, height, crop = "fill" } = {}) => {
  const raw = String(url || "");
  if (!raw.includes("res.cloudinary.com") || !raw.includes("/upload/")) return raw;

  const parts = ["q_auto", "f_auto"];
  if (width) parts.push(`w_${Math.round(width)}`);
  if (height) parts.push(`h_${Math.round(height)}`);
  if (width || height) parts.push(`c_${crop}`);

  return raw.replace("/upload/", `/upload/${parts.join(",")}/`);
};
