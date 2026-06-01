import React from 'react';
import { useSelector } from 'react-redux';
import { selectCurrentCompany } from '../../redux/selectors';
import { FaPhone, FaEnvelope, FaIdCard, FaMapMarkerAlt } from 'react-icons/fa';

/**
 * Company letterhead for printed HR documents.
 *
 * variant="document" — always visible (Payslip, P9)
 * variant="print"    — screen-hidden, print-only (reports, registers)
 */
export default function PrintLetterhead({ variant = 'print', docLabel, docTitle, docMeta, printedDate }) {
  const company = useSelector(selectCurrentCompany);
  if (!company) return null;

  const { companyName, roadStreet, town, postalAddress, phoneNo, email, taxPIN, slogan, logo } = company;
  const address = [roadStreet, town].filter(Boolean).join(', ');

  const header = (
    <div className={variant === 'print' ? 'print-only mb-4' : 'mb-4'}>
      {/* ── Company identity row ── */}
      <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-300">
        <div className="flex items-start gap-3">
          {logo && (
            <img
              src={logo}
              alt={companyName}
              className="h-14 w-14 object-contain shrink-0 rounded"
              style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
            />
          )}
          <div>
            <div className="text-2xl font-black text-slate-900 leading-tight">{companyName}</div>
            {slogan && <div className="text-[10px] italic text-slate-400 mt-0.5">{slogan}</div>}
            {address && (
              <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <FaMapMarkerAlt size={9} className="shrink-0 text-slate-400" /> {address}
              </div>
            )}
            {postalAddress && (
              <div className="text-xs text-slate-500">{postalAddress}</div>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right space-y-0.5">
          {phoneNo && (
            <div className="flex items-center justify-end gap-1.5 text-xs text-slate-600">
              <FaPhone size={9} className="text-slate-400" /> {phoneNo}
            </div>
          )}
          {email && (
            <div className="flex items-center justify-end gap-1.5 text-xs text-slate-600">
              <FaEnvelope size={9} className="text-slate-400" /> {email}
            </div>
          )}
          {taxPIN && (
            <div className="flex items-center justify-end gap-1.5 text-xs text-slate-600">
              <FaIdCard size={9} className="text-slate-400" />
              KRA PIN: <span className="font-mono font-semibold">{taxPIN}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Document title row (optional) ── */}
      {(docLabel || docTitle) && (
        <div className="mt-3 flex items-end justify-between border-b-2 border-slate-800 pb-2">
          <div>
            {docLabel && (
              <div className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">{docLabel}</div>
            )}
            {docTitle && (
              <div className="text-xl font-black text-slate-900 leading-tight">{docTitle}</div>
            )}
            {docMeta && (
              <div className="text-xs text-slate-500 mt-0.5">{docMeta}</div>
            )}
          </div>
          {printedDate !== false && (
            <div className="text-right text-[10px] text-slate-400">
              Printed: {new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return header;
}
