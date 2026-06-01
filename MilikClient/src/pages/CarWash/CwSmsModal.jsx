import React, { useEffect, useState } from "react";
import { FaSms, FaTimes } from "react-icons/fa";

// ─── SMS unit calculation ────────────────────────────────────────────────────
// GSM-7 standard: 160 chars per SMS. Multi-part: 153 per segment.
// We cap at 3 SMS (459 chars) to prevent accidental huge sends.
const SMS_SINGLE = 160;
const SMS_MULTI = 153;
const MAX_SMS_UNITS = 3;
const MAX_CHARS = SMS_MULTI * MAX_SMS_UNITS; // 459

function calcSmsUnits(text) {
  const len = (text || "").length;
  if (len === 0) return { units: 0, remaining: SMS_SINGLE, chars: 0 };
  if (len <= SMS_SINGLE) return { units: 1, remaining: SMS_SINGLE - len, chars: len };
  const units = Math.min(MAX_SMS_UNITS, Math.ceil(len / SMS_MULTI));
  const used = units * SMS_MULTI;
  return { units, remaining: used - len, chars: len };
}

// ─── Quick-template chip ─────────────────────────────────────────────────────
const TemplateChip = ({ label, color = "slate", onClick }) => {
  const colors = {
    green:  "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    blue:   "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100",
    amber:  "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
    violet: "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100",
    slate:  "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100",
    red:    "border-red-300 bg-red-50 text-red-800 hover:bg-red-100",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-[11px] font-bold transition ${colors[color] || colors.slate}`}
    >
      {label}
    </button>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────
/**
 * CwSmsModal — shared SMS compose modal for all car wash pages.
 *
 * Props:
 *  target      — { name, phone } of recipient
 *  defaultBody — initial message text
 *  templates   — [{ label, body, color? }] quick-select templates
 *  context     — short string shown in header subtitle (e.g. "Job CW-…")
 *  onSend      — async (phone, body) => void
 *  onClose     — () => void
 *  sending     — boolean (disables send while in flight)
 */
const CwSmsModal = ({ target, defaultBody = "", templates = [], context = "", onSend, onClose, sending }) => {
  const [phone, setPhone] = useState(target?.phone || "");
  const [body, setBody]   = useState(defaultBody);
  const [phoneError, setPhoneError] = useState("");

  // Sync if parent swaps target
  useEffect(() => {
    setPhone(target?.phone || "");
    setBody(defaultBody);
    setPhoneError("");
  }, [target?._id]); // eslint-disable-line

  const { units, remaining, chars } = calcSmsUnits(body);
  const overLimit = chars > MAX_CHARS;

  const validatePhone = (val) => {
    const cleaned = val.replace(/\s/g, "");
    if (!cleaned) { setPhoneError("Phone number is required"); return false; }
    if (!/^\+?\d{7,15}$/.test(cleaned)) { setPhoneError("Enter a valid phone number (digits only, 7–15 chars)"); return false; }
    setPhoneError("");
    return true;
  };

  const handlePhoneChange = (e) => {
    setPhone(e.target.value);
    if (phoneError) validatePhone(e.target.value);
  };

  const handleSend = () => {
    if (!validatePhone(phone)) return;
    if (!body.trim()) return;
    if (overLimit) return;
    onSend(phone.trim(), body.trim());
  };

  const applyTemplate = (tmpl) => setBody(tmpl.body);

  // Counter colour
  const counterColor = overLimit
    ? "text-red-600 font-bold"
    : units >= 2
    ? "text-amber-600 font-semibold"
    : "text-slate-400";

  const smsLabel = units === 0 ? "" : units === 1 ? "1 SMS" : `${units} SMS`;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 bg-[#0B3B2E] px-4 py-3 text-white">
          <div>
            <div className="flex items-center gap-2">
              <FaSms className="text-emerald-300" />
              <h2 className="text-sm font-extrabold uppercase tracking-wide">Send SMS</h2>
            </div>
            <p className="mt-0.5 text-xs font-semibold text-emerald-100">
              {target?.name || "Customer"}
              {context ? ` · ${context}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="mt-0.5 p-1 text-white/70 hover:bg-white/10 hover:text-white">
            <FaTimes />
          </button>
        </div>

        <div className="space-y-3 p-4">

          {/* ── To (editable phone) ── */}
          <div>
            <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
              To
            </label>
            <div className="flex items-center gap-2">
              <input
                type="tel"
                value={phone}
                onChange={handlePhoneChange}
                onBlur={() => validatePhone(phone)}
                placeholder="e.g. 0712345678"
                className={`h-8 flex-1 border px-3 text-sm text-slate-800 outline-none focus:ring-1 ${
                  phoneError ? "border-red-400 focus:ring-red-300" : "border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20"
                }`}
              />
              {target?.name && (
                <span className="max-w-[140px] truncate text-[11px] font-semibold text-slate-500">
                  {target.name}
                </span>
              )}
            </div>
            {phoneError && <p className="mt-1 text-[11px] text-red-500">{phoneError}</p>}
          </div>

          {/* ── Quick templates ── */}
          {templates.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
                Quick Templates
              </label>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((tmpl, i) => (
                  <TemplateChip
                    key={i}
                    label={tmpl.label}
                    color={tmpl.color}
                    onClick={() => applyTemplate(tmpl)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Message ── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
                Message <span className="text-red-400">*</span>
              </label>
              <span className={`text-[11px] ${counterColor}`}>
                {chars}/{MAX_CHARS}
                {smsLabel && (
                  <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-black ${
                    units >= 2 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                  }`}>
                    {smsLabel}
                  </span>
                )}
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={MAX_CHARS}
              placeholder="Type your message…"
              className={`w-full resize-none border px-3 py-2 text-sm text-slate-800 outline-none focus:ring-1 ${
                overLimit ? "border-red-400 focus:ring-red-300" : "border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20"
              }`}
            />
            {units >= 2 && !overLimit && (
              <p className="mt-1 text-[11px] text-amber-600">
                This message will be sent as {units} SMS segments — some carriers charge per segment.
              </p>
            )}
            {overLimit && (
              <p className="mt-1 text-[11px] text-red-500">Message is too long. Shorten it to send.</p>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !body.trim() || overLimit || !!phoneError}
            className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FaSms />
            {sending ? "Sending…" : "Send SMS"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CwSmsModal;
