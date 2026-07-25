import React, { useEffect, useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { FaFileInvoice, FaCheck } from "react-icons/fa6";
import {
  buildTaxPreviewForComponents,
  getActiveTaxCodes,
  normalizeCompanyTaxConfig,
  getTaxCodeLabel,
} from "./invoiceTaxUtils";

const InvoiceCreationModal = ({
  isOpen,
  periods = [],
  onConfirm,
  onCancel,
  depositOption = null,
  taxConfig = null,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [billingMode, setBillingMode] = useState("separate");
  const [includeDeposit, setIncludeDeposit] = useState(false);
  const [depositAmountInput, setDepositAmountInput] = useState("");
  const [taxSelection, setTaxSelection] = useState({
    handling: "company_default",
    taxCodeKey: "",
    taxMode: "company_default",
  });

  const normalizedTaxConfig = useMemo(() => normalizeCompanyTaxConfig(taxConfig), [taxConfig]);
  const activeTaxCodes = useMemo(() => getActiveTaxCodes(normalizedTaxConfig), [normalizedTaxConfig]);
  const taxEnabled = Boolean(normalizedTaxConfig?.taxSettings?.enabled);

  useEffect(() => {
    if (isOpen) {
      setBillingMode("separate");
      setIncludeDeposit(false); // always unchecked — user must opt in
      setDepositAmountInput(
        depositOption?.amount !== undefined && depositOption?.amount !== null
          ? String(depositOption.amount)
          : ""
      );
      setTaxSelection({
        handling: "company_default",
        taxCodeKey: normalizedTaxConfig?.taxSettings?.defaultTaxCodeKey || "vat_standard",
        taxMode: "company_default",
      });
    }
  }, [
    isOpen,
    depositOption?.amount,
    depositOption?.enabled,
    normalizedTaxConfig?.taxSettings?.defaultTaxCodeKey,
  ]);

  const tenantName  = periods[0]?.tenantName  ?? "N/A";
  const propertyName = periods[0]?.propertyName ?? "N/A";
  const { totalRentAmount, totalUtilityAmount } = useMemo(() => ({
    totalRentAmount:    periods.reduce((s, p) => s + Number(p.rent    || 0), 0),
    totalUtilityAmount: periods.reduce((s, p) => s + Number(p.utility || 0), 0),
  }), [periods]);
  const defaultDepositAmount = Number(depositOption?.amount || 0);
  const depositAmount = Number(depositAmountInput || 0);

  const taxComponents = useMemo(() => [
    totalRentAmount    > 0 ? { category: "RENT_CHARGE",    amount: totalRentAmount    } : null,
    totalUtilityAmount > 0 ? { category: "UTILITY_CHARGE", amount: totalUtilityAmount } : null,
  ].filter(Boolean), [totalRentAmount, totalUtilityAmount]);

  const taxPreview = useMemo(
    () => buildTaxPreviewForComponents({ components: taxComponents, companyTaxConfig: normalizedTaxConfig, selection: taxSelection }),
    [taxComponents, normalizedTaxConfig, taxSelection]
  );

  const totalWithDeposit = Number(taxPreview.grossAmount || 0) + (includeDeposit ? depositAmount : 0);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (includeDeposit && depositAmount <= 0) return;
    setIsCreating(true);
    try {
      await onConfirm({ billingMode, includeDeposit, depositAmount, taxSelection });
    } finally {
      setIsCreating(false);
    }
  };

  const inputCls = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#0B3B2E] disabled:bg-slate-100 disabled:text-slate-400";
  const labelCls = "block text-[10px] font-black uppercase tracking-wide text-slate-500 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:max-w-xl">

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 bg-[#0B3B2E] border-b border-slate-700 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <FaFileInvoice className="text-emerald-400" size={14} />
            <h2 className="text-sm font-black uppercase tracking-wide">Create Invoices</h2>
          </div>
          <button onClick={onCancel} disabled={isCreating} className="text-white/60 hover:text-white transition-colors disabled:opacity-40">
            <FaTimes size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Tenant / Property */}
          <div className="bg-slate-50 border border-slate-200 p-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tenant</p>
              <p className="font-bold text-slate-800">{tenantName}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Property</p>
              <p className="font-bold text-slate-800">{propertyName}</p>
            </div>
          </div>

          {/* Selected Periods */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
              Selected Periods <span className="text-slate-300">({periods.length})</span>
            </p>
            <div className="border border-slate-200 divide-y divide-slate-100">
              {periods.map((period, idx) => (
                <div key={period.periodKey || period.description || idx} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{period.description}</p>
                    <p className="text-[11px] text-slate-400">{period.from} — {period.to}</p>
                  </div>
                  <p className="text-sm font-bold text-slate-800">
                    Ksh {(period.rent + (period.utility || 0)).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Invoice Totals */}
          <div className="border border-slate-200">
            {[
              { label: "Subtotal before tax", value: Number(taxPreview.netAmount  || 0) },
              { label: "Estimated tax",       value: Number(taxPreview.taxAmount   || 0) },
              { label: "Gross invoice total", value: Number(taxPreview.grossAmount || 0) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center px-3 py-2 border-b border-slate-100 last:border-0 text-sm text-slate-600">
                <span>{label}</span>
                <span className="font-semibold">Ksh {value.toLocaleString()}</span>
              </div>
            ))}
            <div className="flex justify-between items-center px-3 py-2.5 bg-[#0B3B2E]/[0.05] border-t-2 border-[#0B3B2E]/20">
              <span className="text-sm font-black text-slate-800">
                Grand total{includeDeposit ? " (incl. deposit)" : ""}
              </span>
              <span className="text-base font-black text-[#0B3B2E]">
                Ksh {Number(totalWithDeposit || 0).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Billing Mode */}
          <div className="border-l-4 border-emerald-400 bg-emerald-50 px-3 py-2.5">
            <p className="text-sm font-bold text-emerald-900">Separate invoices</p>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              Rent and utility invoices are created separately so each posts to the correct ledger account.
            </p>
          </div>

          {/* Tax / VAT Handling */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Tax / VAT Handling</p>
            <div className="border border-slate-200 p-3 space-y-3">
              {!taxEnabled && (
                <div className="border-l-4 border-amber-400 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] text-amber-800">
                    Tax is disabled in Company Setup — company-default tax will produce no VAT until enabled.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Tax handling</label>
                  <select
                    value={taxSelection.handling}
                    onChange={(e) => setTaxSelection((p) => ({ ...p, handling: e.target.value }))}
                    disabled={isCreating}
                    className={inputCls}
                  >
                    <option value="company_default">Use company default</option>
                    <option value="taxable" disabled={!taxEnabled}>Force taxable</option>
                    <option value="non_taxable">Force non-taxable</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tax code</label>
                  <select
                    value={taxSelection.taxCodeKey}
                    onChange={(e) => setTaxSelection((p) => ({ ...p, taxCodeKey: e.target.value }))}
                    disabled={isCreating || taxSelection.handling === "non_taxable"}
                    className={inputCls}
                  >
                    {activeTaxCodes.map((code) => (
                      <option key={code.key} value={code.key}>
                        {code.name} ({Number(code.rate || 0)}%)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tax mode</label>
                  <select
                    value={taxSelection.taxMode}
                    onChange={(e) => setTaxSelection((p) => ({ ...p, taxMode: e.target.value }))}
                    disabled={isCreating || taxSelection.handling === "non_taxable"}
                    className={inputCls}
                  >
                    <option value="company_default">Use company default</option>
                    <option value="exclusive">Exclusive</option>
                    <option value="inclusive">Inclusive</option>
                  </select>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600">
                Tax code: <strong>{getTaxCodeLabel(taxSelection.taxCodeKey, normalizedTaxConfig)}</strong>
                {taxSelection.handling === "company_default" ? " · Company rules by category" : null}
                {taxSelection.handling === "non_taxable"    ? " · Forced non-taxable"         : null}
              </div>
            </div>
          </div>

          {/* Security Deposit */}
          {depositOption && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Security Deposit</p>
              <div className={`border p-3 space-y-2 ${includeDeposit ? "border-[#0B3B2E]/30 bg-[#0B3B2E]/[0.04]" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-slate-800">
                      Default deposit: <span className="text-[#0B3B2E]">Ksh {defaultDepositAmount.toLocaleString()}</span>
                      {depositOption?.holder ? <span className="text-slate-400 font-normal"> · Held by {depositOption.holder}</span> : ""}
                    </p>
                    {depositOption?.selectedPeriodLabel && (
                      <p className="text-[11px] text-slate-500">
                        {periods.length > 1
                          ? `Billed once against the first period (${depositOption.selectedPeriodLabel}).`
                          : `Will be billed in ${depositOption.selectedPeriodLabel}.`}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400">Non-taxable · uses existing deposit accounting rules.</p>
                  </div>
                  {depositOption?.enabled ? (
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer whitespace-nowrap shrink-0">
                      <input
                        type="checkbox"
                        checked={includeDeposit}
                        onChange={(e) => setIncludeDeposit(e.target.checked)}
                        disabled={isCreating}
                        className="h-3.5 w-3.5"
                      />
                      Include deposit
                    </label>
                  ) : null}
                </div>

                {!depositOption?.enabled && (
                  <p className="text-[11px] text-amber-700 border-l-4 border-amber-400 pl-2">
                    {depositOption?.reason || "Deposit billing is not available for this tenant right now."}
                  </p>
                )}

                {depositOption?.enabled && includeDeposit && (
                  <div className="pt-1 border-t border-slate-200/60 space-y-1">
                    <label className={labelCls}>Amount to bill</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={depositAmountInput}
                      onChange={(e) => setDepositAmountInput(e.target.value)}
                      disabled={isCreating}
                      placeholder="Enter deposit amount"
                      className={inputCls}
                    />
                    <p className="text-[10px] text-slate-400">Default, 50%, 200%, or any custom amount.</p>
                    {depositAmount <= 0 && (
                      <p className="text-[10px] text-red-600 font-bold">Amount must be greater than zero.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            onClick={onCancel}
            disabled={isCreating}
            className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isCreating || (includeDeposit && depositAmount <= 0)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FaCheck size={11} />
            {isCreating ? "Creating…" : "Confirm"}
          </button>
        </div>

      </div>
    </div>
  );
};

export default InvoiceCreationModal;
