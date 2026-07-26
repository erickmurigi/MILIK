import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listInteractions,
  createInteraction,
  deleteInteraction,
} from "../controllers/interactionsController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/",                            listInteractions);
router.post("/",                           createInteraction);
router.delete("/:id", validateParamId(),   deleteInteraction);

export default router;
