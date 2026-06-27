import express from "express";
import { getQueueDisplay, getQueueBgImage } from "../controllers/displayController.js";

const router = express.Router();

// No auth — public display screen mounted in waiting rooms.
router.get("/:businessId/queue", getQueueDisplay);
router.get("/:businessId/bg",    getQueueBgImage);

export default router;
