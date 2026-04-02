import React, { useEffect, useMemo, useState } from "react";
import { FaX, FaFileInvoice, FaCheck } from "react-icons/fa6";
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
  const [billingMode, setBillingMode] = useState("combined");
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
      setBillingMode("combined");
      setIncludeDeposit(Boolean(depositOption?.recommended && depositOption?.enabled));
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
    depositOption?.recommended,
    normalizedTaxConfig?.taxSettings?.defaultTaxCodeKey,
  ]);

  const tenantName = periods.length > 0 ? periods[0].tenantName : "N/A";
  const propertyName = periods.length > 0 ? periods[0].propertyName : "N/A";
  const totalAmount = periods.reduce((sum, period) => sum + (period.rent + (period.utility || 0)), 0);
  const totalRentAmount = periods.reduce((sum, period) => sum + Number(period.rent || 0), 0);
  const totalUtilityAmount = periods.reduce((sum, period) => sum + Number(period.utility || 0), 0);
  const defaultDepositAmount = Number(depositOption?.amount || 0);
  const enteredDepositAmount = Number(depositAmountInput || 0);
  const depositAmount = enteredDepositAmount > 0 ? enteredDepositAmount : 0;

  const taxComponents = useMemo(() => {
    if (billingMode === "combined") {
      return totalAmount > 0 ? [{ category: "RENT_CHARGE", amount: totalAmount }] : [];
    }

    return [
      totalRentAmount > 0 ? { category: "RENT_CHARGE", amount: totalRentAmount } : null,
      totalUtilityAmount > 0 ? { category: "UTILITY_CHARGE", amount: totalUtilityAmount } : null,
    ].filter(Boolean);
  }, [billingMode, totalAmount, totalRentAmount, totalUtilityAmount]);

  const taxPreview = useMemo(
    () => buildTaxPreviewForComponents({ components: taxComponents, companyTaxConfig: normalizedTaxConfig, selection: taxSelection }),
    [taxComponents, normalizedTaxConfig, taxSelection]
  );

  const totalWithDeposit = Number(taxPreview.grossAmount || 0) + (includeDeposit ? depositAmount : 0);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (includeDeposit && depositAmount <= 0) {
      return;
    }

    setIsCreating(true);
    try {
      await onConfirm({ billingMode, includeDeposit, depositAmount, taxSelection });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-black/10 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <FaFileInvoice className="text-blue-600" size={20} />
            <h2 className="text-lg font-bold text-gray-900">Create Invoices</h2>
          </div>
          <button
            onClick={onCancel}
            disabled={isCreating}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            <FaX size={16} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="bg-gray-50 p-3 rounded-lg text-sm">
            <p className="text-gray-600">
              <span className="font-semibold">Tenant:</span> {tenantName}
            </p>
            <p className="text-gray-600">
              <span className="font-semibold">Property:</span> {propertyName}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">Selected Periods ({periods.length})</p>
            <div className="space-y-2">
              {periods.map((period, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center text-xs p-2 bg-gray-50 rounded border border-gray-200"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{period.description}</p>
                    <p className="text-gray-600">{period.from} to {period.to}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      KES {(period.rent + (period.utility || 0)).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold text-blue-900">Subtotal before tax:</span>
              <span className="font-semibold text-blue-900">KES {Number(taxPreview.netAmount || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold text-blue-900">Estimated tax:</span>
              <span className="font-semibold text-blue-900">KES {Number(taxPreview.taxAmount || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold text-blue-900">Gross invoice total:</span>
              <span className="font-semibold text-blue-900">KES {Number(taxPreview.grossAmount || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-blue-900">Grand total{includeDeposit ? " including deposit" : ""}:</span>
              <span className="font-bold text-lg text-blue-900">KES {Number(totalWithDeposit || 0).toLocaleString()}</span>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm font-semibold text-amber-900 mb-2">Invoice Billing Mode</p>
            <div className="space-y-2 text-xs">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="billingMode"
                  checked={billingMode === "combined"}
                  onChange={() => setBillingMode("combined")}
                  disabled={isCreating}
                />
                <span>
                  <strong>Combined</strong>: one invoice per period with Rent + Utility together.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="billingMode"
                  checked={billingMode === "separate"}
                  onChange={() => setBillingMode("separate")}
                  disabled={isCreating}
                />
                <span>
                  <strong>Separate</strong>: one Rent invoice and one Utility invoice (if utility exists).
                </span>
              </label>
            </div>
          </div>

          <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-3">
            <div>
              <p className="text-sm font-semibold text-violet-900">Tax / VAT Handling</p>
              <p className="text-[11px] text-violet-700 mt-1">
                The backend remains the source of truth. This preview reflects the active company tax settings and your selected tax handling.
              </p>
              {!taxEnabled && (
                <p className="text-[11px] text-amber-700 mt-2">
                  Tax is currently disabled in Company Setup. Company-default tax will therefore produce no VAT until tax is enabled for this company.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-violet-900 mb-1">Tax handling</label>
                <select
                  value={taxSelection.handling}
                  onChange={(e) => setTaxSelection((prev) => ({ ...prev, handling: e.target.value }))}
                  disabled={isCreating}
                  className="w-full rounded border border-violet-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="company_default">Use company default</option>
                  <option value="taxable" disabled={!taxEnabled}>Force taxable</option>
                  <option value="non_taxable">Force non-taxable</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-violet-900 mb-1">Tax code</label>
                <select
                  value={taxSelection.taxCodeKey}
                  onChange={(e) => setTaxSelection((prev) => ({ ...prev, taxCodeKey: e.target.value }))}
                  disabled={isCreating || taxSelection.handling === "non_taxable"}
                  className="w-full rounded border border-violet-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-slate-100"
                >
                  {activeTaxCodes.map((code) => (
                    <option key={code.key} value={code.key}>
                      {code.name} ({Number(code.rate || 0)}%)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-violet-900 mb-1">Tax mode</label>
                <select
                  value={taxSelection.taxMode}
                  onChange={(e) => setTaxSelection((prev) => ({ ...prev, taxMode: e.target.value }))}
                  disabled={isCreating || taxSelection.handling === "non_taxable"}
                  className="w-full rounded border border-violet-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-slate-100"
                >
                  <option value="company_default">Use company default</option>
                  <option value="exclusive">Exclusive</option>
                  <option value="inclusive">Inclusive</option>
                </select>
              </div>
            </div>

            <div className="rounded border border-violet-200 bg-white px-3 py-2 text-xs text-violet-900">
              Tax code: <strong>{getTaxCodeLabel(taxSelection.taxCodeKey, normalizedTaxConfig)}</strong>
              {taxSelection.handling === "company_default" ? " • Company rules by category" : null}
              {taxSelection.handling === "non_taxable" ? " • Forced non-taxable" : null}
            </div>
          </div>

          {depositOption && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Security Deposit</p>
                  <p className="text-xs text-emerald-800 mt-1">
                    Default deposit: <strong>KES {defaultDepositAmount.toLocaleString()}</strong>
                    {depositOption?.holder ? ` • Held by ${depositOption.holder}` : ""}
                  </p>
                  {depositOption?.selectedPeriodLabel && (
                    <p className="text-[11px] text-emerald-700 mt-1">
                      {periods.length > 1
                        ? `When enabled, the deposit is billed once against the first selected period (${depositOption.selectedPeriodLabel}).`
                        : `The deposit will be billed in ${depositOption.selectedPeriodLabel}.`}
                    </p>
                  )}
                  <p className="text-[11px] text-emerald-700 mt-1">
                    Deposit invoices remain non-taxable and use the existing deposit accounting rules.
                  </p>
                </div>
                {depositOption?.enabled ? (
                  <label className="flex items-center gap-2 text-xs font-semibold text-emerald-900 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={includeDeposit}
                      onChange={(e) => setIncludeDeposit(e.target.checked)}
                      disabled={isCreating}
                    />
                    Include deposit
                  </label>
                ) : null}
              </div>

              {depositOption?.enabled && includeDeposit ? (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-emerald-900 mb-1">
                    Deposit amount to bill
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositAmountInput}
                    onChange={(e) => setDepositAmountInput(e.target.value)}
                    disabled={isCreating}
                    placeholder="Enter deposit amount"
                    className="w-full rounded border border-emerald-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-emerald-700 mt-1">
                    You can keep the default deposit, bill 50%, 200%, or any custom amount.
                  </p>
                  {depositAmount <= 0 && (
                    <p className="text-[11px] text-red-600 mt-1">
                      Enter a valid deposit amount greater than zero.
                    </p>
                  )}
                </div>
              ) : null}

              {!depositOption?.enabled && (
                <p className="text-xs text-amber-700 mt-2">
                  {depositOption?.reason || "Deposit billing is not available for this tenant right now."}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onCancel}
            disabled={isCreating}
            className="flex-1 px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isCreating}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FaCheck size={14} />
            {isCreating ? "Creating..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceCreationModal;
