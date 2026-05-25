import React, { useCallback, useEffect, useState } from "react";
import { FaReceipt, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney, todayISO } from "../../services/inventoryApi";

const STATUS_BADGE = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  voided:    "border-red-200    bg-red-50    text-red-700",
};

const StatusPill = ({ status }) => (
  <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[status] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
    {status}
  </span>
);

const Modal = ({ title, onClose, children, footer, accent }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
      <div className={`flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-white ${accent || "bg-[#1a5c3a]"}`}>
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#1a5c3a] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";

const POSSalesHistory = () => {
  const [sales, setSales] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, locs, sum] = await Promise.allSettled([
        inventoryApi.listSales({
          location: locationFilter || undefined,
          status: statusFilter || undefined,
          date: date || undefined,
          receiptNumber: search || undefined,
          page,
          limit: 30,
        }),
        locations.length ? Promise.resolve(locations) : inventoryApi.listLocations({ active: true }),
        inventoryApi.getSalesSummary({ location: locationFilter || undefined, date: date || undefined }),
      ]);
      if (res.status === "fulfilled") {
        const d = res.value;
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setSales(list);
        setTotal(d?.total ?? list.length);
      } else {
        setSales([]);
      }
      if (locs.status === "fulfilled") {
        const d = locs.value;
        if (Array.isArray(d)) setLocations(d);
        else if (Array.isArray(d?.data)) setLocations(d.data);
      }
      if (sum.status === "fulfilled") setSummary(sum.value?.data ?? sum.value);
    } finally {
      setLoading(false);
    }
  }, [locationFilter, statusFilter, date, search, page]);

  useEffect(() => { load(); }, [load]);

  const openVoid = (sale) => { setSelected(sale); setVoidReason(""); setShowVoid(true); };

  const handleVoid = async () => {
    if (!voidReason.trim()) { toast.error("Void reason is required"); return; }
    setVoiding(true);
    try {
      await inventoryApi.voidSale(selected._id, { voidReason });
      setShowVoid(false);
      toast.success(`Sale ${selected.receiptNumber} voided`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Void failed");
    } finally {
      setVoiding(false);
    }
  };

  const SUMMARY_COLS = [
    ["Sales",       summary?.count        ?? 0,                      false],
    ["Subtotal",    formatMoney(summary?.subtotal),                   false],
    ["Discount",    formatMoney(summary?.totalDiscount),              false],
    ["VAT",         formatMoney(summary?.totalVat),                   false],
    ["Grand Total", formatMoney(summary?.grandTotal),                 true ],
  ];

  return (
    <InventoryShell
      title="Sales History"
      action={
        <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
          <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Combined summary + filter strip */}
        <div className="border-b border-slate-200 bg-[#EDF5F1]">
          {/* Summary row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#d4e8dc] px-3 py-2">
            {SUMMARY_COLS.map(([label, val, bold]) => (
              <div key={label} className="flex items-baseline gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}:</span>
                <span className={bold ? "font-extrabold text-[#1a5c3a]" : "font-bold text-slate-800"}>{val}</span>
              </div>
            ))}
            {summary?.byPaymentMethod && Object.entries(summary.byPaymentMethod).map(([method, amt]) => (
              <div key={method} className="flex items-baseline gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{method}:</span>
                <span className="font-semibold text-slate-600">{formatMoney(amt)}</span>
              </div>
            ))}
          </div>
          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <input
              type="date" value={date}
              onChange={(e) => { setDate(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#1a5c3a]"
            />
            <select
              value={locationFilter}
              onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#1a5c3a]"
            >
              <option value="">All Locations</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#1a5c3a]"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="voided">Voided</option>
            </select>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Receipt #"
              className="w-32 border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-[#1a5c3a]"
            />
            <span className="ml-auto text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Total: <strong className="text-[#1a5c3a]">{total}</strong>
            </span>
          </div>
        </div>

        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-[#1a5c3a] text-white">
            <tr>
              {["Receipt #", "Time", "Location", "Customer", "Grand Total", "Payment", "Status", "Cashier", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-bold uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : !sales.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-14 text-center">
                  <FaReceipt className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">No sales found</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {date ? `No sales recorded for ${new Date(date + "T00:00:00").toLocaleDateString("en-KE")}` : "Try adjusting your filters"}
                  </p>
                </td>
              </tr>
            ) : sales.map((s) => (
              <tr key={s._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[#1a5c3a]">
                    <FaReceipt className="shrink-0 text-[10px]" />{s.receiptNumber}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                  {s.createdAt ? new Date(s.createdAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
                <td className="px-3 py-2 text-slate-600">{s.location?.name || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{s.customerName || s.customerPhone || "—"}</td>
                <td className="px-3 py-2 font-bold text-slate-900">{formatMoney(s.grandTotal)}</td>
                <td className="px-3 py-2 text-slate-600 capitalize">
                  {s.payments?.map((p) => p.method).join(", ") || "—"}
                </td>
                <td className="px-3 py-2"><StatusPill status={s.status} /></td>
                <td className="px-3 py-2 text-slate-500">{s.cashier?.name || "—"}</td>
                <td className="px-3 py-2 text-right">
                  {s.status === "completed" && (
                    <button
                      type="button"
                      onClick={() => openVoid(s)}
                      className="border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-100"
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > 30 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#1a5c3a]">← Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil(total / 30)}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={sales.length < 30} className="text-xs font-bold text-slate-600 disabled:opacity-40 hover:text-[#1a5c3a]">Next →</button>
          </div>
        )}
      </div>

      {showVoid && selected && (
        <Modal
          title={`Void Sale — ${selected.receiptNumber}`}
          onClose={() => setShowVoid(false)}
          accent="bg-red-700"
          footer={
            <>
              <button type="button" onClick={() => setShowVoid(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={handleVoid} disabled={voiding || !voidReason.trim()} className="bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50">
                {voiding ? "Voiding…" : "Confirm Void"}
              </button>
            </>
          }
        >
          <p className="mb-3 text-xs text-slate-600">This will reverse all stock movements for this sale. Provide a reason to continue.</p>
          <div>
            <label className={labelClass}>Void Reason *</label>
            <textarea
              rows={3}
              className={`${inputClass} h-20 resize-none py-2`}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Customer returned items, wrong product scanned…"
            />
          </div>
        </Modal>
      )}
    </InventoryShell>
  );
};

export default POSSalesHistory;
