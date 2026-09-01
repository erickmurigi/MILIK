import React, { useEffect, useState } from "react";
import { FaMoneyBillWave } from "react-icons/fa";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../common/Modal";
import FormField from "../common/FormField";

const isNegativeProcessedStatement = (s) =>
  Boolean(s?.isNegativeStatement) || Number(s?.amountPayableByLandlordToManager || 0) > 0;

const PayLandlordModal = ({ statement, onClose, onSubmit, cashbookOptions = [] }) => {
  const { landlord: termLandlord, property: termProperty } = useTerms("landlord", "property");
  const payableAmount = isNegativeProcessedStatement(statement)
    ? 0
    : statement?.balanceDue ?? statement?.netAmountDue ?? statement?.amountPayableToLandlord ?? 0;

  const [formData, setFormData] = useState({
    paymentDate: new Date().toISOString().split("T")[0],
    amount: payableAmount,
    paymentMethod: "Bank Transfer",
    referenceNumber: "",
    cashbook: cashbookOptions[0]?.name || "",
    notes: "",
  });

  useEffect(() => {
    setFormData((p) => ({ ...p, cashbook: p.cashbook || cashbookOptions[0]?.name || "" }));
  }, [cashbookOptions]);

  const set = (k, v) => setFormData((p) => ({ ...p, [k]: v }));
  const fmt = (v) => v ? new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(v) : "KES 0.00";
  const inputCls = "w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E]";

  return (
    <Modal
      title={`Pay ${termLandlord}`}
      icon={<FaMoneyBillWave className="text-emerald-400" />}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
            Cancel
          </button>
          <button type="submit" form="pay-landlord-form" disabled={isNegativeProcessedStatement(statement)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <FaMoneyBillWave size={11} /> Pay {termLandlord}
          </button>
        </>
      }
    >
      <form id="pay-landlord-form" onSubmit={(e) => { e.preventDefault(); if (!isNegativeProcessedStatement(statement)) onSubmit(formData); }} className="space-y-4">
        {/* Statement summary */}
        <div className="bg-slate-50 border border-slate-200 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Statement Summary</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              [termLandlord, statement?.landlord?.landlordName || "N/A"],
              [termProperty, statement?.property?.propertyName || "N/A"],
              ["Statement #", statement?.statementNumber || "N/A"],
              ["Amount Payable", fmt(payableAmount)],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className={`font-bold ${label === "Amount Payable" ? "text-emerald-700 text-base" : "text-slate-800"}`}>{val}</p>
              </div>
            ))}
          </div>
        </div>

        {isNegativeProcessedStatement(statement) && (
          <div className="border-l-4 border-red-400 bg-red-50 p-3">
            <p className="text-sm text-red-800">
              <strong>Payment blocked:</strong> This statement shows the {termLandlord.toLowerCase()} owes the manager. Use "Record Recovery" instead.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Payment Date" required>
            <input type="date" value={formData.paymentDate} required
              onChange={(e) => set("paymentDate", e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Amount (KES)" required>
            <input type="number" value={formData.amount} required min="0" step="0.01"
              onChange={(e) => set("amount", e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Payment Method" required>
            <select value={formData.paymentMethod} required onChange={(e) => set("paymentMethod", e.target.value)} className={inputCls}>
              <option>Bank Transfer</option>
              <option>Check</option>
              <option>Cash</option>
              <option value="Mobile Money">Mobile Money (M-Pesa)</option>
              <option>Other</option>
            </select>
          </FormField>
          <FormField label="Reference Number">
            <input type="text" value={formData.referenceNumber}
              placeholder="Transaction / cheque / transfer ref"
              onChange={(e) => set("referenceNumber", e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Cashbook" required className="sm:col-span-2">
            <select value={formData.cashbook} required onChange={(e) => set("cashbook", e.target.value)} className={inputCls}>
              {cashbookOptions.length === 0
                ? <option value="">No cashbook accounts found</option>
                : cashbookOptions.map((a) => (
                    <option key={a._id || a.code || a.name} value={a.name}>
                      {a.code ? `${a.code} - ${a.name}` : a.name}
                    </option>
                  ))}
            </select>
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea value={formData.notes} rows={3}
            placeholder="Payment details or notes…"
            onChange={(e) => set("notes", e.target.value)}
            className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none" />
        </FormField>
      </form>
    </Modal>
  );
};

export default PayLandlordModal;
