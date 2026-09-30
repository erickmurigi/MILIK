import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { FaArrowLeft, FaBook, FaSync } from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikTable from "../../components/common/MilikTable";
import { getCreditorsSummary, getCreditorStatement } from "../../redux/apiCalls";
import { fmtDate } from "../../utils/dates";

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_STYLE = {
  invoice: "bg-blue-50 text-blue-700",
  payment: "bg-green-50 text-green-700",
};

const CreditorLedger = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId = currentCompany?._id;

  const [view, setView] = useTabState("/accounts/creditor-ledger:view", "list");
  const [providers, setProviders] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useTabState("/accounts/creditor-ledger:search", "");

  const [selectedProvider, setSelectedProvider] = useTabState("/accounts/creditor-ledger:selectedProvider", null);
  const [statement, setStatement] = useState(null);
  const [loadingStatement, setLoadingStatement] = useState(false);

  const fetchedRef = useRef(false);

  const loadList = useCallback(
    async (force = false) => {
      if (!businessId) return;
      if (fetchedRef.current && !force) return;
      fetchedRef.current = true;
      setLoadingList(true);
      try {
        const data = await getCreditorsSummary({ business: businessId });
        setProviders(Array.isArray(data) ? data : []);
      } catch {
        toast.error("Failed to load creditors");
      } finally {
        setLoadingList(false);
      }
    },
    [businessId]
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadStatement = useCallback(
    async (provider) => {
      if (!businessId || !provider?._id) return;
      setLoadingStatement(true);
      setStatement(null);
      try {
        const data = await getCreditorStatement(provider._id, { business: businessId });
        setStatement(data);
      } catch {
        toast.error("Failed to load statement");
      } finally {
        setLoadingStatement(false);
      }
    },
    [businessId]
  );

  const openDetail = (provider) => {
    setSelectedProvider(provider);
    setView("detail");
    loadStatement(provider);
  };

  const goBack = () => {
    setView("list");
    setSelectedProvider(null);
    setStatement(null);
  };

  const filtered = useMemo(
    () =>
      providers.filter((p) => {
        if (!search) return true;
        const s = search.toLowerCase();
        return (
          (p.name || "").toLowerCase().includes(s) ||
          (p.providerCode || "").toLowerCase().includes(s) ||
          (p.category || "").toLowerCase().includes(s) ||
          (p.phone || "").includes(s)
        );
      }),
    [providers, search]
  );

  const listTotals = useMemo(
    () => ({
      invoiced: filtered.reduce((s, p) => s + (p.totalInvoiced || 0), 0),
      paid: filtered.reduce((s, p) => s + (p.totalPaid || 0), 0),
      outstanding: filtered.reduce((s, p) => s + (p.outstanding || 0), 0),
    }),
    [filtered]
  );

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* ── LIST VIEW ────────────────────────────────────────────────── */}
        {view === "list" && (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Creditors Ledger
              </span>
              <input
                className="ml-2 h-7 w-48 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                placeholder="Search name, code, category…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                onClick={() => {
                  fetchedRef.current = false;
                  loadList(true);
                }}
                className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
              >
                <FaSync size={10} className={loadingList ? "animate-spin" : ""} />
                Refresh
              </button>
              <span className="ml-auto text-[10px] text-slate-400">
                {filtered.length} provider{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <MilikTable
                columns={[
                  { label: "Code" },
                  { label: "Name" },
                  { label: "Category" },
                  { label: "Phone" },
                  { label: "Invoiced (KES)", align: "right" },
                  { label: "Paid (KES)", align: "right" },
                  { label: "Outstanding (KES)", align: "right" },
                ]}
                rows={filtered}
                rowKey="_id"
                loading={loadingList}
                empty="No service providers found"
                onRowClick={openDetail}
                renderActions={(p) => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openDetail(p);
                    }}
                    className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"
                  >
                    <FaBook size={9} />
                    Statement
                  </button>
                )}
                renderFooter={filtered.length > 0 ? () => (
                  <>
                    <td colSpan={4} className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-400">Totals</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">{fmt(listTotals.invoiced)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-green-700">{fmt(listTotals.paid)}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${listTotals.outstanding > 0 ? "text-red-600" : "text-slate-400"}`}>
                      {fmt(listTotals.outstanding)}
                    </td>
                  </>
                ) : undefined}
                renderRow={(p) => {
                  const outstanding = p.outstanding || 0;
                  return (
                    <>
                      <td className="px-3 py-1 border-r border-gray-100 font-mono font-bold text-slate-600">
                        {p.providerCode}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{p.name}</td>
                      <td className="px-3 py-1 border-r border-gray-100 capitalize text-slate-500">{p.category || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{p.phone || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">
                        {fmt(p.totalInvoiced)}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-green-700">
                        {fmt(p.totalPaid)}
                      </td>
                      <td
                        className={`px-3 py-1 border-r border-gray-100 text-right font-mono font-bold ${
                          outstanding > 0 ? "text-red-600" : "text-slate-400"
                        }`}
                      >
                        {fmt(outstanding)}
                      </td>
                    </>
                  );
                }}
              />
            </div>
          </>
        )}

        {/* ── DETAIL VIEW ──────────────────────────────────────────────── */}
        {view === "detail" && (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2">
              <button
                onClick={goBack}
                className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
              >
                <FaArrowLeft size={10} />
                Back
              </button>
              <span className="h-4 w-px bg-slate-200" />
              <span className="text-xs font-bold text-slate-800">{selectedProvider?.name}</span>
              <span className="font-mono text-[10px] text-slate-400">{selectedProvider?.providerCode}</span>

              {statement && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    Invoiced: KES {fmt(statement.summary?.totalInvoiced)}
                  </span>
                  <span className="rounded bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    Paid: KES {fmt(statement.summary?.totalPaid)}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      (statement.summary?.outstanding || 0) > 0
                        ? "bg-red-50 text-red-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    Outstanding: KES {fmt(statement.summary?.outstanding)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {!statement && !loadingStatement ? null : (
                <MilikTable
                  columns={[
                    { label: "Date" },
                    { label: "Reference" },
                    { label: "Type" },
                    { label: "Description" },
                    { label: "Invoiced (KES)", align: "right" },
                    { label: "Paid (KES)", align: "right" },
                    { label: "Balance (KES)", align: "right" },
                  ]}
                  rows={statement?.lines || []}
                  loading={loadingStatement}
                  empty="No transactions found for this provider"
                  rowClassName={(line) => (line.type === "payment" ? "bg-emerald-50/30" : "")}
                  renderFooter={statement?.lines?.length > 0 ? () => (
                    <>
                      <td colSpan={4} className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-400">Totals</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">{fmt(statement.summary?.totalInvoiced)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-green-700">{fmt(statement.summary?.totalPaid)}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${(statement.summary?.outstanding || 0) > 0 ? "text-red-600" : "text-slate-400"}`}>
                        {fmt(statement.summary?.outstanding)}
                      </td>
                    </>
                  ) : undefined}
                  renderRow={(line) => (
                    <>
                      <td className="whitespace-nowrap px-3 py-1 border-r border-gray-100 text-slate-500">
                        {fmtDate(line.date)}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-600">{line.ref || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <span
                          className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            TYPE_STYLE[line.type] || "border-slate-200 bg-slate-100 text-slate-500"
                          }`}
                        >
                          {line.type}
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-3 py-1 border-r border-gray-100 text-slate-700">
                        {line.description || "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">
                        {line.invoiced > 0 ? fmt(line.invoiced) : "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-green-700">
                        {line.paid > 0 ? fmt(line.paid) : "—"}
                      </td>
                      <td
                        className={`px-3 py-1 text-right font-mono font-bold ${
                          line.balance > 0
                            ? "text-red-600"
                            : line.balance < 0
                            ? "text-green-700"
                            : "text-slate-400"
                        }`}
                      >
                        {fmt(line.balance)}
                      </td>
                    </>
                  )}
                />
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default CreditorLedger;
