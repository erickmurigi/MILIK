import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntityCache } from "../../hooks/useEntityCache";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import {
  FaBook,
  FaCalendarAlt,
  FaCheck,
  FaChevronDown,
  FaDownload,
  FaEdit,
  FaPause,
  FaPlay,
  FaPlus,
  FaPrint,
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
import { fmtDate } from "../../utils/dates";
import { printTabularList } from "../../utils/printKit";
import JournalEntriesDrawer from "../../components/Accounting/JournalEntriesDrawer";
import { useConfirm } from "../../context/ConfirmContext";
import {
  createLandlordStandingOrder,
  deleteLandlordStandingOrder,
  getChartOfAccounts,
  getLandlordStandingOrders,
  getLandlords,
  reverseLandlordStandingOrderRun,
  runLandlordStandingOrder,
  runLandlordStandingOrdersBatch,
  updateLandlordStandingOrder,
  updateLandlordStandingOrderStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { propertyBelongsToLandlord } from "./propertyUtils";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectAllProperties } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";
import { isCashbookAccount } from "../../utils/cashbookUtils";
import AppSelect from "../../components/common/AppSelect";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import MilikTable from "../../components/common/MilikTable";

const todayIso = () => new Date().toISOString().split("T")[0];

const formInputClass = "h-7 w-full border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const formLabelClass = "mb-1 block text-xs font-bold text-slate-900";
const FormSection = ({ title, children }) => (
  <div className="border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

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
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);
  const properties = useSelector(selectAllProperties);
  const activeLandlords = useMemo(
    () => landlords.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"),
    [landlords]
  );
  const activeProperties = useMemo(
    () => properties.filter((item) => String(item?.status || "active").toLowerCase() !== "archived"),
    [properties]
  );
  const landlordOptions = useMemo(
    () => activeLandlords.map((l) => ({ value: l._id, label: getLandlordLabel(l) })),
    [activeLandlords]
  );
  // Stable option array — avoids busting AppSelect's internal useMemo on every render
  const activePropertyOptions = useMemo(
    () => activeProperties.map((p) => ({ value: p._id, label: `${p.propertyCode ? `[${p.propertyCode}] ` : ""}${p.propertyName || p.name}` })),
    [activeProperties]
  );

  const [rows, setRows] = useState([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverPages, setServerPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [glOrder, setGlOrder] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [filters, setFilters] = useTabState("/landlords/standing-orders:filters", { search: "", status: "all", landlordId: "all", propertyId: "all" });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
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
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [cashbooks, setCashbooks] = useState([]);
  const cashbookOptions = useMemo(() => cashbooks.map((account) => ({ value: account._id, label: account.name || account.accountName || account.code || account.accountCode })), [cashbooks]);
  const [reversingRunId, setReversingRunId] = useState("");
  const [currentPage, setCurrentPage] = useTabState("/landlords/standing-orders:currentPage", 1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    if (!currentCompany?._id) return;

    dispatch(getLandlords({ business: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));

    let mounted = true;
    getChartOfAccounts({ business: currentCompany._id, type: "asset" })
      .then((accounts) => {
        if (!mounted) return;
        setCashbooks(Array.isArray(accounts) ? accounts.filter(isCashbookAccount) : []);
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
        limit: pageSize,
      });
      setRows(Array.isArray(result.data) ? result.data : []);
      setServerTotal(result.total ?? 0);
      setServerPages(result.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load standing orders");
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id, debouncedSearch, filters.status, filters.landlordId, filters.propertyId, currentPage, pageSize]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // The on-screen table is server-paginated (one page at a time) — printing or exporting
  // the whole filtered register needs its own fetch with every matching row.
  const fetchAllFilteredOrders = async () => {
    const result = await getLandlordStandingOrders({
      business: currentCompany._id,
      company: currentCompany._id,
      ...filters,
      search: debouncedSearch,
      page: 1,
      limit: 2000,
    });
    return Array.isArray(result.data) ? result.data : [];
  };

  const PRINT_COLUMNS = [
    { label: "Order #", value: (r) => r.standingOrderNo || r.referenceNo || "-" },
    { label: "Title", value: (r) => r.title || "-" },
    { label: "Landlord", value: (r) => getLandlordLabel(r.landlord) },
    { label: "Property", value: (r) => r.property?.propertyName || r.property?.name || "-" },
    { label: "Frequency", value: (r) => frequencyLabel(r.frequency) },
    { label: "Amount", align: "right", bold: true, value: (r) => money(r.amount) },
    { label: "Next Period", value: (r) => r.nextEligiblePeriod?.periodLabel || "-" },
    { label: "Status", align: "center", value: (r) => frequencyLabel(r.status) },
  ];

  const handlePrintList = async () => {
    if (!currentCompany?._id) return;
    try {
      const printRows = await fetchAllFilteredOrders();
      if (printRows.length === 0) { toast.info("There are no standing orders to print."); return; }
      const totalAmount = printRows.reduce((s, r) => s + Number(r.amount || 0), 0);
      const processedAmount = printRows.reduce((s, r) => s + Number(r.totalProcessedAmount || 0), 0);
      const printed = printTabularList({
        title: "Landlord Standing Orders",
        subtitle: `${printRows.length.toLocaleString()} order${printRows.length !== 1 ? "s" : ""}`,
        company: currentCompany,
        summaryItems: [
          ["Total Orders", printRows.length.toLocaleString()],
          ["Total Amount", money(totalAmount)],
          ["Total Processed", money(processedAmount)],
        ],
        columns: PRINT_COLUMNS,
        rows: printRows,
        totalsRow: ["", "", "", "", "Total", money(totalAmount), "", ""],
      });
      if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load standing orders for printing");
    }
  };

  const handleExportCsv = async () => {
    if (!currentCompany?._id) return;
    try {
      const exportRows = await fetchAllFilteredOrders();
      if (exportRows.length === 0) { toast.info("There are no standing orders to export."); return; }
      const header = PRINT_COLUMNS.map((c) => c.label);
      const rows = exportRows.map((r) => PRINT_COLUMNS.map((c) => c.value(r)));
      const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `landlord-standing-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load standing orders for export");
    }
  };

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
  const filteredPropertyOptions = useMemo(
    () => filteredProperties.map((p) => ({ value: p._id, label: `${p.propertyCode ? `[${p.propertyCode}] ` : ""}${p.propertyName || p.name}` })),
    [filteredProperties]
  );

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

    const items = [];
    let skippedNoPeriod = 0;
    runnableRows.forEach((row) => {
      const nextPeriod = row?.eligiblePeriods?.[0] || null;
      if (!nextPeriod?.periodKey) {
        skippedNoPeriod += 1;
        return;
      }
      items.push({
        id: row._id,
        periodKey: nextPeriod.periodKey,
        amount: Number(row.amount || 0),
        note: row.narration || row.title || "",
      });
    });

    try {
      const response = items.length
        ? await runLandlordStandingOrdersBatch(items, {
            business: currentCompany?._id,
            company: currentCompany?._id,
          })
        : { succeeded: [], failed: [] };

      const succeeded = Array.isArray(response?.succeeded) ? response.succeeded : [];
      const failed = Array.isArray(response?.failed) ? response.failed : [];
      const successCount = succeeded.length;
      const failureCount = failed.length + skippedNoPeriod;

      if (succeeded.length > 0) {
        const updatedRows = new Map(succeeded.map((saved) => [String(saved?._id), saved]));
        setRows((prev) => prev.map((row) => updatedRows.get(String(row._id)) || row));
      }

      failed.forEach((item) => {
        const row = runnableRows.find((r) => String(r._id) === String(item.id));
        toast.error(
          item.reason ||
            `Failed to process ${row?.standingOrderNo || row?.referenceNo || "a selected standing order"}`
        );
      });

      setSelectedIds([]);

      if (successCount > 0 && failureCount === 0) {
        toast.success(`Processed ${successCount} standing order period${successCount === 1 ? "" : "s"}.`);
      } else if (successCount > 0 || failureCount > 0) {
        toast.info(`Bulk run complete. Success: ${successCount}. Failed: ${failureCount}.`);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to run selected standing orders.");
    } finally {
      setBulkRunning(false);
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden  border border-slate-200 bg-white shadow-sm">
            <ListToolbar>
              <div className="relative shrink-0">
                <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
                <ListToolbar.Input value={filters.search} onChange={setFilter("search")} placeholder="Search order, title…" width="w-32" className="pl-5" />
              </div>
              <AppSelect
                value={filters.landlordId}
                onChange={(v) => setFilters((prev) => ({ ...prev, landlordId: v ?? "all" }))}
                options={landlordOptions}
                placeholder="All Landlords"
                searchable
                clearable
                compact
              />
              <AppSelect
                value={filters.propertyId}
                onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? "all" }))}
                options={activePropertyOptions}
                placeholder="All Properties"
                searchable
                clearable
                compact
              />
              <AppSelect
                value={filters.status}
                onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "all" }))}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "stopped", label: "Stopped" },
                ]}
                placeholder="All Statuses"
                clearable
                compact
              />
              <ListToolbar.Divider />
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{stats.total} orders</span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Active: {stats.active}</span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Processed: {money(stats.processed)}</span>
              <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Pending: {stats.pendingPeriods}</span>
              <ListToolbar.Divider />
              <ListToolbar.Button
                icon={FaCheck}
                variant="outlineOk"
                disabled={bulkRunning || selectedIds.length === 0}
                onClick={handleRunSelected}
              >
                {bulkRunning ? "Running…" : `Run${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
              </ListToolbar.Button>
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrintList}>Print</ListToolbar.Button>
              <ListToolbar.Button icon={FaDownload} variant="outline" onClick={handleExportCsv}>Export</ListToolbar.Button>
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaPlus} disabled={!canWrite} onClick={openCreate}>Add</ListToolbar.Button>
              <ListToolbar.Button
                variant="dark"
                onClick={() => setFilters({ search: "", status: "all", landlordId: "all", propertyId: "all" })}
              >
                Reset
              </ListToolbar.Button>
            </ListToolbar>

            <MilikTable
              columns={[
                { label: "Order" },
                { label: "Landlord / Property" },
                { label: "Schedule" },
                { label: "Payment Setup" },
                { label: "Amount", align: "right" },
                { label: "Status" },
              ]}
              rows={rows}
              rowKey="_id"
              loading={loading && rows.length === 0}
              empty="No standing orders found."
              minWidth="1340px"
              checkboxes
              allChecked={allSelectableChecked}
              someChecked={selectedIds.length > 0 && !allSelectableChecked}
              onCheckAll={toggleSelectAll}
              isChecked={(row) => selectedIdSet.has(String(row._id))}
              isSelected={(row) => selectedIdSet.has(String(row._id))}
              onCheckRow={(row) => {
                const runnable = row.status === "active" && (row.eligiblePeriods || []).length > 0;
                if (runnable) toggleRowSelection(row._id);
              }}
              renderRow={(row) => {
                const runnable = row.status === "active" && (row.eligiblePeriods || []).length > 0;
                return (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0 font-black text-slate-900">{row.standingOrderNo || row.referenceNo}</span>
                        <span className="min-w-0 truncate text-[10px] text-slate-500" title={row.title}>{row.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0 font-semibold text-slate-900 truncate max-w-[60%]">{getLandlordLabel(row.landlord)}</span>
                        <span className="min-w-0 truncate text-[10px] text-slate-500">{row.property?.propertyName || row.property?.name || "No property"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700 overflow-hidden">
                      <span className="truncate block">
                        <span className="font-semibold">{frequencyLabel(row.frequency)}</span>
                        {canUseDayOfMonth(row.frequency) && <span className="text-[10px] text-slate-500"> · Day {row.dayOfMonth || new Date(row.startDate || Date.now()).getDate()}</span>}
                        <span className="text-[10px] text-slate-500"> · Next: {row.nextEligiblePeriod?.periodLabel || "No open period"}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700 overflow-hidden">
                      <span className="truncate block">
                        <span className="font-semibold">
                          {paymentMethodOptions.find((item) => item.value === normalizePaymentMethod(row.paymentMethod))?.label || frequencyLabel(row.paymentMethod)}
                        </span>
                        <span className="text-[10px] text-slate-500"> · {getPaymentDestinationSummary(row)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right border-r border-gray-100 font-black text-slate-900 whitespace-nowrap">{money(row.amount)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold border ${
                        row.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : row.status === "paused" ? "bg-amber-50 text-amber-700 border-amber-200"
                        : row.status === "stopped" ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}>
                        {row.status}
                      </span>
                    </td>
                  </>
                );
              }}
              renderActions={(row) => {
                return (
                  <div className="inline-flex flex-wrap justify-end gap-1.5">
                    <button
                      onClick={() => openEdit(row)}
                      disabled={!canWrite}
                      className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaEdit size={10} /> Edit
                    </button>
                    {row.status !== "active" && (
                      <button
                        onClick={() => handleStatus(row, "active")}
                        className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <FaPlay size={10} /> Activate
                      </button>
                    )}
                    {row.status === "active" && (
                      <button
                        onClick={() => handleStatus(row, "paused")}
                        className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <FaPause size={10} /> Pause
                      </button>
                    )}
                    {row.status !== "stopped" && (
                      <button
                        onClick={() => handleStatus(row, "stopped")}
                        className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <FaStop size={10} /> Stop
                      </button>
                    )}
                    <button
                      onClick={() => openRunModal(row)}
                      className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <FaCalendarAlt size={10} /> Run
                    </button>
                    <button
                      onClick={() => setGlOrder(row)}
                      className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      title="View GL Entries"
                    >
                      <FaBook size={10} /> GL
                    </button>
                    <button
                      onClick={() => handleDelete(row)}
                      disabled={!canWrite}
                      className="inline-flex h-6 items-center gap-1 border border-red-300 bg-white px-2 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaTrash size={10} /> Delete
                    </button>
                  </div>
                );
              }}
              renderExpanded={(row) => {
                const scheduleRows = row.fullSchedule || [];
                return (
                  <div className="border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                      <p className="text-[11px] font-black uppercase tracking-wide text-slate-700">
                        {frequencyLabel(row.frequency)} Schedule · {fmtDate(row.startDate)} – {row.endDate ? fmtDate(row.endDate) : "Ongoing"}
                      </p>
                    </div>
                    {scheduleRows.length === 0 ? (
                      <p className="px-3 py-2.5 text-xs text-slate-500">No scheduled periods.</p>
                    ) : (
                      <div className="max-h-80 overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0">
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="px-3 py-1 text-left font-bold uppercase tracking-wide text-slate-500">Period</th>
                              <th className="px-3 py-1 text-left font-bold uppercase tracking-wide text-slate-500">Due</th>
                              <th className="px-3 py-1 text-right font-bold uppercase tracking-wide text-slate-500">Amount</th>
                              <th className="px-3 py-1 text-center font-bold uppercase tracking-wide text-slate-500">Status</th>
                              <th className="px-3 py-1 text-right font-bold uppercase tracking-wide text-slate-500">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheduleRows.map((item) => {
                              const processed = item.processed;
                              const isCancelled = Boolean(processed?.isCancelled);
                              const statusLabel = processed ? (isCancelled ? "Reversed" : "Processed") : item.isEligible ? "Due" : "Upcoming";
                              const statusCls = processed
                                ? (isCancelled ? "border-slate-200 bg-slate-100 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-700")
                                : item.isEligible
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-slate-200 bg-slate-50 text-slate-400";
                              return (
                                <tr key={item.periodKey} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                  <td className="px-3 py-1.5 font-semibold text-slate-900 border-r border-gray-100">{item.periodLabel}</td>
                                  <td className="px-3 py-1.5 text-slate-600 border-r border-gray-100">{fmtDate(item.dueDate)}</td>
                                  <td className={`px-3 py-1.5 text-right font-bold tabular-nums border-r border-gray-100 ${isCancelled ? "text-slate-400 line-through" : "text-slate-900"}`}>
                                    {money(processed?.amount ?? row.amount)}
                                  </td>
                                  <td className="px-3 py-1.5 text-center border-r border-gray-100">
                                    <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusCls}`}>
                                      {statusLabel}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 text-right">
                                    {processed ? (
                                      <button
                                        onClick={() => !isCancelled && handleReverseRun(row, processed)}
                                        disabled={isCancelled || reversingRunId === String(processed.id)}
                                        title={isCancelled ? "Already reversed" : undefined}
                                        className="inline-flex h-6 items-center gap-1 border border-red-300 bg-white px-2 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                                      >
                                        <FaUndo size={9} /> {reversingRunId === String(processed.id) ? "..." : "Reverse"}
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() =>
                                          item.isEligible &&
                                          openRunModal({
                                            ...row,
                                            eligiblePeriods: [item, ...(row.eligiblePeriods || []).filter((entry) => entry.periodKey !== item.periodKey)],
                                          })
                                        }
                                        disabled={!item.isEligible}
                                        title={!item.isEligible ? "Not yet due" : undefined}
                                        className="inline-flex h-6 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                                      >
                                        <FaCalendarAlt size={9} /> Run
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>

          <PaginationBar
            page={safeCurrentPage}
            pages={serverPages}
            total={serverTotal}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
            loading={loading}
            label="standing orders"
          />
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-6xl overflow-hidden  border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-6 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Landlord Standing Order</p>
                <h3 className="text-xl font-black">{editingId ? "Edit Standing Order" : "Add Standing Order"}</h3>
              </div>
              <button onClick={closeModal} className=" border border-white/30 p-2 hover:bg-white/10">
                <FaTimes />
              </button>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Landlord</span>
                <AppSelect
                  value={form.landlord}
                  onChange={(v) => setForm((prev) => ({ ...prev, landlord: v ?? "", property: "" }))}
                  options={landlordOptions}
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
                  options={filteredPropertyOptions}
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
                  className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Initial Status</span>
                <AppSelect
                  value={form.status || null}
                  onChange={(v) => setForm((prev) => ({ ...prev, status: v ?? "draft" }))}
                  options={[
                    { value: "draft", label: "Draft" },
                    { value: "active", label: "Active" },
                    { value: "paused", label: "Paused" },
                  ]}
                  size="sm"
                />
              </label>

              <label className="block xl:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Title</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Frequency</span>
                <AppSelect
                  value={form.frequency || null}
                  onChange={(v) => setForm((prev) => ({ ...prev, frequency: v ?? "monthly" }))}
                  options={frequencyOptions}
                  size="sm"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Start Date</span>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">End Date</span>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
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
                    className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Payment Method</span>
                <AppSelect
                  value={form.paymentMethod || null}
                  onChange={(v) => setForm((prev) => ({ ...prev, paymentMethod: v ?? "bank_transfer" }))}
                  options={paymentMethodOptions}
                  size="sm"
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Cashbook</span>
                <AppSelect
                  value={form.cashbook || null}
                  onChange={(v) => setForm((prev) => ({ ...prev, cashbook: v ?? "" }))}
                  options={cashbookOptions}
                  placeholder="Auto-resolve from payment method"
                  searchable
                  clearable
                  size="sm"
                />
              </label>

              <label className="block xl:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Narration</span>
                <textarea
                  rows={3}
                  value={form.narration}
                  onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                  className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <label className="block xl:col-span-2">
                <span className="mb-0.5 block text-xs font-semibold text-slate-700">Internal Notes</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                />
              </label>

              <div className="xl:col-span-4 mt-2  border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Payout destination</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {normalizePaymentMethod(form.paymentMethod) !== "mpesa" && (
                    <label className="block">
                      <span className="mb-0.5 block text-xs font-semibold text-slate-700">Payee / Account Name</span>
                      <input
                        value={form.accountName}
                        onChange={(e) => setForm((prev) => ({ ...prev, accountName: e.target.value }))}
                        className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
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
                          className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-xs font-semibold text-slate-700">Bank Name</span>
                        <input
                          value={form.bankName}
                          onChange={(e) => setForm((prev) => ({ ...prev, bankName: e.target.value }))}
                          className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-xs font-semibold text-slate-700">Branch Name</span>
                        <input
                          value={form.branchName}
                          onChange={(e) => setForm((prev) => ({ ...prev, branchName: e.target.value }))}
                          className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
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
                        className="mt-1 w-full  border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={closeModal} className=" border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2  bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
              >
                <FaSave /> {saving ? "Saving..." : editingId ? "Update Order" : "Save Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {runModal.open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">Run Standing Order</h2>
              <button onClick={() => setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="text-white/70 transition-colors hover:text-white">
                <FaTimes size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4">
              <FormSection title={runModal.row?.title || "Run Details"}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <div className="col-span-2">
                    <label className={formLabelClass}>Eligible period</label>
                    <AppSelect
                      value={runModal.periodKey || null}
                      onChange={(v) => setRunModal((prev) => ({ ...prev, periodKey: v ?? "" }))}
                      options={(runModal.row?.eligiblePeriods || []).map((item) => ({
                        value: item.periodKey,
                        label: `${item.periodLabel} · Due ${fmtDate(item.dueDate)}`,
                      }))}
                      size="md"
                    />
                    {selectedRunPeriod && (
                      <p className="mt-1 text-[10px] text-slate-500">
                        Statement window: {fmtDate(selectedRunPeriod.periodStart)} – {fmtDate(selectedRunPeriod.periodEnd)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={formLabelClass}>Amount</label>
                    <input
                      type="number"
                      value={runModal.amount}
                      onChange={(e) => setRunModal((prev) => ({ ...prev, amount: e.target.value }))}
                      className={formInputClass}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className={formLabelClass}>Narration <span className="font-normal text-slate-400">(optional)</span></label>
                    <textarea
                      rows={2}
                      value={runModal.note}
                      onChange={(e) => setRunModal((prev) => ({ ...prev, note: e.target.value }))}
                      className="w-full resize-none border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                  </div>
                </div>
              </FormSection>

              <p className="mt-2 text-[10px] text-slate-400">
                Only current or skipped eligible periods can be processed — future periods, duplicate runs, and closed statement periods are blocked by the backend.
              </p>
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button onClick={() => setRunModal({ open: false, row: null, periodKey: "", amount: "", note: "" })} className="h-8 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleRun} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                <FaCheck size={11} /> Run Selected Period
              </button>
            </div>
          </div>
        </div>
      )}
      <JournalEntriesDrawer
        open={!!glOrder}
        onClose={() => setGlOrder(null)}
        title="Standing Order"
        transactionRef={glOrder?.standingOrderNo || glOrder?.referenceNo}
        date={glOrder ? new Date(glOrder.startDate || glOrder.createdAt).toLocaleDateString("en-GB") : ""}
        amount={glOrder?.amount}
        status={glOrder?.status}
        statusColors={
          glOrder?.status === "active" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
          : glOrder?.status === "paused" ? "bg-amber-100 text-amber-700 border-amber-200"
          : glOrder?.status === "stopped" ? "bg-rose-100 text-rose-700 border-rose-200"
          : "bg-slate-100 text-slate-700 border-slate-200"
        }
        contextFields={glOrder ? [
          { label: "Title",     value: glOrder.title },
          { label: "Landlord",  value: getLandlordLabel(glOrder.landlord) },
          { label: "Property",  value: glOrder.property?.propertyName || glOrder.property?.name },
          { label: "Frequency", value: frequencyLabel(glOrder.frequency) },
        ].filter((f) => f.value) : []}
        businessId={currentCompany?._id}
        sourceType="recurring_deduction"
        sourceId={glOrder?._id}
      />

    </DashboardLayout>
  );
};

export default LandlordStandingOrders;
