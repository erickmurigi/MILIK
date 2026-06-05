import Company from "../../../models/Company.js";

// ─── Template definitions ─────────────────────────────────────────────────────
// These are the defaults shown in the UI and used as fallback when an operator
// hasn't saved a custom body. Keep messageBody in sync with the hardcoded strings
// used by each controller so "reset to default" always restores the original text.

export const CW_SMS_TEMPLATE_DEFAULTS = [
  {
    key: "carwash_payment_confirmed",
    name: "Payment Confirmed",
    description: "Sent automatically when a payment is received for a job.",
    enabled: true,
    messageBody: "Hi {{customerName}}! KES {{amount}} received for {{plate}}. {{balanceLine}} Thank you!",
    placeholders: [
      { token: "{{customerName}}", hint: "Customer name" },
      { token: "{{plate}}",        hint: "Vehicle plate number" },
      { token: "{{amount}}",       hint: "Amount just received (formatted)" },
      { token: "{{balanceLine}}",  hint: "\"Fully paid.\" or \"Balance: KES X.\"" },
    ],
  },
  {
    key: "carwash_stamp_earned",
    name: "Loyalty Stamp Earned",
    description: "Sent automatically each time a loyalty stamp is added.",
    enabled: true,
    messageBody: "Hi {{customerName}}! Stamp {{currentStamps}}/{{stampsRequired}} earned for {{plate}}. {{remaining}} more {{washesWord}} to your reward! 🚗",
    placeholders: [
      { token: "{{customerName}}",  hint: "Customer name" },
      { token: "{{plate}}",         hint: "Vehicle plate number" },
      { token: "{{currentStamps}}", hint: "Stamps earned so far on current card" },
      { token: "{{stampsRequired}}",hint: "Total stamps needed for a reward" },
      { token: "{{remaining}}",     hint: "Stamps still needed" },
      { token: "{{washesWord}}",    hint: "\"wash\" or \"washes\" (auto-pluralised)" },
    ],
  },
  {
    key: "carwash_reward_ready",
    name: "Reward Earned",
    description: "Sent automatically when a customer completes a stamp card and earns a reward.",
    enabled: true,
    messageBody: "Hi {{customerName}}! 🎉 You've earned {{rewardDesc}} for {{plate}}. Redeem on your next visit. Thank you!",
    placeholders: [
      { token: "{{customerName}}", hint: "Customer name" },
      { token: "{{plate}}",        hint: "Vehicle plate number" },
      { token: "{{rewardDesc}}",   hint: "e.g. \"a FREE wash\" or \"20% off your next wash\"" },
    ],
  },
  {
    key: "carwash_reward_redeemed",
    name: "Reward Redeemed",
    description: "Sent when a loyalty reward is used at the cashier (controlled by the loyalty program smsOnReward flag).",
    enabled: true,
    messageBody: "Hi {{customerName}}! Your loyalty reward has been redeemed for {{plate}}. Thank you for your continued support! 🚗✨",
    placeholders: [
      { token: "{{customerName}}", hint: "Customer name" },
      { token: "{{plate}}",        hint: "Vehicle plate number" },
    ],
  },
  {
    key: "carwash_statement",
    name: "Account Statement",
    description: "Sent when a credit/monthly account statement is generated or auto-billed.",
    enabled: true,
    messageBody: "Hi {{customerName}}, your car wash statement for {{period}} is KES {{outstanding}} for {{totalJobs}} wash(es). Ref: {{statementNumber}}. Thank you!",
    placeholders: [
      { token: "{{customerName}}",    hint: "Customer name" },
      { token: "{{period}}",          hint: "Billing period, e.g. \"June 2026\"" },
      { token: "{{outstanding}}",     hint: "Amount due (formatted)" },
      { token: "{{totalJobs}}",       hint: "Number of jobs in the statement" },
      { token: "{{statementNumber}}", hint: "Statement reference number" },
    ],
  },
];

// ─── Variable substitution ─────────────────────────────────────────────────────

const applyVars = (template, vars = {}) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? "") : `{{${key}}}`
  );

// ─── Resolver ─────────────────────────────────────────────────────────────────
/**
 * Returns the final SMS body for a given templateKey.
 * Loads the operator's saved template from Company.carwashSettings.smsTemplates.
 * Falls back to CW_SMS_TEMPLATE_DEFAULTS if not configured or disabled.
 *
 * @param {string|object} businessId  — ObjectId or string
 * @param {string}        templateKey — e.g. "carwash_payment_confirmed"
 * @param {object}        vars        — substitution map, e.g. { customerName, plate, amount }
 * @returns {string|null}  resolved body, or null if the template is disabled
 */
export const resolveCarWashSmsBody = async (businessId, templateKey, vars = {}) => {
  const def = CW_SMS_TEMPLATE_DEFAULTS.find((t) => t.key === templateKey);

  try {
    const company = await Company.findById(businessId).select("carwashSettings").lean();
    const saved = (company?.carwashSettings?.smsTemplates || []).find((t) => t.key === templateKey);

    if (saved) {
      if (saved.enabled === false) return null; // operator explicitly disabled this SMS
      const body = String(saved.messageBody || def?.messageBody || "").trim();
      return body ? applyVars(body, vars) : null;
    }
  } catch {
    // Fall through to default — never block a payment/stamp flow for a settings lookup failure
  }

  // Use default
  if (!def) return null;
  if (def.enabled === false) return null;
  return applyVars(def.messageBody, vars);
};
