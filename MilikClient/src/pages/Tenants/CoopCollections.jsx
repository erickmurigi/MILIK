import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  FaCheckCircle, FaExclamationTriangle, FaTimesCircle,
  FaSearch, FaRedoAlt, FaTimes, FaLink, FaBan, FaUndo,
  FaReceipt, FaUser, FaTrash,
} from "react-icons/fa";
import { useConfirm } from "../../context/ConfirmContext";
import { todayISO, fmtDate } from "../../utils/dates";
import { formatMoney } from "../../utils/money";
import StatusBadge from "../../components/common/StatusBadge";
import Spinner from "../../components/common/Spinner";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import { selectCurrentCompany } from "../../redux/selectors";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useTabState } from "../../hooks/useTabState";
import useDebounce from "../../hooks/useDebounce";
import AppSelect from "../../components/common/AppSelect";

const PAGE_SIZE   = 50;
const AUTO_RELOAD = 30;


const STATUS_MAP = {
  unmatched:      "border-amber-200 bg-amber-50 text-amber-700",
  matched_tenant: "border-blue-200 bg-blue-50 text-blue-700",
  captured:       "border-emerald-200 bg-emerald-50 text-emerald-700",
  ignored:        "border-red-200 bg-red-50 text-red-700",
};

// ─── Assign Tenant Modal ──────────────────────────────────────────────────────
function AssignTenantModal({ collection, businessId, onClose, onAssigned }) {
  const [search, setSearch]   = useState(collection?.tenantCode || collection?.documentReferenceNumber || "");
  const [tenants, setTenants] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (collection?.tenantCode) doSearch(collection.tenantCode);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = async (q = search) => {
    const term = q.trim();
    if (!term) return;
    setSearching(true); setSelected(null);
    try {
      const res  = await adminRequests.get("/tenants", { params: { business: businessId, search: term, limit: 20 } });
      const list = Array.isArray(res?.data?.tenants) ? res.data.tenants : Array.isArray(res?.data) ? res.data : [];
      setTenants(list);
    } catch { toast.error("Tenant search failed"); }
    finally   { setSearching(false); }
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await adminRequests.post(`/coop-collections/${collection._id}/assign-tenant`, { tenantId: selected._id, business: businessId });
      toast.success(`Assigned to ${selected.name}`);
      onAssigned(res?.data?.data || res?.data);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Assignment failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Assign to Tenant</p>
            <p className="text-[11px] text-emerald-200">
              {formatMoney(collection.amount)} · ref: <span className="font-mono">{collection.tenantCode || collection.documentReferenceNumber || "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800">
          <FaExclamationTriangle className="mr-1.5 inline text-amber-500" size={11} />
          Tenant code <strong className="font-mono">&ldquo;{collection.tenantCode || collection.documentReferenceNumber}&rdquo;</strong> was not auto-matched — search to find the correct tenant.
        </div>

        <div className="px-4 pb-2 pt-3">
          <div className="flex gap-2">
            <input ref={inputRef}
              className="h-9 flex-1 border border-slate-300 px-3 text-xs font-semibold placeholder:font-normal focus:border-[#0B3B2E] focus:outline-none"
              placeholder="Name, tenant code, or phone"
              value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()} />
            <button type="button" onClick={() => doSearch()} disabled={searching}
              className="inline-flex h-9 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
              <FaSearch size={10} /> Search
            </button>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto border-t border-slate-100">
          {searching && <p className="px-4 py-6 text-center text-xs text-slate-400">Searching…</p>}
          {!searching && tenants.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No tenants found.</p>}
          {!searching && tenants.map(t => {
            const isSel = selected?._id === t._id;
            return (
              <button key={t._id} type="button" onClick={() => setSelected(t)}
                className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors ${isSel ? "border-l-2 border-l-emerald-500 bg-emerald-50" : "hover:bg-slate-50"}`}>
                <FaUser size={12} className={isSel ? "text-emerald-600" : "text-slate-400"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-slate-900">{t.name}</span>
                    <span className="font-mono text-[10px] text-slate-500">{t.tenantCode}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {[t?.unit?.unitNumber, t?.unit?.property?.propertyName].filter(Boolean).join(" · ")}{t.phone ? ` · ${t.phone}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          {selected
            ? <div className="text-[11px] text-slate-600">Assigning to <strong className="text-[#0B3B2E]">{selected.name} · {selected.tenantCode}</strong></div>
            : <span className="text-[11px] text-slate-400">Select a tenant above</span>}
          <div className="flex gap-2">
            <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
            <button onClick={handleSubmit} disabled={!selected || saving}
              className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
              <FaLink size={10} /> {saving ? "Assigning…" : "Confirm Assignment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CoopCollections() {
  const confirm = useConfirm();
  const currentCompany = useSelector(selectCurrentCompany);
  const businessId     = currentCompany?._id || "";

  const [items,    setItems]    = useState([]);
  const [total,    setTotal]    = useState(0);
  const [summary,  setSummary]  = useState({ unmatched: 0, matched_tenant: 0, captured: 0, ignored: 0, totalAmount: 0 });
  const [page,     setPage]     = useTabState("/receipts/coop-collections:page", 1);
  const [pages,    setPages]    = useState(1);
  const [loading,  setLoading]  = useState(false);
  const [statusFilter, setStatusFilter] = useTabState("/receipts/coop-collections:statusFilter", "");
  const [search,   setSearch]   = useTabState("/receipts/coop-collections:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [dateFrom, setDateFrom] = useTabState("/receipts/coop-collections:dateFrom", "");
  const [dateTo,   setDateTo]   = useTabState("/receipts/coop-collections:dateTo", () => todayISO());
  const [countdown, setCountdown] = useState(AUTO_RELOAD);
  const [assignTarget, setAssignTarget] = useState(null);
  const [ignoreTarget, setIgnoreTarget] = useState(null);
  const [deletingId,   setDeletingId]   = useState(null);
  const [unignoringId, setUnignoringId] = useState(null);
  const countdownRef = useRef(null);

  const fetchData = useCallback(async (pg = 1) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = { business: businessId, page: pg, limit: PAGE_SIZE };
      if (statusFilter) params.status = statusFilter;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo)   params.dateTo   = dateTo;
      const res = await adminRequests.get("/coop-collections", { params });
      setItems(Array.isArray(res.data?.data) ? res.data.data : []);
      setTotal(res.data?.total  || 0);
      setPages(res.data?.pages  || 1);
      setSummary(res.data?.summary || { unmatched: 0, matched_tenant: 0, captured: 0, ignored: 0, totalAmount: 0 });
      setPage(pg);
    } catch {
      toast.error("Failed to load Co-op collections");
    } finally {
      setLoading(false);
    }
  }, [businessId, statusFilter, debouncedSearch, dateFrom, dateTo]);

  useEffect(() => { fetchData(1); }, [fetchData]);

  // Countdown timer
  useEffect(() => {
    setCountdown(AUTO_RELOAD);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { fetchData(page); return AUTO_RELOAD; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [fetchData, page]);

  const handleDelete = async (item) => {
    if (!await confirm({ message: `Delete this Co-op collection (${formatMoney(item.amount)})? This cannot be undone.`, confirmText: "Delete", isDangerous: true })) return;
    setDeletingId(item._id);
    try {
      await adminRequests.delete(`/coop-collections/${item._id}`, { params: { business: businessId } });
      toast.success("Collection deleted");
      setItems(prev => prev.filter(c => c._id !== item._id));
    } catch (err) {
      toast.error(err?.response?.data?.message || "Delete failed");
    } finally { setDeletingId(null); }
  };

  const handleUnignore = async (item) => {
    setUnignoringId(item._id);
    try {
      const res = await adminRequests.post(`/coop-collections/${item._id}/unignore`, { business: businessId });
      const updated = res?.data?.data || res?.data;
      setItems(prev => prev.map(c => c._id === updated._id ? updated : c));
      toast.success("Collection unignored");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Unignore failed");
    } finally { setUnignoringId(null); }
  };

  const onAssigned = (updated) => {
    if (!updated?._id) { fetchData(page); return; }
    setItems(prev => prev.map(c => c._id === updated._id ? updated : c));
  };

  const onIgnored = (updated) => {
    if (!updated?._id) { fetchData(page); return; }
    setItems(prev => prev.map(c => c._id === updated._id ? updated : c));
  };

  const SummaryCard = ({ label, value, highlight }) => (
    <div className={`border px-3 py-3 ${highlight ? "border-[#0B3B2E] bg-[#EDF5F1]" : "border-slate-200 bg-white"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold text-slate-900">{value}</div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 px-3 py-4 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-sm font-black uppercase tracking-wide text-slate-900">Co-op Bank B2B Collections</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">Payments received via Co-operative Bank B2B integration</p>
          </div>
          <button
            onClick={() => fetchData(page)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FaRedoAlt className={loading ? "animate-spin" : ""} size={10} />
            Refresh {!loading && <span className="text-slate-400">({countdown}s)</span>}
          </button>
        </div>

        {/* Summary cards */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <SummaryCard label="Total" value={total} />
          <SummaryCard label="Unmatched" value={summary.unmatched} />
          <SummaryCard label="Matched" value={summary.matched_tenant} />
          <SummaryCard label="Captured" value={summary.captured} highlight />
          <SummaryCard label="Total Amount" value={formatMoney(summary.totalAmount)} />
        </div>

        {/* Filters */}
        <div className="mb-3 flex flex-wrap gap-2 border border-slate-200 bg-white p-2.5">
          <div className="flex items-center gap-1.5">
            <FaSearch className="text-[10px] text-slate-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); if (!e.target.value) fetchData(1); }}
              onKeyDown={e => e.key === "Enter" && fetchData(1)}
              placeholder="Ref, tenant code, payer…"
              className="h-7 w-44 border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            />
          </div>

          <AppSelect
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v ?? ""); fetchData(1); }}
            options={[
              { value: "unmatched", label: "Unmatched" },
              { value: "matched_tenant", label: "Matched" },
              { value: "captured", label: "Captured" },
              { value: "ignored", label: "Ignored" },
            ]}
            placeholder="All statuses"
            clearable
            size="sm"
          />

          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="h-7 border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none" />
          <span className="self-center text-[10px] text-slate-400">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="h-7 border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none" />

          <button onClick={() => fetchData(1)} className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127]">
            <FaSearch size={9} /> Filter
          </button>
        </div>

        {/* Table */}
        <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-400">
              <Spinner size="sm" /> Loading Co-op collections…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-400">
              No Co-op Bank B2B collections yet. Payments will appear here automatically.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-[#0B3B2E]">
                  <tr>
                    {["Date","Transaction Ref","Account Ref","Tenant Code","Amount","Payer","Tenant","Status","Actions"].map(h => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-white">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map(item => (
                    <tr key={item._id} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/50 hover:bg-[#EDF5F1]/70">
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{fmtDate(item.paymentDate || item.transactionDate)}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-700">{item.transactionReferenceCode || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-600">{item.documentReferenceNumber || "—"}</td>
                      <td className="px-3 py-2.5 font-mono font-bold text-slate-700">{item.tenantCode || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-bold text-slate-900">{formatMoney(item.amount)}</td>
                      <td className="max-w-[120px] truncate px-3 py-2.5 text-slate-600">{item.payerName || "—"}</td>
                      <td className="px-3 py-2.5">
                        {item.tenant ? (
                          <div>
                            <div className="font-bold text-slate-900">{item.tenant.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{item.tenant.tenantCode}</div>
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge status={item.matchingStatus} map={STATUS_MAP} /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          {item.matchingStatus === "ignored" ? (
                            <button
                              onClick={() => handleUnignore(item)}
                              disabled={unignoringId === item._id}
                              className="inline-flex h-6 items-center gap-1 border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              title="Unignore"
                            >
                              {unignoringId === item._id ? <Spinner size="sm" /> : <FaUndo size={8} />}
                            </button>
                          ) : item.matchingStatus !== "captured" ? (
                            <>
                              <button onClick={() => setAssignTarget(item)} className="inline-flex h-6 items-center gap-1 border border-blue-200 bg-blue-50 px-2 text-[10px] font-bold text-blue-700 hover:bg-blue-100" title="Assign tenant">
                                <FaLink size={8} />
                              </button>
                              <button onClick={() => setIgnoreTarget(item)} className="inline-flex h-6 items-center gap-1 border border-red-200 bg-red-50 px-2 text-[10px] font-bold text-red-600 hover:bg-red-100" title="Ignore">
                                <FaBan size={8} />
                              </button>
                            </>
                          ) : null}
                          {item.matchingStatus !== "captured" && (
                            <button
                              onClick={() => handleDelete(item)}
                              disabled={deletingId === item._id}
                              className="inline-flex h-6 items-center gap-1 border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              title="Delete"
                            >
                              {deletingId === item._id ? <Spinner size="sm" /> : <FaTrash size={8} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{total} total collection{total !== 1 ? "s" : ""}</span>
            <div className="flex gap-1">
              {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => fetchData(p)}
                  className={`h-7 w-7 border text-[11px] font-bold ${p === page ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Assign Tenant Modal */}
      {assignTarget && (
        <AssignTenantModal
          collection={assignTarget}
          businessId={businessId}
          onClose={() => setAssignTarget(null)}
          onAssigned={(updated) => { onAssigned(updated); setAssignTarget(null); }}
        />
      )}

      {/* Ignore Confirm */}
      {ignoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between bg-red-700 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-white">Ignore Collection</p>
                <p className="text-[11px] text-red-200">{formatMoney(ignoreTarget.amount)} · <span className="font-mono">{ignoreTarget.transactionReferenceCode || "—"}</span></p>
              </div>
              <button onClick={() => setIgnoreTarget(null)} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-sm text-slate-700">Mark this Co-op payment as ignored? It will be excluded from auto-matching.</p>
              <p className="text-[11px] text-slate-500">Use this for wrong paybill payments, test transactions, or non-rent receipts.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button onClick={() => setIgnoreTarget(null)} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
              <button
                onClick={async () => {
                  try {
                    const res = await adminRequests.post(`/coop-collections/${ignoreTarget._id}/ignore`, { business: businessId });
                    toast.success("Collection ignored");
                    onIgnored(res?.data?.data || res?.data);
                    setIgnoreTarget(null);
                  } catch (err) {
                    toast.error(err?.response?.data?.message || "Failed to ignore");
                  }
                }}
                className="inline-flex h-8 items-center gap-1.5 bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700"
              >
                <FaBan size={10} /> Mark as Ignored
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
