// Small presentational pieces shared by the contract billing pages (house UI standard).
import React, { useState } from 'react';
import { FaCheckCircle, FaExclamationTriangle, FaRegCircle } from 'react-icons/fa';
import Modal from '../../common/Modal';
import { BILLING_TONES } from './billingShared';

// ─── Form classes (AddLandlord.jsx standard) ─────────────────────────────────
export const labelClass = 'mb-1 block text-xs font-bold text-slate-900';
export const inputClass = 'h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20 disabled:bg-slate-50 disabled:text-slate-500';
export const tableInputClass = 'h-7 w-full border bg-white px-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20 disabled:bg-slate-50 disabled:text-slate-500';
export const tableMoneyClass = 'h-7 w-full border bg-white px-2 text-right text-xs tabular-nums text-slate-900 outline-none focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20 disabled:bg-slate-50';
export const textareaClass = 'w-full border bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20 disabled:bg-slate-50';
export const footerBtn = 'h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const footerPrimary = 'inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60';
export const footerDark = 'inline-flex h-8 items-center gap-1.5 border border-[#0B3B2E] bg-white px-3 text-xs font-black text-[#0B3B2E] hover:bg-[#0B3B2E]/5 disabled:opacity-50';
export const iconBtn = 'p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30';
export const iconBtnDanger = 'p-1 text-red-600 hover:bg-red-50 hover:text-red-800 disabled:opacity-30';
export const cell = 'px-3 py-1.5 border-r border-gray-100 normal-case';
export const cellLast = 'px-3 py-1.5 normal-case';
export const numCell = 'px-3 py-1.5 border-r border-gray-100 text-right tabular-nums';
// Action-bar buttons on detail pages (h-7, square).
export const barBtn = 'inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 bg-white px-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
export const barPrimary = 'inline-flex h-7 shrink-0 items-center gap-1 bg-[#0B3B2E] px-2.5 text-[11px] font-black text-white hover:bg-[#0A3127] disabled:opacity-40';
export const barOk = 'inline-flex h-7 shrink-0 items-center gap-1 border border-green-300 bg-green-50 px-2.5 text-[11px] font-bold text-green-700 hover:bg-green-100 disabled:opacity-40';
export const barDanger = 'inline-flex h-7 shrink-0 items-center gap-1 border border-red-200 bg-white px-2.5 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40';

export const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

export const Section = ({ title, children, className = '', bodyClass = 'p-2.5' }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      {typeof title === 'string'
        ? <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
        : title}
    </div>
    <div className={bodyClass}>{children}</div>
  </div>
);

export const StatusPill = ({ status, label, title }) => (
  <span title={title} className={`inline-block whitespace-nowrap border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${BILLING_TONES[status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
    {label || String(status || '—').replace(/_/g, ' ')}
  </span>
);

/** Neutral toolbar stat chip; clickable chips act as quick filters. */
export const Chip = ({ children, title, onClick, active }) => (
  <span
    title={title}
    onClick={onClick}
    className={`shrink-0 whitespace-nowrap border px-1.5 py-0.5 text-[10px] font-bold ${active ? 'border-[#0B3B2E] bg-[#0B3B2E]/5 text-[#0B3B2E]' : 'border-slate-200 bg-white text-slate-700'} ${onClick ? 'cursor-pointer hover:border-[#0B3B2E]/50' : ''}`}
  >
    {children}
  </span>
);

/** SMS / Email "sent" badges beside a record number. */
export const SentTags = ({ smsAt, emailAt }) => (
  <>
    {emailAt && <span className="ml-1.5 border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500" title={`Sent ${new Date(emailAt).toLocaleDateString('en-GB')}`}>EMAIL</span>}
    {smsAt && <span className="ml-1.5 border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500" title={`SMS sent ${new Date(smsAt).toLocaleDateString('en-GB')}`}>SMS</span>}
  </>
);

export const TabStrip = ({ tabs, active, onChange, right }) => (
  <div className="flex flex-none items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1">
    {tabs.map((t) => (
      <button
        key={t.key}
        type="button"
        onClick={() => onChange(t.key)}
        className={`h-[22px] shrink-0 whitespace-nowrap px-2 text-[10px] font-bold ${active === t.key ? 'bg-[#0B3B2E] text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
      >
        {t.label}{t.count != null ? <span className="ml-1 opacity-70">{t.count}</span> : null}
      </button>
    ))}
    {right && <div className="ml-auto flex shrink-0 items-center gap-1">{right}</div>}
  </div>
);

/** Value-first metric tile used in detail headers. */
export const Metric = ({ label, value, sub, tone = 'text-slate-900' }) => (
  <div className="min-w-0 border-l border-slate-200 px-3 first:border-l-0 first:pl-0">
    <p className="truncate text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <p className={`truncate text-sm font-black tabular-nums ${tone}`}>{value}</p>
    {sub && <p className="truncate text-[10px] text-slate-500">{sub}</p>}
  </div>
);

export const EmptyNote = ({ children }) => (
  <p className="px-3 py-6 text-center text-xs font-semibold text-slate-400">{children}</p>
);

/** Confirmation with an optional/required reason (reject, cancel, reverse, hold, skip...). */
export const ReasonModal = ({ title, message, confirmLabel = 'Confirm', danger = true, required = true, withReason = true, onClose, onConfirm, children }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = withReason && required && !reason.trim();
  const submit = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      size="sm"
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || blocked}
            className={danger ? 'inline-flex h-8 items-center bg-red-600 px-4 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50' : footerPrimary}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      {message && <div className="mb-2 text-xs text-slate-700">{message}</div>}
      {children}
      {withReason && (
        <>
          <label className={labelClass}>Reason{required && <Required />}</label>
          <textarea autoFocus rows={3} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being done?" />
        </>
      )}
    </Modal>
  );
};

/** Right-aligned totals block under a line table. rows = [{ label, value, hero?, muted? }] */
export const TotalsBlock = ({ rows, className = '' }) => (
  <div className={`ml-auto w-full max-w-xs border border-slate-200 ${className}`}>
    {rows.filter(Boolean).map((r) => (
      <div
        key={r.label}
        className={`flex items-center justify-between px-2.5 py-1 text-xs ${r.hero ? 'border-t border-slate-300 bg-[#0B3B2E] font-black text-white' : r.muted ? 'text-slate-500' : 'text-slate-800'}`}
      >
        <span className={r.hero ? 'uppercase tracking-wide' : 'font-semibold'}>{r.label}</span>
        <span className="tabular-nums font-bold">{r.value}</span>
      </div>
    ))}
  </div>
);

/** eTIMS submission state of an invoice (list icon). */
export const EtimsIcon = ({ invoice }) => {
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return <span className="text-slate-300">—</span>;
  const s = invoice.etimsStatus || 'not_submitted';
  if (s === 'submitted') return <FaCheckCircle size={11} className="inline text-emerald-600" title={`eTIMS submitted${invoice.etimsCuInvoiceNumber ? ` · CU ${invoice.etimsCuInvoiceNumber}` : ''}`} />;
  if (s === 'failed') return <FaExclamationTriangle size={11} className="inline text-red-600" title="eTIMS submission failed" />;
  return <FaRegCircle size={11} className="inline text-slate-400" title={`eTIMS: ${s.replace(/_/g, ' ')}`} />;
};
