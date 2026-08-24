import { useEffect, useState } from "react";
import { FaEnvelope, FaTimes } from "react-icons/fa";
import { saleApi } from "../../services/propertySaleApi";

const BUILTIN_TEMPLATES = {
  buyer: [
    {
      label:   "Deal Confirmation",
      subject: "Your Property Deal Confirmation",
      body:    "Dear {buyerName},\n\nWe are pleased to confirm that your property deal has been successfully recorded. Our team will be in touch with the next steps.\n\nThank you for choosing us.\n\nBest regards,\n{companyName}",
    },
    {
      label:   "Payment Received",
      subject: "Payment Received — Thank You",
      body:    "Dear {buyerName},\n\nWe confirm receipt of your recent payment. Your account has been updated accordingly.\n\nPlease do not hesitate to reach out if you have any queries.\n\nBest regards,\n{companyName}",
    },
    {
      label:   "Balance Reminder",
      subject: "Outstanding Balance Reminder",
      body:    "Dear {buyerName},\n\nThis is a friendly reminder that your account has an outstanding balance. Kindly arrange payment at your earliest convenience.\n\nFor any queries, please contact our team.\n\nBest regards,\n{companyName}",
    },
  ],
  deal: [
    {
      label:   "Deal Confirmation",
      subject: "Deal {dealNumber} — Confirmation",
      body:    "Dear {buyerName},\n\nWe are pleased to confirm that deal {dealNumber} for {listingTitle} has been successfully recorded at KES {salePrice}.\n\nOur team will be in touch with the next steps.\n\nBest regards,\n{companyName}",
    },
    {
      label:   "Payment Reminder",
      subject: "Payment Reminder — Deal {dealNumber}",
      body:    "Dear {buyerName},\n\nThis is a friendly reminder that an outstanding balance exists on deal {dealNumber} for {listingTitle}. Kindly arrange payment at your earliest convenience.\n\nBest regards,\n{companyName}",
    },
    {
      label:   "Deal Update",
      subject: "Update on Deal {dealNumber}",
      body:    "Dear {buyerName},\n\nWe have an update regarding deal {dealNumber} for {listingTitle}. Please contact our office for further details.\n\nBest regards,\n{companyName}",
    },
  ],
};

const renderVars = (text, vars = {}) =>
  String(text || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));

export default function SaleEmailModal({ title, subtitle, emailForm, setEmailForm, sending, onSend, onClose, context = "buyer", vars = {} }) {
  const [apiTemplates, setApiTemplates] = useState([]);

  useEffect(() => {
    saleApi.getSettings().then((s) => {
      if (s?.commTemplates) {
        setApiTemplates(s.commTemplates.filter((t) => t.channel === "email" && t.context === context && t.isActive !== false));
      }
    }).catch(() => {});
  }, [context]);

  const applyTemplate = (t) =>
    setEmailForm({ subject: renderVars(t.subject, vars), body: renderVars(t.body, vars) });

  const builtins = BUILTIN_TEMPLATES[context] ?? BUILTIN_TEMPLATES.buyer;
  const allTemplates = [...builtins, ...apiTemplates.map((t) => ({ label: t.name, subject: t.subject, body: t.body }))];

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="flex w-full max-w-md flex-col bg-white shadow-2xl sm:border sm:border-slate-200 rounded-t-2xl sm:rounded-none">
        {/* Header */}
        <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-[#1a4069] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide">
              <FaEnvelope className="text-white/70" />{title}
            </div>
            <div className="text-xs font-semibold text-white/70">{subtitle}</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
        </div>

        {/* Quick templates */}
        <div className="flex-shrink-0 flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <span className="self-center text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Templates:</span>
          {allTemplates.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t)}
              className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-[#1a4069] hover:text-[#1a4069] transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-3 p-4">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Subject</label>
            <input
              value={emailForm.subject}
              onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))}
              className="h-8 w-full border border-slate-200 bg-white px-3 text-xs focus:border-[#1a4069] focus:outline-none"
              placeholder="e.g. Property Sale Update"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Message</label>
            <textarea
              rows={6}
              value={emailForm.body}
              onChange={(e) => setEmailForm((f) => ({ ...f, body: e.target.value }))}
              className="w-full border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#1a4069] focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={onSend} disabled={sending} className="bg-[#1a4069] px-4 py-1.5 text-xs font-black text-white hover:bg-[#143354] disabled:opacity-60">
            {sending ? "Sending…" : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}
