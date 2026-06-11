import React, { useState } from 'react';
import { FaTimes, FaEnvelope, FaPaperPlane } from 'react-icons/fa';

/**
 * Reusable modal for sending an HR document via email.
 *
 * Props:
 *   title       — modal heading  e.g. "Email Payslip"
 *   defaultEmail — pre-filled recipient (employee email on file)
 *   onSend(email) — async fn called with the final email address; should return { to, subject }
 *   onClose()   — called when modal should close
 */
export default function EmailSendModal({ title, defaultEmail = '', onSend, onClose }) {
  const [email, setEmail]     = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [done, setDone]       = useState(null); // { to, subject }

  const handle = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      const result = await onSend(email.trim());
      setDone(result);
    } catch {
      // parent already toasted
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
              <FaEnvelope size={12} className="text-emerald-700" />
            </div>
            <h2 className="text-sm font-black text-slate-900">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <FaTimes size={11} />
          </button>
        </div>

        {done ? (
          /* Success state */
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <FaPaperPlane size={18} className="text-emerald-600" />
            </div>
            <p className="text-sm font-black text-emerald-700">Email sent!</p>
            <p className="text-xs text-slate-500">
              Delivered to <strong>{done.to}</strong>
            </p>
            <p className="text-[10px] text-slate-400 italic">"{done.subject}"</p>
            <button
              onClick={onClose}
              className="mt-1 rounded-xl bg-emerald-600 px-6 py-2 text-xs font-black text-white hover:bg-emerald-700"
            >
              Done
            </button>
          </div>
        ) : (
          /* Send form */
          <form onSubmit={handle} className="px-5 py-5 space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                Recipient Email
              </label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="employee@example.com"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {!defaultEmail && (
                <p className="mt-1 text-[10px] text-amber-600 font-semibold">
                  No email on file — enter the recipient address manually.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending || !email.trim()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0B3B2E] py-2 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-40"
              >
                <FaPaperPlane size={9} />
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
