import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

/**
 * Universal pagination bar — Milik standard.
 *
 * Props:
 *   page             — current page (1-based)
 *   pages            — total pages
 *   total            — total record count
 *   pageSize         — current page size
 *   onPageChange(n)  — called when page changes
 *   onPageSizeChange(n) — called when per-page changes; omit to hide selector
 *   loading          — disables all controls while fetching
 *   pageSizes        — options array (default: [25, 50, 100, 200, 500, 1000])
 *   label            — noun after count, e.g. "tenants" (default: "records")
 */

export const PAGE_SIZES = [25, 50, 100, 200, 500, 1000];

function pageButtons(current, total) {
  if (total <= 1) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const delta = 1;
  const inner = [];
  for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) {
    inner.push(i);
  }
  const result = [1];
  if (inner[0] > 2) result.push('…');
  result.push(...inner);
  if (inner[inner.length - 1] < total - 1) result.push('…');
  result.push(total);
  return result;
}

const PaginationBar = ({
  page = 1,
  pages = 1,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading = false,
  pageSizes = PAGE_SIZES,
  label = 'records',
}) => {
  const safe = Math.min(Math.max(page, 1), pages || 1);
  const from = total > 0 ? (safe - 1) * pageSize + 1 : 0;
  const to   = total > 0 ? Math.min(safe * pageSize, total) : 0;
  const buttons = pageButtons(safe, pages || 1);

  return (
    <div className="flex-shrink-0 sticky bottom-0 z-20 bg-white border-t border-gray-200 px-3 py-1 flex items-center justify-between min-h-9 gap-2">

      {/* Left — record count */}
      <div className="text-xs font-bold text-gray-600 whitespace-nowrap">
        {total != null
          ? `Showing ${from} to ${to} of ${Number(total).toLocaleString()} ${label}`
          : null}
      </div>

      {/* Right — per-page selector + page nav */}
      <div className="flex items-center gap-1.5 flex-wrap justify-end">

        {onPageSizeChange && (
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
              disabled={loading}
              className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition"
            >
              {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={() => onPageChange(Math.max(safe - 1, 1))}
          disabled={safe <= 1 || loading}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-gray-700"
          aria-label="Previous page"
        >
          <FaChevronLeft size={11} />
        </button>

        <div className="flex items-center gap-0.5">
          {buttons.map((b, i) =>
            b === '…' ? (
              <span key={`ellipsis-${i}`} className="px-1 text-gray-400 text-xs select-none">…</span>
            ) : (
              <button
                key={b}
                type="button"
                onClick={() => onPageChange(b)}
                disabled={loading}
                className={`min-w-[24px] px-1.5 py-0.5 rounded text-xs font-bold transition-colors ${
                  safe === b
                    ? 'bg-[#F5821F] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {b}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => onPageChange(Math.min(safe + 1, pages))}
          disabled={safe >= pages || loading}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-gray-700"
          aria-label="Next page"
        >
          <FaChevronRight size={11} />
        </button>

      </div>
    </div>
  );
};

export default PaginationBar;
