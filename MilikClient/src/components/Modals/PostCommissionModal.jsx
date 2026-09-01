import React, { useState } from "react";
import { FaReceipt } from "react-icons/fa";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../common/Modal";
import FormField from "../common/FormField";

const PostCommissionModal = ({ statement, onClose, onSubmit }) => {
  const { landlord: termLandlord, property: termProperty } = useTerms("landlord", "property");
  const [formData, setFormData] = useState({
    postingDate: new Date().toISOString().split("T")[0],
    amount: statement?.commissionAmount || 0,
    notes: "",
  });

  const fmt = (v) => v ? new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(v) : "KES 0.00";
  const basisLabel = (b) => ({ received: "Cash (Received)", invoiced: "Accrual (Invoiced)", received_manager_only: "Manager Receipts Only" }[b] || b || "N/A");

  return (
    <Modal
      title="Post Commission"
      icon={<FaReceipt className="text-emerald-400" />}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
            Cancel
          </button>
          <button type="submit" form="post-commission-form"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors">
            <FaReceipt size={11} /> Post Commission
          </button>
        </>
      }
    >
      <form id="post-commission-form" onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-4">
        {/* Commission details */}
        <div className="bg-slate-50 border border-slate-200 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Commission Details</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              [termLandlord, statement?.landlord?.landlordName || "N/A"],
              [termProperty, statement?.property?.propertyName || "N/A"],
              ["Period", statement?.periodStart ? new Date(statement.periodStart).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "N/A"],
              ["Rate", `${statement?.commissionPercentage || 0}%`],
              ["Basis", basisLabel(statement?.commissionBasis)],
              ["Amount", fmt(statement?.commissionAmount)],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className={`font-bold text-slate-800 ${label === "Amount" ? "text-emerald-700 text-base" : ""}`}>{val}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-l-4 border-amber-400 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> This posts commission income to your books via the Commission Income ledger.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Posting Date" required>
            <input type="date" name="postingDate" value={formData.postingDate} required
              onChange={(e) => setFormData((p) => ({ ...p, postingDate: e.target.value }))}
              className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E]" />
          </FormField>
          <FormField label="Amount (KES)" required>
            <input type="number" name="amount" value={formData.amount} required min="0" step="0.01"
              onChange={(e) => setFormData((p) => ({ ...p, amount: e.target.value }))}
              className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E]" />
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea name="notes" value={formData.notes} rows={3}
            placeholder="Additional notes about this commission posting…"
            onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
            className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none" />
        </FormField>
      </form>
    </Modal>
  );
};

export default PostCommissionModal;
