import React, { useState } from "react";
import { FaTimes, FaEdit } from "react-icons/fa";

const CreateRevisionModal = ({
  isOpen,
  statement,
  onClose,
  onCreateRevision,
  loading = false,
}) => {
  const [revisionReason, setRevisionReason] = useState("");
  const [validationError, setValidationError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!revisionReason.trim()) {
      setValidationError("Revision reason is required");
      return;
    }

    if (revisionReason.trim().length < 10) {
      setValidationError("Revision reason must be at least 10 characters");
      return;
    }

    try {
      await onCreateRevision(statement._id, revisionReason);
      setRevisionReason("");
      setValidationError("");
      onClose();
    } catch (err) {
      console.error("Error creating revision:", err);
    }
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-GB");
  };

  if (!isOpen || !statement) return null;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-5 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Create Revision</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaTimes className="text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>ℹ️ Note:</strong> Creating a revision will mark the original
              statement as "Revised" and generate a new v{(statement.version || 1) + 1}
              draft statement for corrections.
            </p>
          </div>

          {/* Original Statement Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Original Statement</p>
            <p className="font-semibold text-gray-900">{statement.statementNumber}</p>
            <p className="text-sm text-gray-600">
              v{statement.version || 1} • {formatDate(statement.periodStart)} -
              {formatDate(statement.periodEnd)}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Status: <span className="font-semibold text-gray-700">{statement.status?.toUpperCase()}</span>
            </p>
          </div>

          {/* Revision Reason */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Reason for Revision *
            </label>
            <textarea
              value={revisionReason}
              onChange={(e) => {
                setRevisionReason(e.target.value);
                setValidationError("");
              }}
              rows="5"
              placeholder="Describe why this statement needs to be revised. Examples:
- Corrected rent amount calculation
- Added missing rent payment
- Updated expense deductions
- Adjusted opening balance based on ledger review"
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent outline-none resize-none ${
                validationError ? "border-red-500" : "border-gray-300"
              }`}
            />
            {validationError && (
              <p className="text-red-600 text-sm mt-1">{validationError}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {revisionReason.length}/500 characters
            </p>
          </div>

          {/* What Happens */}
          <div className="bg-amber-50 rounded-lg p-4">
            <p className="text-xs font-semibold text-amber-800 mb-2">WHAT HAPPENS NEXT:</p>
            <ul className="text-xs text-amber-800 space-y-1">
              <li>✓ Original statement marked as "Revised"</li>
              <li>✓ New draft v{(statement.version || 1) + 1} created</li>
              <li>✓ Ledger entries regenerated in new draft</li>
              <li>✓ Both statements linked in audit trail</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white bg-yellow-600 hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !revisionReason.trim()}
            >
              <FaEdit />
              {loading ? "Creating..." : "Create Revision"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateRevisionModal;
