import React, { useState } from "react";
import { FaTimes, FaEdit } from "react-icons/fa";

const CreateRevisionModal = ({ isOpen, statement, onClose, onCreateRevision, loading = false }) => {
  const [revisionReason, setRevisionReason] = useState("");
  const [validationError, setValidationError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!revisionReason.trim()) { setValidationError("Revision reason is required"); return; }
    if (revisionReason.trim().length < 10) { setValidationError("Must be at least 10 characters"); return; }
    try {
      await onCreateRevision(statement._id, revisionReason);
      setRevisionReason(""); setValidationError(""); onClose();
    } catch (err) {
      console.error("Error creating revision:", err);
    }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB") : "N/A";

  if (!isOpen || !statement) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-700 bg-[#0B3B2E] px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <FaEdit className="text-amber-400" />
            <h2 className="text-sm font-black uppercase tracking-wide">Create Revision</h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <FaTimes size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Info */}
            <div className="border-l-4 border-blue-400 bg-blue-50 p-3">
              <p className="text-sm text-blue-800">
                Creating a revision marks the original as <strong>"Revised"</strong> and opens a new v{(statement.version || 1) + 1} draft for corrections.
              </p>
            </div>

            {/* Original statement */}
            <div className="bg-slate-50 border border-slate-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Original Statement</p>
              <p className="font-black text-slate-900 text-sm">{statement.statementNumber}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                v{statement.version || 1} · {fmtDate(statement.periodStart)} — {fmtDate(statement.periodEnd)}
              </p>
              <p className="text-xs text-slate-400 mt-1">Status: <strong className="text-slate-700">{statement.status?.toUpperCase()}</strong></p>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">
                Reason for Revision <span className="text-red-500">*</span>
              </label>
              <textarea
                value={revisionReason}
                onChange={(e) => { setRevisionReason(e.target.value); setValidationError(""); }}
                rows={5}
                placeholder={"Describe why this statement needs revision:\n- Corrected rent amount\n- Added missing payment\n- Adjusted opening balance"}
                className={`w-full border px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none ${validationError ? "border-red-500" : "border-slate-300"}`}
              />
              {validationError && <p className="text-red-600 text-xs mt-1">{validationError}</p>}
              <p className="text-xs text-slate-400 mt-1">{revisionReason.length}/500</p>
            </div>

            {/* What happens */}
            <div className="border-l-4 border-amber-400 bg-amber-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1.5">What happens next</p>
              <ul className="text-xs text-amber-800 space-y-0.5">
                <li>✓ Original marked as "Revised"</li>
                <li>✓ New draft v{(statement.version || 1) + 1} created</li>
                <li>✓ Ledger entries regenerated</li>
                <li>✓ Both statements linked in audit trail</li>
              </ul>
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button type="button" onClick={onClose} disabled={loading}
              className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading || !revisionReason.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <FaEdit size={11} /> {loading ? "Creating…" : "Create Revision"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateRevisionModal;
