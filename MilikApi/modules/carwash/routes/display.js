import express from "express";
import { getQueueDisplay } from "../controllers/displayController.js";

const router = express.Router();

// No auth — public display screen mounted in waiting rooms.
router.get("/:businessId/queue", getQueueDisplay);

export default router;
