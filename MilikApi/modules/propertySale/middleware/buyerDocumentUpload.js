import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import { createError } from "../../../utils/error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "../../../uploads/sale-buyers");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Unlike listing photos, a KYC document (a scanned ID, passport, or proof of address) must stay exactly
// as submitted — no resize/recompress/format-conversion step. PDFs can't go through Sharp at all, and
// converting an ID scan to WebP would be the kind of silent alteration a compliance record can't have.
const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"]);
const EXT_BY_MIME = {
  "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    (req.rejectedFiles ||= []).push({
      name: file.originalname,
      reason: `unsupported type "${file.mimetype}" (allowed: JPEG, PNG, WebP, PDF)`,
    });
    cb(null, false);
  },
}).array("documents", 10);

// Write each buffer to disk under a random filename (collision-proof, doesn't leak the original name
// into the URL) while preserving the original bytes and extension.
const writeFiles = (req, _res, next) => {
  if (!req.files?.length) return next();
  try {
    req.files = req.files.map((file) => {
      const filename = `${crypto.randomUUID()}${EXT_BY_MIME[file.mimetype] || ""}`;
      const dest = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(dest, file.buffer);
      return { ...file, filename };
    });
    next();
  } catch (err) {
    next(err);
  }
};

export const buyerDocumentUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) return next(err);
    if (req.rejectedFiles?.length) {
      const names = req.rejectedFiles.map((r) => `${r.name} (${r.reason})`).join("; ");
      return next(createError(400, `Upload rejected — invalid file(s): ${names}. No documents were saved.`));
    }
    writeFiles(req, res, next);
  });
};

export const deleteDocumentFile = (fileUrl) => {
  try {
    const filename = path.basename(fileUrl);
    const filePath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Best-effort — never block the request
  }
};
