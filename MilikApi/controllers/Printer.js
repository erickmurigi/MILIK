import Printer from "../models/Printer.js"

// Adjusted createPrinter function
export const createPrinter = async (req, res, next) => {
  const { printerName, category, business, receiptPrinter, printCaptainOrder } = req.body;

  try {
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

  try{
    const printer = await Printer.findById(req.params.id)
    res.status(200).json(printer)

  }catch(err){
    next(err)
  }
}

//delete a single printer
export const deletePrinter = async (req,res,next) => {

  try{
    const printer = await Printer.findByIdAndDelete(req.params.id)
    res.status(200).json(printer)

  }catch(err){
    next(err)
  }
}

//get all printers
export const getPrinters = async (req,res,next) => {
  try{
    const { businessId } = req.query;

        if (!businessId) {
            return res.status(400).json({ message: "Business ID is required." });
        }
      const printers = await Printer.find({ business: businessId })
      res.status(200).json(printers)

  }catch(err){
    next(err)
  }
}