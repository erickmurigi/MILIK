import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDebounce from "../../hooks/useDebounce";
import {
  FaCalendarAlt,
  FaCheck,
  FaChevronDown,
  FaEdit,
  FaPause,
  FaPlay,
  FaPlus,
  FaSave,
  FaSearch,
  FaStop,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useConfirm } from "../../context/ConfirmContext";
import {
  createLandlordStandingOrder,
  deleteLandlordStandingOrder,
  getChartOfAccounts,
  getLandlordStandingOrders,
  getLandlords,
  reverseLandlordStandingOrderRun,
  runLandlordStandingOrder,
  updateLandlordStandingOrder,
  updateLandlordStandingOrderStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { propertyBelongsToLandlord } from "./propertyUtils";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectAllProperties } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import AppSelect from "../../components/common/AppSelect";

const ITEMS_PER_PAGE = 50;
const todayIso = () => new Date().toISOString().split("T")[0];

const blankForm = {
  landlord: "",
  property: "",
  title: "",
  narration: "",
  notes: "",
  amount: "",
  frequency: "monthly",
  dayOfMonth: new Date().getDate(),
  startDate: todayIso(),
  endDate: "",
  paymentMethod: "bank_transfer",
  cashbook: "",
  accountName: "",
  accountNumber: "",
  bankName: "",
  branchName: "",
  mobileNumber: "",
  status: "draft",
};

const statusPills = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  stopped: "bg-rose-100 text-rose-700",
};

const paymentMethodOptions = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

const frequencyOptions = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annually", label: "Semi-Annually" },
  { value: "yearly", label: "Yearly" },
];

const money = (value) => `KES ${Number(value || 0).toLocaleString()}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : "-");
const normalizePaymentMethod = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "mobile_money") return "mpesa";
  if (normalized === "check") return "cheque";
  return normalized || "bank_transfer";
};
const canUseDayOfMonth = (frequency) => String(frequency || "monthly") !== "weekly";
const frequencyLabel = (value) =>
  String(value || "monthly")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
const getLandlordLabel = (landlord) =>
  landlord?.landlordName || `${landlord?.firstName || ""} ${landlord?.lastName || ""}`.trim() || "Landlord";
const getCashbookLabel = (cashbook) =>
  cashbook?.name || cashbook?.accountName || cashbook?.code || cashbook?.accountCode || "Auto-resolve";

const getPaymentDestinationSummary = (row) => {
  const destination = row?.destination || {};
  const paymentMethod = normalizePaymentMethod(row?.paymentMethod);

  if (paymentMethod === "mpesa") {
    return destination.mobileNumber || "No destination mobile number set";
  }

  if (paymentMethod === "bank_transfer" || paymentMethod === "cheque") {
    return [destination.accountName, destination.bankName, destination.accountNumber]
      .filter(Boolean)
      .join(" • ") || "No bank destination configured";
  }

  return destination.accountName || destination.mobileNumber || destination.bankName || "General payout destination";
};

const validateForm = (form) => {
  if (!form.landlord) return "Landlord is required";
  if (!form.property) return "Property is required";
  if (!String(form.title || "").trim()) return "Standing order title is required";
  if (!Number(form.amount || 0) || Number(form.amount) <= 0) return "Valid amount is required";
  if (!form.startDate) return "Start date is required";
  if (form.endDate && new Date(form.endDate) < new Date(form.startDate)) {
    return "End date cannot be earlier than start date";
  }
  if (canUseDayOfMonth(form.frequency)) {
    const day = Number(form.dayOfMonth || 0);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return "Run day must be between 1 and 31";
    }
  }

  const paymentMethod = normalizePaymentMethod(form.paymentMethod);
  if (paymentMethod === "mpesa" && !String(form.mobileNumber || "").trim()) {
    return "Enter the M-Pesa destination mobile number";
  }
  if (["bank_transfer", "cheque"].includes(paymentMethod)) {
    if (!String(form.accountName || "").trim()) {
      return "Enter the payee account name";
    }
    if (!String(form.bankName || "").trim() && !String(form.accountNumber || "").trim()) {
      return "Enter the bank name or account number";
    }
  }

  return "";
};

const LandlordStandingOrders = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const landlords = useSelector(selectAllLandlords);
  const properties = useSelector(selectAllProperties);
  const activeLandlords = useMemo(
    () => landlords.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"),
    [landlords]
  );
  const activeProperties = useMemo(
    () => properties.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"),
    [properties]
  );

  const [rows, setRows] = useState([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "all", landlordId: "all", propertyId: "all" });
  const debouncedSearch = useDebounce(filters.search, 400);
  const [form, setForm] = useState(blankForm);

  const canWrite = hasCompanyPermission(currentUser, currentCompany, "standingOrders", "create", "accounts");

  const _uid = currentUser?._id || currentUser?.id;
  const _lsoDraftKey = (currentCompany?._id && _uid) ? `milik:draft:standing-order:${currentCompany._id}:${_uid}` : null;
  const _lsoDraftRestored = useRef(false);

  useEffect(() => {
    if (!_lsoDraftKey || _lsoDraftRestored.current) return;
    _lsoDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_lsoDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setForm(s); setShowModal(true); } }
    } catch {}
  }, [_lsoDraftKey]);

  useEffect(() => {
    if (!_lsoDraftKey || !_lsoDraftRestored.current || !showModal || editingId) return;
    try { window.sessionStorage.setItem(_lsoDraftKey, JSON.stringify({ form })); } catch {}
  }, [_lsoDraftKey, form, showModal, editingId]);

  const [runModal, setRunModal] = useState({ open: false, row: null, periodKey: "", amount: "", note: "" });
  const [expandedId, setExpandedId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [cashbooks, setCashbooks] = useState([]);
  const [reversingRunId, setReversingRunId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!currentCompany?._id) return;

    dispatch(getLandlords({ business: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));

    let mounted = true;
    getChartOfAccounts({ business: currentCompany._id, type: "asset" })
      .then((accounts) => {
        if (!mounted) return;
        setCashbooks(Array.isArray(accounts) ? accounts : []);
      })
      .catch(() => {
        if (!mounted) return;
        setCashbooks([]);
        toast.error("Failed to load cashbooks for standing orders");
      });

    return () => {
      mounted = false;
    };
  }, [dispatch, currentCompany?._id]);

  const loadRows = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const result = await getLandlordStandingOrders({
        business: currentCompany._id,
        company: currentCompany._id,
        ...filters,
        search: debouncedSearch,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      });
      setRows(Array.isArray(result.data) ? result.data : []);
      setServerTotal(result.total ?? 0);
      setServerPages(result.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load standing orders");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, debouncedSearch, filters.status, filters.landlordId, filters.propertyId, currentPage]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) =>
        rows.some(
          (row) =>
            String(row._id) === String(id) &&
            row.status === "active" &&
            (row.eligiblePeriods || []).length > 0
        )
      )
    );
  }, [rows]);

  useEffect(() => {
    if (!showModal || form.cashbook || cashbooks.length === 0) return;
    setForm((prev) => ({ ...prev, cashbook: prev.cashbook || cashbooks[0]?._id || "" }));
  }, [showModal, form.cashbook, cashbooks]);

  const stats = useMemo(
    () => ({
      total: serverTotal,
      active: rows.filter((row) => row.status === "active").length,
      processed: rows.reduce((sum, row) => sum + Number(row.totalProcessedAmount || 0), 0),
      pendingPeriods: rows.reduce((sum, row) => sum + Number(row.unprocessedPeriodsCount || 0), 0),
    }),
    [rows, serverTotal]
  );

  const safeCurrentPage = Math.min(currentPage, serverPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filters.status, filters.landlordId, filters.propertyId]);

  const closeModal = () => {
    if (_lsoDraftKey) { try { window.sessionStorage.removeItem(_lsoDraftKey); } catch {} }
    setShowModal(false);
    setEditingId("");
    setForm(blankForm);
  };

  const openCreate = () => {
    if (!canWrite) { toast.warning("You don't have permission to create standing orders"); return; }
    setEditingId("");
    setForm({
      ...blankForm,
      cashbook: cashbooks[0]?._id || "",
      dayOfMonth: new Date().getDate(),
    });
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canWrite) { toast.warning("You don't have permission to edit standing orders"); return; }
    const destination = row?.destination || {};
    setEditingId(row._id);
    setForm({
      landlord: row.landlord?._id || row.landlord || "",
      property: row.property?._id || row.property || "",
      title: row.title || "",
      narration: row.narration || "",
      notes: row.notes || "",
      amount: row.amount || "",
      frequency: row.frequency === "annually" ? "yearly" : row.frequency || "monthly",
      dayOfMonth: row.dayOfMonth || new Date(row.startDate || Date.now()).getDate() || 5,
      startDate: row.startDate ? new Date(row.startDate).toISOString().split("T")[0] : todayIso(),
      endDate: row.endDate ? new Date(row.endDate).toISOString().split("T")[0] : "",
      paymentMethod: normalizePaymentMethod(row.paymentMethod),
      cashbook: row.cashbook?._id || row.cashbook || "",
      accountName: destination.accountName || "",
      accountNumber: destination.accountNumber || "",
      bankName: destination.bankName || "",
      branchName: destination.branchName || "",
      mobileNumber: destination.mobileNumber || "",
      status: row.status || "draft",
    });
    setShowModal(true);
  };

  const filteredProperties = useMemo(() => {
    if (!form.landlord) return activeProperties;
    const selectedLandlord = activeLandlords.find((item) => String(item._id) === String(form.landlord));
    return activeProperties.filter((property) =>
      propertyBelongsToLandlord(property, form.landlord, selectedLandlord?.landlordName)
    );
  }, [activeLandlords, activeProperties, form.landlord]);

  const handleSave = async () => {
    const validationMessage = validateForm(form);
    if (validationMessage) return toast.warning(validationMessage);

    setSaving(true);
    try {
      const payload = {
        landlord: form.landlord,
        property: form.property,
        title: form.title.trim(),
        narration: String(form.narration || "").trim(),
        notes: String(form.notes || "").trim(),
        amount: Number(form.amount),
        frequency: form.frequency,
        dayOfMonth: canUseDayOfMonth(form.frequency) ? Number(form.dayOfMonth || 5) : undefined,
        startDate: form.startDate,
        endDate: form.endDate || null,
        paymentMethod: form.paymentMethod,
        cashbook: form.cashbook || null,
        status: form.status,
        destination: {
          accountName: String(form.accountName || "").trim(),
          accountNumber: String(form.accountNumber || "").trim(),
          bankName: String(form.bankName || "").trim(),
          branchName: String(form.branchName || "").trim(),
          mobileNumber: String(form.mobileNumber || "").trim(),
        },
        business: currentCompany?._id,
        company: currentCompany?._id,
      };

      const saved = editingId
        ? await updateLandlordStandingOrder(editingId, payload)
        : await createLandlordStandingOrder(payload);

      setRows((prev) => (editingId ? prev.map((row) => (row._id === editingId ? saved : row)) : [saved, ...prev]));
      closeModal();
      toast.success(`Standing order ${editingId ? "updated" : "saved"}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save standing order");
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (row, status) => {
    try {
      const saved = await updateLandlordStandingOrderStatus(row._id, {
        status,
        business: currentCompany?._id,
        company: currentCompany?._id,
      });
      setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
      toast.success(`Standing order marked ${status}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || `Failed to mark standing order ${status}`);
    }
  };

  const openRunModal = (row) => {
    if (row?.status !== "active") {
      toast.info("Only active standing orders can be processed. Activate the order first.");
      return;
    }

    const firstPeriod = row?.eligiblePeriods?.[0] || null;
    if (!firstPeriod) {
      toast.info("No eligible period is available to run. Future periods and already processed periods are blocked.");
      return;
    }

    setRunModal({
      open: true,
      row,
      periodKey: firstPeriod.periodKey,
      amount: String(Number(row.amount || firstPeriod.scheduledAmount || 0)),
      note: row.narration || row.title || "",
    });
  };

  const selectedRunPeriod = useMemo(() => {
    if (!runModal?.row) return null;
    return (runModal.row.eligiblePeriods || []).find((item) => item.periodKey === runModal.periodKey) || null;
  }, [runModal]);

  const handleRun = async () => {
    if (!runModal?.row?._id || !runModal.periodKey) return toast.warning("Select a valid eligible period");
    try {
      const saved = await runLandlordStandingOrder(runModal.row._id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
        periodKey: runModal.periodKey,
        amount: Number(runModal.amount || runModal.row.amount || 0),
        note: runModal.note,
      });
      setRows((prev) => prev.map((item) => (item._id === runModal.row._id ? saved : item)));
      setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" });
      toast.success("Standing order processed successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process standing order");
    }
  };

  const selectableRowIds = useMemo(
    () =>
      rows
        .filter((row) => row.status === "active" && (row.eligiblePeriods || []).length > 0)
        .map((row) => String(row._id)),
    [rows]
  );

  const allSelectableChecked =
    selectableRowIds.length > 0 && selectableRowIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (allSelectableChecked) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(selectableRowIds);
  };

  const toggleRowSelection = (rowId) => {
    const normalizedId = String(rowId || "");
    if (!normalizedId) return;
    setSelectedIds((prev) =>
      prev.includes(normalizedId) ? prev.filter((id) => id !== normalizedId) : [...prev, normalizedId]
    );
  };

  const handleRunSelected = async () => {
    if (!selectedIds.length) {
      toast.info("Select at least one eligible active standing order first.");
      return;
    }

    const selectedRows = rows.filter((row) => selectedIds.includes(String(row._id)));
    const runnableRows = selectedRows.filter(
      (row) => row.status === "active" && (row.eligiblePeriods || []).length > 0
    );
    if (!runnableRows.length) {
      toast.info("None of the selected standing orders has an eligible active period to run.");
      return;
    }

    if (!await confirm({ title: "Run Standing Orders", message: `Run the next eligible period for ${runnableRows.length} selected standing order(s)?`, confirmText: "Run" })) {
      return;
    }

    setBulkRunning(true);
    let successCount = 0;
    let failureCount = 0;
    const updatedRows = new Map();

    for (const row of runnableRows) {
      const nextPeriod = row?.eligiblePeriods?.[0] || null;
      if (!nextPeriod?.periodKey) {
        failureCount += 1;
        continue;
      }

      try {
        const saved = await runLandlordStandingOrder(row._id, {
          business: currentCompany?._id,
          company: currentCompany?._id,
          periodKey: nextPeriod.periodKey,
          amount: Number(row.amount || 0),
          note: row.narration || row.title || "",
        });
        updatedRows.set(String(row._id), saved);
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        toast.error(
          error?.response?.data?.message ||
            `Failed to process ${row.standingOrderNo || row.referenceNo || "a selected standing order"}`
        );
      }
    }

    if (updatedRows.size > 0) {
      setRows((prev) => prev.map((row) => updatedRows.get(String(row._id)) || row));
    }

    setSelectedIds([]);
    setBulkRunning(false);

    if (successCount > 0 && failureCount === 0) {
      toast.success(`Processed ${successCount} standing order period${successCount === 1 ? "" : "s"}.`);
      return;
    }

    if (successCount > 0 || failureCount > 0) {
      toast.info(`Bulk run complete. Success: ${successCount}. Failed: ${failureCount}.`);
    }
  };

  const handleReverseRun = async (row, period) => {
    if (!row?._id || !period?.id) return;
    if (period.isCancelled) {
      toast.info("This standing order period is already reversed.");
      return;
    }

    const label = period.periodLabel || period.periodKey || "selected period";
    if (!await confirm({ title: "Reverse Standing Order", message: `Reverse ${label} for ${row.standingOrderNo || row.referenceNo}?`, confirmText: "Reverse" })) {
      return;
    }

    setReversingRunId(String(period.id));
    try {
      const saved = await reverseLandlordStandingOrderRun(row._id, period.id, {
        business: currentCompany?._id,
        company: currentCompany?._id,
        reason: `Standing order run reversed from standing orders workspace for ${label}`,
      });
      setRows((prev) => prev.map((item) => (item._id === row._id ? saved : item)));
      toast.success(`Reversed ${label}`);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reverse standing order period");
    } finally {
      setReversingRunId("");
    }
  };

  const handleDelete = async (row) => {
    if (!canWrite) { toast.warning("You don't have permission to delete standing orders"); return; }
    if (!await confirm({ title: "Delete Standing Order", message: `Delete standing order ${row.standingOrderNo || row.referenceNo}?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await deleteLandlordStandingOrder(row._id, { business: currentCompany?._id, company: currentCompany?._id });
      setRows((prev) => prev.filter((item) => item._id !== row._id));
      toast.success("Standing order deleted");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to delete standing order");
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex h-full w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex-none sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
                <div className="relative shrink-0">
                  <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]" />
                  <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Search order, title…" className="h-7 w-40 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </div>
                <select value={filters.landlordId} onChange={(e) => setFilters((prev) => ({ ...prev, landlordId: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                  <option value="all">All Landlords</option>
                  {activeLandlords.map((landlord) => (<option key={landlord._id} value={landlord._id}>{getLandlordLabel(landlord)}</option>))}
                </select>
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                  <option value="all">All Properties</option>
                  {activeProperties.map((property) => (<option key={property._id} value={property._id}>{property.propertyCode ? `[${property.propertyCode}] ` : ""}{property.propertyName || property.name}</option>))}
                </select>
                <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="stopped">Stopped</option>
                </select>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <span className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600">{stats.total} orders</span>
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Active: {stats.active}</span>
                <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Processed: {money(stats.processed)}</span>
                <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Pending: {stats.pendingPeriods}</span>
                <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
                <button onClick={handleRunSelected} disabled={bulkRunning || selectedIds.length === 0} className="h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"><FaCheck /> {bulkRunning ? "Running…" : `Run${selectedIds.length ? ` (${selectedIds.length})` : ""}`}</button>
                <button onClick={openCreate} disabled={!canWrite} className="h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white bg-[#0B3B2E] hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:bg-slate-300"><FaPlus /> Add</button>
                <button onClick={() => setFilters({ search: "", status: "all", landlordId: "all", propertyId: "all" })} className="h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white bg-slate-500 hover:bg-slate-600">Reset</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1340px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="w-9 px-3 py-2 text-center font-bold border-r border-white/10">
                      <input
                        type="checkbox"
                        checked={allSelectableChecked}
                        onChange={toggleSelectAll}
                        disabled={selectableRowIds.length === 0}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Order</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Landlord / Property</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Schedule</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Payment Setup</th>
                    <th className="px-3 py-2 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-2 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        No standing orders found.
                      </td>
                    </tr>
                  )}
                  {rows.map((row, index) => {
                    const expanded = expandedId === row._id;
                    const runnable = row.status === "active" && (row.eligiblePeriods || []).length > 0;
                    return (
                      <React.Fragment key={row._id}>
                        <tr className={`border-b border-gray-100 transition-colors ${index % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                          <td className="w-9 px-3 py-1 text-center align-top border-r border-gray-100">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(String(row._id))}
                              onChange={() => toggleRowSelection(row._id)}
                              disabled={!runnable}
                              className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E] disabled:cursor-not-allowed disabled:opacity-50"
                              title={!runnable ? "Only active standing orders with eligible periods can be bulk run" : "Select this standing order for bulk run"}
                            />
                          </td>
                          <td className="px-3 py-1 align-top border-r border-gray-100">
                            <div className="font-black text-slate-900">{row.standingOrderNo || row.referenceNo}</div>
                            <div className="text-[10px] text-slate-500">{row.title}</div>
                            <button
                              type="button"
                              onClick={() => setExpandedId((prev) => (prev === row._id ? "" : row._id))}
                              className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-[#0B3B2E]"
                            >
                              <FaChevronDown className={`transition ${expanded ? "rotate-180" : ""}`} />
                              {expanded ? "Hide" : "Details"}
                            </button>
                          </td>
                          <td className="px-3 py-1 align-top border-r border-gray-100 text-slate-700">
                            <div className="font-semibold text-slate-900">{getLandlordLabel(row.landlord)}</div>
                            <div className="text-[10px] text-slate-500">{row.property?.propertyName || row.property?.name || "No property"}</div>
                          </td>
                          <td className="px-3 py-1 align-top border-r border-gray-100 text-slate-700">
                            <div className="font-semibold">{frequencyLabel(row.frequency)}</div>
                            <div className="text-[10px] text-slate-500">
                              Runs {canUseDayOfMonth(row.frequency) ? `on day ${row.dayOfMonth || new Date(row.startDate || Date.now()).getDate()}` : "every week"}
                            </div>
                            <div className="text-[10px] text-slate-500">Next: {row.nextEligiblePeriod?.periodLabel || "No open period"}</div>
                            <div className="text-[10px] text-slate-500">
                              Done {row.processedPeriodsCount || 0} • Pending {row.unprocessedPeriodsCount || 0}
                            </div>
                          </td>
                          <td className="px-3 py-1 align-top border-r border-gray-100 text-slate-700">
                            <div className="font-semibold">
                              {paymentMethodOptions.find((item) => item.value === normalizePaymentMethod(row.paymentMethod))?.label || frequencyLabel(row.paymentMethod)}
                            </div>
                            <div className="text-[10px] text-slate-500">{getCashbookLabel(row.cashbook)}</div>
                            <div className="text-[10px] text-slate-500">{getPaymentDestinationSummary(row)}</div>
                          </td>
                          <td className="px-3 py-1 text-right align-top border-r border-gray-100 font-black text-slate-900">{money(row.amount)}</td>
                          <td className="px-3 py-1 align-top border-r border-gray-100">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                              row.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : row.status === "paused" ? "bg-amber-50 text-amber-700 border-amber-200"
                              : row.status === "stopped" ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                            }`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3 py-1 text-right align-top">
                            <div className="inline-flex flex-wrap justify-end gap-2">
                              <button
                                onClick={() => openEdit(row)}
                                disabled={!canWrite}
                                className="inline-flex h-7 items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2.5 text-[11px] font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <FaEdit /> Edit
                              </button>
                              {row.status !== "active" && (
                                <button
                                  onClick={() => handleStatus(row, "active")}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700"
                                >
                                  <FaPlay /> Activate
                                </button>
                              )}
                              {row.status === "active" && (
                                <button
                                  onClick={() => handleStatus(row, "paused")}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 text-[11px] font-bold text-amber-700"
                                >
                                  <FaPause /> Pause
                                </button>
                              )}
                              {row.status !== "stopped" && (
                                <button
                                  onClick={() => handleStatus(row, "stopped")}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-slate-100 px-2.5 text-[11px] font-bold text-slate-700"
                                >
                                  <FaStop /> Stop
                                </button>
                              )}
                              <button
                                onClick={() => openRunModal(row)}
                                className={`inline-flex h-7 items-center gap-1 rounded border px-2.5 text-[11px] font-bold ${
                                  runnable
                                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                    : "border-slate-300 bg-slate-100 text-slate-400"
                                }`}
                              >
                                <FaCalendarAlt /> Run
                              </button>
                              <button
                                onClick={() => handleDelete(row)}
                                disabled={!canWrite}
                                className="inline-flex h-7 items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2.5 text-[11px] font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <FaTrash /> Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-gray-100 bg-slate-50/80">
                            <td colSpan={8} className="px-3 py-3">
                              <div className="mb-4 grid gap-4 xl:grid-cols-3">
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Payment destination</p>
                                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                                    <div><span className="font-bold text-slate-900">Method:</span> {paymentMethodOptions.find((item) => item.value === normalizePaymentMethod(row.paymentMethod))?.label || frequencyLabel(row.paymentMethod)}</div>
                                    <div><span className="font-bold text-slate-900">Cashbook:</span> {getCashbookLabel(row.cashbook)}</div>
                                    <div><span className="font-bold text-slate-900">Destination:</span> {getPaymentDestinationSummary(row)}</div>
                                    <div><span className="font-bold text-slate-900">Narration:</span> {row.narration || row.title || "-"}</div>
                                    <div><span className="font-bold text-slate-900">Internal notes:</span> {row.notes || "-"}</div>
                                  </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Current schedule</p>
                                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                                    <div><span className="font-bold text-slate-900">Start:</span> {formatDate(row.startDate)}</div>
                                    <div><span className="font-bold text-slate-900">End:</span> {formatDate(row.endDate)}</div>
                                    <div><span className="font-bold text-slate-900">Frequency:</span> {frequencyLabel(row.frequency)}</div>
                                    <div><span className="font-bold text-slate-900">Run rule:</span> {canUseDayOfMonth(row.frequency) ? `Day ${row.dayOfMonth || new Date(row.startDate || Date.now()).getDate()}` : "Weekly cycle"}</div>
                                    <div><span className="font-bold text-slate-900">Last processed:</span> {formatDate(row.lastRunDate || row.lastRunAt)}</div>
                                  </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Controls</p>
                                  <div className="mt-3 space-y-3 text-sm text-slate-700">
                                    <div>Processed runs can be reversed only while the related landlord statement period is still open.</div>
                                    <div>Once runs exist, the property, landlord, schedule day, frequency, and start date are locked for audit safety.</div>
                                  </div>
                                </div>
                              </div>

                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Eligible periods to run</p>
                                  <div className="mt-3 space-y-2">
                                    {(row.eligiblePeriods || []).length === 0 && (
                                      <p className="text-sm text-slate-500">
                                        No eligible periods. Already processed periods, future periods, and closed statement periods are blocked.
                                      </p>
                                    )}
                                    {(row.eligiblePeriods || []).map((item) => (
                                      <div key={item.periodKey} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                                        <div>
                                          <div className="font-bold text-slate-800">{item.periodLabel}</div>
                                          <div className="text-xs text-slate-500">Due {formatDate(item.dueDate)}</div>
                                        </div>
                                        <button
                                          onClick={() =>
                                            openRunModal({
                                              ...row,
                                              eligiblePeriods: [item, ...(row.eligiblePeriods || []).filter((entry) => entry.periodKey !== item.periodKey)],
                                            })
                                          }
                                          className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"
                                        >
                                          Run this period
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Processed periods</p>
                                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                                    {(row.processedPeriods || []).length === 0 && (
                                      <p className="text-sm text-slate-500">No processed periods yet.</p>
                                    )}
                                    {(row.processedPeriods || []).map((item) => (
                                      <div
                                        key={item.referenceNo || item.periodKey}
                                        className={`rounded-xl border px-3 py-2 text-sm ${
                                          item.isCancelled
                                            ? "border-slate-200 bg-slate-100"
                                            : "border-emerald-200 bg-emerald-50"
                                        }`}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <div className={`font-bold ${item.isCancelled ? "text-slate-700" : "text-emerald-800"}`}>
                                              {item.periodLabel || item.periodKey}
                                            </div>
                                            <div className={`mt-1 text-xs ${item.isCancelled ? "text-slate-500" : "text-emerald-700"}`}>
                                              Processed {formatDate(item.runDate)} • Ref {item.referenceNo || "-"}
                                            </div>
                                            {item.isCancelled && (
                                              <div className="mt-1 text-xs text-rose-600">
                                                Reversed {formatDate(item.cancelledAt)} • {item.cancellationReason || "No reason recorded"}
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex flex-col items-end gap-2">
                                            <div className={`font-black ${item.isCancelled ? "text-slate-700" : "text-emerald-900"}`}>
                                              {money(item.amount)}
                                            </div>
                                            {item.isCancelled ? (
                                              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-700">
                                                Reversed
                                              </span>
                                            ) : (
                                              <button
                                                onClick={() => handleReverseRun(row, item)}
                                                disabled={reversingRunId === String(item.id)}
                                                className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                              >
                                                <FaUndo /> {reversingRunId === String(item.id) ? "Reversing..." : "Reverse run"}
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border border-slate-200 border-t-0 bg-white px-4 py-2 text-xs text-slate-600 rounded-b-lg">
            <div className="font-semibold">
              Showing <span className="font-bold text-slate-900">{serverTotal === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="font-bold text-slate-900">{Math.min(safeCurrentPage * ITEMS_PER_PAGE, serverTotal)}</span> of <span className="font-bold text-slate-900">{serverTotal}</span> standing orders
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={safeCurrentPage === 1}
                className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {serverPages}</span>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(serverPages, prev + 1))}
                disabled={safeCurrentPage === serverPages}
                className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Landlord Standing Order</p>
                <h3 className="text-xl font-black">{editingId ? "Edit Standing Order" : "Add Standing Order"}</h3>
              </div>
              <button onClick={closeModal} className="rounded-full border border-white/30 p-2 hover:bg-white/10">
                <FaTimes />
              </button>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Landlord</span>
                <AppSelect
                  value={form.landlord}
                  onChange={(v) => setForm((prev) => ({ ...prev, landlord: v ?? "", property: "" }))}
                  options={activeLandlords.map((l) => ({ value: l._id, label: getLandlordLabel(l) }))}
                  placeholder="Select landlord…"
                  searchable
                  clearable
                  size="sm"
                />
              </div>

              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Property</span>
                <AppSelect
                  value={form.property}
                  onChange={(v) => setForm((prev) => ({ ...prev, property: v ?? "" }))}
                  options={filteredProperties.map((p) => ({ value: p._id, label: `${p.propertyCode ? `[${p.propertyCode}] ` : ""}${p.propertyName || p.name}` }))}
                  placeholder="Select property…"
                  searchable
                  clearable
                  size="sm"
                />
              </div>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Amount</span>
                <input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Initial Status</span>
                <select
                  value={form.status}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>

              <label className="block xl:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Title</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Frequency</span>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm((prev) => ({ ...prev, frequency: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                >
                  {frequencyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Start Date</span>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">End Date</span>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              {canUseDayOfMonth(form.frequency) && (
                <label className="block">
                  <span className="mb-0.5 block text-xs font-semibold text-slate-700">Run Day</span>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.dayOfMonth}
                    onChange={(e) => setForm((prev) => ({ ...prev, dayOfMonth: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Payment Method</span>
                <select
                  value={form.paymentMethod}
                  onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                >
                  {paymentMethodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Cashbook</span>
                <select
                  value={form.cashbook}
                  onChange={(e) => setForm((prev) => ({ ...prev, cashbook: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                >
                  <option value="">Auto-resolve from payment method</option>
                  {cashbooks.map((account) => (
                    <option key={account._id} value={account._id}>
                      {account.name || account.accountName || account.code || account.accountCode}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block xl:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Narration</span>
                <textarea
                  rows={3}
                  value={form.narration}
                  onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block xl:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Internal Notes</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <div className="xl:col-span-4 mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Payout destination</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {normalizePaymentMethod(form.paymentMethod) !== "mpesa" && (
                    <label className="block">
                      <span className="mb-0.5 block text-xs font-semibold text-slate-700">Payee / Account Name</span>
                      <input
                        value={form.accountName}
                        onChange={(e) => setForm((prev) => ({ ...prev, accountName: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      />
                    </label>
                  )}

                  {(normalizePaymentMethod(form.paymentMethod) === "bank_transfer" ||
                    normalizePaymentMethod(form.paymentMethod) === "cheque") && (
                    <>
                      <label className="block">
                        <span className="mb-0.5 block text-xs font-semibold text-slate-700">Account Number</span>
                        <input
                          value={form.accountNumber}
                          onChange={(e) => setForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
                          className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-xs font-semibold text-slate-700">Bank Name</span>
                        <input
                          value={form.bankName}
                          onChange={(e) => setForm((prev) => ({ ...prev, bankName: e.target.value }))}
                          className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-xs font-semibold text-slate-700">Branch Name</span>
                        <input
                          value={form.branchName}
                          onChange={(e) => setForm((prev) => ({ ...prev, branchName: e.target.value }))}
                          className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>
                    </>
                  )}

                  {normalizePaymentMethod(form.paymentMethod) === "mpesa" && (
                    <label className="block">
                      <span className="mb-0.5 block text-xs font-semibold text-slate-700">Destination Mobile Number</span>
                      <input
                        value={form.mobileNumber}
                        onChange={(e) => setForm((prev) => ({ ...prev, mobileNumber: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={closeModal} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
              >
                <FaSave /> {saving ? "Saving..." : editingId ? "Update Order" : "Save Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {runModal.open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-indigo-600 px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-100">Standing Order Run</p>
                <h3 className="text-xl font-black">Choose eligible period</h3>
              </div>
              <button onClick={() => setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="rounded-full border border-white/30 p-2 hover:bg-white/10">
                <FaTimes />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                <div className="font-black">{runModal.row?.title}</div>
                <div className="mt-1">
                  Only current or skipped eligible periods can be processed. Future periods, duplicate runs, and closed statement periods are blocked by the backend.
                </div>
              </div>
              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Eligible period</span>
                <select
                  value={runModal.periodKey}
                  onChange={(e) => setRunModal((prev) => ({ ...prev, periodKey: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                >
                  {(runModal.row?.eligiblePeriods || []).map((item) => (
                    <option key={item.periodKey} value={item.periodKey}>
                      {item.periodLabel} • Due {formatDate(item.dueDate)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-0.5 block text-xs font-semibold text-slate-700">Amount</span>
                  <input
                    type="number"
                    value={runModal.amount}
                    onChange={(e) => setRunModal((prev) => ({ ...prev, amount: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-black text-slate-900">Selected period</div>
                  <div className="mt-2">{selectedRunPeriod?.periodLabel || "-"}</div>
                  <div className="text-xs text-slate-500">
                    Statement window: {formatDate(selectedRunPeriod?.periodStart)} - {formatDate(selectedRunPeriod?.periodEnd)}
                  </div>
                </div>
              </div>
              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Narration</span>
                <textarea
                  rows={3}
                  value={runModal.note}
                  onChange={(e) => setRunModal((prev) => ({ ...prev, note: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleRun} className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                <FaCheck /> Run selected period
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default LandlordStandingOrders;
