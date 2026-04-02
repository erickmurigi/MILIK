import React, { useState } from "react";
import { FaTimes, FaCheckCircle } from "react-icons/fa";

const ApproveStatementModal = ({
  isOpen,
  statement,
  onClose,
  onApprove,
  loading = false,
}) => {
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

  const formatCurrency = (value) => {
    if (!value) return "KES 0.00";
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
    }).format(value);
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
          <h2 className="text-xl font-bold text-gray-900">Approve Statement</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaTimes className="text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Warning */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ Important:</strong> Once approved, this statement becomes immutable.
              Any corrections will require creating a new revision.
            </p>
          </div>

          {/* Statement Summary */}
          <div
            className="bg-gray-50 rounded-lg p-4 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={() => setShowDetails(!showDetails)}
          >
            <div className="flex justify-between items-center">
              <div>
                <p className="font-semibold text-gray-900">{statement.statementNumber}</p>
                <p className="text-sm text-gray-600">
                  {formatDate(statement.periodStart)} - {formatDate(statement.periodEnd)}
                </p>
              </div>
              <span className={`text-xl ${showDetails ? "rotate-180" : ""} transition-transform`}>
                ›
              </span>
            </div>

            {showDetails && (
              <div className="mt-4 space-y-2 border-t border-gray-200 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Opening Balance:</span>
                  <span className="font-mono font-semibold">{formatCurrency(statement.openingBalance)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Period Net:</span>
                  <span className="font-mono font-semibold">{formatCurrency(statement.periodNet)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
                  <span className="text-gray-900 font-semibold">Closing Balance:</span>
                  <span className="font-mono font-semibold text-lg">{formatCurrency(statement.closingBalance)}</span>
                </div>
                <div className="flex justify-between text-sm pt-2">
                  <span className="text-gray-600">Line Items:</span>
                  <span className="font-semibold">{statement.lineCount || 0}</span>
                </div>
              </div>
            )}
          </div>

          {/* Approval Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Approval Notes (Optional)
            </label>
            <textarea
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
              rows="4"
              placeholder="Add any notes about your approval decision, concerns, or recommendations..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              These notes will be stored with the statement's audit trail
            </p>
          </div>

          {/* Confirmation Checkbox */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="confirm"
              required
              className="mt-1 rounded border-gray-300"
            />
            <label htmlFor="confirm" className="text-sm text-gray-700">
              I confirm that I have reviewed this statement and approve it for processing.
              I understand that this action makes the statement immutable.
            </label>
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white bg-green-700 hover:bg-green-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              <FaCheckCircle />
              {loading ? "Approving..." : "Approve Statement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApproveStatementModal;
