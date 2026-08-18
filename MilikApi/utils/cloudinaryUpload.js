import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

// Configured lazily so env vars are read at call-time, not at ESM import time
// (server.js calls dotenv.config() after all imports are resolved).
const applyCloudinaryConfig = () =>
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

const DEFAULT_UPLOAD_TRANSFORMATION = [
  { width: 1920, height: 1920, crop: "limit" },
  { quality: "auto:good", fetch_format: "auto" },
];

export const uploadBufferToCloudinary = (buffer, options) => {
  applyCloudinaryConfig();
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { transformation: DEFAULT_UPLOAD_TRANSFORMATION, ...options },
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      )
      .end(buffer);
  });
};

export const destroyCloudinaryAsset = (publicId) => {
  applyCloudinaryConfig();
  return cloudinary.uploader.destroy(publicId).catch(() => {});
};

// Recovers the Cloudinary public_id (including folder) from a secure_url so
// an image can be deleted from storage when it's removed from a listing.
export const publicIdFromCloudinaryUrl = (url) => {
  const match = String(url || "").match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1] : null;
};

// Injects an on-the-fly delivery transformation into a Cloudinary URL, e.g.
// cloudinaryUrl(url, { width: 300, height: 300, crop: "fill" }) for a thumbnail.
// Always adds quality/format auto-negotiation. No-ops for non-Cloudinary URLs.
export const cloudinaryUrl = (url, { width, height, crop = "fill" } = {}) => {
  const raw = String(url || "");
  if (!raw.includes("res.cloudinary.com") || !raw.includes("/upload/")) return raw;

  const parts = [`q_auto`, `f_auto`];
  if (width) parts.push(`w_${Math.round(width)}`);
  if (height) parts.push(`h_${Math.round(height)}`);
  if (width || height) parts.push(`c_${crop}`);

  return raw.replace("/upload/", `/upload/${parts.join(",")}/`);
};

export const imagesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only jpeg, png, or webp images are allowed"));
  },
});
