import React, { useEffect, useRef } from 'react';
import { FaExclamationTriangle, FaCheck, FaTimes } from 'react-icons/fa';

/**
 * Milik-styled Confirmation Dialog
 * Replaces browser's window.confirm() with a branded, beautiful confirmation modal
 */
const MilikConfirmDialog = ({
  isOpen,
  title = "Confirm Action",
  message = "Are you sure?",
  confirmText = "Delete",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isDangerous = false, // true for delete operations (red button)
  icon = <FaExclamationTriangle className="w-6 h-6" />,
}) => {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    
    // Auto-focus cancel button
    const focusElement = () => {
      const cancelButton = panelRef.current?.querySelector('[data-role="cancel"]');
      if (cancelButton) cancelButton.focus();
    };
    
    // Focus after render
    const timer = setTimeout(focusElement, 100);
    
    // Handle Escape key
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel?.();
      } else if (e.key === 'Enter') {
        // Don't auto-confirm on enter to prevent accidents
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 transition-opacity"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in-50 duration-200"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          aria-describedby="dialog-message"
        >
          {/* Header with Icon */}
          <div className="px-6 py-6 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-gray-200 flex items-start gap-4">
            <div className={`flex-shrink-0 p-3 rounded-lg ${
              isDangerous ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
            }`}>
              {icon}
            </div>
            <div className="flex-1">
              <h2 
                id="dialog-title"
                className="text-lg font-bold text-gray-900"
              >
                {title}
              </h2>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4">
            <p 
              id="dialog-message"
              className="text-sm text-gray-700 leading-relaxed"
            >
              {message}
            </p>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-3">
            <button
              data-role="cancel"
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
            >
              <FaTimes className="inline-block mr-2 -mt-0.5" />
              {cancelText}
            </button>
            <button
              data-role="confirm"
              type="button"
              onClick={onConfirm}
              className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${ 
                isDangerous
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  : 'bg-teal-600 hover:bg-teal-700 focus:ring-teal-500'
              }`}
            >
              <FaCheck className="inline-block mr-2 -mt-0.5" />
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default MilikConfirmDialog;
