import mongoose from "mongoose";

// Per-company collections setup (dunning schedule, templates, credit-limit
// policy). Lives here rather than on CompanySettings so the Clients module
// owns its own configuration; one document per company, created lazily with
// the defaults below.
//
// Template merge fields: {{clientName}} {{invoiceNumber}} {{amount}}
// {{outstanding}} {{dueDate}} {{daysOverdue}} {{payInstructions}} {{companyName}}

const DEFAULT_SMS = {
  before: "Dear {{clientName}}, invoice {{invoiceNumber}} of {{outstanding}} is due on {{dueDate}}. {{payInstructions}} - {{companyName}}",
  due: "Dear {{clientName}}, invoice {{invoiceNumber}} of {{outstanding}} is due today. {{payInstructions}} - {{companyName}}",
  overdue: "Dear {{clientName}}, invoice {{invoiceNumber}} of {{outstanding}} is {{daysOverdue}} days overdue. Kindly pay. {{payInstructions}} - {{companyName}}",
  final: "Dear {{clientName}}, FINAL NOTICE: invoice {{invoiceNumber}} of {{outstanding}} is {{daysOverdue}} days overdue. Please settle immediately to avoid service suspension. {{payInstructions}} - {{companyName}}",
};

const emailBody = (lead) =>
  `Dear {{clientName}},\n\n${lead}\n\nInvoice: {{invoiceNumber}}\nAmount outstanding: {{outstanding}}\nDue date: {{dueDate}}\n\n{{payInstructions}}\n\nIf you have already paid, please ignore this message or send us the payment reference.\n\nRegards,\n{{companyName}}`;

export const DEFAULT_DUNNING_STEPS = [
  { key: "before_3", offsetDays: -3, channels: ["email"], smsTemplate: DEFAULT_SMS.before, emailSubject: "Reminder: invoice {{invoiceNumber}} due on {{dueDate}}", emailTemplate: emailBody("This is a friendly reminder that the invoice below falls due soon."), active: true },
  { key: "due_0", offsetDays: 0, channels: ["sms", "email"], smsTemplate: DEFAULT_SMS.due, emailSubject: "Invoice {{invoiceNumber}} is due today", emailTemplate: emailBody("The invoice below is due for payment today."), active: true },
  { key: "overdue_7", offsetDays: 7, channels: ["sms", "email"], smsTemplate: DEFAULT_SMS.overdue, emailSubject: "Overdue: invoice {{invoiceNumber}}", emailTemplate: emailBody("Our records show the invoice below is now {{daysOverdue}} days overdue."), active: true },
  { key: "overdue_14", offsetDays: 14, channels: ["sms", "email"], smsTemplate: DEFAULT_SMS.overdue, emailSubject: "Second reminder: invoice {{invoiceNumber}} is {{daysOverdue}} days overdue", emailTemplate: emailBody("This is a second reminder that the invoice below is {{daysOverdue}} days overdue."), active: true },
  { key: "overdue_30", offsetDays: 30, channels: ["sms", "email"], smsTemplate: DEFAULT_SMS.final, emailSubject: "Final notice: invoice {{invoiceNumber}}", emailTemplate: emailBody("FINAL NOTICE: the invoice below is {{daysOverdue}} days overdue. Please settle it immediately to avoid suspension of services."), active: true },
];

const stepSchema = new mongoose.Schema(
  {
    key:           { type: String, required: true, trim: true },
    offsetDays:    { type: Number, required: true, min: -60, max: 365 },
    channels:      { type: [{ type: String, enum: ["sms", "email"] }], default: ["sms", "email"] },
    smsTemplate:   { type: String, default: "" },
    emailSubject:  { type: String, default: "" },
    emailTemplate: { type: String, default: "" },
    active:        { type: Boolean, default: true },
  },
  { _id: false }
);

const clientCollectionSettingsSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    // Off until a company opts in, so deploying the module never starts
    // texting a company's clients unannounced.
    dunningEnabled:  { type: Boolean, default: false },
    steps:           { type: [stepSchema], default: () => DEFAULT_DUNNING_STEPS.map((s) => ({ ...s })) },
    payInstructions: { type: String, trim: true, default: "" },
    minimumAmount:   { type: Number, default: 1, min: 0 },
    // What happens when a client is over their credit limit at billing time.
    creditLimitAction: { type: String, enum: ["warn", "block"], default: "warn" },
    creditWarnPercent: { type: Number, default: 90, min: 1, max: 100 },
    updatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clientCollectionSettingsSchema.index({ business: 1 }, { unique: true });
clientCollectionSettingsSchema.index({ dunningEnabled: 1 });

export default mongoose.model("ClientCollectionSettings", clientCollectionSettingsSchema);
