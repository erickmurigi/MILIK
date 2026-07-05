import React, { useState } from "react";
import { FaTimes, FaReceipt } from "react-icons/fa";

const PostCommissionModal = ({ statement, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    postingDate: new Date().toISOString().split("T")[0],
    amount: statement?.commissionAmount || 0,
    notes: "",
  });

  const fmt = (v) => v ? new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(v) : "KES 0.00";
  const basisLabel = (b) => ({ received: "Cash (Received)", invoiced: "Accrual (Invoiced)", received_manager_only: "Manager Receipts Only" }[b] || b || "N/A");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-700 bg-[#0B3B2E] px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <FaReceipt className="text-emerald-400" />
            <h2 className="text-sm font-black uppercase tracking-wide">Post Commission</h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <FaTimes size={14} />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Commission details */}
            <div className="bg-slate-50 border border-slate-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Commission Details</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ["Landlord", statement?.landlord?.landlordName || "N/A"],
                  ["Property", statement?.property?.propertyName || "N/A"],
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
              <div>
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">Posting Date <span className="text-red-500">*</span></label>
                <input type="date" name="postingDate" value={formData.postingDate} required
                  onChange={(e) => setFormData((p) => ({ ...p, postingDate: e.target.value }))}
                  className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E]" />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">Amount (KES) <span className="text-red-500">*</span></label>
                <input type="number" name="amount" value={formData.amount} required min="0" step="0.01"
                  onChange={(e) => setFormData((p) => ({ ...p, amount: e.target.value }))}
                  className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E]" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">Notes</label>
              <textarea name="notes" value={formData.notes} rows={3}
                placeholder="Additional notes about this commission posting…"
                onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none" />
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors">
              <FaReceipt size={11} /> Post Commission
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PostCommissionModal;
