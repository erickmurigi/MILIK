import React, { useState } from "react";
import { FaTimes, FaCheckCircle } from "react-icons/fa";

const ApproveStatementModal = ({ isOpen, statement, onClose, onApprove, loading = false }) => {
  const [approvalNotes, setApprovalNotes] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await onApprove(statement._id, approvalNotes);
      setApprovalNotes("");
      onClose();
    } catch (err) {
      console.error("Error approving statement:", err);
    }
  };

  const fmt = (v) => v ? new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(v) : "KES 0.00";
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB") : "N/A";

  if (!isOpen || !statement) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="flex w-full flex-col bg-white shadow-2xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] sm:max-w-md rounded-t-2xl sm:rounded-none overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-700 bg-[#0B3B2E] px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <FaCheckCircle className="text-emerald-400" />
            <h2 className="text-sm font-black uppercase tracking-wide">Approve Statement</h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <FaTimes size={14} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Warning */}
            <div className="border-l-4 border-amber-400 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                <strong>Important:</strong> Once approved, this statement becomes immutable. Corrections require a new revision.
              </p>
            </div>

            {/* Statement Summary */}
            <div
              className="bg-slate-50 border border-slate-200 p-4 cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => setShowDetails(!showDetails)}
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-black text-slate-900 text-sm">{statement.statementNumber}</p>
                  <p className="text-xs text-slate-500">{fmtDate(statement.periodStart)} — {fmtDate(statement.periodEnd)}</p>
                </div>
                <span className={`text-lg text-slate-400 transition-transform ${showDetails ? "rotate-90" : ""}`}>›</span>
              </div>
              {showDetails && (
                <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3">
                  {[
                    ["Opening Balance", fmt(statement.openingBalance)],
                    ["Period Net", fmt(statement.periodNet)],
                    ["Closing Balance", fmt(statement.closingBalance)],
                    ["Line Items", statement.lineCount || 0],
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-bold text-slate-800">{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">Approval Notes (Optional)</label>
              <textarea
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                rows={4}
                placeholder="Add any notes about your approval decision..."
                className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none"
              />
              <p className="text-xs text-slate-400 mt-1">Stored in the statement's audit trail</p>
            </div>

            {/* Confirm checkbox */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" required className="mt-0.5 border-slate-300" />
              <span className="text-sm text-slate-700">I have reviewed this statement and approve it for processing. I understand this action is irreversible.</span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button type="button" onClick={onClose} disabled={loading}
              className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors disabled:opacity-50">
              <FaCheckCircle size={11} /> {loading ? "Approving…" : "Approve Statement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApproveStatementModal;
