import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaCheck,
  FaMobileAlt,
  FaPlus,
  FaRedoAlt,
  FaReceipt,
  FaSearch,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenants } from "../../redux/tenantsRedux";
import {
  confirmRentPayment,
  createRentPayment,
  deleteMpesaCollection,
  deleteRentPayment,
  listMpesaCollections,
  reverseRentPayment,
} from "../../redux/apiCalls";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.tenants)) return value.tenants;
  return [];
};

const formatMoney = (value) => `Ksh ${Math.abs(Number(value || 0)).toLocaleString()}`;
const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};

const getTenantName = (tenant) =>
  tenant?.name || tenant?.tenantName || [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") || "Unmatched tenant";

const getUnitName = (tenant) => tenant?.unit?.unitNumber || "-";
const getPropertyName = (tenant) => tenant?.unit?.property?.propertyName || tenant?.property?.propertyName || "-";

const getMpesaConfigs = (company) => {
  const explicit = Array.isArray(company?.paymentIntegration?.mpesaPaybills)
    ? company.paymentIntegration.mpesaPaybills.filter(Boolean)
    : [];
  if (explicit.length > 0) return explicit;
  return company?.paymentIntegration?.mpesaPaybill ? [company.paymentIntegration.mpesaPaybill] : [];
};

const normalizeCode = (value = "") => String(value || "").trim().toLowerCase();

const ITEMS_PER_PAGE = 50;

const buildInstantReceiptDescription = (row) => {
  const accountRef = String(row?.accountReference || row?.billRefNumber || "").trim();
  const payer = String(row?.payerName || "").trim();
  return [
    "Captured from M-Pesa instant notification",
    accountRef ? `Account ref ${accountRef}` : "",
    payer ? `Payer ${payer}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
};

const InstantReceipts = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentCompany } = useSelector((state) => state.company || {});
  const tenants = ensureArray(useSelector((state) => state.tenant?.tenants));

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("callback_confirmation");
  const [selectedShortCode, setSelectedShortCode] = useState("");
  const [confirmModal, setConfirmModal] = useState({ open: false, row: null, tenantCode: "" });
  const [currentPage, setCurrentPage] = useState(1);

  const mpesaConfigs = useMemo(() => getMpesaConfigs(currentCompany), [currentCompany]);

  useEffect(() => {
    if (!selectedShortCode && mpesaConfigs.length > 0) {
      const preferred = mpesaConfigs.find((item) => item?.isActive) || mpesaConfigs.find((item) => item?.enabled) || mpesaConfigs[0];
      setSelectedShortCode(String(preferred?.shortCode || ""));
    }
  }, [mpesaConfigs, selectedShortCode]);

  const resolveReceivingCashbook = (row) => {
    const rowShortCode = String(row?.shortCode || "").trim();
    const primaryConfig = mpesaConfigs.find((item) => String(item?.shortCode || "").trim() === rowShortCode)
      || mpesaConfigs.find((item) => item?.isActive)
      || mpesaConfigs.find((item) => item?.enabled)
      || mpesaConfigs[0]
      || null;
    return primaryConfig?.defaultCashbookAccountName || "M-Pesa Collections";
  };

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      await dispatch(getTenants({ business: currentCompany._id })).unwrap();
      const response = await listMpesaCollections({
        business: currentCompany._id,
        shortCode: selectedShortCode || "",
        source: sourceFilter === "all" ? "" : sourceFilter,
      });
      setRows(ensureArray(response));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load instant receipts");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?._id, selectedShortCode, sourceFilter]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== "all" && String(row?.matchingStatus || "") !== statusFilter) return false;
      if (!search.trim()) return true;
      const haystack = [
        row?.transactionCode,
        row?.accountReference,
        row?.billRefNumber,
        row?.payerName,
        row?.msisdn,
        row?.tenant?.tenantCode,
        row?.tenant?.name,
        row?.matchedReceipt?.receiptNumber,
        row?.matchedReceipt?.referenceNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => {
    const captured = filteredRows.filter((row) => row?.matchedReceipt?._id).length;
    const unconfirmed = filteredRows.filter((row) => row?.matchedReceipt?._id && row?.matchedReceipt?.isConfirmed !== true).length;
    const unmatched = filteredRows.filter((row) => !row?.matchedReceipt?._id).length;
    const totalAmount = filteredRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0);
    return {
      count: filteredRows.length,
      totalAmount,
      captured,
      unconfirmed,
      unmatched,
    };
  }, [filteredRows]);


  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedRows = filteredRows.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, sourceFilter, selectedShortCode, rows.length]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const openAddReceipt = (row) => {
    const params = new URLSearchParams();
    if (row?.tenant?._id) params.set("tenant", row.tenant._id);
    if (row?.tenant?.tenantCode) params.set("tnt", row.tenant.tenantCode);
    if (row?.amount) params.set("amount", String(Math.abs(Number(row.amount || 0))));
    if (row?.transactionCode) params.set("reference", row.transactionCode);
    if (row?._id) params.set("collectionId", row._id);
    if (row?.accountReference) params.set("accountReference", row.accountReference);
    if (row?.msisdn) params.set("msisdn", row.msisdn);
    if (row?.payerName) params.set("payerName", row.payerName);
    params.set("paymentMethod", "mobile_money");
    params.set("mode", "instant");
    params.set("description", buildInstantReceiptDescription(row));
    navigate(`/receipts/new?${params.toString()}`);
  };

  const openConfirmModal = (row) => {
    setConfirmModal({
      open: true,
      row,
      tenantCode: String(row?.tenant?.tenantCode || row?.accountReference || "").trim(),
    });
  };

  const closeConfirmModal = () => {
    if (submitting) return;
    setConfirmModal({ open: false, row: null, tenantCode: "" });
  };

  const handleConfirmInstantReceipt = async () => {
    if (!confirmModal?.row || !currentCompany?._id) return;

    const row = confirmModal.row;
    const tenantCode = String(confirmModal.tenantCode || "").trim();
    if (!tenantCode) {
      toast.error("Tenant TNT code is required");
      return;
    }

    const tenant = tenants.find((item) => normalizeCode(item?.tenantCode) === normalizeCode(tenantCode));
    if (!tenant?._id) {
      toast.error("No tenant was found with that TNT code");
      return;
    }

    const unitId = tenant?.unit?._id || tenant?.unit;
    if (!unitId) {
      toast.error("The selected tenant has no linked unit");
      return;
    }

    setSubmitting(true);
    try {
      if (row?.matchedReceipt?._id) {
        const receiptTenantId = String(row?.matchedReceipt?.tenant?._id || row?.matchedReceipt?.tenant || "");
        if (receiptTenantId && receiptTenantId !== String(tenant._id)) {
          throw new Error("The existing instant receipt is already linked to a different tenant. Delete it first, then capture it again.");
        }
        await confirmRentPayment(dispatch, row.matchedReceipt._id, { business: currentCompany._id });
      } else {
        const paymentDate = row?.transactionDate ? new Date(row.transactionDate) : new Date();
        const paymentDateInput = Number.isNaN(paymentDate.getTime()) ? new Date() : paymentDate;
        const paymentDateValue = paymentDateInput.toISOString().split("T")[0];

        await createRentPayment(dispatch, {
          tenant: tenant._id,
          unit: unitId,
          amount: Math.abs(Number(row?.amount || 0)),
          paymentType: "rent",
          paymentMethod: "mobile_money",
          cashbook: resolveReceivingCashbook(row),
          paidDirectToLandlord: false,
          paymentDate: paymentDateValue,
          dueDate: paymentDateValue,
          bankingDate: paymentDateValue,
          recordDate: paymentDateValue,
          referenceNumber: String(row?.transactionCode || row?.accountReference || `MPESA-${Date.now()}`).trim(),
          description: buildInstantReceiptDescription(row),
          isConfirmed: true,
          ledgerType: "receipts",
          month: paymentDateInput.getMonth() + 1,
          year: paymentDateInput.getFullYear(),
          business: currentCompany._id,
          metadata: {
            mpesa: {
              collectionId: row?._id || null,
              transactionCode: row?.transactionCode || "",
              accountReference: row?.accountReference || row?.billRefNumber || "",
              msisdn: row?.msisdn || "",
              payerName: row?.payerName || "",
              source: row?.source || "callback_confirmation",
            },
          },
        });
      }

      toast.success("Instant receipt confirmed successfully");
      closeConfirmModal();
      await loadRows();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to confirm instant receipt");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row) => {
    if (!currentCompany?._id || !row?._id) return;
    setSubmitting(true);
    try {
      if (row?.matchedReceipt?._id) {
        if (row?.matchedReceipt?.isConfirmed) {
          throw new Error("Confirmed instant receipts cannot be deleted. Reverse them instead.");
        }
        await deleteRentPayment(dispatch, row.matchedReceipt._id);
      } else {
        await deleteMpesaCollection(row._id, { business: currentCompany._id });
      }
      toast.success("Instant receipt deleted successfully");
      await loadRows();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to delete instant receipt");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverse = async (row) => {
    if (!row?.matchedReceipt?._id) {
      toast.error("No captured receipt exists for this M-Pesa notification yet");
      return;
    }
    setSubmitting(true);
    try {
      await reverseRentPayment(dispatch, row.matchedReceipt._id, {
        reason: "Reversal of instant M-Pesa receipt",
      });
      toast.success("Instant receipt reversed successfully");
      await loadRows();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reverse instant receipt");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
              <button onClick={() => navigate("/tenants")} className="h-7 shrink-0 flex items-center gap-1 rounded px-2 text-[11px] font-semibold text-slate-600 hover:text-slate-900"><FaArrowLeft size={11} /> Back</button>
              <span className="shrink-0 text-xs font-black text-slate-900">Instant Receipts</span>
              <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
              <span className="shrink-0 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">{stats.count} Notifications</span>
              <span className="shrink-0 rounded border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">{formatMoney(stats.totalAmount)}</span>
              <span className="shrink-0 rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{stats.captured} Captured</span>
              <span className="shrink-0 rounded border border-orange-300 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">{stats.unconfirmed} Unconfirmed</span>
              <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{stats.unmatched} Pending</span>
              <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, tenant, TNT…" className="h-7 w-44 shrink-0 rounded border border-slate-300 px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              <select value={selectedShortCode} onChange={(e) => setSelectedShortCode(e.target.value)} className="h-7 shrink-0 rounded border border-slate-300 bg-white px-2 text-[11px] appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                <option value="">Paybill</option>
                {mpesaConfigs.map((config, index) => (<option key={config?._id || `${config?.shortCode || "mpesa"}-${index}`} value={config?.shortCode || ""}>{config?.name || `Paybill ${config?.shortCode || index + 1}`}{config?.shortCode ? ` · ${config.shortCode}` : ""}</option>))}
              </select>
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="h-7 shrink-0 rounded border border-slate-300 bg-white px-2 text-[11px] appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                <option value="callback_confirmation">Confirmations</option>
                <option value="callback_validation">Validations</option>
                <option value="manual_batch">Manual Batch</option>
                <option value="all">All Sources</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-7 shrink-0 rounded border border-slate-300 bg-white px-2 text-[11px] appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                <option value="all">All</option>
                <option value="captured">Captured</option>
                <option value="matched_tenant">Matched Tenant</option>
                <option value="unmatched">Unmatched</option>
              </select>
              <button onClick={loadRows} disabled={loading} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-60"><FaRedoAlt size={10} className={loading ? "animate-spin" : ""} /></button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white uppercase tracking-wide">
                    <th className="px-3 py-2 text-left">M-Pesa Code</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Tenant</th>
                    <th className="px-3 py-2 text-left">Property</th>
                    <th className="px-3 py-2 text-left">Unit</th>
                    <th className="px-3 py-2 text-left">TNT Code</th>
                    <th className="px-3 py-2 text-left">Receipt</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-4 py-10 text-center text-slate-500">
                        {loading ? "Loading instant receipts..." : "No instant receipt notifications found."}
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((row, index) => {
                      const matchedReceipt = row?.matchedReceipt || null;
                      const isConfirmed = matchedReceipt?.isConfirmed === true;
                      const canDelete = matchedReceipt?._id ? !isConfirmed : true;
                      const canReverse = Boolean(matchedReceipt?._id) && isConfirmed;
                      return (
                        <tr
                          key={row._id}
                          className={`border-b border-slate-200 ${index % 2 === 0 ? "bg-white" : "bg-slate-50"}`}
                        >
                          <td className="px-3 py-2 font-bold text-slate-900">{row?.transactionCode || row?.accountReference || "-"}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{formatDate(row?.transactionDate || row?.createdAt)}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            <div>{getTenantName(row?.tenant)}</div>
                            <div className="text-[10px] text-slate-500">{row?.payerName || row?.msisdn || "-"}</div>
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{getPropertyName(row?.tenant)}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{getUnitName(row?.tenant)}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{row?.tenant?.tenantCode || row?.accountReference || "-"}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {matchedReceipt ? (
                              <div>
                                <div>{matchedReceipt?.receiptNumber || matchedReceipt?.referenceNumber || "Receipt"}</div>
                                <div className="text-[10px] text-slate-500">{isConfirmed ? "Confirmed" : "Unconfirmed"}</div>
                              </div>
                            ) : (
                              <span className="text-slate-500">Not yet captured</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex px-2 py-1 rounded text-[10px] font-semibold ${
                                matchedReceipt
                                  ? isConfirmed
                                    ? "bg-green-100 text-green-700"
                                    : "bg-orange-100 text-orange-700"
                                  : row?.tenant?._id
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {matchedReceipt ? (isConfirmed ? "Confirmed" : "Unconfirmed") : row?.tenant?._id ? "Matched tenant" : "Unmatched"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(row?.amount || 0)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openAddReceipt(row)}
                                className={`px-2 py-1 rounded text-white text-[10px] font-semibold ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}
                              >
                                <FaPlus className="inline mr-1" /> Add Receipt
                              </button>
                              <button
                                type="button"
                                onClick={() => openConfirmModal(row)}
                                disabled={isConfirmed || submitting}
                                className={`px-2 py-1 rounded text-white text-[10px] font-semibold ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
                              >
                                <FaCheck className="inline mr-1" /> Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(row)}
                                disabled={!canDelete || submitting}
                                className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[10px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <FaTrash className="inline mr-1" /> Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReverse(row)}
                                disabled={!canReverse || submitting}
                                className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <FaUndo className="inline mr-1" /> Reverse
                              </button>
                              {matchedReceipt?._id && (
                                <button
                                  type="button"
                                  onClick={() => navigate(`/receipts/${matchedReceipt._id}`)}
                                  className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[10px] font-semibold"
                                >
                                  <FaReceipt className="inline mr-1" /> Open
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-2">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                <div className="font-semibold">Showing <span className="font-bold text-slate-900">{paginatedRows.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filteredRows.length)}</span> of <span className="font-bold text-slate-900">{filteredRows.length}</span> instant receipt rows</div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                  <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                  <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                  <button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-black text-slate-900">Confirm Instant Receipt</h3>
              <p className="mt-1 text-sm text-slate-600">
                Enter the tenant TNT code to confirm this instant M-Pesa notification into the normal receipt workflow.
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">M-Pesa code</div>
                  <div className="mt-1 text-sm font-bold text-slate-900">{confirmModal.row?.transactionCode || "-"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Amount</div>
                  <div className="mt-1 text-sm font-bold text-slate-900">{formatMoney(confirmModal.row?.amount || 0)}</div>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-700">Tenant TNT code</label>
                <input
                  value={confirmModal.tenantCode}
                  onChange={(e) => setConfirmModal((prev) => ({ ...prev, tenantCode: e.target.value }))}
                  placeholder="Example: TT0004"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/10"
                />
                <p className="mt-2 text-xs text-slate-500">
                  This uses the tenant code to resolve the tenant and unit before the receipt is confirmed.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeConfirmModal}
                disabled={submitting}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmInstantReceipt}
                disabled={submitting}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER} disabled:opacity-50`}
              >
                {submitting ? "Confirming..." : "Confirm instant receipt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default InstantReceipts;
