import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaCheckCircle,
  FaFileImport,
  FaLink,
  FaMobileAlt,
  FaPlusCircle,
  FaReceipt,
  FaSearch,
  FaSyncAlt,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { importMpesaBatch, listMpesaCollections } from "../../redux/apiCalls";

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const formatMoney = (value) => `KES ${Math.abs(Number(value || 0)).toLocaleString()}`;
const formatDate = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
};

const getTenantName = (tenant) =>
  tenant?.name || tenant?.tenantName || [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") || "Unmatched tenant";

const getUnitName = (tenant) => tenant?.unit?.unitNumber || "-";
const getPropertyName = (tenant) => tenant?.unit?.property?.propertyName || "-";

const getMpesaConfigs = (company) => {
  const explicit = Array.isArray(company?.paymentIntegration?.mpesaPaybills)
    ? company.paymentIntegration.mpesaPaybills.filter(Boolean)
    : [];
  if (explicit.length > 0) return explicit;
  return company?.paymentIntegration?.mpesaPaybill ? [company.paymentIntegration.mpesaPaybill] : [];
};

const MpesaBatchImport = () => {
  const navigate = useNavigate();
  const { currentCompany } = useSelector((state) => state.company || {});

  const [rawBatchText, setRawBatchText] = useState("");
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedShortCode, setSelectedShortCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const mpesaConfigs = useMemo(() => getMpesaConfigs(currentCompany), [currentCompany]);

  useEffect(() => {
    if (!selectedShortCode && mpesaConfigs.length > 0) {
      const preferred = mpesaConfigs.find((item) => item?.isActive) || mpesaConfigs.find((item) => item?.enabled) || mpesaConfigs[0];
      setSelectedShortCode(String(preferred?.shortCode || ""));
    }
  }, [mpesaConfigs, selectedShortCode]);

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setIsLoading(true);
    try {
      const data = await listMpesaCollections({
        business: currentCompany._id,
        shortCode: selectedShortCode || "",
      });
      setRows(ensureArray(data));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load M-Pesa collections");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?._id, selectedShortCode]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== "all" && String(row?.matchingStatus || "") !== statusFilter) return false;
      if (sourceFilter !== "all" && String(row?.source || "") !== sourceFilter) return false;
      if (!search.trim()) return true;
      const haystack = [
        row?.transactionCode,
        row?.accountReference,
        row?.billRefNumber,
        row?.payerName,
        row?.msisdn,
        row?.rawLine,
        row?.matchedReceipt?.receiptNumber,
        row?.matchedReceipt?.referenceNumber,
        row?.tenant?.name,
        row?.tenant?.tenantCode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [rows, search, sourceFilter, statusFilter]);

  const totals = useMemo(() => {
    const matched = filteredRows.filter((row) => row?.matchingStatus === "captured");
    const matchedTenant = filteredRows.filter((row) => row?.matchingStatus === "matched_tenant");
    const unmatched = filteredRows.filter((row) => row?.matchingStatus === "unmatched");
    return {
      totalRows: filteredRows.length,
      matchedReceipts: matched.length,
      matchedTenantRows: matchedTenant.length,
      unmatchedRows: unmatched.length,
      pendingAmount: unmatched.reduce((sum, row) => sum + Number(row?.amount || 0), 0),
    };
  }, [filteredRows]);

  const handleImport = async () => {
    if (!rawBatchText.trim()) {
      toast.error("Paste at least one M-Pesa batch line first");
      return;
    }

    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return;
    }

    setIsImporting(true);
    try {
      const result = await importMpesaBatch({
        business: currentCompany._id,
        rawText: rawBatchText,
        shortCode: selectedShortCode || "",
      });
      toast.success(`Imported ${Number(result?.count || 0).toLocaleString()} M-Pesa row(s)`);
      setRawBatchText("");
      await loadRows();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to import M-Pesa batch lines");
    } finally {
      setIsImporting(false);
    }
  };

  const openReceiptCapture = (row) => {
    const params = new URLSearchParams();
    if (row?.tenant?._id) params.set("tenant", row.tenant._id);
    if (row?.amount) params.set("amount", String(Math.abs(Number(row.amount || 0))));
    if (row?.transactionCode) params.set("reference", row.transactionCode);
    params.set("paymentMethod", "mobile_money");
    const note = row?.accountReference
      ? `Imported from M-Pesa batch${row.accountReference ? ` · Account ref ${row.accountReference}` : ""}`
      : "Imported from M-Pesa batch";
    params.set("description", note);
    navigate(`/receipts/new?${params.toString()}`);
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-white p-4 md:p-6">
        <div className="mx-auto space-y-4" style={{ maxWidth: "96%" }}>
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-100">Receipting operations</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight">M-Pesa Batch Import</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">
                    This workspace now persists imported and callback-based M-Pesa rows on the backend, then routes them into the normal receipt flow without bypassing accounting controls.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-100">
                  Callback endpoints: <span className="font-bold">/api/mpesa-collections/validation/:shortCode</span> and <span className="font-bold">/api/mpesa-collections/confirmation/:shortCode</span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-5 md:p-5">
              {[
                { label: "Visible rows", value: totals.totalRows, accent: "text-slate-900" },
                { label: "Captured receipts", value: totals.matchedReceipts, accent: "text-emerald-700" },
                { label: "Matched tenants", value: totals.matchedTenantRows, accent: "text-[#0B3B2E]" },
                { label: "Still unmatched", value: totals.unmatchedRows, accent: "text-amber-700" },
                { label: "Pending amount", value: formatMoney(totals.pendingAmount), accent: "text-slate-900" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                  <p className={`mt-2 text-2xl font-black ${item.accent}`}>{item.value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-[0.95fr_1.05fr] md:p-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-900">
                  <FaFileImport className="text-[#0B3B2E]" />
                  <h2 className="text-lg font-black">Import batch lines</h2>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Paste one transaction per line. These rows will be stored in the backend, deduplicated by M-Pesa code where available, and then refreshed into this reconciliation workspace.
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                  <select
                    value={selectedShortCode}
                    onChange={(e) => setSelectedShortCode(e.target.value)}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                  >
                    <option value="">Use primary M-Pesa paybill</option>
                    {mpesaConfigs.map((config, index) => (
                      <option key={config?._id || `${config?.shortCode || 'mpesa'}-${index}`} value={config?.shortCode || ""}>
                        {config?.name || `Paybill ${config?.shortCode || index + 1}`}{config?.shortCode ? ` · ${config.shortCode}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleImport}
                    disabled={isImporting}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <FaPlusCircle /> {isImporting ? "Importing..." : "Import batch"}
                  </button>
                </div>

                <textarea
                  rows={16}
                  value={rawBatchText}
                  onChange={(e) => setRawBatchText(e.target.value)}
                  className="mt-4 w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-sm transition focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                  placeholder="Example: 03/04/2026	RGF12K9P1D	John Doe	254712345678	TT0004	KES 12,000.00"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-slate-900">
                      <FaMobileAlt className="text-[#0B3B2E]" />
                      <h2 className="text-lg font-black">Stored M-Pesa collections</h2>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">Rows imported manually or received through callbacks are listed here and rechecked against tenants and receipts on every refresh.</p>
                  </div>
                  <button
                    onClick={loadRows}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FaSyncAlt className={isLoading ? "animate-spin" : ""} /> Refresh
                  </button>
                </div>

                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-1 flex-col gap-3 md:flex-row">
                    <div className="relative md:w-72">
                      <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search code, tenant, phone, receipt"
                        className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                      />
                    </div>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      <option value="all">All statuses</option>
                      <option value="captured">Captured receipts</option>
                      <option value="matched_tenant">Matched tenant only</option>
                      <option value="unmatched">Unmatched</option>
                      <option value="duplicate">Duplicates</option>
                    </select>
                    <select
                      value={sourceFilter}
                      onChange={(e) => setSourceFilter(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                    >
                      <option value="all">All sources</option>
                      <option value="manual_batch">Manual batch</option>
                      <option value="callback_validation">Callback validation</option>
                      <option value="callback_confirmation">Callback confirmation</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 max-h-[560px] overflow-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        <th className="px-4 py-3">Transaction</th>
                        <th className="px-4 py-3">Matched tenant</th>
                        <th className="px-4 py-3">Matched receipt</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                            {isLoading ? "Loading M-Pesa collections..." : "No M-Pesa collections matched the current filters."}
                          </td>
                        </tr>
                      ) : (
                        filteredRows.map((row) => {
                          const matchedReceipt = row?.matchedReceipt || null;
                          const matchedTenant = row?.tenant || null;
                          const status = String(row?.matchingStatus || "unmatched");
                          const statusTone =
                            status === "captured"
                              ? "bg-emerald-50 text-emerald-700"
                              : status === "matched_tenant"
                              ? "bg-[#0B3B2E]/10 text-[#0B3B2E]"
                              : status === "duplicate"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-amber-50 text-amber-700";

                          return (
                            <tr key={row._id} className="align-top">
                              <td className="px-4 py-3">
                                <p className="font-bold text-slate-900">{row.transactionCode || "No code detected"}</p>
                                <p className="mt-1 text-xs text-slate-500">{formatDate(row.transactionDate)} · {formatMoney(row.amount)}</p>
                                <p className="mt-1 text-xs text-slate-500">{row.msisdn || "No phone"}{row.accountReference ? ` · ${row.accountReference}` : ""}</p>
                                <p className="mt-2 text-xs text-slate-400">{row.payerName || row.rawLine || "No raw details"}</p>
                              </td>
                              <td className="px-4 py-3">
                                {matchedTenant ? (
                                  <div>
                                    <p className="font-semibold text-slate-900">{getTenantName(matchedTenant)}</p>
                                    <p className="mt-1 text-xs text-slate-500">{matchedTenant?.tenantCode || "No tenant code"} · Unit {getUnitName(matchedTenant)}</p>
                                    <p className="mt-1 text-xs text-slate-500">{getPropertyName(matchedTenant)}</p>
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-500">No tenant matched yet</p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {matchedReceipt ? (
                                  <div>
                                    <p className="font-semibold text-slate-900">{matchedReceipt?.receiptNumber || matchedReceipt?.referenceNumber || "Receipt"}</p>
                                    <p className="mt-1 text-xs text-slate-500">{formatDate(matchedReceipt?.paymentDate)} · {formatMoney(matchedReceipt?.amount)}</p>
                                    <p className="mt-1 text-xs text-slate-500">{matchedReceipt?.isConfirmed ? "Confirmed" : "Unconfirmed"}</p>
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-500">No receipt linked yet</p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-2">
                                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone}`}>
                                    {status === "captured"
                                      ? "Captured"
                                      : status === "matched_tenant"
                                      ? "Tenant matched"
                                      : status === "duplicate"
                                      ? "Duplicate"
                                      : "Needs capture"}
                                  </span>
                                  <p className="text-xs text-slate-500">{String(row?.source || "").replace(/_/g, " ") || "manual batch"}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                {matchedReceipt ? (
                                  <button
                                    onClick={() => navigate(`/receipts/${matchedReceipt._id || matchedReceipt.id || ""}`)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700 hover:bg-emerald-100"
                                  >
                                    <FaCheckCircle /> Open receipt
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => openReceiptCapture(row)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 hover:bg-slate-50"
                                  >
                                    <FaReceipt /> Capture receipt
                                  </button>
                                )}
                                {matchedTenant && !matchedReceipt && (
                                  <p className="mt-2 text-[11px] text-slate-500">Tenant linked by tenant code / phone.</p>
                                )}
                                {!matchedTenant && !matchedReceipt && (
                                  <p className="mt-2 text-[11px] text-amber-700">No tenant match yet. Review before saving.</p>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default MpesaBatchImport;
