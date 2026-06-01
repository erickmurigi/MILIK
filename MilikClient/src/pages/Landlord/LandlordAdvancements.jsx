
import React, { useEffect, useMemo, useRef, useState } from "react";
import useDebounce from "../../hooks/useDebounce";
import {
  FaCheck,
  FaChevronDown,
  FaClock,
  FaEdit,
  FaExclamationTriangle,
  FaEye,
  FaMoneyBillWave,
  FaPaperPlane,
  FaPause,
  FaPlay,
  FaPlus,
  FaSave,
  FaSearch,
  FaTimes,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useConfirm } from "../../context/ConfirmContext";
import {
  cancelLandlordAdvancementRecovery,
  createLandlordAdvancement,
  deleteLandlordAdvancement,
  getChartOfAccounts,
  getLandlordAdvancements,
  getLandlords,
  processLandlordAdvancementRecovery,
  updateLandlordAdvancement,
  updateLandlordAdvancementStatus,
} from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { propertyBelongsToLandlord } from "./propertyUtils";
import { selectCurrentCompany, selectCurrentUser, selectAllLandlords, selectAllProperties } from "../../redux/selectors";
import { hasCompanyPermission } from "../../utils/permissions";

const todayIso = () => new Date().toISOString().split("T")[0];
const money = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value) => (value ? new Date(value).toLocaleDateString("en-KE") : "—");

const addMonths = (dateValue, months = 0) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const safeMonths = Math.max(0, Number(months || 0));
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + safeMonths);
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, maxDay));
  return date;
};

const computeRecoveryEndDate = ({ startDate, periodMonths, gracePeriodMonths }) => {
  const safePeriodMonths = Math.max(0, Number(periodMonths || 0));
  if (!startDate || safePeriodMonths <= 0) return "";
  const effectiveStart = addMonths(startDate, gracePeriodMonths || 0);
  if (!effectiveStart) return "";
  const endDate = new Date(effectiveStart.getFullYear(), effectiveStart.getMonth() + safePeriodMonths, 0);
  return Number.isNaN(endDate.getTime()) ? "" : endDate.toISOString().split("T")[0];
};

const defaultTitleForType = (advanceType) =>
  advanceType === "against_payable"
    ? "Landlord Advance - Early Payout"
    : "Landlord Advance - Recover from Next Statement";

const blankForm = {
  advanceType: "against_payable",
  landlord: "",
  property: "",
  title: defaultTitleForType("against_payable"),
  narration: "",
  notes: "",
  amount: "",
  disbursementDate: todayIso(),
  startDate: todayIso(),
  endDate: "",
  periodMonths: "1",
  gracePeriodMonths: "0",
  frequency: "monthly",
  paymentMethod: "bank_transfer",
  cashbook: "",
  status: "draft",
};

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-indigo-100 text-indigo-700",
  approved: "bg-blue-100 text-blue-700",
  disbursed: "bg-emerald-100 text-emerald-700",
  recovering: "bg-amber-100 text-amber-700",
  paused: "bg-yellow-100 text-yellow-800",
  cleared: "bg-teal-100 text-teal-700",
  cancelled: "bg-rose-100 text-rose-700",
  rejected: "bg-rose-100 text-rose-700",
  reversed: "bg-zinc-200 text-zinc-700",
};

const ITEMS_PER_PAGE = 50;

const TYPE_OPTIONS = [
  {
    value: "against_payable",
    label: "Advance against current payable",
    hint: "Early payout. This reduces what is currently payable to the landlord and is not recovered later.",
  },
  {
    value: "future_recoverable",
    label: "Future recoverable advance",
    hint: "Pay now and recover from upcoming landlord statement(s).",
  },
];

const INITIAL_STATUS_OPTIONS = [
  { value: "draft", label: "Save as Draft" },
  { value: "submitted", label: "Save and Submit" },
  { value: "approved", label: "Save and Approve" },
  { value: "disbursed", label: "Save and Disburse" },
];

const statusLabel = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Draft";

const rowTitle = (row) => row?.title || defaultTitleForType(row?.advanceType);

const mapRowToForm = (row) => {
  const advanceType = row?.advanceType || "future_recoverable";
  return {
    advanceType,
    landlord: row?.landlord?._id || row?.landlord || "",
    property: row?.property?._id || row?.property || "",
    title: row?.title || defaultTitleForType(advanceType),
    narration: row?.narration || "",
    notes: row?.notes || "",
    amount: row?.amount || "",
    disbursementDate: row?.disbursementDate ? new Date(row.disbursementDate).toISOString().split("T")[0] : todayIso(),
    startDate: row?.startDate ? new Date(row.startDate).toISOString().split("T")[0] : todayIso(),
    endDate: row?.endDate ? new Date(row.endDate).toISOString().split("T")[0] : "",
    periodMonths: row?.periodMonths ? String(row.periodMonths) : "1",
    gracePeriodMonths: String(row?.gracePeriodMonths || 0),
    frequency: row?.frequency || "monthly",
    paymentMethod:
      row?.paymentMethod === "mobile_money"
        ? "mpesa"
        : row?.paymentMethod === "check"
        ? "cheque"
        : row?.paymentMethod || "bank_transfer",
    cashbook: row?.cashbook?._id || row?.cashbook || "",
    status: row?.status || "draft",
  };
};

const RecoveryHistoryRow = ({ item, onCancel }) => (
  <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
    <div>
      <div className="font-bold text-slate-900">{item.periodLabel || item.periodKey}</div>
      <div className="text-xs text-slate-500">
        Processed {formatDate(item.processedAt)} • Amount {money(item.amount)}
      </div>
      {item.note ? <div className="mt-0.5 text-xs text-slate-600">{item.note}</div> : null}
    </div>
    {!item.cancelledAt ? (
      <button
        onClick={onCancel}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-black text-rose-700"
      >
        <FaUndo /> Cancel recovery
      </button>
    ) : (
      <div className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600">
        Cancelled {formatDate(item.cancelledAt)}
      </div>
    )}
  </div>
);

const LandlordAdvancements = () => {
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
  const [cashbooks, setCashbooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    landlordId: "all",
    advanceType: "all",
  });
  const debouncedSearch = useDebounce(filters.search, 400);
  const [form, setForm] = useState(blankForm);

  const canWrite = hasCompanyPermission(currentUser, currentCompany, "landlordAdvancements", "create", "accounts");

  const _uid = currentUser?._id || currentUser?.id;
  const _laDraftKey = (currentCompany?._id && _uid) ? `milik:draft:landlord-advance:${currentCompany._id}:${_uid}` : null;
  const _laDraftRestored = useRef(false);

  useEffect(() => {
    if (!_laDraftKey || _laDraftRestored.current) return;
    _laDraftRestored.current = true;
    try {
      const raw = window.sessionStorage.getItem(_laDraftKey);
      if (raw) { const { form: s } = JSON.parse(raw); if (s) { setForm(s); setShowModal(true); } }
    } catch {}
  }, [_laDraftKey]);

  useEffect(() => {
    if (!_laDraftKey || !_laDraftRestored.current || !showModal || editingId) return;
    try { window.sessionStorage.setItem(_laDraftKey, JSON.stringify({ form })); } catch {}
  }, [_laDraftKey, form, showModal, editingId]);

  const [recoveryModal, setRecoveryModal] = useState({
    open: false,
    row: null,
    periodKey: "",
    amount: "",
    note: "",
  });

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getLandlords({ company: currentCompany._id }));
    dispatch(getProperties({ business: currentCompany._id }));
    (async () => {
      try {
        const accounts = await getChartOfAccounts({ business: currentCompany._id, type: "asset" });
        setCashbooks(Array.isArray(accounts) ? accounts : []);
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to load cashbooks");
      }
    })();
  }, [dispatch, currentCompany?._id]);

  const loadRows = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const result = await getLandlordAdvancements({
        business: currentCompany._id,
        company: currentCompany._id,
        status: filters.status,
        landlordId: filters.landlordId,
        advanceType: filters.advanceType,
        search: debouncedSearch,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      });
      setRows(Array.isArray(result.data) ? result.data : []);
      setServerTotal(result.total ?? 0);
      setServerPages(result.pages ?? 1);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load landlord advances");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [currentCompany?._id, debouncedSearch, filters.status, filters.landlordId, filters.advanceType, currentPage]);

  useEffect(() => {
    if (!showModal) return;
    if (form.advanceType !== "future_recoverable") return;

    const computedEndDate = computeRecoveryEndDate({
      startDate: form.startDate,
      periodMonths: form.periodMonths,
      gracePeriodMonths: form.gracePeriodMonths,
    });

    if (computedEndDate && computedEndDate !== form.endDate) {
      setForm((prev) => ({ ...prev, endDate: computedEndDate }));
    }
  }, [showModal, form.advanceType, form.startDate, form.periodMonths, form.gracePeriodMonths, form.endDate]);

  useEffect(() => {
    if (!showModal) return;
    setForm((prev) => {
      if (!prev.title || prev.title === defaultTitleForType(prev.advanceType === "against_payable" ? "future_recoverable" : "against_payable")) {
        return { ...prev, title: defaultTitleForType(prev.advanceType) };
      }
      return prev;
    });
  }, [showModal, form.advanceType]);

  const safeCurrentPage = Math.min(currentPage, serverPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filters.status, filters.landlordId, filters.advanceType]);

  const filteredProperties = useMemo(() => {
    if (!form.landlord) return activeProperties;
    const selectedLandlord = activeLandlords.find((item) => String(item._id) === String(form.landlord));
    return activeProperties.filter((property) =>
      propertyBelongsToLandlord(property, form.landlord, selectedLandlord?.landlordName)
    );
  }, [activeLandlords, activeProperties, form.landlord]);

  const stats = useMemo(
    () => ({
      total: serverTotal,
      totalDisbursed: rows.reduce((sum, row) => sum + Number(row?.disbursedAt ? row.amount || 0 : 0), 0),
      earlyPayouts: rows.reduce(
        (sum, row) => sum + Number(row?.advanceType === "against_payable" ? row.alreadyPaidToLandlord || 0 : 0),
        0
      ),
      recoverableOutstanding: rows.reduce(
        (sum, row) => sum + Number(row?.advanceType === "future_recoverable" ? row.outstandingRecoverableAmount || 0 : 0),
        0
      ),
      totalRecovered: rows.reduce((sum, row) => sum + Number(row.totalRecoveredAmount || 0), 0),
    }),
    [rows, serverTotal]
  );

  const selectedRecoveryPeriod = useMemo(() => {
    const periods = recoveryModal.row?.eligibleRecoveryPeriods || [];
    return periods.find((item) => item.periodKey === recoveryModal.periodKey) || periods[0] || null;
  }, [recoveryModal.row, recoveryModal.periodKey]);

  const resetModal = () => {
    if (_laDraftKey) { try { window.sessionStorage.removeItem(_laDraftKey); } catch {} }
    setShowModal(false);
    setEditingId("");
    setForm(blankForm);
  };

  const openCreate = () => {
    if (!canWrite) { toast.warning("You don't have permission to create landlord advancements"); return; }
    setEditingId("");
    setForm(blankForm);
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canWrite) { toast.warning("You don't have permission to edit landlord advancements"); return; }
    setEditingId(row._id);
    setForm(mapRowToForm(row));
    setShowModal(true);
  };

  const submitAction = async (fn) => {
    setSaving(true);
    try {
      await fn();
      await loadRows();
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!form.landlord) return toast.warning("Select the landlord");
    if (!form.property) return toast.warning("Select the property");
    if (!Number(form.amount || 0) || Number(form.amount) <= 0) return toast.warning("Enter a valid amount");
    if (!form.disbursementDate) return toast.warning("Disbursement date is required");

    if (form.advanceType === "future_recoverable") {
      if (!form.startDate) return toast.warning("Recovery start date is required");
      if (!form.periodMonths && !form.endDate) return toast.warning("Provide how many statement periods to recover over");
    }

    const payload = {
      business: currentCompany?._id,
      company: currentCompany?._id,
      advanceType: form.advanceType,
      landlord: form.landlord,
      property: form.property,
      title: form.title?.trim() || defaultTitleForType(form.advanceType),
      narration: form.narration?.trim() || "",
      notes: form.notes?.trim() || "",
      amount: Number(form.amount),
      disbursementDate: form.disbursementDate,
      startDate: form.advanceType === "future_recoverable" ? form.startDate : form.disbursementDate,
      endDate: form.advanceType === "future_recoverable" ? form.endDate || null : form.disbursementDate,
      periodMonths: form.advanceType === "future_recoverable" ? Number(form.periodMonths || 0) || null : null,
      gracePeriodMonths: form.advanceType === "future_recoverable" ? Number(form.gracePeriodMonths || 0) : 0,
      frequency: form.advanceType === "future_recoverable" ? form.frequency : "monthly",
      paymentMethod: form.paymentMethod,
      cashbook: form.cashbook || null,
      status: form.status,
    };

    await submitAction(async () => {
      try {
        if (editingId) await updateLandlordAdvancement(editingId, payload);
        else await createLandlordAdvancement(payload);
        toast.success(`Landlord advance ${editingId ? "updated" : "saved"}`);
        resetModal();
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to save landlord advance");
      }
    });
  };

  const handleStatus = async (row, status, successMessage = "") => {
    await submitAction(async () => {
      try {
        await updateLandlordAdvancementStatus(row._id, {
          business: currentCompany?._id,
          company: currentCompany?._id,
          status,
        });
        toast.success(successMessage || `Landlord advance marked ${statusLabel(status).toLowerCase()}`);
      } catch (error) {
        toast.error(error?.response?.data?.message || `Failed to ${statusLabel(status).toLowerCase()} landlord advance`);
      }
    });
  };

  const handleDelete = async (row) => {
    if (!canWrite) { toast.warning("You don't have permission to delete landlord advancements"); return; }
    if (!await confirm({ title: "Delete Advance", message: `Delete ${row.referenceNo || "this landlord advance"}?`, confirmText: "Delete", isDangerous: true })) return;
    await submitAction(async () => {
      try {
        await deleteLandlordAdvancement(row._id, { business: currentCompany?._id, company: currentCompany?._id });
        toast.success("Landlord advance deleted");
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to delete landlord advance");
      }
    });
  };

  const openRecoveryModal = (row) => {
    const firstPeriod = row?.eligibleRecoveryPeriods?.[0] || null;
    setRecoveryModal({
      open: true,
      row,
      periodKey: firstPeriod?.periodKey || "",
      amount: firstPeriod?.scheduledAmount ? String(firstPeriod.scheduledAmount) : "",
      note: "",
    });
  };

  const closeRecoveryModal = () => {
    setRecoveryModal({ open: false, row: null, periodKey: "", amount: "", note: "" });
  };

  const handleProcessRecovery = async () => {
    if (!recoveryModal.row?._id) return;
    if (!selectedRecoveryPeriod?.periodKey) return toast.warning("Select the recovery period");
    if (!Number(recoveryModal.amount || 0) || Number(recoveryModal.amount) <= 0) {
      return toast.warning("Enter a valid recovery amount");
    }

    await submitAction(async () => {
      try {
        await processLandlordAdvancementRecovery(recoveryModal.row._id, {
          business: currentCompany?._id,
          company: currentCompany?._id,
          periodKey: selectedRecoveryPeriod.periodKey,
          amount: Number(recoveryModal.amount),
          note: recoveryModal.note?.trim() || "",
        });
        toast.success("Recoverable advance applied to statement");
        closeRecoveryModal();
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to process advance recovery");
      }
    });
  };

  const handleCancelRecovery = async (row, recoveryId) => {
    if (!await confirm({ title: "Cancel Recovery", message: "Cancel this processed recovery? This action cannot be undone.", confirmText: "Cancel Recovery", isDangerous: true })) return;
    await submitAction(async () => {
      try {
        await cancelLandlordAdvancementRecovery(row._id, recoveryId, {
          business: currentCompany?._id,
          company: currentCompany?._id,
        });
        toast.success("Recovery cancelled");
      } catch (error) {
        toast.error(error?.response?.data?.message || "Failed to cancel recovery");
      }
    });
  };

  const renderActions = (row) => {
    const actions = [];

    if (["draft", "rejected"].includes(row.status)) {
      actions.push(
        <button
          key="submit"
          onClick={() => handleStatus(row, "submitted", "Landlord advance submitted")}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white"
        >
          <FaPaperPlane /> Submit
        </button>
      );
      actions.push(
        <button
          key="approve"
          onClick={() => handleStatus(row, "approved", "Landlord advance approved")}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white"
        >
          <FaCheck /> Approve
        </button>
      );
    }

    if (["submitted", "approved", "draft"].includes(row.status)) {
      actions.push(
        <button
          key="disburse"
          onClick={() => handleStatus(row, "disbursed", "Landlord advance disbursed")}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"
        >
          <FaMoneyBillWave /> Disburse
        </button>
      );
    }

    if (row.advanceType === "future_recoverable" && ["recovering", "disbursed", "paused"].includes(row.status) && (row.eligibleRecoveryPeriods || []).length > 0) {
      actions.push(
        <button
          key="recover"
          onClick={() => openRecoveryModal(row)}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white"
        >
          <FaClock /> Recover now
        </button>
      );
    }

    if (row.advanceType === "future_recoverable" && row.status === "recovering") {
      actions.push(
        <button
          key="pause"
          onClick={() => handleStatus(row, "paused", "Recoverable advance paused")}
          className="inline-flex items-center gap-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-black text-yellow-800"
        >
          <FaPause /> Pause
        </button>
      );
    }

    if (row.advanceType === "future_recoverable" && row.status === "paused") {
      actions.push(
        <button
          key="resume"
          onClick={() => handleStatus(row, "recovering", "Recoverable advance resumed")}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"
        >
          <FaPlay /> Resume
        </button>
      );
    }

    if (!["reversed", "cancelled", "cleared"].includes(row.status) && row.disbursedAt) {
      actions.push(
        <button
          key="reverse"
          onClick={() => handleStatus(row, "reversed", "Landlord advance reversed")}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs font-black text-zinc-700"
        >
          <FaUndo /> Reverse
        </button>
      );
    }

    if (!row.disbursedAt && !["cancelled", "rejected", "submitted", "approved", "reversed"].includes(row.status)) {
      actions.push(
        <button
          key="cancel"
          onClick={() => handleStatus(row, "cancelled", "Landlord advance cancelled")}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700"
        >
          <FaTimes /> Cancel
        </button>
      );
    }

    if (!row.disbursedAt && !["cancelled", "reversed"].includes(row.status) && canWrite) {
      actions.push(
        <button
          key="edit"
          onClick={() => openEdit(row)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
        >
          <FaEdit /> Edit
        </button>
      );
    }

    if (!row.disbursedAt && canWrite) {
      actions.push(
        <button
          key="delete"
          onClick={() => handleDelete(row)}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700"
        >
          <FaTrash /> Delete
        </button>
      );
    }

    return actions;
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
        <div className="flex-none sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
            <div className="relative shrink-0">
              <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]" />
              <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Reference, title…" className="h-7 w-40 rounded border border-gray-300 bg-[#DDEFE1] pl-6 pr-2 text-xs outline-none focus:border-[#0B3B2E]" />
            </div>
            <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              <option value="all">All statuses</option>
              {["draft", "submitted", "approved", "disbursed", "recovering", "paused", "cleared", "cancelled", "rejected", "reversed"].map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
            </select>
            <select value={filters.landlordId} onChange={(e) => setFilters((prev) => ({ ...prev, landlordId: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              <option value="all">All landlords</option>
              {activeLandlords.map((landlord) => (<option key={landlord._id} value={landlord._id}>{landlord.landlordName || landlord.firstName || landlord.email || "Landlord"}</option>))}
            </select>
            <select value={filters.advanceType} onChange={(e) => setFilters((prev) => ({ ...prev, advanceType: e.target.value }))} className="h-7 shrink-0 rounded border border-slate-200 bg-white px-2 text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
              <option value="all">All types</option>
              {TYPE_OPTIONS.map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}
            </select>
            <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
            <button onClick={openCreate} disabled={!canWrite} className="h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs font-semibold text-white bg-[#FF8C00] hover:bg-[#e67e00] disabled:cursor-not-allowed disabled:bg-slate-300"><FaPlus /> New Advance</button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 shadow-sm">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Reference</th>
                  <th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Landlord / Property</th>
                  <th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Type</th>
                  <th className="px-3 py-2 text-right font-black uppercase tracking-[0.14em]">Amount</th>
                  <th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Date</th>
                  <th className="px-3 py-2 text-left font-black uppercase tracking-[0.14em]">Status</th>
                  <th className="px-3 py-2 text-right font-black uppercase tracking-[0.14em]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Loading landlord advances...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No landlord advances found.</td></tr>
                ) : (
                  rows.map((row, index) => {
                    const expanded = expandedId === row._id;
                    const landlordLabel = row?.landlord?.landlordName || [row?.landlord?.firstName, row?.landlord?.lastName].filter(Boolean).join(" ") || row?.landlord?.email || "Landlord";
                    const propertyLabel = row?.property?.propertyName || row?.property?.name || row?.property?.propertyCode || "Property";
                    return (
                      <React.Fragment key={row._id}>
                        <tr className={`border-t border-slate-100 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"} hover:bg-slate-50`}>
                          <td className="px-3 py-1.5"><div className="font-black text-slate-900">{row.referenceNo}</div><button type="button" onClick={() => setExpandedId((prev) => (prev === row._id ? "" : row._id))} className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E]"><FaEye /> {expanded ? "Hide details" : "View details"}<FaChevronDown className={`transition ${expanded ? "rotate-180" : ""}`} /></button></td>
                          <td className="px-3 py-1.5"><div className="font-semibold text-slate-900">{landlordLabel}</div><div className="text-[11px] text-slate-500">{propertyLabel}</div></td>
                          <td className="px-3 py-1.5 text-slate-700">{TYPE_OPTIONS.find((item) => item.value === row.advanceType)?.label || statusLabel(row.advanceType)}</td>
                          <td className="px-3 py-1.5 text-right font-black text-slate-900">{money(row.amount)}</td>
                          <td className="px-3 py-1.5 text-slate-700">{formatDate(row.disbursementDate)}</td>
                          <td className="px-3 py-1.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${STATUS_STYLES[row.status] || STATUS_STYLES.draft}`}>{statusLabel(row.status)}</span></td>
                          <td className="px-3 py-1.5 text-right"><div className="inline-flex flex-wrap justify-end gap-1.5">{renderActions(row)}</div></td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-slate-100 bg-slate-50/80">
                            <td colSpan={7} className="px-3 py-2">
                              <div className="grid gap-2 md:grid-cols-4">
                                <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-[11px] font-black uppercase text-slate-500">Cashbook</div><div className="mt-1 font-semibold text-slate-900">{row?.cashbook?.name || row?.cashbook?.accountName || "System default"}</div></div>
                                <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-[11px] font-black uppercase text-slate-500">Already paid</div><div className="mt-1 font-semibold text-emerald-700">{money(row.alreadyPaidToLandlord)}</div></div>
                                <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-[11px] font-black uppercase text-slate-500">Outstanding recoverable</div><div className="mt-1 font-semibold text-amber-700">{money(row.outstandingRecoverableAmount)}</div></div>
                                <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-[11px] font-black uppercase text-slate-500">Recovered</div><div className="mt-1 font-semibold text-slate-900">{money(row.totalRecoveredAmount)}</div></div>
                              </div>
                              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700"><span className="font-black text-slate-900">Narration:</span> {row.narration || "—"} <span className="ml-3 font-black text-slate-900">Notes:</span> {row.notes || "—"}</div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {!loading && serverTotal > 0 && (
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
              <div className="font-semibold">
                Showing <span className="font-bold text-slate-900">{serverTotal === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="font-bold text-slate-900">{Math.min(safeCurrentPage * ITEMS_PER_PAGE, serverTotal)}</span> of <span className="font-bold text-slate-900">{serverTotal}</span> advancement record(s)
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {serverPages}</span>
                <button onClick={() => setCurrentPage((prev) => Math.min(serverPages, prev + 1))} disabled={safeCurrentPage === serverPages} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0B3B2E] px-6 py-5 text-white">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
                  {editingId ? "Edit landlord advance" : "New landlord advance"}
                </div>
                <h3 className="mt-1 text-2xl font-black">
                  {form.advanceType === "against_payable" ? "Early payout / against current payable" : "Future recoverable landlord advance"}
                </h3>
              </div>
              <button onClick={resetModal} className="rounded-full border border-white/30 p-2 text-white">
                <FaTimes />
              </button>
            </div>

            <div className="max-h-[calc(92vh-84px)] overflow-y-auto p-6">
              <div className="grid gap-5 xl:grid-cols-3">
                {TYPE_OPTIONS.map((option) => {
                  const active = form.advanceType === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          advanceType: option.value,
                          title: !prev.title || prev.title === defaultTitleForType(prev.advanceType) ? defaultTitleForType(option.value) : prev.title,
                          status: prev.status === "recovering" && option.value === "against_payable" ? "draft" : prev.status,
                        }))
                      }
                      className={`rounded-3xl border p-5 text-left transition ${active ? "border-[#0B3B2E] bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <div className="font-black text-slate-900">{option.label}</div>
                      <div className="mt-2 text-sm text-slate-600">{option.hint}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {form.advanceType === "against_payable" ? (
                  <>
                    <div className="font-black text-slate-900">This is an early payout, not a loan.</div>
                    <div className="mt-1">Milik will validate the current landlord payable. On disbursement the module posts Dr Landlord Remittance Payable and Cr the selected cashbook.</div>
                  </>
                ) : (
                  <>
                    <div className="font-black text-slate-900">This is a recoverable advance.</div>
                    <div className="mt-1">Milik posts the disbursement to Landlord Advances Recoverable, then lets you recover from future statements safely and auditable.</div>
                  </>
                )}
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Landlord</span>
                  <select
                    value={form.landlord}
                    onChange={(e) => setForm((prev) => ({ ...prev, landlord: e.target.value, property: "" }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  >
                    <option value="">Select landlord</option>
                    {activeLandlords.map((landlord) => (
                      <option key={landlord._id} value={landlord._id}>
                        {landlord.landlordName || landlord.firstName || landlord.email || "Landlord"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">Property</span>
                  <select
                    value={form.property}
                    onChange={(e) => setForm((prev) => ({ ...prev, property: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  >
                    <option value="">Select property</option>
                    {filteredProperties.map((property) => (
                      <option key={property._id} value={property._id}>
                        {property.propertyName || property.name || property.propertyCode || "Property"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">Initial workflow step</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  >
                    {INITIAL_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block xl:col-span-2">
                  <span className="text-sm font-black text-slate-700">Title</span>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">Amount</span>
                  <input
                    type="number"
                    min="0"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">Disbursement date</span>
                  <input
                    type="date"
                    value={form.disbursementDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, disbursementDate: e.target.value, startDate: prev.advanceType === "against_payable" ? e.target.value : prev.startDate }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">Payment method</span>
                  <select
                    value={form.paymentMethod}
                    onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  >
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="mpesa">M-Pesa</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-black text-slate-700">Cashbook / payout account</span>
                  <select
                    value={form.cashbook}
                    onChange={(e) => setForm((prev) => ({ ...prev, cashbook: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  >
                    <option value="">Use system default</option>
                    {cashbooks.map((account) => (
                      <option key={account._id} value={account._id}>
                        {account.name || account.accountName || account.code}
                      </option>
                    ))}
                  </select>
                </label>

                {form.advanceType === "future_recoverable" ? (
                  <>
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Recover from next statement starting</span>
                      <input
                        type="date"
                        value={form.startDate}
                        onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                        className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Recover over next X statements</span>
                      <input
                        type="number"
                        min="1"
                        value={form.periodMonths}
                        onChange={(e) => setForm((prev) => ({ ...prev, periodMonths: e.target.value }))}
                        className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Grace period (months)</span>
                      <input
                        type="number"
                        min="0"
                        value={form.gracePeriodMonths}
                        onChange={(e) => setForm((prev) => ({ ...prev, gracePeriodMonths: e.target.value }))}
                        className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Frequency</span>
                      <select
                        value={form.frequency}
                        onChange={(e) => setForm((prev) => ({ ...prev, frequency: e.target.value }))}
                        className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="weekly">Weekly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-black text-slate-700">Computed recovery end date</span>
                      <input
                        type="date"
                        value={form.endDate}
                        onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                        className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                      />
                    </label>
                  </>
                ) : null}

                <label className="block xl:col-span-3">
                  <span className="text-sm font-black text-slate-700">Narration</span>
                  <textarea
                    rows={3}
                    value={form.narration}
                    onChange={(e) => setForm((prev) => ({ ...prev, narration: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  />
                </label>

                <label className="block xl:col-span-3">
                  <span className="text-sm font-black text-slate-700">Internal notes</span>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                    className="mt-1 w-full rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs outline-none focus:border-[#FF8C00]"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={resetModal} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                <FaSave /> {saving ? "Saving..." : editingId ? "Update landlord advance" : "Save landlord advance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {recoveryModal.open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-amber-600 px-6 py-5 text-white">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.22em] text-amber-100">Recoverable advance</div>
                <h3 className="mt-1 text-2xl font-black">Apply recovery to statement</h3>
              </div>
              <button onClick={closeRecoveryModal} className="rounded-full border border-white/30 p-2 text-white">
                <FaTimes />
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-black">{rowTitle(recoveryModal.row)}</div>
                <div className="mt-1">
                  Recoveries post separately on the landlord statement and reduce the outstanding recoverable advance balance.
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-black text-slate-700">Eligible statement period</span>
                <select
                  value={recoveryModal.periodKey}
                  onChange={(e) => {
                    const selected = (recoveryModal.row?.eligibleRecoveryPeriods || []).find((item) => item.periodKey === e.target.value);
                    setRecoveryModal((prev) => ({
                      ...prev,
                      periodKey: e.target.value,
                      amount: selected?.scheduledAmount ? String(selected.scheduledAmount) : prev.amount,
                    }));
                  }}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-amber-600"
                >
                  {(recoveryModal.row?.eligibleRecoveryPeriods || []).map((item) => (
                    <option key={item.periodKey} value={item.periodKey}>
                      {item.periodLabel} • Scheduled {money(item.scheduledAmount)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Recovery amount</span>
                  <input
                    type="number"
                    value={recoveryModal.amount}
                    onChange={(e) => setRecoveryModal((prev) => ({ ...prev, amount: e.target.value }))}
                    className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-amber-600"
                  />
                </label>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="font-black text-slate-900">{selectedRecoveryPeriod?.periodLabel || "No period selected"}</div>
                  <div className="mt-2">Window: {formatDate(selectedRecoveryPeriod?.periodStart)} to {formatDate(selectedRecoveryPeriod?.periodEnd)}</div>
                  <div className="mt-1">Outstanding balance: {money(recoveryModal.row?.outstandingRecoverableAmount)}</div>
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-black text-slate-700">Narration</span>
                <textarea
                  rows={3}
                  value={recoveryModal.note}
                  onChange={(e) => setRecoveryModal((prev) => ({ ...prev, note: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-amber-600"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={closeRecoveryModal} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700">
                Close
              </button>
              <button
                onClick={handleProcessRecovery}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                <FaCheck /> {saving ? "Processing..." : "Post recovery"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default LandlordAdvancements;
