import React, { useEffect, useMemo, useRef, useState } from "react";
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

const ITEMS_PER_PAGE = 50;

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
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const properties = useSelector((state) => state.property?.properties || []);

  const [rows, setRows] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", status: "all", propertyId: "all" });
  const [form, setForm] = useState(blankForm);

  const canCreate  = hasCompanyPermission(currentUser, currentCompany, "expenses", "create", "accounts");
  const canUpdate  = hasCompanyPermission(currentUser, currentCompany, "expenses", "update", "accounts");
  const canDelete  = hasCompanyPermission(currentUser, currentCompany, "expenses", "delete", "accounts");

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

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const [reqs, serviceProviders] = await Promise.all([
        getExpenseRequisitions({ business: currentCompany._id, company: currentCompany._id, ...filters }),
        getServiceProviders({ business: currentCompany._id, company: currentCompany._id }),
      ]);
      setRows(Array.isArray(reqs) ? reqs : []);
      setProviders(Array.isArray(serviceProviders) ? serviceProviders : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load expense requisitions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [currentCompany?._id, filters.search, filters.status]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (filters.propertyId !== "all") {
          const propertyId = String(row?.property?._id || row?.property || "");
          if (propertyId !== String(filters.propertyId || "")) return false;
        }
        return true;
      }),
    [rows, filters.propertyId]
  );


  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = filteredRows.length === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPageRows = filteredRows.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.status, filters.propertyId, filteredRows.length]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const stats = useMemo(
    () => ({
      total: filteredRows.length,
      submitted: filteredRows.filter((row) => row.status === "submitted").length,
      approvedReady: filteredRows.filter((row) => row.status === "approved" && !row.linkedVoucher).length,
      converted: filteredRows.filter((row) => row.status === "converted").length,
    }),
    [filteredRows]
  );

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.length === filteredRows.length ? [] : filteredRows.map((row) => row._id)
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
      await loadRows();
      toast.success(response?.message || "Expense requisition deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete expense requisition");
    }
  };

  const handleStatus = async (row, status) => {
    try {
      let payload = { status, business: currentCompany?._id, company: currentCompany?._id };

      if (status === "approved") {
        const approvalNote = window.prompt("Approval note (optional)", row?.approvalNote || "");
        if (approvalNote === null) return;
        payload = { ...payload, approvalNote };
      }

      if (status === "rejected") {
        const reason = window.prompt("Enter rejection reason", row?.rejectionReason || "");
        if (reason === null) return;
        if (!String(reason || "").trim()) {
          toast.warning("Rejection reason is required");
          return;
        }
        payload = { ...payload, reason };
      }

      if (status === "cancelled") {
        const reason = window.prompt("Enter cancellation reason", row?.cancellationReason || "Cancelled");
        if (reason === null) return;
        payload = { ...payload, reason };
      }

      const saved = await updateExpenseRequisitionStatus(row._id, payload);
      setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
      toast.success(
        status === "draft"
          ? "Expense requisition moved back to draft"
          : `Requisition ${status}`
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to mark requisition ${status}`);
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
            <button
              onClick={() => handleStatus(row, "approved")}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"
            >
              <FaCheck /> Approve
            </button>
            <button
              onClick={() => handleStatus(row, "rejected")}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700"
            >
              <FaTimes /> Reject
            </button>
            <button
              onClick={() => handleStatus(row, "draft")}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700"
            >
              <FaUndo /> Recall
            </button>
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
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search requisition no, title, description, category"
                    className="w-full rounded border border-gray-300 bg-[#DDEFE1] py-1.5 pl-9 pr-3 text-xs text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </div>

                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))}
                  className="rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All properties</option>
                  {properties.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.propertyCode ? `[${property.propertyCode}] ` : ""}
                      {property.propertyName || property.name}
                    </option>
                  ))}
                </select>

                <select
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="converted">Converted</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                <button onClick={() => setFilters({ search: "", status: "all", propertyId: "all" })} className="inline-flex items-center gap-2 rounded border border-gray-300 bg-[#DDEFE1] px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"><FaUndo /> Reset</button>
                <button onClick={loadRows} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-100"><FaRedoAlt /> Refresh</button>
                <button onClick={handleBulkDelete} disabled={!canDelete} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"><FaTrash /> Delete Selected</button>
                <button onClick={openCreate} disabled={!canCreate} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00] disabled:cursor-not-allowed disabled:bg-slate-300"><FaPlus /> New Requisition</button>

                <div className="ml-auto flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm">
                  Selected
                  <span className="text-xs text-slate-900">{selectedIds.length}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1120px] text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]"><button type="button" onClick={toggleSelectAll}>{selectedIds.length === filteredRows.length && filteredRows.length > 0 ? <FaCheck className="text-white" /> : <FaSquare className="text-white/80" />}</button></th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Requisition</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Property / Provider</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Needed By</th>
                    <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Amount</th>
                    <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Status</th>
                    <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">Loading requisitions...</td></tr>
                  ) : filteredRows.length === 0 ? (
                    <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">No expense requisitions found.</td></tr>
                  ) : (
                    currentPageRows.map((row, index) => (
                      <tr key={row._id} className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/40"} hover:bg-slate-50`}>
                        <td className="px-3 py-1.5"><button type="button" onClick={() => toggleSelect(row._id)}>{selectedIds.includes(row._id) ? <FaCheck className="text-[#0B3B2E]" /> : <FaSquare className="text-slate-400" />}</button></td>
                        <td className="px-3 py-1.5"><div className="font-black text-slate-900">{row.requisitionNo}</div><div className="text-xs text-slate-500">{row.title}</div>{row.linkedVoucher?.voucherNo ? <div className="mt-1 text-[11px] font-bold text-violet-600">Voucher: {row.linkedVoucher.voucherNo}</div> : null}</td>
                        <td className="px-3 py-1.5 text-slate-700"><div className="font-medium text-slate-900">{row.property?.propertyName || row.property?.name || "No property"}</div><div className="text-xs text-slate-500">{row.serviceProvider?.name || row.vendorName || "No provider"}</div></td>
                        <td className="px-3 py-1.5 text-slate-700">{row.neededBy ? new Date(row.neededBy).toLocaleDateString() : "-"}</td>
                        <td className="px-3 py-1.5 text-right font-black text-slate-900">KES {Number(row.amount || 0).toLocaleString()}</td>
                        <td className="px-3 py-1.5"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusPill[row.status] || statusPill.draft}`}>{row.status}</span></td>
                        <td className="px-3 py-1.5 text-right">{renderActions(row)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold">
                Showing <span className="font-bold text-slate-900">{filteredRows.length === 0 ? 0 : startIndex + 1}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, filteredRows.length)}</span> of <span className="font-bold text-slate-900">{filteredRows.length}</span> requisition(s)
              </div>
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
              <label className="block xl:col-span-2"><span className="text-xs font-bold text-slate-700">Title</span><input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Amount</span><input type="number" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Property</span><select value={form.property} onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select property</option>{properties.map((property) => <option key={property._id} value={property._id}>{property.propertyCode ? `[${property.propertyCode}] ` : ""}{property.propertyName || property.name}</option>)}</select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Service Provider</span><select value={form.serviceProvider} onChange={(e) => setForm((prev) => ({ ...prev, serviceProvider: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="">Select provider</option>{providers.map((provider) => <option key={provider._id} value={provider._id}>{provider.providerCode} - {provider.name}</option>)}</select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Priority</span><select value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Category</span><select value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"><option value="general">General</option><option value="maintenance">Maintenance</option><option value="repair">Repair</option><option value="utility">Utility</option><option value="tax">Tax</option><option value="insurance">Insurance</option><option value="supplies">Supplies</option><option value="other">Other</option></select></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Request Date</span><input type="date" value={form.requestDate} onChange={(e) => setForm((prev) => ({ ...prev, requestDate: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block"><span className="text-xs font-bold text-slate-700">Needed By</span><input type="date" value={form.neededBy} onChange={(e) => setForm((prev) => ({ ...prev, neededBy: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-3"><span className="text-xs font-bold text-slate-700">Description</span><textarea rows={3} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
              <label className="block xl:col-span-3"><span className="text-xs font-bold text-slate-700">Internal Notes</span><textarea rows={2} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20" /></label>
            </div>
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm">
              <button onClick={closeModal} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700">Cancel</button>
              <button onClick={() => handleSave("draft")} disabled={saving} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60"><FaSave /> {saving ? "Saving..." : editingId ? "Update Draft" : "Save Draft"}</button>
              <button onClick={() => handleSave("submitted")} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-3 py-2 text-xs font-black text-white disabled:opacity-60"><FaCheck /> {saving ? "Saving..." : editingId ? "Update & Submit" : "Save & Submit"}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default ExpenseRequisition;
