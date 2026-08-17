import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadBufferToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(options, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      })
      .end(buffer);
  });

export const destroyCloudinaryAsset = (publicId) =>
  cloudinary.uploader.destroy(publicId).catch(() => {});

// Recovers the Cloudinary public_id (including folder) from a secure_url so
// an image can be deleted from storage when it's removed from a listing.
export const publicIdFromCloudinaryUrl = (url) => {
  const match = String(url || "").match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1] : null;
};

export const imagesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only jpeg, png, or webp images are allowed"));
  },
});
