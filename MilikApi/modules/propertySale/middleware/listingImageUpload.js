import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import sharp from "sharp";
import { createError } from "../../../utils/error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "../../../uploads/sale-listings");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

// Use memory storage so Sharp can process the buffer before writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  // Rejected files are recorded (not silently dropped) so the whole batch can
  // be failed with a 400 naming them — see listingImageUpload below.
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    (req.rejectedImages ||= []).push({
      name: file.originalname,
      reason: `unsupported type "${file.mimetype}" (allowed: JPEG, PNG, WebP)`,
    });
    cb(null, false);
  },
}).array("images", 10);

// Process each uploaded buffer through Sharp: convert to WebP, cap at 1920px wide, compress
const processImages = async (req, _res, next) => {
  if (!req.files?.length) return next();
  try {
    const results = await Promise.allSettled(
      req.files.map(async (file) => {
        const filename = `${crypto.randomUUID()}.webp`;
        const dest     = path.join(UPLOAD_DIR, filename);
        await sharp(file.buffer)
          .rotate()                          // auto-rotate from EXIF orientation
          .resize({ width: 1920, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(dest);
        return { ...file, filename, path: dest };
      })
    );
    const processed = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const failed    = results.find((r) => r.status === "rejected");
    if (failed) {
      // Don't leave orphaned files behind when part of the batch failed
      processed.forEach((f) => deleteImageFile(f.filename));
      return next(failed.reason);
    }
    req.files = processed;
    next();
  } catch (err) {
    next(err);
  }
};

export const listingImageUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) return next(err);
    // Fail the whole batch loudly if any file was rejected by the type filter.
    // Nothing has been written to disk yet (memory storage), so no cleanup needed.
    if (req.rejectedImages?.length) {
      const names = req.rejectedImages.map((r) => `${r.name} (${r.reason})`).join("; ");
      return next(createError(400, `Upload rejected — invalid file(s): ${names}. No images were saved.`));
    }
    processImages(req, res, next);
  });
};

export const deleteImageFile = (imageUrl) => {
  try {
    const filename = path.basename(imageUrl);
    const filePath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Best-effort — never block the request
  }
};
