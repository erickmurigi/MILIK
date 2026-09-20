import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAgentScope } from "../middleware/agentScope.js";
import {
  applyProjectDetails, assignUnits, createProject, deleteProject, detachUnit, generateUnits,
  getProject, listProjects, listProjectUnits, setProjectArchived, updateProject, updateUnitPrices,
} from "../controllers/projectsController.js";

const router = express.Router();

// Projects are managed with the same permission as listings ("sale-listings"): whoever manages listings manages
// the projects and units they belong to. attachAgentScope only affects the money figures on GET /:id.
router.use(verifyUser, requireCompanyModule("propertySale"), attachAgentScope);

const view   = requireCompanyPermission("sale-listings", "view",   "propertySale");
const create = requireCompanyPermission("sale-listings", "create", "propertySale");
const update = requireCompanyPermission("sale-listings", "update", "propertySale");

router.get("/",    view,   listProjects);
router.post("/",   create, createProject);
router.get("/:id", view,   getProject);
router.put("/:id", update, updateProject);
router.patch("/:id/archive", update, setProjectArchived);
router.delete("/:id", update, deleteProject);

router.get("/:id/units",                view,   listProjectUnits);
router.post("/:id/units/generate",      create, generateUnits);
router.post("/:id/units/assign",        update, assignUnits);
router.patch("/:id/units/price",        update, updateUnitPrices);
router.post("/:id/units/apply-details", update, applyProjectDetails);
router.delete("/:id/units/:listingId",  update, detachUnit);

export default router;
