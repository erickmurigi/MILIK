import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import { documentsUpload, uploadBufferToCloudinary } from "../../../utils/cloudinaryUpload.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  getClientSummary,
  getClientStatement,
  sendClientSms,
  checkDuplicateClients,
} from "../controllers/clientsController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/",                            listClients);
router.post("/",                           createClient);
// Before "/:id" so "duplicates" is not read as an id.
router.get("/duplicates",                  checkDuplicateClients);

// One file (PDF or image) for client documents, signed contracts and WHT certificates → { url, name }.
// The caller saves the returned URL on whatever record it belongs to.
router.post("/uploads", documentsUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Choose a file to upload" });
    const business = resolveActiveBusinessId(req);
    const isPdf = req.file.mimetype === "application/pdf";
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: `milik/${business}/client-documents`,
      resource_type: isPdf ? "raw" : "image",
      // documents must stay exactly as uploaded — no resizing or re-encoding
      transformation: undefined,
      use_filename: true,
      unique_filename: true,
    });
    res.status(201).json({ success: true, data: { url: result.secure_url, name: req.file.originalname, uploadedAt: new Date() } });
  } catch (error) {
    next(error);
  }
});
router.get("/:id",    validateParamId(),   getClient);
router.get("/:id/summary", validateParamId(), getClientSummary);
router.get("/:id/statement", validateParamId(), getClientStatement);
router.post("/:id/send-sms", validateParamId(), sendClientSms);
router.put("/:id",    validateParamId(),   updateClient);
router.delete("/:id", validateParamId(),   deleteClient);

export default router;
