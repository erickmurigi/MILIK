import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "../../../uploads/sale-listings");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

// Use memory storage so Sharp can process the buffer before writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
}).array("images", 10);

// Process each uploaded buffer through Sharp: convert to WebP, cap at 1920px wide, compress
const processImages = async (req, _res, next) => {
  if (!req.files?.length) return next();
  try {
    const processed = await Promise.all(
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
    req.files = processed;
    next();
  } catch (err) {
    next(err);
  }
};

export const listingImageUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) return next(err);
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
