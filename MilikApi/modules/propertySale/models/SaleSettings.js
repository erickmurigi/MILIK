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

// One release step: once a deal's buyer has paid this cumulative % of the agreed price, this cumulative
// % of the relevant commission should have been recognized. Validated (sorted, <=100) in the controller,
// not here, so an in-progress/partial config can always be saved without a hard block.
const releaseTierSchema = new mongoose.Schema(
  { _id: false, thresholdPct: { type: Number, min: 0, max: 100, required: true }, releasePct: { type: Number, min: 0, max: 100, required: true } }
);

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
    // Whether this company sells on behalf of outside property/project owners: shows the Owners page
    // and the owner-commission/statement features. Default false — byte-identical behavior for everyone else.
    useOwners: { type: Boolean, default: false },
    // Whether this company routes buyer payments through conveyancing advocates' trust accounts: shows
    // the Advocates page and the advocate-trust/remittance features. Default false — no behavior change.
    useAdvocates: { type: Boolean, default: false },
    commissionDefaults: {
      rate:           { type: Number, default: 3,           min: 0 },
      commissionType: { type: String, enum: ["percentage", "flat"], default: "percentage" },
      whtRate:        { type: Number, default: 5,           min: 0, max: WHT_MAX_RATE },
    },
    // The company's own agency commission for selling on an owner's behalf. Only meaningful when a deal's
    // project has an owner — independent of commissionDefaults, which is the broker/SaleAgent rate.
    ownerCommissionDefaults: {
      rate:           { type: Number, default: 3, min: 0 },
      commissionType: { type: String, enum: ["percentage", "flat"], default: "percentage" },
    },
    // Staged/tiered release of owner commission and broker commission, keyed off the buyer's cumulative %
    // of agreedPrice paid on a deal. enabled:false (default) = full amount released immediately on
    // approval, today's exact behavior, for every company that doesn't touch this.
    commissionReleaseSchedule: {
      enabled: { type: Boolean, default: false },
      ownerCommissionTiers:  { type: [releaseTierSchema], default: [] },
      brokerCommissionTiers: { type: [releaseTierSchema], default: [] },
    },
    // Company-wide default for who withholds/remits WHT when an advocate pays a broker's commission
    // out of trust funds. Overridable per-advocate (SaleAdvocate.whtHandledBy). "agent" (default) is
    // today's exact behavior: the advocate forwards the withheld amount and the company remits it.
    advocateDefaults: {
      whtHandledBy: { type: String, enum: ["advocate", "agent"], default: "agent" },
    },
    // Per-business override of which real ChartOfAccount backs each of the module's fixed system
    // accounts (see PS_ACCOUNT_TEMPLATES in services/propertySaleAccountingService.js) — keyed by the
    // same code string (e.g. "4430"), so a template added later needs no schema change here. Empty/unset
    // for a code keeps today's exact behavior: resolvePSAccount auto-creates its own system account.
    accountingDefaults: {
      type: Map,
      of: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

export default mongoose.model("SaleSettings", saleSettingsSchema);
