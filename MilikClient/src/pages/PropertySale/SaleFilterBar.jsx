import React from "react";
import { FaRedoAlt, FaSearch } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";

export const FilterSearch = ({ value, onChange, placeholder, width = 160 }) => (
  <div className="relative shrink-0" style={{ width }}>
    <FaSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="h-7 w-full border border-slate-200 bg-white pl-6 pr-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
    />
  </div>
);

export const FilterDate = ({ value, onChange, title }) => (
  <input
    type="date"
    value={value}
    onChange={onChange}
    title={title}
    className={`h-7 shrink-0 border px-2 text-xs focus:outline-none ${
      value
        ? "border-[#0B3B2E] bg-[#F1F6F3] text-[#0B3B2E]"
        : "border-slate-200 bg-white text-slate-500 focus:border-[#0B3B2E]"
    }`}
  />
);

export const FilterDateRange = ({ from, to, onFromChange, onToChange }) => (
  <div className="flex shrink-0 items-center gap-1">
    <FilterDate value={from} onChange={onFromChange} title="From date" />
    <span className="text-[10px] font-semibold text-slate-400">—</span>
    <FilterDate value={to} onChange={onToChange} title="To date" />
  </div>
);

/**
 * SaleFilterBar — single toolbar row
 *
 * Props:
 *   leading   — ReactNode rendered before the filter controls (stats strip, record count, etc.)
 *   children  — filter controls (FilterSearch, AppSelects, FilterDateRange, …)
 *   onReset   — shows Reset button when provided
 *   activeCount — highlights Reset when > 0
 *   trailing  — ReactNode rendered after Reset (Refresh, Print, etc.)
 */
const SaleFilterBar = ({ leading, children, onReset, activeCount = 0, trailing }) => (
  <div
    className="flex shrink-0 items-center gap-2 overflow-x-auto border border-slate-200 bg-white px-3 py-1.5"
    style={{ borderLeft: "3px solid #0B3B2E" }}
  >
    {/* Stats / leading content */}
    {leading && (
      <>
        {leading}
        {children && <span className="shrink-0 select-none text-slate-200">·</span>}
      </>
    )}

    {/* Filter controls */}
    {children}

    {/* Reset */}
    {onReset && (
      <button
        type="button"
        onClick={onReset}
        className={`ml-auto shrink-0 inline-flex h-7 items-center gap-1 border px-2.5 text-xs font-bold transition-colors ${
          activeCount > 0
            ? "border-[#0B3B2E] bg-[#0B3B2E] text-white hover:bg-[#07271e]"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
        }`}
      >
        <FaRedoAlt size={8} />
        Reset
        {activeCount > 0 && (
          <span className="flex h-4 min-w-[14px] items-center justify-center rounded-full bg-white/25 px-1 text-[9px] font-black">
            {activeCount}
          </span>
        )}
      </button>
    )}

    {/* Trailing actions (Refresh, Print, etc.) */}
    {trailing && <div className={`${onReset ? "" : "ml-auto"} flex shrink-0 items-center gap-1.5`}>{trailing}</div>}
  </div>
);

export default SaleFilterBar;
