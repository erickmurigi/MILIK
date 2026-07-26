import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  getClientSummary,
} from "../controllers/clientsController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/",                            listClients);
router.post("/",                           createClient);
router.get("/:id",    validateParamId(),   getClient);
router.get("/:id/summary", validateParamId(), getClientSummary);
router.put("/:id",    validateParamId(),   updateClient);
router.delete("/:id", validateParamId(),   deleteClient);

export default router;
