import React, { useEffect, useState } from "react";
import { FaTimes, FaMoneyBillWave } from "react-icons/fa";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3327]";

const getOutstandingRecoveryBalance = (statement) => {
  const totalRecovery = Number(statement?.amountPayableByLandlordToManager || 0);
  const recovered = Number(statement?.amountRecovered || 0);
  return Math.max(totalRecovery - recovered, 0);
};

const RecordLandlordRecoveryModal = ({ statement, onClose, onSubmit, cashbookOptions = [] }) => {
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
    setFormData((prev) => ({
      ...prev,
      amount: outstandingRecovery,
      cashbook: prev.cashbook || cashbookOptions[0]?.name || "",
    }));
  }, [outstandingRecovery, cashbookOptions]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const formatCurrency = (value) => {
    if (!value) return "KES 0.00";
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
    }).format(value);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/5 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between rounded-t-2xl border-b border-gray-200 bg-red-50 px-6 py-4">
          <div className="flex items-center gap-2">
            <FaMoneyBillWave className="text-xl text-red-600" />
            <h2 className="text-xl font-bold text-gray-900">Record Recovery From Landlord</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 transition hover:text-gray-700">
            <FaTimes className="text-xl" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6 rounded-lg bg-gray-50 p-4">
            <h3 className="mb-3 font-semibold text-gray-800">Processed Statement Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-600">Landlord</p>
                <p className="font-semibold">{statement?.landlord?.landlordName || "N/A"}</p>
              </div>
              <div>
                <p className="text-gray-600">Property</p>
                <p className="font-semibold">{statement?.property?.propertyName || "N/A"}</p>
              </div>
              <div>
                <p className="text-gray-600">Period</p>
                <p className="font-semibold">
                  {`${new Date(statement?.periodStart).toLocaleDateString("en-GB")} - ${new Date(
                    statement?.periodEnd
                  ).toLocaleDateString("en-GB")}`}
                </p>
              </div>
              <div>
                <p className="text-gray-600">Outstanding Recovery</p>
                <p className="text-lg font-semibold text-red-700">{formatCurrency(outstandingRecovery)}</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Recovery Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="recoveryDate"
                  value={formData.recoveryDate}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Amount (KES) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="amount"
                  value={formData.amount}
                  onChange={handleChange}
                  required
                  min="0"
                  step="0.01"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Payment Method <span className="text-red-500">*</span>
                </label>
                <select
                  name="paymentMethod"
                  value={formData.paymentMethod}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Mobile Money">Mobile Money (M-Pesa)</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">Reference Number</label>
                <input
                  type="text"
                  name="referenceNumber"
                  value={formData.referenceNumber}
                  onChange={handleChange}
                  placeholder="Transaction / cheque / transfer reference"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Cashbook <span className="text-red-500">*</span>
                </label>
                <select
                  name="cashbook"
                  value={formData.cashbook}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                >
                  {cashbookOptions.length === 0 ? (
                    <option value="">No cashbook accounts found</option>
                  ) : (
                    cashbookOptions.map((account) => (
                      <option key={account._id || account.code || account.name} value={account.name}>
                        {account.code ? `${account.code} - ${account.name}` : account.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows="3"
                placeholder="Recovery details or notes..."
                className="w-full resize-none rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-gray-300 px-6 py-2 font-semibold text-gray-700 transition hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`flex items-center gap-2 rounded-lg px-6 py-2 font-semibold text-white transition ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}
              >
                <FaMoneyBillWave /> Record Recovery
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RecordLandlordRecoveryModal;
