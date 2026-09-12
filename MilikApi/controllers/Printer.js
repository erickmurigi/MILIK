import Printer from "../models/Printer.js"

// Every handler below is scoped to the AUTHENTICATED user's own company —
// req.body.business / req.query.businessId are never trusted for tenant scoping.
// Previously getPrinter/deletePrinter looked printers up by _id alone (any
// authenticated user of any company could read or delete another company's
// printer), and getPrinters/createPrinter trusted a client-supplied business id
// outright. See the security hotfix for the full writeup.
const resolveOwnBusinessId = (req) =>
  req.user?.company?._id || req.user?.company || req.user?.business || null;

// Adjusted createPrinter function
export const createPrinter = async (req, res, next) => {
  const { printerName, category, receiptPrinter, printCaptainOrder } = req.body;
  const business = resolveOwnBusinessId(req);

  try {
    if (!business) {
      return res.status(403).json({ message: "No company associated with user" });
    }

    // Find the highest current printer identifier for the specified business
    const highestPrinter = await Printer.findOne({ business }).sort({ printerIdentifier: -1 });
    const highestIdentifier = highestPrinter ? highestPrinter.printerIdentifier : 0;
    const newIdentifier = highestIdentifier + 1;

    // Create a new printer with the next highest identifier within the specific business
    const newPrinter = new Printer({
      printerName,
      category,
      business,
      printerIdentifier: newIdentifier,
      receiptPrinter,
      printCaptainOrder,
    });

    const savedPrinter = await newPrinter.save();
    res.status(201).json(savedPrinter);
  } catch (error) {
    next(error);
  }
};


//get a single printer
export const getPrinter = async (req,res,next) => {
  const business = resolveOwnBusinessId(req);

  try{
    if (!business) {
      return res.status(403).json({ message: "No company associated with user" });
    }
    const printer = await Printer.findOne({ _id: req.params.id, business })
    if (!printer) return res.status(404).json({ message: "Printer not found" });
    res.status(200).json(printer)

  }catch(err){
    next(err)
  }
}

//delete a single printer
export const deletePrinter = async (req,res,next) => {
  const business = resolveOwnBusinessId(req);

  try{
    if (!business) {
      return res.status(403).json({ message: "No company associated with user" });
    }
    const printer = await Printer.findOneAndDelete({ _id: req.params.id, business })
    if (!printer) return res.status(404).json({ message: "Printer not found" });
    res.status(200).json(printer)

  }catch(err){
    next(err)
  }
}

//get all printers
export const getPrinters = async (req,res,next) => {
  const business = resolveOwnBusinessId(req);

  try{
    if (!business) {
      return res.status(403).json({ message: "No company associated with user" });
    }
      const printers = await Printer.find({ business })
      res.status(200).json(printers)

  }catch(err){
    next(err)
  }
}