import mongoose from "mongoose";

const PrinterSchema = new mongoose.Schema({
  printerName: {type: String,required: true},
  category:{type:String,default:""},
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' } ,
  printerIdentifier: { type: Number, required: true },
  receiptPrinter:{type:Boolean,default:false},
  printCaptainOrder:{type:Boolean,default:false}
});

export default mongoose.model("Printer",PrinterSchema)



