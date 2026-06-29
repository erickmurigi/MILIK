/**
 * Shared pagination bar component — matches the CarWash module pagination style.
 *
 * Props:
 *   page        — current page number (1-based)
 *   pages       — total number of pages
 *   total       — total record count (displayed as "X records")
 *   pageSize    — current page size
 *   onPageChange(newPage) — called when prev/next is clicked
 *   onPageSizeChange(newSize) — called when per-page select changes; omit to hide the selector
 *   loading     — disables buttons while fetching
 *   pageSizes   — array of page size options (default: [25, 50, 100, 200])
 */
const PaginationBar = ({
  page = 1,
  pages = 1,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading = false,
  pageSizes = [25, 50, 100, 200],
}) => (
  <div className="flex-shrink-0 flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
    <div className="flex items-center gap-1.5">
      {onPageSizeChange ? (
        <>
          <span className="font-semibold text-slate-500 normal-case">Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
            className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition normal-case"
          >
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </>
      ) : (
        total != null && (
          <span className="normal-case font-semibold text-slate-500">{total.toLocaleString()} record{total !== 1 ? "s" : ""}</span>
        )
      )}
    </div>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(page - 1, 1))}
        disabled={page <= 1 || loading}
        className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
      >
        Previous
      </button>
      <span>Page {page} of {pages}</span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(page + 1, pages))}
        disabled={page >= pages || loading}
        className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
      >
        Next
      </button>
    </div>
  </div>
);

export default PaginationBar;
