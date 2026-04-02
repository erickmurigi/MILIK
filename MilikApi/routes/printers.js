import express from "express"
import {createPrinter,deletePrinter,getPrinter, getPrinters} from "../controllers/Printer.js"
const router = express.Router()
import { verifyUser } from "../controllers/verifyToken.js"


//create printers
router.post("/",verifyUser ,createPrinter)

//get all printers
router.get("/",verifyUser ,getPrinters)

//get a single printer
router.get("/:id",verifyUser ,getPrinter)

//delete a printer
router.delete("/:id",verifyUser ,deletePrinter)









export default router