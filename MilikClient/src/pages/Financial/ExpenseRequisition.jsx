import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDebounce from "../../hooks/useDebounce";
import {
  FaCheck,
  FaEdit,
  FaExternalLinkAlt,
  FaFileInvoiceDollar,
  FaPlus,
  FaSave,
  FaSearch,
  FaSquare,
  FaTrash,
  FaTimes,
  FaUndo,
  FaRedoAlt,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { useConfirm } from "../../context/ConfirmContext";
import {
  createExpenseRequisition,
  deleteExpenseRequisition,
  getExpenseRequisitions,
  getServiceProviders,
  updateExpenseRequisition,
  updateExpenseRequisitionStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { hasCompanyPermission } from "../../utils/permissions";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';

const DEFAULT_PAGE_SIZE = 50;

const todayIso = () => new Date().toISOString().split("T")[0];

const blankForm = {
  title: "",
  description: "",
  amount: "",
  requestDate: todayIso(),
  neededBy: "",
  priority: "normal",
  category: "general",
  property: "",
  serviceProvider: "",
  notes: "",
  status: "draft",
};

const statusPill = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  submitted: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  converted: "bg-violet-100 text-violet-700 border-violet-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
  cancelled: "bg-amber-100 text-amber-700 border-amber-200",
};

const ExpenseRequisition = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const properties = useSelector(selectAllProperties);

  const [rows, setRows] = useState([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [pageSize, setPageSize] = useTabState("/accounts/expenses:pageSize", DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useTabState("/accounts/expenses:currentPage", 1);
  const [filters, setFilters] = useTabState("/accounts/expenses:filters", { search: "", status: "all", propertyId: "all" });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const debouncedSearch = useDebounce(filters.search, 400);
  const [form, setForm] = useState(blankForm);
  const [statusModal, setStatusModal] = useState({ open: false, row: null, status: "", reason: "", loading: false });

  const canCreate  = hasCompanyPermission(currentUser, currentCompany, "expenses", "create", "accounts");
  const canUpdate  = hasCompanyPermission(currentUser, currentCompany, "expenses", "update", "accounts");
  const canDelete  = hasCompanyPermission(currentUser, currentCompany, "expenses", "delete", "accounts");
  const canApprove = hasCompanyPermission(currentUser, currentCompany, "expenses", "approve", "accounts");

  const _uid = currentUser?._id || currentUser?.id;
  const _erDraftKey = (currentCompany?._id && _uid) ? `milik:draft:expense-req:${currentCompany._id}:${_uid}` : null;
  const _erDraftRestored = useRef(false);

  useEffect(() => {
    if (!_erDraftKey || _erDraftRestored.current) return;
    _erDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_erDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setForm(s); setShowModal(true); } }
    } catch {}
  }, [_erDraftKey]);

  useEffect(() => {
    if (!_erDraftKey || !_erDraftRestored.current || !showModal || editingId) return;
    try { window.sessionStorage.setItem(_erDraftKey, JSON.stringify({ form })); } catch {}
  }, [_erDraftKey, form, showModal, editingId]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
  }, [dispatch, currentCompany?._id]);

  const loadRows = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const params = {
        business: currentCompany._id,
        company: currentCompany._id,
        page: currentPage,
        limit: pageSize,
        search: debouncedSearch || undefined,
        status: filters.status !== "all" ? filters.status : undefined,
        propertyId: filters.propertyId !== "all" ? filters.propertyId : undefined,
      };
      const res = await getExpenseRequisitions(params);
      const data = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setRows(data);
      setServerTotal(res?.total ?? data.length);
      setServerPages(res?.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load expense requisitions");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, currentPage, pageSize, debouncedSearch, filters.status, filters.propertyId]);

  useEffect(() => { loadRows(); }, [loadRows]);
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, filters.status, filters.propertyId, pageSize]);

  useEffect(() => {
    if (!currentCompany?._id) return;
    getServiceProviders({ business: currentCompany._id, company: currentCompany._id })
      .then((data) => setProviders(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [currentCompany?._id]);

  const totalPages = Math.max(1, serverPages);
  const currentPageRows = rows; // server returns the correct page slice

  const stats = useMemo(
    () => ({
      total: serverTotal,
      submitted: rows.filter((row) => row.status === "submitted").length,
      approvedReady: rows.filter((row) => row.status === "approved" && !row.linkedVoucher).length,
      converted: rows.filter((row) => row.status === "converted").length,
    }),
    [rows, serverTotal]
  );

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.length === rows.length ? [] : rows.map((row) => row._id)
    );
  };

  const closeModal = () => {
    if (_erDraftKey) { try { window.sessionStorage.removeItem(_erDraftKey); } catch {} }
    setShowModal(false);
    setEditingId("");
  };

  const openCreate = () => {
    if (!canCreate) { toast.warning("You don't have permission to create expense requisitions"); return; }
    setEditingId("");
    setForm(blankForm);
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canUpdate) { toast.warning("You don't have permission to edit expense requisitions"); return; }
    setEditingId(row._id);
    setForm({
      title: row.title || "",
      description: row.description || "",
      amount: row.amount || "",
      requestDate: row.requestDate ? new Date(row.requestDate).toISOString().split("T")[0] : todayIso(),
      neededBy: row.neededBy ? new Date(row.neededBy).toISOString().split("T")[0] : "",
      priority: row.priority || "normal",
      category: row.category || "general",
      property: row.property?._id || row.property || "",
      serviceProvider: row.serviceProvider?._id || row.serviceProvider || "",
      notes: row.notes || "",
      status: row.status || "draft",
    });
    setShowModal(true);
  };

  const buildVoucherPrefill = (row) => ({
    category: ["maintenance", "repair"].includes(String(row?.category || "").toLowerCase())
      ? "landlord_maintenance"
      : "landlord_other",
    propertyId: row?.property?._id || row?.property || "",
    amount: Number(row?.amount || 0),
    dueDate: row?.neededBy ? new Date(row.neededBy).toISOString().split("T")[0] : todayIso(),
    narration: [row?.title, row?.description].filter(Boolean).join(" - ").trim(),
    reference: row?.requisitionNo || row?.referenceNo || "",
    status: "draft",
    sourceRequisitionId: row?._id || "",
    sourceRequisitionNo: row?.requisitionNo || row?.referenceNo || "",
  });

  const handleSave = async (targetStatus = "draft") => {
    if (!form.title.trim()) {
      toast.warning("Requisition title is required");
      return;
    }
    if (!form.property) {
      toast.warning("Property is required");
      return;
    }
    if (!Number(form.amount || 0) || Number(form.amount) <= 0) {
      toast.warning("Valid amount is required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        status: targetStatus,
        amount: Number(form.amount),
        business: currentCompany?._id,
        company: currentCompany?._id,
      };
      const saved = editingId
        ? await updateExpenseRequisition(editingId, payload)
        : await createExpenseRequisition(payload);
      setRows((prev) => (editingId ? prev.map((row) => (row._id === editingId ? saved : row)) : [saved, ...prev]));
      closeModal();
      setForm(blankForm);
      toast.success(
        editingId
          ? targetStatus === "submitted"
            ? "Expense requisition updated and submitted for approval"
            : "Expense requisition draft updated"
          : targetStatus === "submitted"
            ? "Expense requisition submitted for approval"
            : "Expense requisition saved as draft"
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save expense requisition");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!canDelete) { toast.warning("You don't have permission to delete expense requisitions"); return; }
    if (!await confirm({ title: "Delete Requisition", message: `Delete requisition ${row.requisitionNo}?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      const response = await deleteExpenseRequisition(row._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      const deletedId = String(response?.deletedId || row._id || "");
      setRows((prev) => prev.filter((item) => String(item?._id || "") !== deletedId));
      setSelectedIds((prev) => prev.filter((id) => String(id || "") !== deletedId));
      toast.success(response?.message || "Expense requisition deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete expense requisition");
    }
  };

  const handleStatus = (row, status) => {
    if (status === "draft") {
      updateExpenseRequisitionStatus(row._id, { status, business: currentCompany?._id, company: currentCompany?._id })
        .then((saved) => {
          setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
          toast.success("Expense requisition moved back to draft");
        })
        .catch((error) => toast.error(error?.response?.data?.message || "Failed to update requisition"));
      return;
    }
    const defaultReason = status === "approved" ? (row?.approvalNote || "") : status === "rejected" ? (row?.rejectionReason || "") : (row?.cancellationReason || "Cancelled");
    setStatusModal({ open: true, row, status, reason: defaultReason, loading: false });
  };

  const handleStatusConfirm = async () => {
    const { row, status, reason } = statusModal;
    if (status === "rejected" && !String(reason || "").trim()) {
      toast.warning("Rejection reason is required");
      return;
    }
    const payload = { status, business: currentCompany?._id, company: currentCompany?._id };
    if (status === "approved") payload.approvalNote = reason;
    else payload.reason = reason;
    setStatusModal((prev) => ({ ...prev, loading: true }));
    try {
      const saved = await updateExpenseRequisitionStatus(row._id, payload);
      setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
      toast.success(`Requisition ${status}`);
      setStatusModal({ open: false, row: null, status: "", reason: "", loading: false });
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to mark requisition ${status}`);
      setStatusModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleBulkDelete = async () => {
    if (!canDelete) { toast.warning("You don't have permission to delete expense requisitions"); return; }
    if (selectedIds.length === 0) {
      toast.info("Select requisitions first");
      return;
    }
    if (!await confirm({ title: "Delete Requisitions", message: `Delete ${selectedIds.length} selected requisitions?`, confirmText: "Delete", isDangerous: true })) return;
    for (const id of selectedIds) {
      const row = rows.find((item) => item._id === id);
      if (!row) continue;
      if (!["draft", "rejected", "cancelled"].includes(String(row.status || ""))) continue;
      // eslint-disable-next-line no-await-in-loop
      await deleteExpenseRequisition(id, { business: currentCompany?._id, company: currentCompany?._id }).catch(() => null);
    }
    await loadRows();
    setSelectedIds([]);
    toast.success("Selected eligible requisitions cleaned up");
  };

  const handleCreateVoucher = (row) => {
    navigate("/expenses/payment-vouchers", {
      state: {
        openCreate: true,
        prefill: buildVoucherPrefill(row),
      },
    });
  };

  const openLinkedVoucher = (row) => {
    navigate("/expenses/payment-vouchers", {
      state: {
        search: row?.linkedVoucher?.voucherNo || row?.requisitionNo || "",
      },
    });
  };

  const renderActions = (row) => {
    const rowStatus = String(row?.status || "draft");
    return (
      <div className="inline-flex flex-wrap justify-end gap-2">
        {rowStatus === "draft" && (
          <>
            <button
              onClick={() => openEdit(row)}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"
            >
              <FaEdit /> Edit
            </button>
            <button
              onClick={() => handleStatus(row, "submitted")}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"
            >
              <FaCheck /> Submit
            </button>
            <button
              onClick={() => handleDelete(row)}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700"
            >
              <FaTrash /> Delete
            </button>
          </>
        )}

        {rowStatus === "submitted" && (
          <>
            {canApprove && (
              <button
                onClick={() => handleStatus(row, "approved")}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"
              >
                <FaCheck /> Approve
              </button>
            )}
            {canApprove && (
              <button
                onClick={() => handleStatus(row, "rejected")}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700"
              >
                <FaTimes /> Reject
              </button>
            )}
            {canUpdate && (
              <button
                onClick={() => handleStatus(row, "draft")}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700"
              >
                <FaUndo /> Recall
              </button>
            )}
          </>
        )}

        {rowStatus === "approved" && !row.linkedVoucher && (
          <button
            onClick={() => handleCreateVoucher(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700"
          >
            <FaFileInvoiceDollar /> Create Voucher
          </button>
        )}

        {row.linkedVoucher && (
          <button
            onClick={() => openLinkedVoucher(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700"
          >
            <FaExternalLinkAlt /> Voucher
          </button>
        )}

        {["rejected", "cancelled"].includes(rowStatus) && (
          <>
            <button
              onClick={() => handleStatus(row, "draft")}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700"
            >
              <FaUndo /> Reopen Draft
            </button>
            <button
              onClick={() => handleDelete(row)}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700"
            >
              <FaTrash /> Delete
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">Selected: {selectedIds.length}</span>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <div className="relative shrink-0">
                  <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={setFilter("search")}
                    placeholder="Requisition no, title, category"
                    className="h-7 w-48 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  />
                </div>
                <AppSelect
                  value={filters.propertyId !== "all" ? filters.propertyId : ""}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "all" }))}
                  options={properties.map((p) => ({ value: p._id, label: `${p.propertyCode ? `[${p.propertyCode}] ` : ""}${p.propertyName || p.name}` }))}
                  placeholder="All properties"
                  size="sm"
                  clearable
                  searchable
                />
                <AppSelect
                  value={filters.status !== "all" ? filters.status : ""}
                  onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "all" }))}
                  options={[
                    { value: "draft", label: "Draft" },
                    { value: "submitted", label: "Submitted" },
                    { value: "approved", label: "Approved" },
                    { value: "converted", label: "Converted" },
                    { value: "rejected", label: "Rejected" },
                    { value: "cancelled", label: "Cancelled" },
                  ]}
                  placeholder="All statuses"
                  size="sm"
                  clearable
                />
                <button onClick={() => setFilters({ search: "", status: "all", propertyId: "all" })} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><FaUndo size={9} /> Reset</button>
                <button onClick={loadRows} className="h-7 shrink-0 flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><FaRedoAlt size={9} /></button>
                <button onClick={handleBulkDelete} disabled={!canDelete} className="h-7 shrink-0 flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"><FaTrash size={9} /> Delete</button>
                <button onClick={openCreate} disabled={!canCreate} className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#FF8C00] px-2.5 text-xs font-semibold text-white hover:bg-[#e67e00] disabled:cursor-not-allowed disabled:bg-slate-300"><FaPlus size={9} /> New Requisition</button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1120px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-1 text-left font-black border-r border-white/10"><button type="button" onClick={toggleSelectAll}>{selectedIds.length === rows.length && rows.length > 0 ? <FaCheck className="text-white" /> : <FaSquare className="text-white/80" />}</button></th>
                    <th className="px-3 py-1 text-left font-black border-r border-white/10">Requisition</th>
                    <th className="px-3 py-1 text-left font-black border-r border-white/10">Property / Provider</th>
                    <th className="px-3 py-1 text-left font-black border-r border-white/10">Needed By</th>
                    <th className="px-3 py-1 text-right font-black border-r border-white/10">Amount</th>
                    <th className="px-3 py-1 text-left font-black border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-right font-black">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Loading requisitions...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">No expense requisitions found.</td></tr>
                  ) : (
                    currentPageRows.map((row, index) => (
                      <tr key={row._id} className={`border-b border-gray-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/60"} hover:bg-blue-50/40`}>
                        <td className="px-3 py-1 border-r border-gray-100"><button type="button" onClick={() => toggleSelect(row._id)}>{selectedIds.includes(row._id) ? <FaCheck className="text-[#0B3B2E]" /> : <FaSquare className="text-slate-400" />}</button></td>
                        <td className="px-3 py-1 border-r border-gray-100"><div className="font-black text-slate-900">{row.requisitionNo}</div><div className="text-[10px] text-slate-500">{row.title}</div>{row.linkedVoucher?.voucherNo ? <div className="mt-1 text-[10px] font-bold text-violet-600">Voucher: {row.linkedVoucher.voucherNo}</div> : null}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700"><div className="font-medium text-slate-900">{row.property?.propertyName || row.property?.name || "No property"}</div><div className="text-[10px] text-slate-500">{row.serviceProvider?.name || row.vendorName || "No provider"}</div></td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.neededBy ? new Date(row.neededBy).toLocaleDateString() : "-"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">KES {Number(row.amount || 0).toLocaleString()}</td>
                        <td className="px-3 py-1 border-r border-gray-100"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusPill[row.status] || statusPill.draft}`}>{row.status}</span></td>
                        <td className="px-3 py-1 text-right">{renderActions(row)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={currentPage}
              pages={totalPages}
              total={serverTotal}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="requisitions"
            />
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/45 px-3 py-2 sm:items-center sm:p-6">
          <div className="flex w-full max-w-5xl max-h-[calc(100vh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
            <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Expense Requisition</p>
                <h3 className="text-xl font-black">{editingId ? "Edit Draft Requisition" : "New Requisition"}</h3>
              </div>
              <button onClick={closeModal} className="rounded-full border border-white/30 p-2 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="grid gap-2 p-6 md:grid-cols-2 xl:grid-cols-3">
              <label className="block xl:col-span-2"><span className="mb-0.5 block text-xs font-semibold text-slate-700">Title <span className="text-red-500">*</span></span><input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="mb-0.5 block text-xs font-semibold text-slate-700">Amount <span className="text-red-500">*</span></span><input type="number" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" /></label>
              <AppSelect
                label="Property"
                value={form.property}
                onChange={(v) => setForm((prev) => ({ ...prev, property: v ?? "" }))}
                options={properties.map((p) => ({ value: p._id, label: `${p.propertyCode ? `[${p.propertyCode}] ` : ""}${p.propertyName || p.name}` }))}
                placeholder="Select property"
                size="md"
                searchable
              />
              <AppSelect
                label="Service Provider"
                value={form.serviceProvider}
                onChange={(v) => setForm((prev) => ({ ...prev, serviceProvider: v ?? "" }))}
                options={providers.map((p) => ({ value: p._id, label: `${p.providerCode} - ${p.name}` }))}
                placeholder="Select provider"
                size="md"
                searchable
                clearable
              />
              <AppSelect
                label="Priority"
                value={form.priority}
                onChange={(v) => setForm((prev) => ({ ...prev, priority: v ?? "normal" }))}
                options={[
                  { value: "low", label: "Low" },
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "High" },
                  { value: "urgent", label: "Urgent" },
                ]}
                size="md"
              />
              <AppSelect
                label="Category"
                value={form.category}
                onChange={(v) => setForm((prev) => ({ ...prev, category: v ?? "general" }))}
                options={[
                  { value: "general", label: "General" },
                  { value: "maintenance", label: "Maintenance" },
                  { value: "repair", label: "Repair" },
                  { value: "utility", label: "Utility" },
                  { value: "tax", label: "Tax" },
                  { value: "insurance", label: "Insurance" },
                  { value: "supplies", label: "Supplies" },
                  { value: "other", label: "Other" },
                ]}
                size="md"
              />
              <label className="block"><span className="mb-0.5 block text-xs font-semibold text-slate-700">Request Date</span><input type="date" value={form.requestDate} onChange={(e) => setForm((prev) => ({ ...prev, requestDate: e.target.value }))} className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="mb-0.5 block text-xs font-semibold text-slate-700">Needed By</span><input type="date" value={form.neededBy} onChange={(e) => setForm((prev) => ({ ...prev, neededBy: e.target.value }))} className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-3"><span className="mb-0.5 block text-xs font-semibold text-slate-700">Description</span><textarea rows={3} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-3"><span className="mb-0.5 block text-xs font-semibold text-slate-700">Internal Notes</span><textarea rows={2} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" /></label>
            </div>
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm">
              <button onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleSave("draft")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><FaSave /> {saving ? "Saving..." : editingId ? "Update Draft" : "Save Draft"}</button>
              <button onClick={() => handleSave("submitted")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"><FaCheck /> {saving ? "Saving..." : editingId ? "Update & Submit" : "Save & Submit"}</button>
            </div>
          </div>
        </div>
      )}

      {statusModal.open && (() => {
        const isApprove  = statusModal.status === "approved";
        const isReject   = statusModal.status === "rejected";
        const headerCls  = isApprove ? "bg-emerald-700" : isReject ? "bg-red-700" : "bg-amber-700";
        const btnCls     = isApprove ? "bg-emerald-600 hover:bg-emerald-700" : isReject ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700";
        const bannerCls  = isApprove ? "bg-emerald-50 border-emerald-200 text-emerald-800" : isReject ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800";
        const iconCls    = isApprove ? "text-emerald-500" : isReject ? "text-red-500" : "text-amber-500";
        const Icon       = isApprove ? FaCheck : FaUndo;
        const label      = isApprove ? "Approve Requisition" : isReject ? "Reject Requisition" : "Cancel Requisition";
        const fieldLabel = isApprove ? "Approval Note (optional)" : isReject ? "Rejection Reason *" : "Cancellation Reason";
        const btnLabel   = isApprove ? "Approve" : isReject ? "Reject" : "Cancel Requisition";
        const banner     = isApprove ? "Approving clears this requisition for payment settlement." : isReject ? "Rejecting will notify the requester. A reason is required." : "This will cancel the requisition. This action cannot be undone.";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className={`${headerCls} px-6 py-4 flex items-center gap-3`}>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                  <Icon className="text-white text-sm" />
                </div>
                <div>
                  <h2 className="text-white font-semibold text-base leading-tight">{label}</h2>
                  <p className="text-white/60 text-xs mt-0.5">{statusModal.row?.requisitionNumber || ""}</p>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${bannerCls}`}>
                  <FaRedoAlt className={`mt-0.5 shrink-0 ${iconCls}`} />
                  <p className="text-sm">{banner}</p>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">{fieldLabel}</label>
                  <textarea
                    rows={3}
                    autoFocus
                    className="w-full resize-none rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                    placeholder={isApprove ? "Optional approval note…" : isReject ? "Required — reason for rejection…" : "Reason for cancellation…"}
                    value={statusModal.reason}
                    onChange={(e) => setStatusModal((prev) => ({ ...prev, reason: e.target.value }))}
                    disabled={statusModal.loading}
                  />
                </div>
              </div>
              <div className="px-6 pb-5 flex justify-end gap-3">
                <button onClick={() => setStatusModal({ open: false, row: null, status: "", reason: "", loading: false })} disabled={statusModal.loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">Cancel</button>
                <button onClick={handleStatusConfirm} disabled={statusModal.loading} className={`rounded-lg ${btnCls} px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60 flex items-center gap-2`}>
                  {statusModal.loading ? <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Saving…</> : <><Icon className="text-xs" />{btnLabel}</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </DashboardLayout>
  );
};

export default ExpenseRequisition;
