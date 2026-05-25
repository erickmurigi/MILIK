import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listLocations, getLocation, createLocation, updateLocation, deleteLocation,
} from "../controllers/locationsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",     listLocations);
router.get("/:id",  getLocation);
router.post("/",    createLocation);
router.put("/:id",  updateLocation);
router.delete("/:id", deleteLocation);

export default router;
