import express from "express";
import { registerPushToken, unregisterPushToken } from "../controllers/pushTokenController.js";
import { verifyUser } from "../controllers/verifyToken.js";

const router = express.Router();

router.post("/register", verifyUser, registerPushToken);
router.post("/unregister", verifyUser, unregisterPushToken);

export default router;
