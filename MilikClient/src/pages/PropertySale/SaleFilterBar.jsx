import React from "react";
import { FaRedoAlt, FaSearch } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";

export const FilterSearch = ({ value, onChange, placeholder, minWidth = "160px" }) => (
  <div className="relative flex-1" style={{ minWidth }}>
    <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="h-8 w-full border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
    />
  </div>
);


export const FilterDate = ({ value, onChange, title }) => (
  <input
    type="date"
    value={value}
    onChange={onChange}
    title={title}
    className={`h-8 border px-2 text-xs focus:outline-none ${
      value
        ? "border-[#0B3B2E] bg-[#F1F6F3] text-[#0B3B2E]"
        : "border-slate-200 bg-white text-slate-500 focus:border-[#0B3B2E]"
    }`}
  />
);

export const FilterDateRange = ({ from, to, onFromChange, onToChange }) => (
  <div className="flex items-center gap-1">
    <FilterDate value={from} onChange={onFromChange} title="From date" />
    <span className="text-[10px] font-semibold text-slate-400">—</span>
    <FilterDate value={to} onChange={onToChange} title="To date" />
  </div>
);

const SaleFilterBar = ({ children, onReset, activeCount = 0, onSubmit, className = "" }) => {
  const Tag = onSubmit ? "form" : "div";
  return (
    <Tag
      {...(onSubmit ? { onSubmit } : {})}
      className={`flex-shrink-0 mb-1 flex flex-wrap items-center gap-2 border border-slate-200 bg-white px-3 py-2 shadow-sm ${className}`}
      style={{ borderLeft: "3px solid #0B3B2E" }}
    >
      {children}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className={`ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 border px-3 text-xs font-bold transition-colors ${
            activeCount > 0
              ? "border-[#0B3B2E] bg-[#0B3B2E] text-white hover:bg-[#07271e]"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          <FaRedoAlt size={9} className={activeCount > 0 ? "" : "text-slate-400"} />
          Reset
          {activeCount > 0 && (
            <span className="ml-0.5 flex h-4 min-w-[14px] items-center justify-center rounded-full bg-white/25 px-1 text-[9px] font-black">
              {activeCount}
            </span>
          )}
        </button>
      )}
    </Tag>
  );
};

export default SaleFilterBar;
