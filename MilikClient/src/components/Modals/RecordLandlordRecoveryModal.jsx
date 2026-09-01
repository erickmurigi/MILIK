import React, { useEffect, useState } from "react";
import { FaMoneyBillWave } from "react-icons/fa";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../common/Modal";
import FormField from "../common/FormField";

const getOutstandingRecoveryBalance = (statement) =>
  Math.max(Number(statement?.amountPayableByLandlordToManager || 0) - Number(statement?.amountRecovered || 0), 0);

const RecordLandlordRecoveryModal = ({ statement, onClose, onSubmit, cashbookOptions = [] }) => {
  const { landlord: termLandlord, property: termProperty } = useTerms("landlord", "property");
  const outstandingRecovery = getOutstandingRecoveryBalance(statement);

  const [formData, setFormData] = useState({
    recoveryDate: new Date().toISOString().split("T")[0],
    amount: outstandingRecovery,
    paymentMethod: "Bank Transfer",
    referenceNumber: "",
    cashbook: cashbookOptions[0]?.name || "",
    notes: "",
  });

  useEffect(() => {
    setFormData((p) => ({ ...p, amount: outstandingRecovery, cashbook: p.cashbook || cashbookOptions[0]?.name || "" }));
  }, [outstandingRecovery, cashbookOptions]);

  const set = (k, v) => setFormData((p) => ({ ...p, [k]: v }));
  const fmt = (v) => v ? new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(v) : "KES 0.00";
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB") : "N/A";
  const inputCls = "w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E]";

  return (
    <Modal
      title={`Record Recovery From ${termLandlord}`}
      icon={<FaMoneyBillWave className="text-red-400" />}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
            Cancel
          </button>
          <button type="submit" form="record-recovery-form"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors">
            <FaMoneyBillWave size={11} /> Record Recovery
          </button>
        </>
      }
    >
      <form id="record-recovery-form" onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-4">
        {/* Statement details */}
        <div className="bg-slate-50 border border-slate-200 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Processed Statement Details</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              [termLandlord, statement?.landlord?.landlordName || "N/A"],
              [termProperty, statement?.property?.propertyName || "N/A"],
              ["Period", `${fmtDate(statement?.periodStart)} – ${fmtDate(statement?.periodEnd)}`],
              ["Outstanding Recovery", fmt(outstandingRecovery)],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className={`font-bold ${label === "Outstanding Recovery" ? "text-red-700 text-base" : "text-slate-800"}`}>{val}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Recovery Date" required>
            <input type="date" name="recoveryDate" value={formData.recoveryDate} required
              onChange={(e) => set("recoveryDate", e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Amount (KES)" required>
            <input type="number" name="amount" value={formData.amount} required min="0" step="0.01"
              onChange={(e) => set("amount", e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Payment Method" required>
            <select name="paymentMethod" value={formData.paymentMethod} required
              onChange={(e) => set("paymentMethod", e.target.value)} className={inputCls}>
              <option>Bank Transfer</option>
              <option>Check</option>
              <option>Cash</option>
              <option value="Mobile Money">Mobile Money (M-Pesa)</option>
              <option>Other</option>
            </select>
          </FormField>
          <FormField label="Reference Number">
            <input type="text" name="referenceNumber" value={formData.referenceNumber}
              placeholder="Transaction / cheque / transfer ref"
              onChange={(e) => set("referenceNumber", e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Cashbook" required className="sm:col-span-2">
            <select name="cashbook" value={formData.cashbook} required
              onChange={(e) => set("cashbook", e.target.value)} className={inputCls}>
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
          <textarea name="notes" value={formData.notes} rows={3}
            placeholder="Recovery details or notes…"
            onChange={(e) => set("notes", e.target.value)}
            className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none" />
        </FormField>
      </form>
    </Modal>
  );
};

export default RecordLandlordRecoveryModal;
