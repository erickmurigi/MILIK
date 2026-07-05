import React, { useEffect, useRef } from 'react';
import { FaExclamationTriangle, FaCheck, FaTimes } from 'react-icons/fa';

const MilikConfirmDialog = ({
  isOpen,
  title = "Confirm Action",
  message = "Are you sure?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isDangerous = false,
  icon = <FaExclamationTriangle />,
}) => {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      panelRef.current?.querySelector('[data-role="cancel"]')?.focus();
    }, 100);
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel?.();
      else if (e.key === 'Enter') e.preventDefault();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); clearTimeout(timer); };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]" onClick={onCancel} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-6 sm:items-center">
        <div
          ref={panelRef}
          className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
        >
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-700 bg-[#0B3B2E] px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className={isDangerous ? "text-red-400" : "text-amber-400"}>{icon}</span>
              <h2 id="dialog-title" className="text-sm font-black uppercase tracking-wide">{title}</h2>
            </div>
            <button onClick={onCancel} className="text-white/60 hover:text-white transition-colors">
              <FaTimes size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 px-5 py-5">
            <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
          </div>

          {/* Actions */}
          <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button
              data-role="cancel"
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors focus:outline-none"
            >
              <FaTimes size={10} /> {cancelText}
            </button>
            <button
              data-role="confirm"
              type="button"
              onClick={onConfirm}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white transition-colors focus:outline-none ${
                isDangerous ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0B3B2E] hover:bg-[#0A3127]'
              }`}
            >
              <FaCheck size={10} /> {confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default MilikConfirmDialog;
