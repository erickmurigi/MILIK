import mongoose from "mongoose";
import { WHT_MAX_RATE } from "../../../utils/withholdingTax.js";

const stageSchema = new mongoose.Schema(
  { _id: mongoose.Schema.Types.ObjectId, name: { type: String, required: true, trim: true }, order: { type: Number, default: 0 }, isActive: { type: Boolean, default: true } }
);

const simpleSchema = new mongoose.Schema(
  { _id: mongoose.Schema.Types.ObjectId, name: { type: String, required: true, trim: true }, isActive: { type: Boolean, default: true } }
);

// Extra fields a property type asks for (a vehicle: registration, make, mileage). The key is stable, so stored
// listing values stay attached when the label is renamed. Validated by services/listingAttributes.js.
const customFieldSchema = new mongoose.Schema(
  {
    key:      { type: String, required: true, trim: true },
    label:    { type: String, required: true, trim: true },
    kind:     { type: String, enum: ["text", "number", "select", "date", "boolean"], default: "text" },
    options:  { type: [String], default: [] },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const propertyTypeSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  name: { type: String, required: true, trim: true },
  isActive: { type: Boolean, default: true },
  fields: { type: [customFieldSchema], default: [] },
  // Standard listing fields this type does not use (size / location / titleDeed / amenities): not asked on the form
  hiddenFields: { type: [String], default: [] },
});

const commTemplateSchema = new mongoose.Schema({
  _id:     { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  name:    { type: String, required: true, trim: true },
  channel: { type: String, enum: ["sms", "email"], required: true },
  context: { type: String, enum: ["buyer", "deal", "lead"], required: true },
  subject: { type: String, trim: true, default: "" },
  body:    { type: String, required: true, trim: true },
  isActive:{ type: Boolean, default: true },
});

const saleSettingsSchema = new mongoose.Schema(
  {
    business:     { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    pipelineStages: { type: [stageSchema],        default: [] },
    leadSources:    { type: [simpleSchema],        default: [] },
    propertyTypes:  { type: [propertyTypeSchema],  default: [] },
    commTemplates:  { type: [commTemplateSchema],  default: [] },
    // Whether agent-linked users see only their own records ("own") or the whole business ("all")
    agentVisibility: { type: String, enum: ["own", "all"], default: "own" },
    // Whether this company sells in projects/units: shows the Projects and Units pages
    useProjects: { type: Boolean, default: false },
    commissionDefaults: {
      rate:           { type: Number, default: 3,           min: 0 },
      commissionType: { type: String, enum: ["percentage", "flat"], default: "percentage" },
      whtRate:        { type: Number, default: 5,           min: 0, max: WHT_MAX_RATE },
    },
  },
  { timestamps: true }
);

export default mongoose.model("SaleSettings", saleSettingsSchema);
