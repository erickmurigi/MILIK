// Repeatable priced-line table shared by the contract, quote and invoice forms.
// mode: "contract" | "quote" (frequency/timing/recognition) or "invoice" (service period/recognition).
import React, { memo, useCallback } from 'react';
import { FaPlus, FaTrash, FaChevronDown, FaChevronRight } from 'react-icons/fa';
import AppSelect from '../../common/AppSelect';
import CurrencyInput from '../../common/CurrencyInput';
import { tableInputClass, tableMoneyClass, iconBtnDanger } from './BillingUi';
import { blankLine } from './billingLines';
import {
  FREQUENCY_OPTIONS, TIMING_OPTIONS, RECOGNITION_OPTIONS, lineAmounts, taxOf, money,
} from './billingShared';

const LineRow = memo(function LineRow({ line, idx, mode, taxCodes, taxOptions, taxMode, incomeOptions, disabled, onField, onRemove, canRemove }) {
  const a = lineAmounts({ ...line, ...taxOf(taxCodes, line.taxCodeKey), taxMode });
  const isInvoice = mode === 'invoice';
  const set = (field) => (e) => onField(line.key, field, e?.target ? e.target.value : e);
  const needsPeriod = line.revenueRecognition === 'straight_line' && (isInvoice || line.billingFrequency === 'one_off');
  return (
    <>
      <tr className="align-middle">
        <td className="w-6 px-1 py-1 text-center">
          <button type="button" className="text-slate-400 hover:text-slate-700" title="More (income account, dates)" onClick={() => onField(line.key, 'open', !line.open)}>
            {line.open ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
          </button>
        </td>
        <td className="px-1 py-1">
          <input className={tableInputClass} value={line.itemName} disabled={disabled} onChange={set('itemName')} placeholder={`Item / service ${idx + 1}`} maxLength={120} />
        </td>
        <td className="px-1 py-1">
          <input className={tableInputClass} value={line.description} disabled={disabled} onChange={set('description')} placeholder="Description" maxLength={300} />
        </td>
        <td className="w-14 px-1 py-1">
          <input className={`${tableInputClass} text-right`} inputMode="decimal" value={line.quantity} disabled={disabled} onChange={(e) => onField(line.key, 'quantity', e.target.value.replace(/[^0-9.]/g, ''))} />
        </td>
        <td className="w-28 px-1 py-1">
          <CurrencyInput prefix={null} value={line.unitPrice} disabled={disabled} onChange={set('unitPrice')} inputClassName={tableMoneyClass} />
        </td>
        <td className="w-14 px-1 py-1">
          <input className={`${tableInputClass} text-right`} inputMode="decimal" value={line.discountPercent} disabled={disabled} placeholder="0" onChange={(e) => onField(line.key, 'discountPercent', e.target.value.replace(/[^0-9.]/g, ''))} />
        </td>
        <td className="w-36 px-1 py-1">
          <AppSelect size="sm" value={line.taxCodeKey} onChange={(v) => onField(line.key, 'taxCodeKey', v || '')} options={taxOptions} placeholder="Tax code" disabled={disabled} />
        </td>
        {isInvoice ? (
          <>
            <td className="w-28 px-1 py-1"><input type="date" className={tableInputClass} value={line.servicePeriodStart} disabled={disabled} onChange={set('servicePeriodStart')} /></td>
            <td className="w-28 px-1 py-1"><input type="date" className={tableInputClass} value={line.servicePeriodEnd} disabled={disabled} onChange={set('servicePeriodEnd')} /></td>
          </>
        ) : (
          <>
            <td className="w-28 px-1 py-1">
              <AppSelect size="sm" value={line.billingFrequency} onChange={(v) => onField(line.key, 'billingFrequency', v || 'monthly')} options={FREQUENCY_OPTIONS} disabled={disabled} />
            </td>
            <td className="w-24 px-1 py-1">
              <AppSelect size="sm" value={line.billingTiming} onChange={(v) => onField(line.key, 'billingTiming', v || 'advance')} options={TIMING_OPTIONS} disabled={disabled || line.billingFrequency === 'one_off'} />
            </td>
          </>
        )}
        <td className="w-28 px-1 py-1">
          <AppSelect size="sm" value={line.revenueRecognition} onChange={(v) => onField(line.key, 'revenueRecognition', v || 'on_invoice')} options={RECOGNITION_OPTIONS} disabled={disabled} />
        </td>
        <td className="w-28 px-2 py-1 text-right tabular-nums">
          <span className="block font-bold text-slate-900">{money(a.total)}</span>
          {(a.tax > 0 || a.discount > 0) && (
            <span className="block text-[9px] text-slate-500">{a.discount > 0 ? `−${money(a.discount)} disc` : ''}{a.discount > 0 && a.tax > 0 ? ' · ' : ''}{a.tax > 0 ? `${money(a.tax)} tax` : ''}</span>
          )}
        </td>
        <td className="w-7 px-1 py-1 text-center">
          {!disabled && canRemove && (
            <button type="button" className={iconBtnDanger} title="Remove line" onClick={() => onRemove(line.key)}><FaTrash size={11} /></button>
          )}
        </td>
      </tr>
      {(line.open || (needsPeriod && !isInvoice && !(line.startDate && line.endDate))) && (
        <tr className="bg-slate-50/70">
          <td />
          <td colSpan={11} className="px-1 pb-1.5 pt-0.5">
            <div className="flex flex-wrap items-end gap-2">
              <label className="w-72">
                <span className="mb-0.5 block text-[10px] font-bold text-slate-600">Income account (blank = default)</span>
                <AppSelect size="sm" value={line.incomeAccount} onChange={(v) => onField(line.key, 'incomeAccount', v || '')} options={incomeOptions} placeholder="Default income account" searchable clearable disabled={disabled} />
              </label>
              {!isInvoice && (
                <>
                  <label className="w-32">
                    <span className="mb-0.5 block text-[10px] font-bold text-slate-600">Line starts{needsPeriod ? ' *' : ''}</span>
                    <input type="date" className={tableInputClass} value={line.startDate} disabled={disabled} onChange={set('startDate')} />
                  </label>
                  <label className="w-32">
                    <span className="mb-0.5 block text-[10px] font-bold text-slate-600">Line ends{needsPeriod ? ' *' : ''}</span>
                    <input type="date" className={tableInputClass} value={line.endDate} disabled={disabled} onChange={set('endDate')} />
                  </label>
                  <span className="pb-1.5 text-[10px] text-slate-500">
                    {needsPeriod ? 'A one-off line recognised straight-line needs its service period.' : 'Leave blank to follow the contract term.'}
                  </span>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

const LineItemsEditor = ({
  lines, onChange, mode = 'contract', taxCodes, taxOptions, taxMode, incomeOptions = [], defaultTaxCodeKey = '', disabled = false,
}) => {
  const onField = useCallback((key, field, value) => {
    onChange((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, [field]: value };
      if (field === 'billingFrequency' && value === 'one_off') next.billingTiming = 'advance';
      return next;
    }));
  }, [onChange]);
  const onRemove = useCallback((key) => onChange((prev) => prev.filter((l) => l.key !== key)), [onChange]);
  const add = () => onChange((prev) => [...prev, blankLine(defaultTaxCodeKey, mode)]);
  const isInvoice = mode === 'invoice';

  return (
    <div>
      <div className="overflow-x-auto border border-slate-200">
        <table className="w-full min-w-[1080px] table-auto text-[11px]">
          <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-1 py-1" />
              <th className="px-2 py-1">Item<span className="text-red-600">*</span></th>
              <th className="px-2 py-1">Description</th>
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Unit price</th>
              <th className="px-2 py-1 text-right">Disc %</th>
              <th className="px-2 py-1">Tax code</th>
              {isInvoice ? (
                <>
                  <th className="px-2 py-1">Service from</th>
                  <th className="px-2 py-1">Service to</th>
                </>
              ) : (
                <>
                  <th className="px-2 py-1">Frequency</th>
                  <th className="px-2 py-1">Timing</th>
                </>
              )}
              <th className="px-2 py-1">Recognition</th>
              <th className="px-2 py-1 text-right">Line total</th>
              <th className="px-1 py-1" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line, idx) => (
              <LineRow
                key={line.key}
                line={line}
                idx={idx}
                mode={mode}
                taxCodes={taxCodes}
                taxOptions={taxOptions}
                taxMode={taxMode}
                incomeOptions={incomeOptions}
                disabled={disabled}
                onField={onField}
                onRemove={onRemove}
                canRemove={lines.length > 1}
              />
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <button type="button" onClick={add} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
          <FaPlus size={9} /> Add line
        </button>
      )}
    </div>
  );
};

export default LineItemsEditor;
