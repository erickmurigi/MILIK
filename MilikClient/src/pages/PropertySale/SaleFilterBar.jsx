import React from "react";
import { FaRedoAlt, FaSearch } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import ListToolbar from "../../components/common/ListToolbar";

export const FilterSearch = ({ value, onChange, placeholder, width = 160 }) => (
  <div className="relative shrink-0" style={{ width }}>
    <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
    <ListToolbar.Input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full pl-5"
      width=""
    />
  </div>
);

export const FilterDate = ({ value, onChange, title }) => (
  <ListToolbar.Input
    type="date"
    value={value}
    onChange={onChange}
    title={title}
    className={value ? "border-[#0B3B2E] bg-[#F1F6F3] text-[#0B3B2E]" : ""}
  />
);

export const FilterDateRange = ({ from, to, onFromChange, onToChange }) => (
  <div className="flex shrink-0 items-center gap-1">
    <FilterDate value={from} onChange={onFromChange} title="From date" />
    <span className="text-[9px] font-semibold text-slate-400">—</span>
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
    className="filter-bar flex shrink-0 items-center gap-1.5 overflow-x-auto border border-slate-200 bg-white px-2 py-1"
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
      <ListToolbar.Button
        icon={FaRedoAlt}
        variant={activeCount > 0 ? "primary" : "outline"}
        className="ml-auto"
        onClick={onReset}
      >
        Reset
        {activeCount > 0 && (
          <span className="flex h-3.5 min-w-[14px] items-center justify-center bg-white/25 px-1 text-[8px] font-black">
            {activeCount}
          </span>
        )}
      </ListToolbar.Button>
    )}

    {/* Trailing actions (Refresh, Print, etc.) */}
    {trailing && <div className={`${onReset ? "" : "ml-auto"} flex shrink-0 items-center gap-1`}>{trailing}</div>}
  </div>
);

export default SaleFilterBar;
