import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createAgent, deleteAgent, getAgent, listAgents, updateAgent } from "../controllers/agentsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-agents", "view", "propertySale"), listAgents);
router.get("/:id", requireCompanyPermission("sale-agents", "view", "propertySale"), getAgent);
router.post("/", requireCompanyPermission("sale-agents", "create", "propertySale"), createAgent);
router.put("/:id", requireCompanyPermission("sale-agents", "update", "propertySale"), updateAgent);
router.delete("/:id", requireCompanyPermission("sale-agents", "update", "propertySale"), deleteAgent);

export default router;
