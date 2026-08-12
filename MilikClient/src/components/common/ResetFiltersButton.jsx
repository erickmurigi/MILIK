import React from 'react';
import { FaRedoAlt } from 'react-icons/fa';

/**
 * Reusable reset-filters button.
 * - size="md"  → matches the h-7 report toolbar style
 * - size="sm"  → matches the h-[20px] compact toolbar style (Vacants, etc.)
 * Pass className to fully override styling.
 */
const ResetFiltersButton = ({ onReset, disabled = false, label = 'Reset', className, size = 'md' }) => {
  const defaultCls = size === 'sm'
    ? 'inline-flex h-[20px] items-center gap-0.5 rounded px-1.5 text-[9px] font-bold uppercase tracking-[0.08em] border border-slate-200 bg-white text-slate-600 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
    : 'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] border border-slate-200 bg-white text-slate-600 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled}
      className={className ?? defaultCls}
      title="Reset all filters to defaults"
    >
      <FaRedoAlt size={size === 'sm' ? 7 : 9} />
      {label}
    </button>
  );
};

export default ResetFiltersButton;
