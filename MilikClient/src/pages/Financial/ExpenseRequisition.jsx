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
  batchDeleteExpenseRequisitions,
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
import CurrencyInput from "../../components/common/CurrencyInput";
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';
import Modal from "../../components/common/Modal";
import { useTerms } from "../../hooks/useTerm";

const DEFAULT_PAGE_SIZE = 50;

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const Section = ({ title, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const FOOTER_VARIANTS = {
  default: "bg-[#0B3B2E] hover:bg-[#0A3127]",
  danger: "bg-red-600 hover:bg-red-700",
  amber: "bg-amber-600 hover:bg-amber-700",
  success: "bg-emerald-600 hover:bg-emerald-700",
};

const ModalFooter = ({ onCancel, submitting, submitLabel, savingLabel, formId, variant = "default", cancelLabel = "Cancel" }) => (
  <div className="flex items-center justify-end gap-2">
    <button type="button" onClick={onCancel} disabled={submitting} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      {cancelLabel}
    </button>
    <button type="submit" form={formId} disabled={submitting}
      className={`inline-flex h-8 items-center gap-1.5 px-4 text-xs font-black text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${FOOTER_VARIANTS[variant] || FOOTER_VARIANTS.default}`}>
      {submitting ? savingLabel : submitLabel}
    </button>
  </div>
);

const ActionIcon = ({ icon: Icon, title, onClick, danger }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`p-1 ${danger ? "text-red-600 hover:bg-red-50 hover:text-red-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
  >
    <Icon size={12} />
  </button>
);

const todayIso = () => new Date().toISOString().split("T")[0];
const fmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const { property: termProperty } = useTerms("property");
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
  const debouncedForm = useDebounce(form, 400);

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
    try { window.sessionStorage.setItem(_erDraftKey, JSON.stringify({ form: debouncedForm })); } catch {}
  }, [_erDraftKey, debouncedForm, showModal, editingId]);

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

  const stats = useMemo(
    () => ({
      total: serverTotal,
      submitted: rows.filter((row) => row.status === "submitted").length,
      approvedReady: rows.filter((row) => row.status === "approved" && !row.linkedVoucher).length,
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
      toast.warning(`${termProperty} is required`);
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
    try {
      const response = await batchDeleteExpenseRequisitions(selectedIds, {
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      const succeededCount = response?.succeededCount ?? response?.succeeded?.length ?? 0;
      const failedCount = response?.failedCount ?? response?.failed?.length ?? 0;

      await loadRows();
      setSelectedIds([]);

      if (succeededCount > 0 && failedCount === 0) {
        toast.success(`${succeededCount} requisition${succeededCount > 1 ? "s" : ""} deleted successfully.`);
      } else if (succeededCount > 0 && failedCount > 0) {
        toast.warn(`${succeededCount} deleted, ${failedCount} skipped (not eligible for deletion).`);
      } else {
        toast.info("No selected requisitions were eligible for deletion.");
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete selected requisitions");
    }
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
      <div className="flex items-center justify-end gap-1">
        {rowStatus === "draft" && (
          <>
            <ActionIcon icon={FaEdit} title="Edit" onClick={() => openEdit(row)} />
            <ActionIcon icon={FaCheck} title="Submit for approval" onClick={() => handleStatus(row, "submitted")} />
            <ActionIcon icon={FaTrash} title="Delete" danger onClick={() => handleDelete(row)} />
          </>
        )}

        {rowStatus === "submitted" && (
          <>
            {canApprove && <ActionIcon icon={FaCheck} title="Approve" onClick={() => handleStatus(row, "approved")} />}
            {canApprove && <ActionIcon icon={FaTimes} title="Reject" onClick={() => handleStatus(row, "rejected")} />}
            {canUpdate && <ActionIcon icon={FaUndo} title="Recall to draft" onClick={() => handleStatus(row, "draft")} />}
          </>
        )}

        {rowStatus === "approved" && !row.linkedVoucher && (
          <ActionIcon icon={FaFileInvoiceDollar} title="Create payment voucher" onClick={() => handleCreateVoucher(row)} />
        )}

        {row.linkedVoucher && (
          <ActionIcon icon={FaExternalLinkAlt} title="View linked voucher" onClick={() => openLinkedVoucher(row)} />
        )}

        {["rejected", "cancelled"].includes(rowStatus) && (
          <>
            <ActionIcon icon={FaUndo} title="Reopen as draft" onClick={() => handleStatus(row, "draft")} />
            <ActionIcon icon={FaTrash} title="Delete" danger onClick={() => handleDelete(row)} />
          </>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
            <ListToolbar>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Requisitions: {stats.total}</span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Submitted: {stats.submitted}</span>
              {stats.approvedReady > 0 && (
                <span className="shrink-0 border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Ready to Pay: {stats.approvedReady}</span>
              )}

              <ListToolbar.Divider />

              <div className="relative shrink-0">
                <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
                <ListToolbar.Input
                  value={filters.search}
                  onChange={setFilter("search")}
                  placeholder="Requisition no, title, category"
                  width="w-48"
                  className="pl-5"
                />
              </div>
              <AppSelect
                value={filters.propertyId !== "all" ? filters.propertyId : ""}
                onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "all" }))}
                options={properties.map((p) => ({ value: p._id, label: `${p.propertyCode ? `[${p.propertyCode}] ` : ""}${p.propertyName || p.name}` }))}
                placeholder="All properties"
                compact
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
                compact
                clearable
              />

              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaUndo} variant="outline" onClick={() => setFilters({ search: "", status: "all", propertyId: "all" })}>Reset</ListToolbar.Button>
              <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={loadRows} title="Refresh" />

              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaTrash} variant="danger" disabled={!canDelete || selectedIds.length === 0} onClick={handleBulkDelete}>Delete</ListToolbar.Button>

              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaPlus} disabled={!canCreate} onClick={openCreate}>New Requisition</ListToolbar.Button>
            </ListToolbar>

            <MilikTable
              columns={[
                { label: "Requisition" },
                { label: `${termProperty} / Provider` },
                { label: "Needed By" },
                { label: "Amount", align: "right" },
                { label: "Status" },
              ]}
              rows={rows}
              rowKey="_id"
              loading={loading && rows.length === 0}
              empty="No expense requisitions found."
              minWidth="1120px"
              checkboxes
              allChecked={selectedIds.length === rows.length && rows.length > 0}
              someChecked={selectedIds.length > 0 && selectedIds.length < rows.length}
              onCheckAll={toggleSelectAll}
              isChecked={(row) => selectedIds.includes(row._id)}
              isSelected={(row) => selectedIds.includes(row._id)}
              onCheckRow={(row) => toggleSelect(row._id)}
              renderRow={(row) => (
                <>
                  <td className="px-3 py-1 border-r border-gray-100"><div className="font-black text-slate-900">{row.requisitionNo}</div><div className="text-[10px] text-slate-500">{row.title}</div>{row.linkedVoucher?.voucherNo ? <div className="mt-1 text-[10px] font-bold text-violet-600">Voucher: {row.linkedVoucher.voucherNo}</div> : null}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-slate-700"><div className="font-medium text-slate-900">{row.property?.propertyName || row.property?.name || `No ${termProperty.toLowerCase()}`}</div><div className="text-[10px] text-slate-500">{row.serviceProvider?.name || row.vendorName || "No provider"}</div></td>
                  <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.neededBy ? new Date(row.neededBy).toLocaleDateString() : "-"}</td>
                  <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-bold text-slate-900">KES {fmt(row.amount)}</td>
                  <td className="px-3 py-1 border-r border-gray-100"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusPill[row.status] || statusPill.draft}`}>{row.status}</span></td>
                </>
              )}
              renderActions={renderActions}
            />
            <PaginationBar
              page={currentPage}
              pages={totalPages}
              total={serverTotal}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="requisitions"
              leftExtra={selectedIds.length > 0 && (
                <span className="shrink-0 border border-[#0B3B2E] bg-[#F1F6F3] px-1.5 py-0.5 text-[10px] font-bold text-[#0B3B2E]">Selected {selectedIds.length}</span>
              )}
            />
          </div>
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? "Edit Draft Requisition" : "New Requisition"}
          icon={<FaFileInvoiceDollar size={12} />}
          onClose={closeModal}
          size="extraWide"
          footer={
            <>
              <button type="button" onClick={closeModal} disabled={saving} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => handleSave("draft")} disabled={saving} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                <FaSave size={10} /> {saving ? "Saving…" : editingId ? "Update Draft" : "Save Draft"}
              </button>
              <button type="button" onClick={() => handleSave("submitted")} disabled={saving} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
                <FaCheck size={10} /> {saving ? "Saving…" : editingId ? "Update & Submit" : "Save & Submit"}
              </button>
            </>
          }
        >
          <div className="space-y-2.5">
            <Section title="Requisition Details">
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <label className={labelClass}>Title<Required /></label>
                    <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Amount<Required /></label>
                    <CurrencyInput value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <AppSelect
                    label={termProperty}
                    value={form.property}
                    onChange={(v) => setForm((prev) => ({ ...prev, property: v ?? "" }))}
                    options={properties.map((p) => ({ value: p._id, label: `${p.propertyCode ? `[${p.propertyCode}] ` : ""}${p.propertyName || p.name}` }))}
                    placeholder="Select property"
                    size="sm"
                    searchable
                  />
                  <AppSelect
                    label="Service Provider"
                    value={form.serviceProvider}
                    onChange={(v) => setForm((prev) => ({ ...prev, serviceProvider: v ?? "" }))}
                    options={providers.map((p) => ({ value: p._id, label: `${p.providerCode} - ${p.name}` }))}
                    placeholder="Select provider"
                    size="sm"
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
                    size="sm"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
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
                    size="sm"
                  />
                  <div>
                    <label className={labelClass}>Request Date</label>
                    <input type="date" value={form.requestDate} onChange={(e) => setForm((prev) => ({ ...prev, requestDate: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Needed By</label>
                    <input type="date" value={form.neededBy} onChange={(e) => setForm((prev) => ({ ...prev, neededBy: e.target.value }))} className={inputClass} />
                  </div>
                </div>
              </div>
            </Section>
            <Section title="Additional Info">
              <div className="space-y-2.5">
                <div>
                  <label className={labelClass}>Description</label>
                  <textarea rows={3} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} className={`${inputClass.replace("h-7", "h-auto")} py-1.5`} />
                </div>
                <div>
                  <label className={labelClass}>Internal Notes</label>
                  <textarea rows={2} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className={`${inputClass.replace("h-7", "h-auto")} py-1.5`} />
                </div>
              </div>
            </Section>
          </div>
        </Modal>
      )}

      {statusModal.open && (() => {
        const isApprove  = statusModal.status === "approved";
        const isReject   = statusModal.status === "rejected";
        const variant    = isApprove ? "success" : isReject ? "danger" : "amber";
        const bannerCls  = isApprove ? "border-emerald-200 bg-emerald-50 text-emerald-800" : isReject ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800";
        const label      = isApprove ? "Approve Requisition" : isReject ? "Reject Requisition" : "Cancel Requisition";
        const fieldLabel = isApprove ? "Approval Note (optional)" : isReject ? "Rejection Reason" : "Cancellation Reason";
        const btnLabel   = isApprove ? "Approve" : isReject ? "Reject" : "Cancel Requisition";
        const banner     = isApprove ? "Approving clears this requisition for payment settlement." : isReject ? "Rejecting will notify the requester. A reason is required." : "This will cancel the requisition. This action cannot be undone.";
        const closeStatusModal = () => setStatusModal({ open: false, row: null, status: "", reason: "", loading: false });
        return (
          <Modal
            title={label}
            icon={isApprove ? <FaCheck size={12} /> : isReject ? <FaTimes size={12} /> : <FaUndo size={12} />}
            onClose={closeStatusModal}
            footer={<ModalFooter onCancel={closeStatusModal} submitting={statusModal.loading} submitLabel={btnLabel} savingLabel="Saving…" formId="expense-status-form" variant={variant} cancelLabel="Cancel" />}
          >
            <form id="expense-status-form" onSubmit={(e) => { e.preventDefault(); handleStatusConfirm(); }} className="space-y-2.5">
              <p className="text-xs font-bold text-slate-500">{statusModal.row?.requisitionNo || ""}</p>
              <div className={`border px-3 py-2 text-xs ${bannerCls}`}>{banner}</div>
              <div>
                <label className={labelClass}>{fieldLabel}{isReject && <Required />}</label>
                <textarea
                  rows={3}
                  autoFocus
                  className={`${inputClass.replace("h-7", "h-auto")} py-1.5`}
                  placeholder={isApprove ? "Optional approval note…" : isReject ? "Required — reason for rejection…" : "Reason for cancellation…"}
                  value={statusModal.reason}
                  onChange={(e) => setStatusModal((prev) => ({ ...prev, reason: e.target.value }))}
                  disabled={statusModal.loading}
                />
              </div>
            </form>
          </Modal>
        );
      })()}
    </DashboardLayout>
  );
};

export default ExpenseRequisition;
