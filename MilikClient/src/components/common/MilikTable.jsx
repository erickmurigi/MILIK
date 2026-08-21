import React, { useMemo } from "react";
import Spinner from "./Spinner";
import { FaChevronDown, FaChevronRight, FaSort, FaSortUp, FaSortDown } from "react-icons/fa";

function buildGroups(rows, groupFn) {
  const map = new Map();
  for (const row of rows) {
    const key = String(groupFn(row) ?? "Other");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }));
}

function SortIcon({ col, sortKey, sortDir, onSort }) {
  if (!col.sortKey || !onSort) return null;
  if (col.sortKey !== sortKey) return <FaSort className="ml-0.5 inline opacity-40" size={8} />;
  return sortDir === "asc"
    ? <FaSortUp   className="ml-0.5 inline" size={8} />
    : <FaSortDown className="ml-0.5 inline" size={8} />;
}

const MilikTable = React.memo(function MilikTable({
  columns   = [],   // { label, align?, width?, className?, sortKey? }
  rows      = [],
  rowKey    = "_id",

  renderRow,        // (row, i) => just <td>s
  renderActions,    // (row) => JSX — rendered in a final "Actions" col (stopPropagation auto)
  renderExpanded,   // (row) => JSX — collapsible detail row

  groupBy,          // (row) => string — group label

  onRowClick,       // (row) => void
  isSelected,       // (row) => boolean
  rowClassName,     // (row, i) => extra class string

  checkboxes,
  allChecked,
  someChecked,
  onCheckAll,
  isChecked,        // (row) => boolean
  onCheckRow,       // (row) => void

  sortKey,          // active sort column key
  sortDir = "asc",
  onSort,           // (key) => void

  loading,
  empty = "No records found.",

  minWidth,
  tableFixed,
  actionsWidth,
  stickyHeader = true,
  className,
}) {
  const [expandedKeys, setExpandedKeys] = React.useState(new Set());

  const hasExpand  = !!renderExpanded;
  const hasActions = !!renderActions;

  const colCount =
    (checkboxes ? 1 : 0) +
    (hasExpand  ? 1 : 0) +
    columns.length +
    (hasActions ? 1 : 0);

  function toggleExpand(key, e) {
    e.stopPropagation();
    setExpandedKeys((prev) => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  }

  function renderDataRows(items, startIdx) {
    return items.map((row, localIdx) => {
      const i        = startIdx + localIdx;
      const key      = row[rowKey] ?? i;
      const sel      = isSelected?.(row) ?? false;
      const checked  = isChecked?.(row)  ?? false;
      const expanded = expandedKeys.has(key);
      const zebra    = i % 2 === 0 ? "bg-white" : "bg-slate-50/50";
      const extra    = rowClassName?.(row, i) ?? "";

      return (
        <React.Fragment key={key}>
          <tr
            className={`border-b border-gray-100 text-[11px] uppercase transition-colors
              ${onRowClick ? "cursor-pointer" : ""}
              ${sel
                ? "bg-[#C8E6D4] shadow-[inset_4px_0_0_0_#0B3B2E] font-medium"
                : `${zebra} hover:bg-[#EBF5EF]`}
              ${extra}`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {checkboxes && (
              <td
                className="w-9 px-2 py-1.5 text-center border-r border-gray-100 shrink-0"
                onClick={(e) => { e.stopPropagation(); onCheckRow?.(row); }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {}}
                  className="cursor-pointer accent-[#0B3B2E]"
                />
              </td>
            )}

            {hasExpand && (
              <td
                className="w-7 px-1 py-1.5 text-center border-r border-gray-100 text-slate-400"
                onClick={(e) => toggleExpand(key, e)}
              >
                {expanded
                  ? <FaChevronDown  size={8} className="inline" />
                  : <FaChevronRight size={8} className="inline" />}
              </td>
            )}

            {renderRow(row, i)}

            {hasActions && (
              <td
                className="px-2 py-1.5 text-right border-l border-gray-100 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {renderActions(row)}
              </td>
            )}
          </tr>

          {hasExpand && expanded && (
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <td colSpan={colCount} className="px-4 py-3">
                {renderExpanded(row)}
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    });
  }

  const grouped = useMemo(
    () => (groupBy ? buildGroups(rows, groupBy) : null),
    [rows, groupBy],
  );

  return (
    <div className={`flex-1 min-h-0 overflow-auto ${className ?? ""}`}>
      <table
        className="w-full border-collapse text-xs"
        style={{ ...(minWidth ? { minWidth } : {}), ...(tableFixed ? { tableLayout: 'fixed' } : {}) }}
      >
        {/* ── Head ── */}
        <thead className={stickyHeader ? "sticky top-0 z-10 shadow-sm" : undefined}>
          <tr className="bg-[#0B3B2E] text-white">
            {checkboxes && (
              <th className="w-9 px-2 py-1.5 text-center border-r border-white/10">
                <input
                  type="checkbox"
                  checked={!!allChecked}
                  ref={(el) => { if (el) el.indeterminate = !!(someChecked && !allChecked); }}
                  onChange={onCheckAll ?? (() => {})}
                  className="cursor-pointer accent-white"
                />
              </th>
            )}
            {hasExpand && (
              <th className="w-7 px-1 py-1.5 border-r border-white/10" />
            )}
            {columns.map((col, ci) => (
              <th
                key={ci}
                onClick={col.sortKey && onSort ? () => onSort(col.sortKey) : undefined}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest
                  border-r border-white/10 last:border-r-0 whitespace-nowrap
                  ${col.align === "right"  ? "text-right"  :
                    col.align === "center" ? "text-center" : "text-left"}
                  ${col.sortKey && onSort ? "cursor-pointer select-none hover:bg-white/10" : ""}
                  ${col.className ?? ""}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
                <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
            ))}
            {hasActions && (
              <th
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-right whitespace-nowrap"
                style={actionsWidth ? { width: actionsWidth } : undefined}
              >
                Actions
              </th>
            )}
          </tr>
        </thead>

        {/* ── Body ── */}
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colCount} className="px-4 py-10 text-center">
                <div className="flex items-center justify-center gap-2 text-slate-400">
                  <Spinner size="sm" />
                  <span className="text-xs font-semibold">Loading…</span>
                </div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-4 py-12 text-center">
                <p className="text-xs font-semibold text-slate-400">{empty}</p>
              </td>
            </tr>
          ) : grouped ? (
            (() => {
              let idx = 0;
              return grouped.map(({ key, items }) => {
                const start = idx;
                idx += items.length;
                return (
                  <React.Fragment key={key}>
                    <tr>
                      <td colSpan={colCount} className="px-3 pt-2.5 pb-1 bg-white">
                        <div className="flex items-center gap-2.5">
                          <div className="h-4 w-1 rounded-full bg-[#FF8C00] shrink-0" />
                          <span className="text-[11px] font-black tracking-widest text-slate-800 uppercase">
                            {key}
                          </span>
                          <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums">
                            {items.length}
                          </span>
                        </div>
                        <div className="mt-1.5 h-px bg-gradient-to-r from-[#FF8C00]/50 via-orange-200/60 to-transparent" />
                      </td>
                    </tr>
                    {renderDataRows(items, start)}
                  </React.Fragment>
                );
              });
            })()
          ) : (
            renderDataRows(rows, 0)
          )}
        </tbody>
      </table>
    </div>
  );
});

export default MilikTable;
