import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  listCoopCollections,
  assignTenantToCoopCollection,
  ignoreCoopCollection,
  unignoreCoopCollection,
  deleteCoopCollection,
} from "../../controllers/propertyController/coopB2BCollections.js";

const router = express.Router();

router.get("/",                       verifyUser, listCoopCollections);
router.post("/:id/assign-tenant",     verifyUser, assignTenantToCoopCollection);
router.post("/:id/ignore",            verifyUser, ignoreCoopCollection);
router.post("/:id/unignore",          verifyUser, unignoreCoopCollection);
router.delete("/:id",                 verifyUser, deleteCoopCollection);

export default router;
