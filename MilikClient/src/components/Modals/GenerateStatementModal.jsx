import React, { useState, useEffect } from "react";
import { FaTimes, FaCalendarAlt } from "react-icons/fa";

const GenerateStatementModal = ({
  isOpen,
  properties = [],
  landlords = [],
  onClose,
  onGenerateDraft,
  loading = false,
}) => {
  const [formData, setFormData] = useState({
    propertyId: "",
    landlordId: "",
    periodStart: "",
    periodEnd: "",
    notes: "",
  });

  const [validationErrors, setValidationErrors] = useState({});

  const validateForm = () => {
    const errors = {};
    if (!formData.propertyId) errors.propertyId = "Property is required";
    if (!formData.landlordId) errors.landlordId = "Landlord is required";
    if (!formData.periodStart) errors.periodStart = "Start date is required";
    if (!formData.periodEnd) errors.periodEnd = "End date is required";
    if (formData.periodStart && formData.periodEnd) {
      if (new Date(formData.periodStart) >= new Date(formData.periodEnd)) {
        errors.periodEnd = "End date must be after start date";
      }
    }
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    try {
      await onGenerateDraft(formData);
      setFormData({
        propertyId: "",
        landlordId: "",
        periodStart: "",
        periodEnd: "",
        notes: "",
      });
      setValidationErrors({});
      onClose();
    } catch (err) {
      console.error("Error generating statement:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-5 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Generate Draft Statement</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaTimes className="text-gray-600" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Property Select */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Property *
            </label>
            <select
              value={formData.propertyId}
              onChange={(e) =>
                setFormData({ ...formData, propertyId: e.target.value })
              }
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none ${
                validationErrors.propertyId ? "border-red-500" : "border-gray-300"
              }`}
            >
              <option value="">Select a property...</option>
              {properties.map((prop) => (
                <option key={prop._id} value={prop._id}>
                  {prop.propertyName || prop.name || 'Unnamed Property'}
                </option>
              ))}
            </select>
            {validationErrors.propertyId && (
              <p className="text-red-600 text-sm mt-1">{validationErrors.propertyId}</p>
            )}
          </div>

          {/* Landlord Select */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Landlord *
            </label>
            <select
              value={formData.landlordId}
              onChange={(e) =>
                setFormData({ ...formData, landlordId: e.target.value })
              }
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none ${
                validationErrors.landlordId ? "border-red-500" : "border-gray-300"
              }`}
            >
              <option value="">Select a landlord...</option>
              {landlords.map((landlord) => (
                <option key={landlord._id} value={landlord._id}>
                  {landlord.firstName} {landlord.lastName}
                </option>
              ))}
            </select>
            {validationErrors.landlordId && (
              <p className="text-red-600 text-sm mt-1">{validationErrors.landlordId}</p>
            )}
          </div>

          {/* Period Start */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Start Date *
            </label>
            <input
              type="date"
              value={formData.periodStart}
              onChange={(e) =>
                setFormData({ ...formData, periodStart: e.target.value })
              }
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none ${
                validationErrors.periodStart ? "border-red-500" : "border-gray-300"
              }`}
            />
            {validationErrors.periodStart && (
              <p className="text-red-600 text-sm mt-1">{validationErrors.periodStart}</p>
            )}
          </div>

          {/* Period End */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              End Date *
            </label>
            <input
              type="date"
              value={formData.periodEnd}
              onChange={(e) =>
                setFormData({ ...formData, periodEnd: e.target.value })
              }
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none ${
                validationErrors.periodEnd ? "border-red-500" : "border-gray-300"
              }`}
            />
            {validationErrors.periodEnd && (
              <p className="text-red-600 text-sm mt-1">{validationErrors.periodEnd}</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows="3"
              placeholder="Add any notes..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none resize-none"
            />
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
              className="px-4 py-2 rounded-lg font-semibold text-white bg-green-700 hover:bg-green-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate Statement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GenerateStatementModal;
