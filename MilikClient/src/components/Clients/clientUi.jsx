// Small presentational pieces shared by the Contract Management pages.
import React, { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { FaUpload } from 'react-icons/fa';
import { clientsCollectionsApi } from '../../services/clientsCollectionsApi';
import Modal from '../common/Modal';
import { STATUS_TONES, humanize, footerBtn, footerPrimary, labelClass, textareaClass } from './clientHelpers';

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

export const StatusPill = ({ status, label }) => (
  <span className={`inline-block border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${STATUS_TONES[status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
    {label || humanize(status) || '—'}
  </span>
);

/** Neutral toolbar stat chip. */
export const Chip = ({ children, title }) => (
  <span title={title} className="shrink-0 whitespace-nowrap border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{children}</span>
);

/** SMS/Email "sent" badges beside a record number. */
export const SentTags = ({ smsAt, emailAt }) => (
  <>
    {smsAt && <span className="ml-1.5 border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500" title={`SMS sent ${new Date(smsAt).toLocaleDateString('en-GB')}`}>SMS</span>}
    {emailAt && <span className="ml-1.5 border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500" title={`Emailed ${new Date(emailAt).toLocaleDateString('en-GB')}`}>EMAIL</span>}
  </>
);

/** KPI tile — square, neutral, value-first. */
export const Kpi = ({ label, value, sub, tone = 'text-slate-900', children, onClick }) => (
  <div
    onClick={onClick}
    className={`min-w-0 border border-slate-200 bg-white px-3 py-2 ${onClick ? 'cursor-pointer hover:border-[#0B3B2E]/40' : ''}`}
  >
    <p className="truncate text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <p className={`mt-0.5 truncate text-base font-black tabular-nums ${tone}`}>{value}</p>
    {sub && <p className="truncate text-[10px] text-slate-500">{sub}</p>}
    {children}
  </div>
);

/** Tab strip used inside pages (same look as the detail-page tabs). */
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

/** Destructive action with a mandatory reason (reverse receipt, refund, allocation...). */
export const ReasonModal = ({ title, message, confirmLabel = 'Confirm', danger = true, required = true, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (required && !reason.trim()) return;
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
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (required && !reason.trim())}
            className={danger ? 'inline-flex h-8 items-center bg-red-600 px-4 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50' : footerPrimary}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      {message && <p className="mb-2 text-xs text-slate-700">{message}</p>}
      <label className={labelClass}>Reason{required && <Required />}</label>
      <textarea autoFocus rows={3} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being done?" />
    </Modal>
  );
};

/** Horizontal share bar (top clients etc.). */
export const ShareBar = ({ value, max, tone = 'bg-[#0B3B2E]' }) => (
  <div className="h-1.5 w-full bg-slate-100">
    <div className={`h-1.5 ${tone}`} style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
  </div>
);

export const EmptyNote = ({ children }) => (
  <p className="px-3 py-6 text-center text-xs font-semibold text-slate-400">{children}</p>
);

// Uploads one PDF/image and hands back { url, name, uploadedAt } — the record it belongs to stores the link
export const UploadButton = ({ onUploaded, label = 'Upload file', className = '' }) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const res = await clientsCollectionsApi.uploadDocument(file);
      onUploaded(res.data?.data || res.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={handleChange} />
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={`inline-flex items-center gap-1 text-xs font-bold text-[#0B3B2E] hover:underline disabled:opacity-50 ${className}`}>
        <FaUpload size={9} /> {busy ? 'Uploading…' : label}
      </button>
    </>
  );
};
